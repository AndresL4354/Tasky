//! Persistencia local en SQLite: esquema, migraciones y operaciones.

use std::collections::BTreeMap;
use std::path::Path;

use rusqlite::{Connection, Row, params};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Status {
    pub id: String,
    pub name: String,
    pub symbol: String,
    pub color: String,
    pub sort_order: i64,
    pub is_done: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub archived: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Task {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub status_id: String,
    pub priority: i64,
    pub due_date: Option<String>,
    pub notes: String,
    pub tags: Vec<String>,
    pub sort_order: f64,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Snapshot {
    pub version: u32,
    #[serde(default)]
    pub exported_at: Option<String>,
    pub statuses: Vec<Status>,
    pub projects: Vec<Project>,
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub settings: BTreeMap<String, String>,
}

/// Cada entrada es una migración; `PRAGMA user_version` guarda cuántas se aplicaron.
const MIGRATIONS: &[&str] = &[r#"
CREATE TABLE statuses (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  color       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL,
  is_done     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL,
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  status_id    TEXT NOT NULL REFERENCES statuses(id),
  priority     INTEGER NOT NULL DEFAULT 1,
  due_date     TEXT,
  notes        TEXT NOT NULL DEFAULT '',
  tags         TEXT NOT NULL DEFAULT '[]',
  sort_order   REAL NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_tasks_project ON tasks(project_id, sort_order);
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO statuses (id, name, symbol, color, sort_order, is_done) VALUES
  ('pendiente', 'pendiente',     '○', 'muted',  0, 0),
  ('proceso',   'en proceso',    '●', 'blue',   1, 0),
  ('bloqueada', 'bloqueada',     '■', 'red',    2, 0),
  ('deploy',    'por desplegar', '◆', 'purple', 3, 0),
  ('lista',     'lista',         '✓', 'green',  4, 1);
"#];

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let mut conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
    migrate(&mut conn)?;
    Ok(conn)
}

#[cfg(test)]
pub fn open_in_memory() -> rusqlite::Result<Connection> {
    let mut conn = Connection::open_in_memory()?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    migrate(&mut conn)?;
    Ok(conn)
}

fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current.max(0) as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.execute_batch(&format!("PRAGMA user_version = {}", i + 1))?;
        tx.commit()?;
    }
    Ok(())
}

fn row_status(r: &Row) -> rusqlite::Result<Status> {
    Ok(Status {
        id: r.get(0)?,
        name: r.get(1)?,
        symbol: r.get(2)?,
        color: r.get(3)?,
        sort_order: r.get(4)?,
        is_done: r.get::<_, i64>(5)? != 0,
    })
}

fn row_project(r: &Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: r.get(0)?,
        name: r.get(1)?,
        sort_order: r.get(2)?,
        archived: r.get::<_, i64>(3)? != 0,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
    })
}

fn row_task(r: &Row) -> rusqlite::Result<Task> {
    let tags_json: String = r.get(7)?;
    Ok(Task {
        id: r.get(0)?,
        project_id: r.get(1)?,
        title: r.get(2)?,
        status_id: r.get(3)?,
        priority: r.get(4)?,
        due_date: r.get(5)?,
        notes: r.get(6)?,
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        sort_order: r.get(8)?,
        created_at: r.get(9)?,
        updated_at: r.get(10)?,
        completed_at: r.get(11)?,
    })
}

pub fn load_all(conn: &Connection) -> rusqlite::Result<Snapshot> {
    let statuses = conn
        .prepare("SELECT id, name, symbol, color, sort_order, is_done FROM statuses ORDER BY sort_order")?
        .query_map([], row_status)?
        .collect::<Result<Vec<_>, _>>()?;
    let projects = conn
        .prepare("SELECT id, name, sort_order, archived, created_at, updated_at FROM projects ORDER BY sort_order")?
        .query_map([], row_project)?
        .collect::<Result<Vec<_>, _>>()?;
    let tasks = conn
        .prepare(
            "SELECT id, project_id, title, status_id, priority, due_date, notes, tags, sort_order,
                    created_at, updated_at, completed_at
             FROM tasks ORDER BY project_id, sort_order",
        )?
        .query_map([], row_task)?
        .collect::<Result<Vec<_>, _>>()?;
    let settings = conn
        .prepare("SELECT key, value FROM settings")?
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    Ok(Snapshot { version: 1, exported_at: None, statuses, projects, tasks, settings })
}

fn upsert_status(conn: &Connection, s: &Status) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO statuses (id, name, symbol, color, sort_order, is_done) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, symbol = excluded.symbol, color = excluded.color,
           sort_order = excluded.sort_order, is_done = excluded.is_done",
        params![s.id, s.name, s.symbol, s.color, s.sort_order, s.is_done as i64],
    )?;
    Ok(())
}

fn upsert_project(conn: &Connection, p: &Project) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO projects (id, name, sort_order, archived, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, sort_order = excluded.sort_order,
           archived = excluded.archived, updated_at = excluded.updated_at",
        params![p.id, p.name, p.sort_order, p.archived as i64, p.created_at, p.updated_at],
    )?;
    Ok(())
}

fn upsert_task(conn: &Connection, t: &Task) -> rusqlite::Result<()> {
    let tags = serde_json::to_string(&t.tags).unwrap_or_else(|_| "[]".into());
    conn.execute(
        "INSERT INTO tasks (id, project_id, title, status_id, priority, due_date, notes, tags, sort_order,
                            created_at, updated_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, title = excluded.title,
           status_id = excluded.status_id, priority = excluded.priority, due_date = excluded.due_date,
           notes = excluded.notes, tags = excluded.tags, sort_order = excluded.sort_order,
           updated_at = excluded.updated_at, completed_at = excluded.completed_at",
        params![
            t.id, t.project_id, t.title, t.status_id, t.priority, t.due_date, t.notes, tags,
            t.sort_order, t.created_at, t.updated_at, t.completed_at
        ],
    )?;
    Ok(())
}

pub fn save_projects(conn: &mut Connection, projects: &[Project]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for p in projects {
        upsert_project(&tx, p)?;
    }
    tx.commit()
}

pub fn delete_project(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn save_tasks(conn: &mut Connection, tasks: &[Task]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for t in tasks {
        upsert_task(&tx, t)?;
    }
    tx.commit()
}

pub fn delete_tasks(conn: &mut Connection, ids: &[String]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for id in ids {
        tx.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
    }
    tx.commit()
}

pub fn save_statuses(conn: &mut Connection, statuses: &[Status]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for s in statuses {
        upsert_status(&tx, s)?;
    }
    tx.commit()
}

/// Borra un estado moviendo antes sus tareas a `replacement`.
pub fn delete_status(conn: &mut Connection, id: &str, replacement: &str, now: &str) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE tasks SET status_id = ?2, updated_at = ?3 WHERE status_id = ?1",
        params![id, replacement, now],
    )?;
    tx.execute("DELETE FROM statuses WHERE id = ?1", params![id])?;
    tx.commit()
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Reemplaza todo el contenido (importar respaldo). Si algo es inconsistente, no cambia nada.
pub fn replace_all(conn: &mut Connection, snap: &Snapshot) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute_batch("DELETE FROM tasks; DELETE FROM projects; DELETE FROM statuses; DELETE FROM settings;")?;
    for s in &snap.statuses {
        upsert_status(&tx, s)?;
    }
    for p in &snap.projects {
        upsert_project(&tx, p)?;
    }
    for t in &snap.tasks {
        upsert_task(&tx, t)?;
    }
    for (k, v) in &snap.settings {
        set_setting(&tx, k, v)?;
    }
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(id: &str) -> Project {
        Project {
            id: id.into(),
            name: id.into(),
            sort_order: 0,
            archived: false,
            created_at: "2026-11-07T00:00:00Z".into(),
            updated_at: "2026-11-07T00:00:00Z".into(),
        }
    }

    fn task(id: &str, project: &str, status: &str) -> Task {
        Task {
            id: id.into(),
            project_id: project.into(),
            title: format!("tarea {id}"),
            status_id: status.into(),
            priority: 2,
            due_date: Some("2026-11-10".into()),
            notes: "nota".into(),
            tags: vec!["#bug".into()],
            sort_order: 1.0,
            created_at: "2026-11-07T00:00:00Z".into(),
            updated_at: "2026-11-07T00:00:00Z".into(),
            completed_at: None,
        }
    }

    #[test]
    fn seeds_default_statuses() {
        let conn = open_in_memory().unwrap();
        let snap = load_all(&conn).unwrap();
        let ids: Vec<_> = snap.statuses.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["pendiente", "proceso", "bloqueada", "deploy", "lista"]);
        assert!(snap.statuses[4].is_done);
    }

    #[test]
    fn round_trips_tasks_and_cascades_project_delete() {
        let mut conn = open_in_memory().unwrap();
        save_projects(&mut conn, &[project("p1")]).unwrap();
        save_tasks(&mut conn, &[task("t1", "p1", "proceso")]).unwrap();
        let snap = load_all(&conn).unwrap();
        assert_eq!(snap.tasks.len(), 1);
        assert_eq!(snap.tasks[0].tags, vec!["#bug".to_string()]);
        assert_eq!(snap.tasks[0].due_date.as_deref(), Some("2026-11-10"));

        delete_project(&conn, "p1").unwrap();
        assert!(load_all(&conn).unwrap().tasks.is_empty());
    }

    #[test]
    fn delete_status_moves_tasks() {
        let mut conn = open_in_memory().unwrap();
        save_projects(&mut conn, &[project("p1")]).unwrap();
        save_tasks(&mut conn, &[task("t1", "p1", "bloqueada")]).unwrap();
        delete_status(&mut conn, "bloqueada", "pendiente", "2026-11-08T00:00:00Z").unwrap();
        let snap = load_all(&conn).unwrap();
        assert_eq!(snap.tasks[0].status_id, "pendiente");
        assert!(snap.statuses.iter().all(|s| s.id != "bloqueada"));
    }

    #[test]
    fn replace_all_is_atomic() {
        let mut conn = open_in_memory().unwrap();
        save_projects(&mut conn, &[project("p1")]).unwrap();
        let mut bad = load_all(&conn).unwrap();
        bad.tasks.push(task("t9", "no-existe", "pendiente"));
        assert!(replace_all(&mut conn, &bad).is_err());
        // Nada cambió tras el error.
        assert_eq!(load_all(&conn).unwrap().projects.len(), 1);
    }
}
