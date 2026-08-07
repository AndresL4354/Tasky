//! Fase 6 — export a Markdown + git opcional (commit / push / pull).
//!
//! Exporta el estado a una carpeta `tasky/` dentro de un repo git local: un
//! `.md` por proyecto + `inbox.md`, con orden determinista para diffs limpios.
//! El **commit** local se hace con `git2` (sin red). El **push/pull** se delega
//! al `git` del sistema (usa tu Administrador de credenciales para GitHub), lo
//! que evita enlazar OpenSSL y mantiene el `.exe` autocontenido y portable.
//!
//! Todo esto es **aditivo**: la app funciona igual sin repo configurado, y las
//! operaciones se lanzan desde un hilo aparte (ver `app::start_sync`). La
//! dirección es DB → texto → git (no se reimporta el Markdown; el sync
//! bidireccional sería otro trabajo, ver nota del plan sobre CRDT).

use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

use git2::{IndexAddOption, Repository, Signature};
use tasky::core::{Project, Status, Tag, Task};

// ---------------------------------------------------------------------------
// Exportador (render puro + escritura de ficheros)
// ---------------------------------------------------------------------------

/// Renderiza el estado a pares `(nombre_fichero, contenido_markdown)`: un
/// fichero por proyecto (ordenados por nombre) + `inbox.md` para las tareas sin
/// proyecto. Orden de tareas determinista (posición, id).
pub fn render_markdown(
    projects: &[Project],
    tasks: &[Task],
    tags: &HashMap<i64, Vec<Tag>>,
) -> Vec<(String, String)> {
    let mut out = Vec::new();

    let mut projs: Vec<&Project> = projects.iter().collect();
    projs.sort_by(|a, b| a.name.cmp(&b.name));
    for p in projs {
        let mut items: Vec<&Task> = tasks.iter().filter(|t| t.project_id == Some(p.id)).collect();
        items.sort_by(|a, b| a.position.cmp(&b.position).then(a.id.cmp(&b.id)));
        out.push((format!("{}.md", sanitize(&p.name)), render_section(&p.name, &items, tags)));
    }

    let mut inbox: Vec<&Task> = tasks.iter().filter(|t| t.project_id.is_none()).collect();
    inbox.sort_by(|a, b| a.position.cmp(&b.position).then(a.id.cmp(&b.id)));
    out.push(("inbox.md".to_string(), render_section("Inbox", &inbox, tags)));

    out
}

fn render_section(title: &str, tasks: &[&Task], tags: &HashMap<i64, Vec<Tag>>) -> String {
    let mut s = format!("# {title}\n\n");
    if tasks.is_empty() {
        s.push_str("_(sin tareas)_\n");
    }
    for t in tasks {
        let tg: &[Tag] = tags.get(&t.id).map(|v| v.as_slice()).unwrap_or(&[]);
        s.push_str(&task_line(t, tg));
        s.push('\n');
    }
    s
}

fn task_line(t: &Task, tags: &[Tag]) -> String {
    let check = match t.status {
        Status::Done => "x",
        Status::Cancelled => "-",
        _ => " ",
    };
    let mut line = format!("- [{check}] {}", t.title);
    if let Some(d) = t.due_date {
        line.push_str(&format!(" 📅 {d}"));
    }
    if let Some(r) = &t.recurrence {
        line.push_str(&format!(" 🔁 {}", r.to_rule()));
    }
    if t.urgent {
        line.push_str(" ⚡");
    }
    if t.important {
        line.push_str(" ⭐");
    }
    for tag in tags {
        line.push_str(&format!(" #{}", tag.name));
    }
    line
}

fn sanitize(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' { c } else { '_' })
        .collect();
    let s = s.trim().to_string();
    if s.is_empty() { "proyecto".to_string() } else { s }
}

/// Escribe los ficheros en `<repo>/tasky/`, podando los `.md` previos que ya no
/// correspondan (aislado en ese subdirectorio para no tocar otros ficheros).
pub fn export_to_dir(repo_path: &Path, files: &[(String, String)]) -> std::io::Result<()> {
    let out = repo_path.join("tasky");
    std::fs::create_dir_all(&out)?;

    let keep: std::collections::HashSet<&str> = files.iter().map(|(n, _)| n.as_str()).collect();
    if let Ok(rd) = std::fs::read_dir(&out) {
        for entry in rd.flatten() {
            if let Some(name) = entry.file_name().to_str().map(str::to_string)
                && name.ends_with(".md")
                && !keep.contains(name.as_str())
            {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    for (name, content) in files {
        std::fs::write(out.join(name), content)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Git: commit (git2, local) + push/pull (git del sistema)
// ---------------------------------------------------------------------------

/// Stagea todo y hace commit. `Some(hash)` o `None` si no había cambios. Abre el
/// repo o lo inicializa si no existe. Errores como texto para mostrarlos en la UI.
pub fn commit_all(repo_path: &str, message: &str) -> Result<Option<String>, String> {
    commit_all_inner(repo_path, message).map_err(|e| e.to_string())
}

fn commit_all_inner(repo_path: &str, message: &str) -> Result<Option<String>, git2::Error> {
    let repo = Repository::open(repo_path).or_else(|_| Repository::init(repo_path))?;

    let mut index = repo.index()?;
    index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)?;
    index.write()?;
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;

    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    if let Some(p) = &parent
        && p.tree_id() == tree_id
    {
        return Ok(None); // sin cambios respecto al último commit
    }

    let sig = repo
        .signature()
        .or_else(|_| Signature::now("tasky", "tasky@localhost"))?;
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    let oid = repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)?;
    Ok(Some(oid.to_string()))
}

/// Ejecuta `git -C <repo> <args>` sin abrir ventana de consola en Windows.
fn git_cli(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo_path).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd
        .output()
        .map_err(|e| format!("no se pudo ejecutar git: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn has_origin(repo_path: &str) -> bool {
    git_cli(repo_path, &["remote"])
        .map(|s| s.lines().any(|l| l.trim() == "origin"))
        .unwrap_or(false)
}

/// Push de la rama actual a `origin`. `Ok(false)` si no hay remoto `origin`.
pub fn push(repo_path: &str) -> Result<bool, String> {
    if !has_origin(repo_path) {
        return Ok(false);
    }
    git_cli(repo_path, &["push", "origin", "HEAD"])?;
    Ok(true)
}

/// Pull (solo fast-forward) desde `origin`. La app no reimporta el Markdown al
/// SQLite; solo mantiene al día el repo de texto.
pub fn pull(repo_path: &str) -> Result<String, String> {
    if !has_origin(repo_path) {
        return Ok("Sin remoto 'origin'".to_string());
    }
    git_cli(repo_path, &["pull", "--ff-only"])?;
    Ok("Pull OK (fast-forward)".to_string())
}

/// Commit + push. Devuelve un resumen legible para la UI.
pub fn commit_and_push(repo_path: &str, message: &str) -> Result<String, String> {
    let committed = commit_all(repo_path, message)?;
    let mut msg = match committed {
        Some(oid) => format!("Commit {}", &oid[..oid.len().min(7)]),
        None => "Sin cambios".to_string(),
    };
    match push(repo_path) {
        Ok(true) => msg.push_str(" · push OK"),
        Ok(false) => msg.push_str(" · sin remoto 'origin'"),
        Err(e) => msg.push_str(&format!(" · push falló: {e}")),
    }
    Ok(msg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tasky::core::{NewProject, NewTask};
    use tasky::store::{SqliteRepository, TaskRepository};

    #[test]
    fn renders_sections_per_project_and_inbox() {
        let mut store = SqliteRepository::open_in_memory().unwrap();
        let p = store.create_project(NewProject::new("Casa")).unwrap();
        store.create_task(NewTask::new("comprar pan").project(p.id)).unwrap();
        store.create_task(NewTask::new("idea suelta")).unwrap();

        let files = render_markdown(
            &store.list_projects(true).unwrap(),
            &store.list_tasks().unwrap(),
            &HashMap::new(),
        );

        let inbox = files.iter().find(|(n, _)| n == "inbox.md").unwrap();
        assert!(inbox.1.contains("idea suelta"));
        let casa = files.iter().find(|(n, _)| n == "Casa.md").unwrap();
        assert!(casa.1.contains("# Casa"));
        assert!(casa.1.contains("- [ ] comprar pan"));
    }

    #[test]
    fn export_commit_and_push_to_local_bare() {
        let base = std::env::temp_dir().join(format!("tasky_sync_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let work = base.join("work");
        let bare = base.join("remote.git");
        std::fs::create_dir_all(&work).unwrap();

        let repo = Repository::init(&work).unwrap();
        Repository::init_bare(&bare).unwrap();
        repo.remote("origin", bare.to_str().unwrap()).unwrap();
        let work_str = work.to_str().unwrap();

        // Datos → export → commit + push (a un bare local, sin auth).
        let mut store = SqliteRepository::open_in_memory().unwrap();
        store.create_task(NewTask::new("tarea a sincronizar")).unwrap();
        let files = render_markdown(
            &store.list_projects(true).unwrap(),
            &store.list_tasks().unwrap(),
            &HashMap::new(),
        );
        export_to_dir(&work, &files).unwrap();
        assert!(work.join("tasky/inbox.md").exists());

        let msg = commit_and_push(work_str, "test sync").unwrap();
        assert!(msg.contains("Commit"), "msg fue: {msg}");
        assert!(msg.contains("push OK"), "msg fue: {msg}");

        // El bare recibió el push (ya no está vacío).
        let bare_repo = Repository::open_bare(&bare).unwrap();
        assert!(!bare_repo.is_empty().unwrap());

        // Segundo commit sin cambios → "Sin cambios".
        let msg2 = commit_and_push(work_str, "test sync 2").unwrap();
        assert!(msg2.contains("Sin cambios"), "msg2 fue: {msg2}");

        let _ = std::fs::remove_dir_all(&base);
    }
}
