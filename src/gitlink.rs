//! Integración git (lectura) — auto-completar tareas desde commits.
//!
//! Cada tarea puede vincularse a un repo local con una palabra clave. Se
//! **escanean los commits nuevos** (desde HEAD hacia atrás hasta la línea base
//! guardada al vincular); si **alguno** contiene la palabra clave en su mensaje,
//! la tarea se marca como terminada. Así no se pierde aunque después del commit
//! relevante se hayan hecho más commits. Solo lectura: no escribe ni usa la red.

use git2::Repository;

/// Hash del commit HEAD del repo en `path`, o `None` si no se puede abrir el
/// repositorio o aún no tiene commits. Se usa para fijar la línea base al
/// vincular la tarea.
pub fn head_hash(path: &str) -> Option<String> {
    let repo = Repository::open(path).ok()?;
    let commit = repo.head().ok()?.peel_to_commit().ok()?;
    Some(commit.id().to_string())
}

/// ¿El mensaje contiene la palabra clave? (recortada, sin distinguir mayúsculas).
/// Pura y determinista.
pub fn message_has_keyword(message: &str, keyword: &str) -> bool {
    let keyword = keyword.trim();
    !keyword.is_empty() && message.to_lowercase().contains(&keyword.to_lowercase())
}

/// Escanea los commits **nuevos** del repo en `path` (desde HEAD hacia atrás,
/// deteniéndose en `base` y sus ancestros) y devuelve `true` si alguno contiene
/// la palabra clave. Si `base == HEAD` no hay commits nuevos → `false`.
pub fn commits_contain_keyword(path: &str, keyword: &str, base: Option<&str>) -> bool {
    let keyword = keyword.trim();
    if keyword.is_empty() {
        return false;
    }
    let Ok(repo) = Repository::open(path) else {
        return false;
    };
    let Ok(mut walk) = repo.revwalk() else {
        return false;
    };
    if walk.push_head().is_err() {
        return false; // sin HEAD (repo vacío)
    }
    // Excluye la línea base y sus ancestros → solo quedan los commits nuevos.
    if let Some(base) = base
        && let Ok(oid) = git2::Oid::from_str(base)
    {
        let _ = walk.hide(oid);
    }
    // Cota de seguridad por si el historial es enorme.
    for oid in walk.take(1000).filter_map(|r| r.ok()) {
        if let Ok(commit) = repo.find_commit(oid)
            && message_has_keyword(commit.message().unwrap_or(""), keyword)
        {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keyword_matching_is_case_insensitive() {
        assert!(message_has_keyword("Fix LOGIN done", "login"));
        assert!(message_has_keyword("cierra-xyz", "CIERRA-XYZ"));
        assert!(!message_has_keyword("nada que ver", "login"));
        assert!(!message_has_keyword("algo", "   ")); // clave vacía
    }

    #[test]
    fn reads_head_hash_from_real_repo() {
        let dir = std::env::temp_dir().join(format!("tasky_head_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let repo = Repository::init(&dir).unwrap();
        let sig = git2::Signature::now("tester", "t@example.com").unwrap();
        let tree = repo
            .find_tree(repo.index().unwrap().write_tree().unwrap())
            .unwrap();
        let oid = repo
            .commit(Some("HEAD"), &sig, &sig, "primer commit", &tree, &[])
            .unwrap();

        let hash = head_hash(dir.to_str().unwrap()).expect("HEAD");
        assert_eq!(hash, oid.to_string());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn scans_new_commits_even_when_buried_and_completes_task() {
        use tasky::core::{NewTask, Status};
        use tasky::store::{SqliteRepository, TaskRepository};

        let dir = std::env::temp_dir().join(format!("tasky_scan_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.to_str().unwrap().to_string();

        let repo = Repository::init(&dir).unwrap();
        let sig = git2::Signature::now("t", "t@example.com").unwrap();
        let tree = repo
            .find_tree(repo.index().unwrap().write_tree().unwrap())
            .unwrap();

        // Commit inicial SIN la clave → línea base al vincular.
        let c1 = repo
            .commit(Some("HEAD"), &sig, &sig, "trabajo inicial", &tree, &[])
            .unwrap();
        let base = Some(c1.to_string());

        // Tarea vinculada.
        let mut store = SqliteRepository::open_in_memory().unwrap();
        let t = store.create_task(NewTask::new("Implementar login")).unwrap();
        let mut task = store.get_task(t.id).unwrap();
        task.repo_path = Some(path.clone());
        task.repo_keyword = Some("cierra-login".into());
        task.repo_base_commit = base.clone();
        store.update_task(&task).unwrap();

        // Sin commits nuevos → no completa.
        assert!(!commits_contain_keyword(&path, "cierra-login", base.as_deref()));

        // Commit con la clave...
        let p1 = repo.find_commit(c1).unwrap();
        let c2 = repo
            .commit(Some("HEAD"), &sig, &sig, "feat: login listo cierra-login", &tree, &[&p1])
            .unwrap();
        // ...y encima OTRO commit sin la clave (entierra al anterior).
        let p2 = repo.find_commit(c2).unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "docs: actualizar README", &tree, &[&p2])
            .unwrap();

        // Aunque HEAD ya no tenga la clave, el escaneo la encuentra.
        assert!(commits_contain_keyword(&path, "cierra-login", base.as_deref()));
        store.complete_task(t.id).unwrap();
        assert_eq!(store.get_task(t.id).unwrap().status, Status::Done);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
