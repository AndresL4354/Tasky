//! Auto-update in-app desde GitHub Releases (crate `self_update`).
//!
//! Consulta las releases de `AndresL4354/Tasky`, compara con la versión actual
//! (`CARGO_PKG_VERSION`) y, si hay una más nueva, descarga el `.zip` del asset
//! correspondiente al target, extrae `tasky.exe` y reemplaza el binario en
//! ejecución (self-replace de `self_update`). Tras actualizar hay que reiniciar.
//!
//! Es bloqueante (red + descarga) → llamar desde un hilo aparte. Usa `ureq` +
//! `rustls` (TLS puro en Rust, sin OpenSSL) para no romper la portabilidad.

pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Comprueba y, si procede, actualiza. Devuelve un mensaje para la UI.
pub fn check_and_update() -> String {
    match run() {
        Ok(msg) => msg,
        Err(e) => format!("No se pudo actualizar: {e}"),
    }
}

fn run() -> Result<String, Box<dyn std::error::Error>> {
    let status = self_update::backends::github::Update::configure()
        .repo_owner("AndresL4354")
        .repo_name("Tasky")
        .bin_name("tasky")
        .current_version(CURRENT_VERSION)
        .show_download_progress(false)
        .no_confirm(true)
        .build()?
        .update()?;

    Ok(match status {
        self_update::Status::UpToDate(v) => format!("Ya estás en la última versión ({v})"),
        self_update::Status::Updated(v) => {
            format!("Actualizado a {v} — reinicia la app para aplicar")
        }
    })
}
