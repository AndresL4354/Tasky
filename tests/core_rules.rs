//! Tests del dominio puro (core/rules.rs): Eisenhower, bloqueo, recurrencia.

use chrono::{NaiveDate, Utc};
use tasky::core::rules::{
    eisenhower, is_blocked, next_occurrence, quadrant_of, regenerate_recurring,
};
use tasky::core::task::{Freq, Quadrant, Recurrence, Status, Task};

fn date(y: i32, m: u32, d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, d).unwrap()
}

fn task_with(recurrence: Option<Recurrence>, due: Option<NaiveDate>) -> Task {
    let now = Utc::now();
    Task {
        id: 1,
        title: "muestra".into(),
        notes: None,
        status: Status::Todo,
        urgent: true,
        important: true,
        project_id: None,
        parent_id: None,
        due_date: due,
        scheduled_date: None,
        recurrence,
        position: 0,
        created_at: now,
        updated_at: now,
        completed_at: None,
        repo_path: None,
        repo_keyword: None,
        repo_base_commit: None,
    }
}

#[test]
fn eisenhower_quadrants() {
    assert_eq!(eisenhower(true, true), Quadrant::Do);
    assert_eq!(eisenhower(false, true), Quadrant::Schedule);
    assert_eq!(eisenhower(true, false), Quadrant::Delegate);
    assert_eq!(eisenhower(false, false), Quadrant::Eliminate);
    assert_eq!(quadrant_of(&task_with(None, None)), Quadrant::Do);
}

#[test]
fn blocking_depends_on_open_prereqs() {
    assert!(!is_blocked(&[])); // sin dependencias → nunca bloqueada
    assert!(!is_blocked(&[Status::Done]));
    assert!(!is_blocked(&[Status::Done, Status::Cancelled]));
    assert!(is_blocked(&[Status::Todo]));
    assert!(is_blocked(&[Status::Done, Status::Doing]));
}

#[test]
fn recurrence_rule_roundtrip() {
    assert_eq!(Recurrence::weekly().to_rule(), "FREQ=WEEKLY");
    assert_eq!(Recurrence::new(Freq::Daily, 2).to_rule(), "FREQ=DAILY;INTERVAL=2");

    assert_eq!(Recurrence::from_rule("FREQ=WEEKLY"), Some(Recurrence::weekly()));
    assert_eq!(
        Recurrence::from_rule("FREQ=DAILY;INTERVAL=3"),
        Some(Recurrence::new(Freq::Daily, 3))
    );
    // claves desconocidas se ignoran (compatibilidad futura)
    assert_eq!(
        Recurrence::from_rule("FREQ=MONTHLY;BYDAY=MO"),
        Some(Recurrence::monthly())
    );
    assert_eq!(Recurrence::from_rule("basura"), None);
}

#[test]
fn next_occurrence_shifts_dates() {
    let r = Recurrence::weekly();
    assert_eq!(next_occurrence(date(2026, 1, 1), r), Some(date(2026, 1, 8)));

    let daily3 = Recurrence::new(Freq::Daily, 3);
    assert_eq!(next_occurrence(date(2026, 1, 1), daily3), Some(date(2026, 1, 4)));

    let monthly = Recurrence::monthly();
    assert_eq!(next_occurrence(date(2026, 1, 15), monthly), Some(date(2026, 2, 15)));

    let yearly = Recurrence::new(Freq::Yearly, 1);
    assert_eq!(next_occurrence(date(2026, 2, 28), yearly), Some(date(2027, 2, 28)));
}

#[test]
fn regenerate_recurring_produces_next_draft() {
    let t = task_with(Some(Recurrence::weekly()), Some(date(2026, 1, 1)));
    let next = regenerate_recurring(&t).expect("debería regenerar");
    assert_eq!(next.due_date, Some(date(2026, 1, 8)));
    assert_eq!(next.status, Status::Todo);
    assert_eq!(next.recurrence, Some(Recurrence::weekly()));
    assert_eq!(next.title, "muestra");

    // sin recurrencia → None
    assert!(regenerate_recurring(&task_with(None, Some(date(2026, 1, 1)))).is_none());
    // recurrente pero sin fechas → None
    assert!(regenerate_recurring(&task_with(Some(Recurrence::weekly()), None)).is_none());
}
