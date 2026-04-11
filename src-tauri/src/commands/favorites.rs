use crate::persist;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, State};

type CmdResult<T> = Result<T, String>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FavoriteItem {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub item_type: String, // "channel" | "vod" | "series"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub poster: Option<String>,
    pub playlist_id: String,
}

pub struct FavoritesStore {
    pub items: Mutex<Vec<FavoriteItem>>,
}

impl FavoritesStore {
    pub fn new() -> Self {
        Self {
            items: Mutex::new(Vec::new()),
        }
    }
}

#[tauri::command]
pub async fn add_to_favorites(
    state: State<'_, FavoritesStore>,
    app: AppHandle,
    item: FavoriteItem,
) -> CmdResult<()> {
    let mut items = state.items.lock().unwrap();
    if !items.iter().any(|i| i.id == item.id) {
        items.push(item);
        persist::save(&app, "favorites.json", &*items);
    }
    Ok(())
}

#[tauri::command]
pub async fn remove_from_favorites(
    state: State<'_, FavoritesStore>,
    app: AppHandle,
    id: String,
) -> CmdResult<()> {
    let mut items = state.items.lock().unwrap();
    items.retain(|i| i.id != id);
    persist::save(&app, "favorites.json", &*items);
    Ok(())
}

#[tauri::command]
pub async fn get_favorites(state: State<'_, FavoritesStore>) -> CmdResult<Vec<FavoriteItem>> {
    Ok(state.items.lock().unwrap().clone())
}
