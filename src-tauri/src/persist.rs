//! Simple JSON persistence helpers.
//! All data is stored in the OS app-data directory (Tauri manages the path).

use serde::{de::DeserializeOwned, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn data_path(app: &AppHandle, filename: &str) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("no app data dir")
        .join(filename)
}

/// Load a JSON file, returning `T::default()` if missing or corrupt.
pub fn load<T: DeserializeOwned + Default>(app: &AppHandle, filename: &str) -> T {
    let path = data_path(app, filename);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Persist `value` to a JSON file, creating parent directories as needed.
pub fn save<T: Serialize>(app: &AppHandle, filename: &str, value: &T) {
    let path = data_path(app, filename);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(value) {
        let _ = std::fs::write(path, json);
    }
}
