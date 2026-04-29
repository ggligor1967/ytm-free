use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub thumbnail: String,
    pub duration: Option<i64>,
    pub duration_string: Option<String>,
    pub view_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackInfo {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub thumbnail: String,
    pub duration: i64,
    pub audio_url: Option<String>,
    pub formats: Vec<AudioFormat>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioFormat {
    pub format_id: String,
    pub ext: String,
    pub quality: String,
    pub abr: Option<f64>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: String,
    pub video_id: String,
    pub title: String,
    pub artist: String,
    pub thumbnail: String,
    pub duration: Option<i64>,
    pub local_path: Option<String>,
    pub is_downloaded: bool,
    pub is_favorite: bool,
    pub play_count: i64,
    pub last_played: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub thumbnail: Option<String>,
    pub track_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistTrack {
    pub playlist_id: String,
    pub track_id: String,
    pub position: i64,
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub audio_quality: String, // "low", "medium", "high", "best"
    pub download_path: String,
    pub auto_download: bool,
    pub theme: String, // "dark", "light", "system"
    pub volume: f64,
    pub crossfade: bool,
    pub crossfade_duration: i64,
    pub ollama_enabled: bool,
    pub ollama_url: String,
    pub ollama_model: String,
    pub smart_search_enabled: bool,
    pub auto_tagging_enabled: bool,
    pub smart_queue_enabled: bool,
    pub daily_mix_enabled: bool,
    pub search_results_count: i64,
    pub dj_mode_enabled: bool,
    pub dj_style: String,
    pub dj_language: String,
    pub dj_frequency: i64,
    pub dj_triggers_enabled: DjTriggersEnabled,
    pub semantic_search_enabled: bool,
    pub embedding_model: String,
    pub tts_engine: String, // "web_speech" | "edge_tts"
    pub dj_voice: String,
    pub dj_pitch: f64,
    pub dj_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DjTriggersEnabled {
    pub track_start: bool,
    pub track_end: bool,
    pub queue_empty: bool,
    pub long_session: bool,
    pub first_track_of_day: bool,
    pub milestone: bool,
    pub time_announcement: bool,
    pub mood_shift: bool,
}

impl Default for DjTriggersEnabled {
    fn default() -> Self {
        Self {
            track_start: true,
            track_end: true,
            queue_empty: true,
            long_session: true,
            first_track_of_day: true,
            milestone: true,
            time_announcement: true,
            mood_shift: true,
        }
    }
}

impl Default for Settings {
    fn default() -> Self {
        let download_path = dirs::audio_dir()
            .or_else(|| dirs::download_dir())
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("YTM-Free")
            .to_string_lossy()
            .to_string();

        Self {
            audio_quality: "best".to_string(),
            download_path,
            auto_download: false,
            theme: "dark".to_string(),
            volume: 1.0,
            crossfade: false,
            crossfade_duration: 3,
            ollama_enabled: false,
            ollama_url: "http://localhost:11434".to_string(),
            ollama_model: "mistral:7b".to_string(),
            smart_search_enabled: false,
            auto_tagging_enabled: false,
            smart_queue_enabled: false,
            daily_mix_enabled: false,
            search_results_count: 25,
            dj_mode_enabled: false,
            dj_style: "classic_fm".to_string(),
            dj_language: "English".to_string(),
            dj_frequency: 1,
            dj_triggers_enabled: DjTriggersEnabled::default(),
            semantic_search_enabled: false,
            embedding_model: "all-minilm".to_string(),
            tts_engine: "web_speech".to_string(),
            dj_voice: "".to_string(),
            dj_pitch: 1.0,
            dj_rate: 1.05,
        }
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueItem {
    pub track: Track,
    pub position: usize,
}

// ============================================================================
// SMART AI MODELS
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackMetadataDB {
    pub track_id: String,
    pub genre: Option<String>,
    pub sub_genre: Option<String>,
    pub mood: Option<String>,
    pub energy_level: Option<i32>,
    pub tempo: Option<String>,
    pub danceability: Option<f64>,
    pub vocal_type: Option<String>,
    pub decade: Option<String>,
    pub language: Option<String>,
    pub activity_tags: Option<String>, // JSON array
    pub occasion_tags: Option<String>, // JSON array
    pub keywords: Option<String>,      // JSON array
    pub ai_description: Option<String>,
    pub analyzed_at: String,
    pub model_used: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayEvent {
    pub id: String,
    pub track_id: String,
    pub played_at: String,
    pub duration_listened: Option<i64>,
    pub context: Option<String>, // JSON
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListeningStats {
    pub total_tracks: i64,
    pub total_time_seconds: i64,
    pub top_genres: Vec<(String, i64)>,     // (genre, count)
    pub top_artists: Vec<(String, i64)>,    // (artist, count)
    pub top_moods: Vec<(String, i64)>,      // (mood, count)
    pub daily_breakdown: Vec<(String, i64)>, // (date, count)
}

// ============================================================================
// SEMANTIC SEARCH MODELS
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackEmbedding {
    pub track_id: String,
    pub embedding: Vec<f32>,
    pub text_used: String,
    pub model_used: String,
    pub dimensions: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticSearchResult {
    pub track: Track,
    pub similarity: f64,
    pub match_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticIndexStatus {
    pub total_tracks: i64,
    pub indexed_tracks: i64,
    pub model_used: String,
    pub is_indexing: bool,
}

// ============================================================================
// SEMANTIC SEARCH ENHANCEMENTS
// ============================================================================

/// Cached embedding metadata for fast filtering
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingMetadata {
    pub track_id: String,
    pub genres: Vec<String>,
    pub moods: Vec<String>,
    pub activities: Vec<String>,
    pub energy_level: Option<i32>,
}

/// Semantic search filter options
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticSearchFilter {
    pub genres: Option<Vec<String>>,
    pub moods: Option<Vec<String>>,
    pub activities: Option<Vec<String>>,
    pub min_similarity: Option<f64>,
}

/// Semantic playlist generation result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticPlaylistResult {
    pub playlist_id: String,
    pub playlist_name: String,
    pub track_count: i64,
    pub average_similarity: f64,
    pub created_at: String,
}

/// Progress event for WebSocket/event streaming
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexProgressEvent {
    pub indexed: i64,
    pub total: i64,
    pub current_track: String,
    pub percentage: i32,
    pub estimated_time_remaining_seconds: Option<i64>,
}
