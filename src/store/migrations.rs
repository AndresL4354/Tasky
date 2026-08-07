//! Esquema versionado con `rusqlite_migration`. Cada versión define `up`/`down`.

use rusqlite_migration::{Migrations, M};

/// Conjunto de migraciones de la base de datos.
/// v1: esquema base (Propuesta C §4). v2: vínculo tarea↔repo git.
pub fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        M::up(V1_UP).down(V1_DOWN),
        M::up(V2_UP).down(V2_DOWN),
    ])
}

const V1_UP: &str = r#"
CREATE TABLE projects (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  color     TEXT,
  archived  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tasks (
  id             INTEGER PRIMARY KEY,
  title          TEXT NOT NULL,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'todo'
                   CHECK (status IN ('todo','doing','done','cancelled')),
  urgent         INTEGER NOT NULL DEFAULT 0,
  important      INTEGER NOT NULL DEFAULT 0,
  project_id     INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  parent_id      INTEGER REFERENCES tasks(id)    ON DELETE CASCADE,
  due_date       TEXT,
  scheduled_date TEXT,
  recurrence     TEXT,
  position       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  completed_at   TEXT
);

CREATE TABLE tags (
  id   INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE task_tags (
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  INTEGER REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE task_deps (
  task_id    INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on)
);

CREATE INDEX idx_tasks_status  ON tasks(status);
CREATE INDEX idx_tasks_due     ON tasks(due_date);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_eisen   ON tasks(urgent, important);
"#;

const V1_DOWN: &str = r#"
DROP INDEX IF EXISTS idx_tasks_eisen;
DROP INDEX IF EXISTS idx_tasks_project;
DROP INDEX IF EXISTS idx_tasks_due;
DROP INDEX IF EXISTS idx_tasks_status;
DROP TABLE IF EXISTS task_deps;
DROP TABLE IF EXISTS task_tags;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS projects;
"#;

// v2 — vínculo tarea ↔ repositorio git local para auto-completar por commit:
//   repo_path        ruta del repo local
//   repo_keyword     palabra clave a buscar en el mensaje del último commit
//   repo_base_commit hash de HEAD al vincular (línea base; solo commits nuevos
//                    cuentan, evita falsos positivos con commits previos)
const V2_UP: &str = r#"
ALTER TABLE tasks ADD COLUMN repo_path        TEXT;
ALTER TABLE tasks ADD COLUMN repo_keyword     TEXT;
ALTER TABLE tasks ADD COLUMN repo_base_commit TEXT;
"#;

const V2_DOWN: &str = r#"
ALTER TABLE tasks DROP COLUMN repo_base_commit;
ALTER TABLE tasks DROP COLUMN repo_keyword;
ALTER TABLE tasks DROP COLUMN repo_path;
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_valid() {
        // rusqlite_migration valida que up/down estén bien formadas.
        assert!(migrations().validate().is_ok());
    }
}
