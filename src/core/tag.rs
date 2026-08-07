//! Etiquetas (tags / contextos GTD).

use serde::{Deserialize, Serialize};

use super::task::TagId;

/// Una etiqueta. El nombre es único en la tabla `tags`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tag {
    pub id: TagId,
    pub name: String,
}
