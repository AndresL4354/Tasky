//! Tests de la capa de almacenamiento.
//!
//! Cada suite es genérica sobre `TaskRepository` y se ejecuta DOS veces: contra
//! `SqliteRepository` (en memoria) y contra `MockRepository`. Así se verifica
//! que ambas implementaciones se comportan igual (CRUD, subtareas y bloqueo por
//! dependencias — entregable §5 de la Fase 1).

use chrono::NaiveDate;
use tasky::core::{NewProject, NewTask, Status};
use tasky::store::{MockRepository, SqliteRepository, TaskRepository};

fn date(y: i32, m: u32, d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, d).unwrap()
}

fn crud_and_queries<R: TaskRepository>(repo: &mut R) {
    // --- Proyectos ---
    let p = repo.create_project(NewProject::new("Casa")).unwrap();
    assert_eq!(repo.get_project(p.id).unwrap().name, "Casa");
    assert_eq!(repo.list_projects(false).unwrap().len(), 1);

    // --- Crear tareas ---
    let t1 = repo
        .create_task(
            NewTask::new("A")
                .project(p.id)
                .urgent(true)
                .important(true)
                .due(date(2026, 8, 6)),
        )
        .unwrap();
    let t2 = repo
        .create_task(NewTask::new("B").important(true).due(date(2026, 12, 1)))
        .unwrap();
    let t3 = repo.create_task(NewTask::new("C")).unwrap();

    // --- Leer + actualizar ---
    let mut got = repo.get_task(t1.id).unwrap();
    assert_eq!(got.title, "A");
    got.title = "A2".into();
    repo.update_task(&got).unwrap();
    assert_eq!(repo.get_task(t1.id).unwrap().title, "A2");
    assert_eq!(repo.list_tasks().unwrap().len(), 3);

    // --- Estados ---
    assert_eq!(repo.tasks_by_status(Status::Todo).unwrap().len(), 3);
    repo.complete_task(t3.id).unwrap();
    assert_eq!(repo.tasks_by_status(Status::Done).unwrap().len(), 1);
    assert!(repo.get_task(t3.id).unwrap().completed_at.is_some());
    assert_eq!(repo.tasks_by_status(Status::Todo).unwrap().len(), 2);

    // --- Hoy / próximas (fecha fija para determinismo) ---
    let today = date(2026, 8, 6);
    let hoy = repo.tasks_today(today).unwrap();
    assert!(hoy.iter().any(|t| t.id == t1.id)); // vence hoy
    assert!(!hoy.iter().any(|t| t.id == t2.id)); // vence en diciembre
    let prox = repo.tasks_upcoming(today).unwrap();
    assert!(prox.iter().any(|t| t.id == t2.id));
    assert!(!prox.iter().any(|t| t.id == t1.id));

    // --- Por proyecto ---
    assert_eq!(repo.tasks_by_project(Some(p.id)).unwrap().len(), 1);
    assert!(repo.tasks_by_project(None).unwrap().iter().any(|t| t.id == t2.id));

    // --- Etiquetas ---
    let tag = repo.create_tag("compras").unwrap();
    let tag_again = repo.create_tag("compras").unwrap(); // idempotente
    assert_eq!(tag.id, tag_again.id);
    repo.add_tag(t1.id, tag.id).unwrap();
    repo.add_tag(t1.id, tag.id).unwrap(); // idempotente
    assert_eq!(repo.tags_for_task(t1.id).unwrap().len(), 1);
    repo.remove_tag(t1.id, tag.id).unwrap();
    assert!(repo.tags_for_task(t1.id).unwrap().is_empty());

    // --- Borrar ---
    repo.delete_task(t2.id).unwrap();
    assert!(repo.get_task(t2.id).is_err());
    assert_eq!(repo.list_tasks().unwrap().len(), 2);
}

fn hierarchy<R: TaskRepository>(repo: &mut R) {
    let parent = repo.create_task(NewTask::new("padre")).unwrap();
    let c1 = repo.create_task(NewTask::new("hijo1").parent(parent.id)).unwrap();
    let c2 = repo.create_task(NewTask::new("hijo2").parent(parent.id)).unwrap();

    let subs = repo.subtasks(parent.id).unwrap();
    assert_eq!(subs.len(), 2);

    // Borrar el padre elimina en cascada a los hijos (parent_id ON DELETE CASCADE).
    repo.delete_task(parent.id).unwrap();
    assert!(repo.get_task(c1.id).is_err());
    assert!(repo.get_task(c2.id).is_err());
}

fn dependencies<R: TaskRepository>(repo: &mut R) {
    let a = repo.create_task(NewTask::new("A")).unwrap();
    let b = repo.create_task(NewTask::new("B")).unwrap();

    // A depende de B → A bloqueada mientras B esté abierta.
    repo.add_dependency(a.id, b.id).unwrap();
    assert!(repo.is_task_blocked(a.id).unwrap());
    assert!(repo.blocked_tasks().unwrap().iter().any(|t| t.id == a.id));
    assert_eq!(repo.dependencies_of(a.id).unwrap(), vec![b.id]);

    // No se permite depender de sí misma.
    assert!(repo.add_dependency(a.id, a.id).is_err());

    // Completar B desbloquea A.
    repo.complete_task(b.id).unwrap();
    assert!(!repo.is_task_blocked(a.id).unwrap());
    assert!(repo.blocked_tasks().unwrap().is_empty());
}

fn fresh_sqlite() -> SqliteRepository {
    SqliteRepository::open_in_memory().unwrap()
}

#[test]
fn sqlite_crud_and_queries() {
    crud_and_queries(&mut fresh_sqlite());
}
#[test]
fn mock_crud_and_queries() {
    crud_and_queries(&mut MockRepository::new());
}
#[test]
fn sqlite_hierarchy() {
    hierarchy(&mut fresh_sqlite());
}
#[test]
fn mock_hierarchy() {
    hierarchy(&mut MockRepository::new());
}
#[test]
fn sqlite_dependencies() {
    dependencies(&mut fresh_sqlite());
}
#[test]
fn mock_dependencies() {
    dependencies(&mut MockRepository::new());
}

/// El vínculo a repo (ruta, palabra clave, commit base) persiste en el almacén
/// (verifica la migración v2 y el round-trip de las columnas nuevas).
fn repo_link<R: TaskRepository>(repo: &mut R) {
    let t = repo.create_task(NewTask::new("con repo")).unwrap();
    let fresh = repo.get_task(t.id).unwrap();
    assert!(fresh.repo_path.is_none() && fresh.repo_keyword.is_none());

    let mut task = repo.get_task(t.id).unwrap();
    task.repo_path = Some("C:/repos/proyecto".into());
    task.repo_keyword = Some("cierra-login".into());
    task.repo_base_commit = Some("abc123".into());
    repo.update_task(&task).unwrap();

    let got = repo.get_task(t.id).unwrap();
    assert_eq!(got.repo_path.as_deref(), Some("C:/repos/proyecto"));
    assert_eq!(got.repo_keyword.as_deref(), Some("cierra-login"));
    assert_eq!(got.repo_base_commit.as_deref(), Some("abc123"));
}
#[test]
fn sqlite_repo_link() {
    repo_link(&mut fresh_sqlite());
}
#[test]
fn mock_repo_link() {
    repo_link(&mut MockRepository::new());
}

/// `backup_to` (VACUUM INTO) produce una base válida y completa (Fase 7).
#[test]
fn sqlite_backup_roundtrip() {
    let mut repo = fresh_sqlite();
    repo.create_task(NewTask::new("respáldame")).unwrap();
    repo.create_task(NewTask::new("y a mí")).unwrap();

    let dir = std::env::temp_dir().join(format!("tasky_bak_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("backup.db");

    repo.backup_to(&path).unwrap();
    assert!(path.exists());

    // El backup se puede abrir y contiene las mismas tareas.
    let restored = SqliteRepository::open(&path).unwrap();
    assert_eq!(restored.list_tasks().unwrap().len(), 2);

    let _ = std::fs::remove_dir_all(&dir);
}
