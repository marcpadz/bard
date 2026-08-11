use std::env;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};

const BARD_BUNDLE_ID: &str = "com.bard.prompter";

/// Download the release DMG from GitHub, verify the app bundle inside it, and
/// install it in place (replacing the running app) before relaunching. Runs on
/// a background thread so the main thread (and the webview) never blocks.
#[tauri::command]
pub fn download_update(app: tauri::AppHandle, url: String, version: String) -> Result<(), String> {
    std::thread::spawn(move || {
        let result = download_and_install(&app, &url, &version);
        match result {
            Ok(()) => {
                let _ = app.emit("update-downloaded", ());
            }
            Err(e) => {
                let _ = app.emit("update-download-failed", e);
            }
        }
    });
    Ok(())
}

fn download_and_install(app: &tauri::AppHandle, url: &str, version: &str) -> Result<(), String> {
    let dmg = download_dmg(app, url, version)?;
    let mount = mount_dmg(&dmg)?;
    let mounted_app = mount.join("Bard.app");
    if !mounted_app.is_dir() {
        detach_dmg(&mount)?;
        return Err("The downloaded DMG doesn't contain Bard.app".into());
    }
    verify_bundle(&mounted_app)?;
    install_bundle(&mounted_app, &mount)?;
    detach_dmg(&mount)?;
    let _ = fs::remove_file(&dmg);
    relaunch(app);
    Ok(())
}

fn download_dmg(app: &tauri::AppHandle, url: &str, version: &str) -> Result<PathBuf, String> {
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
    Ok(dest)
}

/// Attach the DMG and return the mount point. `hdiutil attach` may report the
/// mount point before the volume is fully ready, so retry until it exists.
fn mount_dmg(dmg: &Path) -> Result<PathBuf, String> {
    let out = std::process::Command::new("hdiutil")
        .args(["attach", "-nobrowse", "-noverify", "-noautoopen"])
        .arg(dmg)
        .output()
        .map_err(|e| format!("Couldn't mount the update: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "Couldn't mount the update: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mount_point = text
        .lines()
        .find_map(|line| {
            let after = line.split_once('\t')?.1;
            Some(PathBuf::from(after.trim()))
        })
        .ok_or_else(|| "Couldn't find the mounted volume".to_string())?;
    for _ in 0..20 {
        if mount_point.exists() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    if !mount_point.exists() {
        return Err(format!("Mounted volume not found at {mount_point:?}"));
    }
    Ok(mount_point)
}

fn detach_dmg(mount: &Path) -> Result<(), String> {
    let out = std::process::Command::new("hdiutil")
        .args(["detach"])
        .arg(mount)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// The download isn't signed/notarized; check the bundled app's Info.plist so
/// we at least don't install a bogus bundle.
fn verify_bundle(app_bundle: &Path) -> Result<(), String> {
    let plist = app_bundle.join("Contents/Info.plist");
    let raw = fs::read_to_string(&plist).map_err(|e| format!("Bad update bundle: {e}"))?;
    if raw.contains(BARD_BUNDLE_ID) {
        Ok(())
    } else {
        Err("The downloaded bundle isn't a valid Bard app".into())
    }
}

/// Replace the installed app with the update. If a running app was already
/// installed elsewhere (e.g. ~/Applications), update that copy too.
fn install_bundle(mounted_app: &Path, mount: &Path) -> Result<(), String> {
    let candidates = ["/Applications", "~/Applications", "~/Desktop"];

    let current = env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().and_then(|p| p.parent()).map(|p| p.to_path_buf()))
        .and_then(|dir| dir.join("Bard.app").canonicalize().ok());

    let mut targets: Vec<PathBuf> = candidates
        .iter()
        .filter_map(|d| {
            let p = shellexpand::tilde(d);
            let candidate = Path::new(p.as_ref()).join("Bard.app");
            candidate.is_dir().then_some(candidate)
        })
        .collect();
    if let Some(cur) = current {
        if !targets.contains(&cur) {
            targets.push(cur);
        }
    }
    targets.dedup();

    if targets.is_empty() {
        let err = "Couldn't find the installed Bard.app — the downloaded DMG was left in ~/Downloads for manual install.".to_string();
        let _ = detach_dmg(mount);
        return Err(err);
    }

    // Replace the app bundle in place, keeping its user-facing name.
    for target in &targets {
        let swap = target.with_extension("app.update");
        let _ = fs::remove_dir_all(&swap);
        fs::rename(mounted_app, &swap).map_err(|e| format!("Couldn't stage the update: {e}"))?;
        let _ = detach_dmg(mount);
        if let Err(e) = fs::remove_dir_all(target) {
            let _ = fs::rename(&swap, mounted_app); // best-effort rollback
            return Err(format!("Couldn't replace the installed app: {e}"));
        }
        fs::rename(&swap, target).map_err(|e| format!("Couldn't install the update: {e}"))?;
    }
    Ok(())
}

/// Re-launch the freshly installed app after a short delay, so this process
/// exits before the new one starts.
fn relaunch(app: &tauri::AppHandle) {
    let exe = std::env::current_exe().ok();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(400));
        if let Some(exe) = exe {
            let _ = std::process::Command::new(&exe).spawn();
        }
        std::process::exit(0);
    });
    let _ = app.exit(0);
}
