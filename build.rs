//! Fase 8 — en Windows, embebe el icono y los metadatos en el `.exe` (winres).
//! Si el compilador de recursos no está disponible, avisa pero no rompe el
//! build (la app funciona igual, solo sin icono propio).

fn main() {
    #[cfg(windows)]
    {
        let mut res = winres::WindowsResource::new();
        res.set_icon("assets/icon.ico");
        res.set("ProductName", "tasky");
        res.set("FileDescription", "tasky — gestor de tareas de escritorio");
        if let Err(e) = res.compile() {
            println!("cargo:warning=winres no pudo embeber icono/metadatos: {e}");
        }
    }
    println!("cargo:rerun-if-changed=assets/icon.ico");
    println!("cargo:rerun-if-changed=build.rs");
}
