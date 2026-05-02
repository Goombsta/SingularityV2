use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
#[cfg(target_os = "android")]
use tauri::Manager;
use tokio::io::AsyncWriteExt;

#[derive(Clone, Serialize)]
struct DownloadProgress {
    downloaded: u64,
    total: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct VersionEntry {
    pub version: String,
    pub url: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct VersionInfo {
    pub android: VersionEntry,
    pub desktop: VersionEntry,
}

#[tauri::command]
pub async fn fetch_version_info() -> Result<VersionInfo, String> {
    let client = reqwest::Client::builder()
        .user_agent("Singularity-Updater/1.0")
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get("https://www.singularitytv.app/version.json")
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }

    res.json::<VersionInfo>()
        .await
        .map_err(|e| format!("Parse failed: {e}"))
}

macro_rules! ulog {
    ($($arg:tt)*) => { eprintln!("[updater] {}", format!($($arg)*)) };
}

/// Download an installer from `url` into a writable directory as `filename`.
/// Streams the response to disk to avoid buffering ~80 MB in memory (which can
/// OOM-kill the WebView on low-RAM Android devices). Emits
/// `update-download-progress` events so the UI can show real progress.
///
/// On Android, writes to the app's private cache dir (the APK must live at the
/// root of `getCacheDir()` for the current `file_paths.xml` FileProvider
/// config). On other platforms uses the OS temp directory.
#[tauri::command]
pub async fn download_update(
    app: tauri::AppHandle,
    url: String,
    filename: String,
) -> Result<String, String> {
    ulog!("download_update called: url={url} filename={filename}");

    let client = reqwest::Client::builder()
        .user_agent("Singularity-Updater/1.0")
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| {
            let s = e.to_string();
            ulog!("client build failed: {s}");
            s
        })?;

    let response = client.get(&url).send().await.map_err(|e| {
        let s = format!("Request failed: {e}");
        ulog!("{s}");
        s
    })?;

    let status = response.status();
    ulog!("HTTP response: {status}");
    if !status.is_success() {
        let s = format!("HTTP {status}");
        ulog!("{s}");
        return Err(s);
    }

    let total = response.content_length();
    ulog!("content-length: {:?}", total);

    #[cfg(target_os = "android")]
    let dir = {
        let _ = &app;
        app.path().app_cache_dir().map_err(|e| {
            let s = format!("Cache dir unavailable: {e}");
            ulog!("{s}");
            s
        })?
    };
    #[cfg(not(target_os = "android"))]
    let dir = {
        let _ = &app;
        std::env::temp_dir()
    };

    ulog!("saving to dir: {}", dir.display());
    std::fs::create_dir_all(&dir).map_err(|e| {
        let s = format!("Dir create failed: {e}");
        ulog!("{s}");
        s
    })?;
    let path = dir.join(&filename);

    if path.exists() {
        if let Err(e) = std::fs::remove_file(&path) {
            ulog!("could not remove stale file: {e}");
        }
    }

    let mut file = tokio::fs::File::create(&path).await.map_err(|e| {
        let s = format!("File create failed: {e}");
        ulog!("{s}");
        s
    })?;

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emit: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            let s = format!("Chunk read failed: {e}");
            ulog!("{s}");
            s
        })?;
        file.write_all(&chunk).await.map_err(|e| {
            let s = format!("Write failed: {e}");
            ulog!("{s}");
            s
        })?;
        downloaded += chunk.len() as u64;

        if downloaded - last_emit >= 256 * 1024 {
            last_emit = downloaded;
            let _ = app.emit(
                "update-download-progress",
                DownloadProgress { downloaded, total },
            );
        }
    }

    file.flush().await.map_err(|e| {
        let s = format!("Flush failed: {e}");
        ulog!("{s}");
        s
    })?;
    drop(file);

    let _ = app.emit(
        "update-download-progress",
        DownloadProgress { downloaded, total },
    );

    if let Some(expected) = total {
        if downloaded != expected {
            let s = format!("Size mismatch: got {downloaded}, expected {expected}");
            ulog!("{s}");
            return Err(s);
        }
    }

    ulog!("saved {downloaded} bytes to: {}", path.display());
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
