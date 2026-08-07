//! Capa de almacenamiento. Define el contrato [`TaskRepository`] y los errores.
//!
//! La UI y la lógica de aplicación dependen del *trait*, no de una
//! implementación concreta. Eso permite intercambiar SQLite ([`SqliteRepository`])
//! por el mock en memoria ([`MockRepository`]) en los tests.

pub mod migrations;
pub mod mock;
pub mod sqlite;

use chrono::NaiveDate;
use thiserror::Error;

use crate::core::{
    NewProject, NewTask, Project, ProjectId, Status, Tag, TagId, Task, TaskId,
};

pub use mock::MockRepository;
pub use sqlite::SqliteRepository;

/// Errores de la capa de almacenamiento.
#[derive(Debug, Error)]
pub enum StoreError {
    #[error("error de sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("error de migración: {0}")]
    Migration(#[from] rusqlite_migration::Error),
    #[error("no encontrado: {0}")]
    NotFound(String),
    #[error("dato inválido: {0}")]
    Invalid(String),
}

pub type Result<T> = std::result::Result<T, StoreError>;

/// Contrato de persistencia. Convención de mutabilidad: `&mut self` para
/// escrituras, `&self` para lecturas.
pub trait TaskRepository {
    // ---- Proyectos ----
    fn create_project(&mut self, p: NewProject) -> Result<Project>;
    fn get_project(&self, id: ProjectId) -> Result<Project>;
    fn list_projects(&self, include_archived: bool) -> Result<Vec<Project>>;
    fn update_project(&mut self, p: &Project) -> Result<()>;
    fn set_project_archived(&mut self, id: ProjectId, archived: bool) -> Result<()>;
    fn delete_project(&mut self, id: ProjectId) -> Result<()>;

    // ---- Tareas (CRUD) ----
    fn create_task(&mut self, t: NewTask) -> Result<Task>;
    fn get_task(&self, id: TaskId) -> Result<Task>;
    fn update_task(&mut self, t: &Task) -> Result<()>;
    fn delete_task(&mut self, id: TaskId) -> Result<()>;
    fn set_status(&mut self, id: TaskId, status: Status) -> Result<()>;
    fn complete_task(&mut self, id: TaskId) -> Result<()>;

    // ---- Consultas / vistas ----
    fn list_tasks(&self) -> Result<Vec<Task>>;
    fn tasks_by_status(&self, status: Status) -> Result<Vec<Task>>;
    /// Vencen hoy o antes, o están programadas para hoy; solo tareas abiertas.
    fn tasks_today(&self, today: NaiveDate) -> Result<Vec<Task>>;
    /// Con `due_date` futura (posterior a `from`); solo tareas abiertas.
    fn tasks_upcoming(&self, from: NaiveDate) -> Result<Vec<Task>>;
    /// `None` devuelve las tareas sin proyecto (inbox).
    fn tasks_by_project(&self, project_id: Option<ProjectId>) -> Result<Vec<Task>>;
    fn subtasks(&self, parent_id: TaskId) -> Result<Vec<Task>>;
    /// Tareas abiertas con al menos un prerrequisito sin terminar.
    fn blocked_tasks(&self) -> Result<Vec<Task>>;
    fn is_task_blocked(&self, id: TaskId) -> Result<bool>;

    // ---- Etiquetas ----
    /// Idempotente: si el nombre ya existe, devuelve la etiqueta existente.
    fn create_tag(&mut self, name: &str) -> Result<Tag>;
    fn list_tags(&self) -> Result<Vec<Tag>>;
    fn tags_for_task(&self, id: TaskId) -> Result<Vec<Tag>>;
    fn add_tag(&mut self, task_id: TaskId, tag_id: TagId) -> Result<()>;
    fn remove_tag(&mut self, task_id: TaskId, tag_id: TagId) -> Result<()>;

    // ---- Dependencias (task_id depende de depends_on) ----
    fn add_dependency(&mut self, task_id: TaskId, depends_on: TaskId) -> Result<()>;
    fn remove_dependency(&mut self, task_id: TaskId, depends_on: TaskId) -> Result<()>;
    fn dependencies_of(&self, id: TaskId) -> Result<Vec<TaskId>>;
}
