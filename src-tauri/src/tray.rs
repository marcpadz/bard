use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, Emitter, LogicalPosition, Manager,
};

const TRAY_ID: &str = "main-tray";
const WINDOW_WIDTH: f64 = 420.0;

pub fn create_tray(app: &App) -> tauri::Result<()> {
    // Use the same colored app icon in the tray as the app icon.
    let tray_icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))?;

    let show = MenuItem::with_id(app, "show", "Show Bard", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide Bard", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Bard", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &show,
            &hide,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(tray_icon)
        .tooltip("Bard — Prompt Enricher")
        .menu(&menu)
        .icon_as_template(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_window(app),
            "hide" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            "settings" => {
                show_window(app);
                let _ = app.emit("open-settings", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                position,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        // Anchor centered under the clicked tray icon, below the menu bar.
                        let scale = window.scale_factor().unwrap_or(2.0);
                        let click_x = position.x / scale;
                        set_window_pos(&window, click_x);
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

fn show_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        // No click position available (opened via menu) — anchor to the tray
        // icon's rect if readable, else top-right of the primary monitor.
        let scale = window.scale_factor().unwrap_or(2.0);
        let center_x = app
            .tray_by_id(TRAY_ID)
            .and_then(|t| t.rect().ok().flatten())
            .map(|rect| {
                use tauri::{Position, Size};
                let px = match rect.position {
                    Position::Physical(p) => p.x as f64,
                    Position::Logical(p) => p.x * scale,
                };
                let pw = match rect.size {
                    Size::Physical(s) => s.width as f64,
                    Size::Logical(s) => s.width * scale,
                };
                (px + pw / 2.0) / scale
            });
        if let Some(cx) = center_x {
            set_window_pos(&window, cx);
        }
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Center the window horizontally on `center_x` (logical points), just below the menu bar.
fn set_window_pos(window: &tauri::WebviewWindow, center_x: f64) {
    let mut x = center_x - WINDOW_WIDTH / 2.0;

    // Clamp so the window stays fully within the current monitor.
    if let Ok(Some(monitor)) = window.current_monitor() {
        let scale = monitor.scale_factor();
        let screen_w = monitor.size().width as f64 / scale;
        if x < 8.0 {
            x = 8.0;
        }
        if x + WINDOW_WIDTH > screen_w - 8.0 {
            x = screen_w - WINDOW_WIDTH - 8.0;
        }
    }

    // Place just below the menu bar (~25pt tall).
    let y = 27.0;

    let _ = window.set_position(LogicalPosition::new(x, y));
}
