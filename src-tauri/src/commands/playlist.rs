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
    client
        .get_live_streams("test")
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let playlist = Playlist {
        id: Uuid::new_v4().to_string(),
        name,
        playlist_type: PlaylistType::Xtream,
        url,
        username: Some(username),
        password: Some(password),
        mac: None,
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
            let (channels, _) = m3u::parse_m3u(&playlist.url, &playlist_id)
                .await
                .map_err(err)?;
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
