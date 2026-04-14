use crate::persist;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, State};

type CmdResult<T> = Result<T, String>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResumeEntry {
    pub key: String,
    pub position_sec: f64,
    pub duration_sec: f64,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub poster_url: Option<String>,
    /// Stored so playback can restart after Xtream token rotation.
    pub stream_url: String,
    pub updated_at: i64, // unix seconds
}

pub struct ResumeStore {
    pub entries: Mutex<HashMap<String, ResumeEntry>>,
}

impl ResumeStore {
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
        }
    }
}

#[tauri::command]
pub async fn get_resume_position(
    state: State<'_, ResumeStore>,
    key: String,
) -> CmdResult<Option<ResumeEntry>> {
    Ok(state.entries.lock().unwrap().get(&key).cloned())
}

#[tauri::command]
pub async fn save_resume_position(
    state: State<'_, ResumeStore>,
    app: AppHandle,
    entry: ResumeEntry,
) -> CmdResult<()> {
    let mut entries = state.entries.lock().unwrap();
    entries.insert(entry.key.clone(), entry);
    persist::save(&app, "resume.json", &*entries);
    Ok(())
}

#[tauri::command]
pub async fn clear_resume_position(
    state: State<'_, ResumeStore>,
    app: AppHandle,
    key: String,
) -> CmdResult<()> {
    let mut entries = state.entries.lock().unwrap();
    entries.remove(&key);
    persist::save(&app, "resume.json", &*entries);
    Ok(())
}

#[tauri::command]
pub async fn list_resume_entries(
    state: State<'_, ResumeStore>,
) -> CmdResult<Vec<ResumeEntry>> {
    Ok(state.entries.lock().unwrap().values().cloned().collect())
}
