use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub api_key: String,
    pub model: String,
    pub launch_at_login: bool,
    pub last_prompt: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            model: String::new(),
            launch_at_login: false,
            last_prompt: String::new(),
        }
    }
}

fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    dir.join("settings.json")
}

pub fn load(app: &tauri::AppHandle) -> Settings {
    let path = settings_path(app);
    fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> Settings {
    let state = app.state::<crate::AppState>();
    let guard = state.settings.lock().unwrap();
    guard.clone()
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    let path = settings_path(&app);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&path, serde_json::to_string_pretty(&settings).unwrap()).map_err(|e| e.to_string())?;
    let state = app.state::<crate::AppState>();
    *state.settings.lock().unwrap() = settings.clone();
    Ok(())
}

#[tauri::command]
pub fn toggle_dock_icon(app: tauri::AppHandle, show: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use tauri::ActivationPolicy;
        let policy = if show {
            ActivationPolicy::Regular
        } else {
            ActivationPolicy::Accessory
        };
        app.set_activation_policy(policy).map_err(|e| e.to_string())?;
        app.set_dock_visibility(show).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn save_last_prompt(app: tauri::AppHandle, prompt: String) -> Result<(), String> {
    let mut settings = {
        let state = app.state::<crate::AppState>();
        let guard = state.settings.lock().unwrap();
        guard.clone()
    };
    settings.last_prompt = prompt;
    save_settings(app, settings)
}

#[tauri::command]
pub fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}
