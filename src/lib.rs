//! tasky — biblioteca del núcleo (dominio + almacenamiento).
//!
//! La UI (Fase 2+) y la lógica de aplicación consumirán estos módulos; el
//! binario (`main.rs`) es una cáscara mínima hasta que llegue la UI.
//!
//! Arquitectura en capas (Propuesta C, sección 1):
//! - [`core`]  — dominio puro, sin I/O. Tipos y reglas. Fácil de testear.
//! - [`store`] — persistencia. Contrato [`store::TaskRepository`] con impls
//!   SQLite y mock en memoria.

pub mod core;
pub mod store;
