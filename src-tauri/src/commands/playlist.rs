use crate::persist;
use crate::playlist::{
    m3u, stalker::StalkerClient, xtream::XtreamClient, Channel, Playlist, PlaylistStore,
    PlaylistType, Series, SeriesInfo, VodItem,
};
use tauri::{AppHandle, State};
use uuid::Uuid;

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
pub async fn add_xtream_playlist(
    state: State<'_, PlaylistStore>,
    app: AppHandle,
    name: String,
    url: String,
    username: String,
    password: String,
) -> CmdResult<Playlist> {
    let client = XtreamClient::new(&url, &username, &password);
    // Validate credentials and fetch expiry in parallel
    let (live_check, expiry) = tokio::join!(
        client.get_live_streams("test"),
        client.get_expiry_date()
    );
    live_check.map_err(|e| format!("Failed to connect: {}", e))?;

    let playlist = Playlist {
        id: Uuid::new_v4().to_string(),
        name,
        playlist_type: PlaylistType::Xtream,
        url,
        username: Some(username),
        password: Some(password),
        mac: None,
        expiry,
    };

    let mut guard = state.playlists.lock().unwrap();
    guard.push(playlist.clone());
    persist::save(&app, "playlists.json", &*guard);
    Ok(playlist)
}

#[tauri::command]
pub async fn add_m3u_playlist(
    state: State<'_, PlaylistStore>,
    app: AppHandle,
    name: String,
    url: String,
) -> CmdResult<Playlist> {
    let playlist = Playlist {
        id: Uuid::new_v4().to_string(),
        name,
        playlist_type: PlaylistType::M3u,
        url,
        username: None,
        password: None,
        mac: None,
        expiry: None,
    };

    let mut guard = state.playlists.lock().unwrap();
    guard.push(playlist.clone());
    persist::save(&app, "playlists.json", &*guard);
    Ok(playlist)
}

#[tauri::command]
pub async fn add_stalker_playlist(
    state: State<'_, PlaylistStore>,
    app: AppHandle,
    name: String,
    url: String,
    mac: String,
) -> CmdResult<Playlist> {
    let client = StalkerClient::new(&url, &mac);
    client
        .get_channels("test")
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let playlist = Playlist {
        id: Uuid::new_v4().to_string(),
        name,
        playlist_type: PlaylistType::Stalker,
        url,
        username: None,
        password: None,
        mac: Some(mac),
        expiry: None,
    };

    let mut guard = state.playlists.lock().unwrap();
    guard.push(playlist.clone());
    persist::save(&app, "playlists.json", &*guard);
    Ok(playlist)
}

#[tauri::command]
pub async fn list_playlists(state: State<'_, PlaylistStore>) -> CmdResult<Vec<Playlist>> {
    Ok(state.playlists.lock().unwrap().clone())
}

#[tauri::command]
pub async fn update_playlist(
    state: State<'_, PlaylistStore>,
    app: AppHandle,
    id: String,
    name: Option<String>,
    url: Option<String>,
    expiry: Option<String>,
) -> CmdResult<Playlist> {
    let mut guard = state.playlists.lock().unwrap();
    let playlist = guard
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("Playlist '{}' not found", id))?;
    if let Some(n) = name {
        let trimmed = n.trim().to_string();
        if !trimmed.is_empty() {
            playlist.name = trimmed;
        }
    }
    if let Some(u) = url {
        let trimmed = u.trim().to_string();
        if !trimmed.is_empty() {
            playlist.url = trimmed;
        }
    }
    // Pass Some("") to clear expiry, Some("date") to set it, None to leave unchanged
    if let Some(e) = expiry {
        playlist.expiry = if e.trim().is_empty() { None } else { Some(e.trim().to_string()) };
    }
    let updated = playlist.clone();
    persist::save(&app, "playlists.json", &*guard);
    Ok(updated)
}

#[tauri::command]
pub async fn remove_playlist(
    state: State<'_, PlaylistStore>,
    app: AppHandle,
    id: String,
) -> CmdResult<()> {
    let mut guard = state.playlists.lock().unwrap();
    guard.retain(|p| p.id != id);
    persist::save(&app, "playlists.json", &*guard);
    Ok(())
}

#[tauri::command]
pub async fn fetch_live_channels(
    state: State<'_, PlaylistStore>,
    playlist_id: String,
) -> CmdResult<Vec<Channel>> {
    let playlist = find_playlist(&state, &playlist_id)?;

    match playlist.playlist_type {
        PlaylistType::Xtream => {
            let client = XtreamClient::new(
                &playlist.url,
                playlist.username.as_deref().unwrap_or(""),
                playlist.password.as_deref().unwrap_or(""),
            );
            client.get_live_streams(&playlist_id).await.map_err(err)
        }
        PlaylistType::M3u => {
            let (channels, vods) = m3u::parse_m3u(&playlist.url, &playlist_id)
                .await
                .map_err(err)?;
            if channels.is_empty() && !vods.is_empty() {
                return Err(format!(
                    "No live channels found, but {} VOD items were detected. This looks like a Movies/VOD playlist — browse it under Movies instead.",
                    vods.len()
                ));
            }
            Ok(channels)
        }
        PlaylistType::Stalker => {
            let client = StalkerClient::new(
                &playlist.url,
                playlist.mac.as_deref().unwrap_or(""),
            );
            client.get_channels(&playlist_id).await.map_err(err)
        }
    }
}

#[tauri::command]
pub async fn fetch_vod(
    state: State<'_, PlaylistStore>,
    playlist_id: String,
) -> CmdResult<Vec<VodItem>> {
    let playlist = find_playlist(&state, &playlist_id)?;

    match playlist.playlist_type {
        PlaylistType::Xtream => {
            let client = XtreamClient::new(
                &playlist.url,
                playlist.username.as_deref().unwrap_or(""),
                playlist.password.as_deref().unwrap_or(""),
            );
            client.get_vod_streams(&playlist_id).await.map_err(err)
        }
        PlaylistType::M3u => {
            let (_, vods) = m3u::parse_m3u(&playlist.url, &playlist_id)
                .await
                .map_err(err)?;
            Ok(vods)
        }
        PlaylistType::Stalker => Ok(vec![]),
    }
}

#[tauri::command]
pub async fn fetch_series(
    state: State<'_, PlaylistStore>,
    playlist_id: String,
) -> CmdResult<Vec<Series>> {
    let playlist = find_playlist(&state, &playlist_id)?;

    match playlist.playlist_type {
        PlaylistType::Xtream => {
            let client = XtreamClient::new(
                &playlist.url,
                playlist.username.as_deref().unwrap_or(""),
                playlist.password.as_deref().unwrap_or(""),
            );
            client.get_series(&playlist_id).await.map_err(err)
        }
        _ => Ok(vec![]),
    }
}

#[tauri::command]
pub async fn fetch_series_info(
    state: State<'_, PlaylistStore>,
    playlist_id: String,
    series_id: u64,
) -> CmdResult<SeriesInfo> {
    let playlist = find_playlist(&state, &playlist_id)?;

    match playlist.playlist_type {
        PlaylistType::Xtream => {
            let client = XtreamClient::new(
                &playlist.url,
                playlist.username.as_deref().unwrap_or(""),
                playlist.password.as_deref().unwrap_or(""),
            );
            client
                .get_series_info(series_id, &playlist_id)
                .await
                .map_err(err)
        }
        _ => Err("Series info only available for Xtream playlists".into()),
    }
}

#[tauri::command]
pub async fn refresh_playlist_expiry(
    state: State<'_, PlaylistStore>,
    app: AppHandle,
    id: String,
) -> CmdResult<Playlist> {
    let playlist = find_playlist(&state, &id)?;
    if playlist.playlist_type != PlaylistType::Xtream {
        return Err("Expiry refresh is only available for Xtream playlists".into());
    }
    let client = XtreamClient::new(
        &playlist.url,
        playlist.username.as_deref().unwrap_or(""),
        playlist.password.as_deref().unwrap_or(""),
    );
    let expiry = client.get_expiry_date().await;
    let mut guard = state.playlists.lock().unwrap();
    let p = guard.iter_mut().find(|p| p.id == id)
        .ok_or_else(|| format!("Playlist '{}' not found", id))?;
    p.expiry = expiry;
    let updated = p.clone();
    persist::save(&app, "playlists.json", &*guard);
    Ok(updated)
}

fn find_playlist(state: &PlaylistStore, id: &str) -> CmdResult<Playlist> {
    state
        .playlists
        .lock()
        .unwrap()
        .iter()
        .find(|p| p.id == id)
        .cloned()
        .ok_or_else(|| format!("Playlist '{}' not found", id))
}
