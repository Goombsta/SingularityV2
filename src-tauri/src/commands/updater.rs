use std::env::temp_dir;

/// Download an installer from `url` into the OS temp directory as `filename`.
/// Returns the absolute path of the saved file on success.
/// Desktop-only — Android sideloading requires the browser flow.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn download_update(url: String, filename: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Singularity-Updater/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    let mut path = temp_dir();
    path.push(&filename);

    std::fs::write(&path, &bytes).map_err(|e| format!("Write failed: {e}"))?;

    Ok(path.to_string_lossy().to_string())
}

/// Launch a previously downloaded installer. On Windows we use `cmd /c start`
/// so the installer runs detached from the current process. The Tauri shell
/// plugin's `open` doesn't allow arbitrary local paths by default, so we
/// handle it natively here.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn install_update(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Failed to launch installer: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to launch installer: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to launch installer: {e}"))?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = path;
        Err("Unsupported platform".into())
    }
}
