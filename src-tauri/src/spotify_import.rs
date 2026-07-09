use crate::ollama;
use crate::ytdlp;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::Semaphore;

#[derive(Error, Debug)]
pub enum ImportError {
    #[error("Failed to read CSV file: {0}")]
    FileError(String),
    #[error("Failed to parse CSV: {0}")]
    ParseError(String),
    #[error("YouTube search failed: {0}")]
    SearchError(String),
}

/// A track from Spotify CSV export (Exportify format)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpotifyTrack {
    pub track_name: String,
    pub artist_name: String,
    pub album_name: String,
    pub duration_ms: Option<i64>,
    pub spotify_id: Option<String>,
}

/// Result of importing a single track
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub spotify_track: SpotifyTrack,
    pub youtube_id: Option<String>,
    pub youtube_title: Option<String>,
    pub status: ImportStatus,
    pub alternatives: Vec<Alternative>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alternative {
    pub id: String,
    pub title: String,
    pub artist: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ImportStatus {
    Found,
    NotFound,
    AlternativeFound,
}

/// Parse Exportify CSV format
/// Columns: Spotify ID, Artist IDs, Track Name, Album Name, Artist Name(s), Release Date, Duration (ms), etc.
pub fn parse_exportify_csv(content: &str) -> Result<Vec<SpotifyTrack>, ImportError> {
    let mut tracks = Vec::new();
    let mut lines = content.lines();

    // Find header line and determine column indices
    let header = lines
        .next()
        .ok_or_else(|| ImportError::ParseError("Empty CSV".to_string()))?;
    let headers: Vec<&str> = parse_csv_line(header);

    // Find column indices (Exportify format)
    let track_name_idx = find_column_index(&headers, &["Track Name", "track_name", "name", "Name"]);
    let artist_name_idx = find_column_index(
        &headers,
        &[
            "Artist Name(s)",
            "Artist Names",
            "artist_name",
            "artist",
            "Artist",
        ],
    );
    let album_name_idx =
        find_column_index(&headers, &["Album Name", "album_name", "album", "Album"]);
    let duration_idx = find_column_index(&headers, &["Duration (ms)", "duration_ms", "Duration"]);
    let spotify_id_idx =
        find_column_index(&headers, &["Spotify ID", "spotify_id", "URI", "Track URI"]);

    let track_idx = track_name_idx
        .ok_or_else(|| ImportError::ParseError("Could not find track name column".to_string()))?;
    let artist_idx = artist_name_idx
        .ok_or_else(|| ImportError::ParseError("Could not find artist name column".to_string()))?;

    for line in lines {
        if line.trim().is_empty() {
            continue;
        }

        let fields = parse_csv_line(line);

        if fields.len() <= track_idx || fields.len() <= artist_idx {
            continue;
        }

        let track_name = fields
            .get(track_idx)
            .map(|s| s.to_string())
            .unwrap_or_default();
        let artist_name = fields
            .get(artist_idx)
            .map(|s| s.to_string())
            .unwrap_or_default();

        if track_name.is_empty() || artist_name.is_empty() {
            continue;
        }

        let album_name = album_name_idx
            .and_then(|idx| fields.get(idx))
            .map(|s| s.to_string())
            .unwrap_or_default();

        let duration_ms = duration_idx
            .and_then(|idx| fields.get(idx))
            .and_then(|s| s.parse::<i64>().ok());

        let spotify_id = spotify_id_idx
            .and_then(|idx| fields.get(idx))
            .map(|s| s.to_string());

        tracks.push(SpotifyTrack {
            track_name,
            artist_name,
            album_name,
            duration_ms,
            spotify_id,
        });
    }

    Ok(tracks)
}

fn find_column_index(headers: &[&str], possible_names: &[&str]) -> Option<usize> {
    for name in possible_names {
        if let Some(idx) = headers.iter().position(|h| h.eq_ignore_ascii_case(name)) {
            return Some(idx);
        }
    }
    None
}

fn parse_csv_line(line: &str) -> Vec<&str> {
    let mut fields = Vec::new();
    let mut in_quotes = false;
    let mut start_byte = 0;

    // Iterate with byte indices for proper UTF-8 handling
    for (byte_idx, ch) in line.char_indices() {
        if ch == '"' {
            in_quotes = !in_quotes;
        } else if ch == ',' && !in_quotes {
            let field = &line[start_byte..byte_idx];
            fields.push(field.trim().trim_matches('"'));
            start_byte = byte_idx + 1; // ',' is 1 byte
        }
    }

    // Add last field
    if start_byte < line.len() {
        fields.push(line[start_byte..].trim().trim_matches('"'));
    }

    fields
}

/// Search YouTube for a Spotify track with fallback alternatives
pub async fn search_youtube_for_track(track: &SpotifyTrack) -> ImportResult {
    // Primary search: exact artist + track name
    let primary_query = format!("{} {}", track.artist_name, track.track_name);

    match ytdlp::search(&primary_query, 5).await {
        Ok(results) if !results.is_empty() => {
            let best = &results[0];

            // Collect alternatives (other results)
            let alternatives: Vec<Alternative> = results
                .iter()
                .skip(1)
                .take(3)
                .map(|r| Alternative {
                    id: r.id.clone(),
                    title: r.title.clone(),
                    artist: r.artist.clone(),
                })
                .collect();

            ImportResult {
                spotify_track: track.clone(),
                youtube_id: Some(best.id.clone()),
                youtube_title: Some(best.title.clone()),
                status: ImportStatus::Found,
                alternatives,
            }
        }
        _ => {
            // Try alternative searches
            let alternative_queries = vec![
                format!("{} {} audio", track.artist_name, track.track_name),
                format!("{} {} official", track.artist_name, track.track_name),
                format!("{} {} lyrics", track.artist_name, track.track_name),
                format!("{} {} live", track.artist_name, track.track_name),
            ];

            for alt_query in alternative_queries {
                if let Ok(results) = ytdlp::search(&alt_query, 5).await {
                    if !results.is_empty() {
                        let best = &results[0];
                        let alternatives: Vec<Alternative> = results
                            .iter()
                            .skip(1)
                            .take(3)
                            .map(|r| Alternative {
                                id: r.id.clone(),
                                title: r.title.clone(),
                                artist: r.artist.clone(),
                            })
                            .collect();

                        return ImportResult {
                            spotify_track: track.clone(),
                            youtube_id: Some(best.id.clone()),
                            youtube_title: Some(best.title.clone()),
                            status: ImportStatus::AlternativeFound,
                            alternatives,
                        };
                    }
                }
            }

            // Nothing found
            ImportResult {
                spotify_track: track.clone(),
                youtube_id: None,
                youtube_title: None,
                status: ImportStatus::NotFound,
                alternatives: vec![],
            }
        }
    }
}

/// Import all tracks from a CSV file with parallel processing
pub async fn import_from_csv(file_path: &str) -> Result<Vec<ImportResult>, ImportError> {
    let content =
        std::fs::read_to_string(file_path).map_err(|e| ImportError::FileError(e.to_string()))?;

    let tracks = parse_exportify_csv(&content)?;

    // Use semaphore to limit concurrent requests (max 10)
    let semaphore = Arc::new(Semaphore::new(10));
    let mut results = Vec::new();

    // Process tracks in parallel with controlled concurrency
    let mut tasks = Vec::new();
    for track in tracks {
        let semaphore = Arc::clone(&semaphore);
        let track = track.clone();

        let task = tokio::spawn(async move {
            let permit = match semaphore.acquire().await {
                Ok(p) => p,
                Err(_) => return Err(ImportError::SearchError("Semaphore closed".to_string())),
            };
            let result = search_youtube_for_track(&track).await;
            drop(permit);
            Ok(result)
        });

        tasks.push(task);
    }

    // Collect results
    for task in tasks {
        results.push(
            task.await
                .map_err(|e| ImportError::SearchError(format!("Task failed: {}", e)))??,
        );
    }

    Ok(results)
}

/// CSV file info for listing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CsvFileInfo {
    pub name: String,
    pub path: String,
    pub track_count: usize,
}

/// Scan a folder for CSV files and return info about each
pub fn scan_folder_for_csv(folder_path: &str) -> Result<Vec<CsvFileInfo>, ImportError> {
    let path = Path::new(folder_path);

    if !path.exists() {
        return Err(ImportError::FileError(format!(
            "Folder not found: {}",
            folder_path
        )));
    }

    if !path.is_dir() {
        return Err(ImportError::FileError(format!(
            "Not a directory: {}",
            folder_path
        )));
    }

    let mut csv_files = Vec::new();

    let entries = std::fs::read_dir(path).map_err(|e| ImportError::FileError(e.to_string()))?;

    for entry in entries.flatten() {
        let file_path = entry.path();

        if file_path.extension().map(|e| e == "csv").unwrap_or(false) {
            let name = file_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown")
                .to_string();

            // Try to count tracks
            let track_count = if let Ok(content) = std::fs::read_to_string(&file_path) {
                parse_exportify_csv(&content)
                    .map(|tracks| tracks.len())
                    .unwrap_or(0)
            } else {
                0
            };

            csv_files.push(CsvFileInfo {
                name,
                path: file_path.to_string_lossy().to_string(),
                track_count,
            });
        }
    }

    // Sort by name
    csv_files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(csv_files)
}

/// Get the default Spotify folder path
pub fn get_default_spotify_folder() -> String {
    // First try the .ytm-free/Spotify folder in user's home directory
    if let Some(home) = dirs::home_dir() {
        let ytm_spotify = home.join(".ytm-free").join("Spotify");
        if ytm_spotify.exists() {
            return ytm_spotify.to_string_lossy().to_string();
        }
    }

    // Fallback to data directory
    dirs::data_dir()
        .or_else(|| dirs::home_dir())
        .map(|p| p.join("ytm-free").join("Spotify"))
        .unwrap_or_else(|| std::path::PathBuf::from("Spotify"))
        .to_string_lossy()
        .to_string()
}

// ============================================================================
// SMART IMPORT (FAZA 4 — D1-D5)
// ============================================================================

/// Confidence level for a match
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MatchConfidence {
    High,
    Medium,
    Low,
}

/// Result of AI-enhanced smart matching
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartImportResult {
    pub spotify_track: SpotifyTrack,
    pub youtube_id: Option<String>,
    pub youtube_title: Option<String>,
    pub status: ImportStatus,
    pub confidence: MatchConfidence,
    pub ai_reason: Option<String>,
    pub alternatives: Vec<Alternative>,
    pub quality_score: u32, // 0-100
}

/// Alternative query suggestions from AI [D3]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlternativeQueriesResult {
    pub queries: Vec<String>,
    pub likely_issue: String,
    pub suggestion: String,
}

/// Match quality assessment from AI [D4]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchQualityResult {
    pub quality: String,
    pub score: u32,
    pub issues: Vec<String>,
    pub is_correct_track: bool,
    pub is_correct_artist: bool,
    pub is_studio_version: bool,
    pub duration_match: bool,
    pub recommendation: String, // accept, review, reject, re-search
}

/// Similar track suggestion for NotFound tracks [D5]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SameArtistAlternative {
    pub title: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OtherArtistAlternative {
    pub title: String,
    pub artist: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimilarTrackSuggestion {
    pub same_artist_alternatives: Vec<SameArtistAlternative>,
    pub other_artist_alternatives: Vec<OtherArtistAlternative>,
    pub search_queries: Vec<String>,
}

/// Disambiguated selection result from AI [D2]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisambiguationResult {
    pub selected_id: String,
    pub confidence: String,
    pub reason: String,
    pub is_cover: bool,
    pub is_live: bool,
    pub is_remix: bool,
}

/// D1: Smart search with AI verification — searches YT, sends top results to LLM for best match
pub async fn search_youtube_for_track_smart(
    track: &SpotifyTrack,
    ollama_url: &str,
    ollama_model: &str,
) -> SmartImportResult {
    let primary_query = format!("{} {}", track.artist_name, track.track_name);

    // Search YouTube for top results
    let yt_results = match ytdlp::search(&primary_query, 5).await {
        Ok(results) if !results.is_empty() => results,
        _ => {
            // No results at all — return NotFound with low confidence
            return SmartImportResult {
                spotify_track: track.clone(),
                youtube_id: None,
                youtube_title: None,
                status: ImportStatus::NotFound,
                confidence: MatchConfidence::Low,
                ai_reason: Some("No YouTube results found for primary search".to_string()),
                alternatives: vec![],
                quality_score: 0,
            };
        }
    };

    // Prepare data for LLM verification
    let spotify_duration_sec = track.duration_ms.map(|ms| ms / 1000);
    let yt_tuples: Vec<(String, String, String, Option<i64>)> = yt_results
        .iter()
        .take(5)
        .map(|r| {
            (
                r.id.clone(),
                r.title.clone(),
                r.artist.clone(),
                r.duration.map(|d| d as i64),
            )
        })
        .collect();

    // Try AI verification
    let client = ollama::OllamaClient::with_config(ollama_url, ollama_model);

    let prompt = ollama::Prompts::verify_spotify_match(
        &track.track_name,
        &track.artist_name,
        &track.album_name,
        spotify_duration_sec,
        &yt_tuples,
    );

    #[derive(Deserialize)]
    struct VerifyResult {
        selected_id: Option<String>,
        confidence: String,
        reason: String,
    }

    match client.generate_json::<VerifyResult>(&prompt).await {
        Ok(ai_result) => {
            let confidence = match ai_result.confidence.to_lowercase().as_str() {
                "high" => MatchConfidence::High,
                "medium" => MatchConfidence::Medium,
                _ => MatchConfidence::Low,
            };

            let quality_score = match confidence {
                MatchConfidence::High => 90,
                MatchConfidence::Medium => 65,
                MatchConfidence::Low => 35,
            };

            if let Some(selected_id) = &ai_result.selected_id {
                // Find the selected result for title
                let selected = yt_results.iter().find(|r| &r.id == selected_id);
                let alternatives: Vec<Alternative> = yt_results
                    .iter()
                    .filter(|r| &r.id != selected_id)
                    .take(3)
                    .map(|r| Alternative {
                        id: r.id.clone(),
                        title: r.title.clone(),
                        artist: r.artist.clone(),
                    })
                    .collect();

                SmartImportResult {
                    spotify_track: track.clone(),
                    youtube_id: Some(selected_id.clone()),
                    youtube_title: selected.map(|r| r.title.clone()),
                    status: ImportStatus::Found,
                    confidence,
                    ai_reason: Some(ai_result.reason),
                    alternatives,
                    quality_score,
                }
            } else {
                // AI couldn't find a good match
                let alternatives: Vec<Alternative> = yt_results
                    .iter()
                    .take(3)
                    .map(|r| Alternative {
                        id: r.id.clone(),
                        title: r.title.clone(),
                        artist: r.artist.clone(),
                    })
                    .collect();

                SmartImportResult {
                    spotify_track: track.clone(),
                    youtube_id: None,
                    youtube_title: None,
                    status: ImportStatus::NotFound,
                    confidence: MatchConfidence::Low,
                    ai_reason: Some(ai_result.reason),
                    alternatives,
                    quality_score: 15,
                }
            }
        }
        Err(_) => {
            // AI failed — fallback to standard matching (first result)
            let best = &yt_results[0];
            let alternatives: Vec<Alternative> = yt_results
                .iter()
                .skip(1)
                .take(3)
                .map(|r| Alternative {
                    id: r.id.clone(),
                    title: r.title.clone(),
                    artist: r.artist.clone(),
                })
                .collect();

            SmartImportResult {
                spotify_track: track.clone(),
                youtube_id: Some(best.id.clone()),
                youtube_title: Some(best.title.clone()),
                status: ImportStatus::Found,
                confidence: MatchConfidence::Medium,
                ai_reason: Some("AI unavailable — used first YouTube result".to_string()),
                alternatives,
                quality_score: 50,
            }
        }
    }
}

/// D3: Get alternative search queries from AI
pub async fn get_alternative_queries(
    track: &SpotifyTrack,
    ollama_url: &str,
    ollama_model: &str,
) -> Result<AlternativeQueriesResult, ImportError> {
    let client = ollama::OllamaClient::with_config(ollama_url, ollama_model);
    let prompt = ollama::Prompts::alternative_queries(
        &track.track_name,
        &track.artist_name,
        &track.album_name,
    );

    client
        .generate_json(&prompt)
        .await
        .map_err(|e| ImportError::SearchError(format!("AI alternative queries failed: {}", e)))
}

/// D4: Assess match quality via AI
pub async fn assess_match_quality(
    track: &SpotifyTrack,
    youtube_title: &str,
    youtube_channel: &str,
    youtube_duration_sec: Option<i64>,
    ollama_url: &str,
    ollama_model: &str,
) -> Result<MatchQualityResult, ImportError> {
    let client = ollama::OllamaClient::with_config(ollama_url, ollama_model);
    let spotify_duration_sec = track.duration_ms.map(|ms| ms / 1000);

    let prompt = ollama::Prompts::assess_match_quality(
        &track.track_name,
        &track.artist_name,
        &track.album_name,
        spotify_duration_sec,
        youtube_title,
        youtube_channel,
        youtube_duration_sec,
    );

    client
        .generate_json(&prompt)
        .await
        .map_err(|e| ImportError::SearchError(format!("AI match quality assessment failed: {}", e)))
}

/// D5: Get similar track suggestions for NotFound tracks
pub async fn suggest_similar_tracks(
    track: &SpotifyTrack,
    ollama_url: &str,
    ollama_model: &str,
) -> Result<SimilarTrackSuggestion, ImportError> {
    let client = ollama::OllamaClient::with_config(ollama_url, ollama_model);
    let prompt = ollama::Prompts::suggest_similar_track(
        &track.track_name,
        &track.artist_name,
        &track.album_name,
    );

    client
        .generate_json(&prompt)
        .await
        .map_err(|e| ImportError::SearchError(format!("AI similar track suggestion failed: {}", e)))
}

/// D1 + D3 combined: Smart search with fallback to alternative queries
pub async fn search_youtube_for_track_smart_with_fallback(
    track: &SpotifyTrack,
    ollama_url: &str,
    ollama_model: &str,
) -> SmartImportResult {
    // First try smart search
    let result = search_youtube_for_track_smart(track, ollama_url, ollama_model).await;

    // If not found, try alternative queries
    if result.status == ImportStatus::NotFound {
        if let Ok(alt_queries) = get_alternative_queries(track, ollama_url, ollama_model).await {
            for query in &alt_queries.queries {
                if let Ok(yt_results) = ytdlp::search(query, 3).await {
                    if !yt_results.is_empty() {
                        let best = &yt_results[0];
                        let alternatives: Vec<Alternative> = yt_results
                            .iter()
                            .skip(1)
                            .take(3)
                            .map(|r| Alternative {
                                id: r.id.clone(),
                                title: r.title.clone(),
                                artist: r.artist.clone(),
                            })
                            .collect();

                        return SmartImportResult {
                            spotify_track: track.clone(),
                            youtube_id: Some(best.id.clone()),
                            youtube_title: Some(best.title.clone()),
                            status: ImportStatus::AlternativeFound,
                            confidence: MatchConfidence::Medium,
                            ai_reason: Some(format!(
                                "Found via alternative query: '{}'. {}",
                                query, alt_queries.likely_issue
                            )),
                            alternatives,
                            quality_score: 55,
                        };
                    }
                }
            }
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_exportify_csv_standard() {
        let csv = r#"Track Name,Artist Name(s),Album Name,Duration (ms),Spotify ID
"Song One","Artist One","Album One",200000,"spotify:id:1"
"Song Two","Artist Two","Album Two",180000,"spotify:id:2"
"Song Three","Artist Three","Album Three",240000,"spotify:id:3""#;

        let tracks = parse_exportify_csv(csv).expect("Failed to parse standard CSV");
        assert_eq!(tracks.len(), 3);

        assert_eq!(tracks[0].track_name, "Song One");
        assert_eq!(tracks[0].artist_name, "Artist One");
        assert_eq!(tracks[0].album_name, "Album One");
        assert_eq!(tracks[0].duration_ms, Some(200000));
        assert_eq!(tracks[0].spotify_id, Some("spotify:id:1".to_string()));

        assert_eq!(tracks[1].track_name, "Song Two");
        assert_eq!(tracks[2].track_name, "Song Three");
    }

    #[test]
    fn test_parse_empty_csv() {
        let err = parse_exportify_csv("").unwrap_err();
        let is_empty = matches!(&err, ImportError::ParseError(msg) if msg == "Empty CSV");
        assert!(is_empty, "Expected Empty CSV error, got: {:?}", err);
    }

    #[test]
    fn test_parse_csv_missing_columns() {
        let csv = "Name,Value\nSong,123\n";
        let err = parse_exportify_csv(csv).unwrap_err();
        let is_not_found =
            matches!(&err, ImportError::ParseError(msg) if msg.contains("Could not find"));
        assert!(
            is_not_found,
            "Expected column-not-found error, got: {:?}",
            err
        );
    }

    #[test]
    fn test_parse_csv_partial_data() {
        let csv = r#"Track Name,Artist Name(s),Album Name,Duration (ms)
"Song One","Artist One","Album One",300000
"Song Two","Artist Two",,
,,"Album Three",
"#;

        let tracks = parse_exportify_csv(csv).expect("Failed to parse partial CSV");
        // Row 1: fully populated → included
        // Row 2: missing album + duration → included with defaults
        // Row 3: empty track_name and artist_name → skipped
        assert_eq!(tracks.len(), 2, "Should skip rows with empty track/artist");

        assert_eq!(tracks[0].track_name, "Song One");
        assert_eq!(tracks[0].album_name, "Album One");
        assert_eq!(tracks[0].duration_ms, Some(300000));

        assert_eq!(tracks[1].track_name, "Song Two");
        assert_eq!(tracks[1].album_name, ""); // default
        assert!(tracks[1].duration_ms.is_none());
    }

    #[test]
    fn test_parse_csv_line_quoted_fields() {
        let line =
            r#""Song, feat. Artist","Artist, Jr.",1234,"https://open.spotify.com/track/abc""#;
        let fields = parse_csv_line(line);
        assert_eq!(fields.len(), 4, "Should parse 4 quoted fields");
        assert_eq!(fields[0], "Song, feat. Artist");
        assert_eq!(fields[1], "Artist, Jr.");
        assert_eq!(fields[2], "1234");
        assert_eq!(fields[3], "https://open.spotify.com/track/abc");

        // Unquoted simple line
        let simple = parse_csv_line("a,b,c");
        assert_eq!(simple, vec!["a", "b", "c"]);

        // Empty fields
        let empty = parse_csv_line("a,,c");
        assert_eq!(empty, vec!["a", "", "c"]);
    }

    #[test]
    fn test_find_column_index() {
        let headers = &["Track Name", "Artist Name(s)", "Album Name"];

        // Exact case-insensitive match
        let idx = find_column_index(headers, &["track name", "Name"]);
        assert_eq!(idx, Some(0));

        // Alternative name
        let idx = find_column_index(headers, &["Name", "Track Name"]);
        assert_eq!(idx, Some(0), "Should match second alternative");

        // No match
        let idx = find_column_index(headers, &["Duration"]);
        assert_eq!(idx, None);
    }

    #[test]
    fn test_spotify_track_serialization() {
        let track = SpotifyTrack {
            track_name: "Test Track".to_string(),
            artist_name: "Test Artist".to_string(),
            album_name: "Test Album".to_string(),
            duration_ms: Some(200000),
            spotify_id: Some("test:id".to_string()),
        };

        let json = serde_json::to_string(&track).expect("Failed to serialize");
        assert!(json.contains("Test Track"));
        assert!(json.contains("200000"));

        let deserialized: SpotifyTrack =
            serde_json::from_str(&json).expect("Failed to deserialize");
        assert_eq!(deserialized.track_name, track.track_name);
        assert_eq!(deserialized.artist_name, track.artist_name);
        assert_eq!(deserialized.duration_ms, track.duration_ms);
    }
}
