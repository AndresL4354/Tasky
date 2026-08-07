//! Dominio puro: tipos y reglas de negocio. Sin I/O ni SQL.

pub mod project;
pub mod quickadd;
pub mod rules;
pub mod tag;
pub mod task;

pub use project::{NewProject, Project};
pub use quickadd::{parse_quick_add, ParsedQuickAdd};
pub use tag::Tag;
pub use task::{
    Freq, NewTask, ProjectId, Quadrant, Recurrence, Status, TagId, Task, TaskId,
};
