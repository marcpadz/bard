// Prevents an extra console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod openrouter;
mod settings;
mod tray;
mod updates;

use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub settings: Mutex<settings::Settings>,
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .manage(AppState {
            settings: Mutex::new(settings::Settings::default()),
        })
        .invoke_handler(tauri::generate_handler![
            openrouter::verify_api_key,
            openrouter::fetch_free_models,
            settings::get_settings,
            settings::save_settings,
            settings::toggle_dock_icon,
            settings::save_last_prompt,
            settings::exit_app,
            updates::download_update
        ])
        .setup(|app| {
            // Load persisted settings before the window can query them.
            let state = app.state::<AppState>();
            *state.settings.lock().unwrap() = settings::load(app.handle());

            // Hide dock icon — Bard is a menu-bar-only app.
            #[cfg(target_os = "macos")]
            {
                use tauri::ActivationPolicy;
                let _ = app.set_activation_policy(ActivationPolicy::Accessory);
                let _ = app.handle().set_dock_visibility(false);
            }

            tray::create_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Bard");
}
