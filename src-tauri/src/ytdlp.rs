use crate::models::{AudioFormat, SearchResult, TrackInfo};
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;
use tokio::process::Command;
use tokio::sync::RwLock;

#[derive(Error, Debug)]
pub enum YtdlpError {
    #[error("yt-dlp not found. Please install yt-dlp: https://github.com/yt-dlp/yt-dlp")]
    NotInstalled,
    #[error("Failed to execute yt-dlp: {0}")]
    ExecutionError(String),
    #[error("Failed to parse output: {0}")]
    ParseError(String),
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Download failed: {0}")]
    DownloadError(String),
}

/// Check if yt-dlp is installed and return version
/// Cache entry for YouTube search results
struct SearchCacheEntry {
    results: Vec<SearchResult>,
    expires_at: Instant,
}

/// In-memory cache for YouTube search results with TTL
struct SearchCache {
    entries: HashMap<String, SearchCacheEntry>,
    default_ttl_secs: u64,
}

impl SearchCache {
    fn new() -> Self {
        Self {
            entries: HashMap::new(),
            default_ttl_secs: 300, // 5 minutes default TTL
        }
    }

    fn get(&self, query: &str) -> Option<&Vec<SearchResult>> {
        self.entries
            .get(query)
            .filter(|entry| entry.expires_at > Instant::now())
            .map(|entry| &entry.results)
    }

    fn set(&mut self, query: String, results: Vec<SearchResult>) {
        let expires_at = Instant::now() + Duration::from_secs(self.default_ttl_secs);
        self.entries.insert(
            query,
            SearchCacheEntry {
                results,
                expires_at,
            },
        );
    }

    fn cleanup(&mut self) {
        let now = Instant::now();
        self.entries.retain(|_, entry| entry.expires_at > now);
    }

    fn clear(&mut self) {
        self.entries.clear();
    }
}

// Global cache instance
static SEARCH_CACHE: once_cell::sync::Lazy<Arc<RwLock<SearchCache>>> =
    once_cell::sync::Lazy::new(|| Arc::new(RwLock::new(SearchCache::new())));

pub async fn check_installation() -> Result<String, YtdlpError> {
    let output = Command::new("yt-dlp")
        .arg("--version")
        .output()
        .await
        .map_err(|_| YtdlpError::NotInstalled)?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(YtdlpError::NotInstalled)
    }
}

/// Search YouTube for videos
pub async fn search(query: &str, max_results: i64) -> Result<Vec<SearchResult>, YtdlpError> {
    // Check cache first
    let cache_key = format!("{}:{}", query, max_results);

    {
        let cache = SEARCH_CACHE.read().await;
        if let Some(cached) = cache.get(&cache_key) {
            return Ok(cached.clone());
        }
    }

    let count = max_results.clamp(5, 50);
    let output = Command::new("yt-dlp")
        .args([
            "--dump-json",
            "--flat-playlist",
            "--no-warnings",
            "--ignore-errors",
            &format!("ytsearch{}:{}", count, query),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await?;

    if !output.status.success() {
        return Err(YtdlpError::ExecutionError(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut results = Vec::new();

    for line in stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }

        if let Ok(json) = serde_json::from_str::<Value>(line) {
            let result = parse_search_result(&json);
            if let Some(r) = result {
                results.push(r);
            }
        }
    }

    // Cache the results
    {
        let mut cache = SEARCH_CACHE.write().await;
        cache.set(cache_key, results.clone());
    }

    Ok(results)
}

/// Clear the search cache
pub async fn clear_search_cache() {
    let mut cache = SEARCH_CACHE.write().await;
    cache.clear();
}

/// Get cache statistics
pub async fn get_cache_stats() -> (usize, u64) {
    let cache = SEARCH_CACHE.read().await;
    (cache.entries.len(), cache.default_ttl_secs)
}

/// Set cache TTL in seconds
pub async fn set_cache_ttl(secs: u64) {
    let mut cache = SEARCH_CACHE.write().await;
    cache.default_ttl_secs = secs;
}

/// Cleanup expired cache entries
pub async fn cleanup_cache() {
    let mut cache = SEARCH_CACHE.write().await;
    cache.cleanup();
}

fn parse_search_result(json: &Value) -> Option<SearchResult> {
    let id = json.get("id")?.as_str()?.to_string();
    let title = json.get("title")?.as_str()?.to_string();

    // Extract artist from channel or uploader
    let artist = json
        .get("channel")
        .or_else(|| json.get("uploader"))
        .and_then(|v| v.as_str())
        .map(|s| clean_artist_name(s))
        .unwrap_or_else(|| "Unknown Artist".to_string());

    // Get best thumbnail
    let thumbnail = extract_thumbnail(json);

    let duration = json.get("duration").and_then(|v| v.as_i64());
    let duration_string = json
        .get("duration_string")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let view_count = json.get("view_count").and_then(|v| v.as_i64());

    Some(SearchResult {
        id,
        title,
        artist,
        thumbnail,
        duration,
        duration_string,
        view_count,
    })
}

fn clean_artist_name(name: &str) -> String {
    // Remove common suffixes like " - Topic", "VEVO", etc.
    let cleaned = Regex::new(r"\s*[-–]\s*(Topic|VEVO|Official).*$")
        .unwrap()
        .replace(name, "")
        .to_string();
    cleaned.trim().to_string()
}

fn extract_thumbnail(json: &Value) -> String {
    // Try to get the best thumbnail
    if let Some(thumbnails) = json.get("thumbnails").and_then(|v| v.as_array()) {
        // Prefer medium quality (not too large)
        for thumb in thumbnails.iter().rev() {
            if let Some(url) = thumb.get("url").and_then(|v| v.as_str()) {
                return url.to_string();
            }
        }
    }

    // Fallback to direct thumbnail field
    if let Some(thumb) = json.get("thumbnail").and_then(|v| v.as_str()) {
        return thumb.to_string();
    }

    // Generate YouTube thumbnail URL
    if let Some(id) = json.get("id").and_then(|v| v.as_str()) {
        return format!("https://i.ytimg.com/vi/{}/mqdefault.jpg", id);
    }

    String::new()
}

/// Get detailed info for a video including audio formats
pub async fn get_info(video_id: &str) -> Result<TrackInfo, YtdlpError> {
    let url = format!("https://www.youtube.com/watch?v={}", video_id);

    let output = Command::new("yt-dlp")
        .args(["--dump-json", "--no-warnings", "-f", "bestaudio", &url])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await?;

    if !output.status.success() {
        return Err(YtdlpError::ExecutionError(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: Value =
        serde_json::from_str(&stdout).map_err(|e| YtdlpError::ParseError(e.to_string()))?;

    let id = json
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or(video_id)
        .to_string();

    let title = json
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown Title")
        .to_string();

    let artist = json
        .get("channel")
        .or_else(|| json.get("uploader"))
        .and_then(|v| v.as_str())
        .map(|s| clean_artist_name(s))
        .unwrap_or_else(|| "Unknown Artist".to_string());

    let thumbnail = extract_thumbnail(&json);
    let duration = json.get("duration").and_then(|v| v.as_i64()).unwrap_or(0);
    let audio_url = json
        .get("url")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Parse available formats
    let formats = parse_audio_formats(&json);

    Ok(TrackInfo {
        id,
        title,
        artist,
        thumbnail,
        duration,
        audio_url,
        formats,
    })
}

fn parse_audio_formats(json: &Value) -> Vec<AudioFormat> {
    let mut formats = Vec::new();

    if let Some(format_list) = json.get("formats").and_then(|v| v.as_array()) {
        for f in format_list {
            // Only audio formats
            let vcodec = f.get("vcodec").and_then(|v| v.as_str()).unwrap_or("none");
            let acodec = f.get("acodec").and_then(|v| v.as_str()).unwrap_or("none");

            if vcodec == "none" && acodec != "none" {
                let format_id = f
                    .get("format_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let ext = f
                    .get("ext")
                    .and_then(|v| v.as_str())
                    .unwrap_or("m4a")
                    .to_string();

                let abr = f.get("abr").and_then(|v| v.as_f64());

                let quality = match abr {
                    Some(bitrate) if bitrate >= 256.0 => "High".to_string(),
                    Some(bitrate) if bitrate >= 128.0 => "Medium".to_string(),
                    Some(bitrate) => format!("{}kbps", bitrate as i64),
                    None => "Unknown".to_string(),
                };

                let url = f.get("url").and_then(|v| v.as_str()).map(|s| s.to_string());

                formats.push(AudioFormat {
                    format_id,
                    ext,
                    quality,
                    abr,
                    url,
                });
            }
        }
    }

    // Sort by bitrate (highest first)
    formats.sort_by(|a, b| {
        b.abr
            .unwrap_or(0.0)
            .partial_cmp(&a.abr.unwrap_or(0.0))
            .unwrap()
    });

    formats
}

/// Get direct audio stream URL
pub async fn get_audio_url(video_id: &str) -> Result<String, YtdlpError> {
    let url = format!("https://www.youtube.com/watch?v={}", video_id);

    let output = Command::new("yt-dlp")
        .args([
            "-f",
            "bestaudio/best",
            "-g", // Get URL only
            "--no-warnings",
            &url,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;

    if !output.status.success() {
        return Err(YtdlpError::ExecutionError(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }

    let audio_url = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if audio_url.is_empty() {
        return Err(YtdlpError::ExecutionError(
            "No audio URL returned".to_string(),
        ));
    }

    Ok(audio_url)
}

/// Check if ffmpeg is installed and return version string
pub async fn check_ffmpeg() -> Result<String, YtdlpError> {
    let output = Command::new("ffmpeg")
        .arg("-version")
        .output()
        .await
        .map_err(|_| YtdlpError::ExecutionError("ffmpeg not found in PATH".to_string()))?;

    if output.status.success() {
        let version_line = String::from_utf8_lossy(&output.stdout)
            .lines()
            .next()
            .unwrap_or("ffmpeg installed")
            .to_string();
        Ok(version_line)
    } else {
        Err(YtdlpError::ExecutionError("ffmpeg not found".to_string()))
    }
}

/// Get separate video and audio CDN URLs for a video using a single yt-dlp call.
/// Returns (video_url, audio_url).
pub async fn get_video_urls(video_id: &str) -> Result<(String, String), YtdlpError> {
    let url = format!("https://www.youtube.com/watch?v={}", video_id);

    // -f "bestvideo[height<=720]+bestaudio" -g returns two lines: video URL, then audio URL
    let output = Command::new("yt-dlp")
        .args([
            "-f",
            "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]",
            "-g",
            "--no-warnings",
            &url,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await?;

    if !output.status.success() {
        return Err(YtdlpError::ExecutionError(
            "Failed to get video+audio URLs".to_string(),
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = stdout.lines().filter(|l| !l.trim().is_empty()).collect();

    if lines.len() >= 2 {
        // Two separate streams: video + audio
        Ok((lines[0].to_string(), lines[1].to_string()))
    } else if lines.len() == 1 {
        // Single combined stream (e.g. best[height<=720]) — use same URL for both
        Ok((lines[0].to_string(), lines[0].to_string()))
    } else {
        Err(YtdlpError::ExecutionError(
            "No video URL returned".to_string(),
        ))
    }
}

/// Download audio to local file
pub async fn download(video_id: &str) -> Result<String, YtdlpError> {
    let url = format!("https://www.youtube.com/watch?v={}", video_id);

    // Get download directory
    let download_dir = dirs::audio_dir()
        .or_else(|| dirs::download_dir())
        .unwrap_or_else(|| PathBuf::from("."))
        .join("YTM-Free");

    // Create directory if not exists
    std::fs::create_dir_all(&download_dir)?;

    let output_template = download_dir
        .join("%(title)s.%(ext)s")
        .to_string_lossy()
        .to_string();

    let output = Command::new("yt-dlp")
        .args([
            "-f",
            "bestaudio",
            "-x", // Extract audio
            "--audio-format",
            "mp3",
            "--audio-quality",
            "0", // Best quality
            "-o",
            &output_template,
            "--print",
            "after_move:filepath",
            "--no-warnings",
            &url,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;

    if !output.status.success() {
        return Err(YtdlpError::DownloadError(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }

    let filepath = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if filepath.is_empty() {
        return Err(YtdlpError::DownloadError(
            "Download completed but no file path returned".to_string(),
        ));
    }

    Ok(filepath)
}
