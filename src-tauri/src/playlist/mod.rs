pub mod types;
pub mod m3u;
pub mod xtream;
pub mod stalker;

pub use types::*;

use std::sync::Mutex;

/// In-memory store of registered playlists (persisted to app data dir as JSON)
pub struct PlaylistStore {
    pub playlists: Mutex<Vec<Playlist>>,
}

impl PlaylistStore {
    pub fn new() -> Self {
        Self {
            playlists: Mutex::new(Vec::new()),
        }
    }
}
