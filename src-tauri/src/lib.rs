mod db;
mod models;
mod ollama;
mod semantic;
mod server;
mod spotify_import;
mod ytdlp;

use chrono::{Datelike, Timelike};
use db::Database;
use models::*;
use ollama::OllamaClient;
use semantic::{ANNIndex, SharedANNIndex};
use server::StreamServer;
use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tokio::sync::{Mutex, RwLock, Semaphore};

pub struct AppState {
    pub db: Arc<Mutex<Database>>,
    pub server: Arc<Mutex<StreamServer>>,
    pub ollama: Arc<Mutex<Option<OllamaClient>>>,
    pub ann_index: SharedANNIndex,
}

// ============================================================================
// YT-DLP COMMANDS
// ============================================================================

#[tauri::command]
async fn search_youtube(
    query: String,
    max_results: Option<i64>,
) -> Result<Vec<SearchResult>, String> {
    let count = max_results.unwrap_or(25);
    ytdlp::search(&query, count)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_track_info(video_id: String) -> Result<TrackInfo, String> {
    ytdlp::get_info(&video_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_stream_url(state: State<'_, AppState>, video_id: String) -> Result<String, String> {
    let server = state.server.lock().await;
    let url = server.get_stream_url(&video_id);
    Ok(url)
}

#[tauri::command]
async fn get_video_stream_url(
    state: State<'_, AppState>,
    video_id: String,
) -> Result<String, String> {
    let server = state.server.lock().await;
    let url = server.get_video_stream_url(&video_id);
    Ok(url)
}

#[tauri::command]
async fn check_ffmpeg_installed() -> Result<String, String> {
    ytdlp::check_ffmpeg().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn check_edge_tts() -> Result<String, String> {
    let output = tokio::process::Command::new("edge-tts")
        .arg("--version")
        .output()
        .await
        .map_err(|_| "edge-tts not found. Install with: pip install edge-tts".to_string())?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(if version.is_empty() {
            "edge-tts installed".to_string()
        } else {
            version
        })
    } else {
        Err("edge-tts not found. Install with: pip install edge-tts".to_string())
    }
}

#[tauri::command]
async fn speak_with_edge_tts(
    text: String,
    voice: String,
    rate: f64,
    pitch: f64,
) -> Result<String, String> {
    // Convert rate/pitch to edge-tts format
    let rate_str = format!("{:+.0}%", (rate - 1.0) * 100.0);
    let pitch_str = format!("{:+.0}Hz", (pitch - 1.0) * 50.0);

    // Generate unique filename in system temp dir
    let filename = format!("ytmfree_dj_{}.mp3", uuid::Uuid::new_v4());
    let temp_path = std::env::temp_dir().join(&filename);
    let temp_path_str = temp_path.to_string_lossy().to_string();

    let output = tokio::process::Command::new("edge-tts")
        .args([
            "--voice",
            &voice,
            "--text",
            &text,
            "--rate",
            &rate_str,
            "--pitch",
            &pitch_str,
            "--write-media",
            &temp_path_str,
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run edge-tts: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("edge-tts failed: {}", stderr));
    }

    Ok(format!("http://localhost:3456/tts/{}", filename))
}

#[tauri::command]
async fn cleanup_tts_files() -> Result<(), String> {
    let temp_dir = std::env::temp_dir();
    if let Ok(entries) = std::fs::read_dir(&temp_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with("ytmfree_dj_") && name.ends_with(".mp3") {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn download_track(
    state: State<'_, AppState>,
    video_id: String,
    title: String,
    artist: String,
    thumbnail: String,
) -> Result<Track, String> {
    // Get download path
    let download_path = ytdlp::download(&video_id)
        .await
        .map_err(|e| e.to_string())?;

    // Save to database
    let db = state.db.lock().await;
    let track = db
        .add_track(&video_id, &title, &artist, &thumbnail, Some(&download_path))
        .map_err(|e| e.to_string())?;

    Ok(track)
}

// ============================================================================
// PLAYLIST COMMANDS
// ============================================================================

fn create_playlist_db_helper(
    db: &Database,
    name: &str,
    description: Option<&str>,
) -> Result<Playlist, String> {
    db.create_playlist(name, description)
        .map_err(|e| e.to_string())
}

fn delete_playlist_db_helper(db: &Database, playlist_id: &str) -> Result<(), String> {
    db.delete_playlist(playlist_id).map_err(|e| e.to_string())
}

fn add_to_playlist_db_helper(
    db: &Database,
    playlist_id: &str,
    video_id: &str,
    title: &str,
    artist: &str,
    thumbnail: &str,
    duration: Option<i64>,
) -> Result<Track, String> {
    let track = db
        .add_track(video_id, title, artist, thumbnail, None)
        .map_err(|e| e.to_string())?;

    if let Some(dur) = duration {
        let _ = db.update_track_duration(video_id, dur);
    }

    db.add_track_to_playlist(playlist_id, &track.id)
        .map_err(|e| e.to_string())?;

    Ok(track)
}

fn remove_from_playlist_db_helper(
    db: &Database,
    playlist_id: &str,
    track_id: &str,
) -> Result<(), String> {
    db.remove_track_from_playlist(playlist_id, track_id)
        .map_err(|e| e.to_string())
}

fn cleanup_delete_track_db_helper(db: &Database, track_id: &str) -> Result<(), String> {
    db.delete_track(track_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_playlists(state: State<'_, AppState>) -> Result<Vec<Playlist>, String> {
    let db = state.db.lock().await;
    db.get_playlists().map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_playlist(
    state: State<'_, AppState>,
    name: String,
    description: Option<String>,
) -> Result<Playlist, String> {
    let db = state.db.lock().await;
    create_playlist_db_helper(&db, &name, description.as_deref())
}

#[tauri::command]
async fn delete_playlist(state: State<'_, AppState>, playlist_id: String) -> Result<(), String> {
    let db = state.db.lock().await;
    delete_playlist_db_helper(&db, &playlist_id)
}

#[tauri::command]
async fn update_playlist(
    state: State<'_, AppState>,
    playlist_id: String,
    name: String,
    description: Option<String>,
) -> Result<Playlist, String> {
    let db = state.db.lock().await;
    db.update_playlist(&playlist_id, &name, description.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_playlist_tracks(
    state: State<'_, AppState>,
    playlist_id: String,
) -> Result<Vec<Track>, String> {
    let db = state.db.lock().await;
    db.get_playlist_tracks(&playlist_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_to_playlist(
    state: State<'_, AppState>,
    playlist_id: String,
    video_id: String,
    title: String,
    artist: String,
    thumbnail: String,
    duration: Option<i64>,
) -> Result<Track, String> {
    let db = state.db.lock().await;
    add_to_playlist_db_helper(
        &db,
        &playlist_id,
        &video_id,
        &title,
        &artist,
        &thumbnail,
        duration,
    )
}

#[tauri::command]
async fn remove_from_playlist(
    state: State<'_, AppState>,
    playlist_id: String,
    track_id: String,
) -> Result<(), String> {
    let db = state.db.lock().await;
    remove_from_playlist_db_helper(&db, &playlist_id, &track_id)
}

// ============================================================================
// LIBRARY COMMANDS
// ============================================================================

#[tauri::command]
async fn get_library(state: State<'_, AppState>) -> Result<Vec<Track>, String> {
    let db = state.db.lock().await;
    db.get_all_tracks().map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_downloads(state: State<'_, AppState>) -> Result<Vec<Track>, String> {
    let db = state.db.lock().await;
    db.get_downloaded_tracks().map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_recently_played(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Vec<Track>, String> {
    let db = state.db.lock().await;
    db.get_recently_played(limit.unwrap_or(20))
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_play_count(state: State<'_, AppState>, video_id: String) -> Result<(), String> {
    let db = state.db.lock().await;
    db.update_play_count(&video_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn toggle_favorite(state: State<'_, AppState>, video_id: String) -> Result<bool, String> {
    let db = state.db.lock().await;
    db.toggle_favorite(&video_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_favorites(state: State<'_, AppState>) -> Result<Vec<Track>, String> {
    let db = state.db.lock().await;
    db.get_favorites().map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_total_play_count(state: State<'_, AppState>) -> Result<u32, String> {
    let db = state.db.lock().await;
    db.get_total_play_count().map_err(|e| e.to_string())
}

// ============================================================================
// SETTINGS COMMANDS
// ============================================================================

#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    let db = state.db.lock().await;
    db.get_settings().map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_settings(state: State<'_, AppState>, settings: Settings) -> Result<(), String> {
    let db = state.db.lock().await;
    db.update_settings(&settings).map_err(|e| e.to_string())
}

#[tauri::command]
async fn check_ytdlp() -> Result<String, String> {
    ytdlp::check_installation().await.map_err(|e| e.to_string())
}

// ============================================================================
// SPOTIFY IMPORT COMMANDS
// ============================================================================

#[tauri::command]
async fn parse_spotify_csv(content: String) -> Result<Vec<spotify_import::SpotifyTrack>, String> {
    spotify_import::parse_exportify_csv(&content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn search_track_on_youtube(
    track: spotify_import::SpotifyTrack,
) -> Result<spotify_import::ImportResult, String> {
    Ok(spotify_import::search_youtube_for_track(&track).await)
}

#[tauri::command]
async fn import_spotify_csv_file(
    file_path: String,
) -> Result<Vec<spotify_import::ImportResult>, String> {
    spotify_import::import_from_csv(&file_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn scan_spotify_folder(folder_path: String) -> Result<Vec<spotify_import::CsvFileInfo>, String> {
    spotify_import::scan_folder_for_csv(&folder_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_default_spotify_folder() -> String {
    spotify_import::get_default_spotify_folder()
}

#[tauri::command]
fn read_csv_file(file_path: String) -> Result<String, String> {
    std::fs::read_to_string(&file_path).map_err(|e| e.to_string())
}

// ============================================================================
// OLLAMA AI COMMANDS
// ============================================================================

/// Helper function to get or create OllamaClient from AppState
async fn get_ollama_client(state: &State<'_, AppState>) -> Result<(String, String), String> {
    let db = state.db.lock().await;
    let settings = db.get_settings().map_err(|e| e.to_string())?;
    drop(db);

    if !settings.ollama_enabled {
        return Err("Ollama is disabled in settings".to_string());
    }

    Ok((settings.ollama_url, settings.ollama_model))
}

#[tauri::command]
async fn ollama_check_available(
    state: State<'_, AppState>,
    url: Option<String>,
) -> Result<bool, String> {
    let client = if let Some(u) = url {
        // If URL is provided, use it directly (for testing connection in settings)
        ollama::OllamaClient::with_config(&u, "")
    } else {
        // Otherwise use settings
        let (ollama_url, _) = get_ollama_client(&state).await?;
        ollama::OllamaClient::with_config(&ollama_url, "")
    };
    Ok(client.is_available().await)
}

#[tauri::command]
async fn ollama_list_models(
    state: State<'_, AppState>,
    url: Option<String>,
) -> Result<Vec<String>, String> {
    let client = if let Some(u) = url {
        ollama::OllamaClient::with_config(&u, "")
    } else {
        let (ollama_url, _) = get_ollama_client(&state).await?;
        ollama::OllamaClient::with_config(&ollama_url, "")
    };
    client.list_models().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn ollama_enhance_search(
    state: State<'_, AppState>,
    query: String,
    recent_genres: Vec<String>,
    model: Option<String>,
) -> Result<Vec<String>, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let prompt = ollama::Prompts::enhance_search(&query, &recent_genres);

    #[derive(serde::Deserialize)]
    struct Response {
        queries: Vec<String>,
    }

    let result: Response = client
        .generate_json(&prompt)
        .await
        .map_err(|e| e.to_string())?;

    Ok(result.queries)
}

#[tauri::command]
async fn ollama_analyze_track(
    state: State<'_, AppState>,
    title: String,
    artist: String,
    model: Option<String>,
) -> Result<ollama::TrackMetadataAI, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let prompt = ollama::Prompts::analyze_track(&title, &artist);

    // Use temperature 0.2 for consistency in tagging (FAZA 2)
    client
        .generate_json_with_temp(&prompt, 0.2)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ollama_parse_command(
    state: State<'_, AppState>,
    input: String,
    model: Option<String>,
) -> Result<ollama::PlayerCommand, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let available_views = vec![
        "home",
        "search",
        "library",
        "playlists",
        "favorites",
        "downloads",
        "settings",
        "import",
        "smart-playlist",
        "smart-queue",
    ];
    let prompt = ollama::Prompts::parse_command(&input, &available_views);

    client
        .generate_json(&prompt)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ollama_generate_playlist(
    state: State<'_, AppState>,
    description: String,
    duration_minutes: Option<u32>,
    existing_artists: Vec<String>,
    model: Option<String>,
) -> Result<ollama::PlaylistSuggestion, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let prompt =
        ollama::Prompts::generate_playlist(&description, duration_minutes, &existing_artists);

    client
        .generate_json(&prompt)
        .await
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct SpotifyMatchResult {
    selected_id: Option<String>,
    confidence: String,
    reason: String,
}

#[tauri::command]
async fn ollama_verify_spotify_match(
    state: State<'_, AppState>,
    spotify_title: String,
    spotify_artist: String,
    spotify_album: String,
    spotify_duration_sec: Option<i64>,
    youtube_results: Vec<(String, String, String, Option<i64>)>, // (id, title, channel, duration)
    model: Option<String>,
) -> Result<SpotifyMatchResult, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let prompt = ollama::Prompts::verify_spotify_match(
        &spotify_title,
        &spotify_artist,
        &spotify_album,
        spotify_duration_sec,
        &youtube_results,
    );

    client
        .generate_json(&prompt)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ollama_mood_search(
    state: State<'_, AppState>,
    mood: String,
    user_library_genres: Vec<String>,
    model: Option<String>,
) -> Result<ollama::MoodSearchResponse, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let prompt = ollama::Prompts::mood_search(&mood, &user_library_genres);

    client
        .generate_json(&prompt)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ollama_activity_search(
    state: State<'_, AppState>,
    activity: String,
    duration_minutes: Option<u32>,
    model: Option<String>,
) -> Result<ollama::ActivitySearchResponse, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let prompt = ollama::Prompts::activity_search(&activity, duration_minutes);

    client
        .generate_json(&prompt)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ollama_era_search(
    state: State<'_, AppState>,
    era: String,
    genre_filter: Option<String>,
    model: Option<String>,
) -> Result<ollama::EraSearchResponse, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let prompt = ollama::Prompts::era_search(&era, genre_filter.as_deref());

    client
        .generate_json(&prompt)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ollama_similar_artists(
    state: State<'_, AppState>,
    artist_name: String,
    user_favorites: Vec<String>,
    model: Option<String>,
) -> Result<ollama::SimilarArtistsResponse, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let prompt = ollama::Prompts::similar_artists(&artist_name, &user_favorites);

    client
        .generate_json(&prompt)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ollama_lyric_search(
    state: State<'_, AppState>,
    theme: String,
    model: Option<String>,
) -> Result<ollama::LyricSearchResponse, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let prompt = ollama::Prompts::lyric_search(&theme);

    client
        .generate_json(&prompt)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ollama_cross_language_search(
    state: State<'_, AppState>,
    query: String,
    target_languages: Vec<String>,
    model: Option<String>,
) -> Result<ollama::CrossLanguageSearchResponse, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let prompt = ollama::Prompts::cross_language_search(&query, &target_languages);

    client
        .generate_json(&prompt)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ollama_contextual_suggestions(
    state: State<'_, AppState>,
    recent_tracks: Vec<(String, String)>,
    time_of_day: String,
    day_of_week: String,
    model: Option<String>,
) -> Result<ollama::ContextualSuggestionsResponse, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let prompt =
        ollama::Prompts::contextual_suggestions(&recent_tracks, &time_of_day, &day_of_week);

    client
        .generate_json(&prompt)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ollama_smart_autocomplete(
    state: State<'_, AppState>,
    partial_query: String,
    popular_searches: Vec<String>,
    model: Option<String>,
) -> Result<ollama::SmartAutocompleteResponse, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let prompt = ollama::Prompts::smart_autocomplete(&partial_query, &popular_searches);

    client
        .generate_json(&prompt)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ollama_resolve_vague_query(
    state: State<'_, AppState>,
    vague_query: String,
    context_tracks: Vec<(String, String)>,
    model: Option<String>,
) -> Result<ollama::VagueQueryResponse, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let prompt = ollama::Prompts::resolve_vague_query(&vague_query, &context_tracks);

    client
        .generate_json(&prompt)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================ // Ollama Auto-Tagging (FAZA 2)
// ============================================================================

fn ollama_get_track_metadata_db_helper(
    db: &Database,
    track_id: &str,
) -> Result<Option<TrackMetadataDB>, String> {
    match db.get_track_metadata(track_id) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(_) => Ok(None),
    }
}

fn ollama_get_untagged_count_db_helper(db: &Database) -> Result<usize, String> {
    db.get_unanalyzed_tracks()
        .map(|tracks| tracks.len())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ollama_get_track_metadata(
    state: State<'_, AppState>,
    track_id: String,
) -> Result<Option<TrackMetadataDB>, String> {
    let db = state.db.lock().await;
    ollama_get_track_metadata_db_helper(&db, &track_id)
}

#[tauri::command]
async fn ollama_get_untagged_count(state: State<'_, AppState>) -> Result<usize, String> {
    let db = state.db.lock().await;
    ollama_get_untagged_count_db_helper(&db)
}

#[tauri::command]
async fn ollama_batch_analyze_tracks(
    state: State<'_, AppState>,
    track_ids: Vec<String>,
    model: Option<String>,
    app: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;

    // Clone values for later use
    let model_to_use = model.as_ref().unwrap_or(&ollama_model).clone();

    let client = ollama::OllamaClient::with_config(&ollama_url, &model_to_use);

    let total = track_ids.len();
    let mut analyzed = Vec::new();
    let mut errors = Vec::new();

    // Get tracks info (supports both UUID id and video_id)
    let db_lock = state.db.lock().await;
    let tracks: Vec<(String, String, String)> = track_ids
        .iter()
        .filter_map(|id| {
            // Try video_id first, then fall back to UUID lookup
            db_lock
                .get_track_by_video_id(id)
                .or_else(|_| db_lock.get_track_by_uuid(id))
                .ok()
                .map(|t| (t.id.clone(), t.title.clone(), t.artist.clone()))
        })
        .collect();
    drop(db_lock);

    // Create semaphore for controlled concurrency (max 10 parallel requests)
    let semaphore = Arc::new(Semaphore::new(10));
    let db = state.db.clone();
    let mut tasks = Vec::new();

    // Process tracks in parallel with controlled concurrency
    for (idx, (id, title, artist)) in tracks.into_iter().enumerate() {
        let client = client.clone();
        let semaphore = Arc::clone(&semaphore);
        let app_handle = app.clone();
        let db = db.clone();
        let model_to_use_clone = model_to_use.clone();

        let task = tokio::spawn(async move {
            // Acquire permit before processing
            let _permit = semaphore.acquire().await.ok()?;

            let progress = ((idx + 1) as f32 / total as f32 * 100.0) as u32;

            // Emit progress event
            let _ = app_handle.emit(
                "ai-tagging-progress",
                serde_json::json!({
                    "current": idx + 1,
                    "total": total,
                    "progress": progress,
                    "track_id": id,
                    "title": title,
                }),
            );

            // Analyze track
            let prompt = ollama::Prompts::analyze_track(&title, &artist);

            match client
                .generate_json_with_temp::<ollama::TrackMetadataAI>(&prompt, 0.2)
                .await
            {
                Ok(metadata) => {
                    // Save to DB
                    let db = db.lock().await;
                    if let Err(e) = db.save_track_metadata(&id, &metadata, &model_to_use_clone) {
                        Some(Err(format!("{}: {}", title, e)))
                    } else {
                        Some(Ok(id))
                    }
                }
                Err(e) => Some(Err(format!("{}: {}", title, e))),
            }
        });

        tasks.push((idx, task));
    }

    // Collect results in order
    tasks.sort_by(|a, b| a.0.cmp(&b.0));
    for (_, task) in tasks {
        if let Ok(Some(result)) = task.await {
            match result {
                Ok(track_id) => analyzed.push(track_id),
                Err(e) => errors.push(e),
            }
        }
    }

    // Emit completion event
    let _ = app.emit(
        "ai-tagging-complete",
        serde_json::json!({
            "analyzed": analyzed.len(),
            "errors": errors.len(),
            "error_messages": errors,
        }),
    );

    Ok(analyzed)
}

// ============================================================================
// SMART PLAYLIST GENERATION (FAZA 3)
// ============================================================================

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct CrossfadeSuggestion {
    pub duration_seconds: f32,
    pub reason: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct SmartPlaylistTrackMatch {
    pub track: Track,
    pub genre: Option<String>,
    pub mood: Option<String>,
    pub energy_level: Option<i32>,
    pub decade: Option<String>,
    pub score: f64, // 0.0 to 1.0 match quality
}

/// Generate a smart playlist plan using AI
#[tauri::command]
async fn smart_playlist_generate_plan(
    state: State<'_, AppState>,
    description: String,
    method: String,
    duration_minutes: Option<u32>,
    model: Option<String>,
) -> Result<ollama::SmartPlaylistPlan, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    // Get library context for better suggestions
    let db = state.db.lock().await;
    let (genres, moods) = db.get_unique_metadata_values().unwrap_or_default();
    drop(db);

    let prompt = ollama::Prompts::smart_playlist_plan(
        &description,
        &method,
        duration_minutes,
        &genres,
        &moods,
    );

    client
        .generate_json_with_temp(&prompt, 0.4)
        .await
        .map_err(|e| e.to_string())
}

fn smart_playlist_match_library_db_helper(
    db: &Database,
    genres: &[String],
    moods: &[String],
    energy_min: i32,
    energy_max: i32,
    decades: &[String],
    activities: &[String],
    limit: Option<i64>,
) -> Result<Vec<SmartPlaylistTrackMatch>, String> {
    let all = db
        .get_all_tracks_with_metadata()
        .map_err(|e| e.to_string())?;
    let max_tracks = limit.unwrap_or(50) as usize;

    let mut matches: Vec<SmartPlaylistTrackMatch> = all
        .into_iter()
        .filter_map(|(track, meta)| {
            let mut score = 0.0_f64;
            let mut criteria_count = 0.0;

            if !genres.is_empty() {
                criteria_count += 1.0;
                if let Some(ref g) = meta.genre {
                    if genres.iter().any(|cg| cg.eq_ignore_ascii_case(g)) {
                        score += 1.0;
                    }
                }
            }

            if !moods.is_empty() {
                criteria_count += 1.0;
                if let Some(ref m) = meta.mood {
                    if moods.iter().any(|cm| cm.eq_ignore_ascii_case(m)) {
                        score += 1.0;
                    }
                }
            }

            if energy_min > 1 || energy_max < 10 {
                criteria_count += 1.0;
                if let Some(e) = meta.energy_level {
                    if e >= energy_min && e <= energy_max {
                        score += 1.0;
                    }
                }
            }

            if !decades.is_empty() {
                criteria_count += 1.0;
                if let Some(ref d) = meta.decade {
                    if decades.iter().any(|cd| cd.eq_ignore_ascii_case(d)) {
                        score += 1.0;
                    }
                }
            }

            if !activities.is_empty() {
                criteria_count += 1.0;
                if let Some(ref tags) = meta.activity_tags {
                    let lower = tags.to_lowercase();
                    if activities.iter().any(|a| lower.contains(&a.to_lowercase())) {
                        score += 1.0;
                    }
                }
            }

            let normalized = if criteria_count > 0.0 {
                score / criteria_count
            } else {
                0.5
            };

            if normalized > 0.0 {
                Some(SmartPlaylistTrackMatch {
                    track,
                    genre: meta.genre,
                    mood: meta.mood,
                    energy_level: meta.energy_level,
                    decade: meta.decade,
                    score: normalized,
                })
            } else {
                None
            }
        })
        .collect();

    matches.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    matches.truncate(max_tracks);

    Ok(matches)
}

/// Match library tracks against smart playlist criteria
#[tauri::command]
async fn smart_playlist_match_library(
    state: State<'_, AppState>,
    genres: Vec<String>,
    moods: Vec<String>,
    energy_min: i32,
    energy_max: i32,
    decades: Vec<String>,
    activities: Vec<String>,
    limit: Option<i64>,
) -> Result<Vec<SmartPlaylistTrackMatch>, String> {
    let db = state.db.lock().await;
    smart_playlist_match_library_db_helper(
        &db,
        &genres,
        &moods,
        energy_min,
        energy_max,
        &decades,
        &activities,
        limit,
    )
}

/// Generate a "more like this" plan from a seed track
#[tauri::command]
async fn smart_playlist_from_seed(
    state: State<'_, AppState>,
    title: String,
    artist: String,
    track_id: Option<String>,
    model: Option<String>,
) -> Result<ollama::SmartPlaylistPlan, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    // Try to get existing metadata for better results
    let (genre, mood, energy, decade) = if let Some(ref tid) = track_id {
        let db = state.db.lock().await;
        if let Ok(meta) = db.get_track_metadata(tid) {
            (
                meta.genre.as_deref().map(str::to_owned),
                meta.mood.as_deref().map(str::to_owned),
                meta.energy_level,
                meta.decade.as_deref().map(str::to_owned),
            )
        } else {
            (None, None, None, None)
        }
    } else {
        (None, None, None, None)
    };

    let prompt = ollama::Prompts::seed_track_playlist(
        &title,
        &artist,
        genre.as_deref(),
        mood.as_deref(),
        energy,
        decade.as_deref(),
    );

    client
        .generate_json_with_temp(&prompt, 0.5)
        .await
        .map_err(|e| e.to_string())
}

/// Save smart playlist selection as a real playlist
#[tauri::command]
async fn smart_playlist_save(
    state: State<'_, AppState>,
    name: String,
    description: Option<String>,
    track_ids: Vec<String>,
    youtube_tracks: Vec<(String, String, String, String)>, // (video_id, title, artist, thumbnail)
) -> Result<Playlist, String> {
    let db = state.db.lock().await;

    // Ensure YouTube tracks exist in DB
    for (video_id, title, artist, thumbnail) in &youtube_tracks {
        let _ = db.add_track(video_id, title, artist, thumbnail, None);
    }

    // Create the playlist
    let playlist = db
        .create_playlist(&name, description.as_deref())
        .map_err(|e| e.to_string())?;

    // Add tracks to playlist - track_ids can be UUIDs or video_ids
    for track_id in &track_ids {
        // Try as UUID first, then as video_id
        if db.add_track_to_playlist(&playlist.id, track_id).is_err() {
            // Maybe it's a video_id, look up the UUID
            if let Ok(track) = db.get_track_by_video_id(track_id) {
                let _ = db.add_track_to_playlist(&playlist.id, &track.id);
            }
        }
    }

    // Return updated playlist with track count
    db.get_playlist(&playlist.id).map_err(|e| e.to_string())
}

// ============================================================================
// SMART QUEUE COMMANDS (FAZA 4 - I1-I6)
// ============================================================================

/// Helper: Build a summary string of library tracks with metadata for AI prompts
fn build_library_summary(tracks_with_meta: &[(Track, TrackMetadataDB)]) -> String {
    tracks_with_meta
        .iter()
        .map(|(t, m)| {
            format!(
                "{} | {} | {} | {} | {} | {}",
                t.id,
                t.title,
                t.artist,
                m.genre.as_deref().unwrap_or("?"),
                m.mood.as_deref().unwrap_or("?"),
                m.energy_level.unwrap_or(0)
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// I1: Smart auto-play — AI picks next track(s) from library
#[tauri::command]
async fn smart_queue_next(
    state: State<'_, AppState>,
    current_title: String,
    current_artist: String,
    current_track_id: Option<String>,
    recent_track_ids: Vec<String>,
    count: Option<usize>,
    model: Option<String>,
) -> Result<Vec<Track>, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let db = state.db.lock().await;
    let tracks_with_meta = db
        .get_all_tracks_with_metadata()
        .map_err(|e| e.to_string())?;
    drop(db);

    if tracks_with_meta.is_empty() {
        return Ok(vec![]);
    }

    // Get current track metadata if available
    let current_meta = current_track_id.as_ref().and_then(|id| {
        tracks_with_meta
            .iter()
            .find(|(t, _)| t.id == *id)
            .map(|(_, m)| m.clone())
    });

    let library_summary = build_library_summary(&tracks_with_meta);
    let n = count.unwrap_or(5);

    let prompt = ollama::Prompts::smart_queue_next(
        &current_title,
        &current_artist,
        current_meta.as_ref().and_then(|m| m.genre.as_deref()),
        current_meta.as_ref().and_then(|m| m.mood.as_deref()),
        current_meta.as_ref().and_then(|m| m.energy_level),
        &recent_track_ids,
        &library_summary,
        n,
    );

    let result: Vec<String> = client
        .generate_json_with_temp(&prompt, 0.6)
        .await
        .map_err(|e| e.to_string())?;

    // Map IDs back to Track objects
    let tracks: Vec<Track> = result
        .iter()
        .filter_map(|id| {
            tracks_with_meta
                .iter()
                .find(|(t, _)| t.id == *id)
                .map(|(t, _)| t.clone())
        })
        .collect();

    Ok(tracks)
}

/// I2: Smart crossfade suggestion between two tracks
#[tauri::command]
async fn smart_queue_crossfade(
    state: State<'_, AppState>,
    track_a_title: String,
    track_a_id: Option<String>,
    track_b_title: String,
    track_b_id: Option<String>,
    model: Option<String>,
) -> Result<CrossfadeSuggestion, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let db = state.db.lock().await;
    let meta_a = track_a_id.and_then(|id| db.get_track_metadata(&id).ok());
    let meta_b = track_b_id.and_then(|id| db.get_track_metadata(&id).ok());
    drop(db);

    let prompt = ollama::Prompts::crossfade_suggestion(
        &track_a_title,
        meta_a.as_ref().and_then(|m| m.genre.as_deref()),
        meta_a.as_ref().and_then(|m| m.energy_level),
        meta_a.as_ref().and_then(|m| m.tempo.as_deref()),
        &track_b_title,
        meta_b.as_ref().and_then(|m| m.genre.as_deref()),
        meta_b.as_ref().and_then(|m| m.energy_level),
        meta_b.as_ref().and_then(|m| m.tempo.as_deref()),
    );

    client
        .generate_json_with_temp(&prompt, 0.3)
        .await
        .map_err(|e| e.to_string())
}

/// I3-I5: Generate a sequence (wake-up, sleep, workout) from library tracks
#[tauri::command]
async fn smart_queue_sequence(
    state: State<'_, AppState>,
    mode: String,
    duration_minutes: Option<u32>,
    intensity: Option<String>,
    model: Option<String>,
) -> Result<Vec<Track>, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let db = state.db.lock().await;
    let tracks_with_meta = db
        .get_all_tracks_with_metadata()
        .map_err(|e| e.to_string())?;
    drop(db);

    if tracks_with_meta.is_empty() {
        return Ok(vec![]);
    }

    let library_summary = build_library_summary(&tracks_with_meta);
    let dur = duration_minutes.unwrap_or(30);

    let prompt = match mode.as_str() {
        "wake_up" => ollama::Prompts::wake_up_sequence(&library_summary, dur),
        "sleep" => ollama::Prompts::sleep_timer_sequence(&library_summary, dur),
        "workout" => ollama::Prompts::workout_pacer(
            &library_summary,
            dur,
            intensity.as_deref().unwrap_or("medium"),
        ),
        _ => return Err(format!("Unknown sequence mode: {}", mode)),
    };

    let result: Vec<String> = client
        .generate_json_with_temp(&prompt, 0.5)
        .await
        .map_err(|e| e.to_string())?;

    let tracks: Vec<Track> = result
        .iter()
        .filter_map(|id| {
            tracks_with_meta
                .iter()
                .find(|(t, _)| t.id == *id)
                .map(|(t, _)| t.clone())
        })
        .collect();

    Ok(tracks)
}

/// I6: Context-aware autoplay based on time of day and listening history
#[tauri::command]
async fn smart_queue_contextual(
    state: State<'_, AppState>,
    model: Option<String>,
) -> Result<Vec<Track>, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let db = state.db.lock().await;
    let tracks_with_meta = db
        .get_all_tracks_with_metadata()
        .map_err(|e| e.to_string())?;

    if tracks_with_meta.is_empty() {
        return Ok(vec![]);
    }

    let library_summary = build_library_summary(&tracks_with_meta);

    // Get current time context
    let now = chrono::Local::now();
    let hour = now.hour();
    let day_of_week = now.format("%A").to_string();

    // Get recent tracks to avoid
    let recent = db.get_play_history(1, 10).unwrap_or_default();
    let recent_str = if recent.is_empty() {
        "No recent listening history".to_string()
    } else {
        recent
            .iter()
            .filter_map(|event| {
                tracks_with_meta
                    .iter()
                    .find(|(t, _)| t.id == event.track_id)
                    .map(|(t, _)| format!("- {} by {}", t.title, t.artist))
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    drop(db);

    let prompt =
        ollama::Prompts::context_aware_autoplay(&library_summary, hour, &day_of_week, &recent_str);

    let result: Vec<String> = client
        .generate_json_with_temp(&prompt, 0.6)
        .await
        .map_err(|e| e.to_string())?;

    let tracks: Vec<Track> = result
        .iter()
        .filter_map(|id| {
            tracks_with_meta
                .iter()
                .find(|(t, _)| t.id == *id)
                .map(|(t, _)| t.clone())
        })
        .collect();

    Ok(tracks)
}

// ============================================================================
// DAILY MIX AUTO-GENERATION (FAZA 3 - Step 3.5)
// ============================================================================

/// Generate a Daily Mix playlist using AI, save as a real playlist, return it
#[tauri::command]
async fn ollama_daily_mix(
    state: State<'_, AppState>,
    model: Option<String>,
) -> Result<(Playlist, Vec<Track>), String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let db = state.db.lock().await;
    let tracks_with_meta = db
        .get_all_tracks_with_metadata()
        .map_err(|e| e.to_string())?;

    if tracks_with_meta.is_empty() {
        return Err(
            "Library is empty or no tracks have been tagged. Tag some tracks first.".to_string(),
        );
    }

    let library_summary = build_library_summary(&tracks_with_meta);

    // Get listening stats for context
    let stats = db.get_listening_stats(7).unwrap_or(ListeningStats {
        total_tracks: 0,
        total_time_seconds: 0,
        top_genres: vec![],
        top_artists: vec![],
        top_moods: vec![],
        daily_breakdown: vec![],
    });

    // Get recent tracks
    let recent = db.get_play_history(1, 10).unwrap_or_default();
    let recent_str = if recent.is_empty() {
        "No recent listening history".to_string()
    } else {
        recent
            .iter()
            .filter_map(|event| {
                tracks_with_meta
                    .iter()
                    .find(|(t, _)| t.id == event.track_id)
                    .map(|(t, _)| format!("- {} by {}", t.title, t.artist))
            })
            .collect::<Vec<_>>()
            .join("\n")
    };

    // Delete previous Daily Mix playlists (keep it fresh)
    let playlists = db.get_playlists().unwrap_or_default();
    for pl in &playlists {
        if pl.name.starts_with("Daily Mix")
            && pl
                .description
                .as_deref()
                .map_or(false, |d| d.contains("🧠"))
        {
            let _ = db.delete_playlist(&pl.id);
        }
    }

    drop(db);

    // Time context
    let now = chrono::Local::now();
    let hour = now.hour();
    let day_of_week = now.format("%A").to_string();

    let top_genres: Vec<String> = stats.top_genres.iter().map(|(g, _)| g.clone()).collect();
    let top_moods: Vec<String> = stats.top_moods.iter().map(|(m, _)| m.clone()).collect();

    let prompt = ollama::Prompts::daily_mix(
        &library_summary,
        &recent_str,
        hour,
        &day_of_week,
        &top_genres,
        &top_moods,
    );

    let plan: ollama::DailyMixPlan = client
        .generate_json_with_temp(&prompt, 0.6)
        .await
        .map_err(|e| e.to_string())?;

    // Map IDs to tracks
    let matched_tracks: Vec<Track> = plan
        .track_ids
        .iter()
        .filter_map(|id| {
            tracks_with_meta
                .iter()
                .find(|(t, _)| t.id == *id)
                .map(|(t, _)| t.clone())
        })
        .collect();

    if matched_tracks.is_empty() {
        return Err("AI generated plan but no tracks matched from library.".to_string());
    }

    // Save as a real playlist with 🧠 badge in description
    let db = state.db.lock().await;
    let description = format!("🧠 {}", plan.description);
    let playlist = db
        .create_playlist(&plan.name, Some(&description))
        .map_err(|e| e.to_string())?;

    for track in &matched_tracks {
        let _ = db.add_track_to_playlist(&playlist.id, &track.id);
    }

    let saved_playlist = db.get_playlist(&playlist.id).map_err(|e| e.to_string())?;

    Ok((saved_playlist, matched_tracks))
}

// ============================================================================
// SMART SPOTIFY IMPORT (FAZA 4 — D1-D5)
// ============================================================================

/// D1: Smart search for a Spotify track on YouTube with AI verification
#[tauri::command]
async fn smart_search_track_on_youtube(
    state: State<'_, AppState>,
    track: spotify_import::SpotifyTrack,
    model: Option<String>,
) -> Result<spotify_import::SmartImportResult, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let model_to_use = model.unwrap_or(ollama_model);

    Ok(spotify_import::search_youtube_for_track_smart(&track, &ollama_url, &model_to_use).await)
}

/// D1 + D3: Smart search with fallback to AI-generated alternative queries
#[tauri::command]
async fn smart_search_track_with_fallback(
    state: State<'_, AppState>,
    track: spotify_import::SpotifyTrack,
    model: Option<String>,
) -> Result<spotify_import::SmartImportResult, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let model_to_use = model.unwrap_or(ollama_model);

    Ok(
        spotify_import::search_youtube_for_track_smart_with_fallback(
            &track,
            &ollama_url,
            &model_to_use,
        )
        .await,
    )
}

/// D2: Disambiguate YouTube results for a track via AI
#[tauri::command]
async fn smart_disambiguate_track(
    state: State<'_, AppState>,
    title: String,
    artist: String,
    album: String,
    youtube_results: Vec<(String, String, String, Option<i64>)>,
    model: Option<String>,
) -> Result<spotify_import::DisambiguationResult, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let prompt = ollama::Prompts::disambiguate_track(&title, &artist, &album, &youtube_results);

    client
        .generate_json(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// D3: Get alternative search queries from AI
#[tauri::command]
async fn smart_alternative_queries(
    state: State<'_, AppState>,
    track: spotify_import::SpotifyTrack,
    model: Option<String>,
) -> Result<spotify_import::AlternativeQueriesResult, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let model_to_use = model.unwrap_or(ollama_model);

    spotify_import::get_alternative_queries(&track, &ollama_url, &model_to_use)
        .await
        .map_err(|e| e.to_string())
}

/// D4: Assess match quality between Spotify track and YouTube result
#[tauri::command]
async fn smart_assess_match_quality(
    state: State<'_, AppState>,
    track: spotify_import::SpotifyTrack,
    youtube_title: String,
    youtube_channel: String,
    youtube_duration_sec: Option<i64>,
    model: Option<String>,
) -> Result<spotify_import::MatchQualityResult, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let model_to_use = model.unwrap_or(ollama_model);

    spotify_import::assess_match_quality(
        &track,
        &youtube_title,
        &youtube_channel,
        youtube_duration_sec,
        &ollama_url,
        &model_to_use,
    )
    .await
    .map_err(|e| e.to_string())
}

/// D5: Suggest similar tracks when a track can't be found
#[tauri::command]
async fn smart_suggest_similar_track(
    state: State<'_, AppState>,
    track: spotify_import::SpotifyTrack,
    model: Option<String>,
) -> Result<spotify_import::SimilarTrackSuggestion, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let model_to_use = model.unwrap_or(ollama_model);

    spotify_import::suggest_similar_tracks(&track, &ollama_url, &model_to_use)
        .await
        .map_err(|e| e.to_string())
}

/// D1 batch: Smart import multiple tracks with progress events
#[tauri::command]
async fn smart_import_batch(
    state: State<'_, AppState>,
    tracks: Vec<spotify_import::SpotifyTrack>,
    use_fallback: bool,
    model: Option<String>,
    app: tauri::AppHandle,
) -> Result<Vec<spotify_import::SmartImportResult>, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let model_to_use = model.unwrap_or(ollama_model);
    let total = tracks.len();
    let mut results = Vec::new();

    for (idx, track) in tracks.iter().enumerate() {
        // Emit progress event
        let _ = app.emit(
            "smart-import-progress",
            serde_json::json!({
                "current": idx + 1,
                "total": total,
                "progress": ((idx + 1) as f32 / total as f32 * 100.0) as u32,
                "track_name": track.track_name,
                "artist_name": track.artist_name,
            }),
        );

        let result = if use_fallback {
            spotify_import::search_youtube_for_track_smart_with_fallback(
                track,
                &ollama_url,
                &model_to_use,
            )
            .await
        } else {
            spotify_import::search_youtube_for_track_smart(track, &ollama_url, &model_to_use).await
        };

        results.push(result);
    }

    // Emit completion event
    let found = results
        .iter()
        .filter(|r| r.status == spotify_import::ImportStatus::Found)
        .count();
    let alt = results
        .iter()
        .filter(|r| r.status == spotify_import::ImportStatus::AlternativeFound)
        .count();
    let not_found = results
        .iter()
        .filter(|r| r.status == spotify_import::ImportStatus::NotFound)
        .count();
    let avg_quality = if results.is_empty() {
        0
    } else {
        results.iter().map(|r| r.quality_score as u64).sum::<u64>() as u32 / total as u32
    };

    let _ = app.emit(
        "smart-import-complete",
        serde_json::json!({
            "total": total,
            "found": found,
            "alternatives": alt,
            "not_found": not_found,
            "average_quality": avg_quality,
        }),
    );

    Ok(results)
}

// ============================================================================
// SEMANTIC SEARCH (VIA EMBEDDINGS)
// ============================================================================

/// Cosine similarity between two vectors
fn cosine_similarity(a: &[f32], b: &[f32]) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    let mut dot = 0.0_f64;
    let mut norm_a = 0.0_f64;
    let mut norm_b = 0.0_f64;

    for (x, y) in a.iter().zip(b.iter()) {
        let x = *x as f64;
        let y = *y as f64;
        dot += x * y;
        norm_a += x * x;
        norm_b += y * y;
    }

    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom == 0.0 {
        0.0
    } else {
        dot / denom
    }
}

/// Build indexing text from track + metadata
fn build_track_text(track: &Track, metadata: Option<&TrackMetadataDB>) -> String {
    let mut parts = vec![format!("{} by {}", track.title, track.artist)];

    if let Some(meta) = metadata {
        if let Some(genre) = &meta.genre {
            parts.push(format!("Genre: {}", genre));
        }
        if let Some(mood) = &meta.mood {
            parts.push(format!("Mood: {}", mood));
        }
        if let Some(desc) = &meta.ai_description {
            parts.push(desc.clone());
        }
        if let Some(keywords) = &meta.keywords {
            parts.push(format!("Keywords: {}", keywords));
        }
        if let Some(tempo) = &meta.tempo {
            parts.push(format!("Tempo: {}", tempo));
        }
        if let Some(decade) = &meta.decade {
            parts.push(format!("Decade: {}", decade));
        }
        if let Some(activity) = &meta.activity_tags {
            parts.push(format!("Activities: {}", activity));
        }
    }

    parts.join(". ")
}

fn get_semantic_status_db_helper(db: &Database) -> Result<SemanticIndexStatus, String> {
    let settings = db.get_settings().map_err(|e| e.to_string())?;
    let total = db.get_all_tracks().map_err(|e| e.to_string())?.len() as i64;
    let indexed = db.count_embeddings().map_err(|e| e.to_string())?;

    Ok(SemanticIndexStatus {
        total_tracks: total,
        indexed_tracks: indexed,
        model_used: settings.embedding_model,
        is_indexing: false,
    })
}

fn semantic_clear_index_db_helper(db: &Database) -> Result<(), String> {
    db.clear_embeddings().map_err(|e| e.to_string())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SemanticSearchPrepareInput {
    query: String,
    ollama_url: String,
    embedding_model: String,
}

fn semantic_search_prepare_embedding_input_db_helper(
    db: &Database,
    query: &str,
) -> Result<SemanticSearchPrepareInput, String> {
    let settings = db.get_settings().map_err(|e| e.to_string())?;
    if !settings.semantic_search_enabled {
        return Err("Semantic search is disabled".to_string());
    }

    Ok(SemanticSearchPrepareInput {
        query: query.to_string(),
        ollama_url: settings.ollama_url,
        embedding_model: settings.embedding_model,
    })
}

#[derive(Debug, Clone)]
struct SemanticSearchFilteredPrepareInput {
    query: String,
    ollama_url: String,
    embedding_model: String,
    filter: SemanticSearchFilter,
}

fn semantic_search_filtered_prepare_embedding_input_db_helper(
    db: &Database,
    query: &str,
    genres: Option<Vec<String>>,
    moods: Option<Vec<String>>,
    activities: Option<Vec<String>>,
) -> Result<SemanticSearchFilteredPrepareInput, String> {
    let settings = db.get_settings().map_err(|e| e.to_string())?;
    if !settings.semantic_search_enabled {
        return Err("Semantic search is disabled".to_string());
    }

    Ok(SemanticSearchFilteredPrepareInput {
        query: query.to_string(),
        ollama_url: settings.ollama_url,
        embedding_model: settings.embedding_model,
        filter: SemanticSearchFilter {
            genres,
            moods,
            activities,
            min_similarity: Some(0.3),
        },
    })
}

fn semantic_search_with_embedding_db_helper(
    db: &Database,
    query_embedding: &[f32],
    limit: Option<i32>,
) -> Result<Vec<SemanticSearchResult>, String> {
    let embeddings = db.get_all_embeddings().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(20) as usize;

    let mut scored: Vec<(String, f64)> = embeddings
        .iter()
        .map(|emb| {
            let similarity = cosine_similarity(query_embedding, &emb.embedding);
            (emb.track_id.clone(), similarity)
        })
        .collect();

    scored.retain(|(_id, sim)| *sim > 0.3);
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(limit);

    let mut results = Vec::new();
    for (track_id, similarity) in scored {
        if let Ok(track) = db.get_track_by_uuid(&track_id) {
            results.push(SemanticSearchResult {
                track,
                similarity,
                match_reason: format!("Semantic match {:.0}%", similarity * 100.0),
            });
        }
    }

    Ok(results)
}

fn semantic_search_filtered_with_embedding_db_helper(
    db: &Database,
    query_embedding: &[f32],
    limit: Option<i32>,
    genres: Option<Vec<String>>,
    moods: Option<Vec<String>>,
    activities: Option<Vec<String>>,
    min_similarity: Option<f64>,
) -> Result<Vec<SemanticSearchResult>, String> {
    let embeddings = db.get_all_embeddings().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(20) as usize;

    let mut scored: Vec<(String, f32)> = embeddings
        .iter()
        .map(|emb| {
            let similarity = cosine_similarity(query_embedding, &emb.embedding) as f32;
            (emb.track_id.clone(), similarity)
        })
        .collect();

    // Apply minimum similarity threshold (parity with the ANNIndex path, which
    // receives `min_similarity: Some(0.3)` from the `semantic_search_filtered`
    // wrapper). When `Some(x)`, exclude results whose similarity is strictly
    // below `x`. When `None`, keep the existing behavior (no threshold filtering).
    if let Some(threshold) = min_similarity {
        scored.retain(|(_, sim)| (*sim as f64) >= threshold);
    }

    let metadata_filters_active = genres.is_some() || moods.is_some() || activities.is_some();
    if metadata_filters_active {
        scored.retain(|(track_id, _)| {
            let Ok(metadata) = db.get_track_metadata(track_id) else {
                return false;
            };

            let genre_matches = match &genres {
                Some(filters) => metadata
                    .genre
                    .as_ref()
                    .is_some_and(|genre| filters.contains(genre)),
                None => true,
            };
            let mood_matches = match &moods {
                Some(filters) => metadata
                    .mood
                    .as_ref()
                    .is_some_and(|mood| filters.contains(mood)),
                None => true,
            };
            let activity_matches = match &activities {
                Some(filters) => metadata.activity_tags.as_ref().is_some_and(|tags_json| {
                    crate::semantic::parse_json_array(tags_json)
                        .iter()
                        .any(|tag| filters.contains(tag))
                }),
                None => true,
            };

            genre_matches && mood_matches && activity_matches
        });
    }

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(limit);

    let mut results = Vec::new();
    for (track_id, similarity) in scored {
        if let Ok(track) = db.get_track_by_uuid(&track_id) {
            results.push(SemanticSearchResult {
                track,
                similarity: similarity as f64,
                match_reason: format!("Semantic match {:.0}%", similarity * 100.0),
            });
        }
    }

    Ok(results)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SemanticIndexTrackPrepareInput {
    track_id: String,
    video_id: String,
    embedding_text: String,
    ollama_url: String,
    embedding_model: String,
}

#[derive(Debug, Clone)]
struct SemanticIndexAllPreparedTrack {
    track: Track,
    embedding_text: String,
    genre: Option<String>,
    mood: Option<String>,
    activity_tags: Option<String>,
}

#[derive(Debug, Clone)]
struct SemanticIndexAllPreparedBatch {
    ollama_url: String,
    embedding_model: String,
    tracks: Vec<SemanticIndexAllPreparedTrack>,
}

fn semantic_index_track_prepare_embedding_input_db_helper(
    db: &Database,
    track_id: &str,
) -> Result<SemanticIndexTrackPrepareInput, String> {
    let settings = db.get_settings().map_err(|e| e.to_string())?;
    if !settings.semantic_search_enabled {
        return Err("Semantic search is disabled".to_string());
    }

    let track = db.get_track_by_uuid(track_id).map_err(|e| e.to_string())?;
    let metadata = db.get_track_metadata(track_id).ok();
    let embedding_text = build_track_text(&track, metadata.as_ref());

    Ok(SemanticIndexTrackPrepareInput {
        track_id: track.id,
        video_id: track.video_id,
        embedding_text,
        ollama_url: settings.ollama_url,
        embedding_model: settings.embedding_model,
    })
}

fn semantic_index_all_prepare_batch_db_helper(
    db: &Database,
) -> Result<SemanticIndexAllPreparedBatch, String> {
    let settings = db.get_settings().map_err(|e| e.to_string())?;
    if !settings.semantic_search_enabled {
        return Err("Semantic search is disabled".to_string());
    }

    let tracks = db.get_all_tracks().map_err(|e| e.to_string())?;
    let prepared_tracks = tracks
        .into_iter()
        .map(|track| {
            let metadata = db.get_track_metadata(&track.id).ok();
            let embedding_text = build_track_text(&track, metadata.as_ref());

            SemanticIndexAllPreparedTrack {
                track,
                embedding_text,
                genre: metadata.as_ref().and_then(|m| m.genre.clone()),
                mood: metadata.as_ref().and_then(|m| m.mood.clone()),
                activity_tags: metadata.as_ref().and_then(|m| m.activity_tags.clone()),
            }
        })
        .collect();

    Ok(SemanticIndexAllPreparedBatch {
        ollama_url: settings.ollama_url,
        embedding_model: settings.embedding_model,
        tracks: prepared_tracks,
    })
}

fn semantic_index_track_with_embedding_db_helper(
    db: &Database,
    track_id: &str,
    embedding: &[f32],
    model_used: &str,
) -> Result<TrackEmbedding, String> {
    let track = db.get_track_by_uuid(track_id).map_err(|e| e.to_string())?;
    let metadata = db.get_track_metadata(track_id).ok();
    let text = build_track_text(&track, metadata.as_ref());
    let dimensions = embedding.len() as i32;

    db.save_embedding(track_id, embedding, &text, model_used, dimensions)
        .map_err(|e| e.to_string())?;

    db.get_embedding(track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Embedding was not saved for track: {}", track_id))
}

fn semantic_index_all_save_embedding_db_helper(
    db: &Database,
    track_id: &str,
    embedding: &[f32],
    text_used: &str,
    model_used: &str,
) -> Result<TrackEmbedding, String> {
    let dimensions = embedding.len() as i32;

    db.save_embedding(track_id, embedding, text_used, model_used, dimensions)
        .map_err(|e| e.to_string())?;

    db.get_embedding(track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Embedding was not saved for track: {}", track_id))
}

/// Index single track with embedding
#[tauri::command]
async fn semantic_index_track(
    state: State<'_, AppState>,
    track_id: String,
) -> Result<bool, String> {
    let prepared = {
        let db = state.db.lock().await;
        semantic_index_track_prepare_embedding_input_db_helper(&db, &track_id)?
    };

    let ollama = OllamaClient::with_config(&prepared.ollama_url, &prepared.embedding_model);

    // Generate embedding
    let embedding = ollama
        .embed_single(&prepared.embedding_text, &prepared.embedding_model)
        .await
        .map_err(|e| e.to_string())?;

    let db = state.db.lock().await;

    semantic_index_track_with_embedding_db_helper(
        &db,
        &prepared.track_id,
        &embedding,
        &prepared.embedding_model,
    )?;

    Ok(true)
}

/// Index ALL tracks with progress events
#[tauri::command]
async fn semantic_index_all(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<SemanticIndexStatus, String> {
    let prepared = {
        let db = state.db.lock().await;
        semantic_index_all_prepare_batch_db_helper(&db)?
    };

    let SemanticIndexAllPreparedBatch {
        ollama_url,
        embedding_model,
        tracks,
    } = prepared;

    let ollama = OllamaClient::with_config(&ollama_url, &embedding_model);
    let mut rebuilt_ann = {
        let ann = state.ann_index.read().await;
        if ann.is_lru_enabled() {
            ANNIndex::with_lru_eviction(ann.max_embeddings())
        } else {
            ANNIndex::new()
        }
    };

    let total = tracks.len() as i64;
    let mut indexed = 0i64;
    let start_time = std::time::Instant::now();

    for prepared_track in tracks {
        let current_track = prepared_track.track.title.clone();

        match ollama
            .embed_single(&prepared_track.embedding_text, &embedding_model)
            .await
        {
            Ok(embedding) => {
                {
                    let db = state.db.lock().await;
                    let _ = semantic_index_all_save_embedding_db_helper(
                        &db,
                        &prepared_track.track.id,
                        &embedding,
                        &prepared_track.embedding_text,
                        &embedding_model,
                    );
                }

                let meta = semantic::build_metadata(
                    &prepared_track.track,
                    prepared_track.genre.clone(),
                    prepared_track.mood.clone(),
                    prepared_track.activity_tags.clone(),
                );
                rebuilt_ann.add(prepared_track.track.id.clone(), embedding, meta);

                indexed += 1;
            }
            Err(_) => continue,
        }

        // Calculate ETA
        let elapsed = start_time.elapsed().as_secs();
        let eta = if indexed > 0 {
            Some(((total - indexed) as u64 * elapsed) / indexed as u64)
        } else {
            None
        };

        // Emit progress
        let _ = app_handle.emit(
            "semantic-index-progress",
            serde_json::json!({
                "indexed": indexed,
                "total": total,
                "current_track": current_track,
                "percentage": ((indexed as f64 / total as f64) * 100.0) as i32,
                "estimated_time_remaining_seconds": eta,
            }),
        );
    }

    {
        let mut ann = state.ann_index.write().await;
        *ann = rebuilt_ann;
    }

    Ok(SemanticIndexStatus {
        total_tracks: total,
        indexed_tracks: indexed,
        model_used: embedding_model,
        is_indexing: false,
    })
}

/// Semantic search
#[tauri::command]
async fn semantic_search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<i32>,
) -> Result<Vec<SemanticSearchResult>, String> {
    let prepared = {
        let db = state.db.lock().await;
        semantic_search_prepare_embedding_input_db_helper(&db, &query)?
    };

    let ollama = OllamaClient::with_config(&prepared.ollama_url, &prepared.embedding_model);

    // Embed query
    let query_embedding = ollama
        .embed_single(&prepared.query, &prepared.embedding_model)
        .await
        .map_err(|e| e.to_string())?;

    let db = state.db.lock().await;
    semantic_search_with_embedding_db_helper(&db, &query_embedding, limit)
}

/// Get semantic index status
#[tauri::command]
async fn get_semantic_status(state: State<'_, AppState>) -> Result<SemanticIndexStatus, String> {
    let db = state.db.lock().await;
    get_semantic_status_db_helper(&db)
}

/// Clear all semantic embeddings
#[tauri::command]
async fn semantic_clear_index(state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().await;
    semantic_clear_index_db_helper(&db)
}

/// Semantic search with metadata filtering (genres, moods, activities)
#[tauri::command]
async fn semantic_search_filtered(
    state: State<'_, AppState>,
    query: String,
    limit: Option<i32>,
    genres: Option<Vec<String>>,
    moods: Option<Vec<String>>,
    activities: Option<Vec<String>>,
) -> Result<Vec<SemanticSearchResult>, String> {
    let prepared = {
        let db = state.db.lock().await;
        semantic_search_filtered_prepare_embedding_input_db_helper(
            &db, &query, genres, moods, activities,
        )?
    };

    let ollama = OllamaClient::with_config(&prepared.ollama_url, &prepared.embedding_model);

    // Embed query
    let query_embedding = ollama
        .embed_single(&prepared.query, &prepared.embedding_model)
        .await
        .map_err(|e| e.to_string())?;

    let filter = prepared.filter.clone();

    // Try ANN search first, fall back to brute force if ANN is empty
    let ann = state.ann_index.read().await;
    let limit = limit.unwrap_or(20) as usize;

    let scored: Vec<(String, f32)> = if !ann.is_empty() {
        ann.search_filtered(&query_embedding, limit, &filter)
    } else {
        drop(ann); // Release lock
        let db = state.db.lock().await;
        return semantic_search_filtered_with_embedding_db_helper(
            &db,
            &query_embedding,
            Some(limit as i32),
            filter.genres.clone(),
            filter.moods.clone(),
            filter.activities.clone(),
            filter.min_similarity,
        );
    };

    // Build results with track data
    drop(ann);
    let db = state.db.lock().await;
    let mut results = Vec::new();
    for (track_id, similarity) in scored {
        if let Ok(track) = db.get_track_by_uuid(&track_id) {
            results.push(SemanticSearchResult {
                track,
                similarity: similarity as f64,
                match_reason: format!("Semantic match {:.0}%", similarity * 100.0),
            });
        }
    }

    Ok(results)
}

/// Create a semantic playlist from pre-scored semantic search results (DB-only helper).
///
/// This helper performs no embedding generation, no Ollama calls, no network
/// access, and requires no Tauri runtime state. It takes already-scored
/// `SemanticSearchResult` values, creates a playlist in the given `Database`,
/// links the tracks in order, and returns a `SemanticPlaylistResult`.
fn create_semantic_playlist_from_scored_results_db_helper(
    db: &Database,
    query: &str,
    playlist_name: Option<String>,
    scored_results: Vec<SemanticSearchResult>,
) -> Result<SemanticPlaylistResult, String> {
    let track_count = scored_results.len() as i64;
    let average_similarity = if !scored_results.is_empty() {
        scored_results.iter().map(|r| r.similarity).sum::<f64>() / scored_results.len() as f64
    } else {
        0.0
    };

    let name = playlist_name.unwrap_or_else(|| {
        format!(
            "🎵 Like {} — {}",
            query,
            chrono::Local::now().format("%Y-%m-%d")
        )
    });

    let description = format!("Auto-generated semantic playlist from: {}", query);

    let playlist = db
        .create_playlist(&name, Some(&description))
        .map_err(|e| e.to_string())?;

    for result in &scored_results {
        let _ = db.add_track_to_playlist(&playlist.id, &result.track.id);
    }

    Ok(SemanticPlaylistResult {
        playlist_id: playlist.id,
        playlist_name: playlist.name,
        track_count,
        average_similarity,
        created_at: chrono::Local::now().to_rfc3339(),
    })
}

/// Prepared input for semantic playlist embedding generation (DB-only stage).
///
/// This struct is produced by the pre-embedding DB helper and consumed by the
/// `create_semantic_playlist` wrapper after the DB lock is released. It carries
/// everything needed to call `OllamaClient::embed_single` without holding the lock.
#[derive(Debug, Clone, PartialEq, Eq)]
struct SemanticPlaylistPrepareInput {
    query: String,
    ollama_url: String,
    embedding_model: String,
    playlist_name: Option<String>,
}

/// Pre-embedding DB-only helper for `create_semantic_playlist`.
///
/// Reads settings from the given `Database`, validates that semantic search is
/// enabled, and returns a `SemanticPlaylistPrepareInput` carrying the query, the
/// Ollama URL, the embedding model, and the caller-supplied playlist name.
///
/// This helper performs no embedding generation, no Ollama calls, no network
/// access, and no playlist creation. It is intended to be called under a
/// short-lived DB lock so that `embed_single().await` can run without the lock.
fn create_semantic_playlist_prepare_embedding_input_db_helper(
    db: &Database,
    query: &str,
    playlist_name: Option<String>,
) -> Result<SemanticPlaylistPrepareInput, String> {
    let settings = db.get_settings().map_err(|e| e.to_string())?;
    if !settings.semantic_search_enabled {
        return Err("Semantic search is disabled".to_string());
    }

    Ok(SemanticPlaylistPrepareInput {
        query: query.to_string(),
        ollama_url: settings.ollama_url,
        embedding_model: settings.embedding_model,
        playlist_name,
    })
}

/// Scoring-from-embedding DB-only helper for `create_semantic_playlist`.
///
/// Given a pre-computed query embedding, this helper reads all stored track
/// embeddings from the `Database`, computes cosine similarity, filters by the
/// existing threshold (> 0.3), sorts descending, truncates to 50, and resolves
/// the surviving track IDs into `SemanticSearchResult` values.
///
/// This helper performs no embedding generation, no Ollama calls, no network
/// access, and no playlist creation. It is intended to be called under a
/// short-lived DB lock after `embed_single().await` has completed.
fn create_semantic_playlist_scored_from_embedding_db_helper(
    db: &Database,
    query_embedding: &[f32],
) -> Result<Vec<SemanticSearchResult>, String> {
    let embeddings = db.get_all_embeddings().map_err(|e| e.to_string())?;

    let mut scored: Vec<(String, f64)> = embeddings
        .iter()
        .map(|emb| {
            let similarity = cosine_similarity(query_embedding, &emb.embedding);
            (emb.track_id.clone(), similarity)
        })
        .collect();

    // Filter and sort
    scored.retain(|(_id, sim)| *sim > 0.3);
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(50); // Max 50 songs per semantic playlist

    // Resolve scored track IDs to SemanticSearchResult for the DB-only helper.
    let mut scored_results: Vec<SemanticSearchResult> = Vec::new();
    for (track_id, similarity) in &scored {
        if let Ok(track) = db.get_track_by_uuid(track_id) {
            scored_results.push(SemanticSearchResult {
                track,
                similarity: *similarity,
                match_reason: format!("Semantic match {:.0}%", similarity * 100.0),
            });
        }
    }

    Ok(scored_results)
}

/// Create a semantic playlist from search results
#[tauri::command]
async fn create_semantic_playlist(
    state: State<'_, AppState>,
    query: String,
    playlist_name: Option<String>,
) -> Result<SemanticPlaylistResult, String> {
    // Stage 1: pre-embedding DB preparation under short-lived lock.
    let prepared = {
        let db = state.db.lock().await;
        create_semantic_playlist_prepare_embedding_input_db_helper(&db, &query, playlist_name)?
    };

    // Stage 2: embedding generation without DB lock held.
    let ollama = OllamaClient::with_config(&prepared.ollama_url, &prepared.embedding_model);
    let query_embedding = ollama
        .embed_single(&prepared.query, &prepared.embedding_model)
        .await
        .map_err(|e| e.to_string())?;

    // Stage 3: scoring + playlist save under reacquired lock.
    let db = state.db.lock().await;
    let scored_results =
        create_semantic_playlist_scored_from_embedding_db_helper(&db, &query_embedding)?;

    create_semantic_playlist_from_scored_results_db_helper(
        &db,
        &prepared.query,
        prepared.playlist_name,
        scored_results,
    )
}

// ============================================================================
// INSIGHTS & ANALYTICS (FAZA 6 — F1-F10, G1-G9)
// ============================================================================

/// Listening profile response
#[derive(serde::Serialize, serde::Deserialize)]
pub struct ListeningProfileResponse {
    profile_text: String,
    music_personality: String,
}

/// Weekly summary response
#[derive(serde::Serialize, serde::Deserialize)]
pub struct WeeklySummaryResponse {
    summary_text: String,
    highlight: String,
    trend: String,
    recommendation: String,
}

/// Time patterns response
#[derive(serde::Serialize, serde::Deserialize)]
pub struct TimePatternsResponse {
    peak_hours: Vec<i32>,
    quiet_hours: Vec<i32>,
    pattern_name: String,
    insight: String,
}

/// Forgotten gem
#[derive(serde::Serialize, serde::Deserialize)]
pub struct ForgottenGem {
    track_id: String,
    reason: String,
}

/// Forgotten gems response
#[derive(serde::Serialize, serde::Deserialize)]
pub struct ForgottenGemsResponse {
    gems: Vec<ForgottenGem>,
    message: String,
}

/// Artist deep dive response
#[derive(serde::Serialize, serde::Deserialize)]
pub struct ArtistDeepDiveResponse {
    artist: String,
    bio: String,
    essential_albums: Vec<String>,
    recommended_tracks: Vec<String>,
    similar_artists: Vec<String>,
    fun_fact: String,
}

/// Genre explorer response
#[derive(serde::Serialize, serde::Deserialize)]
pub struct GenreExplorerResponse {
    genre: String,
    description: String,
    sub_genres: Vec<String>,
    legendary_artists: Vec<String>,
    essential_tracks: Vec<String>,
    related_genres: Vec<String>,
}

/// Recommendation item
#[derive(serde::Serialize, serde::Deserialize)]
pub struct RecommendationItem {
    title: String,
    artist: String,
    search_query: String,
    reason: String,
}

/// Because You Liked response
#[derive(serde::Serialize, serde::Deserialize)]
pub struct BecauseYouLikedResponse {
    recommendations: Vec<RecommendationItem>,
    insight: String,
}

/// Surprise item
#[derive(serde::Serialize, serde::Deserialize)]
pub struct SurpriseItem {
    title: String,
    artist: String,
    search_query: String,
    genre: String,
    why_surprise: String,
}

/// Surprise me response
#[derive(serde::Serialize, serde::Deserialize)]
pub struct SurpriseMeResponse {
    surprises: Vec<SurpriseItem>,
    theme: String,
}

/// Seasonal recommendation
#[derive(serde::Serialize, serde::Deserialize)]
pub struct SeasonalRecommendation {
    title: String,
    artist: String,
    search_query: String,
    seasonal_fit: String,
}

/// Seasonal response
#[derive(serde::Serialize, serde::Deserialize)]
pub struct SeasonalResponse {
    season: String,
    mood: String,
    recommendations: Vec<SeasonalRecommendation>,
}

/// F1: AI listening profile
#[tauri::command]
async fn insights_listening_profile(
    state: State<'_, AppState>,
    model: Option<String>,
) -> Result<ListeningProfileResponse, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let db = state.db.lock().await;
    let stats = db.get_listening_stats(30).map_err(|e| e.to_string())?;
    drop(db);

    let stats_text = format!(
        "Unique tracks: {}\nTotal time: {} min\nTop genres: {:?}\nTop artists: {:?}\nTop moods: {:?}\nDaily breakdown (last 30 days): {:?}",
        stats.total_tracks,
        stats.total_time_seconds / 60,
        stats.top_genres,
        stats.top_artists,
        stats.top_moods,
        stats.daily_breakdown,
    );

    let prompt = ollama::Prompts::listening_profile(&stats_text);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// F2: Weekly summary
#[tauri::command]
async fn insights_weekly_summary(
    state: State<'_, AppState>,
    model: Option<String>,
) -> Result<WeeklySummaryResponse, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let db = state.db.lock().await;
    let stats = db.get_listening_stats(7).map_err(|e| e.to_string())?;
    let top_tracks = db.get_top_tracks(7, 5).map_err(|e| e.to_string())?;
    drop(db);

    let stats_text = format!(
        "Unique tracks: {}\nTotal time: {} min\nTop genres: {:?}\nTop artists: {:?}\nTop moods: {:?}",
        stats.total_tracks, stats.total_time_seconds / 60,
        stats.top_genres, stats.top_artists, stats.top_moods,
    );

    let top_tracks_text = top_tracks
        .iter()
        .map(|(t, c)| format!("{} by {} ({} plays)", t.title, t.artist, c))
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = ollama::Prompts::weekly_summary(&stats_text, &top_tracks_text);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// F3: Time patterns
#[tauri::command]
async fn insights_time_patterns(
    state: State<'_, AppState>,
    model: Option<String>,
) -> Result<TimePatternsResponse, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let db = state.db.lock().await;
    let hourly = db.get_hourly_stats(30).map_err(|e| e.to_string())?;
    drop(db);

    let hourly_text = hourly
        .iter()
        .map(|(h, c)| format!("{}:00 → {} plays", h, c))
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = ollama::Prompts::time_patterns(&hourly_text);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// F4+F5: Stats (non-AI, direct data)
#[tauri::command]
async fn insights_stats(
    state: State<'_, AppState>,
    days_back: Option<i64>,
) -> Result<serde_json::Value, String> {
    let days = days_back.unwrap_or(30);
    let db = state.db.lock().await;
    let stats = db.get_listening_stats(days).map_err(|e| e.to_string())?;
    let streak = db.get_listening_streak().map_err(|e| e.to_string())?;
    let hourly = db.get_hourly_stats(days).map_err(|e| e.to_string())?;
    let top_tracks = db.get_top_tracks(days, 10).map_err(|e| e.to_string())?;
    drop(db);

    Ok(serde_json::json!({
        "total_tracks": stats.total_tracks,
        "total_time_seconds": stats.total_time_seconds,
        "top_genres": stats.top_genres,
        "top_artists": stats.top_artists,
        "top_moods": stats.top_moods,
        "daily_breakdown": stats.daily_breakdown,
        "streak_days": streak,
        "hourly_breakdown": hourly,
        "top_tracks": top_tracks.iter().map(|(t, c)| {
            serde_json::json!({ "track": t, "play_count": c })
        }).collect::<Vec<_>>(),
    }))
}

/// F6: Forgotten gems
#[tauri::command]
async fn insights_forgotten_gems(
    state: State<'_, AppState>,
    model: Option<String>,
) -> Result<ForgottenGemsResponse, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let db = state.db.lock().await;
    let gems = db.get_forgotten_gems(14, 20).map_err(|e| e.to_string())?;
    drop(db);

    if gems.is_empty() {
        return Ok(ForgottenGemsResponse {
            gems: vec![],
            message: "No forgotten gems found — you've been listening to everything!".to_string(),
        });
    }

    let gems_text = gems
        .iter()
        .map(|t| {
            format!(
                "{} | {} by {} | {} plays",
                t.id, t.title, t.artist, t.play_count
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = ollama::Prompts::forgotten_gems(&gems_text);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// G1: More like this
#[tauri::command]
async fn insights_more_like_this(
    state: State<'_, AppState>,
    title: String,
    artist: String,
    model: Option<String>,
) -> Result<Vec<String>, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let db = state.db.lock().await;
    let tracks = db
        .get_all_tracks_with_metadata()
        .map_err(|e| e.to_string())?;
    drop(db);

    let library_summary = tracks
        .iter()
        .take(200)
        .map(|(t, m)| {
            format!(
                "{} | {} | {} | {} | {}",
                t.id,
                t.title,
                t.artist,
                m.genre.clone().unwrap_or_default(),
                m.mood.clone().unwrap_or_default(),
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = ollama::Prompts::more_like_this(&title, &artist, &library_summary);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// G2: Artist deep dive
#[tauri::command]
async fn insights_artist_deep_dive(
    state: State<'_, AppState>,
    artist: String,
    model: Option<String>,
) -> Result<ArtistDeepDiveResponse, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let prompt = ollama::Prompts::artist_deep_dive(&artist);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// G3: Genre explorer
#[tauri::command]
async fn insights_genre_explorer(
    state: State<'_, AppState>,
    genre: String,
    model: Option<String>,
) -> Result<GenreExplorerResponse, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let prompt = ollama::Prompts::genre_explorer(&genre);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// G5: Because you liked
#[tauri::command]
async fn insights_because_you_liked(
    state: State<'_, AppState>,
    model: Option<String>,
) -> Result<BecauseYouLikedResponse, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let db = state.db.lock().await;
    let tracks = db
        .get_all_tracks_with_metadata()
        .map_err(|e| e.to_string())?;
    drop(db);

    let favorites_summary = tracks
        .iter()
        .filter(|(t, _)| t.is_favorite)
        .take(30)
        .map(|(t, m)| {
            format!(
                "{} | {} | {} | {}",
                t.title,
                t.artist,
                m.genre.clone().unwrap_or_default(),
                m.mood.clone().unwrap_or_default(),
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    if favorites_summary.is_empty() {
        return Err("No favorites found. Add some favorites first!".to_string());
    }

    let prompt = ollama::Prompts::because_you_liked(&favorites_summary);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// G6: Surprise me
#[tauri::command]
async fn insights_surprise_me(
    state: State<'_, AppState>,
    model: Option<String>,
) -> Result<SurpriseMeResponse, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let db = state.db.lock().await;
    let stats = db.get_listening_stats(30).map_err(|e| e.to_string())?;
    drop(db);

    let profile = format!(
        "Top genres: {:?}\nTop artists: {:?}\nTop moods: {:?}\nTotal tracks: {}",
        stats.top_genres, stats.top_artists, stats.top_moods, stats.total_tracks,
    );

    let prompt = ollama::Prompts::surprise_me(&profile);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// G8: Seasonal recommendations
#[tauri::command]
async fn insights_seasonal(
    state: State<'_, AppState>,
    model: Option<String>,
) -> Result<SeasonalResponse, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    let month = chrono::Local::now().month();
    let season = match month {
        12 | 1 | 2 => "Winter",
        3 | 4 | 5 => "Spring",
        6 | 7 | 8 => "Summer",
        _ => "Autumn",
    };

    let db = state.db.lock().await;
    let stats = db.get_listening_stats(30).map_err(|e| e.to_string())?;
    drop(db);

    let preferences = format!(
        "Top genres: {:?}, Top moods: {:?}",
        stats.top_genres, stats.top_moods,
    );

    let prompt = ollama::Prompts::seasonal_recommendations(season, &preferences);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// LIBRARY CLEANUP (FAZA 7 — H1-H7)
// ============================================================================

/// H1+H6: Find duplicate tracks
#[tauri::command]
async fn cleanup_find_duplicates(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let db = state.db.lock().await;
    let tracks = db.get_all_tracks().map_err(|e| e.to_string())?;
    drop(db);

    if tracks.len() < 2 {
        return Ok(
            serde_json::json!({ "duplicates": [], "summary": "Not enough tracks to check" }),
        );
    }

    // Build track pairs text (title - artist)
    let track_list: Vec<String> = tracks
        .iter()
        .map(|t| format!("{} - {}", t.title, t.artist))
        .collect();
    let tracks_text = track_list.join("\n");

    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    let prompt = ollama::Prompts::detect_duplicates(&tracks_text);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// H3: Clean/fix track metadata
#[tauri::command]
async fn cleanup_fix_metadata(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let db = state.db.lock().await;
    let tracks = db.get_all_tracks().map_err(|e| e.to_string())?;
    drop(db);

    // Only send tracks that look like they need cleaning
    let dirty: Vec<String> = tracks
        .iter()
        .filter(|t| {
            let title = &t.title;
            title.contains("(Official")
                || title.contains("[Official")
                || title.contains("(Audio")
                || title.contains("[Audio")
                || title.contains("(Lyrics")
                || title.contains("[Lyrics")
                || title.contains("(HQ")
                || title.contains("[HQ")
                || title.contains("(HD")
                || title.contains("[HD")
                || title.contains("(Live")
                || title.contains("ft.")
                || title.contains("feat.")
                || title.contains("  ")
                || title.contains("(Music Video")
                || title.contains("[MV]")
        })
        .map(|t| format!("{} - {}", t.title, t.artist))
        .collect();

    if dirty.is_empty() {
        return Ok(serde_json::json!({ "cleaned": [], "total_fixes": 0 }));
    }

    let tracks_text = dirty.join("\n");
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    let prompt = ollama::Prompts::clean_metadata(&tracks_text);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// H3: Apply cleaned metadata to tracks
#[tauri::command]
async fn cleanup_apply_metadata(
    state: State<'_, AppState>,
    fixes: Vec<serde_json::Value>,
) -> Result<i32, String> {
    let db = state.db.lock().await;
    let mut count = 0;
    for fix in &fixes {
        let orig_title = fix["original_title"].as_str().unwrap_or("");
        let orig_artist = fix["original_artist"].as_str().unwrap_or("");
        let clean_title = fix["clean_title"].as_str().unwrap_or("");
        let clean_artist = fix["clean_artist"].as_str().unwrap_or("");
        if !clean_title.is_empty() && !orig_title.is_empty() {
            if db
                .update_track_metadata_cleanup(orig_title, orig_artist, clean_title, clean_artist)
                .is_ok()
            {
                count += 1;
            }
        }
    }
    Ok(count)
}

/// H4: Normalize artist names
#[tauri::command]
async fn cleanup_normalize_artists(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let db = state.db.lock().await;
    let tracks = db.get_all_tracks().map_err(|e| e.to_string())?;
    drop(db);

    // Collect unique artist names
    let mut artists: Vec<String> = tracks.iter().map(|t| t.artist.clone()).collect();
    artists.sort();
    artists.dedup();

    if artists.len() < 2 {
        return Ok(serde_json::json!({ "groups": [] }));
    }

    let artists_text = artists.join("\n");
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    let prompt = ollama::Prompts::normalize_artists(&artists_text);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// H2: Auto-organize library suggestions
#[tauri::command]
async fn cleanup_auto_organize(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let db = state.db.lock().await;
    let tracks = db.get_all_tracks().map_err(|e| e.to_string())?;
    let metadata = db.get_all_metadata().map_err(|e| e.to_string())?;
    drop(db);

    // Build summary with metadata
    let summary_lines: Vec<String> = tracks
        .iter()
        .map(|t| {
            let meta = metadata.iter().find(|m| m.track_id == t.id);
            match meta {
                Some(m) => format!(
                    "{} - {} [genre: {}, mood: {}, energy: {}]",
                    t.title,
                    t.artist,
                    m.genre.as_deref().unwrap_or("unknown"),
                    m.mood.as_deref().unwrap_or("unknown"),
                    m.energy_level.unwrap_or(5)
                ),
                None => format!("{} - {}", t.title, t.artist),
            }
        })
        .collect();

    let summary = summary_lines.join("\n");
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    let prompt = ollama::Prompts::auto_organize(&summary);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// H7: Suggest tracks to delete
#[tauri::command]
async fn cleanup_suggest_deletions(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let db = state.db.lock().await;
    let tracks = db.get_all_tracks().map_err(|e| e.to_string())?;
    drop(db);

    let never_played: Vec<String> = tracks
        .iter()
        .filter(|t| t.play_count == 0)
        .map(|t| format!("{} - {}", t.title, t.artist))
        .collect();

    if never_played.is_empty() {
        return Ok(
            serde_json::json!({ "safe_to_delete": [], "keep": [], "summary": "All tracks have been played!" }),
        );
    }

    let tracks_text = never_played.join("\n");
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    let prompt = ollama::Prompts::suggest_deletions(&tracks_text);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// Delete a track by ID
#[tauri::command]
async fn cleanup_delete_track(state: State<'_, AppState>, track_id: String) -> Result<(), String> {
    let db = state.db.lock().await;
    cleanup_delete_track_db_helper(&db, &track_id)
}

// ============================================================================
// AI CHAT (FAZA 7 — J1-J5)
// ============================================================================

/// J1-J4: Send a chat message and get AI response
#[tauri::command]
async fn ai_chat_send(
    state: State<'_, AppState>,
    message: String,
    history: Vec<serde_json::Value>,
) -> Result<String, String> {
    let db = state.db.lock().await;
    let tracks = db.get_all_tracks().map_err(|e| e.to_string())?;
    drop(db);

    // Build library summary
    let total = tracks.len();
    let mut artists: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for t in &tracks {
        *artists.entry(t.artist.clone()).or_insert(0) += 1;
    }
    // Get top artists
    let mut top_artists: Vec<_> = artists.into_iter().collect();
    top_artists.sort_by(|a, b| b.1.cmp(&a.1));
    let top_artists_text: Vec<String> = top_artists
        .iter()
        .take(5)
        .map(|(a, c)| format!("{} ({})", a, c))
        .collect();

    let library_summary = format!(
        "{} tracks. Top artists: {}",
        total,
        top_artists_text.join(", ")
    );
    let current_track = "None";

    let system_prompt = ollama::Prompts::chat_system(&library_summary, current_track);

    // Build conversation prompt
    let mut conversation = format!("System: {}\n\n", system_prompt);
    for msg in &history {
        let role = msg["role"].as_str().unwrap_or("user");
        let content = msg["content"].as_str().unwrap_or("");
        conversation.push_str(&format!("{}: {}\n", role, content));
    }
    conversation.push_str(&format!("User: {}\n\nAssistant:", message));

    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    let response = client
        .generate(&conversation)
        .await
        .map_err(|e| e.to_string())?;
    Ok(response.trim().to_string())
}

/// J2: Get track trivia
#[tauri::command]
async fn ai_chat_trivia(
    state: State<'_, AppState>,
    title: String,
    artist: String,
) -> Result<serde_json::Value, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    let prompt = ollama::Prompts::track_trivia(&title, &artist);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// J5: Music quiz
#[tauri::command]
async fn ai_chat_quiz(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let db = state.db.lock().await;
    let tracks = db.get_all_tracks().map_err(|e| e.to_string())?;
    drop(db);

    // Sample ~20 tracks for quiz context
    let sample: Vec<String> = tracks
        .iter()
        .take(20)
        .map(|t| format!("{} - {}", t.title, t.artist))
        .collect();
    let tracks_text = sample.join("\n");

    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    let prompt = ollama::Prompts::music_quiz(&tracks_text);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// PLAYLIST VARIANTS (FAZA 3 — C2-C4, C7-C12)
// ============================================================================

/// C2: Generate a mood-based playlist
#[tauri::command]
async fn smart_playlist_by_mood(
    state: State<'_, AppState>,
    mood: String,
) -> Result<serde_json::Value, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);

    let db = state.db.lock().await;
    let library = db.get_all_tracks().map_err(|e| e.to_string())?;
    let tracks_text = library
        .iter()
        .map(|t| format!("{} - {}", t.title, t.artist))
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = ollama::Prompts::mood_playlist(&mood, &tracks_text);
    client
        .generate_json(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// C3: Generate a duration-limited playlist
#[tauri::command]
async fn smart_playlist_by_duration(
    state: State<'_, AppState>,
    duration_min: u32,
    theme: String,
) -> Result<serde_json::Value, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);

    let db = state.db.lock().await;
    let library = db.get_all_tracks().map_err(|e| e.to_string())?;
    let tracks_text = library
        .iter()
        .map(|t| format!("{} - {} ({} seconds)", t.title, t.artist, 240)) // hardcode avg 4min for now
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = ollama::Prompts::duration_playlist(duration_min, &theme, &tracks_text);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// C4: Generate a mood-transition playlist
#[tauri::command]
async fn smart_playlist_mood_journey(
    state: State<'_, AppState>,
    start_mood: String,
    end_mood: String,
) -> Result<serde_json::Value, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);

    let db = state.db.lock().await;
    let library = db.get_all_tracks().map_err(|e| e.to_string())?;
    let tracks_text = library
        .iter()
        .map(|t| format!("{} - {}", t.title, t.artist))
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = ollama::Prompts::transition_playlist(&start_mood, &end_mood, &tracks_text);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// C7: Discovery playlist
#[tauri::command]
async fn smart_playlist_discovery(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);

    let db = state.db.lock().await;
    let library = db.get_all_tracks().map_err(|e| e.to_string())?;
    let artists: Vec<String> = library
        .iter()
        .map(|t| t.artist.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    let artists_text = artists.join(", ");

    let prompt = ollama::Prompts::discovery_playlist(&artists_text, "");
    client
        .generate_json(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// C8: Name a playlist
#[tauri::command]
async fn smart_playlist_name(
    state: State<'_, AppState>,
    track_ids: Vec<String>,
) -> Result<serde_json::Value, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);

    let tracks = track_ids
        .iter()
        .map(|id| format!("(id: {})", id))
        .collect::<Vec<_>>()
        .join(", ");

    let prompt = ollama::Prompts::name_playlist(&tracks);
    client
        .generate_json(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// C9: Describe playlist cover
#[tauri::command]
async fn smart_playlist_cover_idea(
    state: State<'_, AppState>,
    track_ids: Vec<String>,
) -> Result<serde_json::Value, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);

    let tracks = track_ids
        .iter()
        .map(|id| format!("(id: {})", id))
        .collect::<Vec<_>>()
        .join(", ");

    let prompt = ollama::Prompts::describe_playlist_cover(&tracks);
    client
        .generate_json(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// C10: Reorder a playlist
#[tauri::command]
async fn smart_playlist_reorder(
    state: State<'_, AppState>,
    track_ids: Vec<String>,
) -> Result<serde_json::Value, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);

    let tracks = track_ids
        .iter()
        .map(|id| format!("(id: {})", id))
        .collect::<Vec<_>>()
        .join(", ");

    let prompt = ollama::Prompts::reorder_playlist(&tracks);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// C11: Merge playlists
#[tauri::command]
async fn smart_playlist_merge(
    state: State<'_, AppState>,
    playlist_a_tracks: Vec<String>,
    playlist_b_tracks: Vec<String>,
) -> Result<serde_json::Value, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);

    let a_text = playlist_a_tracks.join(", ");
    let b_text = playlist_b_tracks.join(", ");

    let prompt = ollama::Prompts::merge_playlists(&a_text, &b_text);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// C12: Split a playlist
#[tauri::command]
async fn smart_playlist_split(
    state: State<'_, AppState>,
    track_ids: Vec<String>,
) -> Result<serde_json::Value, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);

    let tracks = track_ids
        .iter()
        .map(|id| format!("(id: {})", id))
        .collect::<Vec<_>>()
        .join(", ");

    let prompt = ollama::Prompts::split_playlist(&tracks);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// SHARE & SOCIAL (FAZA 8 — K1-K3)
// ============================================================================

/// K1: Generate shareable text for a track
#[tauri::command]
async fn share_generate_message(
    state: State<'_, AppState>,
    title: String,
    artist: String,
    mood: String,
) -> Result<serde_json::Value, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    let prompt = ollama::Prompts::share_message(&title, &artist, &mood);
    client
        .generate_json(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// K2: Generate playlist description
#[tauri::command]
async fn share_playlist_description(
    state: State<'_, AppState>,
    track_list: String,
) -> Result<serde_json::Value, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    let prompt = ollama::Prompts::playlist_description(&track_list);
    client
        .generate_json(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// K3: Year in Review / Wrapped
#[tauri::command]
async fn share_year_in_review(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let db = state.db.lock().await;
    let tracks = db.get_all_tracks().map_err(|e| e.to_string())?;
    let metadata = db.get_all_metadata().map_err(|e| e.to_string())?;
    drop(db);

    // Build annual stats
    let total = tracks.len();
    let fav_count = tracks.iter().filter(|t| t.is_favorite).count();
    let total_plays: i64 = tracks.iter().map(|t| t.play_count as i64).sum();
    let downloaded = tracks.iter().filter(|t| t.is_downloaded).count();

    // Top artists
    let mut artists: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for t in &tracks {
        *artists.entry(t.artist.clone()).or_insert(0) += 1;
    }
    let mut top_artists: Vec<_> = artists.into_iter().collect();
    top_artists.sort_by(|a, b| b.1.cmp(&a.1));
    let top_artists_text: Vec<String> = top_artists
        .iter()
        .take(5)
        .map(|(a, c)| format!("{} ({})", a, c))
        .collect();

    // Top genres
    let mut genres: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for m in &metadata {
        if let Some(g) = &m.genre {
            *genres.entry(g.clone()).or_insert(0) += 1;
        }
    }
    let mut top_genres: Vec<_> = genres.into_iter().collect();
    top_genres.sort_by(|a, b| b.1.cmp(&a.1));
    let top_genres_text: Vec<String> = top_genres
        .iter()
        .take(5)
        .map(|(g, c)| format!("{} ({})", g, c))
        .collect();

    let stats = format!(
        "Total tracks: {}\nTotal plays: {}\nFavorites: {}\nDownloaded: {}\nTop artists: {}\nTop genres: {}",
        total, total_plays, fav_count, downloaded,
        top_artists_text.join(", "),
        top_genres_text.join(", ")
    );

    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    let prompt = ollama::Prompts::year_in_review(&stats);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// UTILITIES (FAZA 8 — L1-L3)
// ============================================================================

/// L1: Explain error in user-friendly terms
#[tauri::command]
async fn ai_explain_error(
    state: State<'_, AppState>,
    error_message: String,
) -> Result<serde_json::Value, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    let prompt = ollama::Prompts::explain_error(&error_message);
    client
        .generate_json(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// L2: Settings advisor
#[tauri::command]
async fn ai_settings_advice(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let db = state.db.lock().await;
    let tracks = db.get_all_tracks().map_err(|e| e.to_string())?;
    drop(db);

    // Get current settings
    let settings = {
        let db = state.db.lock().await;
        db.get_settings().unwrap_or_default()
    };

    let current_settings = format!(
        "Audio quality: {}\nAuto-download: {}\nCrossfade: {} ({}s)\nOllama enabled: {}\nSmart search: {}\nAuto-tagging: {}\nSmart queue: {}\nDaily mix: {}\nSearch results: {}",
        settings.audio_quality,
        settings.auto_download,
        settings.crossfade,
        settings.crossfade_duration,
        settings.ollama_enabled,
        settings.smart_search_enabled,
        settings.auto_tagging_enabled,
        settings.smart_queue_enabled,
        settings.daily_mix_enabled,
        settings.search_results_count
    );

    let total = tracks.len();
    let played = tracks.iter().filter(|t| t.play_count > 0).count();
    let downloaded = tracks.iter().filter(|t| t.is_downloaded).count();
    let favorited = tracks.iter().filter(|t| t.is_favorite).count();

    let usage_stats = format!(
        "Total tracks: {}\nPlayed at least once: {}\nDownloaded: {}\nFavorites: {}",
        total, played, downloaded, favorited
    );

    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    let prompt = ollama::Prompts::settings_advice(&current_settings, &usage_stats);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

/// L3: Storage analyzer
#[tauri::command]
async fn ai_storage_analysis(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let db = state.db.lock().await;
    let tracks = db.get_all_tracks().map_err(|e| e.to_string())?;
    drop(db);

    let total = tracks.len();
    let downloaded = tracks.iter().filter(|t| t.is_downloaded).count();
    let not_downloaded = total - downloaded;
    let never_played_downloaded = tracks
        .iter()
        .filter(|t| t.is_downloaded && t.play_count == 0)
        .count();

    // Estimate sizes (~5MB per downloaded track on average)
    let est_total_mb = downloaded * 5;

    let storage_info = format!(
        "Total tracks: {}\nDownloaded: {} (est. {} MB)\nNot downloaded: {}\nDownloaded but never played: {}",
        total, downloaded, est_total_mb, not_downloaded, never_played_downloaded
    );

    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    let prompt = ollama::Prompts::storage_analysis(&storage_info);
    client
        .generate_json_large(&prompt)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// AI DJ MODE
// ============================================================================

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct DjCommentary {
    pub commentary: String,
    pub transition_type: String,
    pub energy: String,
}

#[derive(serde::Deserialize)]
pub struct DjEventContext {
    pub trigger_type: String, // "TrackStart" | "QueueEmpty" | etc.
    pub current_title: Option<String>,
    pub current_artist: Option<String>,
    pub current_track_id: Option<String>,
    pub next_title: Option<String>,
    pub next_artist: Option<String>,
    pub time_of_day: Option<String>, // "morning" | "afternoon" | "evening" | "night"
    pub session_duration_minutes: Option<u32>,
    pub total_tracks_played: Option<u32>,
    pub milestone_count: Option<u32>,
    pub prev_mood: Option<String>,
    pub current_mood: Option<String>,
    pub style: Option<String>,
    pub language: Option<String>,
    pub model: Option<String>,
}

#[tauri::command]
async fn ai_dj_commentary(
    state: State<'_, AppState>,
    prev_title: String,
    prev_artist: String,
    prev_track_id: Option<String>,
    next_title: String,
    next_artist: String,
    next_track_id: Option<String>,
    style: Option<String>,
    language: Option<String>,
    model: Option<String>,
) -> Result<DjCommentary, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &model.unwrap_or(ollama_model));

    // Get metadata for both tracks if available
    let db = state.db.lock().await;
    let prev_meta = prev_track_id.and_then(|id| db.get_track_metadata(&id).ok());
    let next_meta = next_track_id.and_then(|id| db.get_track_metadata(&id).ok());
    drop(db);

    let dj_style = style.unwrap_or_else(|| "classic_fm".to_string());
    let lang = language.unwrap_or_else(|| "English".to_string());

    let prompt = ollama::Prompts::dj_commentary(
        &prev_title,
        &prev_artist,
        prev_meta.as_ref().and_then(|m| m.genre.as_deref()),
        prev_meta.as_ref().and_then(|m| m.mood.as_deref()),
        &next_title,
        &next_artist,
        next_meta.as_ref().and_then(|m| m.genre.as_deref()),
        next_meta.as_ref().and_then(|m| m.mood.as_deref()),
        &dj_style,
        &lang,
    );

    client
        .generate_json_with_temp(&prompt, 0.8)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ai_dj_event(
    state: State<'_, AppState>,
    context: DjEventContext,
) -> Result<DjCommentary, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client =
        ollama::OllamaClient::with_config(&ollama_url, &context.model.unwrap_or(ollama_model));

    // Get metadata for current track if available
    let db = state.db.lock().await;
    let current_meta = context
        .current_track_id
        .as_ref()
        .and_then(|id| db.get_track_metadata(id).ok());
    let _next_meta = context.next_title.as_ref().and_then(|_| {
        context
            .current_track_id
            .as_ref()
            .and_then(|id| db.get_track_metadata(id).ok())
    });
    drop(db);

    let dj_style = context.style.unwrap_or_else(|| "classic_fm".to_string());
    let lang = context.language.unwrap_or_else(|| "English".to_string());

    // Route to appropriate prompt based on trigger type
    let prompt = match context.trigger_type.as_str() {
        "TrackStart" => {
            let title = context.current_title.unwrap_or_default();
            let artist = context.current_artist.unwrap_or_default();
            let genre = current_meta.as_ref().and_then(|m| m.genre.as_deref());
            let mood = current_meta.as_ref().and_then(|m| m.mood.as_deref());
            ollama::Prompts::dj_track_start(&title, &artist, genre, mood, &dj_style, &lang)
        }
        "QueueEmpty" => {
            let title = context.current_title.unwrap_or_default();
            let artist = context.current_artist.unwrap_or_default();
            ollama::Prompts::dj_queue_empty(&title, &artist, &dj_style, &lang)
        }
        "LongSession" => {
            let duration = context.session_duration_minutes.unwrap_or(0);
            let tracks_count = context.total_tracks_played.unwrap_or(0);
            ollama::Prompts::dj_long_session(duration, tracks_count, &dj_style, &lang)
        }
        "FirstTrackOfDay" => {
            let title = context.current_title.unwrap_or_default();
            let artist = context.current_artist.unwrap_or_default();
            let time = context.time_of_day.unwrap_or_else(|| "morning".to_string());
            let hour: u8 = match time.as_str() {
                "morning" => 8,
                "afternoon" => 14,
                "evening" => 19,
                "night" => 22,
                _ => 12,
            };
            ollama::Prompts::dj_first_track_of_day(&title, &artist, hour, &time, &dj_style, &lang)
        }
        "Milestone" => {
            let count = context.milestone_count.unwrap_or(0);
            let title = context.current_title.unwrap_or_default();
            let artist = context.current_artist.unwrap_or_default();
            let milestone_type = format!("total_tracks_{}", count);
            ollama::Prompts::dj_milestone(&milestone_type, count, &title, &artist, &dj_style, &lang)
        }
        "TimeAnnouncement" => {
            let title = context.current_title.unwrap_or_default();
            let artist = context.current_artist.unwrap_or_default();
            let now = chrono::Local::now();
            let hour = now.hour() as u8;
            let minute = now.minute() as u8;
            ollama::Prompts::dj_time_announcement(hour, minute, &title, &artist, &dj_style, &lang)
        }
        "MoodShift" => {
            let prev = context.prev_mood.unwrap_or_else(|| "unknown".to_string());
            let current = context
                .current_mood
                .unwrap_or_else(|| "unknown".to_string());
            let prev_title = context.current_title.unwrap_or_default();
            let next_title = context.next_title.unwrap_or_default();
            ollama::Prompts::dj_mood_shift(
                &prev,
                &current,
                &prev_title,
                &next_title,
                &dj_style,
                &lang,
            )
        }
        "UserRequest" => {
            let title = context.current_title.unwrap_or_default();
            let artist = context.current_artist.unwrap_or_default();
            let genre = current_meta.as_ref().and_then(|m| m.genre.as_deref());
            let mood = current_meta.as_ref().and_then(|m| m.mood.as_deref());
            ollama::Prompts::dj_user_request(&title, &artist, genre, mood, None, &dj_style, &lang)
        }
        _ => {
            return Err(format!("Unknown trigger type: {}", context.trigger_type));
        }
    };

    client
        .generate_json_with_temp(&prompt, 0.8)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// APP ENTRY
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();

    let mut builder = tauri::Builder::default().plugin(tauri_plugin_shell::init());

    #[cfg(feature = "wdio")]
    {
        builder = builder
            .plugin(tauri_plugin_wdio::init())
            .plugin(tauri_plugin_wdio_webdriver::init());
    }

    builder
        .setup(|app| {
            // Initialize database
            let db = Database::new().expect("Failed to initialize database");

            // Initialize streaming server
            let server = StreamServer::new(3456);

            // Start the HTTP server in background
            let server_handle = server.clone();
            tauri::async_runtime::spawn(async move {
                server_handle.start().await;
            });

            // Store state
            app.manage(AppState {
                db: Arc::new(Mutex::new(db)),
                server: Arc::new(Mutex::new(server)),
                ollama: Arc::new(Mutex::new(None)),
                ann_index: Arc::new(RwLock::new(ANNIndex::new())),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // YT-DLP
            search_youtube,
            get_track_info,
            get_stream_url,
            get_video_stream_url,
            download_track,
            check_ytdlp,
            check_ffmpeg_installed,
            check_edge_tts,
            speak_with_edge_tts,
            cleanup_tts_files,
            // Playlists
            get_playlists,
            create_playlist,
            delete_playlist,
            update_playlist,
            get_playlist_tracks,
            add_to_playlist,
            remove_from_playlist,
            // Library
            get_library,
            get_downloads,
            get_recently_played,
            update_play_count,
            toggle_favorite,
            get_favorites,
            // Settings
            get_settings,
            update_settings,
            // Spotify Import
            parse_spotify_csv,
            search_track_on_youtube,
            import_spotify_csv_file,
            scan_spotify_folder,
            get_default_spotify_folder,
            read_csv_file,
            // Ollama AI
            ollama_check_available,
            ollama_list_models,
            ollama_enhance_search,
            ollama_analyze_track,
            ollama_parse_command,
            ollama_generate_playlist,
            ollama_verify_spotify_match,
            // Ollama Smart Search (FAZA 1)
            ollama_mood_search,
            ollama_activity_search,
            ollama_era_search,
            ollama_similar_artists,
            ollama_lyric_search,
            ollama_cross_language_search,
            ollama_contextual_suggestions,
            ollama_smart_autocomplete,
            ollama_resolve_vague_query,
            // Ollama Auto-Tagging (FAZA 2)
            ollama_get_track_metadata,
            ollama_get_untagged_count,
            ollama_batch_analyze_tracks,
            // Smart Playlist (FAZA 3)
            smart_playlist_generate_plan,
            smart_playlist_match_library,
            smart_playlist_from_seed,
            smart_playlist_save,
            // Playlist Variants (FAZA 3 — C2-C4, C7-C12)
            smart_playlist_by_mood,
            smart_playlist_by_duration,
            smart_playlist_mood_journey,
            smart_playlist_discovery,
            smart_playlist_name,
            smart_playlist_cover_idea,
            smart_playlist_reorder,
            smart_playlist_merge,
            smart_playlist_split,
            // Daily Mix (FAZA 3 - Step 3.5)
            ollama_daily_mix,
            // Smart Queue (FAZA 4)
            smart_queue_next,
            smart_queue_crossfade,
            smart_queue_sequence,
            smart_queue_contextual,
            // Smart Spotify Import (FAZA 4 — D1-D5)
            smart_search_track_on_youtube,
            smart_search_track_with_fallback,
            smart_disambiguate_track,
            smart_alternative_queries,
            smart_assess_match_quality,
            smart_suggest_similar_track,
            smart_import_batch,
            // Insights & Analytics (FAZA 6 — F1-F10, G1-G9)
            insights_listening_profile,
            insights_weekly_summary,
            insights_time_patterns,
            insights_stats,
            insights_forgotten_gems,
            insights_more_like_this,
            insights_artist_deep_dive,
            insights_genre_explorer,
            insights_because_you_liked,
            insights_surprise_me,
            insights_seasonal,
            // Library Cleanup (FAZA 7 — H1-H7)
            cleanup_find_duplicates,
            cleanup_fix_metadata,
            cleanup_apply_metadata,
            cleanup_normalize_artists,
            cleanup_auto_organize,
            cleanup_suggest_deletions,
            cleanup_delete_track,
            // AI Chat (FAZA 7 — J1-J5)
            ai_chat_send,
            ai_chat_trivia,
            ai_chat_quiz,
            // Share & Social (FAZA 8 — K1-K3)
            share_generate_message,
            share_playlist_description,
            share_year_in_review,
            // Utilities (FAZA 8 — L1-L3)
            ai_explain_error,
            ai_settings_advice,
            ai_storage_analysis,
            // AI DJ Mode
            ai_dj_commentary,
            ai_dj_event,
            // Database
            get_total_play_count,
            // Semantic Search
            semantic_search,
            semantic_search_filtered,
            semantic_index_all,
            semantic_index_track,
            get_semantic_status,
            semantic_clear_index,
            create_semantic_playlist,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
    tracing::info!("App exited");
}

#[cfg(test)]
mod tests {
    use super::*;

    struct EnvVarGuard {
        key: &'static str,
        original: Option<std::ffi::OsString>,
    }

    impl EnvVarGuard {
        fn new(key: &'static str) -> Self {
            Self {
                key,
                original: std::env::var_os(key),
            }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            if let Some(value) = &self.original {
                std::env::set_var(self.key, value);
            } else {
                std::env::remove_var(self.key);
            }
        }
    }

    fn ytm_free_data_dir_test_lock() -> &'static std::sync::Mutex<()> {
        static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
        LOCK.get_or_init(|| std::sync::Mutex::new(()))
    }

    #[tokio::test]
    async fn test_controlled_runtime_ipc_safe_csv_wrappers_with_synthetic_temp_files() {
        let temp_dir = std::env::temp_dir().join(format!(
            "ytm-free-runtime-ipc-safe-harness-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).expect("Failed to create temp harness dir");

        let synthetic_csv = concat!(
            "Track Name,Artist Name(s),Album Name,Duration (ms),Spotify ID\n",
            "\"Synthetic IPC Song One\",\"Synthetic IPC Artist One\",\"Synthetic IPC Album One\",123000,\"spotify:track:synthetic-ipc-001\"\n",
            "\"Synthetic IPC Song Two\",\"Synthetic IPC Artist Two\",\"Synthetic IPC Album Two\",245000,\"spotify:track:synthetic-ipc-002\""
        );
        let csv_path = temp_dir.join("synthetic_ipc_export.csv");
        let invalid_csv_path = temp_dir.join("invalid_ipc_export.csv");
        let notes_path = temp_dir.join("notes.txt");

        std::fs::write(&csv_path, synthetic_csv).expect("Failed to write synthetic CSV");
        std::fs::write(&invalid_csv_path, "Name,Value\nSong,123\n")
            .expect("Failed to write invalid CSV");
        std::fs::write(&notes_path, "not a csv").expect("Failed to write non-CSV file");

        let parsed = parse_spotify_csv(synthetic_csv.to_string())
            .await
            .expect("Failed to parse synthetic CSV through IPC wrapper");
        assert_eq!(parsed.len(), 2, "Expected two parsed synthetic tracks");

        assert_eq!(parsed[0].track_name, "Synthetic IPC Song One");
        assert_eq!(parsed[0].artist_name, "Synthetic IPC Artist One");
        assert_eq!(parsed[0].album_name, "Synthetic IPC Album One");
        assert_eq!(parsed[0].duration_ms, Some(123000));
        assert_eq!(
            parsed[0].spotify_id,
            Some("spotify:track:synthetic-ipc-001".to_string())
        );

        assert_eq!(parsed[1].track_name, "Synthetic IPC Song Two");
        assert_eq!(parsed[1].artist_name, "Synthetic IPC Artist Two");
        assert_eq!(parsed[1].album_name, "Synthetic IPC Album Two");
        assert_eq!(parsed[1].duration_ms, Some(245000));
        assert_eq!(
            parsed[1].spotify_id,
            Some("spotify:track:synthetic-ipc-002".to_string())
        );

        let read_back = read_csv_file(csv_path.to_string_lossy().to_string())
            .expect("Failed to read synthetic CSV through IPC wrapper");
        assert_eq!(read_back, synthetic_csv);

        let scanned = scan_spotify_folder(temp_dir.to_string_lossy().to_string())
            .expect("Failed to scan temp CSV folder through IPC wrapper");
        assert_eq!(
            scanned.len(),
            2,
            "Scanner should include only CSV files and ignore non-CSV files"
        );
        assert!(
            scanned.iter().all(|entry| entry.name != "notes"),
            "Scanner should ignore non-CSV files"
        );

        let synthetic_entry = scanned
            .iter()
            .find(|entry| entry.name == "synthetic_ipc_export")
            .expect("Synthetic CSV should be scanned");
        assert_eq!(synthetic_entry.track_count, 2);
        assert_eq!(synthetic_entry.path, csv_path.to_string_lossy());

        let invalid_entry = scanned
            .iter()
            .find(|entry| entry.name == "invalid_ipc_export")
            .expect("Invalid CSV should still be listed by scanner");
        assert_eq!(
            invalid_entry.track_count, 0,
            "Invalid CSV track_count should follow existing scan behavior"
        );

        println!(
            "RUNTIME_IPC_SAFE_HARNESS parsed_tracks={} scanned_csvs={} temp_dir={}",
            parsed.len(),
            scanned.len(),
            temp_dir.display()
        );

        std::fs::remove_dir_all(&temp_dir).expect("Failed to remove temp harness dir");
    }

    #[test]
    fn test_controlled_stateful_ipc_db_playlist_wrappers_with_temp_database() {
        let _lock = ytm_free_data_dir_test_lock().lock().unwrap();
        let _guard = EnvVarGuard::new("YTM_FREE_DATA_DIR");

        let temp_dir = std::env::temp_dir().join(format!(
            "ytm-free-stateful-ipc-db-harness-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).expect("Failed to create temp data dir");
        std::env::set_var("YTM_FREE_DATA_DIR", &temp_dir);

        let db = Database::new().expect("Failed to create temp database");
        let playlist = create_playlist_db_helper(
            &db,
            "Stateful IPC Harness Playlist",
            Some("Synthetic playlist for stateful IPC DB helper harness"),
        )
        .expect("Failed to create playlist through DB helper");
        assert_eq!(playlist.name, "Stateful IPC Harness Playlist");
        assert_eq!(playlist.track_count, 0);

        let track_a = add_to_playlist_db_helper(
            &db,
            &playlist.id,
            "stateful-ipc-video-001",
            "Stateful IPC Song One",
            "Stateful IPC Artist One",
            "https://i.ytimg.com/vi/stateful-ipc-video-001/mqdefault.jpg",
            Some(123),
        )
        .expect("Failed to add track A through DB helper");
        let track_b = add_to_playlist_db_helper(
            &db,
            &playlist.id,
            "stateful-ipc-video-002",
            "Stateful IPC Song Two",
            "Stateful IPC Artist Two",
            "https://i.ytimg.com/vi/stateful-ipc-video-002/mqdefault.jpg",
            Some(245),
        )
        .expect("Failed to add track B through DB helper");

        let playlist_tracks = db
            .get_playlist_tracks(&playlist.id)
            .expect("Failed to read playlist tracks after add");
        assert_eq!(playlist_tracks.len(), 2);
        assert_eq!(playlist_tracks[0].video_id, "stateful-ipc-video-001");
        assert_eq!(playlist_tracks[0].duration, Some(123));
        assert_eq!(playlist_tracks[1].video_id, "stateful-ipc-video-002");
        assert_eq!(playlist_tracks[1].duration, Some(245));

        remove_from_playlist_db_helper(&db, &playlist.id, &track_a.id)
            .expect("Failed to remove track A through DB helper");
        let after_remove_tracks = db
            .get_playlist_tracks(&playlist.id)
            .expect("Failed to read playlist tracks after removal");
        assert_eq!(after_remove_tracks.len(), 1);
        assert_eq!(after_remove_tracks[0].video_id, "stateful-ipc-video-002");
        assert!(db.get_track_by_uuid(&track_a.id).is_ok());

        let metadata = crate::ollama::TrackMetadataAI {
            genre: "synthetic".to_string(),
            sub_genre: None,
            mood: "focused".to_string(),
            energy_level: 7,
            tempo: "medium".to_string(),
            danceability: 4,
            vocal_type: "instrumental".to_string(),
            decade: "2020s".to_string(),
            language: "Instrumental".to_string(),
            activity_tags: vec!["test".to_string()],
            occasion_tags: vec!["harness".to_string()],
            keywords: vec!["stateful".to_string(), "ipc".to_string()],
        };
        db.save_track_metadata(&track_b.id, &metadata, "synthetic-stateful-ipc-harness")
            .expect("Failed to save synthetic metadata");
        db.update_play_count("stateful-ipc-video-002")
            .expect("Failed to create synthetic play history");
        assert!(db.get_track_metadata(&track_b.id).is_ok());
        assert_eq!(
            db.get_play_history(1, 10)
                .expect("Failed to read synthetic play history")
                .len(),
            1
        );

        delete_playlist_db_helper(&db, &playlist.id)
            .expect("Failed to delete playlist through DB helper");
        assert!(db.get_playlist(&playlist.id).is_err());
        let playlist_tracks_after_delete = db
            .get_playlist_tracks(&playlist.id)
            .expect("Failed to observe playlist tracks after playlist delete");
        assert!(
            playlist_tracks_after_delete.len() <= 1,
            "Deleted playlist should have at most the previously kept link"
        );
        let delete_playlist_link_count = playlist_tracks_after_delete.len();

        cleanup_delete_track_db_helper(&db, &track_b.id)
            .expect("Failed to delete track B through DB helper");
        assert!(db.get_track_by_uuid(&track_b.id).is_err());
        assert!(db.get_track_metadata(&track_b.id).is_err());
        assert!(
            db.get_play_history(1, 10)
                .expect("Failed to read play history after track delete")
                .is_empty(),
            "Track delete helper should remove synthetic play history"
        );
        assert!(
            db.get_playlist_tracks(&playlist.id)
                .expect("Failed to read playlist tracks after track cleanup")
                .is_empty(),
            "Track delete helper should remove remaining playlist links"
        );
        assert!(db.get_track_by_uuid(&track_a.id).is_ok());

        drop(db);

        let db2 = Database::new().expect("Failed to reopen temp database");
        assert!(db2.get_playlist(&playlist.id).is_err());
        assert!(db2.get_track_by_uuid(&track_a.id).is_ok());
        assert!(db2.get_track_by_uuid(&track_b.id).is_err());
        assert!(db2.get_track_metadata(&track_b.id).is_err());
        assert!(db2
            .get_playlist_tracks(&playlist.id)
            .expect("Failed to read reopened playlist tracks")
            .is_empty());
        assert!(db2
            .get_play_history(1, 10)
            .expect("Failed to read reopened play history")
            .is_empty());
        drop(db2);

        println!(
            "STATEFUL_IPC_DB_HARNESS playlist_id={} track_a={} track_b={} delete_playlist_link_count={} temp_dir={}",
            playlist.id,
            track_a.id,
            track_b.id,
            delete_playlist_link_count,
            temp_dir.display()
        );

        std::fs::remove_dir_all(&temp_dir).expect("Failed to remove temp data dir");
    }

    #[test]
    fn test_controlled_ai_semantic_db_cache_helpers_with_temp_database() {
        let _lock = ytm_free_data_dir_test_lock().lock().unwrap();
        let _guard = EnvVarGuard::new("YTM_FREE_DATA_DIR");

        let temp_dir = std::env::temp_dir().join(format!(
            "ytm-free-ai-semantic-db-cache-harness-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).expect("Failed to create temp data dir");
        std::env::set_var("YTM_FREE_DATA_DIR", &temp_dir);

        let db = Database::new().expect("Failed to create temp database");
        let track_a = db
            .add_track(
                "ai-cache-video-001",
                "AI Cache Harness Song One",
                "AI Cache Harness Artist One",
                "https://i.ytimg.com/vi/ai-cache-video-001/mqdefault.jpg",
                None,
            )
            .expect("Failed to add synthetic track A");
        let track_b = db
            .add_track(
                "ai-cache-video-002",
                "AI Cache Harness Song Two",
                "AI Cache Harness Artist Two",
                "https://i.ytimg.com/vi/ai-cache-video-002/mqdefault.jpg",
                None,
            )
            .expect("Failed to add synthetic track B");

        let metadata = crate::ollama::TrackMetadataAI {
            genre: "synthetic-cache".to_string(),
            sub_genre: Some("harness".to_string()),
            mood: "focused".to_string(),
            energy_level: 6,
            tempo: "medium".to_string(),
            danceability: 5,
            vocal_type: "instrumental".to_string(),
            decade: "2020s".to_string(),
            language: "Instrumental".to_string(),
            activity_tags: vec!["coding".to_string(), "verification".to_string()],
            occasion_tags: vec!["test".to_string()],
            keywords: vec!["ai-cache".to_string(), "semantic".to_string()],
        };
        db.save_track_metadata(&track_a.id, &metadata, "synthetic-ai-cache-harness")
            .expect("Failed to save synthetic metadata");

        db.save_embedding(
            &track_a.id,
            &[0.10, 0.20, 0.30, 0.40],
            "AI Cache Harness Song One by AI Cache Harness Artist One",
            "synthetic-embedding-model",
            4,
        )
        .expect("Failed to save synthetic embedding A");
        db.save_embedding(
            &track_b.id,
            &[0.40, 0.30, 0.20, 0.10],
            "AI Cache Harness Song Two by AI Cache Harness Artist Two",
            "synthetic-embedding-model",
            4,
        )
        .expect("Failed to save synthetic embedding B");

        let metadata_result = ollama_get_track_metadata_db_helper(&db, &track_a.id)
            .expect("Failed to read metadata through DB helper")
            .expect("Synthetic metadata should exist");
        assert_eq!(metadata_result.track_id, track_a.id);
        assert_eq!(metadata_result.genre.as_deref(), Some("synthetic-cache"));
        assert_eq!(metadata_result.mood.as_deref(), Some("focused"));
        assert_eq!(
            metadata_result.model_used.as_deref(),
            Some("synthetic-ai-cache-harness")
        );
        assert!(
            ollama_get_track_metadata_db_helper(&db, &track_b.id)
                .expect("Failed to read missing metadata through DB helper")
                .is_none(),
            "Track B should remain untagged"
        );

        let untagged_count = ollama_get_untagged_count_db_helper(&db)
            .expect("Failed to read untagged count through DB helper");
        assert_eq!(untagged_count, 1, "Only track B should be untagged");

        let semantic_before = get_semantic_status_db_helper(&db)
            .expect("Failed to read semantic status before clear");
        assert_eq!(semantic_before.total_tracks, 2);
        assert_eq!(semantic_before.indexed_tracks, 2);
        assert_eq!(semantic_before.model_used, "all-minilm");
        assert!(!semantic_before.is_indexing);

        semantic_clear_index_db_helper(&db).expect("Failed to clear semantic embeddings");
        let semantic_after =
            get_semantic_status_db_helper(&db).expect("Failed to read semantic status after clear");
        assert_eq!(semantic_after.total_tracks, 2);
        assert_eq!(semantic_after.indexed_tracks, 0);
        assert_eq!(semantic_after.model_used, "all-minilm");

        assert!(
            db.get_embedding(&track_a.id)
                .expect("Failed to read embedding A after clear")
                .is_none(),
            "Semantic clear should remove embedding A"
        );
        assert!(
            db.get_embedding(&track_b.id)
                .expect("Failed to read embedding B after clear")
                .is_none(),
            "Semantic clear should remove embedding B"
        );
        assert!(db.get_track_by_uuid(&track_a.id).is_ok());
        assert!(db.get_track_by_uuid(&track_b.id).is_ok());
        assert!(db.get_track_metadata(&track_a.id).is_ok());
        assert!(db.get_track_metadata(&track_b.id).is_err());

        drop(db);

        let db2 = Database::new().expect("Failed to reopen temp database");
        let reopened_metadata = ollama_get_track_metadata_db_helper(&db2, &track_a.id)
            .expect("Failed to read reopened metadata through DB helper")
            .expect("Reopened synthetic metadata should exist");
        assert_eq!(reopened_metadata.genre.as_deref(), Some("synthetic-cache"));
        assert_eq!(
            ollama_get_untagged_count_db_helper(&db2)
                .expect("Failed to read reopened untagged count"),
            1
        );
        let reopened_status =
            get_semantic_status_db_helper(&db2).expect("Failed to read reopened semantic status");
        assert_eq!(reopened_status.total_tracks, 2);
        assert_eq!(reopened_status.indexed_tracks, 0);
        assert!(db2.get_track_by_uuid(&track_a.id).is_ok());
        assert!(db2.get_track_by_uuid(&track_b.id).is_ok());
        drop(db2);

        println!(
            "AI_SEMANTIC_DB_CACHE_HARNESS tracks={} untagged_count={} semantic_before={} semantic_after={} temp_dir={}",
            2,
            untagged_count,
            semantic_before.indexed_tracks,
            semantic_after.indexed_tracks,
            temp_dir.display()
        );

        std::fs::remove_dir_all(&temp_dir).expect("Failed to remove temp data dir");
    }

    #[test]
    fn test_controlled_semantic_search_stub_uses_temp_db_embeddings() {
        let _lock = ytm_free_data_dir_test_lock().lock().unwrap();
        let _guard = EnvVarGuard::new("YTM_FREE_DATA_DIR");

        let temp_dir = std::env::temp_dir().join(format!(
            "ytm-free-semantic-search-stub-harness-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).expect("Failed to create temp data dir");
        std::env::set_var("YTM_FREE_DATA_DIR", &temp_dir);

        let query_embedding = vec![1.0_f32, 0.0, 0.0];
        let db = Database::new().expect("Failed to create temp database");
        let near_track = db
            .add_track(
                "semantic-stub-video-001",
                "Semantic Stub Song Near",
                "Semantic Stub Artist Near",
                "https://i.ytimg.com/vi/semantic-stub-video-001/mqdefault.jpg",
                None,
            )
            .expect("Failed to add near synthetic track");
        let medium_track = db
            .add_track(
                "semantic-stub-video-002",
                "Semantic Stub Song Medium",
                "Semantic Stub Artist Medium",
                "https://i.ytimg.com/vi/semantic-stub-video-002/mqdefault.jpg",
                None,
            )
            .expect("Failed to add medium synthetic track");
        let far_track = db
            .add_track(
                "semantic-stub-video-003",
                "Semantic Stub Song Far",
                "Semantic Stub Artist Far",
                "https://i.ytimg.com/vi/semantic-stub-video-003/mqdefault.jpg",
                None,
            )
            .expect("Failed to add far synthetic track");
        let no_embedding_track = db
            .add_track(
                "semantic-stub-video-no-embedding",
                "Semantic Stub Song No Embedding",
                "Semantic Stub Artist No Embedding",
                "https://i.ytimg.com/vi/semantic-stub-video-no-embedding/mqdefault.jpg",
                None,
            )
            .expect("Failed to add no-embedding synthetic track");

        db.save_embedding(
            &near_track.id,
            &[1.0, 0.0, 0.0],
            "Semantic Stub Song Near by Semantic Stub Artist Near",
            "synthetic-semantic-stub-model",
            3,
        )
        .expect("Failed to save near synthetic embedding");
        db.save_embedding(
            &medium_track.id,
            &[0.8, 0.6, 0.0],
            "Semantic Stub Song Medium by Semantic Stub Artist Medium",
            "synthetic-semantic-stub-model",
            3,
        )
        .expect("Failed to save medium synthetic embedding");
        db.save_embedding(
            &far_track.id,
            &[0.4, 0.9165, 0.0],
            "Semantic Stub Song Far by Semantic Stub Artist Far",
            "synthetic-semantic-stub-model",
            3,
        )
        .expect("Failed to save far synthetic embedding");

        let limited_results =
            semantic_search_with_embedding_db_helper(&db, &query_embedding, Some(2))
                .expect("Failed to run semantic search helper with limit");
        assert_eq!(limited_results.len(), 2, "Limit should be respected");
        assert_eq!(limited_results[0].track.video_id, "semantic-stub-video-001");
        assert_eq!(limited_results[1].track.video_id, "semantic-stub-video-002");
        assert!(limited_results[0].similarity > limited_results[1].similarity);
        assert!(!limited_results
            .iter()
            .any(|result| result.track.id == no_embedding_track.id));

        let full_results =
            semantic_search_with_embedding_db_helper(&db, &query_embedding, Some(10))
                .expect("Failed to run semantic search helper without truncation");
        assert_eq!(
            full_results.len(),
            3,
            "All embedded tracks should be returned"
        );
        assert_eq!(full_results[0].track.video_id, "semantic-stub-video-001");
        assert_eq!(full_results[1].track.video_id, "semantic-stub-video-002");
        assert_eq!(full_results[2].track.video_id, "semantic-stub-video-003");
        assert!(full_results[1].similarity > full_results[2].similarity);

        drop(db);

        let db2 = Database::new().expect("Failed to reopen temp database");
        let reopened_results =
            semantic_search_with_embedding_db_helper(&db2, &query_embedding, Some(10))
                .expect("Failed to run semantic search helper after reopen");
        assert_eq!(reopened_results.len(), 3);
        assert_eq!(
            reopened_results[0].track.video_id,
            "semantic-stub-video-001"
        );
        assert_eq!(
            reopened_results[1].track.video_id,
            "semantic-stub-video-002"
        );
        assert_eq!(
            reopened_results[2].track.video_id,
            "semantic-stub-video-003"
        );
        assert!(!reopened_results
            .iter()
            .any(|result| result.track.id == no_embedding_track.id));
        drop(db2);

        println!(
            "SEMANTIC_SEARCH_STUB_HARNESS results={} top={} limit={} temp_dir={}",
            reopened_results.len(),
            reopened_results[0].track.video_id,
            2,
            temp_dir.display()
        );

        std::fs::remove_dir_all(&temp_dir).expect("Failed to remove temp data dir");
    }

    #[test]
    fn test_controlled_semantic_search_prepare_embedding_input_uses_temp_db_settings() {
        let _lock = ytm_free_data_dir_test_lock().lock().unwrap();
        let _guard = EnvVarGuard::new("YTM_FREE_DATA_DIR");

        let temp_dir = std::env::temp_dir().join(format!(
            "ytm-free-semantic-search-lock-scope-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).expect("Failed to create temp data dir");
        std::env::set_var("YTM_FREE_DATA_DIR", &temp_dir);

        let db = Database::new().expect("Failed to create temp database");
        let mut settings = db.get_settings().expect("Failed to read temp settings");
        settings.semantic_search_enabled = true;
        settings.ollama_url = "http://semantic-search-lock-scope.invalid:11434".to_string();
        settings.embedding_model = "semantic-search-lock-scope-model".to_string();
        db.update_settings(&settings)
            .expect("Failed to update temp semantic settings");

        let query = "semantic-search-lock-scope-query";
        let prepared = semantic_search_prepare_embedding_input_db_helper(&db, query)
            .expect("Failed to prepare semantic search embedding input");
        assert_eq!(prepared.query, query);
        assert_eq!(
            prepared.ollama_url,
            "http://semantic-search-lock-scope.invalid:11434"
        );
        assert_eq!(prepared.embedding_model, "semantic-search-lock-scope-model");
        assert_eq!(
            db.count_embeddings()
                .expect("Failed to count embeddings before post helper"),
            0,
            "Prepare helper must not persist embeddings"
        );

        let track = db
            .add_track(
                "semantic-search-lock-scope-video-001",
                "Semantic Search Lock Scope Song",
                "Semantic Search Lock Scope Artist",
                "https://i.ytimg.com/vi/semantic-search-lock-scope-video-001/mqdefault.jpg",
                None,
            )
            .expect("Failed to add semantic search lock-scope synthetic track");
        db.save_embedding(
            &track.id,
            &[1.0, 0.0, 0.0],
            "Semantic Search Lock Scope Song by Semantic Search Lock Scope Artist",
            &prepared.embedding_model,
            3,
        )
        .expect("Failed to save synthetic semantic search embedding");

        let results = semantic_search_with_embedding_db_helper(&db, &[1.0, 0.0, 0.0], Some(10))
            .expect("Failed to run semantic search post-embedding helper");
        assert_eq!(results.len(), 1);
        assert_eq!(
            results[0].track.video_id,
            "semantic-search-lock-scope-video-001"
        );
        assert_eq!(
            db.count_embeddings()
                .expect("Failed to count embeddings after post helper"),
            1
        );

        println!(
            "SEMANTIC_SEARCH_LOCK_SCOPE_HARNESS query={} model={} results={} temp_dir={}",
            prepared.query,
            prepared.embedding_model,
            results.len(),
            temp_dir.display()
        );

        drop(db);
        std::fs::remove_dir_all(&temp_dir).expect("Failed to remove temp data dir");
    }

    #[test]
    fn test_controlled_semantic_filtered_search_prepare_embedding_input_uses_temp_db_settings() {
        let _lock = ytm_free_data_dir_test_lock().lock().unwrap();
        let _guard = EnvVarGuard::new("YTM_FREE_DATA_DIR");

        let temp_dir = std::env::temp_dir().join(format!(
            "ytm-free-semantic-filtered-search-lock-scope-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).expect("Failed to create temp data dir");
        std::env::set_var("YTM_FREE_DATA_DIR", &temp_dir);

        let db = Database::new().expect("Failed to create temp database");
        let mut settings = db.get_settings().expect("Failed to read temp settings");
        settings.semantic_search_enabled = true;
        settings.ollama_url = "http://semantic-filtered-lock-scope.invalid:11434".to_string();
        settings.embedding_model = "semantic-filtered-lock-scope-model".to_string();
        db.update_settings(&settings)
            .expect("Failed to update temp semantic filtered settings");

        let prepared = semantic_search_filtered_prepare_embedding_input_db_helper(
            &db,
            "semantic-filtered-lock-scope-query",
            Some(vec!["rock".to_string()]),
            Some(vec!["focus".to_string()]),
            Some(vec!["coding".to_string()]),
        )
        .expect("Failed to prepare semantic filtered search embedding input");
        assert_eq!(prepared.query, "semantic-filtered-lock-scope-query");
        assert_eq!(
            prepared.ollama_url,
            "http://semantic-filtered-lock-scope.invalid:11434"
        );
        assert_eq!(
            prepared.embedding_model,
            "semantic-filtered-lock-scope-model"
        );
        assert_eq!(prepared.filter.genres, Some(vec!["rock".to_string()]));
        assert_eq!(prepared.filter.moods, Some(vec!["focus".to_string()]));
        assert_eq!(prepared.filter.activities, Some(vec!["coding".to_string()]));
        assert_eq!(prepared.filter.min_similarity, Some(0.3));
        assert_eq!(
            db.count_embeddings()
                .expect("Failed to count embeddings before filtered post helper"),
            0,
            "Prepare helper must not persist embeddings"
        );

        let track = db
            .add_track(
                "semantic-filtered-lock-scope-video-001",
                "Semantic Filtered Lock Scope Song",
                "Semantic Filtered Lock Scope Artist",
                "https://i.ytimg.com/vi/semantic-filtered-lock-scope-video-001/mqdefault.jpg",
                None,
            )
            .expect("Failed to add filtered lock-scope synthetic track");
        let metadata = crate::ollama::TrackMetadataAI {
            genre: "rock".to_string(),
            sub_genre: None,
            mood: "focus".to_string(),
            energy_level: 5,
            tempo: "medium".to_string(),
            danceability: 5,
            vocal_type: "mixed vocals".to_string(),
            decade: "2020s".to_string(),
            language: "English".to_string(),
            activity_tags: vec!["coding".to_string()],
            occasion_tags: vec![],
            keywords: vec!["filtered".to_string(), "lock-scope".to_string()],
        };
        db.save_track_metadata(
            &track.id,
            &metadata,
            "synthetic-semantic-filtered-lock-scope-harness",
        )
        .expect("Failed to save filtered lock-scope synthetic metadata");
        db.save_embedding(
            &track.id,
            &[1.0, 0.0, 0.0],
            "Semantic Filtered Lock Scope Song by Semantic Filtered Lock Scope Artist",
            &prepared.embedding_model,
            3,
        )
        .expect("Failed to save filtered lock-scope synthetic embedding");

        let results = semantic_search_filtered_with_embedding_db_helper(
            &db,
            &[1.0, 0.0, 0.0],
            Some(10),
            prepared.filter.genres.clone(),
            prepared.filter.moods.clone(),
            prepared.filter.activities.clone(),
            prepared.filter.min_similarity,
        )
        .expect("Failed to run semantic filtered post-embedding helper");
        assert_eq!(results.len(), 1);
        assert_eq!(
            results[0].track.video_id,
            "semantic-filtered-lock-scope-video-001"
        );
        assert_eq!(
            db.count_embeddings()
                .expect("Failed to count embeddings after filtered post helper"),
            1
        );

        println!(
            "SEMANTIC_FILTERED_LOCK_SCOPE_HARNESS query={} model={} results={} activities={} temp_dir={}",
            prepared.query,
            prepared.embedding_model,
            results.len(),
            prepared.filter.activities.as_ref().map(|a| a.len()).unwrap_or(0),
            temp_dir.display()
        );

        drop(db);
        std::fs::remove_dir_all(&temp_dir).expect("Failed to remove temp data dir");
    }

    #[test]
    fn test_controlled_semantic_filtered_search_stub_uses_temp_db_embeddings() {
        let _lock = ytm_free_data_dir_test_lock().lock().unwrap();
        let _guard = EnvVarGuard::new("YTM_FREE_DATA_DIR");

        let temp_dir = std::env::temp_dir().join(format!(
            "ytm-free-semantic-filtered-stub-harness-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).expect("Failed to create temp data dir");
        std::env::set_var("YTM_FREE_DATA_DIR", &temp_dir);

        let query_embedding = vec![1.0_f32, 0.0, 0.0];
        let db = Database::new().expect("Failed to create temp database");
        let near_rock_happy = db
            .add_track(
                "semantic-filtered-video-001",
                "Semantic Filtered Song Near Rock Happy",
                "Semantic Filtered Artist One",
                "https://i.ytimg.com/vi/semantic-filtered-video-001/mqdefault.jpg",
                None,
            )
            .expect("Failed to add near rock happy synthetic track");
        let medium_rock_calm = db
            .add_track(
                "semantic-filtered-video-002",
                "Semantic Filtered Song Medium Rock Calm",
                "Semantic Filtered Artist Two",
                "https://i.ytimg.com/vi/semantic-filtered-video-002/mqdefault.jpg",
                None,
            )
            .expect("Failed to add medium rock calm synthetic track");
        let far_jazz_happy = db
            .add_track(
                "semantic-filtered-video-003",
                "Semantic Filtered Song Far Jazz Happy",
                "Semantic Filtered Artist Three",
                "https://i.ytimg.com/vi/semantic-filtered-video-003/mqdefault.jpg",
                None,
            )
            .expect("Failed to add far jazz happy synthetic track");
        let no_embedding_rock_happy = db
            .add_track(
                "semantic-filtered-video-004",
                "Semantic Filtered Song No Embedding",
                "Semantic Filtered Artist Four",
                "https://i.ytimg.com/vi/semantic-filtered-video-004/mqdefault.jpg",
                None,
            )
            .expect("Failed to add no-embedding synthetic track");

        let save_metadata = |track_id: &str, genre: &str, mood: &str| {
            let metadata = crate::ollama::TrackMetadataAI {
                genre: genre.to_string(),
                sub_genre: None,
                mood: mood.to_string(),
                energy_level: 5,
                tempo: "medium".to_string(),
                danceability: 5,
                vocal_type: "mixed vocals".to_string(),
                decade: "2020s".to_string(),
                language: "English".to_string(),
                activity_tags: vec!["not-validated-in-db-fallback".to_string()],
                occasion_tags: vec![],
                keywords: vec![genre.to_string(), mood.to_string()],
            };
            db.save_track_metadata(track_id, &metadata, "synthetic-semantic-filtered-harness")
                .expect("Failed to save synthetic metadata");
        };
        save_metadata(&near_rock_happy.id, "rock", "happy");
        save_metadata(&medium_rock_calm.id, "rock", "calm");
        save_metadata(&far_jazz_happy.id, "jazz", "happy");
        save_metadata(&no_embedding_rock_happy.id, "rock", "happy");

        db.save_embedding(
            &near_rock_happy.id,
            &[1.0, 0.0, 0.0],
            "Semantic Filtered Song Near Rock Happy by Semantic Filtered Artist One",
            "synthetic-semantic-filtered-model",
            3,
        )
        .expect("Failed to save near synthetic embedding");
        db.save_embedding(
            &medium_rock_calm.id,
            &[0.8, 0.6, 0.0],
            "Semantic Filtered Song Medium Rock Calm by Semantic Filtered Artist Two",
            "synthetic-semantic-filtered-model",
            3,
        )
        .expect("Failed to save medium synthetic embedding");
        db.save_embedding(
            &far_jazz_happy.id,
            &[0.4, 0.9165, 0.0],
            "Semantic Filtered Song Far Jazz Happy by Semantic Filtered Artist Three",
            "synthetic-semantic-filtered-model",
            3,
        )
        .expect("Failed to save far synthetic embedding");

        let all_results = semantic_search_filtered_with_embedding_db_helper(
            &db,
            &query_embedding,
            Some(10),
            None,
            None,
            None,
            Some(0.3),
        )
        .expect("Failed to run filtered semantic helper without filters");
        assert_eq!(all_results.len(), 3);
        assert_eq!(all_results[0].track.video_id, "semantic-filtered-video-001");
        assert_eq!(all_results[1].track.video_id, "semantic-filtered-video-002");
        assert_eq!(all_results[2].track.video_id, "semantic-filtered-video-003");
        assert!(!all_results
            .iter()
            .any(|result| result.track.id == no_embedding_rock_happy.id));

        let genre_results = semantic_search_filtered_with_embedding_db_helper(
            &db,
            &query_embedding,
            Some(10),
            Some(vec!["rock".to_string()]),
            None,
            None,
            Some(0.3),
        )
        .expect("Failed to run filtered semantic helper with genre filter");
        let genre_ids: Vec<&str> = genre_results
            .iter()
            .map(|result| result.track.video_id.as_str())
            .collect();
        assert_eq!(
            genre_ids,
            vec!["semantic-filtered-video-001", "semantic-filtered-video-002"]
        );

        let mood_results = semantic_search_filtered_with_embedding_db_helper(
            &db,
            &query_embedding,
            Some(10),
            None,
            Some(vec!["happy".to_string()]),
            None,
            Some(0.3),
        )
        .expect("Failed to run filtered semantic helper with mood filter");
        let mood_ids: Vec<&str> = mood_results
            .iter()
            .map(|result| result.track.video_id.as_str())
            .collect();
        assert_eq!(
            mood_ids,
            vec!["semantic-filtered-video-001", "semantic-filtered-video-003"]
        );

        let combined_results = semantic_search_filtered_with_embedding_db_helper(
            &db,
            &query_embedding,
            Some(10),
            Some(vec!["rock".to_string()]),
            Some(vec!["happy".to_string()]),
            None,
            Some(0.3),
        )
        .expect("Failed to run filtered semantic helper with combined filters");
        assert_eq!(combined_results.len(), 1);
        assert_eq!(
            combined_results[0].track.video_id,
            "semantic-filtered-video-001"
        );

        let limited_results = semantic_search_filtered_with_embedding_db_helper(
            &db,
            &query_embedding,
            Some(1),
            Some(vec!["rock".to_string()]),
            None,
            None,
            Some(0.3),
        )
        .expect("Failed to run filtered semantic helper with limit");
        assert_eq!(limited_results.len(), 1);
        assert_eq!(
            limited_results[0].track.video_id,
            "semantic-filtered-video-001"
        );
        // DB fallback now applies genre, mood, activities and min_similarity. This
        // existing test exercises genre/mood/limit/reopen with activities=None and
        // min_similarity=Some(0.3); activities + sub-threshold exclusion are covered
        // by test_controlled_semantic_filtered_search_stub_respects_activities_and_min_similarity.

        drop(db);

        let db2 = Database::new().expect("Failed to reopen temp database");
        let reopened_results = semantic_search_filtered_with_embedding_db_helper(
            &db2,
            &query_embedding,
            Some(10),
            Some(vec!["rock".to_string()]),
            Some(vec!["happy".to_string()]),
            None,
            Some(0.3),
        )
        .expect("Failed to run filtered semantic helper after reopen");
        assert_eq!(reopened_results.len(), 1);
        assert_eq!(
            reopened_results[0].track.video_id,
            "semantic-filtered-video-001"
        );
        drop(db2);

        println!(
            "SEMANTIC_FILTERED_STUB_HARNESS results={} top={} genre_filtered={} mood_filtered={} combined_filtered={} temp_dir={}",
            all_results.len(),
            all_results[0].track.video_id,
            genre_results.len(),
            mood_results.len(),
            reopened_results.len(),
            temp_dir.display()
        );

        std::fs::remove_dir_all(&temp_dir).expect("Failed to remove temp data dir");
    }

    #[test]
    fn test_controlled_semantic_filtered_search_stub_respects_activities_and_min_similarity() {
        let _lock = ytm_free_data_dir_test_lock().lock().unwrap();
        let _guard = EnvVarGuard::new("YTM_FREE_DATA_DIR");

        let temp_dir = std::env::temp_dir().join(format!(
            "ytm-free-semantic-filtered-parity-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).expect("Failed to create temp data dir");
        std::env::set_var("YTM_FREE_DATA_DIR", &temp_dir);

        let query_embedding = vec![1.0_f32, 0.0, 0.0];
        let db = Database::new().expect("Failed to create temp database for parity test");

        // Deterministic synthetic tracks. Embeddings are unit-length so the true
        // cosine returned by lib::cosine_similarity matches the dot product.
        //   over_match   : sim 1.0, activity_tags=["coding"]  -> over threshold AND activity match
        //   over_mismatch: sim 0.9, activity_tags=["driving"] -> over threshold, activity mismatch
        //   sub_match    : sim 0.2, activity_tags=["coding"]  -> sub threshold, activity match
        let add = |video_id: &str, title: &str| {
            db.add_track(
                video_id,
                title,
                "Parity Artist",
                &format!("https://i.ytimg.com/vi/{}/mqdefault.jpg", video_id),
                None,
            )
            .expect("Failed to add synthetic parity track")
        };
        let over_match = add("semantic-parity-video-001", "Parity Over Match");
        let over_mismatch = add("semantic-parity-video-002", "Parity Over Mismatch");
        let sub_match = add("semantic-parity-video-003", "Parity Sub Match");

        let save_metadata = |track_id: &str, genre: &str, mood: &str, activities: Vec<String>| {
            let metadata = crate::ollama::TrackMetadataAI {
                genre: genre.to_string(),
                sub_genre: None,
                mood: mood.to_string(),
                energy_level: 5,
                tempo: "medium".to_string(),
                danceability: 5,
                vocal_type: "mixed vocals".to_string(),
                decade: "2020s".to_string(),
                language: "English".to_string(),
                activity_tags: activities,
                occasion_tags: vec![],
                keywords: vec![genre.to_string(), mood.to_string()],
            };
            db.save_track_metadata(
                track_id,
                &metadata,
                "synthetic-semantic-filtered-parity-harness",
            )
            .expect("Failed to save synthetic parity metadata");
        };
        save_metadata(&over_match.id, "rock", "happy", vec!["coding".to_string()]);
        save_metadata(
            &over_mismatch.id,
            "rock",
            "happy",
            vec!["driving".to_string()],
        );
        save_metadata(&sub_match.id, "rock", "happy", vec!["coding".to_string()]);

        db.save_embedding(
            &over_match.id,
            &[1.0, 0.0, 0.0],
            "Parity Over Match text",
            "synthetic-parity-model",
            3,
        )
        .expect("Failed to save over_match embedding");
        db.save_embedding(
            &over_mismatch.id,
            &[0.9, 0.435889894, 0.0],
            "Parity Over Mismatch text",
            "synthetic-parity-model",
            3,
        )
        .expect("Failed to save over_mismatch embedding");
        db.save_embedding(
            &sub_match.id,
            &[0.2, 0.979795897, 0.0],
            "Parity Sub Match text",
            "synthetic-parity-model",
            3,
        )
        .expect("Failed to save sub_match embedding");

        // 1. threshold only (0.3): over_match + over_mismatch; sub_match excluded by threshold.
        let threshold_results = semantic_search_filtered_with_embedding_db_helper(
            &db,
            &query_embedding,
            Some(10),
            None,
            None,
            None,
            Some(0.3),
        )
        .expect("Failed to run parity helper with threshold only");
        let threshold_ids: Vec<&str> = threshold_results
            .iter()
            .map(|r| r.track.video_id.as_str())
            .collect();
        assert_eq!(
            threshold_ids,
            vec!["semantic-parity-video-001", "semantic-parity-video-002"],
            "min_similarity=0.3 must exclude the sub-threshold track"
        );
        assert!(!threshold_ids.contains(&"semantic-parity-video-003"));

        // 2. activities only (["coding"]), no threshold: over_match + sub_match; over_mismatch excluded by activity.
        let activity_results = semantic_search_filtered_with_embedding_db_helper(
            &db,
            &query_embedding,
            Some(10),
            None,
            None,
            Some(vec!["coding".to_string()]),
            None,
        )
        .expect("Failed to run parity helper with activities only");
        let activity_ids: Vec<&str> = activity_results
            .iter()
            .map(|r| r.track.video_id.as_str())
            .collect();
        assert_eq!(
            activity_ids,
            vec!["semantic-parity-video-001", "semantic-parity-video-003"],
            "activities=[coding] must exclude the driving-only track; sub_match kept (no threshold)"
        );
        assert!(!activity_ids.contains(&"semantic-parity-video-002"));

        // 3. activities + threshold: only over_match (sub_match excluded by threshold, over_mismatch by activity).
        let combined_results = semantic_search_filtered_with_embedding_db_helper(
            &db,
            &query_embedding,
            Some(10),
            None,
            None,
            Some(vec!["coding".to_string()]),
            Some(0.3),
        )
        .expect("Failed to run parity helper with activities + threshold");
        let combined_ids: Vec<&str> = combined_results
            .iter()
            .map(|r| r.track.video_id.as_str())
            .collect();
        assert_eq!(
            combined_ids,
            vec!["semantic-parity-video-001"],
            "activities + threshold must isolate the single over-threshold coding track"
        );

        // 4. no filters: all three, deterministic descending-similarity ordering.
        let all_results = semantic_search_filtered_with_embedding_db_helper(
            &db,
            &query_embedding,
            Some(10),
            None,
            None,
            None,
            None,
        )
        .expect("Failed to run parity helper without filters");
        let all_ids: Vec<&str> = all_results
            .iter()
            .map(|r| r.track.video_id.as_str())
            .collect();
        assert_eq!(
            all_ids,
            vec![
                "semantic-parity-video-001",
                "semantic-parity-video-002",
                "semantic-parity-video-003"
            ],
            "no filters must keep deterministic descending-similarity ordering"
        );

        drop(db);

        println!(
            "SEMANTIC_FILTERED_PARITY_HARNESS results={} activity={} threshold={} top={}",
            all_results.len(),
            activity_results.len(),
            threshold_results.len(),
            all_results[0].track.video_id,
        );

        std::fs::remove_dir_all(&temp_dir).expect("Failed to remove temp data dir");
    }

    #[test]
    fn test_semantic_filtered_ann_db_parity_excludes_missing_metadata() {
        let _lock = ytm_free_data_dir_test_lock().lock().unwrap();
        let _guard = EnvVarGuard::new("YTM_FREE_DATA_DIR");

        let temp_dir = std::env::temp_dir().join(format!(
            "ytm-free-semantic-filtered-ann-db-parity-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).expect("Failed to create parity temp data dir");
        std::env::set_var("YTM_FREE_DATA_DIR", &temp_dir);

        fn build_ann_from_db(db: &Database) -> ANNIndex {
            let mut ann = ANNIndex::new();
            for embedding in db
                .get_all_embeddings()
                .expect("Failed to load parity embeddings for ANN")
            {
                let track = db
                    .get_track_by_uuid(&embedding.track_id)
                    .expect("Failed to load parity track for ANN");
                let metadata = db.get_track_metadata(&track.id).ok();
                let ann_metadata = semantic::build_metadata(
                    &track,
                    metadata.as_ref().and_then(|value| value.genre.clone()),
                    metadata.as_ref().and_then(|value| value.mood.clone()),
                    metadata
                        .as_ref()
                        .and_then(|value| value.activity_tags.clone()),
                );
                ann.add(track.id.clone(), embedding.embedding, ann_metadata);
            }
            ann
        }

        fn ann_ids(
            ann: &ANNIndex,
            query_embedding: &[f32],
            filter: &SemanticSearchFilter,
        ) -> Vec<String> {
            ann.search_filtered(query_embedding, 10, filter)
                .into_iter()
                .map(|(track_id, _)| track_id)
                .collect()
        }

        fn db_ids(
            db: &Database,
            query_embedding: &[f32],
            filter: &SemanticSearchFilter,
        ) -> Vec<String> {
            semantic_search_filtered_with_embedding_db_helper(
                db,
                query_embedding,
                Some(10),
                filter.genres.clone(),
                filter.moods.clone(),
                filter.activities.clone(),
                filter.min_similarity,
            )
            .expect("Failed to run parity DB fallback")
            .into_iter()
            .map(|result| result.track.id)
            .collect()
        }

        let query_embedding = vec![1.0_f32, 0.0, 0.0];
        let db = Database::new().expect("Failed to create parity temp database");
        let with_metadata = db
            .add_track(
                "semantic-ann-db-parity-video-001",
                "Semantic ANN DB Parity With Metadata",
                "Semantic ANN DB Parity Artist",
                "https://example.invalid/semantic-ann-db-parity-001.jpg",
                None,
            )
            .expect("Failed to add parity track with metadata");
        let without_metadata = db
            .add_track(
                "semantic-ann-db-parity-video-002",
                "Semantic ANN DB Parity Missing Metadata",
                "Semantic ANN DB Parity Artist",
                "https://example.invalid/semantic-ann-db-parity-002.jpg",
                None,
            )
            .expect("Failed to add parity track without metadata");

        let metadata = crate::ollama::TrackMetadataAI {
            genre: "Ambient".to_string(),
            sub_genre: None,
            mood: "Focus".to_string(),
            energy_level: 5,
            tempo: "medium".to_string(),
            danceability: 2,
            vocal_type: "instrumental".to_string(),
            decade: "2020s".to_string(),
            language: "Instrumental".to_string(),
            activity_tags: vec!["coding".to_string()],
            occasion_tags: vec![],
            keywords: vec!["ambient".to_string(), "focus".to_string()],
        };
        db.save_track_metadata(&with_metadata.id, &metadata, "semantic-ann-db-parity-model")
            .expect("Failed to save parity metadata");

        db.save_embedding(
            &with_metadata.id,
            &[1.0, 0.0, 0.0],
            "Semantic ANN DB Parity With Metadata",
            "semantic-ann-db-parity-model",
            3,
        )
        .expect("Failed to save parity embedding with metadata");
        db.save_embedding(
            &without_metadata.id,
            &[0.9, 0.435889894, 0.0],
            "Semantic ANN DB Parity Missing Metadata",
            "semantic-ann-db-parity-model",
            3,
        )
        .expect("Failed to save parity embedding without metadata");

        let filtered = SemanticSearchFilter {
            genres: Some(vec!["Ambient".to_string()]),
            moods: Some(vec!["Focus".to_string()]),
            activities: Some(vec!["coding".to_string()]),
            min_similarity: Some(0.3),
        };
        let unfiltered = SemanticSearchFilter {
            genres: None,
            moods: None,
            activities: None,
            min_similarity: Some(0.3),
        };

        let ann = build_ann_from_db(&db);
        let ann_filtered = ann_ids(&ann, &query_embedding, &filtered);
        let db_filtered = db_ids(&db, &query_embedding, &filtered);
        assert!(
            !db_filtered.contains(&without_metadata.id),
            "DB fallback must exclude a track without metadata when filters are active"
        );
        assert_eq!(ann_filtered, vec![with_metadata.id.clone()]);
        assert_eq!(db_filtered, ann_filtered);

        let ann_unfiltered = ann_ids(&ann, &query_embedding, &unfiltered);
        let db_unfiltered = db_ids(&db, &query_embedding, &unfiltered);
        assert_eq!(
            ann_unfiltered,
            vec![with_metadata.id.clone(), without_metadata.id.clone()]
        );
        assert_eq!(db_unfiltered, ann_unfiltered);

        drop(db);
        let reopened = Database::new().expect("Failed to reopen parity temp database");
        let reopened_ann = build_ann_from_db(&reopened);
        assert_eq!(
            ann_ids(&reopened_ann, &query_embedding, &filtered),
            ann_filtered
        );
        assert_eq!(db_ids(&reopened, &query_embedding, &filtered), ann_filtered);
        assert_eq!(
            ann_ids(&reopened_ann, &query_embedding, &unfiltered),
            ann_unfiltered
        );
        assert_eq!(
            db_ids(&reopened, &query_embedding, &unfiltered),
            ann_unfiltered
        );
        drop(reopened);

        std::fs::remove_dir_all(&temp_dir).expect("Failed to remove parity temp data dir");
    }

    #[test]
    fn test_controlled_semantic_playlist_save_stub_uses_temp_db_results() {
        let _lock = ytm_free_data_dir_test_lock().lock().unwrap();
        let _guard = EnvVarGuard::new("YTM_FREE_DATA_DIR");

        let temp_dir = std::env::temp_dir().join(format!(
            "ytm-free-semantic-playlist-stub-harness-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).expect("Failed to create temp data dir");
        std::env::set_var("YTM_FREE_DATA_DIR", &temp_dir);

        let db = Database::new().expect("Failed to create temp database");

        // Insert synthetic tracks (no embedding, no Ollama, no network).
        let track_alpha = db
            .add_track(
                "semantic-playlist-video-001",
                "Semantic Playlist Song Alpha",
                "Semantic Playlist Artist One",
                "https://i.ytimg.com/vi/semantic-playlist-video-001/mqdefault.jpg",
                None,
            )
            .expect("Failed to add synthetic track Alpha");
        let track_beta = db
            .add_track(
                "semantic-playlist-video-002",
                "Semantic Playlist Song Beta",
                "Semantic Playlist Artist Two",
                "https://i.ytimg.com/vi/semantic-playlist-video-002/mqdefault.jpg",
                None,
            )
            .expect("Failed to add synthetic track Beta");
        let track_gamma = db
            .add_track(
                "semantic-playlist-video-003",
                "Semantic Playlist Song Gamma",
                "Semantic Playlist Artist Three",
                "https://i.ytimg.com/vi/semantic-playlist-video-003/mqdefault.jpg",
                None,
            )
            .expect("Failed to add synthetic track Gamma");

        // Build pre-computed scored semantic results (no embedding, no Ollama).
        // Order mirrors expected playlist order: Alpha (0.91) > Beta (0.78) > Gamma (0.44).
        let scored_results = vec![
            SemanticSearchResult {
                track: track_alpha.clone(),
                similarity: 0.91,
                match_reason: "Semantic match 91%".to_string(),
            },
            SemanticSearchResult {
                track: track_beta.clone(),
                similarity: 0.78,
                match_reason: "Semantic match 78%".to_string(),
            },
            SemanticSearchResult {
                track: track_gamma.clone(),
                similarity: 0.44,
                match_reason: "Semantic match 44%".to_string(),
            },
        ];

        let query = "semantic playlist stub query";
        let result = create_semantic_playlist_from_scored_results_db_helper(
            &db,
            query,
            Some("Semantic Playlist Stub".to_string()),
            scored_results,
        )
        .expect("Failed to create semantic playlist through DB-only helper");

        assert_eq!(result.playlist_name, "Semantic Playlist Stub");
        assert_eq!(result.track_count, 3);
        assert!(
            (result.average_similarity - ((0.91 + 0.78 + 0.44) / 3.0)).abs() < 1e-9,
            "average_similarity should match pre-computed mean"
        );

        // Verify playlist row was created in temp DB.
        let playlist = db
            .get_playlist(&result.playlist_id)
            .expect("Failed to read created playlist from temp DB");
        assert_eq!(playlist.name, "Semantic Playlist Stub");
        assert_eq!(playlist.track_count, 3);

        // Verify track links and ordering (position 1 > 2 > 3).
        let playlist_tracks = db
            .get_playlist_tracks(&result.playlist_id)
            .expect("Failed to read playlist tracks from temp DB");
        assert_eq!(playlist_tracks.len(), 3);
        assert_eq!(playlist_tracks[0].video_id, "semantic-playlist-video-001");
        assert_eq!(playlist_tracks[1].video_id, "semantic-playlist-video-002");
        assert_eq!(playlist_tracks[2].video_id, "semantic-playlist-video-003");

        drop(db);

        // Reopen temp DB on same YTM_FREE_DATA_DIR and verify persistence.
        let db2 = Database::new().expect("Failed to reopen temp database");
        let reopened_playlist = db2
            .get_playlist(&result.playlist_id)
            .expect("Failed to read persisted playlist after reopen");
        assert_eq!(reopened_playlist.name, "Semantic Playlist Stub");
        assert_eq!(reopened_playlist.track_count, 3);
        let reopened_tracks = db2
            .get_playlist_tracks(&result.playlist_id)
            .expect("Failed to read persisted playlist tracks after reopen");
        assert_eq!(reopened_tracks.len(), 3);
        assert_eq!(reopened_tracks[0].video_id, "semantic-playlist-video-001");
        assert_eq!(reopened_tracks[1].video_id, "semantic-playlist-video-002");
        assert_eq!(reopened_tracks[2].video_id, "semantic-playlist-video-003");
        drop(db2);

        println!(
            "SEMANTIC_PLAYLIST_STUB_HARNESS playlist_id={} tracks={} top={} avg={} temp_dir={}",
            result.playlist_id,
            result.track_count,
            "semantic-playlist-video-001",
            result.average_similarity,
            temp_dir.display()
        );

        std::fs::remove_dir_all(&temp_dir).expect("Failed to remove temp data dir");
    }

    #[test]
    fn test_controlled_semantic_playlist_prepare_embedding_input_uses_temp_db_settings() {
        let _lock = ytm_free_data_dir_test_lock().lock().unwrap();
        let _guard = EnvVarGuard::new("YTM_FREE_DATA_DIR");

        let temp_dir = std::env::temp_dir().join(format!(
            "ytm-free-semantic-playlist-lock-scope-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).expect("Failed to create temp data dir");
        std::env::set_var("YTM_FREE_DATA_DIR", &temp_dir);

        let db = Database::new().expect("Failed to create temp database");

        let mut settings = db.get_settings().expect("Failed to read temp settings");
        settings.semantic_search_enabled = true;
        settings.ollama_url = "http://127.0.0.1:11434".to_string();
        settings.embedding_model = "semantic-playlist-lock-scope-model".to_string();
        db.update_settings(&settings)
            .expect("Failed to update temp semantic settings");

        let query = "semantic-playlist-lock-scope-query";
        let playlist_name = Some("semantic-playlist-lock-scope-playlist".to_string());

        let embeddings_before = db
            .count_embeddings()
            .expect("Failed to count embeddings before prepare");
        assert_eq!(embeddings_before, 0);

        let prepared = create_semantic_playlist_prepare_embedding_input_db_helper(
            &db,
            query,
            playlist_name.clone(),
        )
        .expect("Failed to prepare semantic playlist embedding input");

        // Verify prepare returns the expected query, ollama_url, embedding_model,
        // and playlist_name from temp DB settings — no mutation, no playlist.
        assert_eq!(prepared.query, query);
        assert_eq!(prepared.ollama_url, "http://127.0.0.1:11434");
        assert_eq!(
            prepared.embedding_model,
            "semantic-playlist-lock-scope-model"
        );
        assert_eq!(prepared.playlist_name, playlist_name);

        // Verify no embeddings were saved (pre-embedding stage is read-only on embeddings).
        let embeddings_after = db
            .count_embeddings()
            .expect("Failed to count embeddings after prepare");
        assert_eq!(embeddings_after, 0);

        // Verify no playlist was created.
        let playlists = db
            .get_playlists()
            .expect("Failed to read playlists from temp DB");
        assert!(
            playlists.is_empty(),
            "no playlist should be created during prepare"
        );

        drop(db);

        println!(
            "SEMANTIC_PLAYLIST_LOCK_SCOPE_HARNESS query={} playlist={} scored=0 saved=0 temp_dir={}",
            prepared.query,
            prepared.playlist_name.as_deref().unwrap_or("(default)"),
            temp_dir.display()
        );

        std::fs::remove_dir_all(&temp_dir).expect("Failed to remove temp data dir");
    }

    #[test]
    fn test_controlled_semantic_playlist_scored_from_embedding_uses_temp_db_embeddings() {
        let _lock = ytm_free_data_dir_test_lock().lock().unwrap();
        let _guard = EnvVarGuard::new("YTM_FREE_DATA_DIR");

        let temp_dir = std::env::temp_dir().join(format!(
            "ytm-free-semantic-playlist-lock-scope-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).expect("Failed to create temp data dir");
        std::env::set_var("YTM_FREE_DATA_DIR", &temp_dir);

        let db = Database::new().expect("Failed to create temp database");

        let mut settings = db.get_settings().expect("Failed to read temp settings");
        settings.semantic_search_enabled = true;
        settings.ollama_url = "http://127.0.0.1:11434".to_string();
        settings.embedding_model = "semantic-playlist-lock-scope-model".to_string();
        db.update_settings(&settings)
            .expect("Failed to update temp semantic settings");

        // Seed three synthetic tracks.
        let track_alpha = db
            .add_track(
                "semantic-playlist-lock-scope-video-001",
                "Semantic Playlist Lock Scope Song Alpha",
                "Semantic Playlist Lock Scope Artist One",
                "https://i.ytimg.com/vi/semantic-playlist-lock-scope-video-001/mqdefault.jpg",
                None,
            )
            .expect("Failed to add synthetic track Alpha");
        let track_beta = db
            .add_track(
                "semantic-playlist-lock-scope-video-002",
                "Semantic Playlist Lock Scope Song Beta",
                "Semantic Playlist Lock Scope Artist Two",
                "https://i.ytimg.com/vi/semantic-playlist-lock-scope-video-002/mqdefault.jpg",
                None,
            )
            .expect("Failed to add synthetic track Beta");
        let track_gamma = db
            .add_track(
                "semantic-playlist-lock-scope-video-003",
                "Semantic Playlist Lock Scope Song Gamma",
                "Semantic Playlist Lock Scope Artist Three",
                "https://i.ytimg.com/vi/semantic-playlist-lock-scope-video-003/mqdefault.jpg",
                None,
            )
            .expect("Failed to add synthetic track Gamma");

        // Seed synthetic embeddings — query embedding [1.0, 0.0, 0.0] will be
        // most similar to Alpha [1.0, 0.0, 0.0], then Beta [0.8, 0.6, 0.0],
        // and Gamma [0.0, 0.0, 1.0] will be below the 0.3 threshold.
        let embedding_alpha = vec![1.0_f32, 0.0, 0.0];
        let embedding_beta = vec![0.8_f32, 0.6, 0.0];
        let embedding_gamma = vec![0.0_f32, 0.0, 1.0]; // cosine_sim with [1,0,0] = 0.0, below 0.3

        db.save_embedding(
            &track_alpha.id,
            &embedding_alpha,
            "alpha text",
            "test-model",
            3,
        )
        .expect("Failed to save embedding Alpha");
        db.save_embedding(
            &track_beta.id,
            &embedding_beta,
            "beta text",
            "test-model",
            3,
        )
        .expect("Failed to save embedding Beta");
        db.save_embedding(
            &track_gamma.id,
            &embedding_gamma,
            "gamma text",
            "test-model",
            3,
        )
        .expect("Failed to save embedding Gamma");

        let query_embedding = vec![1.0_f32, 0.0, 0.0];

        let scored =
            create_semantic_playlist_scored_from_embedding_db_helper(&db, &query_embedding)
                .expect("Failed to score playlist from precomputed embedding");

        // Gamma is below the 0.3 threshold and should be filtered out.
        // Alpha (cosine_sim=1.0) ranks above Beta (cosine_sim=0.8).
        assert_eq!(
            scored.len(),
            2,
            "Gamma below threshold should be filtered out"
        );
        assert_eq!(
            scored[0].track.video_id,
            "semantic-playlist-lock-scope-video-001"
        );
        assert_eq!(
            scored[1].track.video_id,
            "semantic-playlist-lock-scope-video-002"
        );
        assert!(
            (scored[0].similarity - 1.0).abs() < 1e-6,
            "Alpha similarity should be 1.0"
        );
        assert!(
            (scored[1].similarity - 0.8).abs() < 1e-6,
            "Beta similarity should be 0.8"
        );

        // Now exercise the existing save helper to verify end-to-end scoring+save.
        let query = "semantic-playlist-lock-scope-query";
        let playlist_name = Some("semantic-playlist-lock-scope-playlist".to_string());
        let saved = create_semantic_playlist_from_scored_results_db_helper(
            &db,
            query,
            playlist_name.clone(),
            scored,
        )
        .expect("Failed to create semantic playlist through save helper");

        assert_eq!(saved.playlist_name, "semantic-playlist-lock-scope-playlist");
        assert_eq!(saved.track_count, 2);

        // Verify playlist row and track links in temp DB.
        let playlist = db
            .get_playlist(&saved.playlist_id)
            .expect("Failed to read created playlist from temp DB");
        assert_eq!(playlist.name, "semantic-playlist-lock-scope-playlist");
        assert_eq!(playlist.track_count, 2);

        let playlist_tracks = db
            .get_playlist_tracks(&saved.playlist_id)
            .expect("Failed to read playlist tracks from temp DB");
        assert_eq!(playlist_tracks.len(), 2);
        assert_eq!(
            playlist_tracks[0].video_id,
            "semantic-playlist-lock-scope-video-001"
        );
        assert_eq!(
            playlist_tracks[1].video_id,
            "semantic-playlist-lock-scope-video-002"
        );

        drop(db);

        println!(
            "SEMANTIC_PLAYLIST_LOCK_SCOPE_HARNESS query={} playlist={} scored=2 saved=2 temp_dir={}",
            query,
            playlist_name.as_deref().unwrap_or("(default)"),
            temp_dir.display()
        );

        std::fs::remove_dir_all(&temp_dir).expect("Failed to remove temp data dir");
    }

    #[test]
    fn test_controlled_semantic_index_track_prepare_embedding_input_uses_temp_db_metadata() {
        let _lock = ytm_free_data_dir_test_lock().lock().unwrap();
        let _guard = EnvVarGuard::new("YTM_FREE_DATA_DIR");

        let temp_dir = std::env::temp_dir().join(format!(
            "ytm-free-semantic-index-track-lock-scope-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).expect("Failed to create temp data dir");
        std::env::set_var("YTM_FREE_DATA_DIR", &temp_dir);

        let db = Database::new().expect("Failed to create temp database");

        let mut settings = db.get_settings().expect("Failed to read temp settings");
        settings.semantic_search_enabled = true;
        settings.ollama_url = "http://127.0.0.1:11434".to_string();
        settings.embedding_model = "semantic-index-lock-scope-model".to_string();
        db.update_settings(&settings)
            .expect("Failed to update temp semantic settings");

        let track = db
            .add_track(
                "semantic-index-lock-scope-video-001",
                "Semantic Index Lock Scope Song",
                "Semantic Index Lock Scope Artist",
                "https://i.ytimg.com/vi/semantic-index-lock-scope-video-001/mqdefault.jpg",
                None,
            )
            .expect("Failed to add lock-scope synthetic track");

        let metadata = crate::ollama::TrackMetadataAI {
            genre: "semantic-index-lock-scope-genre-ambient".to_string(),
            sub_genre: Some("synthetic-subgenre".to_string()),
            mood: "semantic-index-lock-scope-mood-calm".to_string(),
            energy_level: 3,
            tempo: "slow".to_string(),
            danceability: 2,
            vocal_type: "synthetic vocals".to_string(),
            decade: "2010s".to_string(),
            language: "English".to_string(),
            activity_tags: vec!["semantic-index-lock-scope-activity-focus".to_string()],
            occasion_tags: vec!["reading".to_string()],
            keywords: vec![
                "lock".to_string(),
                "scope".to_string(),
                "prepare".to_string(),
            ],
        };
        db.save_track_metadata(
            &track.id,
            &metadata,
            "semantic-index-lock-scope-metadata-model",
        )
        .expect("Failed to save lock-scope synthetic metadata");

        let embeddings_before = db
            .count_embeddings()
            .expect("Failed to count embeddings before prepare");
        assert_eq!(embeddings_before, 0);

        let prepared = semantic_index_track_prepare_embedding_input_db_helper(&db, &track.id)
            .expect("Failed to prepare semantic index track embedding input");

        assert_eq!(prepared.track_id, track.id);
        assert_eq!(prepared.video_id, "semantic-index-lock-scope-video-001");
        assert_eq!(prepared.ollama_url, "http://127.0.0.1:11434");
        assert_eq!(prepared.embedding_model, "semantic-index-lock-scope-model");
        assert!(prepared
            .embedding_text
            .contains("Semantic Index Lock Scope Song"));
        assert!(prepared
            .embedding_text
            .contains("Semantic Index Lock Scope Artist"));
        assert!(prepared
            .embedding_text
            .contains("semantic-index-lock-scope-genre-ambient"));
        assert!(prepared
            .embedding_text
            .contains("semantic-index-lock-scope-mood-calm"));
        assert!(prepared.embedding_text.contains("Activities:"));
        assert!(prepared
            .embedding_text
            .contains("semantic-index-lock-scope-activity-focus"));
        assert!(prepared.embedding_text.contains("Keywords:"));
        assert!(prepared.embedding_text.contains("lock"));
        assert!(prepared.embedding_text.contains("Tempo: slow"));
        assert!(prepared.embedding_text.contains("Decade: 2010s"));
        assert_eq!(
            db.count_embeddings()
                .expect("Failed to count embeddings after prepare"),
            0
        );

        let embedding = vec![1.0_f32, 0.0, 0.0];
        let saved = semantic_index_track_with_embedding_db_helper(
            &db,
            &prepared.track_id,
            &embedding,
            &prepared.embedding_model,
        )
        .expect("Failed to save prepared semantic index embedding");
        let embeddings_after = db
            .count_embeddings()
            .expect("Failed to count embeddings after save");
        assert_eq!(embeddings_after, 1);
        assert_eq!(saved.track_id, track.id);
        assert_eq!(saved.model_used, "semantic-index-lock-scope-model");

        println!(
            "SEMANTIC_INDEX_TRACK_LOCK_SCOPE_HARNESS video={} text_len={} embeddings_before={} embeddings_after={}",
            prepared.video_id,
            prepared.embedding_text.len(),
            embeddings_before,
            embeddings_after
        );

        drop(db);
        std::fs::remove_dir_all(&temp_dir).expect("Failed to remove temp data dir");
    }

    #[test]
    fn test_controlled_semantic_index_track_stub_saves_temp_db_embedding() {
        let _lock = ytm_free_data_dir_test_lock().lock().unwrap();
        let _guard = EnvVarGuard::new("YTM_FREE_DATA_DIR");

        let temp_dir = std::env::temp_dir().join(format!(
            "ytm-free-semantic-index-track-stub-harness-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).expect("Failed to create temp data dir");
        std::env::set_var("YTM_FREE_DATA_DIR", &temp_dir);

        let db = Database::new().expect("Failed to create temp database");
        let track = db
            .add_track(
                "semantic-index-video-001",
                "Semantic Index Song One",
                "Semantic Index Artist One",
                "https://i.ytimg.com/vi/semantic-index-video-001/mqdefault.jpg",
                None,
            )
            .expect("Failed to add semantic index synthetic track");

        let metadata = crate::ollama::TrackMetadataAI {
            genre: "semantic-index-genre-rock".to_string(),
            sub_genre: None,
            mood: "semantic-index-mood-focused".to_string(),
            energy_level: 7,
            tempo: "medium".to_string(),
            danceability: 5,
            vocal_type: "synthetic vocals".to_string(),
            decade: "2020s".to_string(),
            language: "English".to_string(),
            activity_tags: vec!["semantic-index-activity-coding".to_string()],
            occasion_tags: vec![],
            keywords: vec![
                "semantic".to_string(),
                "index".to_string(),
                "stub".to_string(),
                "harness".to_string(),
            ],
        };
        db.save_track_metadata(&track.id, &metadata, "semantic-index-stub-metadata-model")
            .expect("Failed to save semantic index synthetic metadata");

        let embedding = vec![1.0_f32, 0.0, 0.0];
        let saved = semantic_index_track_with_embedding_db_helper(
            &db,
            &track.id,
            &embedding,
            "semantic-index-stub-model",
        )
        .expect("Failed to save semantic index embedding through DB-only helper");

        assert_eq!(saved.track_id, track.id);
        assert_eq!(saved.embedding, embedding);
        assert_eq!(saved.dimensions, 3);
        assert_eq!(saved.model_used, "semantic-index-stub-model");
        assert!(saved.text_used.contains("Semantic Index Song One"));
        assert!(saved.text_used.contains("Semantic Index Artist One"));
        assert!(saved.text_used.contains("semantic-index-genre-rock"));
        assert!(saved.text_used.contains("semantic-index-mood-focused"));
        assert!(saved.text_used.contains("semantic-index-activity-coding"));
        assert!(saved.text_used.contains("semantic"));
        assert_eq!(
            db.count_embeddings().expect("Failed to count embeddings"),
            1
        );

        drop(db);

        let db2 = Database::new().expect("Failed to reopen temp database");
        let reopened = db2
            .get_embedding(&track.id)
            .expect("Failed to read reopened embedding")
            .expect("Expected persisted embedding after reopen");
        assert_eq!(reopened.track_id, track.id);
        assert_eq!(reopened.embedding, vec![1.0_f32, 0.0, 0.0]);
        assert_eq!(reopened.dimensions, 3);
        assert_eq!(reopened.model_used, "semantic-index-stub-model");
        assert!(reopened.text_used.contains("Semantic Index Song One"));
        assert!(reopened.text_used.contains("Semantic Index Artist One"));
        assert!(reopened.text_used.contains("semantic-index-genre-rock"));
        assert!(reopened.text_used.contains("semantic-index-mood-focused"));
        assert!(reopened
            .text_used
            .contains("semantic-index-activity-coding"));
        let reopened_count = db2
            .count_embeddings()
            .expect("Failed to count reopened embeddings");
        assert_eq!(reopened_count, 1);
        drop(db2);

        println!(
            "SEMANTIC_INDEX_TRACK_STUB_HARNESS video=semantic-index-video-001 dimensions={} embeddings={} temp_dir={}",
            reopened.dimensions,
            reopened_count,
            temp_dir.display()
        );

        std::fs::remove_dir_all(&temp_dir).expect("Failed to remove temp data dir");
    }

    #[test]
    fn test_controlled_semantic_index_all_prepare_batch_uses_temp_db_metadata() {
        let _lock = ytm_free_data_dir_test_lock().lock().unwrap();
        let _guard = EnvVarGuard::new("YTM_FREE_DATA_DIR");

        let temp_dir = std::env::temp_dir().join(format!(
            "ytm-free-semantic-index-all-lock-scope-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).expect("Failed to create temp data dir");
        std::env::set_var("YTM_FREE_DATA_DIR", &temp_dir);

        let db = Database::new().expect("Failed to create temp database");

        let mut settings = db.get_settings().expect("Failed to read temp settings");
        settings.semantic_search_enabled = true;
        settings.ollama_url = "http://semantic-index-all-lock-scope.invalid:11434".to_string();
        settings.embedding_model = "semantic-index-all-lock-scope-model".to_string();
        db.update_settings(&settings)
            .expect("Failed to update temp semantic settings");

        let track_one = db
            .add_track(
                "semantic-index-all-lock-scope-video-001",
                "Semantic Index All Lock Scope Song One",
                "Semantic Index All Lock Scope Artist One",
                "https://i.ytimg.com/vi/semantic-index-all-lock-scope-video-001/mqdefault.jpg",
                None,
            )
            .expect("Failed to add synthetic track one");
        let track_two = db
            .add_track(
                "semantic-index-all-lock-scope-video-002",
                "Semantic Index All Lock Scope Song Two",
                "Semantic Index All Lock Scope Artist Two",
                "https://i.ytimg.com/vi/semantic-index-all-lock-scope-video-002/mqdefault.jpg",
                None,
            )
            .expect("Failed to add synthetic track two");
        let track_three = db
            .add_track(
                "semantic-index-all-lock-scope-video-003",
                "Semantic Index All Lock Scope Song Three",
                "Semantic Index All Lock Scope Artist Three",
                "https://i.ytimg.com/vi/semantic-index-all-lock-scope-video-003/mqdefault.jpg",
                None,
            )
            .expect("Failed to add synthetic track three");

        let metadata_one = crate::ollama::TrackMetadataAI {
            genre: "semantic-index-all-lock-scope-genre-ambient".to_string(),
            sub_genre: Some("synthetic-subgenre-one".to_string()),
            mood: "semantic-index-all-lock-scope-mood-calm".to_string(),
            energy_level: 3,
            tempo: "slow".to_string(),
            danceability: 2,
            vocal_type: "synthetic vocals".to_string(),
            decade: "2010s".to_string(),
            language: "English".to_string(),
            activity_tags: vec!["semantic-index-all-lock-scope-activity-focus".to_string()],
            occasion_tags: vec![],
            keywords: vec!["batch".to_string(), "prepare".to_string()],
        };
        db.save_track_metadata(
            &track_one.id,
            &metadata_one,
            "semantic-index-all-lock-scope-metadata-model",
        )
        .expect("Failed to save synthetic metadata for track one");

        let metadata_two = crate::ollama::TrackMetadataAI {
            genre: "semantic-index-all-lock-scope-genre-rock".to_string(),
            sub_genre: Some("synthetic-subgenre-two".to_string()),
            mood: "semantic-index-all-lock-scope-mood-energetic".to_string(),
            energy_level: 8,
            tempo: "fast".to_string(),
            danceability: 8,
            vocal_type: "mixed vocals".to_string(),
            decade: "2020s".to_string(),
            language: "English".to_string(),
            activity_tags: vec!["semantic-index-all-lock-scope-activity-running".to_string()],
            occasion_tags: vec![],
            keywords: vec!["batch".to_string(), "secondary".to_string()],
        };
        db.save_track_metadata(
            &track_two.id,
            &metadata_two,
            "semantic-index-all-lock-scope-metadata-model",
        )
        .expect("Failed to save synthetic metadata for track two");

        let embeddings_before = db
            .count_embeddings()
            .expect("Failed to count embeddings before prepare batch");
        assert_eq!(embeddings_before, 0);

        let prepared = semantic_index_all_prepare_batch_db_helper(&db)
            .expect("Failed to prepare semantic index-all batch");

        assert_eq!(
            prepared.ollama_url,
            "http://semantic-index-all-lock-scope.invalid:11434"
        );
        assert_eq!(
            prepared.embedding_model,
            "semantic-index-all-lock-scope-model"
        );
        assert_eq!(prepared.tracks.len(), 3);

        let prepared_one = prepared
            .tracks
            .iter()
            .find(|item| item.track.id == track_one.id)
            .expect("Prepared batch missing track one");
        assert_eq!(
            prepared_one.track.video_id,
            "semantic-index-all-lock-scope-video-001"
        );
        assert!(prepared_one
            .embedding_text
            .contains("Semantic Index All Lock Scope Song One"));
        assert!(prepared_one
            .embedding_text
            .contains("Semantic Index All Lock Scope Artist One"));
        assert!(prepared_one
            .embedding_text
            .contains("semantic-index-all-lock-scope-genre-ambient"));
        assert!(prepared_one
            .embedding_text
            .contains("semantic-index-all-lock-scope-mood-calm"));
        assert!(prepared_one.embedding_text.contains("Activities:"));
        assert!(prepared_one
            .embedding_text
            .contains("semantic-index-all-lock-scope-activity-focus"));
        assert!(prepared_one.embedding_text.contains("Keywords:"));
        assert!(prepared_one.embedding_text.contains("batch"));
        assert!(prepared_one.embedding_text.contains("Tempo: slow"));
        assert!(prepared_one.embedding_text.contains("Decade: 2010s"));
        assert_eq!(
            prepared_one.genre.as_deref(),
            Some("semantic-index-all-lock-scope-genre-ambient")
        );
        assert_eq!(
            prepared_one.mood.as_deref(),
            Some("semantic-index-all-lock-scope-mood-calm")
        );
        assert_eq!(
            prepared_one.activity_tags.as_deref(),
            Some("[\"semantic-index-all-lock-scope-activity-focus\"]")
        );

        let prepared_three = prepared
            .tracks
            .iter()
            .find(|item| item.track.id == track_three.id)
            .expect("Prepared batch missing track three");
        assert_eq!(
            prepared_three.embedding_text,
            "Semantic Index All Lock Scope Song Three by Semantic Index All Lock Scope Artist Three"
        );
        assert!(prepared_three.genre.is_none());
        assert!(prepared_three.mood.is_none());
        assert!(prepared_three.activity_tags.is_none());

        let embeddings_after = db
            .count_embeddings()
            .expect("Failed to count embeddings after prepare batch");
        assert_eq!(embeddings_after, 0);

        println!(
            "SEMANTIC_INDEX_ALL_LOCK_SCOPE_HARNESS tracks={} embeddings_before={} embeddings_after={} temp_dir={}",
            prepared.tracks.len(),
            embeddings_before,
            embeddings_after,
            temp_dir.display()
        );

        drop(db);
        std::fs::remove_dir_all(&temp_dir).expect("Failed to remove temp data dir");
    }

    #[test]
    fn test_controlled_semantic_index_all_save_batch_uses_temp_db_embeddings() {
        let _lock = ytm_free_data_dir_test_lock().lock().unwrap();
        let _guard = EnvVarGuard::new("YTM_FREE_DATA_DIR");

        let temp_dir = std::env::temp_dir().join(format!(
            "ytm-free-semantic-index-all-stub-harness-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).expect("Failed to create temp data dir");
        std::env::set_var("YTM_FREE_DATA_DIR", &temp_dir);

        let db = Database::new().expect("Failed to create temp database");

        let mut settings = db.get_settings().expect("Failed to read temp settings");
        settings.semantic_search_enabled = true;
        settings.ollama_url = "http://semantic-index-all-save-batch.invalid:11434".to_string();
        settings.embedding_model = "semantic-index-all-save-batch-model".to_string();
        db.update_settings(&settings)
            .expect("Failed to update temp semantic settings");

        let track_one = db
            .add_track(
                "semantic-index-all-stub-video-001",
                "Semantic Index All Stub Song One",
                "Semantic Index All Stub Artist One",
                "https://i.ytimg.com/vi/semantic-index-all-stub-video-001/mqdefault.jpg",
                None,
            )
            .expect("Failed to add synthetic save-batch track one");
        let track_two = db
            .add_track(
                "semantic-index-all-stub-video-002",
                "Semantic Index All Stub Song Two",
                "Semantic Index All Stub Artist Two",
                "https://i.ytimg.com/vi/semantic-index-all-stub-video-002/mqdefault.jpg",
                None,
            )
            .expect("Failed to add synthetic save-batch track two");

        let metadata_one = crate::ollama::TrackMetadataAI {
            genre: "semantic-index-all-stub-genre-one".to_string(),
            sub_genre: None,
            mood: "semantic-index-all-stub-mood-one".to_string(),
            energy_level: 5,
            tempo: "medium".to_string(),
            danceability: 5,
            vocal_type: "synthetic vocals".to_string(),
            decade: "2020s".to_string(),
            language: "English".to_string(),
            activity_tags: vec!["semantic-index-all-stub-activity-one".to_string()],
            occasion_tags: vec![],
            keywords: vec!["save".to_string(), "batch".to_string()],
        };
        let metadata_two = crate::ollama::TrackMetadataAI {
            genre: "semantic-index-all-stub-genre-two".to_string(),
            sub_genre: None,
            mood: "semantic-index-all-stub-mood-two".to_string(),
            energy_level: 6,
            tempo: "fast".to_string(),
            danceability: 6,
            vocal_type: "mixed vocals".to_string(),
            decade: "2010s".to_string(),
            language: "English".to_string(),
            activity_tags: vec!["semantic-index-all-stub-activity-two".to_string()],
            occasion_tags: vec![],
            keywords: vec!["save".to_string(), "secondary".to_string()],
        };
        db.save_track_metadata(
            &track_one.id,
            &metadata_one,
            "semantic-index-all-save-batch-model",
        )
        .expect("Failed to save metadata for save-batch track one");
        db.save_track_metadata(
            &track_two.id,
            &metadata_two,
            "semantic-index-all-save-batch-model",
        )
        .expect("Failed to save metadata for save-batch track two");

        let prepared = semantic_index_all_prepare_batch_db_helper(&db)
            .expect("Failed to prepare semantic index-all save batch");
        let embeddings_before = db
            .count_embeddings()
            .expect("Failed to count embeddings before save batch");
        assert_eq!(embeddings_before, 0);

        for prepared_track in &prepared.tracks {
            let embedding = if prepared_track.track.id == track_one.id {
                vec![1.0_f32, 0.0, 0.0]
            } else {
                vec![0.0_f32, 1.0, 0.0]
            };

            let saved = semantic_index_all_save_embedding_db_helper(
                &db,
                &prepared_track.track.id,
                &embedding,
                &prepared_track.embedding_text,
                &prepared.embedding_model,
            )
            .expect("Failed to save semantic index-all embedding through DB-only helper");

            assert_eq!(saved.track_id, prepared_track.track.id);
            assert_eq!(saved.embedding, embedding);
            assert_eq!(saved.dimensions, 3);
            assert_eq!(saved.model_used, prepared.embedding_model);
            assert_eq!(saved.text_used, prepared_track.embedding_text);
        }

        let embeddings_after = db
            .count_embeddings()
            .expect("Failed to count embeddings after save batch");
        assert_eq!(embeddings_after, 2);

        drop(db);

        let db2 = Database::new().expect("Failed to reopen temp database");
        assert_eq!(
            db2.count_embeddings()
                .expect("Failed to count reopened embeddings after save batch"),
            2
        );
        for track_id in [&track_one.id, &track_two.id] {
            let reopened = db2
                .get_embedding(track_id)
                .expect("Failed to read reopened save-batch embedding")
                .expect("Expected persisted save-batch embedding after reopen");
            assert_eq!(reopened.track_id, *track_id);
            assert_eq!(reopened.model_used, "semantic-index-all-save-batch-model");
            assert_eq!(reopened.dimensions, 3);
            assert!(reopened.text_used.contains("Semantic Index All Stub Song"));
        }
        drop(db2);

        println!(
            "SEMANTIC_INDEX_ALL_LOCK_SCOPE_HARNESS tracks={} embeddings_before={} embeddings_after={} temp_dir={}",
            prepared.tracks.len(),
            embeddings_before,
            embeddings_after,
            temp_dir.display()
        );

        std::fs::remove_dir_all(&temp_dir).expect("Failed to remove temp data dir");
    }

    #[test]
    fn test_controlled_smart_playlist_match_library_filters_temp_db_metadata() {
        fn sorted_match_ids(results: &[SmartPlaylistTrackMatch]) -> Vec<String> {
            let mut ids = results
                .iter()
                .map(|result| result.track.video_id.clone())
                .collect::<Vec<_>>();
            ids.sort();
            ids
        }

        fn contains_id(results: &[SmartPlaylistTrackMatch], video_id: &str) -> bool {
            results
                .iter()
                .any(|result| result.track.video_id == video_id)
        }

        let _lock = ytm_free_data_dir_test_lock().lock().unwrap();
        let _guard = EnvVarGuard::new("YTM_FREE_DATA_DIR");

        let temp_dir = std::env::temp_dir().join(format!(
            "ytm-free-smart-playlist-match-library-harness-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_dir).expect("Failed to create temp data dir");
        std::env::set_var("YTM_FREE_DATA_DIR", &temp_dir);

        let db = Database::new().expect("Failed to create temp database");
        let tracks = vec![
            (
                "smart-playlist-video-001",
                "Smart Playlist Rock Focus Coding",
                "rock",
                "focus",
                8,
                "2020s",
                vec!["coding", "work"],
            ),
            (
                "smart-playlist-video-002",
                "Smart Playlist Rock Calm Driving",
                "rock",
                "calm",
                5,
                "2010s",
                vec!["driving"],
            ),
            (
                "smart-playlist-video-003",
                "Smart Playlist Jazz Focus Study",
                "jazz",
                "focus",
                3,
                "2000s",
                vec!["study"],
            ),
            (
                "smart-playlist-video-004",
                "Smart Playlist Pop Party Workout",
                "pop",
                "party",
                9,
                "2020s",
                vec!["workout"],
            ),
            (
                "smart-playlist-video-005",
                "Smart Playlist Classical Sleep No Match",
                "classical",
                "sleep",
                2,
                "1990s",
                vec!["sleep"],
            ),
        ];

        for (video_id, title, genre, mood, energy, decade, activities) in tracks {
            let track = db
                .add_track(
                    video_id,
                    title,
                    "Smart Playlist Harness Artist",
                    &format!("https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"),
                    None,
                )
                .expect("Failed to add smart playlist synthetic track");
            let metadata = crate::ollama::TrackMetadataAI {
                genre: genre.to_string(),
                sub_genre: None,
                mood: mood.to_string(),
                energy_level: energy,
                tempo: "medium".to_string(),
                danceability: 5,
                vocal_type: "synthetic vocals".to_string(),
                decade: decade.to_string(),
                language: "English".to_string(),
                activity_tags: activities.into_iter().map(str::to_string).collect(),
                occasion_tags: vec![],
                keywords: vec!["smart".to_string(), "playlist".to_string()],
            };
            db.save_track_metadata(&track.id, &metadata, "smart-playlist-match-stub-model")
                .expect("Failed to save smart playlist synthetic metadata");
        }

        let empty: Vec<String> = Vec::new();
        let rock_filter = vec!["rock".to_string()];
        let focus_filter = vec!["focus".to_string()];
        let coding_filter = vec!["coding".to_string()];
        let decade_2020s = vec!["2020s".to_string()];

        let all_matches = smart_playlist_match_library_db_helper(
            &db, &empty, &empty, 1, 10, &empty, &empty, None,
        )
        .expect("Failed to run no-filter smart playlist helper");
        assert_eq!(all_matches.len(), 5);

        let rock_matches = smart_playlist_match_library_db_helper(
            &db,
            &rock_filter,
            &empty,
            1,
            10,
            &empty,
            &empty,
            None,
        )
        .expect("Failed to run rock smart playlist helper");
        assert_eq!(
            sorted_match_ids(&rock_matches),
            vec![
                "smart-playlist-video-001".to_string(),
                "smart-playlist-video-002".to_string(),
            ]
        );
        assert!(rock_matches
            .iter()
            .all(|result| (result.score - 1.0).abs() < f64::EPSILON));

        let focus_matches = smart_playlist_match_library_db_helper(
            &db,
            &empty,
            &focus_filter,
            1,
            10,
            &empty,
            &empty,
            None,
        )
        .expect("Failed to run focus smart playlist helper");
        assert_eq!(
            sorted_match_ids(&focus_matches),
            vec![
                "smart-playlist-video-001".to_string(),
                "smart-playlist-video-003".to_string(),
            ]
        );

        let coding_matches = smart_playlist_match_library_db_helper(
            &db,
            &empty,
            &empty,
            1,
            10,
            &empty,
            &coding_filter,
            None,
        )
        .expect("Failed to run coding smart playlist helper");
        assert_eq!(
            sorted_match_ids(&coding_matches),
            vec!["smart-playlist-video-001".to_string()]
        );

        let energy_matches = smart_playlist_match_library_db_helper(
            &db, &empty, &empty, 7, 10, &empty, &empty, None,
        )
        .expect("Failed to run energy smart playlist helper");
        assert_eq!(
            sorted_match_ids(&energy_matches),
            vec![
                "smart-playlist-video-001".to_string(),
                "smart-playlist-video-004".to_string(),
            ]
        );

        let decade_matches = smart_playlist_match_library_db_helper(
            &db,
            &empty,
            &empty,
            1,
            10,
            &decade_2020s,
            &empty,
            None,
        )
        .expect("Failed to run decade smart playlist helper");
        assert_eq!(
            sorted_match_ids(&decade_matches),
            vec![
                "smart-playlist-video-001".to_string(),
                "smart-playlist-video-004".to_string(),
            ]
        );

        let combined_matches = smart_playlist_match_library_db_helper(
            &db,
            &rock_filter,
            &focus_filter,
            7,
            10,
            &decade_2020s,
            &coding_filter,
            None,
        )
        .expect("Failed to run combined smart playlist helper");
        assert_eq!(
            combined_matches
                .first()
                .expect("Expected combined result")
                .track
                .video_id,
            "smart-playlist-video-001"
        );
        assert!((combined_matches[0].score - 1.0).abs() < f64::EPSILON);
        assert!(combined_matches.len() < all_matches.len());
        assert!(!contains_id(&combined_matches, "smart-playlist-video-005"));

        let limit_matches = smart_playlist_match_library_db_helper(
            &db,
            &rock_filter,
            &focus_filter,
            1,
            10,
            &empty,
            &empty,
            Some(1),
        )
        .expect("Failed to run limited smart playlist helper");
        assert_eq!(limit_matches.len(), 1);
        assert_eq!(limit_matches[0].track.video_id, "smart-playlist-video-001");

        let no_match = smart_playlist_match_library_db_helper(
            &db,
            &["metal".to_string()],
            &["angry".to_string()],
            1,
            10,
            &empty,
            &empty,
            None,
        )
        .expect("Failed to run no-match smart playlist helper");
        assert!(no_match.is_empty());

        drop(db);

        let db2 = Database::new().expect("Failed to reopen temp database");
        let reopened_rock = smart_playlist_match_library_db_helper(
            &db2,
            &rock_filter,
            &empty,
            1,
            10,
            &empty,
            &empty,
            None,
        )
        .expect("Failed to run reopened rock smart playlist helper");
        assert_eq!(
            sorted_match_ids(&reopened_rock),
            sorted_match_ids(&rock_matches)
        );
        drop(db2);

        println!(
            "SMART_PLAYLIST_MATCH_LIBRARY_HARNESS results={} top={} rock={} focus={} combined={} temp_dir={}",
            all_matches.len(),
            combined_matches[0].track.video_id,
            rock_matches.len(),
            focus_matches.len(),
            combined_matches.len(),
            temp_dir.display()
        );

        std::fs::remove_dir_all(&temp_dir).expect("Failed to remove temp data dir");
    }
}
