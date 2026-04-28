use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::RwLock;
use tokio_util::io::ReaderStream;
use tower_http::cors::{Any, CorsLayer};
use tracing::{error, info, warn};

use crate::ytdlp;

// ── Cached audio URL ──────────────────────────────────────────────────────────

#[derive(Clone)]
struct CachedUrl {
    url: String,
    expires_at: std::time::Instant,
}

// ── Cached video + audio URLs (used to avoid double yt-dlp calls) ─────────────

#[derive(Clone)]
struct CachedVideoUrls {
    video_url: String,
    audio_url: String,
    expires_at: std::time::Instant,
}

// ── Combined Axum state ───────────────────────────────────────────────────────

#[derive(Clone)]
struct ServerAppState {
    audio_cache: Arc<RwLock<std::collections::HashMap<String, CachedUrl>>>,
    video_cache: Arc<RwLock<std::collections::HashMap<String, CachedVideoUrls>>>,
}

// ── StreamServer (public) ─────────────────────────────────────────────────────

#[derive(Clone)]
pub struct StreamServer {
    port: u16,
    audio_cache: Arc<RwLock<std::collections::HashMap<String, CachedUrl>>>,
    video_cache: Arc<RwLock<std::collections::HashMap<String, CachedVideoUrls>>>,
}

impl StreamServer {
    pub fn new(port: u16) -> Self {
        Self {
            port,
            audio_cache: Arc::new(RwLock::new(std::collections::HashMap::new())),
            video_cache: Arc::new(RwLock::new(std::collections::HashMap::new())),
        }
    }

    /// Returns the local audio-proxy URL for a given video ID.
    pub fn get_stream_url(&self, video_id: &str) -> String {
        format!("http://localhost:{}/stream/{}", self.port, video_id)
    }

    /// Returns the local video-stream URL for a given video ID.
    pub fn get_video_stream_url(&self, video_id: &str) -> String {
        format!("http://localhost:{}/stream/video/{}", self.port, video_id)
    }

    pub async fn start(&self) {
        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any);

        let state = ServerAppState {
            audio_cache: self.audio_cache.clone(),
            video_cache: self.video_cache.clone(),
        };

        let app = Router::new()
            .route("/stream/video/:video_id", get(video_stream_handler))
            .route("/stream/:video_id", get(stream_handler))
            .route("/tts/:filename", get(tts_file_handler))
            .route("/health", get(health_handler))
            .layer(cors)
            .with_state(state);

        let addr = format!("127.0.0.1:{}", self.port);
        info!("Starting stream server on {}", addr);

        // Retry binding with backoff — protects against stale processes holding the port
        let mut retries = 5;
        let listener = loop {
            match tokio::net::TcpListener::bind(&addr).await {
                Ok(l) => break l,
                Err(e) if retries > 0 => {
                    warn!(
                        "Port {} in use, retrying in 2s ({} retries left): {}",
                        self.port, retries, e
                    );
                    retries -= 1;
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }
                Err(e) => {
                    error!(
                        "Failed to bind stream server on {} after retries: {}",
                        addr, e
                    );
                    return;
                }
            }
        };

        info!("Stream server listening on {}", addr);
        if let Err(e) = axum::serve(listener, app).await {
            error!("Stream server error: {}", e);
        }
    }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async fn health_handler() -> &'static str {
    "OK"
}

/// Audio proxy: redirects to YouTube CDN audio URL (unchanged behaviour).
async fn stream_handler(
    State(state): State<ServerAppState>,
    Path(video_id): Path<String>,
) -> Response {
    // Check cache first
    {
        let cache_read = state.audio_cache.read().await;
        if let Some(cached) = cache_read.get(&video_id) {
            if cached.expires_at > std::time::Instant::now() {
                return redirect_to_audio(&cached.url);
            }
        }
    }

    // Get fresh URL from yt-dlp
    match ytdlp::get_audio_url(&video_id).await {
        Ok(url) => {
            let cached = CachedUrl {
                url: url.clone(),
                expires_at: std::time::Instant::now() + std::time::Duration::from_secs(300),
            };
            {
                let mut cache_write = state.audio_cache.write().await;
                cache_write.insert(video_id, cached);
            }
            redirect_to_audio(&url)
        }
        Err(e) => {
            error!("Failed to get audio URL for {}: {}", video_id, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get audio: {}", e),
            )
                .into_response()
        }
    }
}

/// Video stream: uses ffmpeg to mux separate video+audio CDN streams into
/// a fragmented MP4 piped directly to the client.  Falls back gracefully when
/// ffmpeg is unavailable.
async fn video_stream_handler(
    State(state): State<ServerAppState>,
    Path(video_id): Path<String>,
) -> Response {
    // Resolve video + audio URLs (cached to avoid double yt-dlp calls)
    let (video_url, audio_url) = {
        let cache_read = state.video_cache.read().await;
        if let Some(c) = cache_read.get(&video_id) {
            if c.expires_at > std::time::Instant::now() {
                (c.video_url.clone(), c.audio_url.clone())
            } else {
                drop(cache_read);
                match fetch_and_cache_video_urls(&video_id, &state.video_cache).await {
                    Ok(pair) => pair,
                    Err(e) => {
                        error!("yt-dlp video URLs failed for {}: {}", video_id, e);
                        return (StatusCode::BAD_GATEWAY, format!("yt-dlp error: {}", e))
                            .into_response();
                    }
                }
            }
        } else {
            drop(cache_read);
            match fetch_and_cache_video_urls(&video_id, &state.video_cache).await {
                Ok(pair) => pair,
                Err(e) => {
                    error!("yt-dlp video URLs failed for {}: {}", video_id, e);
                    return (StatusCode::BAD_GATEWAY, format!("yt-dlp error: {}", e))
                        .into_response();
                }
            }
        }
    };

    // Spawn ffmpeg: mux video+audio → fragmented MP4 → stdout
    // -movflags frag_keyframe+empty_moov enables live streaming without a seek table
    let child_result = Command::new("ffmpeg")
        .args([
            "-y",
            "-hide_banner",
            "-loglevel", "error",
            "-i", &video_url,
            "-i", &audio_url,
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "192k",
            "-movflags", "frag_keyframe+empty_moov+default_base_moof",
            "-f", "mp4",
            "pipe:1",
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn();

    match child_result {
        Ok(mut child) => {
            let stdout = match child.stdout.take() {
                Some(s) => s,
                None => {
                    return (StatusCode::INTERNAL_SERVER_ERROR, "ffmpeg stdout unavailable")
                        .into_response()
                }
            };

            // Spawn task that waits for the child so it doesn't become a zombie
            tokio::spawn(async move {
                let _ = child.wait().await;
            });

            let stream = ReaderStream::new(stdout);
            let body = axum::body::Body::from_stream(stream);

            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "video/mp4")
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(header::CACHE_CONTROL, "no-cache")
                .body(body)
                .unwrap()
        }
        Err(e) => {
            error!("Failed to spawn ffmpeg for {}: {}", video_id, e);
            (
                StatusCode::SERVICE_UNAVAILABLE,
                format!("ffmpeg not available: {}. Install ffmpeg to enable HD video.", e),
            )
                .into_response()
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async fn fetch_and_cache_video_urls(
    video_id: &str,
    video_cache: &Arc<RwLock<std::collections::HashMap<String, CachedVideoUrls>>>,
) -> Result<(String, String), String> {
    let (video_url, audio_url) = ytdlp::get_video_urls(video_id)
        .await
        .map_err(|e| e.to_string())?;

    let cached = CachedVideoUrls {
        video_url: video_url.clone(),
        audio_url: audio_url.clone(),
        expires_at: std::time::Instant::now() + std::time::Duration::from_secs(300),
    };
    {
        let mut w = video_cache.write().await;
        w.insert(video_id.to_string(), cached);
    }
    Ok((video_url, audio_url))
}

fn redirect_to_audio(url: &str) -> Response {
    Response::builder()
        .status(StatusCode::TEMPORARY_REDIRECT)
        .header(header::LOCATION, url)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(axum::body::Body::empty())
        .unwrap()
}

/// TTS file handler: serves edge-tts generated MP3 files from system temp dir.
async fn tts_file_handler(Path(filename): Path<String>) -> Response {
    // Safety: only allow ytmfree_dj_*.mp3 filenames — no path traversal
    if !filename.starts_with("ytmfree_dj_") || !filename.ends_with(".mp3") {
        return (StatusCode::FORBIDDEN, "Invalid TTS filename").into_response();
    }

    let temp_path = std::env::temp_dir().join(&filename);

    match tokio::fs::read(&temp_path).await {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "audio/mpeg")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::CACHE_CONTROL, "no-cache")
            .body(axum::body::Body::from(bytes))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response()),
        Err(e) => {
            error!("TTS file not found {}: {}", filename, e);
            (StatusCode::NOT_FOUND, format!("TTS file not found: {}", filename)).into_response()
        }
    }
}
