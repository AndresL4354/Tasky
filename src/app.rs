//! Fase 2–4 — UI reactiva (egui/eframe, backend glow).
//!
//! Vistas GTD + Eisenhower en barra lateral, captura rápida con parser estilo
//! todo.txt, etiquetas y flujo completo por teclado. La UI no toca SQL: emite
//! `Action`s que se aplican al `TaskRepository` tras dibujar, y relee el modelo.
//!
//! Eficiencia (Propuesta C §5.1): render reactivo. No hay `request_repaint()`
//! por frame; solo uno tras un cambio real. El filtrado de vistas es en memoria
//! (sobre las tareas cacheadas), sin consultas por frame.
//!
//! API de este fork de egui: `App::ui(ui, frame)`, paneles `egui::Panel::*`
//! sobre `&mut Ui`, `Context` vía `ui.ctx()`.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use chrono::{Local, NaiveDate};
use eframe::egui;
use tasky::core::quickadd::parse_quick_add;
use tasky::core::rules::regenerate_recurring;
use tasky::core::{Freq, NewProject, NewTask, Project, Recurrence, Status, Tag, Task};
use tasky::store::{SqliteRepository, TaskRepository};

use crate::config::{self, Config};
use crate::gitlink;
use crate::sync;
use crate::tray::Tray;
use crate::update;

/// Punto de entrada de la UI. Abre la base y arranca el event loop de eframe.
pub fn run() -> eframe::Result {
    let repo = match open_repo() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("tasky: no se pudo abrir la base de datos: {e}");
            std::process::exit(1);
        }
    };

    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([760.0, 640.0])
            .with_min_inner_size([560.0, 420.0])
            .with_title("tasky"),
        ..Default::default()
    };

    eframe::run_native(
        "tasky",
        options,
        Box::new(move |cc| Ok(Box::new(App::new(cc, repo)) as Box<dyn eframe::App>)),
    )
}

/// Ubicación de la base: `%APPDATA%\Tasky\tasky.db`.
fn open_repo() -> tasky::store::Result<SqliteRepository> {
    let dir = config::data_dir();
    let _ = std::fs::create_dir_all(&dir);
    SqliteRepository::open(dir.join("tasky.db"))
}

/// Vistas de la barra lateral (GTD + Eisenhower).
#[derive(Clone, Copy, PartialEq, Eq)]
enum View {
    Inbox,
    Today,
    Upcoming,
    Projects,
    Eisenhower,
    Done,
}

impl View {
    const ALL: [View; 6] = [
        View::Inbox,
        View::Today,
        View::Upcoming,
        View::Projects,
        View::Eisenhower,
        View::Done,
    ];
    fn label(self) -> &'static str {
        match self {
            View::Inbox => "Inbox",
            View::Today => "Hoy",
            View::Upcoming => "Próximas",
            View::Projects => "Proyectos",
            View::Eisenhower => "Eisenhower",
            View::Done => "Completadas",
        }
    }
}

/// Acciones acumuladas durante la pasada de UI; se aplican al almacén después.
enum Action {
    QuickAdd(String),
    Complete(i64),
    Reopen(i64),
    Delete(i64),
    StartEdit(i64, String),
    SaveEdit(i64),
    CancelEdit,
    ToggleUrgent(i64),
    ToggleImportant(i64),
    AddDependency(i64, i64),
    RemoveDependency(i64, i64),
    LinkRepo(i64, String, String),
    UnlinkRepo(i64),
    CheckRepos,
    Sync,
    Pull,
    CheckUpdate,
    CreateProject(String),
}

pub struct App {
    repo: SqliteRepository,
    tasks: Vec<Task>,
    projects: Vec<Project>,
    task_tags: HashMap<i64, Vec<Tag>>,
    /// task_id → ids de las tareas de las que depende.
    deps: HashMap<i64, Vec<i64>>,
    /// Tareas bloqueadas (alguna dependencia sigue abierta).
    blocked: HashSet<i64>,
    view: View,
    selected: Option<i64>,
    new_title: String,
    new_project: String,
    focus_new: bool,
    editing: Option<i64>,
    edit_buf: String,
    focus_edit: bool,
    error: Option<String>,
    /// Buffers de entrada para vincular repo (panel de detalle).
    repo_path_buf: String,
    repo_keyword_buf: String,
    /// Estado del disparador "comprobar al enfocar".
    was_focused: bool,
    did_initial_check: bool,
    last_check_msg: Option<String>,
    config: Config,
    already_quitting: bool,
    /// Buffer del campo "repo de sincronización" (Fase 6).
    sync_repo_buf: String,
    /// Estado de la última sincronización (lo escribe el hilo de git).
    sync_status: Arc<Mutex<String>>,
    /// Icono de bandeja + hotkey (RAII). `None` si no se pudo crear la bandeja.
    tray: Option<Tray>,
}

impl App {
    pub fn new(cc: &eframe::CreationContext<'_>, repo: SqliteRepository) -> Self {
        let config = Config::load();
        config::apply_theme(&cc.egui_ctx, config.dark_mode);
        let sync_repo_buf = config.git_repo_path.clone().unwrap_or_default();
        let mut app = Self {
            repo,
            tasks: Vec::new(),
            projects: Vec::new(),
            task_tags: HashMap::new(),
            deps: HashMap::new(),
            blocked: HashSet::new(),
            view: View::Inbox,
            selected: None,
            new_title: String::new(),
            new_project: String::new(),
            focus_new: false,
            editing: None,
            edit_buf: String::new(),
            focus_edit: false,
            error: None,
            repo_path_buf: String::new(),
            repo_keyword_buf: String::new(),
            was_focused: true,
            did_initial_check: false,
            last_check_msg: None,
            config,
            already_quitting: false,
            sync_repo_buf,
            sync_status: Arc::new(Mutex::new(String::new())),
            tray: Tray::new(cc.egui_ctx.clone()),
        };
        app.reload();
        app
    }

    /// Relee tareas, proyectos y las etiquetas de cada tarea desde el almacén.
    fn reload(&mut self) {
        match self.repo.list_tasks() {
            Ok(t) => self.tasks = t,
            Err(e) => {
                self.error = Some(e.to_string());
                return;
            }
        }
        match self.repo.list_projects(true) {
            Ok(p) => self.projects = p,
            Err(e) => self.error = Some(e.to_string()),
        }
        let ids: Vec<i64> = self.tasks.iter().map(|t| t.id).collect();
        let status_by_id: HashMap<i64, Status> =
            self.tasks.iter().map(|t| (t.id, t.status)).collect();
        self.task_tags.clear();
        self.deps.clear();
        for id in &ids {
            if let Ok(tags) = self.repo.tags_for_task(*id)
                && !tags.is_empty()
            {
                self.task_tags.insert(*id, tags);
            }
            if let Ok(d) = self.repo.dependencies_of(*id)
                && !d.is_empty()
            {
                self.deps.insert(*id, d);
            }
        }
        // Una tarea está bloqueada si alguna de sus dependencias sigue abierta.
        self.blocked = self
            .deps
            .iter()
            .filter(|(_, ds)| {
                ds.iter()
                    .any(|d| status_by_id.get(d).is_some_and(|s| s.is_open()))
            })
            .map(|(id, _)| *id)
            .collect();
    }

    /// Tareas visibles para la vista actual (filtrado y orden en memoria).
    fn visible(&self, today: NaiveDate) -> Vec<Task> {
        let open = |t: &&Task| t.status.is_open();
        let mut v: Vec<Task> = match self.view {
            View::Inbox => self
                .tasks
                .iter()
                .filter(|t| open(t) && t.project_id.is_none())
                .cloned()
                .collect(),
            View::Today => self
                .tasks
                .iter()
                .filter(|t| {
                    open(t)
                        && !self.blocked.contains(&t.id) // bloqueadas no salen en Hoy
                        && (t.due_date.is_some_and(|d| d <= today)
                            || t.scheduled_date == Some(today))
                })
                .cloned()
                .collect(),
            View::Upcoming => self
                .tasks
                .iter()
                .filter(|t| open(t) && t.due_date.is_some_and(|d| d > today))
                .cloned()
                .collect(),
            View::Projects | View::Eisenhower => {
                self.tasks.iter().filter(open).cloned().collect()
            }
            View::Done => self
                .tasks
                .iter()
                .filter(|t| t.status == Status::Done)
                .cloned()
                .collect(),
        };
        match self.view {
            View::Today => v.sort_by(|a, b| {
                a.due_date
                    .is_none()
                    .cmp(&b.due_date.is_none())
                    .then(a.due_date.cmp(&b.due_date))
                    .then(a.position.cmp(&b.position))
                    .then(a.id.cmp(&b.id))
            }),
            View::Upcoming => v.sort_by(|a, b| {
                a.due_date
                    .cmp(&b.due_date)
                    .then(a.position.cmp(&b.position))
                    .then(a.id.cmp(&b.id))
            }),
            View::Projects => v.sort_by(|a, b| {
                a.project_id
                    .cmp(&b.project_id)
                    .then(a.position.cmp(&b.position))
                    .then(a.id.cmp(&b.id))
            }),
            View::Eisenhower => v.sort_by(|a, b| {
                quad_rank(a)
                    .cmp(&quad_rank(b))
                    .then(a.position.cmp(&b.position))
                    .then(a.id.cmp(&b.id))
            }),
            View::Inbox => v.sort_by(|a, b| a.position.cmp(&b.position).then(a.id.cmp(&b.id))),
            // Completadas: las más recientes primero.
            View::Done => v.sort_by(|a, b| b.completed_at.cmp(&a.completed_at).then(b.id.cmp(&a.id))),
        }
        v
    }

    /// Atajos de teclado (solo si no se está escribiendo en un campo de texto).
    fn handle_keys(&mut self, ctx: &egui::Context, visible: &[Task], actions: &mut Vec<Action>) {
        // Cambio de vista con 1-5.
        for (i, key) in [
            egui::Key::Num1,
            egui::Key::Num2,
            egui::Key::Num3,
            egui::Key::Num4,
            egui::Key::Num5,
            egui::Key::Num6,
        ]
        .into_iter()
        .enumerate()
        {
            if ctx.input(|inp| inp.key_pressed(key)) {
                self.view = View::ALL[i];
            }
        }
        if ctx.input(|i| i.key_pressed(egui::Key::N)) {
            self.focus_new = true;
        }

        // Navegación por la lista visible.
        let idx = self.selected.and_then(|s| visible.iter().position(|t| t.id == s));
        if ctx.input(|i| i.key_pressed(egui::Key::ArrowDown) || i.key_pressed(egui::Key::J)) {
            let ni = match idx {
                Some(x) => (x + 1).min(visible.len().saturating_sub(1)),
                None => 0,
            };
            self.selected = visible.get(ni).map(|t| t.id);
        }
        if ctx.input(|i| i.key_pressed(egui::Key::ArrowUp) || i.key_pressed(egui::Key::K)) {
            let ni = idx.map(|x| x.saturating_sub(1)).unwrap_or(0);
            self.selected = visible.get(ni).map(|t| t.id);
        }

        // Acciones sobre la tarea seleccionada.
        if let Some(id) = self.selected {
            let status = visible.iter().find(|t| t.id == id).map(|t| t.status);
            if ctx.input(|i| i.key_pressed(egui::Key::X) || i.key_pressed(egui::Key::Space))
                && let Some(st) = status
            {
                actions.push(if st == Status::Done {
                    Action::Reopen(id)
                } else {
                    Action::Complete(id)
                });
            }
            if ctx.input(|i| i.key_pressed(egui::Key::E) || i.key_pressed(egui::Key::Enter))
                && let Some(t) = visible.iter().find(|t| t.id == id)
            {
                actions.push(Action::StartEdit(id, t.title.clone()));
            }
            if ctx.input(|i| i.key_pressed(egui::Key::Delete)) {
                actions.push(Action::Delete(id));
            }
            if ctx.input(|i| i.key_pressed(egui::Key::U)) {
                actions.push(Action::ToggleUrgent(id));
            }
            if ctx.input(|i| i.key_pressed(egui::Key::I)) {
                actions.push(Action::ToggleImportant(id));
            }
        }
    }

    /// Aplica las acciones al almacén; relee y repinta si algo cambió.
    fn apply(&mut self, actions: Vec<Action>, ctx: &egui::Context, today: NaiveDate) {
        let mut changed = false;
        for a in actions {
            match a {
                Action::QuickAdd(raw) => {
                    self.apply_quick_add(&raw, today);
                    changed = true;
                }
                Action::Complete(id) => {
                    self.complete_and_regenerate(id);
                    changed = true;
                }
                Action::Reopen(id) => {
                    if let Err(e) = self.repo.set_status(id, Status::Todo) {
                        self.error = Some(e.to_string());
                    }
                    changed = true;
                }
                Action::Delete(id) => {
                    if let Err(e) = self.repo.delete_task(id) {
                        self.error = Some(e.to_string());
                    }
                    if self.editing == Some(id) {
                        self.editing = None;
                    }
                    if self.selected == Some(id) {
                        self.selected = None;
                    }
                    changed = true;
                }
                Action::StartEdit(id, title) => {
                    self.editing = Some(id);
                    self.edit_buf = title;
                    self.focus_edit = true;
                    self.selected = Some(id);
                }
                Action::SaveEdit(id) => {
                    let title = self.edit_buf.trim().to_string();
                    if !title.is_empty() {
                        match self.repo.get_task(id) {
                            Ok(mut task) => {
                                task.title = title;
                                if let Err(e) = self.repo.update_task(&task) {
                                    self.error = Some(e.to_string());
                                }
                            }
                            Err(e) => self.error = Some(e.to_string()),
                        }
                    }
                    self.editing = None;
                    self.edit_buf.clear();
                    changed = true;
                }
                Action::CancelEdit => {
                    self.editing = None;
                    self.edit_buf.clear();
                }
                Action::ToggleUrgent(id) => {
                    if let Ok(mut t) = self.repo.get_task(id) {
                        t.urgent = !t.urgent;
                        if let Err(e) = self.repo.update_task(&t) {
                            self.error = Some(e.to_string());
                        }
                    }
                    changed = true;
                }
                Action::ToggleImportant(id) => {
                    if let Ok(mut t) = self.repo.get_task(id) {
                        t.important = !t.important;
                        if let Err(e) = self.repo.update_task(&t) {
                            self.error = Some(e.to_string());
                        }
                    }
                    changed = true;
                }
                Action::AddDependency(task_id, dep) => {
                    if let Err(e) = self.repo.add_dependency(task_id, dep) {
                        self.error = Some(e.to_string());
                    }
                    changed = true;
                }
                Action::RemoveDependency(task_id, dep) => {
                    if let Err(e) = self.repo.remove_dependency(task_id, dep) {
                        self.error = Some(e.to_string());
                    }
                    changed = true;
                }
                Action::LinkRepo(id, path, keyword) => {
                    // Línea base = HEAD actual del repo (si existe): solo un
                    // commit posterior con la palabra clave completará la tarea.
                    let base = gitlink::head_hash(&path);
                    if let Ok(mut t) = self.repo.get_task(id) {
                        t.repo_path = Some(path);
                        t.repo_keyword = Some(keyword);
                        t.repo_base_commit = base;
                        if let Err(e) = self.repo.update_task(&t) {
                            self.error = Some(e.to_string());
                        }
                    }
                    changed = true;
                }
                Action::UnlinkRepo(id) => {
                    if let Ok(mut t) = self.repo.get_task(id) {
                        t.repo_path = None;
                        t.repo_keyword = None;
                        t.repo_base_commit = None;
                        if let Err(e) = self.repo.update_task(&t) {
                            self.error = Some(e.to_string());
                        }
                    }
                    changed = true;
                }
                Action::CheckRepos => {
                    self.check_repos();
                    changed = true;
                }
                Action::Sync => self.start_sync(ctx),
                Action::Pull => self.start_pull(ctx),
                Action::CheckUpdate => self.start_update(ctx),
                Action::CreateProject(name) => {
                    if let Err(e) = self.repo.create_project(NewProject::new(name)) {
                        self.error = Some(e.to_string());
                    }
                    changed = true;
                }
            }
        }
        if changed {
            self.reload();
            ctx.request_repaint();
        }
    }

    fn apply_quick_add(&mut self, raw: &str, today: NaiveDate) {
        let parsed = parse_quick_add(raw, today);
        if parsed.title.is_empty() {
            return;
        }
        let project_id = parsed.project.as_deref().and_then(|n| self.resolve_project(n));
        let mut nt = NewTask::new(parsed.title);
        if let Some(pid) = project_id {
            nt = nt.project(pid);
        }
        // Una tarea recurrente necesita fecha base para regenerarse; si no se
        // indicó una, usa hoy.
        let due = parsed
            .due
            .or_else(|| parsed.recurrence.map(|_| today));
        if let Some(d) = due {
            nt = nt.due(d);
        }
        if let Some(r) = parsed.recurrence {
            nt = nt.recurring(r);
        }
        match self.repo.create_task(nt) {
            Ok(task) => {
                for name in &parsed.tags {
                    if let Ok(tag) = self.repo.create_tag(name) {
                        let _ = self.repo.add_tag(task.id, tag.id);
                    }
                }
                self.selected = Some(task.id);
            }
            Err(e) => self.error = Some(e.to_string()),
        }
    }

    /// Busca un proyecto por nombre (sin distinguir may/min) o lo crea.
    fn resolve_project(&mut self, name: &str) -> Option<i64> {
        if let Some(p) = self.projects.iter().find(|p| p.name.eq_ignore_ascii_case(name)) {
            return Some(p.id);
        }
        match self.repo.create_project(NewProject::new(name)) {
            Ok(p) => {
                let id = p.id;
                self.projects.push(p);
                Some(id)
            }
            Err(e) => {
                self.error = Some(e.to_string());
                None
            }
        }
    }

    /// Completa una tarea y, si es recurrente, crea la siguiente ocurrencia
    /// copiando sus etiquetas.
    fn complete_and_regenerate(&mut self, id: i64) {
        let orig = self.repo.get_task(id).ok();
        if let Err(e) = self.repo.complete_task(id) {
            self.error = Some(e.to_string());
        }
        if let Some(orig) = orig
            && let Some(next) = regenerate_recurring(&orig)
        {
            match self.repo.create_task(next) {
                Ok(newt) => {
                    if let Ok(tags) = self.repo.tags_for_task(id) {
                        for tag in tags {
                            let _ = self.repo.add_tag(newt.id, tag.id);
                        }
                    }
                }
                Err(e) => self.error = Some(e.to_string()),
            }
        }
    }

    /// Lee el último commit de cada tarea abierta vinculada a un repo y la
    /// completa si el commit coincide con su palabra clave (commit nuevo).
    fn check_repos(&mut self) {
        let candidates: Vec<(i64, String, String, Option<String>)> = self
            .tasks
            .iter()
            .filter(|t| t.status.is_open())
            .filter_map(|t| {
                Some((
                    t.id,
                    t.repo_path.clone()?,
                    t.repo_keyword.clone()?,
                    t.repo_base_commit.clone(),
                ))
            })
            .collect();
        let mut completed = 0;
        for (id, path, keyword, base) in candidates {
            // Escanea los commits nuevos (no solo HEAD): detecta la clave
            // aunque después se hayan hecho más commits.
            if gitlink::commits_contain_keyword(&path, &keyword, base.as_deref()) {
                self.complete_and_regenerate(id);
                completed += 1;
            }
        }
        self.last_check_msg = Some(if completed > 0 {
            format!("{completed} tarea(s) completada(s) por commits")
        } else {
            "Sin coincidencias nuevas".to_string()
        });
    }

    /// Al salir (menú "Salir"): guarda la config y hace un backup fechado y
    /// consistente de la base (VACUUM INTO) en `%APPDATA%\Tasky\backups\`.
    fn on_quit(&mut self) {
        self.config.save();
        let dir = config::data_dir().join("backups");
        let _ = std::fs::create_dir_all(&dir);
        let stamp = Local::now().format("%Y%m%d-%H%M%S");
        let path = dir.join(format!("tasky-{stamp}.db"));
        if let Err(e) = self.repo.backup_to(&path) {
            self.error = Some(e.to_string());
        }
    }

    fn set_sync(&self, msg: impl Into<String>) {
        if let Ok(mut g) = self.sync_status.lock() {
            *g = msg.into();
        }
    }

    /// Exporta a Markdown y hace commit + push en un hilo aparte (Fase 6).
    fn start_sync(&mut self, ctx: &egui::Context) {
        let Some(path) = self.config.git_repo_path.clone() else {
            self.set_sync("Configura la ruta del repo en Ajustes");
            return;
        };
        let files = sync::render_markdown(&self.projects, &self.tasks, &self.task_tags);
        if let Err(e) = sync::export_to_dir(std::path::Path::new(&path), &files) {
            self.set_sync(format!("Error export: {e}"));
            return;
        }
        self.set_sync("Sincronizando…");
        let status = self.sync_status.clone();
        let ctx = ctx.clone();
        let msg = format!("tasky sync {}", Local::now().format("%Y-%m-%d %H:%M:%S"));
        std::thread::spawn(move || {
            let result =
                sync::commit_and_push(&path, &msg).unwrap_or_else(|e| format!("Error: {e}"));
            if let Ok(mut g) = status.lock() {
                *g = result;
            }
            ctx.request_repaint();
        });
    }

    /// Trae cambios del remoto (fetch + fast-forward) en un hilo aparte (Fase 6).
    fn start_pull(&mut self, ctx: &egui::Context) {
        let Some(path) = self.config.git_repo_path.clone() else {
            self.set_sync("Configura la ruta del repo en Ajustes");
            return;
        };
        self.set_sync("Trayendo…");
        let status = self.sync_status.clone();
        let ctx = ctx.clone();
        std::thread::spawn(move || {
            let result = sync::pull(&path).unwrap_or_else(|e| format!("Error pull: {e}"));
            if let Ok(mut g) = status.lock() {
                *g = result;
            }
            ctx.request_repaint();
        });
    }

    /// Busca una versión nueva en GitHub Releases y, si la hay, se autoactualiza
    /// (self_update) en un hilo aparte.
    fn start_update(&mut self, ctx: &egui::Context) {
        self.set_sync("Buscando actualizaciones…");
        let status = self.sync_status.clone();
        let ctx = ctx.clone();
        std::thread::spawn(move || {
            let msg = update::check_and_update();
            if let Ok(mut g) = status.lock() {
                *g = msg;
            }
            ctx.request_repaint();
        });
    }
}

impl eframe::App for App {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();

        // Salir (menú de bandeja): respaldar + guardar config + cerrar de verdad.
        let quitting = self.tray.as_ref().is_some_and(|t| t.quit_requested());
        if quitting {
            if !self.already_quitting {
                self.already_quitting = true;
                self.on_quit();
            }
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        }
        // Hide-to-tray: cerrar la ventana la oculta (salvo que estemos saliendo).
        if !quitting && self.tray.is_some() && ctx.input(|i| i.viewport().close_requested()) {
            ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
            ctx.send_viewport_cmd(egui::ViewportCommand::Visible(false));
        }

        let today = Local::now().date_naive();
        let mut actions: Vec<Action> = Vec::new();

        // Comprobar commits al arrancar y cada vez que la ventana recupera el foco.
        let focused = ctx.input(|i| i.viewport().focused).unwrap_or(true);
        if !self.did_initial_check || (focused && !self.was_focused) {
            actions.push(Action::CheckRepos);
            self.did_initial_check = true;
        }
        self.was_focused = focused;

        // Teclas solo si no se está escribiendo en un TextEdit.
        let typing = ctx.memory(|m| m.focused()).is_some();
        let mut visible = self.visible(today);
        if !typing {
            self.handle_keys(&ctx, &visible, &mut actions);
            visible = self.visible(today); // por si cambió la vista
        }
        // Selección válida dentro de lo visible.
        if self.selected.map(|s| !visible.iter().any(|t| t.id == s)).unwrap_or(false) {
            self.selected = None;
        }

        let sync_msg = self.sync_status.lock().map(|g| g.clone()).unwrap_or_default();

        {
            let App {
                tasks,
                projects,
                task_tags,
                deps,
                blocked,
                view,
                selected,
                new_title,
                new_project,
                focus_new,
                editing,
                edit_buf,
                focus_edit,
                error,
                repo_path_buf,
                repo_keyword_buf,
                last_check_msg,
                config,
                sync_repo_buf,
                ..
            } = &mut *self;
            let editing_id = *editing;
            let blocked = &*blocked; // solo lectura durante el render

            // --- Barra superior: título + captura rápida ---
            egui::Panel::top("top").show(ui, |ui| {
                ui.add_space(4.0);
                ui.horizontal(|ui| {
                    ui.heading("tasky");
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        let add = ui.button("Añadir").clicked();
                        let resp = ui.add(
                            egui::TextEdit::singleline(new_title)
                                .hint_text("Nueva… +proyecto @ctx !hoy #tag")
                                .desired_width(f32::INFINITY),
                        );
                        if *focus_new {
                            resp.request_focus();
                            *focus_new = false;
                        }
                        let enter = resp.lost_focus()
                            && ui.ctx().input(|i| i.key_pressed(egui::Key::Enter));
                        if add || enter {
                            let raw = new_title.trim().to_string();
                            if !raw.is_empty() {
                                actions.push(Action::QuickAdd(raw));
                            }
                            new_title.clear();
                            resp.request_focus();
                        }
                    });
                });
                if let Some(e) = error.as_deref() {
                    ui.colored_label(egui::Color32::from_rgb(0xE0, 0x4B, 0x4B), e);
                }
                ui.add_space(2.0);
            });

            // --- Barra inferior: contador + leyenda de teclas ---
            egui::Panel::bottom("status").show(ui, |ui| {
                ui.horizontal_wrapped(|ui| {
                    ui.weak(format!("{} visibles", visible.len()));
                    ui.separator();
                    ui.weak(
                        "1-5 vistas · n nueva · ↑↓/jk mover · x completar · \
                         e editar · u/i urgente/importante · Supr borrar",
                    );
                });
            });

            // --- Barra lateral: vistas + proyectos ---
            egui::Panel::left("sidebar").show(ui, |ui| {
                ui.add_space(4.0);
                ui.strong("Vistas");
                for (i, v) in View::ALL.iter().enumerate() {
                    if ui
                        .selectable_label(*view == *v, format!("{}  {}", i + 1, v.label()))
                        .clicked()
                    {
                        *view = *v;
                    }
                }
                ui.separator();
                ui.strong("Proyectos");
                for p in projects.iter().filter(|p| !p.archived) {
                    ui.weak(&p.name);
                }
                ui.separator();
                if ui.button("Comprobar commits").clicked() {
                    actions.push(Action::CheckRepos);
                }
                if let Some(msg) = last_check_msg.as_deref() {
                    ui.weak(msg);
                }
                ui.separator();
                ui.collapsing("Ajustes", |ui| {
                    if ui.checkbox(&mut config.dark_mode, "Tema oscuro").changed() {
                        config::apply_theme(ui.ctx(), config.dark_mode);
                        config.save();
                    }
                    if ui
                        .checkbox(&mut config.start_with_windows, "Arrancar con Windows")
                        .changed()
                    {
                        let _ = config::set_autostart(config.start_with_windows);
                        config.save();
                    }
                    ui.separator();
                    ui.label("Repo de sincronización (git):");
                    let resp = ui.add(
                        egui::TextEdit::singleline(sync_repo_buf)
                            .hint_text("ruta a un repo git local")
                            .desired_width(f32::INFINITY),
                    );
                    if resp.lost_focus() {
                        let t = sync_repo_buf.trim();
                        config.git_repo_path =
                            if t.is_empty() { None } else { Some(t.to_string()) };
                        config.save();
                    }
                    ui.horizontal(|ui| {
                        if ui.button("Sincronizar").clicked() {
                            actions.push(Action::Sync);
                        }
                        if ui.button("Traer (pull)").clicked() {
                            actions.push(Action::Pull);
                        }
                    });
                    ui.separator();
                    if ui
                        .button(format!("Buscar actualizaciones (v{})", update::CURRENT_VERSION))
                        .clicked()
                    {
                        actions.push(Action::CheckUpdate);
                    }
                    if !sync_msg.is_empty() {
                        ui.weak(&sync_msg);
                    }
                });
            });

            // --- Panel derecho: detalle + dependencias de la selección ---
            if let Some(sel) = *selected
                && tasks.iter().any(|t| t.id == sel)
            {
                egui::Panel::right("detail").show(ui, |ui| {
                    ui.add_space(4.0);
                    ui.strong("Detalle");
                    if let Some(task) = tasks.iter().find(|t| t.id == sel) {
                        ui.label(&task.title);
                        if let Some(r) = &task.recurrence {
                            ui.weak(format!("Recurrencia: {}", recurrence_label(r)));
                        }
                    }
                    if blocked.contains(&sel) {
                        ui.colored_label(
                            egui::Color32::from_rgb(0xE0, 0x7B, 0x39),
                            "Bloqueada: dependencias pendientes",
                        );
                    }
                    ui.separator();
                    ui.strong("Depende de");
                    let my_deps = deps.get(&sel).cloned().unwrap_or_default();
                    if my_deps.is_empty() {
                        ui.weak("(nada)");
                    }
                    for d in &my_deps {
                        ui.horizontal(|ui| {
                            let title = tasks
                                .iter()
                                .find(|t| t.id == *d)
                                .map(|t| t.title.as_str())
                                .unwrap_or("(?)");
                            ui.label(title);
                            if ui.small_button("quitar").clicked() {
                                actions.push(Action::RemoveDependency(sel, *d));
                            }
                        });
                    }
                    ui.separator();
                    ui.strong("Añadir dependencia");
                    egui::ScrollArea::vertical().max_height(160.0).show(ui, |ui| {
                        for cand in tasks.iter().filter(|t| {
                            t.id != sel && t.status.is_open() && !my_deps.contains(&t.id)
                        }) {
                            if ui.small_button(format!("+ {}", cand.title)).clicked() {
                                actions.push(Action::AddDependency(sel, cand.id));
                            }
                        }
                    });

                    ui.separator();
                    ui.strong("Repo git (auto-completar)");
                    if let Some(task) = tasks.iter().find(|t| t.id == sel) {
                        match (task.repo_path.clone(), task.repo_keyword.clone()) {
                            (Some(path), Some(kw)) => {
                                ui.weak(format!("Ruta: {path}"));
                                ui.weak(format!("Clave: {kw}"));
                                if ui.small_button("Desvincular").clicked() {
                                    actions.push(Action::UnlinkRepo(sel));
                                }
                            }
                            _ => {
                                // Botón-campo: al pulsarlo abre el explorador de
                                // carpetas nativo para elegir el repo.
                                let label = if repo_path_buf.trim().is_empty() {
                                    "Elegir carpeta del repo…".to_string()
                                } else {
                                    repo_path_buf.clone()
                                };
                                if ui
                                    .add_sized([ui.available_width(), 22.0], egui::Button::new(label))
                                    .on_hover_text("Abre el explorador para elegir el repo")
                                    .clicked()
                                    && let Some(dir) = rfd::FileDialog::new()
                                        .set_title("Elige el repositorio git local")
                                        .pick_folder()
                                {
                                    *repo_path_buf = dir.display().to_string();
                                }
                                ui.add(
                                    egui::TextEdit::singleline(repo_keyword_buf)
                                        .hint_text("Palabra clave del commit")
                                        .desired_width(f32::INFINITY),
                                );
                                if ui.small_button("Vincular").clicked() {
                                    let p = repo_path_buf.trim().to_string();
                                    let k = repo_keyword_buf.trim().to_string();
                                    if !p.is_empty() && !k.is_empty() {
                                        actions.push(Action::LinkRepo(sel, p, k));
                                        repo_path_buf.clear();
                                        repo_keyword_buf.clear();
                                    }
                                }
                            }
                        }
                    }
                });
            }

            // --- Panel central: la vista actual ---
            egui::CentralPanel::default().show(ui, |ui| {
                egui::ScrollArea::vertical()
                    .auto_shrink([false, false])
                    .show(ui, |ui| match *view {
                        View::Projects => render_projects(
                            ui, projects, &visible, task_tags, blocked, selected, editing_id,
                            edit_buf, focus_edit, new_project, &mut actions,
                        ),
                        View::Eisenhower => render_eisenhower(
                            ui, &visible, task_tags, blocked, selected, editing_id, edit_buf,
                            focus_edit, &mut actions,
                        ),
                        _ => {
                            if visible.is_empty() {
                                ui.add_space(16.0);
                                ui.weak("(vacío) — captura algo arriba o cambia de vista.");
                            }
                            for t in &visible {
                                task_row(
                                    ui,
                                    t,
                                    tags_of(task_tags, t.id),
                                    blocked.contains(&t.id),
                                    selected,
                                    editing_id,
                                    edit_buf,
                                    focus_edit,
                                    &mut actions,
                                );
                            }
                        }
                    });
            });
        }

        self.apply(actions, &ctx, today);
    }
}

fn quad_rank(t: &Task) -> u8 {
    match (t.urgent, t.important) {
        (true, true) => 0,
        (false, true) => 1,
        (true, false) => 2,
        (false, false) => 3,
    }
}

fn tags_of(map: &HashMap<i64, Vec<Tag>>, id: i64) -> &[Tag] {
    map.get(&id).map(|v| v.as_slice()).unwrap_or(&[])
}

/// Etiqueta breve de una recurrencia para mostrar en la fila (ASCII, sin glifos).
fn recurrence_label(r: &Recurrence) -> String {
    let (sing, plur) = match r.freq {
        Freq::Daily => ("día", "días"),
        Freq::Weekly => ("semana", "semanas"),
        Freq::Monthly => ("mes", "meses"),
        Freq::Yearly => ("año", "años"),
    };
    if r.interval <= 1 {
        format!("(cada {sing})")
    } else {
        format!("(cada {} {})", r.interval, plur)
    }
}

/// Dibuja un renglón de tarea. Función libre con parámetros explícitos para
/// evitar conflictos de préstamo con los campos del `App`.
#[allow(clippy::too_many_arguments)]
fn task_row(
    ui: &mut egui::Ui,
    t: &Task,
    tags: &[Tag],
    is_blocked: bool,
    selected: &mut Option<i64>,
    editing: Option<i64>,
    edit_buf: &mut String,
    focus_edit: &mut bool,
    actions: &mut Vec<Action>,
) {
    let is_sel = *selected == Some(t.id);
    ui.horizontal(|ui| {
        ui.label(if is_sel { ">" } else { "  " });

        let mut done = t.status == Status::Done;
        if ui.checkbox(&mut done, "").changed() {
            actions.push(if done {
                Action::Complete(t.id)
            } else {
                Action::Reopen(t.id)
            });
        }

        if editing == Some(t.id) {
            let resp = ui.add(egui::TextEdit::singleline(edit_buf).desired_width(f32::INFINITY));
            if *focus_edit {
                resp.request_focus();
                *focus_edit = false;
            }
            if resp.lost_focus() && ui.ctx().input(|i| i.key_pressed(egui::Key::Enter)) {
                actions.push(Action::SaveEdit(t.id));
            } else if ui.ctx().input(|i| i.key_pressed(egui::Key::Escape)) {
                actions.push(Action::CancelEdit);
            }
        } else {
            let mut rt = egui::RichText::new(&t.title);
            if t.status == Status::Done {
                rt = rt.strikethrough();
            }
            if t.status == Status::Done || is_blocked {
                rt = rt.weak();
            }
            if is_sel {
                rt = rt.strong();
            }
            let resp = ui.add(egui::Label::new(rt).sense(egui::Sense::click()));
            if resp.clicked() {
                *selected = Some(t.id);
            }
            if resp.double_clicked() {
                *selected = Some(t.id);
                actions.push(Action::StartEdit(t.id, t.title.clone()));
            }
            if is_blocked {
                ui.weak("(bloqueada)");
            }
            if t.urgent {
                ui.colored_label(egui::Color32::from_rgb(0xE0, 0x7B, 0x39), "!");
            }
            if t.important {
                ui.colored_label(egui::Color32::from_rgb(0x4B, 0x9C, 0xE0), "*");
            }
            for tag in tags {
                ui.weak(format!("#{}", tag.name));
            }
            if let Some(r) = &t.recurrence {
                ui.weak(recurrence_label(r));
            }
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.small_button("Borrar").clicked() {
                    actions.push(Action::Delete(t.id));
                }
                if ui.small_button("Editar").clicked() {
                    *selected = Some(t.id);
                    actions.push(Action::StartEdit(t.id, t.title.clone()));
                }
            });
        }
    });
}

#[allow(clippy::too_many_arguments)]
fn render_projects(
    ui: &mut egui::Ui,
    projects: &[Project],
    visible: &[Task],
    task_tags: &HashMap<i64, Vec<Tag>>,
    blocked: &HashSet<i64>,
    selected: &mut Option<i64>,
    editing: Option<i64>,
    edit_buf: &mut String,
    focus_edit: &mut bool,
    new_project: &mut String,
    actions: &mut Vec<Action>,
) {
    ui.horizontal(|ui| {
        ui.label("Nuevo proyecto:");
        let resp = ui.add(egui::TextEdit::singleline(new_project).desired_width(180.0));
        let enter = resp.lost_focus() && ui.ctx().input(|i| i.key_pressed(egui::Key::Enter));
        if (ui.button("Crear").clicked() || enter) && !new_project.trim().is_empty() {
            actions.push(Action::CreateProject(new_project.trim().to_string()));
            new_project.clear();
        }
    });
    ui.separator();

    for p in projects.iter().filter(|p| !p.archived) {
        ui.strong(&p.name);
        let mut any = false;
        for t in visible.iter().filter(|t| t.project_id == Some(p.id)) {
            any = true;
            task_row(ui, t, tags_of(task_tags, t.id), blocked.contains(&t.id), selected, editing, edit_buf, focus_edit, actions);
        }
        if !any {
            ui.weak("   (sin tareas)");
        }
        ui.add_space(6.0);
    }

    let mut none_header = false;
    for t in visible.iter().filter(|t| t.project_id.is_none()) {
        if !none_header {
            ui.strong("Sin proyecto (inbox)");
            none_header = true;
        }
        task_row(ui, t, tags_of(task_tags, t.id), blocked.contains(&t.id), selected, editing, edit_buf, focus_edit, actions);
    }
}

#[allow(clippy::too_many_arguments)]
fn render_eisenhower(
    ui: &mut egui::Ui,
    visible: &[Task],
    task_tags: &HashMap<i64, Vec<Tag>>,
    blocked: &HashSet<i64>,
    selected: &mut Option<i64>,
    editing: Option<i64>,
    edit_buf: &mut String,
    focus_edit: &mut bool,
    actions: &mut Vec<Action>,
) {
    // (etiqueta, urgent, important) en orden de cuadrante 2×2.
    let quads = [
        ("Hacer — urgente + importante", true, true),
        ("Programar — importante", false, true),
        ("Delegar — urgente", true, false),
        ("Eliminar — ni urgente ni importante", false, false),
    ];
    for row in 0..2 {
        ui.columns(2, |cols| {
            for col in 0..2 {
                let (label, urgent, important) = quads[row * 2 + col];
                let cui = &mut cols[col];
                cui.group(|ui| {
                    ui.strong(label);
                    let mut any = false;
                    for t in visible
                        .iter()
                        .filter(|t| t.urgent == urgent && t.important == important)
                    {
                        any = true;
                        task_row(
                            ui,
                            t,
                            tags_of(task_tags, t.id),
                            blocked.contains(&t.id),
                            selected,
                            editing,
                            edit_buf,
                            focus_edit,
                            actions,
                        );
                    }
                    if !any {
                        ui.weak("(vacío)");
                    }
                });
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn task(id: i64, title: &str, project: Option<i64>, urgent: bool, important: bool, done: bool) -> Task {
        let now = Utc::now();
        Task {
            id,
            title: title.into(),
            notes: None,
            status: if done { Status::Done } else { Status::Todo },
            urgent,
            important,
            project_id: project,
            parent_id: None,
            due_date: None,
            scheduled_date: None,
            recurrence: None,
            position: 0,
            created_at: now,
            updated_at: now,
            completed_at: None,
            repo_path: None,
            repo_keyword: None,
            repo_base_commit: None,
        }
    }

    /// Renderiza (headless, sin ventana) las tres rutas de dibujo con datos
    /// variados: filas con tags/urgente/importante/hecha/seleccionada, el
    /// agrupado por proyecto y la matriz Eisenhower 2×2. Debe no entrar en
    /// pánico. Cubre `task_row`, `render_projects` y `render_eisenhower`.
    #[test]
    fn views_render_without_panic() {
        let ctx = egui::Context::default();
        // Una tarea en cada cuadrante; con y sin proyecto; una hecha.
        let tasks = vec![
            task(1, "Do", None, true, true, false),
            task(2, "Schedule", Some(1), false, true, false),
            task(3, "Delegate", Some(1), true, false, true),
            task(4, "Eliminate", None, false, false, false),
        ];
        let projects = vec![Project { id: 1, name: "Casa".into(), color: None, archived: false }];
        let mut tags: HashMap<i64, Vec<Tag>> = HashMap::new();
        tags.insert(2, vec![Tag { id: 1, name: "compras".into() }]);
        // La tarea 4 se pinta como bloqueada.
        let blocked: HashSet<i64> = HashSet::from([4]);

        for _ in 0..2 {
            let mut selected = Some(1i64);
            let mut edit_buf = String::new();
            let mut focus_edit = false;
            let mut new_project = String::new();
            let mut actions: Vec<Action> = Vec::new();

            let input = egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(900.0, 700.0),
                )),
                ..Default::default()
            };

            let _ = ctx.run_ui(input, |ui| {
                for t in &tasks {
                    task_row(ui, t, tags_of(&tags, t.id), blocked.contains(&t.id), &mut selected, None, &mut edit_buf, &mut focus_edit, &mut actions);
                }
                render_projects(ui, &projects, &tasks, &tags, &blocked, &mut selected, None, &mut edit_buf, &mut focus_edit, &mut new_project, &mut actions);
                render_eisenhower(ui, &tasks, &tags, &blocked, &mut selected, None, &mut edit_buf, &mut focus_edit, &mut actions);
            });
        }
    }
}
