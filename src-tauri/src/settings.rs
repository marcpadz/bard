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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedPrompt {
    pub id: String,
    pub title: String,
    pub text: String,
    pub created_at: u64,
}

fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    dir.join("settings.json")
}

fn saved_prompts_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    dir.join("saved_prompts.json")
}

fn load_saved_prompts(app: &tauri::AppHandle) -> Vec<SavedPrompt> {
    fs::read_to_string(saved_prompts_path(app))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_saved_prompts(app: &tauri::AppHandle, prompts: &[SavedPrompt]) -> Result<(), String> {
    let path = saved_prompts_path(app);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&path, serde_json::to_string_pretty(prompts).unwrap()).map_err(|e| e.to_string())
}

fn prompt_title(text: &str, index: usize) -> String {
    let first = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
    let mut t = first.trim().chars().take(48).collect::<String>();
    if first.trim().chars().count() > 48 {
        t.push('…');
    }
    if t.is_empty() {
        t = format!("Prompt {}", index + 1);
    }
    t
}

#[tauri::command]
pub fn list_saved_prompts(app: tauri::AppHandle) -> Result<Vec<SavedPrompt>, String> {
    let mut prompts = load_saved_prompts(&app);
    prompts.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(prompts)
}

#[tauri::command]
pub fn save_prompt(app: tauri::AppHandle, title: Option<String>, text: String) -> Result<SavedPrompt, String> {
    let mut prompts = load_saved_prompts(&app);
    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let id = format!("{created_at}-{}", prompts.len());
    let prompt = SavedPrompt {
        title: title.unwrap_or_else(|| prompt_title(&text, prompts.len())),
        text,
        created_at,
        id,
    };
    prompts.push(prompt.clone());
    write_saved_prompts(&app, &prompts)?;
    Ok(prompt)
}

#[tauri::command]
pub fn delete_prompt(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let prompts = load_saved_prompts(&app);
    let remaining: Vec<SavedPrompt> = prompts.into_iter().filter(|p| p.id != id).collect();
    write_saved_prompts(&app, &remaining)
}

#[tauri::command]
pub fn get_prompt_by_id(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let prompts = load_saved_prompts(&app);
    prompts
        .into_iter()
        .find(|p| p.id == id)
        .map(|p| p.text)
        .ok_or_else(|| "Saved prompt not found".into())
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

