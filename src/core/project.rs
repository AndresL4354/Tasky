//! Proyectos: agrupación de tareas.

use serde::{Deserialize, Serialize};

use super::task::ProjectId;

/// Un proyecto tal como se lee del almacén.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Project {
    pub id: ProjectId,
    pub name: String,
    /// Color opcional para la UI (p. ej. `#3B82F6`).
    pub color: Option<String>,
    pub archived: bool,
}

/// Borrador para crear un proyecto. El almacén asigna `id`.
#[derive(Debug, Clone, Default)]
pub struct NewProject {
    pub name: String,
    pub color: Option<String>,
}

impl NewProject {
    pub fn new(name: impl Into<String>) -> Self {
        Self { name: name.into(), color: None }
    }
    pub fn color(mut self, c: impl Into<String>) -> Self {
        self.color = Some(c.into());
        self
    }
}
