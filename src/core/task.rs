//! Tipos de dominio para tareas. Puro: sin I/O ni SQL.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

/// Identificadores. Alias sobre `i64` (rowid de SQLite).
pub type TaskId = i64;
pub type ProjectId = i64;
pub type TagId = i64;

/// Estado del ciclo de vida de una tarea. Mapea 1:1 con la columna `status`
/// (y su CHECK) del esquema SQLite.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    #[default]
    Todo,
    Doing,
    Done,
    Cancelled,
}

impl Status {
    /// Representación en base de datos (coincide con el CHECK del esquema).
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Todo => "todo",
            Status::Doing => "doing",
            Status::Done => "done",
            Status::Cancelled => "cancelled",
        }
    }

    /// Parseo desde la base de datos.
    pub fn from_db(s: &str) -> Option<Self> {
        match s {
            "todo" => Some(Status::Todo),
            "doing" => Some(Status::Doing),
            "done" => Some(Status::Done),
            "cancelled" => Some(Status::Cancelled),
            _ => None,
        }
    }

    /// ¿Está "viva" (pendiente o en curso)? Útil para filtros de vistas.
    pub fn is_open(self) -> bool {
        matches!(self, Status::Todo | Status::Doing)
    }
}

/// Cuadrante de la matriz de Eisenhower (derivado de `urgent` × `important`).
/// La lógica de derivación vive en [`crate::core::rules`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Quadrant {
    /// Urgente e importante → Hacer ya.
    Do,
    /// Importante, no urgente → Programar.
    Schedule,
    /// Urgente, no importante → Delegar.
    Delegate,
    /// Ni urgente ni importante → Eliminar.
    Eliminate,
}

/// Frecuencia base de una regla de recurrencia.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Freq {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

impl Freq {
    fn as_rule(self) -> &'static str {
        match self {
            Freq::Daily => "DAILY",
            Freq::Weekly => "WEEKLY",
            Freq::Monthly => "MONTHLY",
            Freq::Yearly => "YEARLY",
        }
    }

    fn from_rule(s: &str) -> Option<Self> {
        match s.to_ascii_uppercase().as_str() {
            "DAILY" => Some(Freq::Daily),
            "WEEKLY" => Some(Freq::Weekly),
            "MONTHLY" => Some(Freq::Monthly),
            "YEARLY" => Some(Freq::Yearly),
            _ => None,
        }
    }
}

/// Regla de recurrencia mínima, subconjunto de RRULE (iCal). Se serializa a
/// texto compacto en la columna `recurrence`: `FREQ=WEEKLY` o
/// `FREQ=DAILY;INTERVAL=2`. Ampliable en el futuro (p. ej. `BYDAY`) sin romper
/// el almacenamiento: claves desconocidas se ignoran al parsear.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Recurrence {
    pub freq: Freq,
    /// Cada cuántas unidades de `freq`. Siempre >= 1.
    pub interval: u32,
}

impl Recurrence {
    pub fn new(freq: Freq, interval: u32) -> Self {
        Self { freq, interval: interval.max(1) }
    }
    pub fn daily() -> Self {
        Self::new(Freq::Daily, 1)
    }
    pub fn weekly() -> Self {
        Self::new(Freq::Weekly, 1)
    }
    pub fn monthly() -> Self {
        Self::new(Freq::Monthly, 1)
    }

    /// Serializa a la cadena que se guarda en la columna `recurrence`.
    pub fn to_rule(self) -> String {
        if self.interval <= 1 {
            format!("FREQ={}", self.freq.as_rule())
        } else {
            format!("FREQ={};INTERVAL={}", self.freq.as_rule(), self.interval)
        }
    }

    /// Parsea desde la columna `recurrence`. Devuelve `None` si es inválida.
    pub fn from_rule(s: &str) -> Option<Self> {
        let mut freq = None;
        let mut interval = 1u32;
        for part in s.split(';') {
            let part = part.trim();
            if part.is_empty() {
                continue;
            }
            let (k, v) = part.split_once('=')?;
            match k.trim().to_ascii_uppercase().as_str() {
                "FREQ" => freq = Freq::from_rule(v.trim()),
                "INTERVAL" => interval = v.trim().parse().ok()?,
                _ => {} // ignora claves desconocidas (compatibilidad futura)
            }
        }
        Some(Self::new(freq?, interval))
    }
}

/// Una tarea completa tal como se lee del almacén.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Task {
    pub id: TaskId,
    pub title: String,
    pub notes: Option<String>,
    pub status: Status,
    pub urgent: bool,
    pub important: bool,
    pub project_id: Option<ProjectId>,
    pub parent_id: Option<TaskId>,
    pub due_date: Option<NaiveDate>,
    pub scheduled_date: Option<NaiveDate>,
    pub recurrence: Option<Recurrence>,
    pub position: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    /// Ruta del repositorio git local vinculado (auto-completar por commit).
    pub repo_path: Option<String>,
    /// Palabra clave a buscar en el mensaje del último commit.
    pub repo_keyword: Option<String>,
    /// Hash de HEAD al vincular; solo un commit posterior distinto cuenta.
    pub repo_base_commit: Option<String>,
}

/// Borrador para crear una tarea. El almacén asigna `id` y los timestamps.
/// Construcción encadenable para tests y quick-add:
/// `NewTask::new("Comprar café").urgent(true).due(hoy)`.
#[derive(Debug, Clone, Default)]
pub struct NewTask {
    pub title: String,
    pub notes: Option<String>,
    pub status: Status,
    pub urgent: bool,
    pub important: bool,
    pub project_id: Option<ProjectId>,
    pub parent_id: Option<TaskId>,
    pub due_date: Option<NaiveDate>,
    pub scheduled_date: Option<NaiveDate>,
    pub recurrence: Option<Recurrence>,
    pub position: i64,
}

impl NewTask {
    pub fn new(title: impl Into<String>) -> Self {
        Self { title: title.into(), ..Default::default() }
    }
    pub fn notes(mut self, n: impl Into<String>) -> Self {
        self.notes = Some(n.into());
        self
    }
    pub fn status(mut self, s: Status) -> Self {
        self.status = s;
        self
    }
    pub fn project(mut self, id: ProjectId) -> Self {
        self.project_id = Some(id);
        self
    }
    pub fn parent(mut self, id: TaskId) -> Self {
        self.parent_id = Some(id);
        self
    }
    pub fn urgent(mut self, v: bool) -> Self {
        self.urgent = v;
        self
    }
    pub fn important(mut self, v: bool) -> Self {
        self.important = v;
        self
    }
    pub fn due(mut self, d: NaiveDate) -> Self {
        self.due_date = Some(d);
        self
    }
    pub fn scheduled(mut self, d: NaiveDate) -> Self {
        self.scheduled_date = Some(d);
        self
    }
    pub fn recurring(mut self, r: Recurrence) -> Self {
        self.recurrence = Some(r);
        self
    }
    pub fn position(mut self, p: i64) -> Self {
        self.position = p;
        self
    }
}
