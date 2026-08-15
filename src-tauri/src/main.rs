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
            settings::list_saved_prompts,
            settings::save_prompt,
            settings::delete_prompt,
            settings::rename_prompt,
            settings::get_prompt_by_id,
            updates::download_update
        ])
        .setup(|app| {
            // Load persisted settings before the window can query them.
            let state = app.state::<AppState>();
            let settings = settings::load(app.handle());
            *state.settings.lock().unwrap() = settings.clone();

            // Hide dock icon unless the user opted in — Bard is a menu-bar app
            // by default, but Settings offers a Dock-icon toggle.
            #[cfg(target_os = "macos")]
            {
                use tauri::ActivationPolicy;
                if settings.show_dock {
                    let _ = app.set_activation_policy(ActivationPolicy::Regular);
                    let _ = app.handle().set_dock_visibility(true);
                } else {
                    let _ = app.set_activation_policy(ActivationPolicy::Accessory);
                    let _ = app.handle().set_dock_visibility(false);
                }
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
