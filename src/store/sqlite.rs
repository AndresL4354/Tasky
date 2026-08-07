//! Implementación de [`TaskRepository`] sobre SQLite (`rusqlite`, feature
//! `bundled`). Todo el SQL vive aquí; el resto del programa no lo toca.

use std::path::Path;

use chrono::{DateTime, NaiveDate, Utc};
use rusqlite::{params, Connection, Row};

use super::migrations;
use super::{Result, StoreError, TaskRepository};
use crate::core::{
    NewProject, NewTask, Project, ProjectId, Recurrence, Status, Tag, TagId, Task, TaskId,
};

pub struct SqliteRepository {
    conn: Connection,
}

impl SqliteRepository {
    /// Abre (o crea) la base en `path`, activa claves foráneas y migra al día.
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        let mut conn = Connection::open(path)?;
        Self::init(&mut conn)?;
        Ok(Self { conn })
    }

    /// Base efímera en memoria, para tests.
    pub fn open_in_memory() -> Result<Self> {
        let mut conn = Connection::open_in_memory()?;
        Self::init(&mut conn)?;
        Ok(Self { conn })
    }

    fn init(conn: &mut Connection) -> Result<()> {
        // Debe fijarse fuera de transacción (antes de migrar); persiste por
        // conexión. Sin esto, las cascadas ON DELETE no se aplican.
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        migrations::migrations().to_latest(conn)?;
        Ok(())
    }

    /// Ejecuta una consulta que devuelve filas de `tasks` (con `SELECT *` o
    /// `SELECT t.*`) y las mapea a [`Task`].
    fn query_tasks<Pr: rusqlite::Params>(&self, sql: &str, p: Pr) -> Result<Vec<Task>> {
        let mut stmt = self.conn.prepare(sql)?;
        let mut rows = stmt.query(p)?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            out.push(row_to_task(row)?);
        }
        Ok(out)
    }
}

// --- Helpers de (de)serialización de columnas ---

fn parse_date(s: &str) -> Result<NaiveDate> {
    s.parse::<NaiveDate>()
        .map_err(|e| StoreError::Invalid(format!("fecha '{s}': {e}")))
}
fn parse_dt(s: &str) -> Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc))
        .map_err(|e| StoreError::Invalid(format!("timestamp '{s}': {e}")))
}
fn date_str(d: NaiveDate) -> String {
    d.to_string() // ISO 8601 (%Y-%m-%d)
}
fn dt_str(d: DateTime<Utc>) -> String {
    d.to_rfc3339()
}

fn row_to_project(row: &Row) -> Result<Project> {
    Ok(Project {
        id: row.get("id")?,
        name: row.get("name")?,
        color: row.get("color")?,
        archived: row.get("archived")?,
    })
}

fn row_to_task(row: &Row) -> Result<Task> {
    let status_s: String = row.get("status")?;
    let status = Status::from_db(&status_s)
        .ok_or_else(|| StoreError::Invalid(format!("estado '{status_s}'")))?;
    let due_s: Option<String> = row.get("due_date")?;
    let sched_s: Option<String> = row.get("scheduled_date")?;
    let rec_s: Option<String> = row.get("recurrence")?;
    let created_s: String = row.get("created_at")?;
    let updated_s: String = row.get("updated_at")?;
    let completed_s: Option<String> = row.get("completed_at")?;
    Ok(Task {
        id: row.get("id")?,
        title: row.get("title")?,
        notes: row.get("notes")?,
        status,
        urgent: row.get("urgent")?,
        important: row.get("important")?,
        project_id: row.get("project_id")?,
        parent_id: row.get("parent_id")?,
        due_date: match due_s {
            Some(s) => Some(parse_date(&s)?),
            None => None,
        },
        scheduled_date: match sched_s {
            Some(s) => Some(parse_date(&s)?),
            None => None,
        },
        recurrence: rec_s.and_then(|s| Recurrence::from_rule(&s)),
        position: row.get("position")?,
        created_at: parse_dt(&created_s)?,
        updated_at: parse_dt(&updated_s)?,
        completed_at: match completed_s {
            Some(s) => Some(parse_dt(&s)?),
            None => None,
        },
        repo_path: row.get("repo_path")?,
        repo_keyword: row.get("repo_keyword")?,
        repo_base_commit: row.get("repo_base_commit")?,
    })
}

impl TaskRepository for SqliteRepository {
    // ---- Proyectos ----
    fn create_project(&mut self, p: NewProject) -> Result<Project> {
        self.conn.execute(
            "INSERT INTO projects (name, color, archived) VALUES (?1, ?2, 0)",
            params![p.name, p.color],
        )?;
        let id = self.conn.last_insert_rowid();
        Ok(Project { id, name: p.name, color: p.color, archived: false })
    }

    fn get_project(&self, id: ProjectId) -> Result<Project> {
        let mut stmt = self.conn.prepare("SELECT * FROM projects WHERE id = ?1")?;
        let mut rows = stmt.query([id])?;
        match rows.next()? {
            Some(row) => row_to_project(row),
            None => Err(StoreError::NotFound(format!("proyecto {id}"))),
        }
    }

    fn list_projects(&self, include_archived: bool) -> Result<Vec<Project>> {
        let sql = if include_archived {
            "SELECT * FROM projects ORDER BY name"
        } else {
            "SELECT * FROM projects WHERE archived = 0 ORDER BY name"
        };
        let mut stmt = self.conn.prepare(sql)?;
        let mut rows = stmt.query([])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            out.push(row_to_project(row)?);
        }
        Ok(out)
    }

    fn update_project(&mut self, p: &Project) -> Result<()> {
        let n = self.conn.execute(
            "UPDATE projects SET name = ?1, color = ?2, archived = ?3 WHERE id = ?4",
            params![p.name, p.color, p.archived, p.id],
        )?;
        if n == 0 {
            return Err(StoreError::NotFound(format!("proyecto {}", p.id)));
        }
        Ok(())
    }

    fn set_project_archived(&mut self, id: ProjectId, archived: bool) -> Result<()> {
        let n = self.conn.execute(
            "UPDATE projects SET archived = ?1 WHERE id = ?2",
            params![archived, id],
        )?;
        if n == 0 {
            return Err(StoreError::NotFound(format!("proyecto {id}")));
        }
        Ok(())
    }

    fn delete_project(&mut self, id: ProjectId) -> Result<()> {
        self.conn.execute("DELETE FROM projects WHERE id = ?1", [id])?;
        Ok(())
    }

    // ---- Tareas CRUD ----
    fn create_task(&mut self, t: NewTask) -> Result<Task> {
        let now = Utc::now();
        self.conn.execute(
            "INSERT INTO tasks
               (title, notes, status, urgent, important, project_id, parent_id,
                due_date, scheduled_date, recurrence, position,
                created_at, updated_at, completed_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,NULL)",
            params![
                t.title,
                t.notes,
                t.status.as_str(),
                t.urgent,
                t.important,
                t.project_id,
                t.parent_id,
                t.due_date.map(date_str),
                t.scheduled_date.map(date_str),
                t.recurrence.map(|r| r.to_rule()),
                t.position,
                dt_str(now),
                dt_str(now),
            ],
        )?;
        let id = self.conn.last_insert_rowid();
        Ok(Task {
            id,
            title: t.title,
            notes: t.notes,
            status: t.status,
            urgent: t.urgent,
            important: t.important,
            project_id: t.project_id,
            parent_id: t.parent_id,
            due_date: t.due_date,
            scheduled_date: t.scheduled_date,
            recurrence: t.recurrence,
            position: t.position,
            created_at: now,
            updated_at: now,
            completed_at: None,
            repo_path: None,
            repo_keyword: None,
            repo_base_commit: None,
        })
    }

    fn get_task(&self, id: TaskId) -> Result<Task> {
        let mut stmt = self.conn.prepare("SELECT * FROM tasks WHERE id = ?1")?;
        let mut rows = stmt.query([id])?;
        match rows.next()? {
            Some(row) => row_to_task(row),
            None => Err(StoreError::NotFound(format!("tarea {id}"))),
        }
    }

    fn update_task(&mut self, t: &Task) -> Result<()> {
        // `created_at` no se toca; `updated_at` lo fija el almacén.
        let now = Utc::now();
        let n = self.conn.execute(
            "UPDATE tasks SET
               title = ?1, notes = ?2, status = ?3, urgent = ?4, important = ?5,
               project_id = ?6, parent_id = ?7, due_date = ?8, scheduled_date = ?9,
               recurrence = ?10, position = ?11, updated_at = ?12, completed_at = ?13,
               repo_path = ?14, repo_keyword = ?15, repo_base_commit = ?16
             WHERE id = ?17",
            params![
                t.title,
                t.notes,
                t.status.as_str(),
                t.urgent,
                t.important,
                t.project_id,
                t.parent_id,
                t.due_date.map(date_str),
                t.scheduled_date.map(date_str),
                t.recurrence.map(|r| r.to_rule()),
                t.position,
                dt_str(now),
                t.completed_at.map(dt_str),
                t.repo_path.as_deref(),
                t.repo_keyword.as_deref(),
                t.repo_base_commit.as_deref(),
                t.id,
            ],
        )?;
        if n == 0 {
            return Err(StoreError::NotFound(format!("tarea {}", t.id)));
        }
        Ok(())
    }

    fn delete_task(&mut self, id: TaskId) -> Result<()> {
        self.conn.execute("DELETE FROM tasks WHERE id = ?1", [id])?;
        Ok(())
    }

    fn set_status(&mut self, id: TaskId, status: Status) -> Result<()> {
        let now = Utc::now();
        let completed = if status == Status::Done { Some(dt_str(now)) } else { None };
        let n = self.conn.execute(
            "UPDATE tasks SET status = ?1, completed_at = ?2, updated_at = ?3 WHERE id = ?4",
            params![status.as_str(), completed, dt_str(now), id],
        )?;
        if n == 0 {
            return Err(StoreError::NotFound(format!("tarea {id}")));
        }
        Ok(())
    }

    fn complete_task(&mut self, id: TaskId) -> Result<()> {
        self.set_status(id, Status::Done)
    }

    // ---- Consultas ----
    fn list_tasks(&self) -> Result<Vec<Task>> {
        self.query_tasks("SELECT * FROM tasks ORDER BY position, id", [])
    }

    fn tasks_by_status(&self, status: Status) -> Result<Vec<Task>> {
        self.query_tasks(
            "SELECT * FROM tasks WHERE status = ?1 ORDER BY position, id",
            [status.as_str()],
        )
    }

    fn tasks_today(&self, today: NaiveDate) -> Result<Vec<Task>> {
        // Las fechas son texto ISO → el orden lexicográfico es cronológico.
        self.query_tasks(
            "SELECT * FROM tasks
             WHERE status IN ('todo','doing')
               AND ((due_date IS NOT NULL AND due_date <= ?1)
                    OR (scheduled_date IS NOT NULL AND scheduled_date = ?1))
             ORDER BY (due_date IS NULL), due_date, position, id",
            [date_str(today)],
        )
    }

    fn tasks_upcoming(&self, from: NaiveDate) -> Result<Vec<Task>> {
        self.query_tasks(
            "SELECT * FROM tasks
             WHERE status IN ('todo','doing') AND due_date IS NOT NULL AND due_date > ?1
             ORDER BY due_date, position, id",
            [date_str(from)],
        )
    }

    fn tasks_by_project(&self, project_id: Option<ProjectId>) -> Result<Vec<Task>> {
        match project_id {
            Some(pid) => self.query_tasks(
                "SELECT * FROM tasks WHERE project_id = ?1 ORDER BY position, id",
                [pid],
            ),
            None => self.query_tasks(
                "SELECT * FROM tasks WHERE project_id IS NULL ORDER BY position, id",
                [],
            ),
        }
    }

    fn subtasks(&self, parent_id: TaskId) -> Result<Vec<Task>> {
        self.query_tasks(
            "SELECT * FROM tasks WHERE parent_id = ?1 ORDER BY position, id",
            [parent_id],
        )
    }

    fn blocked_tasks(&self) -> Result<Vec<Task>> {
        self.query_tasks(
            "SELECT DISTINCT t.* FROM tasks t
             JOIN task_deps d ON d.task_id = t.id
             JOIN tasks dep  ON dep.id = d.depends_on
             WHERE t.status IN ('todo','doing')
               AND dep.status NOT IN ('done','cancelled')
             ORDER BY t.position, t.id",
            [],
        )
    }

    fn is_task_blocked(&self, id: TaskId) -> Result<bool> {
        let blocked: bool = self.conn.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM task_deps d
               JOIN tasks dep ON dep.id = d.depends_on
               WHERE d.task_id = ?1 AND dep.status NOT IN ('done','cancelled'))",
            [id],
            |r| r.get(0),
        )?;
        Ok(blocked)
    }

    // ---- Etiquetas ----
    fn create_tag(&mut self, name: &str) -> Result<Tag> {
        self.conn.execute(
            "INSERT INTO tags (name) VALUES (?1) ON CONFLICT(name) DO NOTHING",
            [name],
        )?;
        let id: TagId =
            self.conn
                .query_row("SELECT id FROM tags WHERE name = ?1", [name], |r| r.get(0))?;
        Ok(Tag { id, name: name.to_string() })
    }

    fn list_tags(&self) -> Result<Vec<Tag>> {
        let mut stmt = self.conn.prepare("SELECT id, name FROM tags ORDER BY name")?;
        let mut rows = stmt.query([])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            out.push(Tag { id: row.get(0)?, name: row.get(1)? });
        }
        Ok(out)
    }

    fn tags_for_task(&self, id: TaskId) -> Result<Vec<Tag>> {
        let mut stmt = self.conn.prepare(
            "SELECT tg.id, tg.name FROM tags tg
             JOIN task_tags tt ON tt.tag_id = tg.id
             WHERE tt.task_id = ?1 ORDER BY tg.name",
        )?;
        let mut rows = stmt.query([id])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            out.push(Tag { id: row.get(0)?, name: row.get(1)? });
        }
        Ok(out)
    }

    fn add_tag(&mut self, task_id: TaskId, tag_id: TagId) -> Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?1, ?2)",
            params![task_id, tag_id],
        )?;
        Ok(())
    }

    fn remove_tag(&mut self, task_id: TaskId, tag_id: TagId) -> Result<()> {
        self.conn.execute(
            "DELETE FROM task_tags WHERE task_id = ?1 AND tag_id = ?2",
            params![task_id, tag_id],
        )?;
        Ok(())
    }

    // ---- Dependencias ----
    fn add_dependency(&mut self, task_id: TaskId, depends_on: TaskId) -> Result<()> {
        if task_id == depends_on {
            return Err(StoreError::Invalid(
                "una tarea no puede depender de sí misma".into(),
            ));
        }
        self.conn.execute(
            "INSERT OR IGNORE INTO task_deps (task_id, depends_on) VALUES (?1, ?2)",
            params![task_id, depends_on],
        )?;
        Ok(())
    }

    fn remove_dependency(&mut self, task_id: TaskId, depends_on: TaskId) -> Result<()> {
        self.conn.execute(
            "DELETE FROM task_deps WHERE task_id = ?1 AND depends_on = ?2",
            params![task_id, depends_on],
        )?;
        Ok(())
    }

    fn dependencies_of(&self, id: TaskId) -> Result<Vec<TaskId>> {
        let mut stmt = self
            .conn
            .prepare("SELECT depends_on FROM task_deps WHERE task_id = ?1 ORDER BY depends_on")?;
        let mut rows = stmt.query([id])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            out.push(row.get(0)?);
        }
        Ok(out)
    }
}
