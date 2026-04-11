use crate::epg::{xmltv, EpgCache, EpgProgram, EpgSource};
use crate::persist;
use tauri::{AppHandle, State};
use uuid::Uuid;

type CmdResult<T> = Result<T, String>;

#[tauri::command]
pub async fn add_epg_source(
    state: State<'_, EpgCache>,
    app: AppHandle,
    name: String,
    url: String,
) -> CmdResult<EpgSource> {
    let source = EpgSource {
        id: Uuid::new_v4().to_string(),
        url,
        name,
    };
    let mut sources = state.sources.lock().unwrap();
    sources.push(source.clone());
    persist::save(&app, "epg_sources.json", &*sources);
    Ok(source)
}

#[tauri::command]
pub async fn list_epg_sources(state: State<'_, EpgCache>) -> CmdResult<Vec<EpgSource>> {
    Ok(state.sources.lock().unwrap().clone())
}

#[tauri::command]
pub async fn remove_epg_source(
    state: State<'_, EpgCache>,
    app: AppHandle,
    id: String,
) -> CmdResult<()> {
    let mut sources = state.sources.lock().unwrap();
    sources.retain(|s| s.id != id);
    persist::save(&app, "epg_sources.json", &*sources);
    Ok(())
}

#[tauri::command]
pub async fn fetch_epg(
    state: State<'_, EpgCache>,
    source_url: String,
) -> CmdResult<Vec<EpgProgram>> {
    let programs = xmltv::fetch_and_parse(&source_url)
        .await
        .map_err(|e| e.to_string())?;

    let mut cache = state.programs.lock().unwrap();
    for prog in &programs {
        cache
            .entry(prog.channel_id.clone())
            .or_default()
            .push(prog.clone());
    }

    Ok(programs)
}

#[tauri::command]
pub async fn get_epg_for_channel(
    state: State<'_, EpgCache>,
    channel_id: String,
) -> CmdResult<Vec<EpgProgram>> {
    let cache = state.programs.lock().unwrap();
    Ok(cache.get(&channel_id).cloned().unwrap_or_default())
}
