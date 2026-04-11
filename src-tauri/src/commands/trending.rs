/// Fetches the IMDb popularity meter charts via their public RSS feeds
/// and returns an ordered list of titles (most popular first).
///
/// media_type: "movie"  → https://rss.imdb.com/chart/moviemeter
/// media_type: "tv"     → https://rss.imdb.com/chart/tvmeter
#[tauri::command]
pub async fn fetch_imdb_trending(media_type: String) -> Result<Vec<String>, String> {
    let url = if media_type == "tv" {
        "https://rss.imdb.com/chart/tvmeter"
    } else {
        "https://rss.imdb.com/chart/moviemeter"
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (compatible; Singularity/1.0)")
        .build()
        .map_err(|e| e.to_string())?;

    let body = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Fetch failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Body read failed: {e}"))?;

    // Parse <title> elements from RSS, skipping the feed-level title (first one)
    let titles = parse_rss_titles(&body);
    if titles.is_empty() {
        return Err("No titles found in IMDb RSS feed".into());
    }
    // Return exactly the first 30 — matches the IMDb moviemeter/tvmeter page order
    Ok(titles.into_iter().take(30).collect())
}

fn parse_rss_titles(xml: &str) -> Vec<String> {
    let mut titles = Vec::new();
    let mut skip_first = true;

    for line in xml.lines() {
        let trimmed = line.trim();
        if let Some(inner) = trimmed
            .strip_prefix("<title>")
            .and_then(|s| s.strip_suffix("</title>"))
            .or_else(|| {
                // Handle <title><![CDATA[...]]></title>
                trimmed
                    .strip_prefix("<title><![CDATA[")?
                    .strip_suffix("]]></title>")
            })
        {
            if skip_first {
                skip_first = false; // first <title> is the channel name
                continue;
            }
            // IMDb RSS title format: "1. Movie Name (Year)" — strip the rank prefix
            let clean = inner
                .trim()
                .trim_start_matches(|c: char| c.is_ascii_digit() || c == '.')
                .trim();
            // Remove year suffix "(YYYY)" if present
            let clean = if let Some(pos) = clean.rfind(" (") {
                &clean[..pos]
            } else {
                clean
            };
            if !clean.is_empty() {
                titles.push(clean.to_string());
            }
        }
    }
    titles
}
