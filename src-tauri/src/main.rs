// Evita la consola extra en Windows en builds de release. NO QUITAR.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tasky_lib::run()
}
