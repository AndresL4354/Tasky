mod db;

use std::sync::Mutex;

use db::{Project, Snapshot, Status, Task};
use rusqlite::Connection;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

struct Db(Mutex<Connection>);

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

impl Db {
    fn with<T>(&self, f: impl FnOnce(&mut Connection) -> rusqlite::Result<T>) -> CmdResult<T> {
        let mut conn = self.0.lock().map_err(err)?;
        f(&mut conn).map_err(err)
    }
}

#[tauri::command]
fn load_all(db: State<Db>) -> CmdResult<Snapshot> {
    db.with(|c| db::load_all(c))
}

#[tauri::command]
fn save_projects(db: State<Db>, projects: Vec<Project>) -> CmdResult<()> {
    db.with(|c| db::save_projects(c, &projects))
}

#[tauri::command]
fn delete_project(db: State<Db>, id: String) -> CmdResult<()> {
    db.with(|c| db::delete_project(c, &id))
}

#[tauri::command]
fn save_tasks(db: State<Db>, tasks: Vec<Task>) -> CmdResult<()> {
    db.with(|c| db::save_tasks(c, &tasks))
}

#[tauri::command]
fn delete_tasks(db: State<Db>, ids: Vec<String>) -> CmdResult<()> {
    db.with(|c| db::delete_tasks(c, &ids))
}

#[tauri::command]
fn save_statuses(db: State<Db>, statuses: Vec<Status>) -> CmdResult<()> {
    db.with(|c| db::save_statuses(c, &statuses))
}

#[tauri::command]
fn delete_status(db: State<Db>, id: String, replacement: String, now: String) -> CmdResult<()> {
    db.with(|c| db::delete_status(c, &id, &replacement, &now))
}

#[tauri::command]
fn set_setting(db: State<Db>, key: String, value: String) -> CmdResult<()> {
    db.with(|c| db::set_setting(c, &key, &value))
}

/// Pide dónde guardar y escribe un respaldo JSON. Devuelve la ruta o `None` si se canceló.
#[tauri::command]
async fn export_backup(
    app: AppHandle,
    db: State<'_, Db>,
    file_name: String,
    exported_at: String,
) -> CmdResult<Option<String>> {
    let mut snapshot = db.with(|c| db::load_all(c))?;
    snapshot.exported_at = Some(exported_at);
    let Some(path) = app
        .dialog()
        .file()
        .add_filter("Respaldo de Tasky", &["json"])
        .set_file_name(&file_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = path.into_path().map_err(err)?;
    let json = serde_json::to_string_pretty(&snapshot).map_err(err)?;
    std::fs::write(&path, json).map_err(err)?;
    Ok(Some(path.display().to_string()))
}

/// Pide un archivo de respaldo y reemplaza todos los datos. `None` si se canceló.
#[tauri::command]
async fn import_backup(app: AppHandle, db: State<'_, Db>) -> CmdResult<Option<Snapshot>> {
    let Some(path) = app
        .dialog()
        .file()
        .add_filter("Respaldo de Tasky", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = path.into_path().map_err(err)?;
    let text = std::fs::read_to_string(&path).map_err(err)?;
    let snapshot: Snapshot =
        serde_json::from_str(&text).map_err(|e| format!("El archivo no es un respaldo válido: {e}"))?;
    if snapshot.statuses.is_empty() {
        return Err("El respaldo no tiene estados.".into());
    }
    db.with(|c| {
        db::replace_all(c, &snapshot)?;
        db::load_all(c)
    })
    .map(Some)
}

#[cfg(target_os = "macos")]
fn build_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

    // Menú propio: sin "Cerrar ventana" en ⌘W ni "Deshacer" en ⌘Z,
    // para que esos atajos lleguen a la app (cerrar pestaña / deshacer).
    let app_menu = Submenu::with_items(
        app,
        "Tasky",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("Acerca de Tasky"), None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("Ocultar Tasky"))?,
            &PredefinedMenuItem::hide_others(app, Some("Ocultar otros"))?,
            &PredefinedMenuItem::show_all(app, Some("Mostrar todo"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("Salir de Tasky"))?,
        ],
    )?;
    let edit_menu = Submenu::with_items(
        app,
        "Edición",
        true,
        &[
            &PredefinedMenuItem::cut(app, Some("Cortar"))?,
            &PredefinedMenuItem::copy(app, Some("Copiar"))?,
            &PredefinedMenuItem::paste(app, Some("Pegar"))?,
            &PredefinedMenuItem::select_all(app, Some("Seleccionar todo"))?,
        ],
    )?;
    let window_menu = Submenu::with_items(
        app,
        "Ventana",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("Minimizar"))?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            &PredefinedMenuItem::fullscreen(app, Some("Pantalla completa"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "close-window", "Cerrar ventana", true, Some("CmdOrCtrl+Shift+W"))?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &edit_menu, &window_menu])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("tasky.db"))?;
            app.manage(Db(Mutex::new(conn)));

            #[cfg(target_os = "macos")]
            {
                let menu = build_menu(app.handle())?;
                app.set_menu(menu)?;
                app.on_menu_event(|app, event| {
                    if event.id() == "close-window" {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.close();
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_all,
            save_projects,
            delete_project,
            save_tasks,
            delete_tasks,
            save_statuses,
            delete_status,
            set_setting,
            export_backup,
            import_backup
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar Tasky");
}
