use crate::models::{AudioFormat, SearchResult, TrackInfo};
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;
use tokio::process::Command;
use tokio::sync::RwLock;

const MIN_SUPPORTED_YTDLP_VERSION: (u32, u32, u32) = (2026, 8, 19);

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
    #[error(
        "Unable to verify yt-dlp compatibility because its version output was not recognized."
    )]
    InvalidVersionOutput,
    #[error("Unable to verify yt-dlp compatibility because the version check failed.")]
    VersionCheckFailed,
    #[error("yt-dlp {minimum} or newer is required. Found {found}. Please update yt-dlp.")]
    UnsupportedVersion { minimum: String, found: String },
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

fn parse_ytdlp_version(version_output: &str) -> Option<(u32, u32, u32)> {
    let mut components = version_output.trim().split('.');
    let year = components.next()?.parse().ok()?;
    let month = components.next()?.parse().ok()?;
    let day = components.next()?.parse().ok()?;

    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    Some((year, month, day))
}

fn format_ytdlp_version((year, month, day): (u32, u32, u32)) -> String {
    format!("{year:04}.{month:02}.{day:02}")
}

pub async fn check_installation() -> Result<String, YtdlpError> {
    let output = Command::new("yt-dlp")
        .arg("--version")
        .output()
        .await
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                YtdlpError::NotInstalled
            } else {
                YtdlpError::VersionCheckFailed
            }
        })?;

    if !output.status.success() {
        return Err(YtdlpError::VersionCheckFailed);
    }

    let version_output = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let installed_version =
        parse_ytdlp_version(&version_output).ok_or(YtdlpError::InvalidVersionOutput)?;

    if installed_version < MIN_SUPPORTED_YTDLP_VERSION {
        return Err(YtdlpError::UnsupportedVersion {
            minimum: format_ytdlp_version(MIN_SUPPORTED_YTDLP_VERSION),
            found: format_ytdlp_version(installed_version),
        });
    }

    Ok(version_output)
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

fn resolve_download_dir(
    override_value: Option<&OsStr>,
    audio_dir: Option<PathBuf>,
    download_dir: Option<PathBuf>,
) -> Result<PathBuf, YtdlpError> {
    if let Some(value) = override_value {
        if !value.to_string_lossy().trim().is_empty() {
            let override_path = PathBuf::from(value);
            if !override_path.is_absolute() {
                return Err(YtdlpError::DownloadError(
                    "YTM_FREE_DOWNLOAD_DIR must be an absolute path".to_string(),
                ));
            }
            return Ok(override_path);
        }
    }

    Ok(audio_dir
        .or(download_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("YTM-Free"))
}

fn parse_existing_download_path(stdout: &[u8]) -> Result<String, YtdlpError> {
    let structured_output = std::str::from_utf8(stdout).map_err(|error| {
        YtdlpError::DownloadError(format!(
            "Download completed but the final file path was not valid UTF-8 JSON: {error}"
        ))
    })?;
    let structured_output = structured_output.trim();

    if structured_output.is_empty() {
        return Err(YtdlpError::DownloadError(
            "Download completed but no final file path was returned".to_string(),
        ));
    }

    let filepath: String = serde_json::from_str(structured_output).map_err(|error| {
        YtdlpError::DownloadError(format!(
            "Download completed but the final file path could not be parsed: {error}"
        ))
    })?;

    if filepath.trim().is_empty() {
        return Err(YtdlpError::DownloadError(
            "Download completed but the final file path was empty".to_string(),
        ));
    }

    if !Path::new(&filepath).is_file() {
        return Err(YtdlpError::DownloadError(format!(
            "Download completed but the reported final file does not exist: {filepath}"
        )));
    }

    Ok(filepath)
}

/// Download audio to local file
pub async fn download(video_id: &str) -> Result<String, YtdlpError> {
    let url = format!("https://www.youtube.com/watch?v={}", video_id);

    // Get download directory
    let download_dir = resolve_download_dir(
        std::env::var_os("YTM_FREE_DOWNLOAD_DIR").as_deref(),
        dirs::audio_dir(),
        dirs::download_dir(),
    )?;

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
            "after_move:%(filepath)j",
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

    parse_existing_download_path(&output.stdout)
}

#[cfg(test)]
mod version_tests {
    use super::*;

    fn is_supported(version_output: &str) -> Option<bool> {
        parse_ytdlp_version(version_output).map(|version| version >= MIN_SUPPORTED_YTDLP_VERSION)
    }

    #[test]
    fn exact_minimum_version_is_supported() {
        assert_eq!(is_supported("2026.08.19"), Some(true));
    }

    #[test]
    fn newer_stable_version_is_supported() {
        assert_eq!(is_supported("2026.09.01"), Some(true));
    }

    #[test]
    fn nightly_version_is_supported() {
        assert_eq!(is_supported("2026.09.16.232951"), Some(true));
    }

    #[test]
    fn nightly_dev_suffix_is_supported() {
        assert_eq!(is_supported("2026.09.16.232951.dev0"), Some(true));
    }

    #[test]
    fn immediately_older_version_is_unsupported() {
        assert_eq!(is_supported("2026.08.18"), Some(false));
    }

    #[test]
    fn known_failing_version_is_unsupported() {
        assert_eq!(is_supported("2026.07.04"), Some(false));
    }

    #[test]
    fn previous_year_version_is_unsupported() {
        assert_eq!(is_supported("2025.12.31"), Some(false));
    }

    #[test]
    fn malformed_version_is_rejected() {
        assert_eq!(is_supported("garbage"), None);
    }

    #[test]
    fn incomplete_version_is_rejected() {
        assert_eq!(is_supported("2026.08"), None);
    }

    #[test]
    fn surrounding_whitespace_is_trimmed() {
        assert_eq!(is_supported(" \r\n2026.08.19\r\n "), Some(true));
    }

    #[tokio::test]
    #[ignore = "requires a controlled yt-dlp 2026.07.04 executable on PATH"]
    async fn controlled_path_rejects_known_failing_version() {
        let error = check_installation().await.unwrap_err();
        assert_eq!(
            error.to_string(),
            "yt-dlp 2026.08.19 or newer is required. Found 2026.07.04. Please update yt-dlp."
        );
    }

    #[tokio::test]
    #[ignore = "requires a controlled yt-dlp 2026.08.19 executable on PATH"]
    async fn controlled_path_accepts_minimum_supported_version() {
        assert_eq!(check_installation().await.unwrap(), "2026.08.19");
    }
}

#[cfg(test)]
mod download_dir_tests {
    use super::*;

    fn absolute_path(name: &str) -> PathBuf {
        if cfg!(windows) {
            PathBuf::from(format!(r"C:\synthetic\{name}"))
        } else {
            PathBuf::from(format!("/synthetic/{name}"))
        }
    }

    #[test]
    fn absolute_override_is_returned_exactly() {
        let override_path = absolute_path("override");
        let resolved = resolve_download_dir(
            Some(override_path.as_os_str()),
            Some(absolute_path("audio")),
            Some(absolute_path("downloads")),
        )
        .unwrap();
        assert_eq!(resolved, override_path);
    }

    #[test]
    fn absent_override_uses_audio_dir() {
        let audio_dir = absolute_path("audio");
        assert_eq!(
            resolve_download_dir(None, Some(audio_dir.clone()), None).unwrap(),
            audio_dir.join("YTM-Free")
        );
    }

    #[test]
    fn absent_audio_dir_uses_download_dir() {
        let download_dir = absolute_path("downloads");
        assert_eq!(
            resolve_download_dir(None, None, Some(download_dir.clone())).unwrap(),
            download_dir.join("YTM-Free")
        );
    }

    #[test]
    fn absent_platform_dirs_uses_current_directory() {
        assert_eq!(
            resolve_download_dir(None, None, None).unwrap(),
            PathBuf::from(".").join("YTM-Free")
        );
    }

    #[test]
    fn empty_override_preserves_default() {
        let audio_dir = absolute_path("audio");
        assert_eq!(
            resolve_download_dir(Some(OsStr::new("")), Some(audio_dir.clone()), None).unwrap(),
            audio_dir.join("YTM-Free")
        );
    }

    #[test]
    fn whitespace_override_preserves_default() {
        let download_dir = absolute_path("downloads");
        assert_eq!(
            resolve_download_dir(Some(OsStr::new("  \t ")), None, Some(download_dir.clone()))
                .unwrap(),
            download_dir.join("YTM-Free")
        );
    }

    #[test]
    fn relative_override_is_rejected() {
        let error = resolve_download_dir(
            Some(OsStr::new("relative-downloads")),
            Some(absolute_path("audio")),
            None,
        )
        .unwrap_err();
        assert!(error
            .to_string()
            .contains("YTM_FREE_DOWNLOAD_DIR must be an absolute path"));
    }

    #[test]
    fn override_does_not_receive_default_suffix() {
        let override_path = absolute_path("exact-root");
        let resolved = resolve_download_dir(Some(override_path.as_os_str()), None, None).unwrap();
        assert_eq!(resolved, override_path);
        assert_ne!(resolved, override_path.join("YTM-Free"));
    }
}

#[cfg(test)]
mod download_path_tests {
    use super::*;

    fn assert_existing_path_round_trip(filename: &str) {
        let test_root = std::env::temp_dir().join(format!(
            "ytm-free-download-path-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&test_root).expect("Failed to create download path test root");
        let actual_path = test_root.join(filename);
        std::fs::write(&actual_path, b"synthetic media")
            .expect("Failed to create synthetic downloaded file");

        let actual_path_text = actual_path.to_string_lossy().into_owned();
        let structured_output = serde_json::to_vec(&actual_path_text)
            .expect("Failed to encode structured final-path output");
        let persisted_path = parse_existing_download_path(&structured_output)
            .expect("Existing structured final path should be accepted");

        assert_eq!(PathBuf::from(&persisted_path), actual_path);
        assert!(Path::new(&persisted_path).exists());

        std::fs::remove_dir_all(&test_root).expect("Failed to remove download path test root");
    }

    #[test]
    fn accepts_existing_clean_ascii_mp3_path() {
        assert_existing_path_round_trip("Clean Title.mp3");
    }

    #[test]
    fn accepts_existing_pipe_normalized_mp3_path() {
        assert_existing_path_round_trip("Pipe ｜ Title.mp3");
    }

    #[test]
    fn accepts_existing_windows_invalid_characters_normalized_path() {
        assert_existing_path_round_trip("Invalid ＜ ＞ ： ＂ ／ ＼ ｜ ？ ＊.mp3");
    }

    #[test]
    fn accepts_existing_unicode_mp3_path() {
        assert_existing_path_round_trip("Björk 日本語 🎵.mp3");
    }

    #[test]
    fn accepts_existing_trailing_dot_and_space_title_result() {
        assert_existing_path_round_trip("Trailing. .mp3");
    }

    #[test]
    fn preserves_post_processing_mp3_extension() {
        assert_existing_path_round_trip("Converted Audio.mp3");
    }

    #[test]
    fn rejects_nonexistent_reported_path() {
        let missing_path = std::env::temp_dir()
            .join(format!(
                "ytm-free-missing-download-{}.mp3",
                uuid::Uuid::new_v4()
            ))
            .to_string_lossy()
            .into_owned();
        let structured_output = serde_json::to_vec(&missing_path).unwrap();

        let error = parse_existing_download_path(&structured_output).unwrap_err();

        assert!(error
            .to_string()
            .contains("reported final file does not exist"));
    }
}
