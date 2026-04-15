use super::types::*;
use anyhow::{Context, Result};
use serde::{Deserialize, Deserializer};

/// Accepts rating as either a JSON string or number, converts to String
fn deserialize_rating<'de, D>(d: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let v = Option::<serde_json::Value>::deserialize(d)?;
    Ok(v.map(|val| match val {
        serde_json::Value::String(s) => s,
        serde_json::Value::Number(n) => n.to_string(),
        other => other.to_string(),
    }))
}

pub struct XtreamClient {
    pub url: String,
    pub username: String,
    pub password: String,
    client: reqwest::Client,
}

impl XtreamClient {
    pub fn new(url: &str, username: &str, password: &str) -> Self {
        Self {
            url: url.trim_end_matches('/').to_string(),
            username: username.to_string(),
            password: password.to_string(),
            client: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(15))
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .unwrap(),
        }
    }

    fn api_url(&self, action: &str) -> String {
        format!(
            "{}/player_api.php?username={}&password={}&action={}",
            self.url, self.username, self.password, action
        )
    }

    /// Fetch account expiry date from the provider.
    /// Returns an ISO-8601 date string (e.g. "2025-12-31") or None if not available.
    pub async fn get_expiry_date(&self) -> Option<String> {
        #[derive(Deserialize)]
        struct UserInfo {
            exp_date: Option<serde_json::Value>,
        }
        #[derive(Deserialize)]
        struct ApiRoot {
            user_info: Option<UserInfo>,
        }
        let url = format!(
            "{}/player_api.php?username={}&password={}",
            self.url, self.username, self.password
        );
        let root: ApiRoot = self.client.get(&url).send().await.ok()?.json().await.ok()?;
        let exp = root.user_info?.exp_date?;
        // exp_date may be a Unix timestamp (string or number) or null
        let ts: i64 = match &exp {
            serde_json::Value::String(s) => s.trim().parse().ok()?,
            serde_json::Value::Number(n) => n.as_i64()?,
            _ => return None,
        };
        if ts <= 0 { return None; }
        // Convert Unix timestamp → YYYY-MM-DD
        use std::time::{Duration, UNIX_EPOCH};
        let dt = UNIX_EPOCH + Duration::from_secs(ts as u64);
        let secs = dt.duration_since(UNIX_EPOCH).ok()?.as_secs();
        // Simple day calculation (no external crate needed)
        let days = secs / 86400;
        let (y, m, d) = days_to_ymd(days);
        Some(format!("{:04}-{:02}-{:02}", y, m, d))
    }

    /// Generic helper: fetch any category list by action name → id→name map
    async fn get_categories(&self, action: &str) -> Result<std::collections::HashMap<String, String>> {
        #[derive(Deserialize)]
        struct XtreamCategory {
            category_id: Option<String>,
            category_name: Option<String>,
        }
        let cats: Vec<XtreamCategory> = self
            .client
            .get(self.api_url(action))
            .send()
            .await
            .with_context(|| format!("Failed to fetch {action}"))?
            .json()
            .await
            .unwrap_or_default();

        Ok(cats
            .into_iter()
            .filter_map(|c| Some((c.category_id?, c.category_name.unwrap_or_default())))
            .collect())
    }

    /// Fetch category id→name map for live streams
    pub async fn get_live_categories(&self) -> Result<std::collections::HashMap<String, String>> {
        self.get_categories("get_live_categories").await
    }

    /// Fetch category id→name map for VOD
    pub async fn get_vod_categories(&self) -> Result<std::collections::HashMap<String, String>> {
        self.get_categories("get_vod_categories").await
    }

    /// Fetch category id→name map for series
    pub async fn get_series_categories(&self) -> Result<std::collections::HashMap<String, String>> {
        self.get_categories("get_series_categories").await
    }

    pub async fn get_live_streams(&self, playlist_id: &str) -> Result<Vec<Channel>> {
        #[derive(Deserialize)]
        struct XtreamStream {
            stream_id: Option<u64>,
            name: Option<String>,
            stream_icon: Option<String>,
            epg_channel_id: Option<String>,
            category_id: Option<serde_json::Value>,
        }

        // Fetch category names in parallel with streams
        let (streams_res, cats) = tokio::join!(
            async {
                let bytes = self.client
                    .get(self.api_url("get_live_streams"))
                    .send()
                    .await
                    .context("Failed to fetch live streams")?
                    .bytes()
                    .await
                    .context("Failed to read live streams response")?;
                serde_json::from_slice::<Vec<XtreamStream>>(&bytes)
                    .map_err(|e| {
                        let preview = String::from_utf8_lossy(&bytes[..bytes.len().min(500)]);
                        anyhow::anyhow!("Failed to parse live streams: {} | Response: {}", e, preview)
                    })
            },
            self.get_live_categories()
        );
        let streams = streams_res?;
        let cats = cats.unwrap_or_default();

        Ok(streams
            .into_iter()
            .filter_map(|s| {
                let stream_id = s.stream_id?;
                let name = s.name.unwrap_or_default();
                // category_id may come as string or number
                let cat_id = match &s.category_id {
                    Some(serde_json::Value::String(v)) => v.clone(),
                    Some(serde_json::Value::Number(n)) => n.to_string(),
                    _ => String::new(),
                };
                let group_title = if cat_id.is_empty() {
                    None
                } else {
                    Some(cats.get(&cat_id).cloned().unwrap_or(cat_id))
                };
                Some(Channel {
                    id: uuid::Uuid::new_v4().to_string(),
                    name,
                    stream_url: format!(
                        "{}/live/{}/{}/{}.m3u8",
                        self.url, self.username, self.password, stream_id
                    ),
                    logo: s.stream_icon,
                    group_title,
                    epg_channel_id: s.epg_channel_id,
                    playlist_id: playlist_id.to_string(),
                    stream_id: Some(stream_id),
                })
            })
            .collect())
    }

    pub async fn get_vod_streams(&self, playlist_id: &str) -> Result<Vec<VodItem>> {
        #[derive(Deserialize)]
        struct XtreamVod {
            stream_id: Option<u64>,
            name: Option<String>,
            stream_icon: Option<String>,
            plot: Option<String>,
            #[serde(rename = "releaseDate")]
            release_date: Option<String>,
            #[serde(default, deserialize_with = "deserialize_rating")]
            rating: Option<String>,
            duration_secs: Option<u64>,
            category_id: Option<serde_json::Value>,
            container_extension: Option<String>,
        }

        // Fetch VOD streams and categories in parallel
        let (vods_res, cats) = tokio::join!(
            async {
                self.client
                    .get(self.api_url("get_vod_streams"))
                    .send()
                    .await
                    .context("Failed to fetch VOD streams")?
                    .json::<Vec<XtreamVod>>()
                    .await
                    .context("Failed to parse VOD streams")
            },
            self.get_vod_categories()
        );
        let vods = vods_res?;
        let cats = cats.unwrap_or_default();

        Ok(vods
            .into_iter()
            .filter_map(|v| {
                let stream_id = v.stream_id?;
                // Resolve category_id → category_name (the playlist group, e.g. "|EN| ✦ ACTION")
                let cat_id = match &v.category_id {
                    Some(serde_json::Value::String(s)) => s.clone(),
                    Some(serde_json::Value::Number(n)) => n.to_string(),
                    _ => String::new(),
                };
                let genre = if cat_id.is_empty() {
                    None
                } else {
                    Some(cats.get(&cat_id).cloned().unwrap_or(cat_id))
                };
                let ext = v.container_extension.as_deref()
                    .map(|e| e.trim().to_lowercase())
                    .filter(|e| !e.is_empty())
                    .unwrap_or_else(|| "mp4".to_string());
                Some(VodItem {
                    id: uuid::Uuid::new_v4().to_string(),
                    name: v.name.unwrap_or_default(),
                    stream_url: format!(
                        "{}/movie/{}/{}/{}.{}",
                        self.url, self.username, self.password, stream_id, ext
                    ),
                    poster: v.stream_icon.clone(),
                    backdrop: v.stream_icon,
                    plot: v.plot,
                    year: v.release_date,
                    rating: v.rating,
                    genre,
                    duration: v.duration_secs,
                    playlist_id: playlist_id.to_string(),
                    stream_id: Some(stream_id),
                    container_extension: v.container_extension,
                })
            })
            .collect())
    }

    pub async fn get_series(&self, playlist_id: &str) -> Result<Vec<Series>> {
        #[derive(Deserialize)]
        struct XtreamSeries {
            series_id: Option<u64>,
            name: Option<String>,
            cover: Option<String>,
            backdrop_path: Option<serde_json::Value>,
            plot: Option<String>,
            #[serde(rename = "releaseDate")]
            release_date: Option<String>,
            rating: Option<String>,
            category_id: Option<serde_json::Value>,
        }

        // Fetch series list and categories in parallel
        let (series_res, cats) = tokio::join!(
            async {
                self.client
                    .get(self.api_url("get_series"))
                    .send()
                    .await
                    .context("Failed to fetch series")?
                    .json::<Vec<XtreamSeries>>()
                    .await
                    .context("Failed to parse series")
            },
            self.get_series_categories()
        );
        let series_list = series_res?;
        let cats = cats.unwrap_or_default();

        Ok(series_list
            .into_iter()
            .filter_map(|s| {
                let series_id = s.series_id?;
                let backdrop = match &s.backdrop_path {
                    Some(serde_json::Value::String(url)) if !url.is_empty() => Some(url.clone()),
                    Some(serde_json::Value::Array(arr)) => arr
                        .first()
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    _ => None,
                };
                // Resolve category_id → category_name (the playlist group, e.g. "|EN| ✦ HBO")
                let cat_id = match &s.category_id {
                    Some(serde_json::Value::String(v)) => v.clone(),
                    Some(serde_json::Value::Number(n)) => n.to_string(),
                    _ => String::new(),
                };
                let genre = if cat_id.is_empty() {
                    None
                } else {
                    Some(cats.get(&cat_id).cloned().unwrap_or(cat_id))
                };
                Some(Series {
                    id: uuid::Uuid::new_v4().to_string(),
                    name: s.name.unwrap_or_default(),
                    poster: s.cover,
                    backdrop,
                    plot: s.plot,
                    year: s.release_date,
                    rating: s.rating,
                    genre,
                    playlist_id: playlist_id.to_string(),
                    series_id: Some(series_id),
                })
            })
            .collect())
    }

    pub async fn get_series_info(
        &self,
        series_id: u64,
        playlist_id: &str,
    ) -> Result<SeriesInfo> {
        #[derive(Deserialize)]
        struct XtreamSeriesInfo {
            info: serde_json::Value,
            episodes: std::collections::HashMap<String, Vec<XtreamEpisode>>,
        }

        #[derive(Deserialize)]
        struct XtreamEpisode {
            id: Option<String>,
            episode_num: Option<u32>,
            season: Option<u32>,
            title: Option<String>,
            plot: Option<String>,
            duration_secs: Option<u64>,
            info: Option<serde_json::Value>,
            container_extension: Option<String>,
        }

        let url = format!(
            "{}/player_api.php?username={}&password={}&action=get_series_info&series_id={}",
            self.url, self.username, self.password, series_id
        );

        let raw: XtreamSeriesInfo = self
            .client
            .get(&url)
            .send()
            .await
            .context("Failed to fetch series info")?
            .json()
            .await
            .context("Failed to parse series info")?;

        let series = Series {
            id: uuid::Uuid::new_v4().to_string(),
            name: raw.info["name"].as_str().unwrap_or("").to_string(),
            poster: raw.info["cover"].as_str().map(|s| s.to_string()),
            backdrop: raw.info["backdrop_path"].as_str().map(|s| s.to_string()),
            plot: raw.info["plot"].as_str().map(|s| s.to_string()),
            year: raw.info["releaseDate"].as_str().map(|s| s.to_string()),
            rating: raw.info["rating"].as_str().map(|s| s.to_string()),
            genre: raw.info["genre"].as_str().map(|s| s.to_string()),
            playlist_id: playlist_id.to_string(),
            series_id: Some(series_id),
        };

        let mut seasons: std::collections::HashMap<String, Vec<Episode>> =
            std::collections::HashMap::new();

        for (season_num, eps) in raw.episodes {
            let episodes: Vec<Episode> = eps
                .into_iter()
                .map(|e| {
                    let ep_id = e.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                    let ep_num = e.episode_num.unwrap_or(0);
                    let season = e.season.unwrap_or(0);
                    let ext = e.container_extension.as_deref()
                        .map(|s| s.trim().to_lowercase())
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| "mp4".to_string());
                    let poster = e.info.as_ref()
                        .and_then(|i| i["movie_image"].as_str())
                        .map(|s| s.to_string());
                    Episode {
                        id: ep_id.clone(),
                        episode_num: ep_num,
                        season,
                        title: e.title.unwrap_or_else(|| format!("Episode {}", ep_num)),
                        stream_url: format!(
                            "{}/series/{}/{}/{}.{}",
                            self.url, self.username, self.password, ep_id, ext
                        ),
                        plot: e.plot,
                        duration: e.duration_secs,
                        container_extension: e.container_extension,
                        poster,
                    }
                })
                .collect();
            seasons.insert(season_num, episodes);
        }

        Ok(SeriesInfo { series, seasons })
    }
}

/// Convert days-since-epoch to (year, month, day).
fn days_to_ymd(mut days: u64) -> (u32, u32, u32) {
    days += 719468; // shift epoch to 1 Mar 0000
    let era = days / 146097;
    let doe = days % 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as u32, m as u32, d as u32)
}
