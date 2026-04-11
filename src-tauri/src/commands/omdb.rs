use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OmdbMetadata {
    pub title: String,
    pub year: String,
    pub rated: String,
    pub released: String,
    pub runtime: String,
    pub genre: String,
    pub director: String,
    pub writer: String,
    pub actors: String,
    pub plot: String,
    pub poster: String,
    pub imdb_rating: String,
    pub imdb_votes: String,
    pub imdb_id: String,
    pub awards: String,
    pub box_office: String,
    #[serde(rename = "type")]
    pub media_type: String,
}

#[derive(Debug, Deserialize)]
struct OmdbResponse {
    #[serde(rename = "Title", default)]
    title: String,
    #[serde(rename = "Year", default)]
    year: String,
    #[serde(rename = "Rated", default)]
    rated: String,
    #[serde(rename = "Released", default)]
    released: String,
    #[serde(rename = "Runtime", default)]
    runtime: String,
    #[serde(rename = "Genre", default)]
    genre: String,
    #[serde(rename = "Director", default)]
    director: String,
    #[serde(rename = "Writer", default)]
    writer: String,
    #[serde(rename = "Actors", default)]
    actors: String,
    #[serde(rename = "Plot", default)]
    plot: String,
    #[serde(rename = "Poster", default)]
    poster: String,
    #[serde(rename = "imdbRating", default)]
    imdb_rating: String,
    #[serde(rename = "imdbVotes", default)]
    imdb_votes: String,
    #[serde(rename = "imdbID", default)]
    imdb_id: String,
    #[serde(rename = "Awards", default)]
    awards: String,
    #[serde(rename = "BoxOffice", default)]
    box_office: String,
    #[serde(rename = "Type", default)]
    media_type: String,
    #[serde(rename = "Response", default)]
    response: String,
    #[serde(rename = "Error", default)]
    error: String,
}

/// Fetch metadata from OMDb (https://www.omdbapi.com).
/// Requires a free API key from omdbapi.com.
/// `title` is the movie/series name; `year` is optional (improves accuracy).
#[tauri::command]
pub async fn fetch_omdb(
    title: String,
    year: Option<String>,
    api_key: String,
) -> Result<OmdbMetadata, String> {
    if api_key.trim().is_empty() {
        return Err("No OMDb API key configured. Add one in Settings → Integrations.".into());
    }

    let mut url = format!(
        "https://www.omdbapi.com/?t={}&apikey={}",
        urlencoding::encode(&title),
        api_key.trim()
    );
    if let Some(y) = &year {
        if !y.is_empty() {
            url.push_str(&format!("&y={}", &y[..4.min(y.len())]));
        }
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let resp: OmdbResponse = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    if resp.response == "False" {
        return Err(if resp.error.is_empty() {
            "Movie not found on OMDb.".into()
        } else {
            resp.error
        });
    }

    Ok(OmdbMetadata {
        title: resp.title,
        year: resp.year,
        rated: resp.rated,
        released: resp.released,
        runtime: resp.runtime,
        genre: resp.genre,
        director: resp.director,
        writer: resp.writer,
        actors: resp.actors,
        plot: resp.plot,
        poster: resp.poster,
        imdb_rating: resp.imdb_rating,
        imdb_votes: resp.imdb_votes,
        imdb_id: resp.imdb_id,
        awards: resp.awards,
        box_office: resp.box_office,
        media_type: resp.media_type,
    })
}
