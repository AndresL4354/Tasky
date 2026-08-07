//! Parser de captura rápida estilo todo.txt (Propuesta C §6).
//!
//! `Comprar café +casa @errand !hoy #compras` →
//!   título "Comprar café", proyecto "casa", tags ["errand","compras"], vence hoy.
//!
//! Prefijos de token: `+` proyecto · `@`/`#` tag/contexto · `!` fecha
//! (`hoy`/`mañana`/`YYYY-MM-DD`). El resto forma el título. Función pura y
//! determinista (recibe `today`) → fácil de testear.

use std::collections::HashSet;

use chrono::NaiveDate;

use super::task::{Freq, Recurrence};

/// Resultado de parsear una línea de captura rápida.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ParsedQuickAdd {
    pub title: String,
    pub project: Option<String>,
    pub tags: Vec<String>,
    pub due: Option<NaiveDate>,
    pub recurrence: Option<Recurrence>,
}

/// Parsea una línea de captura rápida usando `today` como referencia para
/// fechas relativas.
pub fn parse_quick_add(input: &str, today: NaiveDate) -> ParsedQuickAdd {
    let mut title_parts: Vec<&str> = Vec::new();
    let mut project = None;
    let mut tags: Vec<String> = Vec::new();
    let mut due = None;
    let mut recurrence = None;

    for tok in input.split_whitespace() {
        if let Some(rest) = tok.strip_prefix('+') {
            if !rest.is_empty() {
                project = Some(rest.to_string());
            }
        } else if let Some(rest) = tok.strip_prefix('@').or_else(|| tok.strip_prefix('#')) {
            if !rest.is_empty() {
                tags.push(rest.to_string());
            }
        } else if let Some(rest) = tok.strip_prefix('!') {
            if let Some(d) = parse_date_token(rest, today) {
                due = Some(d);
            }
            // Token de fecha desconocido → se ignora (no ensucia el título).
        } else if let Some(rest) = tok.strip_prefix('~') {
            if let Some(r) = parse_recurrence_token(rest) {
                recurrence = Some(r);
            }
        } else {
            title_parts.push(tok);
        }
    }

    // Deduplica tags conservando el orden.
    let mut seen = HashSet::new();
    tags.retain(|t| seen.insert(t.clone()));

    ParsedQuickAdd {
        title: title_parts.join(" "),
        project,
        tags,
        due,
        recurrence,
    }
}

/// Parsea el token de recurrencia (`~`): palabras (`daily`/`semanal`/…) o
/// formato compacto `N[dwmy]` (p. ej. `2w` = cada dos semanas).
fn parse_recurrence_token(s: &str) -> Option<Recurrence> {
    let s = s.to_ascii_lowercase();
    match s.as_str() {
        "daily" | "diaria" | "diario" | "d" => return Some(Recurrence::new(Freq::Daily, 1)),
        "weekly" | "semanal" | "w" => return Some(Recurrence::new(Freq::Weekly, 1)),
        "monthly" | "mensual" | "m" => return Some(Recurrence::new(Freq::Monthly, 1)),
        "yearly" | "anual" | "y" => return Some(Recurrence::new(Freq::Yearly, 1)),
        _ => {}
    }
    // Formato compacto: número seguido de unidad, p. ej. "3d", "2w".
    let split = s.find(|c: char| c.is_ascii_alphabetic())?;
    let (num, unit) = s.split_at(split);
    let interval: u32 = num.parse().ok()?;
    let freq = match unit {
        "d" => Freq::Daily,
        "w" => Freq::Weekly,
        "m" => Freq::Monthly,
        "y" => Freq::Yearly,
        _ => return None,
    };
    Some(Recurrence::new(freq, interval))
}

fn parse_date_token(s: &str, today: NaiveDate) -> Option<NaiveDate> {
    match s.to_ascii_lowercase().as_str() {
        "hoy" | "today" => Some(today),
        "manana" | "mañana" | "tomorrow" => today.succ_opt(),
        _ => s.parse::<NaiveDate>().ok(), // ISO 8601 YYYY-MM-DD
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    #[test]
    fn parses_all_markers() {
        let today = date(2026, 8, 6);
        let p = parse_quick_add("Comprar café +casa @errand !hoy #compras", today);
        assert_eq!(p.title, "Comprar café");
        assert_eq!(p.project.as_deref(), Some("casa"));
        assert_eq!(p.tags, vec!["errand".to_string(), "compras".to_string()]);
        assert_eq!(p.due, Some(today));
    }

    #[test]
    fn plain_text_is_all_title() {
        let p = parse_quick_add("solo un título sin marcadores", date(2026, 8, 6));
        assert_eq!(p.title, "solo un título sin marcadores");
        assert!(p.project.is_none() && p.tags.is_empty() && p.due.is_none());
    }

    #[test]
    fn relative_and_iso_dates() {
        let today = date(2026, 8, 6);
        assert_eq!(parse_quick_add("x !mañana", today).due, Some(date(2026, 8, 7)));
        assert_eq!(parse_quick_add("x !2026-12-01", today).due, Some(date(2026, 12, 1)));
        assert_eq!(parse_quick_add("x !basura", today).due, None);
    }

    #[test]
    fn empty_markers_and_dupes_ignored() {
        let p = parse_quick_add("Tarea + @ #tag #tag @tag", date(2026, 8, 6));
        assert_eq!(p.title, "Tarea"); // "+", "@" vacíos se consumen (no ensucian título)
        assert!(p.project.is_none());
        assert_eq!(p.tags, vec!["tag".to_string()]); // deduplicado
    }

    #[test]
    fn parses_recurrence() {
        use crate::core::task::{Freq, Recurrence};
        let today = date(2026, 8, 6);
        assert_eq!(
            parse_quick_add("Regar ~semanal", today).recurrence,
            Some(Recurrence::weekly())
        );
        assert_eq!(parse_quick_add("x ~daily", today).recurrence, Some(Recurrence::daily()));
        assert_eq!(
            parse_quick_add("x ~2w", today).recurrence,
            Some(Recurrence::new(Freq::Weekly, 2))
        );
        assert_eq!(
            parse_quick_add("x ~3d", today).recurrence,
            Some(Recurrence::new(Freq::Daily, 3))
        );
        assert_eq!(parse_quick_add("x ~basura", today).recurrence, None);

        // La recurrencia no ensucia el título ni los demás campos.
        let p = parse_quick_add("Regar plantas +casa ~semanal !hoy", today);
        assert_eq!(p.title, "Regar plantas");
        assert_eq!(p.recurrence, Some(Recurrence::weekly()));
        assert_eq!(p.due, Some(today));
        assert_eq!(p.project.as_deref(), Some("casa"));
    }
}
