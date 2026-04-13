mod commands;
mod epg;
mod persist;
mod playlist;
mod proxy;

#[tauri::command]
fn get_proxy_port() -> Option<u16> {
    proxy::port()
}

use commands::favorites::FavoritesStore;
use epg::{EpgCache, EpgSource};
use playlist::{Playlist, PlaylistStore};
use tauri::Manager;

#[cfg(not(target_os = "android"))]
use commands::player::MpvStore;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .manage(PlaylistStore::new())
        .manage(EpgCache::new())
        .manage(FavoritesStore::new());

    // Native MPV store — desktop only (Android uses the Kotlin MpvPlugin)
    #[cfg(not(target_os = "android"))]
    let builder = builder.manage(MpvStore::new());

    builder
        .setup(|app| {
            // Start the HLS proxy (binds to 127.0.0.1:random port)
            tauri::async_runtime::spawn(proxy::start());

            let handle = app.handle();

            // ── Restore persisted playlists ───────────────────────────────────
            let playlists: Vec<Playlist> = persist::load(handle, "playlists.json");
            *app.state::<PlaylistStore>().playlists.lock().unwrap() = playlists;

            // ── Restore persisted favorites ───────────────────────────────────
            let favorites: Vec<commands::favorites::FavoriteItem> =
                persist::load(handle, "favorites.json");
            *app.state::<FavoritesStore>().items.lock().unwrap() = favorites;

            // ── Restore persisted EPG sources ─────────────────────────────────
            let epg_sources: Vec<EpgSource> = persist::load(handle, "epg_sources.json");
            *app.state::<EpgCache>().sources.lock().unwrap() = epg_sources;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Playlist
            commands::playlist::add_xtream_playlist,
            commands::playlist::add_m3u_playlist,
            commands::playlist::add_stalker_playlist,
            commands::playlist::list_playlists,
            commands::playlist::update_playlist,
            commands::playlist::refresh_playlist_expiry,
            commands::playlist::remove_playlist,
            commands::playlist::fetch_live_channels,
            commands::playlist::fetch_vod,
            commands::playlist::fetch_series,
            commands::playlist::fetch_series_info,
            // EPG
            commands::epg::fetch_epg,
            commands::epg::get_epg_for_channel,
            commands::epg::list_epg_sources,
            commands::epg::add_epg_source,
            commands::epg::remove_epg_source,
            // Credentials
            commands::credentials::store_credential,
            commands::credentials::get_credential,
            commands::credentials::delete_credential,
            // Favorites
            commands::favorites::add_to_favorites,
            commands::favorites::remove_from_favorites,
            commands::favorites::get_favorites,
            // HLS proxy port
            get_proxy_port,
            // OMDb metadata
            commands::omdb::fetch_omdb,
            // TMDB metadata
            commands::tmdb::fetch_tmdb,
            commands::tmdb::fetch_tmdb_trending,
            commands::tmdb::fetch_tmdb_similar,
            // IMDb trending
            commands::trending::fetch_imdb_trending,
            // Native MPV — desktop only
            #[cfg(not(target_os = "android"))]
            commands::player::mpv_create,
            #[cfg(not(target_os = "android"))]
            commands::player::mpv_load_url,
            #[cfg(not(target_os = "android"))]
            commands::player::mpv_pause,
            #[cfg(not(target_os = "android"))]
            commands::player::mpv_resume,
            #[cfg(not(target_os = "android"))]
            commands::player::mpv_set_volume,
            #[cfg(not(target_os = "android"))]
            commands::player::mpv_seek,
            #[cfg(not(target_os = "android"))]
            commands::player::mpv_resize,
            #[cfg(not(target_os = "android"))]
            commands::player::mpv_destroy,
            #[cfg(not(target_os = "android"))]
            commands::player::player_get_properties,
            #[cfg(not(target_os = "android"))]
            commands::player::player_get_tech_stats,
            #[cfg(not(target_os = "android"))]
            commands::player::mpv_get_tracks,
            #[cfg(not(target_os = "android"))]
            commands::player::mpv_set_audio_track,
            #[cfg(not(target_os = "android"))]
            commands::player::mpv_set_sub_track,
            #[cfg(not(target_os = "android"))]
            commands::player::mpv_set_sub_scale,
            // Updater — download works on all platforms; install is desktop-only
            commands::updater::download_update,
            #[cfg(not(target_os = "android"))]
            commands::updater::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Singularity");
}
