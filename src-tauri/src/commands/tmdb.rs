use serde::{Deserialize, Serialize};

const IMG_W500: &str = "https://image.tmdb.org/t/p/w500";
const IMG_W1280: &str = "https://image.tmdb.org/t/p/w1280";

// ── Public output types (serialised to frontend) ─────────────────────────────

#[derive(Debug, Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TmdbCastMember {
    pub name: String,
    pub character: String,
    pub profile_url: Option<String>,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TmdbMetadata {
    pub tmdb_id: u64,
    pub title: String,
    pub tagline: String,
    pub overview: String,
    pub poster_url: Option<String>,
    pub backdrop_url: Option<String>,
    pub vote_average: f64,
    pub vote_count: u64,
    pub release_date: String,
    pub runtime_mins: Option<u64>,
    pub genres: Vec<String>,
    pub cast: Vec<TmdbCastMember>,
    pub director: Option<String>,
    pub trailer_key: Option<String>,
    pub media_type: String,
}

// ── Internal TMDB API response structs ───────────────────────────────────────

#[derive(Deserialize)]
struct SearchResponse {
    results: Vec<SearchResult>,
}

#[derive(Deserialize)]
struct SearchResult {
    id: u64,
}

#[derive(Deserialize)]
struct DetailsResponse {
    id: u64,
    title: Option<String>,
    name: Option<String>,
    tagline: Option<String>,
    overview: Option<String>,
    poster_path: Option<String>,
    backdrop_path: Option<String>,
    vote_average: Option<f64>,
    vote_count: Option<u64>,
    release_date: Option<String>,
    first_air_date: Option<String>,
    runtime: Option<u64>,
    genres: Option<Vec<Genre>>,
    credits: Option<Credits>,
    videos: Option<VideoResults>,
}

#[derive(Deserialize)]
struct Genre {
    name: String,
}

#[derive(Deserialize)]
struct Credits {
    cast: Vec<CastMember>,
    crew: Vec<CrewMember>,
}

#[derive(Deserialize)]
struct CastMember {
    name: Option<String>,
    character: Option<String>,
    profile_path: Option<String>,
    order: Option<u32>,
}

#[derive(Deserialize)]
struct CrewMember {
    name: Option<String>,
    job: Option<String>,
}

#[derive(Deserialize)]
struct VideoResults {
    results: Vec<Video>,
}

#[derive(Deserialize)]
struct Video {
    key: String,
    site: String,
    #[serde(rename = "type")]
    video_type: String,
    official: Option<bool>,
}

// ── Trending response ────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TmdbTrendingItem {
    pub tmdb_id: u64,
    pub title: String,
    pub overview: String,
    pub poster_url: Option<String>,
    pub backdrop_url: Option<String>,
    pub vote_average: f64,
    pub release_date: String,
    pub media_type: String,
}

#[derive(Deserialize)]
struct TrendingResponse {
    results: Vec<TrendingResult>,
}

#[derive(Deserialize)]
struct TrendingResult {
    id: u64,
    title: Option<String>,
    name: Option<String>,
    overview: Option<String>,
    poster_path: Option<String>,
    backdrop_path: Option<String>,
    vote_average: Option<f64>,
    release_date: Option<String>,
    first_air_date: Option<String>,
    media_type: Option<String>,
}

/// Fetch TMDB trending titles for the current week.
/// `media_type` = "movie" | "tv" | "all"
#[tauri::command]
pub async fn fetch_tmdb_trending(
    media_type: String,
    api_key: String,
) -> Result<Vec<TmdbTrendingItem>, String> {
    if api_key.trim().is_empty() {
        return Err("No TMDB API key configured.".into());
    }
    let kind = match media_type.as_str() {
        "tv" => "tv",
        "all" => "all",
        _ => "movie",
    };
    let url = format!(
        "https://api.themoviedb.org/3/trending/{}/week?api_key={}",
        kind,
        api_key.trim()
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let resp: TrendingResponse = client
        .get(&url)
        .send().await.map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;

    Ok(resp.results.into_iter().map(|r| TmdbTrendingItem {
        tmdb_id: r.id,
        title: r.title.or(r.name).unwrap_or_default(),
        overview: r.overview.unwrap_or_default(),
        poster_url: r.poster_path.filter(|p| !p.is_empty()).map(|p| format!("{}{}", IMG_W500, p)),
        backdrop_url: r.backdrop_path.filter(|p| !p.is_empty()).map(|p| format!("{}{}", IMG_W1280, p)),
        vote_average: r.vote_average.unwrap_or(0.0),
        release_date: r.release_date.or(r.first_air_date).unwrap_or_default(),
        media_type: r.media_type.unwrap_or_else(|| kind.to_string()),
    }).collect())
}

// ── Similar / Recommendations response ──────────────────────────────────────

#[derive(Deserialize)]
struct SimilarResponse {
    results: Vec<TrendingResult>,
}

/// Fetch curated similar titles for a given TMDB ID.
/// Calls /recommendations first (editorial), then /similar (tag-based), merges, de-dups.
/// Returns at most 30 items reusing the TmdbTrendingItem shape.
#[tauri::command]
pub async fn fetch_tmdb_similar(
    tmdb_id: u64,
    media_type: String,
    api_key: String,
) -> Result<Vec<TmdbTrendingItem>, String> {
    if api_key.trim().is_empty() {
        return Err("No TMDB API key configured.".into());
    }
    let kind = if media_type == "tv" { "tv" } else { "movie" };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let rec_url = format!(
        "https://api.themoviedb.org/3/{}/{}/recommendations?api_key={}&language=en-US&page=1",
        kind, tmdb_id, api_key.trim()
    );
    let sim_url = format!(
        "https://api.themoviedb.org/3/{}/{}/similar?api_key={}&language=en-US&page=1",
        kind, tmdb_id, api_key.trim()
    );

    let (rec_resp, sim_resp) = tokio::join!(
        client.get(&rec_url).send(),
        client.get(&sim_url).send(),
    );

    let mut seen = std::collections::HashSet::new();
    let mut merged: Vec<TmdbTrendingItem> = Vec::new();

    let parse = |results: Vec<TrendingResult>| -> Vec<TmdbTrendingItem> {
        results.into_iter().map(|r| TmdbTrendingItem {
            tmdb_id: r.id,
            title: r.title.or(r.name).unwrap_or_default(),
            overview: r.overview.unwrap_or_default(),
            poster_url: r.poster_path.filter(|p| !p.is_empty()).map(|p| format!("{}{}", IMG_W500, p)),
            backdrop_url: r.backdrop_path.filter(|p| !p.is_empty()).map(|p| format!("{}{}", IMG_W1280, p)),
            vote_average: r.vote_average.unwrap_or(0.0),
            release_date: r.release_date.or(r.first_air_date).unwrap_or_default(),
            media_type: kind.to_string(),
        }).collect()
    };

    if let Ok(r) = rec_resp {
        if let Ok(body) = r.json::<SimilarResponse>().await {
            for item in parse(body.results) {
                if seen.insert(item.tmdb_id) { merged.push(item); }
            }
        }
    }
    if let Ok(r) = sim_resp {
        if let Ok(body) = r.json::<SimilarResponse>().await {
            for item in parse(body.results) {
                if seen.insert(item.tmdb_id) { merged.push(item); }
            }
        }
    }

    merged.truncate(30);
    Ok(merged)
}

// ── Tauri command ─────────────────────────────────────────────────────────────

/// Fetch movie or TV metadata from TMDB v3.
/// `media_type` = "movie" | "tv".
/// Appends credits and videos in a single request.
/// Free API key from https://www.themoviedb.org/settings/api
#[tauri::command]
pub async fn fetch_tmdb(
    title: String,
    year: Option<String>,
    media_type: String,
    api_key: String,
) -> Result<TmdbMetadata, String> {
    if api_key.trim().is_empty() {
        return Err("No TMDB API key configured. Add one in Settings → Integrations.".into());
    }

    let kind = if media_type == "tv" { "tv" } else { "movie" };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    // ── Step 1: search by title (+ year when available) ──────────────────────
    let year_param = if kind == "tv" { "first_air_date_year" } else { "year" };
    let mut search_url = format!(
        "https://api.themoviedb.org/3/search/{}?api_key={}&query={}&include_adult=false",
        kind,
        api_key.trim(),
        urlencoding::encode(&title),
    );
    if let Some(y) = &year {
        let y4 = &y[..4.min(y.len())];
        if y4.len() == 4 && y4.chars().all(|c| c.is_ascii_digit()) {
            search_url.push_str(&format!("&{}={}", year_param, y4));
        }
    }

    let search: SearchResponse = client
        .get(&search_url)
        .send().await.map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;

    let tmdb_id = search.results.into_iter().next()
        .ok_or_else(|| format!("\"{}\" not found on TMDB", title))?.id;

    // ── Step 2: full details with credits + videos in one round-trip ─────────
    let details_url = format!(
        "https://api.themoviedb.org/3/{}/{}?api_key={}&append_to_response=credits,videos",
        kind, tmdb_id, api_key.trim()
    );

    let d: DetailsResponse = client
        .get(&details_url)
        .send().await.map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;

    // ── Build image URLs ──────────────────────────────────────────────────────
    let poster_url = d.poster_path.as_deref().filter(|p| !p.is_empty())
        .map(|p| format!("{}{}", IMG_W500, p));
    let backdrop_url = d.backdrop_path.as_deref().filter(|p| !p.is_empty())
        .map(|p| format!("{}{}", IMG_W1280, p));

    // ── Genres ───────────────────────────────────────────────────────────────
    let genres: Vec<String> = d.genres.unwrap_or_default()
        .into_iter().map(|g| g.name).collect();

    // ── Director + top-billed cast ────────────────────────────────────────────
    let (director, cast) = match d.credits {
        None => (None, vec![]),
        Some(credits) => {
            let dir = credits.crew.iter()
                .find(|c| c.job.as_deref() == Some("Director"))
                .and_then(|c| c.name.clone());
            let mut sorted = credits.cast;
            sorted.sort_by_key(|c| c.order.unwrap_or(u32::MAX));
            let cast = sorted.into_iter().take(12).map(|c| TmdbCastMember {
                name: c.name.unwrap_or_default(),
                character: c.character.unwrap_or_default(),
                profile_url: c.profile_path.filter(|p| !p.is_empty())
                    .map(|p| format!("{}{}", IMG_W500, p)),
            }).collect();
            (dir, cast)
        }
    };

    // ── Trailer: YouTube official Trailer > Trailer > Teaser ─────────────────
    let trailer_key = d.videos.and_then(|v| {
        let yt: Vec<_> = v.results.into_iter()
            .filter(|v| v.site == "YouTube")
            .collect();
        yt.iter()
            .find(|v| v.video_type == "Trailer" && v.official.unwrap_or(false))
            .or_else(|| yt.iter().find(|v| v.video_type == "Trailer"))
            .or_else(|| yt.iter().find(|v| v.video_type == "Teaser"))
            .map(|v| v.key.clone())
    });

    Ok(TmdbMetadata {
        tmdb_id: d.id,
        title: d.title.or(d.name).unwrap_or(title),
        tagline: d.tagline.unwrap_or_default(),
        overview: d.overview.unwrap_or_default(),
        poster_url,
        backdrop_url,
        vote_average: d.vote_average.unwrap_or(0.0),
        vote_count: d.vote_count.unwrap_or(0),
        release_date: d.release_date.or(d.first_air_date).unwrap_or_default(),
        runtime_mins: d.runtime,
        genres,
        cast,
        director,
        trailer_key,
        media_type: kind.to_string(),
    })
}
