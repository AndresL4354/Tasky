//! Fase 7 — configuración persistente, tema y arranque con Windows.
//!
//! La config vive en `%APPDATA%\Tasky\config.toml`. Se mantiene la ruta base
//! `%APPDATA%\Tasky` (misma que `tasky.db`) en vez de mover todo a `directories`
//! para no dejar huérfana la base existente.

use std::path::PathBuf;

use eframe::egui;
use serde::{Deserialize, Serialize};

/// Carpeta de datos de la app: `%APPDATA%\Tasky` (fallback: directorio actual).
pub fn data_dir() -> PathBuf {
    match std::env::var_os("APPDATA") {
        Some(appdata) => PathBuf::from(appdata).join("Tasky"),
        None => PathBuf::from("."),
    }
}

/// Ruta del `config.toml`.
pub fn config_path() -> PathBuf {
    data_dir().join("config.toml")
}

/// Preferencias del usuario persistidas.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub dark_mode: bool,
    pub start_with_windows: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self { dark_mode: true, start_with_windows: false }
    }
}

impl Config {
    /// Carga la config; si no existe o está corrupta, usa valores por defecto.
    pub fn load() -> Self {
        std::fs::read_to_string(config_path())
            .ok()
            .and_then(|s| toml::from_str(&s).ok())
            .unwrap_or_default()
    }

    /// Guarda la config (crea la carpeta si hace falta). Silencioso ante error.
    pub fn save(&self) {
        let _ = std::fs::create_dir_all(data_dir());
        if let Ok(s) = toml::to_string_pretty(self) {
            let _ = std::fs::write(config_path(), s);
        }
    }
}

/// Aplica el tema (claro/oscuro) al contexto de egui.
pub fn apply_theme(ctx: &egui::Context, dark_mode: bool) {
    ctx.set_visuals(if dark_mode {
        egui::Visuals::dark()
    } else {
        egui::Visuals::light()
    });
}

/// Activa/desactiva el arranque con Windows (entrada en `HKCU\...\Run`). Solo se
/// invoca cuando el usuario cambia el ajuste, nunca automáticamente.
#[cfg(windows)]
pub fn set_autostart(enabled: bool) -> std::io::Result<()> {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (run, _) = hkcu.create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run")?;
    if enabled {
        let exe = std::env::current_exe()?.to_string_lossy().into_owned();
        run.set_value("Tasky", &exe)?;
    } else {
        let _ = run.delete_value("Tasky"); // ignora si no existe
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn set_autostart(_enabled: bool) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_toml_roundtrip() {
        let c = Config { dark_mode: false, start_with_windows: true };
        let s = toml::to_string_pretty(&c).unwrap();
        let back: Config = toml::from_str(&s).unwrap();
        assert!(!back.dark_mode);
        assert!(back.start_with_windows);
    }

    #[test]
    fn config_defaults_for_empty_or_partial() {
        // TOML vacío → todos los defaults.
        let c: Config = toml::from_str("").unwrap();
        assert!(c.dark_mode);
        assert!(!c.start_with_windows);
        // Parcial → el campo ausente toma su default (#[serde(default)]).
        let c2: Config = toml::from_str("dark_mode = false").unwrap();
        assert!(!c2.dark_mode);
        assert!(!c2.start_with_windows);
    }
}
