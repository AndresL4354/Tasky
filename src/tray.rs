//! Fase 3 — bandeja del sistema, hide-to-tray y hotkey global.
//!
//! Modelo de eventos (clave para el idle ~0% CPU con la ventana oculta): el
//! icono de bandeja, su menú y el hotkey global se crean en el hilo principal
//! (donde vive el event loop de winit, que bombea sus mensajes). Sus eventos se
//! reciben en **hilos aparte** que bloquean en `recv()` (0% CPU en reposo) y,
//! al llegar un evento, despiertan la UI reactiva mediante un clon del
//! `egui::Context` (`Arc`, `Send`+`Sync`): `send_viewport_cmd` + `request_repaint`.
//!
//! Así, aunque la ventana esté oculta y eframe en reposo, un clic en la bandeja
//! o el hotkey la vuelven a mostrar.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use eframe::egui;
use global_hotkey::{
    hotkey::{Code, HotKey, Modifiers},
    GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState,
};
use tray_icon::{
    menu::{Menu, MenuEvent, MenuItem},
    Icon, MouseButton, TrayIcon, TrayIconBuilder, TrayIconEvent,
};

/// Guarda RAII: mientras exista, el icono de bandeja y el gestor de hotkeys
/// siguen vivos (si se sueltan, el icono desaparece y el hotkey se libera).
#[allow(dead_code)] // tray/hotkey_mgr se mantienen vivos por su Drop, no se leen
pub struct Tray {
    tray: TrayIcon,
    hotkey_mgr: Option<GlobalHotKeyManager>,
    /// Se pone a `true` cuando el usuario elige "Salir" en el menú; el App lo
    /// consulta para respaldar y cerrar de forma ordenada.
    quit: Arc<AtomicBool>,
}

impl Tray {
    /// ¿El usuario pidió salir desde el menú de bandeja?
    pub fn quit_requested(&self) -> bool {
        self.quit.load(Ordering::SeqCst)
    }
}

impl Tray {
    /// Crea el icono + menú (Mostrar / Salir) y arranca los hilos de eventos.
    /// Devuelve `None` si el sistema no permite crear la bandeja; en ese caso la
    /// app funciona como una ventana normal (cerrar = salir).
    pub fn new(ctx: egui::Context) -> Option<Tray> {
        let show_item = MenuItem::new("Mostrar tasky", true, None);
        let quit_item = MenuItem::new("Salir", true, None);
        let show_id = show_item.id().clone();
        let quit_id = quit_item.id().clone();

        let menu = Menu::new();
        menu.append(&show_item).ok()?;
        menu.append(&quit_item).ok()?;

        let tray = TrayIconBuilder::new()
            .with_tooltip("tasky")
            .with_icon(app_icon())
            .with_menu(Box::new(menu))
            .build()
            .ok()?;

        // Hilo: eventos del icono (clic izquierdo = mostrar la ventana).
        {
            let ctx = ctx.clone();
            std::thread::spawn(move || {
                let rx = TrayIconEvent::receiver();
                while let Ok(ev) = rx.recv() {
                    if let TrayIconEvent::Click { button: MouseButton::Left, .. } = ev {
                        show_window(&ctx);
                    }
                }
            });
        }

        let quit = Arc::new(AtomicBool::new(false));

        // Hilo: eventos del menú (Mostrar / Salir).
        {
            let ctx = ctx.clone();
            let quit = quit.clone();
            std::thread::spawn(move || {
                let rx = MenuEvent::receiver();
                while let Ok(ev) = rx.recv() {
                    if ev.id == quit_id {
                        // Salida ordenada: el App respaldará y cerrará.
                        quit.store(true, Ordering::SeqCst);
                        ctx.request_repaint();
                    } else if ev.id == show_id {
                        show_window(&ctx);
                    }
                }
            });
        }

        let hotkey_mgr = init_hotkey(ctx);

        Some(Tray { tray, hotkey_mgr, quit })
    }
}

/// Pide a eframe mostrar y enfocar la ventana, y despierta el loop reactivo.
fn show_window(ctx: &egui::Context) {
    ctx.send_viewport_cmd(egui::ViewportCommand::Visible(true));
    ctx.send_viewport_cmd(egui::ViewportCommand::Focus);
    ctx.request_repaint();
}

/// Registra el hotkey global de captura rápida (Ctrl+Alt+Espacio). Si falla
/// (p. ej. ya lo usa otra app), la app sigue sin él.
fn init_hotkey(ctx: egui::Context) -> Option<GlobalHotKeyManager> {
    let mgr = GlobalHotKeyManager::new().ok()?;
    let hotkey = HotKey::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
    mgr.register(hotkey).ok()?;

    std::thread::spawn(move || {
        let rx = GlobalHotKeyEvent::receiver();
        while let Ok(ev) = rx.recv() {
            if ev.state == HotKeyState::Pressed {
                show_window(&ctx);
            }
        }
    });
    Some(mgr)
}

/// Icono 32×32 generado en código: cuadrado azul con borde. La Fase 8 embeberá
/// un `.ico` real vía `build.rs`.
fn app_icon() -> Icon {
    const S: u32 = 32;
    let mut rgba = Vec::with_capacity((S * S * 4) as usize);
    for y in 0..S {
        for x in 0..S {
            let border = x < 3 || y < 3 || x >= S - 3 || y >= S - 3;
            let (r, g, b) = if border { (30, 58, 95) } else { (59, 130, 246) };
            rgba.extend_from_slice(&[r, g, b, 255]);
        }
    }
    Icon::from_rgba(rgba, S, S).expect("icono 32x32 válido")
}
