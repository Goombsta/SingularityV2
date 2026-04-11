use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PlaylistType {
    Xtream,
    M3u,
    Stalker,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub playlist_type: PlaylistType,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mac: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Channel {
    pub id: String,
    pub name: String,
    pub stream_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub epg_channel_id: Option<String>,
    pub playlist_id: String,
    pub stream_id: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VodItem {
    pub id: String,
    pub name: String,
    pub stream_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub poster: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backdrop: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plot: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<u64>,
    pub playlist_id: String,
    pub stream_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container_extension: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Series {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub poster: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backdrop: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plot: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genre: Option<String>,
    pub playlist_id: String,
    pub series_id: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Episode {
    pub id: String,
    pub episode_num: u32,
    pub season: u32,
    pub title: String,
    pub stream_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plot: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub poster: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container_extension: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeriesInfo {
    pub series: Series,
    pub seasons: std::collections::HashMap<String, Vec<Episode>>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Category {
    pub id: String,
    pub name: String,
}
