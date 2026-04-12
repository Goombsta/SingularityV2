use super::types::{Channel, VodItem};
use anyhow::{Context, Result};

/// Parse an IPTV-style M3U playlist (not HLS — EXTINF with tvg-* attributes)
pub async fn parse_m3u(source: &str, playlist_id: &str) -> Result<(Vec<Channel>, Vec<VodItem>)> {
    let content = if source.starts_with("http://") || source.starts_with("https://") {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .context("Failed to build HTTP client")?
            .get(source)
            .send()
            .await
            .context("Failed to fetch M3U URL")?
            .text()
            .await
            .context("Failed to read M3U response")?
    } else {
        tokio::fs::read_to_string(source)
            .await
            .context("Failed to read M3U file")?
    };

    parse_m3u_content(&content, playlist_id)
}

fn parse_m3u_content(content: &str, playlist_id: &str) -> Result<(Vec<Channel>, Vec<VodItem>)> {
    let mut channels = Vec::new();
    let mut vods = Vec::new();
    let mut lines = content.lines().peekable();

    // Skip #EXTM3U header
    if let Some(first) = lines.peek() {
        if first.starts_with("#EXTM3U") {
            lines.next();
        }
    }

    let mut current_extinf: Option<ExtInf> = None;

    for line in lines {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if line.starts_with("#EXTINF:") {
            current_extinf = Some(parse_extinf(line));
        } else if !line.starts_with('#') && !line.is_empty() {
            // This is a stream URL
            if let Some(info) = current_extinf.take() {
                let stream_url = line.to_string();
                let url_path = stream_url.split('?').next().unwrap_or("").to_lowercase();
                // MPEG-TS extensions (.ts, .mpegts, etc.) are intentionally excluded:
                // in IPTV M3U playlists they almost always indicate live streams, not VOD files.
                let is_vod = url_path.ends_with(".mp4")
                    || url_path.ends_with(".mkv")
                    || url_path.ends_with(".avi")
                    || url_path.ends_with(".mov")
                    || url_path.ends_with(".m4v")
                    || url_path.ends_with(".webm")
                    || url_path.ends_with(".flv")
                    || url_path.ends_with(".wmv")
                    || stream_url.contains("/movie/")
                    || stream_url.contains("/series/");

                if is_vod {
                    vods.push(VodItem {
                        id: uuid::Uuid::new_v4().to_string(),
                        name: info.name,
                        stream_url,
                        poster: info.tvg_logo,
                        backdrop: None,
                        plot: None,
                        year: None,
                        rating: None,
                        genre: info.group_title.clone(),
                        duration: None,
                        playlist_id: playlist_id.to_string(),
                        stream_id: None,
                        container_extension: None,
                    });
                } else {
                    channels.push(Channel {
                        id: uuid::Uuid::new_v4().to_string(),
                        name: info.name,
                        stream_url,
                        logo: info.tvg_logo,
                        group_title: info.group_title,
                        epg_channel_id: info.tvg_id,
                        playlist_id: playlist_id.to_string(),
                        stream_id: None,
                    });
                }
            }
        }
    }

    // Diagnostic: nothing found at all — response probably isn't an M3U
    if channels.is_empty() && vods.is_empty() {
        if !content.contains("#EXTINF") {
            let preview: String = content.chars().take(120).collect::<String>()
                .replace('\n', " ").replace('\r', "");
            return Err(anyhow::anyhow!(
                "No #EXTINF entries found. Response may not be an M3U playlist. Preview: \"{}\"",
                preview
            ));
        }
    }

    Ok((channels, vods))
}

struct ExtInf {
    name: String,
    tvg_id: Option<String>,
    tvg_logo: Option<String>,
    group_title: Option<String>,
}

fn parse_extinf(line: &str) -> ExtInf {
    // Format: #EXTINF:-1 tvg-id="..." tvg-name="..." tvg-logo="..." group-title="...",Display Name
    let name = line
        .rsplit(',')
        .next()
        .unwrap_or("Unknown")
        .trim()
        .to_string();

    ExtInf {
        name,
        tvg_id: extract_attr(line, "tvg-id"),
        tvg_logo: extract_attr(line, "tvg-logo"),
        group_title: extract_attr(line, "group-title"),
    }
}

fn extract_attr(line: &str, attr: &str) -> Option<String> {
    let search = format!("{}=\"", attr);
    let start = line.find(&search)? + search.len();
    let rest = &line[start..];
    let end = rest.find('"')?;
    let value = rest[..end].trim().to_string();
    if value.is_empty() { None } else { Some(value) }
}
