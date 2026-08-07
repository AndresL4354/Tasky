//! Binario `tasky`. Desde la Fase 2 arranca la UI reactiva (egui/eframe).
//! El dominio y el almacén viven en la biblioteca (`tasky::core`,
//! `tasky::store`), que se testea sin UI con `cargo test`.

// En Windows, `windows_subsystem = "windows"` evita abrir una consola detrás
// de la ventana en builds release. En debug se mantiene la consola para logs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod config;
mod gitlink;
mod sync;
mod tray;
mod update;

fn main() -> eframe::Result<()> {
    app::run()
}
