mod db;
mod models;
mod ollama;
mod server;
mod semantic;
mod spotify_import;
mod ytdlp;

use db::Database;
use models::*;
use ollama::OllamaClient;
use semantic::{ANNIndex, SharedANNIndex};
use server::StreamServer;
use std::sync::Arc;
use chrono::{Timelike, Datelike};
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
async fn search_youtube(query: String, max_results: Option<i64>) -> Result<Vec<SearchResult>, String> {
    let count = max_results.unwrap_or(25);
    ytdlp::search(&query, count).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_track_info(video_id: String) -> Result<TrackInfo, String> {
    ytdlp::get_info(&video_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_stream_url(
    state: State<'_, AppState>,
    video_id: String,
) -> Result<String, String> {
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
        Ok(if version.is_empty() { "edge-tts installed".to_string() } else { version })
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
            "--voice", &voice,
            "--text", &text,
            "--rate", &rate_str,
            "--pitch", &pitch_str,
            "--write-media", &temp_path_str,
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
    let download_path = ytdlp::download(&video_id).await.map_err(|e| e.to_string())?;
    
    // Save to database
    let db = state.db.lock().await;
    let track = db.add_track(&video_id, &title, &artist, &thumbnail, Some(&download_path))
        .map_err(|e| e.to_string())?;
    
    Ok(track)
}

// ============================================================================
// PLAYLIST COMMANDS
// ============================================================================

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
    db.create_playlist(&name, description.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_playlist(state: State<'_, AppState>, playlist_id: String) -> Result<(), String> {
    let db = state.db.lock().await;
    db.delete_playlist(&playlist_id).map_err(|e| e.to_string())
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
    
    // First ensure track exists
    let track = db.add_track(&video_id, &title, &artist, &thumbnail, None)
        .map_err(|e| e.to_string())?;
    
    // Update duration if provided
    if let Some(dur) = duration {
        let _ = db.update_track_duration(&video_id, dur);
    }
    
    // Add to playlist
    db.add_track_to_playlist(&playlist_id, &track.id)
        .map_err(|e| e.to_string())?;
    
    Ok(track)
}

#[tauri::command]
async fn remove_from_playlist(
    state: State<'_, AppState>,
    playlist_id: String,
    track_id: String,
) -> Result<(), String> {
    let db = state.db.lock().await;
    db.remove_track_from_playlist(&playlist_id, &track_id)
        .map_err(|e| e.to_string())
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
async fn update_play_count(
    state: State<'_, AppState>,
    video_id: String,
) -> Result<(), String> {
    let db = state.db.lock().await;
    db.update_play_count(&video_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn toggle_favorite(
    state: State<'_, AppState>,
    video_id: String,
) -> Result<bool, String> {
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
async fn search_track_on_youtube(track: spotify_import::SpotifyTrack) -> Result<spotify_import::ImportResult, String> {
    Ok(spotify_import::search_youtube_for_track(&track).await)
}

#[tauri::command]
async fn import_spotify_csv_file(file_path: String) -> Result<Vec<spotify_import::ImportResult>, String> {
    spotify_import::import_from_csv(&file_path).await.map_err(|e| e.to_string())
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
async fn get_ollama_client(
    state: &State<'_, AppState>,
) -> Result<(String, String), String> {
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
    let client = ollama::OllamaClient::with_config(
        &ollama_url,
        &model.unwrap_or(ollama_model),
    );

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
    let client = ollama::OllamaClient::with_config(
        &ollama_url,
        &model.unwrap_or(ollama_model),
    );

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
    let client = ollama::OllamaClient::with_config(
        &ollama_url,
        &model.unwrap_or(ollama_model),
    );

    let available_views = vec![
        "home", "search", "library", "playlists", "favorites",
        "downloads", "settings", "import", "smart-playlist", "smart-queue",
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
    let client = ollama::OllamaClient::with_config(
        &ollama_url,
        &model.unwrap_or(ollama_model),
    );

    let prompt = ollama::Prompts::generate_playlist(&description, duration_minutes, &existing_artists);
    
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
    let client = ollama::OllamaClient::with_config(
        &ollama_url,
        &model.unwrap_or(ollama_model),
    );

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
    let client = ollama::OllamaClient::with_config(
        &ollama_url,
        &model.unwrap_or(ollama_model),
    );

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
    let client = ollama::OllamaClient::with_config(
        &ollama_url,
        &model.unwrap_or(ollama_model),
    );

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
    let client = ollama::OllamaClient::with_config(
        &ollama_url,
        &model.unwrap_or(ollama_model),
    );

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
    let client = ollama::OllamaClient::with_config(
        &ollama_url,
        &model.unwrap_or(ollama_model),
    );

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
    let client = ollama::OllamaClient::with_config(
        &ollama_url,
        &model.unwrap_or(ollama_model),
    );

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
    let client = ollama::OllamaClient::with_config(
        &ollama_url,
        &model.unwrap_or(ollama_model),
    );

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
    let client = ollama::OllamaClient::with_config(
        &ollama_url,
        &model.unwrap_or(ollama_model),
    );

    let prompt = ollama::Prompts::contextual_suggestions(&recent_tracks, &time_of_day, &day_of_week);
    
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
    let client = ollama::OllamaClient::with_config(
        &ollama_url,
        &model.unwrap_or(ollama_model),
    );

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
    let client = ollama::OllamaClient::with_config(
        &ollama_url,
        &model.unwrap_or(ollama_model),
    );

    let prompt = ollama::Prompts::resolve_vague_query(&vague_query, &context_tracks);
    
    client
        .generate_json(&prompt)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================ // Ollama Auto-Tagging (FAZA 2)
// ============================================================================

#[tauri::command]
async fn ollama_get_track_metadata(
    state: State<'_, AppState>,
    track_id: String,
) -> Result<Option<TrackMetadataDB>, String> {
    let db = state.db.lock().await;
    
    // Try to get cached metadata
    match db.get_track_metadata(&track_id) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
async fn ollama_get_untagged_count(
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let db = state.db.lock().await;
    
    db.get_unanalyzed_tracks()
        .map(|tracks| tracks.len())
        .map_err(|e| e.to_string())
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
    
    let client = ollama::OllamaClient::with_config(
        &ollama_url,
        &model_to_use,
    );

    let total = track_ids.len();
    let mut analyzed = Vec::new();
    let mut errors = Vec::new();

    // Get tracks info (supports both UUID id and video_id)
    let db_lock = state.db.lock().await;
    let tracks: Vec<(String, String, String)> = track_ids.iter()
        .filter_map(|id| {
            // Try video_id first, then fall back to UUID lookup
            db_lock.get_track_by_video_id(id)
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
            let _ = app_handle.emit("ai-tagging-progress", serde_json::json!({
                "current": idx + 1,
                "total": total,
                "progress": progress,
                "track_id": id,
                "title": title,
            }));

            // Analyze track
            let prompt = ollama::Prompts::analyze_track(&title, &artist);

            match client.generate_json_with_temp::<ollama::TrackMetadataAI>(&prompt, 0.2).await {
                Ok(metadata) => {
                    // Save to DB
                    let db = db.lock().await;
                    if let Err(e) = db.save_track_metadata(&id, &metadata, &model_to_use_clone) {
                        Some(Err(format!("{}: {}", title, e)))
                    } else {
                        Some(Ok(id))
                    }
                },
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
    let _ = app.emit("ai-tagging-complete", serde_json::json!({
        "analyzed": analyzed.len(),
        "errors": errors.len(),
        "error_messages": errors,
    }));

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
    let client = ollama::OllamaClient::with_config(
        &ollama_url,
        &model.unwrap_or(ollama_model),
    );

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
    let all = db.get_all_tracks_with_metadata().map_err(|e| e.to_string())?;
    drop(db);

    let max_tracks = limit.unwrap_or(50) as usize;

    // Score and filter tracks
    let mut matches: Vec<SmartPlaylistTrackMatch> = all
        .into_iter()
        .filter_map(|(track, meta)| {
            let mut score = 0.0_f64;
            let mut criteria_count = 0.0;

            // Genre match
            if !genres.is_empty() {
                criteria_count += 1.0;
                if let Some(ref g) = meta.genre {
                    if genres.iter().any(|cg| cg.eq_ignore_ascii_case(g)) {
                        score += 1.0;
                    }
                }
            }

            // Mood match
            if !moods.is_empty() {
                criteria_count += 1.0;
                if let Some(ref m) = meta.mood {
                    if moods.iter().any(|cm| cm.eq_ignore_ascii_case(m)) {
                        score += 1.0;
                    }
                }
            }

            // Energy match
            if energy_min > 1 || energy_max < 10 {
                criteria_count += 1.0;
                if let Some(e) = meta.energy_level {
                    if e >= energy_min && e <= energy_max {
                        score += 1.0;
                    }
                }
            }

            // Decade match
            if !decades.is_empty() {
                criteria_count += 1.0;
                if let Some(ref d) = meta.decade {
                    if decades.iter().any(|cd| cd.eq_ignore_ascii_case(d)) {
                        score += 1.0;
                    }
                }
            }

            // Activity match
            if !activities.is_empty() {
                criteria_count += 1.0;
                if let Some(ref tags) = meta.activity_tags {
                    let lower = tags.to_lowercase();
                    if activities.iter().any(|a| lower.contains(&a.to_lowercase())) {
                        score += 1.0;
                    }
                }
            }

            // Normalize score
            let normalized = if criteria_count > 0.0 {
                score / criteria_count
            } else {
                0.5 // No criteria = moderate match
            };

            // Only include tracks with at least partial match
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

    // Sort by score descending
    matches.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    matches.truncate(max_tracks);

    Ok(matches)
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
    let client = ollama::OllamaClient::with_config(
        &ollama_url,
        &model.unwrap_or(ollama_model),
    );

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
    let playlist = db.create_playlist(&name, description.as_deref())
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
    let tracks_with_meta = db.get_all_tracks_with_metadata().map_err(|e| e.to_string())?;
    drop(db);
    
    if tracks_with_meta.is_empty() {
        return Ok(vec![]);
    }

    // Get current track metadata if available
    let current_meta = current_track_id.as_ref().and_then(|id| {
        tracks_with_meta.iter().find(|(t, _)| t.id == *id).map(|(_, m)| m.clone())
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
        .filter_map(|id| tracks_with_meta.iter().find(|(t, _)| t.id == *id).map(|(t, _)| t.clone()))
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
    let tracks_with_meta = db.get_all_tracks_with_metadata().map_err(|e| e.to_string())?;
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
        .filter_map(|id| tracks_with_meta.iter().find(|(t, _)| t.id == *id).map(|(t, _)| t.clone()))
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
    let tracks_with_meta = db.get_all_tracks_with_metadata().map_err(|e| e.to_string())?;

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

    let prompt = ollama::Prompts::context_aware_autoplay(
        &library_summary,
        hour,
        &day_of_week,
        &recent_str,
    );

    let result: Vec<String> = client
        .generate_json_with_temp(&prompt, 0.6)
        .await
        .map_err(|e| e.to_string())?;

    let tracks: Vec<Track> = result
        .iter()
        .filter_map(|id| tracks_with_meta.iter().find(|(t, _)| t.id == *id).map(|(t, _)| t.clone()))
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
    let tracks_with_meta = db.get_all_tracks_with_metadata().map_err(|e| e.to_string())?;

    if tracks_with_meta.is_empty() {
        return Err("Library is empty or no tracks have been tagged. Tag some tracks first.".to_string());
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
        if pl.name.starts_with("Daily Mix") && pl.description.as_deref().map_or(false, |d| d.contains("🧠")) {
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
    let playlist = db.create_playlist(&plan.name, Some(&description))
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

    Ok(spotify_import::search_youtube_for_track_smart(
        &track,
        &ollama_url,
        &model_to_use,
    ).await)
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

    Ok(spotify_import::search_youtube_for_track_smart_with_fallback(
        &track,
        &ollama_url,
        &model_to_use,
    ).await)
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
    let client = ollama::OllamaClient::with_config(
        &ollama_url,
        &model.unwrap_or(ollama_model),
    );

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

    spotify_import::get_alternative_queries(
        &track,
        &ollama_url,
        &model_to_use,
    )
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

    spotify_import::suggest_similar_tracks(
        &track,
        &ollama_url,
        &model_to_use,
    )
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
        let _ = app.emit("smart-import-progress", serde_json::json!({
            "current": idx + 1,
            "total": total,
            "progress": ((idx + 1) as f32 / total as f32 * 100.0) as u32,
            "track_name": track.track_name,
            "artist_name": track.artist_name,
        }));

        let result = if use_fallback {
            spotify_import::search_youtube_for_track_smart_with_fallback(
                track,
                &ollama_url,
                &model_to_use,
            ).await
        } else {
            spotify_import::search_youtube_for_track_smart(
                track,
                &ollama_url,
                &model_to_use,
            ).await
        };

        results.push(result);
    }

    // Emit completion event
    let found = results.iter().filter(|r| r.status == spotify_import::ImportStatus::Found).count();
    let alt = results.iter().filter(|r| r.status == spotify_import::ImportStatus::AlternativeFound).count();
    let not_found = results.iter().filter(|r| r.status == spotify_import::ImportStatus::NotFound).count();
    let avg_quality = if results.is_empty() {
        0
    } else {
        results.iter().map(|r| r.quality_score as u64).sum::<u64>() as u32 / total as u32
    };

    let _ = app.emit("smart-import-complete", serde_json::json!({
        "total": total,
        "found": found,
        "alternatives": alt,
        "not_found": not_found,
        "average_quality": avg_quality,
    }));

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
    let mut parts = vec![
        format!("{} by {}", track.title, track.artist),
    ];

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

/// Index single track with embedding
#[tauri::command]
async fn semantic_index_track(
    state: State<'_, AppState>,
    track_id: String,
) -> Result<bool, String> {
    let db = state.db.lock().await;

    // Get settings
    let settings = db.get_settings().map_err(|e| e.to_string())?;
    if !settings.semantic_search_enabled {
        return Err("Semantic search is disabled".to_string());
    }

    let ollama = OllamaClient::with_config(&settings.ollama_url, &settings.embedding_model);

    // Get track + metadata
    let track = db
        .get_track_by_uuid(&track_id)
        .map_err(|e| e.to_string())?;
    
    let metadata = db.get_track_metadata(&track_id).ok();

    let text = build_track_text(&track, metadata.as_ref());

    // Generate embedding
    let embedding = ollama
        .embed_single(&text, &settings.embedding_model)
        .await
        .map_err(|e| e.to_string())?;

    let dimensions = embedding.len() as i32;

    // Save embedding
    db.save_embedding(&track_id, &embedding, &text, &settings.embedding_model, dimensions)
        .map_err(|e| e.to_string())?;

    Ok(true)
}

/// Index ALL tracks with progress events
#[tauri::command]
async fn semantic_index_all(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<SemanticIndexStatus, String> {
    let db = state.db.lock().await;
    let settings = db.get_settings().map_err(|e| e.to_string())?;

    if !settings.semantic_search_enabled {
        return Err("Semantic search is disabled".to_string());
    }

    let ollama = OllamaClient::with_config(&settings.ollama_url, &settings.embedding_model);

    // Clear ANN index for rebuild
    let mut ann = state.ann_index.write().await;
    ann.clear();

    // Get all tracks
    let tracks = db.get_all_tracks().map_err(|e| e.to_string())?;
    let total = tracks.len() as i64;
    let mut indexed = 0i64;
    let start_time = std::time::Instant::now();

    for track in tracks {
        let metadata = db.get_track_metadata(&track.id).ok();
        let text = build_track_text(&track, metadata.as_ref());

        match ollama
            .embed_single(&text, &settings.embedding_model)
            .await
        {
            Ok(embedding) => {
                let dimensions = embedding.len() as i32;
                let _ = db.save_embedding(
                    &track.id,
                    &embedding,
                    &text,
                    &settings.embedding_model,
                    dimensions,
                );

                // Add to ANN index
                let meta = semantic::build_metadata(
                    &track,
                    metadata.as_ref().and_then(|m| m.genre.clone()),
                    metadata.as_ref().and_then(|m| m.mood.clone()),
                    metadata.as_ref().and_then(|m| m.activity_tags.clone()),
                );
                ann.add(track.id.clone(), embedding, meta);

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
        let _ = app_handle.emit("semantic-index-progress", serde_json::json!({
            "indexed": indexed,
            "total": total,
            "current_track": track.title,
            "percentage": ((indexed as f64 / total as f64) * 100.0) as i32,
            "estimated_time_remaining_seconds": eta,
        }));
    }

    Ok(SemanticIndexStatus {
        total_tracks: total,
        indexed_tracks: indexed,
        model_used: settings.embedding_model.clone(),
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
    let db = state.db.lock().await;
    let settings = db.get_settings().map_err(|e| e.to_string())?;

    if !settings.semantic_search_enabled {
        return Err("Semantic search is disabled".to_string());
    }

    let ollama = OllamaClient::with_config(&settings.ollama_url, &settings.embedding_model);

    // Embed query
    let query_embedding = ollama
        .embed_single(&query, &settings.embedding_model)
        .await
        .map_err(|e| e.to_string())?;

    // Get all embeddings
    let embeddings = db.get_all_embeddings().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(20) as usize;

    let mut scored: Vec<(String, f64)> = embeddings
        .iter()
        .map(|emb| {
            let similarity = cosine_similarity(&query_embedding, &emb.embedding);
            (emb.track_id.clone(), similarity)
        })
        .collect();

    // Filter threshold (0.3) and sort
    scored.retain(|(_id, sim)| *sim > 0.3);
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(limit);

    // Build results with track data
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

/// Get semantic index status
#[tauri::command]
async fn get_semantic_status(
    state: State<'_, AppState>,
) -> Result<SemanticIndexStatus, String> {
    let db = state.db.lock().await;
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

/// Clear all semantic embeddings
#[tauri::command]
async fn semantic_clear_index(state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().await;
    db.clear_embeddings().map_err(|e| e.to_string())
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
    let db = state.db.lock().await;
    let settings = db.get_settings().map_err(|e| e.to_string())?;

    if !settings.semantic_search_enabled {
        return Err("Semantic search is disabled".to_string());
    }

    let ollama = OllamaClient::with_config(&settings.ollama_url, &settings.embedding_model);

    // Embed query
    let query_embedding = ollama
        .embed_single(&query, &settings.embedding_model)
        .await
        .map_err(|e| e.to_string())?;

    // Create filter
    let filter = SemanticSearchFilter {
        genres,
        moods,
        activities,
        min_similarity: Some(0.3),
    };

    // Try ANN search first, fall back to brute force if ANN is empty
    let ann = state.ann_index.read().await;
    let limit = limit.unwrap_or(20) as usize;

    let scored: Vec<(String, f32)> = if !ann.is_empty() {
        ann.search_filtered(&query_embedding, limit, &filter)
    } else {
        drop(ann); // Release lock
        // Fall back to brute force cosine similarity
        let embeddings = db.get_all_embeddings().map_err(|e| e.to_string())?;
        
        let mut scored: Vec<(String, f32)> = embeddings
            .iter()
            .map(|emb| {
                let similarity = cosine_similarity(&query_embedding, &emb.embedding) as f32;
                (emb.track_id.clone(), similarity)
            })
            .collect();

        // Apply filtering
        if let Some(g) = &filter.genres {
            scored.retain(|(track_id, _)| {
                if let Ok(metadata) = db.get_track_metadata(track_id) {
                    if let Some(genre) = &metadata.genre {
                        return g.contains(&genre);
                    }
                }
                true
            });
        }

        // Similar filtering for moods and activities
        if let Some(m) = &filter.moods {
            scored.retain(|(track_id, _)| {
                if let Ok(metadata) = db.get_track_metadata(track_id) {
                    if let Some(mood) = &metadata.mood {
                        return m.contains(&mood);
                    }
                }
                true
            });
        }

        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit);
        scored
    };

    // Build results with track data
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

/// Create a semantic playlist from search results
#[tauri::command]
async fn create_semantic_playlist(
    state: State<'_, AppState>,
    query: String,
    playlist_name: Option<String>,
) -> Result<SemanticPlaylistResult, String> {
    let db = state.db.lock().await;
    let settings = db.get_settings().map_err(|e| e.to_string())?;

    if !settings.semantic_search_enabled {
        return Err("Semantic search is disabled".to_string());
    }

    let ollama = OllamaClient::with_config(&settings.ollama_url, &settings.embedding_model);

    // Perform semantic search
    let query_embedding = ollama
        .embed_single(&query, &settings.embedding_model)
        .await
        .map_err(|e| e.to_string())?;

    let embeddings = db.get_all_embeddings().map_err(|e| e.to_string())?;

    let mut scored: Vec<(String, f64)> = embeddings
        .iter()
        .map(|emb| {
            let similarity = cosine_similarity(&query_embedding, &emb.embedding);
            (emb.track_id.clone(), similarity)
        })
        .collect();

    // Filter and sort
    scored.retain(|(_id, sim)| *sim > 0.3);
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(50); // Max 50 songs per semantic playlist

    let track_count = scored.len() as i64;
    let average_similarity = if !scored.is_empty() {
        scored.iter().map(|(_, sim)| sim).sum::<f64>() / scored.len() as f64
    } else {
        0.0
    };

    // Create playlist
    let name = playlist_name.unwrap_or_else(|| {
        format!("🎵 Like {} — {}", query, chrono::Local::now().format("%Y-%m-%d"))
    });

    let description = format!("Auto-generated semantic playlist from: {}", query);

    let playlist = db
        .create_playlist(&name, Some(&description))
        .map_err(|e| e.to_string())?;

    // Add tracks to playlist
    for (track_id, _) in scored {
        let _ = db.add_track_to_playlist(&playlist.id, &track_id);
    }

    Ok(SemanticPlaylistResult {
        playlist_id: playlist.id,
        playlist_name: playlist.name,
        track_count,
        average_similarity,
        created_at: chrono::Local::now().to_rfc3339(),
    })
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
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
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

    let top_tracks_text = top_tracks.iter()
        .map(|(t, c)| format!("{} by {} ({} plays)", t.title, t.artist, c))
        .collect::<Vec<_>>().join("\n");

    let prompt = ollama::Prompts::weekly_summary(&stats_text, &top_tracks_text);
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
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

    let hourly_text = hourly.iter()
        .map(|(h, c)| format!("{}:00 → {} plays", h, c))
        .collect::<Vec<_>>().join("\n");

    let prompt = ollama::Prompts::time_patterns(&hourly_text);
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
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

    let gems_text = gems.iter()
        .map(|t| format!("{} | {} by {} | {} plays", t.id, t.title, t.artist, t.play_count))
        .collect::<Vec<_>>().join("\n");

    let prompt = ollama::Prompts::forgotten_gems(&gems_text);
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
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
    let tracks = db.get_all_tracks_with_metadata().map_err(|e| e.to_string())?;
    drop(db);

    let library_summary = tracks.iter().take(200)
        .map(|(t, m)| {
            format!("{} | {} | {} | {} | {}",
                t.id, t.title, t.artist,
                m.genre.clone().unwrap_or_default(),
                m.mood.clone().unwrap_or_default(),
            )
        })
        .collect::<Vec<_>>().join("\n");

    let prompt = ollama::Prompts::more_like_this(&title, &artist, &library_summary);
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
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
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
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
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
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
    let tracks = db.get_all_tracks_with_metadata().map_err(|e| e.to_string())?;
    drop(db);

    let favorites_summary = tracks.iter()
        .filter(|(t, _)| t.is_favorite)
        .take(30)
        .map(|(t, m)| {
            format!("{} | {} | {} | {}",
                t.title, t.artist,
                m.genre.clone().unwrap_or_default(),
                m.mood.clone().unwrap_or_default(),
            )
        })
        .collect::<Vec<_>>().join("\n");

    if favorites_summary.is_empty() {
        return Err("No favorites found. Add some favorites first!".to_string());
    }

    let prompt = ollama::Prompts::because_you_liked(&favorites_summary);
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
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
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
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
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
}

// ============================================================================
// LIBRARY CLEANUP (FAZA 7 — H1-H7)
// ============================================================================

/// H1+H6: Find duplicate tracks
#[tauri::command]
async fn cleanup_find_duplicates(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let db = state.db.lock().await;
    let tracks = db.get_all_tracks().map_err(|e| e.to_string())?;
    drop(db);

    if tracks.len() < 2 {
        return Ok(serde_json::json!({ "duplicates": [], "summary": "Not enough tracks to check" }));
    }

    // Build track pairs text (title - artist)
    let track_list: Vec<String> = tracks.iter()
        .map(|t| format!("{} - {}", t.title, t.artist))
        .collect();
    let tracks_text = track_list.join("\n");

    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    let prompt = ollama::Prompts::detect_duplicates(&tracks_text);
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
}

/// H3: Clean/fix track metadata
#[tauri::command]
async fn cleanup_fix_metadata(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let db = state.db.lock().await;
    let tracks = db.get_all_tracks().map_err(|e| e.to_string())?;
    drop(db);

    // Only send tracks that look like they need cleaning
    let dirty: Vec<String> = tracks.iter()
        .filter(|t| {
            let title = &t.title;
            title.contains("(Official") || title.contains("[Official") ||
            title.contains("(Audio") || title.contains("[Audio") ||
            title.contains("(Lyrics") || title.contains("[Lyrics") ||
            title.contains("(HQ") || title.contains("[HQ") ||
            title.contains("(HD") || title.contains("[HD") ||
            title.contains("(Live") || title.contains("ft.") ||
            title.contains("feat.") || title.contains("  ") ||
            title.contains("(Music Video") || title.contains("[MV]")
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
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
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
            if db.update_track_metadata_cleanup(orig_title, orig_artist, clean_title, clean_artist).is_ok() {
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
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
}

/// H2: Auto-organize library suggestions
#[tauri::command]
async fn cleanup_auto_organize(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let db = state.db.lock().await;
    let tracks = db.get_all_tracks().map_err(|e| e.to_string())?;
    let metadata = db.get_all_metadata().map_err(|e| e.to_string())?;
    drop(db);

    // Build summary with metadata
    let summary_lines: Vec<String> = tracks.iter().map(|t| {
        let meta = metadata.iter().find(|m| m.track_id == t.id);
        match meta {
            Some(m) => format!("{} - {} [genre: {}, mood: {}, energy: {}]",
                t.title, t.artist,
                m.genre.as_deref().unwrap_or("unknown"),
                m.mood.as_deref().unwrap_or("unknown"),
                m.energy_level.unwrap_or(5)),
            None => format!("{} - {}", t.title, t.artist),
        }
    }).collect();

    let summary = summary_lines.join("\n");
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    let prompt = ollama::Prompts::auto_organize(&summary);
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
}

/// H7: Suggest tracks to delete
#[tauri::command]
async fn cleanup_suggest_deletions(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let db = state.db.lock().await;
    let tracks = db.get_all_tracks().map_err(|e| e.to_string())?;
    drop(db);

    let never_played: Vec<String> = tracks.iter()
        .filter(|t| t.play_count == 0)
        .map(|t| format!("{} - {}", t.title, t.artist))
        .collect();

    if never_played.is_empty() {
        return Ok(serde_json::json!({ "safe_to_delete": [], "keep": [], "summary": "All tracks have been played!" }));
    }

    let tracks_text = never_played.join("\n");
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    let prompt = ollama::Prompts::suggest_deletions(&tracks_text);
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
}

/// Delete a track by ID
#[tauri::command]
async fn cleanup_delete_track(
    state: State<'_, AppState>,
    track_id: String,
) -> Result<(), String> {
    let db = state.db.lock().await;
    db.delete_track(&track_id).map_err(|e| e.to_string())
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
    let top_artists_text: Vec<String> = top_artists.iter().take(5).map(|(a, c)| format!("{} ({})", a, c)).collect();

    let library_summary = format!("{} tracks. Top artists: {}", total, top_artists_text.join(", "));
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
    let response = client.generate(&conversation).await.map_err(|e| e.to_string())?;
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
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
}

/// J5: Music quiz
#[tauri::command]
async fn ai_chat_quiz(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let db = state.db.lock().await;
    let tracks = db.get_all_tracks().map_err(|e| e.to_string())?;
    drop(db);

    // Sample ~20 tracks for quiz context
    let sample: Vec<String> = tracks.iter()
        .take(20)
        .map(|t| format!("{} - {}", t.title, t.artist))
        .collect();
    let tracks_text = sample.join("\n");

    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    let prompt = ollama::Prompts::music_quiz(&tracks_text);
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
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
    let tracks_text = library.iter()
        .map(|t| format!("{} - {}", t.title, t.artist))
        .collect::<Vec<_>>()
        .join("\n");
    
    let prompt = ollama::Prompts::mood_playlist(&mood, &tracks_text);
    client.generate_json(&prompt).await.map_err(|e| e.to_string())
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
    let tracks_text = library.iter()
        .map(|t| format!("{} - {} ({} seconds)", t.title, t.artist, 240)) // hardcode avg 4min for now
        .collect::<Vec<_>>()
        .join("\n");
    
    let prompt = ollama::Prompts::duration_playlist(duration_min, &theme, &tracks_text);
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
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
    let tracks_text = library.iter()
        .map(|t| format!("{} - {}", t.title, t.artist))
        .collect::<Vec<_>>()
        .join("\n");
    
    let prompt = ollama::Prompts::transition_playlist(&start_mood, &end_mood, &tracks_text);
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
}

/// C7: Discovery playlist
#[tauri::command]
async fn smart_playlist_discovery(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    
    let db = state.db.lock().await;
    let library = db.get_all_tracks().map_err(|e| e.to_string())?;
    let artists: Vec<String> = library.iter().map(|t| t.artist.clone()).collect::<std::collections::HashSet<_>>().into_iter().collect();
    let artists_text = artists.join(", ");
    
    let prompt = ollama::Prompts::discovery_playlist(&artists_text, "");
    client.generate_json(&prompt).await.map_err(|e| e.to_string())
}

/// C8: Name a playlist
#[tauri::command]
async fn smart_playlist_name(
    state: State<'_, AppState>,
    track_ids: Vec<String>,
) -> Result<serde_json::Value, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    
    let tracks = track_ids.iter()
        .map(|id| format!("(id: {})", id))
        .collect::<Vec<_>>()
        .join(", ");
    
    let prompt = ollama::Prompts::name_playlist(&tracks);
    client.generate_json(&prompt).await.map_err(|e| e.to_string())
}

/// C9: Describe playlist cover
#[tauri::command]
async fn smart_playlist_cover_idea(
    state: State<'_, AppState>,
    track_ids: Vec<String>,
) -> Result<serde_json::Value, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    
    let tracks = track_ids.iter()
        .map(|id| format!("(id: {})", id))
        .collect::<Vec<_>>()
        .join(", ");
    
    let prompt = ollama::Prompts::describe_playlist_cover(&tracks);
    client.generate_json(&prompt).await.map_err(|e| e.to_string())
}

/// C10: Reorder a playlist
#[tauri::command]
async fn smart_playlist_reorder(
    state: State<'_, AppState>,
    track_ids: Vec<String>,
) -> Result<serde_json::Value, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    
    let tracks = track_ids.iter()
        .map(|id| format!("(id: {})", id))
        .collect::<Vec<_>>()
        .join(", ");
    
    let prompt = ollama::Prompts::reorder_playlist(&tracks);
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
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
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
}

/// C12: Split a playlist
#[tauri::command]
async fn smart_playlist_split(
    state: State<'_, AppState>,
    track_ids: Vec<String>,
) -> Result<serde_json::Value, String> {
    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    
    let tracks = track_ids.iter()
        .map(|id| format!("(id: {})", id))
        .collect::<Vec<_>>()
        .join(", ");
    
    let prompt = ollama::Prompts::split_playlist(&tracks);
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
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
    client.generate_json(&prompt).await.map_err(|e| e.to_string())
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
    client.generate_json(&prompt).await.map_err(|e| e.to_string())
}

/// K3: Year in Review / Wrapped
#[tauri::command]
async fn share_year_in_review(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
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
    let top_artists_text: Vec<String> = top_artists.iter().take(5).map(|(a, c)| format!("{} ({})", a, c)).collect();

    // Top genres
    let mut genres: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for m in &metadata {
        if let Some(g) = &m.genre {
            *genres.entry(g.clone()).or_insert(0) += 1;
        }
    }
    let mut top_genres: Vec<_> = genres.into_iter().collect();
    top_genres.sort_by(|a, b| b.1.cmp(&a.1));
    let top_genres_text: Vec<String> = top_genres.iter().take(5).map(|(g, c)| format!("{} ({})", g, c)).collect();

    let stats = format!(
        "Total tracks: {}\nTotal plays: {}\nFavorites: {}\nDownloaded: {}\nTop artists: {}\nTop genres: {}",
        total, total_plays, fav_count, downloaded,
        top_artists_text.join(", "),
        top_genres_text.join(", ")
    );

    let (ollama_url, ollama_model) = get_ollama_client(&state).await?;
    let client = ollama::OllamaClient::with_config(&ollama_url, &ollama_model);
    let prompt = ollama::Prompts::year_in_review(&stats);
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
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
    client.generate_json(&prompt).await.map_err(|e| e.to_string())
}

/// L2: Settings advisor
#[tauri::command]
async fn ai_settings_advice(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
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
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
}

/// L3: Storage analyzer
#[tauri::command]
async fn ai_storage_analysis(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let db = state.db.lock().await;
    let tracks = db.get_all_tracks().map_err(|e| e.to_string())?;
    drop(db);

    let total = tracks.len();
    let downloaded = tracks.iter().filter(|t| t.is_downloaded).count();
    let not_downloaded = total - downloaded;
    let never_played_downloaded = tracks.iter()
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
    client.generate_json_large(&prompt).await.map_err(|e| e.to_string())
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
    pub trigger_type: String,  // "TrackStart" | "QueueEmpty" | etc.
    pub current_title: Option<String>,
    pub current_artist: Option<String>,
    pub current_track_id: Option<String>,
    pub next_title: Option<String>,
    pub next_artist: Option<String>,
    pub time_of_day: Option<String>,  // "morning" | "afternoon" | "evening" | "night"
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
    let client = ollama::OllamaClient::with_config(&ollama_url, &context.model.unwrap_or(ollama_model));

    // Get metadata for current track if available
    let db = state.db.lock().await;
    let current_meta = context.current_track_id.as_ref().and_then(|id| db.get_track_metadata(id).ok());
    let _next_meta = context.next_title.as_ref().and_then(|_| {
        context.current_track_id.as_ref().and_then(|id| db.get_track_metadata(id).ok())
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
            let current = context.current_mood.unwrap_or_else(|| "unknown".to_string());
            let prev_title = context.current_title.unwrap_or_default();
            let next_title = context.next_title.unwrap_or_default();
            ollama::Prompts::dj_mood_shift(&prev, &current, &prev_title, &next_title, &dj_style, &lang)
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

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
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
}
