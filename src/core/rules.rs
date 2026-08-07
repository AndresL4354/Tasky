//! Reglas de dominio puras: Eisenhower, bloqueo por dependencias y recurrencia.
//! Todo aquí es determinista y sin I/O → trivial de testear.

use chrono::{Days, Months, NaiveDate};

use super::task::{Freq, NewTask, Quadrant, Recurrence, Status, Task};

/// Deriva el cuadrante de Eisenhower a partir de los dos ejes.
pub fn eisenhower(urgent: bool, important: bool) -> Quadrant {
    match (urgent, important) {
        (true, true) => Quadrant::Do,
        (false, true) => Quadrant::Schedule,
        (true, false) => Quadrant::Delegate,
        (false, false) => Quadrant::Eliminate,
    }
}

/// Cuadrante de una tarea concreta.
pub fn quadrant_of(task: &Task) -> Quadrant {
    eisenhower(task.urgent, task.important)
}

/// Una tarea está bloqueada si tiene algún prerrequisito sin terminar.
/// `dep_statuses` son los estados de las tareas de las que depende.
/// Una tarea `done` o `cancelled` ya no bloquea.
pub fn is_blocked(dep_statuses: &[Status]) -> bool {
    dep_statuses
        .iter()
        .any(|s| !matches!(s, Status::Done | Status::Cancelled))
}

/// Siguiente fecha de una recurrencia a partir de una fecha base.
/// Devuelve `None` solo ante desbordamiento del calendario.
pub fn next_occurrence(base: NaiveDate, r: Recurrence) -> Option<NaiveDate> {
    let n = r.interval.max(1);
    match r.freq {
        Freq::Daily => base.checked_add_days(Days::new(n as u64)),
        Freq::Weekly => base.checked_add_days(Days::new(7 * n as u64)),
        Freq::Monthly => base.checked_add_months(Months::new(n)),
        Freq::Yearly => base.checked_add_months(Months::new(12 * n)),
    }
}

/// Al completar una tarea recurrente, produce el borrador de la próxima
/// ocurrencia desplazando `due_date` y `scheduled_date`. Devuelve `None` si la
/// tarea no es recurrente o no tiene ninguna fecha desde la que calcular.
pub fn regenerate_recurring(task: &Task) -> Option<NewTask> {
    let r = task.recurrence?;
    let next_due = task.due_date.and_then(|d| next_occurrence(d, r));
    let next_scheduled = task.scheduled_date.and_then(|d| next_occurrence(d, r));
    if next_due.is_none() && next_scheduled.is_none() {
        return None;
    }
    Some(NewTask {
        title: task.title.clone(),
        notes: task.notes.clone(),
        status: Status::Todo,
        urgent: task.urgent,
        important: task.important,
        project_id: task.project_id,
        parent_id: task.parent_id,
        due_date: next_due,
        scheduled_date: next_scheduled,
        recurrence: Some(r),
        position: task.position,
    })
}
