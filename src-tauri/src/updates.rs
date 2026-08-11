use std::fs;
use std::io::{Read, Write};
use tauri::{Emitter, Manager};

/// Download a release DMG from GitHub into ~/Downloads and open it, so the
/// user can drag it into Applications. Runs on a background thread so the
/// main thread (and the webview) never blocks.
#[tauri::command]
pub fn download_update(app: tauri::AppHandle, url: String, version: String) -> Result<(), String> {
    std::thread::spawn(move || {
        let result = download_dmg(&app, &url, &version);
        if let Err(e) = result {
            let _ = app.emit("update-download-failed", e);
        }
    });
    Ok(())
}

fn download_dmg(app: &tauri::AppHandle, url: &str, version: &str) -> Result<(), String> {
    let downloads = app
        .path()
        .download_dir()
        .map_err(|e| e.to_string())?;
    let dest = downloads.join(format!("Bard_{version}_aarch64.dmg"));

    let client = reqwest::blocking::Client::new();
    let resp = client
        .get(url)
        .header("Accept", "application/octet-stream")
        .send()
        .map_err(|e| format!("Download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Download failed: HTTP {}", resp.status().as_u16()));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut file = fs::File::create(&dest).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut reader = resp;
    let mut buf = [0u8; 65536];
    loop {
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        downloaded += n as u64;
        if total > 0 {
            let _ = app.emit(
                "update-download-progress",
                (downloaded as f64 / total as f64) * 100.0,
            );
        }
    }
    file.sync_all().map_err(|e| e.to_string())?;

    // Open the DMG so the user can install it.
    let dest_str = dest.display().to_string();
    let dest_for_open = dest_str.clone();
    std::thread::spawn(move || {
        let _ = std::process::Command::new("open").arg(&dest_for_open).spawn();
    });

    let _ = app.emit("update-downloaded", dest_str);
    Ok(())
}
