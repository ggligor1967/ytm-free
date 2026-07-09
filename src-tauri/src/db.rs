use crate::models::{
    DjTriggersEnabled, ListeningStats, PlayEvent, Playlist, Settings, Track, TrackEmbedding,
    TrackMetadataDB,
};
use rusqlite::{params, Connection, Result as SqliteResult};
use std::path::PathBuf;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum DbError {
    #[error("Database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Migration error: {0}")]
    Migration(String),
}

/// A database migration: version, description, and SQL to apply.
struct Migration {
    version: u32,
    description: &'static str,
    sql: &'static str,
}

/// Run all pending migrations on a connection.
/// Creates the `schema_migrations` tracking table if needed.
pub fn run_migrations(conn: &Connection) -> Result<(), DbError> {
    // Ensure the tracking table exists
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            description TEXT NOT NULL,
            applied_at TEXT DEFAULT CURRENT_TIMESTAMP
        );",
    )
    .map_err(|e| DbError::Migration(format!("Failed to create schema_migrations table: {}", e)))?;

    let migrations: Vec<Migration> = vec![
        Migration {
            version: 0,
            description: "initial schema",
            sql: MIGRATION_0_SQL,
        },
        // Version 1: "add analize_audio table" — TO BE IMPLEMENTED
        // This is where the analize_audio migration will go
    ];

    // Empty migration table means no migrations have run yet; version 0 must apply.
    let last_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), -1) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(|e| DbError::Migration(format!("Failed to read migration version: {}", e)))?;

    for migration in &migrations {
        if i64::from(migration.version) > last_version {
            conn.execute_batch(migration.sql).map_err(|e| {
                DbError::Migration(format!(
                    "Migration {} ({}): {}",
                    migration.version, migration.description, e
                ))
            })?;

            conn.execute(
                "INSERT INTO schema_migrations (version, description) VALUES (?1, ?2)",
                params![migration.version, migration.description],
            )
            .map_err(|e| {
                DbError::Migration(format!(
                    "Failed to record migration {}: {}",
                    migration.version, e
                ))
            })?;
        }
    }

    Ok(())
}

const MIGRATION_0_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    video_id TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    thumbnail TEXT,
    duration INTEGER,
    local_path TEXT,
    is_downloaded INTEGER DEFAULT 0,
    is_favorite INTEGER DEFAULT 0,
    play_count INTEGER DEFAULT 0,
    last_played TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    thumbnail TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id TEXT NOT NULL,
    track_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    added_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (playlist_id, track_id),
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    audio_quality TEXT DEFAULT 'best',
    download_path TEXT,
    auto_download INTEGER DEFAULT 0,
    theme TEXT DEFAULT 'dark',
    volume REAL DEFAULT 1.0,
    crossfade INTEGER DEFAULT 0,
    crossfade_duration INTEGER DEFAULT 3,
    ollama_enabled INTEGER DEFAULT 0,
    ollama_url TEXT DEFAULT 'http://localhost:11434',
    ollama_model TEXT DEFAULT 'mistral:7b',
    smart_search_enabled INTEGER DEFAULT 0,
    auto_tagging_enabled INTEGER DEFAULT 0,
    smart_queue_enabled INTEGER DEFAULT 0,
    daily_mix_enabled INTEGER DEFAULT 0,
    search_results_count INTEGER DEFAULT 25,
    dj_mode_enabled INTEGER DEFAULT 0,
    dj_style TEXT DEFAULT 'classic_fm',
    dj_language TEXT DEFAULT 'English',
    dj_frequency INTEGER DEFAULT 1,
    dj_triggers_enabled TEXT DEFAULT '{"track_start":true,"track_end":true,"queue_empty":true,"long_session":true,"first_track_of_day":true,"milestone":true,"time_announcement":true,"mood_shift":true}',
    semantic_search_enabled INTEGER DEFAULT 0,
    embedding_model TEXT DEFAULT 'all-minilm',
    tts_engine TEXT DEFAULT 'web_speech',
    dj_voice TEXT DEFAULT '',
    dj_pitch REAL DEFAULT 1.0,
    dj_rate REAL DEFAULT 1.05
);

INSERT OR IGNORE INTO settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS track_metadata (
    track_id TEXT PRIMARY KEY,
    genre TEXT,
    sub_genre TEXT,
    mood TEXT,
    energy_level INTEGER,
    tempo TEXT,
    danceability REAL,
    vocal_type TEXT,
    decade TEXT,
    language TEXT,
    activity_tags TEXT,
    occasion_tags TEXT,
    keywords TEXT,
    ai_description TEXT,
    analyzed_at TEXT DEFAULT CURRENT_TIMESTAMP,
    model_used TEXT,
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS play_history (
    id TEXT PRIMARY KEY,
    track_id TEXT NOT NULL,
    played_at TEXT DEFAULT CURRENT_TIMESTAMP,
    duration_listened INTEGER,
    context TEXT,
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_cache (
    id TEXT PRIMARY KEY,
    prompt_hash TEXT UNIQUE NOT NULL,
    response TEXT NOT NULL,
    model TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    ttl_seconds INTEGER DEFAULT 86400
);

CREATE TABLE IF NOT EXISTS track_embeddings (
    track_id TEXT PRIMARY KEY,
    embedding BLOB NOT NULL,
    text_used TEXT NOT NULL,
    model_used TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tracks_video_id ON tracks(video_id);
CREATE INDEX IF NOT EXISTS idx_tracks_favorite ON tracks(is_favorite);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id);
CREATE INDEX IF NOT EXISTS idx_track_metadata_genre ON track_metadata(genre);
CREATE INDEX IF NOT EXISTS idx_track_metadata_mood ON track_metadata(mood);
CREATE INDEX IF NOT EXISTS idx_track_metadata_energy ON track_metadata(energy_level);
CREATE INDEX IF NOT EXISTS idx_track_metadata_tempo ON track_metadata(tempo);
CREATE INDEX IF NOT EXISTS idx_track_metadata_decade ON track_metadata(decade);
CREATE INDEX IF NOT EXISTS idx_track_metadata_model ON track_metadata(model_used);
CREATE INDEX IF NOT EXISTS idx_track_embeddings_model ON track_embeddings(model_used);
CREATE INDEX IF NOT EXISTS idx_track_embeddings_track_id ON track_embeddings(track_id);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track ON playlist_tracks(track_id);
CREATE INDEX IF NOT EXISTS idx_play_history_track ON play_history(track_id);
CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at);
CREATE INDEX IF NOT EXISTS idx_play_history_date ON play_history(played_at);
CREATE INDEX IF NOT EXISTS idx_ai_cache_hash ON ai_cache(prompt_hash);
"#;

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new() -> Result<Self, DbError> {
        let db_path = Self::get_db_path()?;

        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&db_path)?;
        let db = Self { conn };
        run_migrations(&db.conn)?;
        Ok(db)
    }

    /// Create an in-memory database (used for testing and ephemeral operations)
    pub fn in_memory() -> Result<Self, DbError> {
        let conn = Connection::open_in_memory()?;
        let db = Self { conn };
        run_migrations(&db.conn)?;
        Ok(db)
    }

    fn get_db_path() -> Result<PathBuf, DbError> {
        // Allow overriding the app data directory for isolated runs (e.g. release
        // runtime smoke) via the YTM_FREE_DATA_DIR environment variable. When set
        // and non-empty, the SQLite database lives directly in that directory.
        // When unset or empty, the default dirs::data_dir()/ytm-free path is used.
        if let Some(dir) = std::env::var_os("YTM_FREE_DATA_DIR") {
            if !dir.is_empty() {
                return Ok(PathBuf::from(dir).join("ytm-free.db"));
            }
        }
        let data_dir = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("ytm-free");
        Ok(data_dir.join("ytm-free.db"))
    }

    // ========================================================================
    // TRACKS
    // ========================================================================

    pub fn add_track(
        &self,
        video_id: &str,
        title: &str,
        artist: &str,
        thumbnail: &str,
        local_path: Option<&str>,
    ) -> Result<Track, DbError> {
        let id = uuid::Uuid::new_v4().to_string();
        let is_downloaded = local_path.is_some();

        self.conn.execute(
            r#"
            INSERT INTO tracks (id, video_id, title, artist, thumbnail, local_path, is_downloaded)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(video_id) DO UPDATE SET
                title = excluded.title,
                artist = excluded.artist,
                thumbnail = excluded.thumbnail,
                local_path = COALESCE(excluded.local_path, tracks.local_path),
                is_downloaded = CASE WHEN excluded.local_path IS NOT NULL THEN 1 ELSE tracks.is_downloaded END
            "#,
            params![id, video_id, title, artist, thumbnail, local_path, is_downloaded],
        )?;

        self.get_track_by_video_id(video_id)
    }

    pub fn get_track_by_video_id(&self, video_id: &str) -> Result<Track, DbError> {
        self.conn
            .query_row(
                "SELECT * FROM tracks WHERE video_id = ?1",
                params![video_id],
                |row| Self::row_to_track(row),
            )
            .map_err(|_| DbError::NotFound(format!("Track not found: {}", video_id)))
    }

    pub fn get_track_by_uuid(&self, uuid: &str) -> Result<Track, DbError> {
        self.conn
            .query_row("SELECT * FROM tracks WHERE id = ?1", params![uuid], |row| {
                Self::row_to_track(row)
            })
            .map_err(|_| DbError::NotFound(format!("Track not found by UUID: {}", uuid)))
    }

    pub fn get_all_tracks(&self) -> Result<Vec<Track>, DbError> {
        let mut stmt = self
            .conn
            .prepare("SELECT * FROM tracks ORDER BY created_at DESC")?;
        let tracks = stmt
            .query_map([], |row| Self::row_to_track(row))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(tracks)
    }

    pub fn get_downloaded_tracks(&self) -> Result<Vec<Track>, DbError> {
        let mut stmt = self
            .conn
            .prepare("SELECT * FROM tracks WHERE is_downloaded = 1 ORDER BY created_at DESC")?;
        let tracks = stmt
            .query_map([], |row| Self::row_to_track(row))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(tracks)
    }

    pub fn get_recently_played(&self, limit: i64) -> Result<Vec<Track>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT * FROM tracks WHERE last_played IS NOT NULL ORDER BY last_played DESC LIMIT ?1",
        )?;
        let tracks = stmt
            .query_map(params![limit], |row| Self::row_to_track(row))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(tracks)
    }

    pub fn get_favorites(&self) -> Result<Vec<Track>, DbError> {
        let mut stmt = self
            .conn
            .prepare("SELECT * FROM tracks WHERE is_favorite = 1 ORDER BY created_at DESC")?;
        let tracks = stmt
            .query_map([], |row| Self::row_to_track(row))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(tracks)
    }

    pub fn get_total_play_count(&self) -> Result<u32, DbError> {
        self.conn
            .query_row(
                "SELECT COALESCE(SUM(play_count), 0) FROM tracks",
                [],
                |row| row.get(0),
            )
            .map_err(DbError::from)
    }

    pub fn update_play_count(&self, video_id: &str) -> Result<(), DbError> {
        self.conn.execute(
            "UPDATE tracks SET play_count = play_count + 1, last_played = CURRENT_TIMESTAMP WHERE video_id = ?1",
            params![video_id],
        )?;
        // Also log a play event for analytics
        let track_id: Result<String, _> = self.conn.query_row(
            "SELECT id FROM tracks WHERE video_id = ?1",
            params![video_id],
            |row| row.get(0),
        );
        if let Ok(tid) = track_id {
            let _ = self.log_play_event(&tid, None, None);
        }
        Ok(())
    }

    pub fn update_track_duration(&self, video_id: &str, duration: i64) -> Result<(), DbError> {
        self.conn.execute(
            "UPDATE tracks SET duration = ?1 WHERE video_id = ?2",
            params![duration, video_id],
        )?;
        Ok(())
    }

    pub fn toggle_favorite(&self, video_id: &str) -> Result<bool, DbError> {
        self.conn.execute(
            "UPDATE tracks SET is_favorite = NOT is_favorite WHERE video_id = ?1",
            params![video_id],
        )?;

        let is_favorite: bool = self.conn.query_row(
            "SELECT is_favorite FROM tracks WHERE video_id = ?1",
            params![video_id],
            |row| row.get(0),
        )?;

        Ok(is_favorite)
    }

    fn row_to_track(row: &rusqlite::Row) -> SqliteResult<Track> {
        Ok(Track {
            id: row.get("id")?,
            video_id: row.get("video_id")?,
            title: row.get("title")?,
            artist: row.get("artist")?,
            thumbnail: row.get("thumbnail")?,
            duration: row.get("duration")?,
            local_path: row.get("local_path")?,
            is_downloaded: row.get::<_, i64>("is_downloaded")? == 1,
            is_favorite: row.get::<_, i64>("is_favorite")? == 1,
            play_count: row.get("play_count")?,
            last_played: row.get("last_played")?,
            created_at: row.get("created_at")?,
        })
    }

    // ========================================================================
    // PLAYLISTS
    // ========================================================================

    pub fn create_playlist(
        &self,
        name: &str,
        description: Option<&str>,
    ) -> Result<Playlist, DbError> {
        let id = uuid::Uuid::new_v4().to_string();

        self.conn.execute(
            "INSERT INTO playlists (id, name, description) VALUES (?1, ?2, ?3)",
            params![id, name, description],
        )?;

        self.get_playlist(&id)
    }

    pub fn get_playlist(&self, id: &str) -> Result<Playlist, DbError> {
        self.conn
            .query_row(
                r#"
                SELECT p.*, COUNT(pt.track_id) as track_count
                FROM playlists p
                LEFT JOIN playlist_tracks pt ON p.id = pt.playlist_id
                WHERE p.id = ?1
                GROUP BY p.id
                "#,
                params![id],
                |row| Self::row_to_playlist(row),
            )
            .map_err(|_| DbError::NotFound(format!("Playlist not found: {}", id)))
    }

    pub fn get_playlists(&self) -> Result<Vec<Playlist>, DbError> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT p.*, COUNT(pt.track_id) as track_count
            FROM playlists p
            LEFT JOIN playlist_tracks pt ON p.id = pt.playlist_id
            GROUP BY p.id
            ORDER BY p.updated_at DESC
            "#,
        )?;

        let playlists = stmt
            .query_map([], |row| Self::row_to_playlist(row))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(playlists)
    }

    pub fn update_playlist(
        &self,
        id: &str,
        name: &str,
        description: Option<&str>,
    ) -> Result<Playlist, DbError> {
        self.conn.execute(
            "UPDATE playlists SET name = ?1, description = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?3",
            params![name, description, id],
        )?;
        self.get_playlist(id)
    }

    pub fn delete_playlist(&self, id: &str) -> Result<(), DbError> {
        self.conn
            .execute("DELETE FROM playlists WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn add_track_to_playlist(&self, playlist_id: &str, track_id: &str) -> Result<(), DbError> {
        // Get next position
        let position: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM playlist_tracks WHERE playlist_id = ?1",
            params![playlist_id],
            |row| row.get(0),
        )?;

        self.conn.execute(
            "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, ?3)",
            params![playlist_id, track_id, position],
        )?;

        // Update playlist timestamp
        self.conn.execute(
            "UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
            params![playlist_id],
        )?;

        Ok(())
    }

    pub fn remove_track_from_playlist(
        &self,
        playlist_id: &str,
        track_id: &str,
    ) -> Result<(), DbError> {
        self.conn.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
            params![playlist_id, track_id],
        )?;
        Ok(())
    }

    pub fn get_playlist_tracks(&self, playlist_id: &str) -> Result<Vec<Track>, DbError> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT t.*
            FROM tracks t
            JOIN playlist_tracks pt ON t.id = pt.track_id
            WHERE pt.playlist_id = ?1
            ORDER BY pt.position
            "#,
        )?;

        let tracks = stmt
            .query_map(params![playlist_id], |row| Self::row_to_track(row))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(tracks)
    }

    fn row_to_playlist(row: &rusqlite::Row) -> SqliteResult<Playlist> {
        Ok(Playlist {
            id: row.get("id")?,
            name: row.get("name")?,
            description: row.get("description")?,
            thumbnail: row.get("thumbnail")?,
            track_count: row.get("track_count")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }

    // ========================================================================
    // SETTINGS
    // ========================================================================

    pub fn get_settings(&self) -> Result<Settings, DbError> {
        let default_path = Settings::default().download_path;

        self.conn
            .query_row("SELECT * FROM settings WHERE id = 1", [], |row| {
                let triggers_json = row.get::<_, Option<String>>("dj_triggers_enabled")?
                    .unwrap_or_else(|| r#"{"track_start":true,"track_end":true,"queue_empty":true,"long_session":true,"first_track_of_day":true,"milestone":true,"time_announcement":true,"mood_shift":true}"#.to_string());

                let dj_triggers_enabled = serde_json::from_str(&triggers_json)
                    .unwrap_or_else(|_| DjTriggersEnabled::default());

                Ok(Settings {
                    audio_quality: row.get::<_, Option<String>>("audio_quality")?.unwrap_or_else(|| "best".to_string()),
                    download_path: row.get::<_, Option<String>>("download_path")?.unwrap_or(default_path),
                    auto_download: row.get::<_, Option<i64>>("auto_download")?.unwrap_or(0) == 1,
                    theme: row.get::<_, Option<String>>("theme")?.unwrap_or_else(|| "dark".to_string()),
                    volume: row.get::<_, Option<f64>>("volume")?.unwrap_or(1.0),
                    crossfade: row.get::<_, Option<i64>>("crossfade")?.unwrap_or(0) == 1,
                    crossfade_duration: row.get::<_, Option<i64>>("crossfade_duration")?.unwrap_or(3),
                    ollama_enabled: row.get::<_, Option<i64>>("ollama_enabled")?.unwrap_or(0) == 1,
                    ollama_url: row.get::<_, Option<String>>("ollama_url")?.unwrap_or_else(|| "http://localhost:11434".to_string()),
                    ollama_model: row.get::<_, Option<String>>("ollama_model")?.unwrap_or_else(|| "mistral:7b".to_string()),
                    smart_search_enabled: row.get::<_, Option<i64>>("smart_search_enabled")?.unwrap_or(0) == 1,
                    auto_tagging_enabled: row.get::<_, Option<i64>>("auto_tagging_enabled")?.unwrap_or(0) == 1,
                    smart_queue_enabled: row.get::<_, Option<i64>>("smart_queue_enabled")?.unwrap_or(0) == 1,
                    daily_mix_enabled: row.get::<_, Option<i64>>("daily_mix_enabled")?.unwrap_or(0) == 1,
                    search_results_count: row.get::<_, Option<i64>>("search_results_count")?.unwrap_or(25),
                    dj_mode_enabled: row.get::<_, Option<i64>>("dj_mode_enabled")?.unwrap_or(0) == 1,
                    dj_style: row.get::<_, Option<String>>("dj_style")?.unwrap_or_else(|| "classic_fm".to_string()),
                    dj_language: row.get::<_, Option<String>>("dj_language")?.unwrap_or_else(|| "English".to_string()),
                    dj_frequency: row.get::<_, Option<i64>>("dj_frequency")?.unwrap_or(1),
                    dj_triggers_enabled,
                    semantic_search_enabled: row.get::<_, Option<i64>>("semantic_search_enabled")?.unwrap_or(0) == 1,
                    embedding_model: row.get::<_, Option<String>>("embedding_model")?.unwrap_or_else(|| "all-minilm".to_string()),
                    tts_engine: row.get::<_, Option<String>>("tts_engine")?.unwrap_or_else(|| "web_speech".to_string()),
                    dj_voice: row.get::<_, Option<String>>("dj_voice")?.unwrap_or_default(),
                    dj_pitch: row.get::<_, Option<f64>>("dj_pitch")?.unwrap_or(1.0),
                    dj_rate: row.get::<_, Option<f64>>("dj_rate")?.unwrap_or(1.05),
                })
            })
            .map_err(|e| DbError::Sqlite(e))
    }

    pub fn update_settings(&self, settings: &Settings) -> Result<(), DbError> {
        let triggers_json = serde_json::to_string(&settings.dj_triggers_enabled)
            .unwrap_or_else(|_| r#"{"track_start":true,"track_end":true,"queue_empty":true,"long_session":true,"first_track_of_day":true,"milestone":true,"time_announcement":true,"mood_shift":true}"#.to_string());

        self.conn.execute(
            r#"
            UPDATE settings SET
                audio_quality = ?1,
                download_path = ?2,
                auto_download = ?3,
                theme = ?4,
                volume = ?5,
                crossfade = ?6,
                crossfade_duration = ?7,
                ollama_enabled = ?8,
                ollama_url = ?9,
                ollama_model = ?10,
                smart_search_enabled = ?11,
                auto_tagging_enabled = ?12,
                smart_queue_enabled = ?13,
                daily_mix_enabled = ?14,
                search_results_count = ?15,
                dj_mode_enabled = ?16,
                dj_style = ?17,
                dj_language = ?18,
                dj_frequency = ?19,
                dj_triggers_enabled = ?20,
                semantic_search_enabled = ?21,
                embedding_model = ?22,
                tts_engine = ?23,
                dj_voice = ?24,
                dj_pitch = ?25,
                dj_rate = ?26
            WHERE id = 1
            "#,
            params![
                settings.audio_quality,
                settings.download_path,
                settings.auto_download,
                settings.theme,
                settings.volume,
                settings.crossfade,
                settings.crossfade_duration,
                settings.ollama_enabled,
                settings.ollama_url,
                settings.ollama_model,
                settings.smart_search_enabled,
                settings.auto_tagging_enabled,
                settings.smart_queue_enabled,
                settings.daily_mix_enabled,
                settings.search_results_count,
                settings.dj_mode_enabled,
                settings.dj_style,
                settings.dj_language,
                settings.dj_frequency,
                triggers_json,
                settings.semantic_search_enabled,
                settings.embedding_model,
                settings.tts_engine,
                settings.dj_voice,
                settings.dj_pitch,
                settings.dj_rate,
            ],
        )?;
        Ok(())
    }

    // ========================================================================
    // SMART AI - TRACK METADATA
    // ========================================================================

    pub fn save_track_metadata(
        &self,
        track_id: &str,
        metadata: &crate::ollama::TrackMetadataAI,
        model: &str,
    ) -> Result<(), DbError> {
        let activity_tags = serde_json::to_string(&metadata.activity_tags).unwrap_or_default();
        let occasion_tags = serde_json::to_string(&metadata.occasion_tags).unwrap_or_default();
        let keywords = serde_json::to_string(&metadata.keywords).unwrap_or_default();

        self.conn.execute(
            r#"
            INSERT OR REPLACE INTO track_metadata (
                track_id, genre, sub_genre, mood, energy_level, tempo,
                danceability, vocal_type, decade, language,
                activity_tags, occasion_tags, keywords, model_used
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            "#,
            params![
                track_id,
                metadata.genre,
                metadata.sub_genre,
                metadata.mood,
                metadata.energy_level,
                metadata.tempo,
                metadata.danceability,
                metadata.vocal_type,
                metadata.decade,
                metadata.language,
                activity_tags,
                occasion_tags,
                keywords,
                model,
            ],
        )?;
        Ok(())
    }

    pub fn get_track_metadata(&self, track_id: &str) -> Result<TrackMetadataDB, DbError> {
        self.conn
            .query_row(
                r#"SELECT track_id, genre, sub_genre, mood, energy_level, tempo,
                    CAST(danceability AS REAL) as danceability,
                    vocal_type, decade, language, activity_tags, occasion_tags,
                    keywords, ai_description, analyzed_at, model_used
                FROM track_metadata WHERE track_id = ?1"#,
                params![track_id],
                |row| {
                    Ok(TrackMetadataDB {
                        track_id: row.get("track_id")?,
                        genre: row.get("genre")?,
                        sub_genre: row.get("sub_genre")?,
                        mood: row.get("mood")?,
                        energy_level: row.get("energy_level")?,
                        tempo: row.get("tempo")?,
                        danceability: row.get("danceability")?,
                        vocal_type: row.get("vocal_type")?,
                        decade: row.get("decade")?,
                        language: row.get("language")?,
                        activity_tags: row.get("activity_tags")?,
                        occasion_tags: row.get("occasion_tags")?,
                        keywords: row.get("keywords")?,
                        ai_description: row.get("ai_description")?,
                        analyzed_at: row.get("analyzed_at")?,
                        model_used: row.get("model_used")?,
                    })
                },
            )
            .map_err(|e| {
                DbError::NotFound(format!(
                    "Metadata not found for track: {} ({})",
                    track_id, e
                ))
            })
    }

    pub fn get_tracks_by_mood(&self, mood: &str) -> Result<Vec<Track>, DbError> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT t.* FROM tracks t
            JOIN track_metadata m ON t.id = m.track_id
            WHERE m.mood = ?1
            ORDER BY t.created_at DESC
            "#,
        )?;
        let tracks = stmt
            .query_map(params![mood], |row| Self::row_to_track(row))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(tracks)
    }

    pub fn get_tracks_by_genre(&self, genre: &str) -> Result<Vec<Track>, DbError> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT t.* FROM tracks t
            JOIN track_metadata m ON t.id = m.track_id
            WHERE m.genre = ?1
            ORDER BY t.created_at DESC
            "#,
        )?;
        let tracks = stmt
            .query_map(params![genre], |row| Self::row_to_track(row))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(tracks)
    }

    pub fn get_tracks_by_energy_range(&self, min: i32, max: i32) -> Result<Vec<Track>, DbError> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT t.* FROM tracks t
            JOIN track_metadata m ON t.id = m.track_id
            WHERE m.energy_level BETWEEN ?1 AND ?2
            ORDER BY m.energy_level DESC
            "#,
        )?;
        let tracks = stmt
            .query_map(params![min, max], |row| Self::row_to_track(row))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(tracks)
    }

    /// Get all tracks that have AI metadata, returning track + metadata pairs
    pub fn get_all_tracks_with_metadata(&self) -> Result<Vec<(Track, TrackMetadataDB)>, DbError> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT t.id, t.video_id, t.title, t.artist, t.thumbnail, t.duration,
                   t.local_path, t.is_downloaded, t.is_favorite, t.play_count,
                   t.last_played, t.created_at,
                   m.track_id as m_track_id, m.genre, m.sub_genre, m.mood, m.energy_level,
                   m.tempo, CAST(m.danceability AS REAL) as danceability,
                   m.vocal_type, m.decade, m.language,
                   m.activity_tags, m.occasion_tags, m.keywords, m.ai_description,
                   m.analyzed_at, m.model_used
            FROM tracks t
            JOIN track_metadata m ON t.id = m.track_id
            ORDER BY t.created_at DESC
            "#,
        )?;
        let results = stmt
            .query_map([], |row| {
                let track = Track {
                    id: row.get("id")?,
                    video_id: row.get("video_id")?,
                    title: row.get("title")?,
                    artist: row.get("artist")?,
                    thumbnail: row.get("thumbnail")?,
                    duration: row.get("duration")?,
                    local_path: row.get("local_path")?,
                    is_downloaded: row.get("is_downloaded")?,
                    is_favorite: row.get("is_favorite")?,
                    play_count: row.get("play_count")?,
                    last_played: row.get("last_played")?,
                    created_at: row.get("created_at")?,
                };
                let metadata = TrackMetadataDB {
                    track_id: row.get("m_track_id")?,
                    genre: row.get("genre")?,
                    sub_genre: row.get("sub_genre")?,
                    mood: row.get("mood")?,
                    energy_level: row.get("energy_level")?,
                    tempo: row.get("tempo")?,
                    danceability: row.get("danceability")?,
                    vocal_type: row.get("vocal_type")?,
                    decade: row.get("decade")?,
                    language: row.get("language")?,
                    activity_tags: row.get("activity_tags")?,
                    occasion_tags: row.get("occasion_tags")?,
                    keywords: row.get("keywords")?,
                    ai_description: row.get("ai_description")?,
                    analyzed_at: row.get("analyzed_at")?,
                    model_used: row.get("model_used")?,
                };
                Ok((track, metadata))
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(results)
    }

    /// Get unique genre and mood values from metadata for AI context
    pub fn get_unique_metadata_values(&self) -> Result<(Vec<String>, Vec<String>), DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT genre FROM track_metadata WHERE genre IS NOT NULL ORDER BY genre",
        )?;
        let genres: Vec<String> = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT mood FROM track_metadata WHERE mood IS NOT NULL ORDER BY mood",
        )?;
        let moods: Vec<String> = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        Ok((genres, moods))
    }

    pub fn get_unanalyzed_tracks(&self) -> Result<Vec<Track>, DbError> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT t.* FROM tracks t
            LEFT JOIN track_metadata m ON t.id = m.track_id
            WHERE m.track_id IS NULL
            ORDER BY t.created_at DESC
            "#,
        )?;
        let tracks = stmt
            .query_map([], |row| Self::row_to_track(row))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(tracks)
    }

    // ========================================================================
    // SMART AI - PLAY HISTORY
    // ========================================================================

    pub fn log_play_event(
        &self,
        track_id: &str,
        duration_listened: Option<i64>,
        context: Option<&str>,
    ) -> Result<(), DbError> {
        let id = uuid::Uuid::new_v4().to_string();
        self.conn.execute(
            "INSERT INTO play_history (id, track_id, duration_listened, context) VALUES (?1, ?2, ?3, ?4)",
            params![id, track_id, duration_listened, context],
        )?;
        Ok(())
    }

    pub fn get_play_history(&self, days_back: i64, limit: i64) -> Result<Vec<PlayEvent>, DbError> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT * FROM play_history
            WHERE datetime(played_at) >= datetime('now', '-' || ?1 || ' days')
            ORDER BY played_at DESC
            LIMIT ?2
            "#,
        )?;
        let events = stmt
            .query_map(params![days_back, limit], |row| {
                Ok(PlayEvent {
                    id: row.get("id")?,
                    track_id: row.get("track_id")?,
                    played_at: row.get("played_at")?,
                    duration_listened: row.get("duration_listened")?,
                    context: row.get("context")?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(events)
    }

    pub fn get_listening_stats(&self, days_back: i64) -> Result<ListeningStats, DbError> {
        // Total tracks
        let total_tracks: i64 = self.conn.query_row(
            r#"
            SELECT COUNT(DISTINCT track_id) FROM play_history
            WHERE datetime(played_at) >= datetime('now', '-' || ?1 || ' days')
            "#,
            params![days_back],
            |row| row.get(0),
        )?;

        // Total time (use duration of tracks if available)
        let total_time_seconds: i64 = self
            .conn
            .query_row(
                r#"
            SELECT COALESCE(SUM(t.duration), 0) FROM play_history ph
            JOIN tracks t ON ph.track_id = t.id
            WHERE datetime(ph.played_at) >= datetime('now', '-' || ?1 || ' days')
            "#,
                params![days_back],
                |row| row.get(0),
            )
            .unwrap_or(0);

        // Top genres
        let mut stmt = self.conn.prepare(
            r#"
            SELECT m.genre, COUNT(*) as count FROM play_history ph
            JOIN track_metadata m ON ph.track_id = m.track_id
            WHERE datetime(ph.played_at) >= datetime('now', '-' || ?1 || ' days')
            AND m.genre IS NOT NULL
            GROUP BY m.genre
            ORDER BY count DESC
            LIMIT 5
            "#,
        )?;
        let top_genres: Vec<(String, i64)> = stmt
            .query_map(params![days_back], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();

        // Top artists
        let mut stmt = self.conn.prepare(
            r#"
            SELECT t.artist, COUNT(*) as count FROM play_history ph
            JOIN tracks t ON ph.track_id = t.id
            WHERE datetime(ph.played_at) >= datetime('now', '-' || ?1 || ' days')
            GROUP BY t.artist
            ORDER BY count DESC
            LIMIT 5
            "#,
        )?;
        let top_artists: Vec<(String, i64)> = stmt
            .query_map(params![days_back], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();

        // Top moods
        let mut stmt = self.conn.prepare(
            r#"
            SELECT m.mood, COUNT(*) as count FROM play_history ph
            JOIN track_metadata m ON ph.track_id = m.track_id
            WHERE datetime(ph.played_at) >= datetime('now', '-' || ?1 || ' days')
            AND m.mood IS NOT NULL
            GROUP BY m.mood
            ORDER BY count DESC
            LIMIT 5
            "#,
        )?;
        let top_moods: Vec<(String, i64)> = stmt
            .query_map(params![days_back], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();

        // Daily breakdown
        let mut stmt = self.conn.prepare(
            r#"
            SELECT DATE(played_at) as day, COUNT(*) as count FROM play_history
            WHERE datetime(played_at) >= datetime('now', '-' || ?1 || ' days')
            GROUP BY day
            ORDER BY day DESC
            "#,
        )?;
        let daily_breakdown: Vec<(String, i64)> = stmt
            .query_map(params![days_back], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(ListeningStats {
            total_tracks,
            total_time_seconds,
            top_genres,
            top_artists,
            top_moods,
            daily_breakdown,
        })
    }

    // ========================================================================
    // SMART AI - CACHE
    // ========================================================================

    pub fn cache_ai_response(
        &self,
        prompt_hash: &str,
        response: &str,
        model: &str,
        ttl: i64,
    ) -> Result<(), DbError> {
        let id = uuid::Uuid::new_v4().to_string();
        self.conn.execute(
            "INSERT OR REPLACE INTO ai_cache (id, prompt_hash, response, model, ttl_seconds) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, prompt_hash, response, model, ttl],
        )?;
        Ok(())
    }

    pub fn get_cached_response(&self, prompt_hash: &str) -> Result<String, DbError> {
        let result = self.conn.query_row(
            r#"
            SELECT response FROM ai_cache
            WHERE prompt_hash = ?1
            AND datetime(created_at, '+' || ttl_seconds || ' seconds') > datetime('now')
            "#,
            params![prompt_hash],
            |row| row.get(0),
        );

        match result {
            Ok(response) => Ok(response),
            Err(_) => Err(DbError::NotFound(
                "Cache entry not found or expired".to_string(),
            )),
        }
    }

    pub fn cleanup_expired_cache(&self) -> Result<(), DbError> {
        self.conn.execute(
            "DELETE FROM ai_cache WHERE datetime(created_at, '+' || ttl_seconds || ' seconds') <= datetime('now')",
            [],
        )?;
        Ok(())
    }

    // ========================================================================
    // TRACK EMBEDDINGS (SEMANTIC SEARCH)
    // ========================================================================

    pub fn save_embedding(
        &self,
        track_id: &str,
        embedding: &[f32],
        text_used: &str,
        model_used: &str,
        dimensions: i32,
    ) -> Result<(), DbError> {
        let bytes: Vec<u8> = embedding.iter().flat_map(|f| f.to_le_bytes()).collect();

        self.conn.execute(
            r#"
            INSERT OR REPLACE INTO track_embeddings (track_id, embedding, text_used, model_used, dimensions, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP)
            "#,
            params![track_id, bytes, text_used, model_used, dimensions],
        )?;
        Ok(())
    }

    pub fn get_embedding(&self, track_id: &str) -> Result<Option<TrackEmbedding>, DbError> {
        let result = self.conn.query_row(
            "SELECT track_id, embedding, text_used, model_used, dimensions, created_at FROM track_embeddings WHERE track_id = ?1",
            params![track_id],
            |row| {
                let blob: Vec<u8> = row.get("embedding")?;
                let embedding: Vec<f32> = blob
                    .chunks_exact(4)
                    .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
                    .collect();

                Ok(TrackEmbedding {
                    track_id: row.get("track_id")?,
                    embedding,
                    text_used: row.get("text_used")?,
                    model_used: row.get("model_used")?,
                    dimensions: row.get("dimensions")?,
                    created_at: row.get("created_at")?,
                })
            },
        );

        match result {
            Ok(embedding) => Ok(Some(embedding)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(DbError::Sqlite(e)),
        }
    }

    pub fn get_all_embeddings(&self) -> Result<Vec<TrackEmbedding>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT track_id, embedding, text_used, model_used, dimensions, created_at FROM track_embeddings ORDER BY created_at DESC",
        )?;

        let embeddings = stmt
            .query_map([], |row| {
                let blob: Vec<u8> = row.get("embedding")?;
                let embedding: Vec<f32> = blob
                    .chunks_exact(4)
                    .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
                    .collect();

                Ok(TrackEmbedding {
                    track_id: row.get("track_id")?,
                    embedding,
                    text_used: row.get("text_used")?,
                    model_used: row.get("model_used")?,
                    dimensions: row.get("dimensions")?,
                    created_at: row.get("created_at")?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(embeddings)
    }

    pub fn delete_embedding(&self, track_id: &str) -> Result<(), DbError> {
        self.conn.execute(
            "DELETE FROM track_embeddings WHERE track_id = ?1",
            params![track_id],
        )?;
        Ok(())
    }

    pub fn delete_all_embeddings(&self) -> Result<(), DbError> {
        self.conn.execute("DELETE FROM track_embeddings", [])?;
        Ok(())
    }

    pub fn clear_embeddings(&self) -> Result<(), DbError> {
        self.conn.execute("DELETE FROM track_embeddings", [])?;
        Ok(())
    }

    pub fn count_embeddings(&self) -> Result<i64, DbError> {
        self.conn
            .query_row("SELECT COUNT(*) FROM track_embeddings", [], |row| {
                row.get(0)
            })
            .map_err(|e| DbError::Sqlite(e))
    }

    // ========================================================================
    // INSIGHTS & ANALYTICS (FAZA 6)
    // ========================================================================

    /// Get tracks never played or not played in a long time ("forgotten gems") [F6]
    pub fn get_forgotten_gems(
        &self,
        min_days_unplayed: i64,
        limit: i64,
    ) -> Result<Vec<Track>, DbError> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT t.* FROM tracks t
            WHERE (t.last_played IS NULL OR datetime(t.last_played) < datetime('now', '-' || ?1 || ' days'))
            AND t.play_count > 0
            ORDER BY t.play_count DESC, t.created_at ASC
            LIMIT ?2
            "#,
        )?;
        let tracks = stmt
            .query_map(params![min_days_unplayed, limit], |row| {
                Self::row_to_track(row)
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(tracks)
    }

    /// Get hourly breakdown for time patterns [F3]
    pub fn get_hourly_stats(&self, days_back: i64) -> Result<Vec<(i32, i64)>, DbError> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT CAST(strftime('%H', played_at) AS INTEGER) as hour, COUNT(*) as count
            FROM play_history
            WHERE datetime(played_at) >= datetime('now', '-' || ?1 || ' days')
            GROUP BY hour
            ORDER BY hour
            "#,
        )?;
        let stats = stmt
            .query_map(params![days_back], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(stats)
    }

    /// Get total play count across time for streak calculation [F7]
    pub fn get_listening_streak(&self) -> Result<i64, DbError> {
        // Count consecutive days with plays ending today
        let mut stmt = self.conn.prepare(
            r#"
            SELECT DISTINCT DATE(played_at) as day FROM play_history
            ORDER BY day DESC
            LIMIT 365
            "#,
        )?;
        let days: Vec<String> = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        if days.is_empty() {
            return Ok(0);
        }

        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        // If the most recent day isn't today or yesterday, streak is 0
        if days[0] != today {
            let yesterday = (chrono::Local::now() - chrono::Duration::days(1))
                .format("%Y-%m-%d")
                .to_string();
            if days[0] != yesterday {
                return Ok(0);
            }
        }

        let mut streak = 1i64;
        for i in 1..days.len() {
            if let (Ok(d1), Ok(d2)) = (
                chrono::NaiveDate::parse_from_str(&days[i - 1], "%Y-%m-%d"),
                chrono::NaiveDate::parse_from_str(&days[i], "%Y-%m-%d"),
            ) {
                if (d1 - d2).num_days() == 1 {
                    streak += 1;
                } else {
                    break;
                }
            } else {
                break;
            }
        }
        Ok(streak)
    }

    /// Get tracks with play counts for top-tracks insight
    pub fn get_top_tracks(&self, days_back: i64, limit: i64) -> Result<Vec<(Track, i64)>, DbError> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT t.*, COUNT(ph.id) as play_count_period
            FROM play_history ph
            JOIN tracks t ON ph.track_id = t.id
            WHERE datetime(ph.played_at) >= datetime('now', '-' || ?1 || ' days')
            GROUP BY t.id
            ORDER BY play_count_period DESC
            LIMIT ?2
            "#,
        )?;
        let tracks = stmt
            .query_map(params![days_back, limit], |row| {
                let track = Self::row_to_track(row)?;
                let count: i64 = row.get("play_count_period")?;
                Ok((track, count))
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(tracks)
    }

    // ========================================================================
    // FAZA 7 — Library Cleanup helpers
    // ========================================================================

    /// Delete a track by ID (and its metadata + playlist entries)
    pub fn delete_track(&self, track_id: &str) -> Result<(), DbError> {
        self.conn.execute(
            "DELETE FROM track_metadata WHERE track_id = ?1",
            params![track_id],
        )?;
        self.conn.execute(
            "DELETE FROM playlist_tracks WHERE track_id = ?1",
            params![track_id],
        )?;
        self.conn.execute(
            "DELETE FROM play_history WHERE track_id = ?1",
            params![track_id],
        )?;
        self.conn
            .execute("DELETE FROM tracks WHERE id = ?1", params![track_id])?;
        Ok(())
    }

    /// Update track title/artist (metadata cleanup)
    pub fn update_track_metadata_cleanup(
        &self,
        original_title: &str,
        original_artist: &str,
        clean_title: &str,
        clean_artist: &str,
    ) -> Result<(), DbError> {
        self.conn.execute(
            "UPDATE tracks SET title = ?1, artist = ?2 WHERE title = ?3 AND artist = ?4",
            params![clean_title, clean_artist, original_title, original_artist],
        )?;
        Ok(())
    }

    /// Get all metadata entries
    pub fn get_all_metadata(&self) -> Result<Vec<TrackMetadataDB>, DbError> {
        let mut stmt = self
            .conn
            .prepare("SELECT * FROM track_metadata ORDER BY analyzed_at DESC")?;
        let results = stmt
            .query_map([], |row| {
                Ok(TrackMetadataDB {
                    track_id: row.get("track_id")?,
                    genre: row.get("genre")?,
                    sub_genre: row.get("sub_genre")?,
                    mood: row.get("mood")?,
                    energy_level: row.get("energy_level")?,
                    tempo: row.get("tempo")?,
                    danceability: row.get("danceability")?,
                    vocal_type: row.get("vocal_type")?,
                    decade: row.get("decade")?,
                    language: row.get("language")?,
                    activity_tags: row.get("activity_tags")?,
                    occasion_tags: row.get("occasion_tags")?,
                    keywords: row.get("keywords")?,
                    ai_description: row.get("ai_description")?,
                    analyzed_at: row.get("analyzed_at")?,
                    model_used: row.get("model_used")?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(results)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spotify_import::{
        parse_exportify_csv, scan_folder_for_csv, ImportResult, ImportStatus,
    };
    use sha2::{Digest, Sha256};
    use std::sync::{Mutex, OnceLock};

    fn ytm_free_data_dir_test_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn count_rows(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap_or_else(|err| panic!("Failed to count rows in {table}: {err}"))
    }

    fn sha256_hex(path: &std::path::Path) -> String {
        let bytes = std::fs::read(path)
            .unwrap_or_else(|err| panic!("Failed to read {} for hashing: {err}", path.display()));
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        hasher
            .finalize()
            .iter()
            .map(|byte| format!("{:02X}", byte))
            .collect()
    }

    #[test]
    fn test_in_memory_database_creation() {
        let db = Database::in_memory().expect("Failed to create in-memory database");
        let tracks = db.get_all_tracks().expect("Failed to get tracks");
        assert!(tracks.is_empty());
    }

    #[test]
    fn test_track_crud() {
        let db = Database::in_memory().expect("Failed to create in-memory database");

        // Add a track
        let track = db
            .add_track("video1", "Test Song", "Test Artist", "thumb.jpg", None)
            .expect("Failed to add track");
        assert_eq!(track.title, "Test Song");
        assert_eq!(track.artist, "Test Artist");

        // Retrieve by video_id
        let found = db
            .get_track_by_video_id("video1")
            .expect("Failed to get track by video_id");
        assert_eq!(found.id, track.id);

        // Retrieve by UUID
        let by_uuid = db
            .get_track_by_uuid(&track.id)
            .expect("Failed to get track by UUID");
        assert_eq!(by_uuid.video_id, "video1");

        // Get all tracks
        let all = db.get_all_tracks().expect("Failed to get all tracks");
        assert_eq!(all.len(), 1);

        // Track not found
        let not_found = db.get_track_by_video_id("nonexistent");
        assert!(matches!(not_found, Err(DbError::NotFound(_))));
    }

    #[test]
    fn test_favorites() {
        let db = Database::in_memory().expect("Failed to create in-memory database");
        db.add_track("v1", "Song A", "Artist A", "a.jpg", None)
            .expect("Failed to add track");

        // Toggle favorite on
        let is_fav = db.toggle_favorite("v1").expect("Failed to toggle favorite");
        assert!(is_fav);

        // Check favorites list
        let favs = db.get_favorites().expect("Failed to get favorites");
        assert_eq!(favs.len(), 1);
        assert!(favs[0].is_favorite);

        // Toggle favorite off
        let is_fav = db.toggle_favorite("v1").expect("Failed to toggle favorite");
        assert!(!is_fav);

        let favs = db.get_favorites().expect("Failed to get favorites");
        assert_eq!(favs.len(), 0);
    }

    #[test]
    fn test_play_counts() {
        let db = Database::in_memory().expect("Failed to create in-memory database");
        db.add_track("v1", "Song", "Artist", "thumb.jpg", None)
            .expect("Failed to add track");

        // Initial play count
        let total = db
            .get_total_play_count()
            .expect("Failed to get total play count");
        assert_eq!(total, 0);

        // Update play count
        db.update_play_count("v1")
            .expect("Failed to update play count");
        let total = db
            .get_total_play_count()
            .expect("Failed to get total play count");
        assert_eq!(total, 1);

        // Verify last_played is set
        let track = db.get_track_by_video_id("v1").expect("Failed to get track");
        assert!(track.last_played.is_some());
        assert_eq!(track.play_count, 1);
    }

    #[test]
    fn test_playlist_crud() {
        let db = Database::in_memory().expect("Failed to create in-memory database");

        // Create playlist
        let pl = db
            .create_playlist("My Playlist", Some("Test playlist"))
            .expect("Failed to create playlist");
        assert_eq!(pl.name, "My Playlist");
        assert_eq!(pl.description, Some("Test playlist".to_string()));

        // Add tracks to playlist
        db.add_track("v1", "Song 1", "Artist", "thumb.jpg", None)
            .expect("Failed to add track v1");
        db.add_track("v2", "Song 2", "Artist", "thumb.jpg", None)
            .expect("Failed to add track v2");

        let track1 = db.get_track_by_video_id("v1").unwrap();
        let track2 = db.get_track_by_video_id("v2").unwrap();

        db.add_track_to_playlist(&pl.id, &track1.id)
            .expect("Failed to add track1 to playlist");
        db.add_track_to_playlist(&pl.id, &track2.id)
            .expect("Failed to add track2 to playlist");

        // Get playlist tracks
        let tracks = db
            .get_playlist_tracks(&pl.id)
            .expect("Failed to get playlist tracks");
        assert_eq!(tracks.len(), 2);

        // Remove track
        db.remove_track_from_playlist(&pl.id, &track1.id)
            .expect("Failed to remove track from playlist");
        let tracks = db.get_playlist_tracks(&pl.id).unwrap();
        assert_eq!(tracks.len(), 1);

        // Delete playlist
        db.delete_playlist(&pl.id)
            .expect("Failed to delete playlist");
        let deleted = db.get_playlist(&pl.id);
        assert!(matches!(deleted, Err(DbError::NotFound(_))));
    }

    #[test]
    fn test_run_migrations_creates_schema_migrations_table() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        let version: u32 = conn
            .query_row("SELECT version FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 0);

        let description: String = conn
            .query_row("SELECT description FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(description, "initial schema");
    }

    #[test]
    fn test_run_migrations_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap(); // second call should not fail

        let count: u32 = conn
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_run_migrations_creates_all_tables() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        let tables: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                .unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .filter_map(|r| r.ok())
                .filter(|n| n != "schema_migrations") // exclude the tracking table
                .collect()
        };

        assert!(
            tables.contains(&"tracks".to_string()),
            "tracks table missing"
        );
        assert!(
            tables.contains(&"playlists".to_string()),
            "playlists table missing"
        );
        assert!(
            tables.contains(&"playlist_tracks".to_string()),
            "playlist_tracks table missing"
        );
        assert!(
            tables.contains(&"settings".to_string()),
            "settings table missing"
        );
        assert!(
            tables.contains(&"track_metadata".to_string()),
            "track_metadata table missing"
        );
        assert!(
            tables.contains(&"play_history".to_string()),
            "play_history table missing"
        );
        assert!(
            tables.contains(&"ai_cache".to_string()),
            "ai_cache table missing"
        );
        assert!(
            tables.contains(&"track_embeddings".to_string()),
            "track_embeddings table missing"
        );
    }

    // -- YTM_FREE_DATA_DIR override (no real AppData touched) --
    // One consolidated test so the process-global env var is never touched by
    // two parallel test threads at once (avoids flakes without extra deps).

    /// RAII guard that restores an environment variable on drop, even if the
    /// test panics, so the env var can never leak into other tests.
    struct EnvVarGuard {
        key: String,
        original: Option<std::ffi::OsString>,
    }

    impl EnvVarGuard {
        fn new(key: &str) -> Self {
            let original = std::env::var_os(key);
            Self {
                key: key.to_string(),
                original,
            }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.original {
                Some(v) => std::env::set_var(&self.key, v),
                None => std::env::remove_var(&self.key),
            }
        }
    }

    #[test]
    fn test_get_db_path_override_behavior() {
        let _lock = ytm_free_data_dir_test_lock().lock().unwrap();
        let _guard = EnvVarGuard::new("YTM_FREE_DATA_DIR");

        // 1) Unset -> default layout: <data_dir>/ytm-free/ytm-free.db
        std::env::remove_var("YTM_FREE_DATA_DIR");
        let default_path = Database::get_db_path().expect("default get_db_path");
        assert_eq!(default_path.file_name().unwrap(), "ytm-free.db");
        assert_eq!(
            default_path.parent().and_then(|p| p.file_name()),
            Some(std::ffi::OsStr::new("ytm-free"))
        );

        // 2) Set to a real temp dir -> <dir>/ytm-free.db
        let temp = std::env::temp_dir().join(format!(
            "ytm-free-db-override-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp).unwrap();
        std::env::set_var("YTM_FREE_DATA_DIR", &temp);
        let override_path = Database::get_db_path().expect("override get_db_path");
        assert_eq!(override_path, temp.join("ytm-free.db"));
        assert_ne!(override_path, default_path);

        // 3) Empty string -> falls back to default layout
        std::env::set_var("YTM_FREE_DATA_DIR", "");
        let empty_path = Database::get_db_path().expect("empty-env get_db_path");
        assert_eq!(empty_path.file_name().unwrap(), "ytm-free.db");
        assert_eq!(
            empty_path.parent().and_then(|p| p.file_name()),
            Some(std::ffi::OsStr::new("ytm-free"))
        );

        // 4) Database::new() with override creates the DB in the override dir,
        //    never in real AppData. The parent dir must be created by new().
        let expected_db = temp.join("ytm-free.db");
        // Remove the file if a prior step left it (it should not exist yet).
        let _ = std::fs::remove_file(&expected_db);
        std::env::set_var("YTM_FREE_DATA_DIR", &temp);
        assert!(
            !expected_db.exists(),
            "precondition: db file should not exist yet"
        );
        let db = Database::new().expect("Database::new with override");
        let _ = db; // drop connection
        assert!(
            expected_db.exists(),
            "db file was not created in the override dir"
        );

        // cleanup temp dir
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn test_controlled_spotify_import_harness_with_temp_db_and_synthetic_csv() {
        let _lock = ytm_free_data_dir_test_lock().lock().unwrap();
        let _guard = EnvVarGuard::new("YTM_FREE_DATA_DIR");

        let temp_root = std::env::temp_dir();
        let temp_data_dir = temp_root.join(format!(
            "ytm-free-import-harness-data-{}",
            uuid::Uuid::new_v4()
        ));
        let temp_csv_dir = temp_root.join(format!(
            "ytm-free-import-harness-csv-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_data_dir).expect("Failed to create temp data dir");
        std::fs::create_dir_all(&temp_csv_dir).expect("Failed to create temp csv dir");

        let csv_path = temp_csv_dir.join("synthetic_spotify_import.csv");
        let csv_content = concat!(
            "Track Name,Artist Name(s),Album Name,Duration (ms),Spotify ID\n",
            "Synthetic Song One,Synthetic Artist,Test Album,123000,spotify:track:synthetic001\n",
            "Synthetic Song Two,Second Synthetic Artist,Test Album Two,245000,spotify:track:synthetic002\n"
        );
        std::fs::write(&csv_path, csv_content).expect("Failed to write synthetic csv");

        let scanned_files = scan_folder_for_csv(
            temp_csv_dir
                .to_str()
                .expect("csv dir path should be valid utf-8"),
        )
        .expect("Failed to scan synthetic csv dir");
        assert_eq!(
            scanned_files.len(),
            1,
            "Expected exactly one synthetic CSV file"
        );
        assert_eq!(
            scanned_files[0].track_count, 2,
            "Expected two rows in the synthetic CSV"
        );

        let parsed_tracks =
            parse_exportify_csv(csv_content).expect("Failed to parse synthetic csv content");
        assert_eq!(parsed_tracks.len(), 2, "Expected two parsed Spotify tracks");

        std::env::set_var("YTM_FREE_DATA_DIR", &temp_data_dir);
        let expected_db = temp_data_dir.join("ytm-free.db");
        assert_eq!(
            Database::get_db_path().expect("override get_db_path"),
            expected_db,
            "Database path should honor YTM_FREE_DATA_DIR"
        );

        let db = Database::new().expect("Failed to create temp database");

        let before_tracks = count_rows(&db.conn, "tracks");
        let before_playlists = count_rows(&db.conn, "playlists");
        let before_playlist_tracks = count_rows(&db.conn, "playlist_tracks");
        assert_eq!(before_tracks, 0, "Temp DB should start with no tracks");
        assert_eq!(
            before_playlists, 0,
            "Temp DB should start with no playlists"
        );
        assert_eq!(
            before_playlist_tracks, 0,
            "Temp DB should start with no playlist links"
        );

        let import_results: Vec<ImportResult> = parsed_tracks
            .iter()
            .enumerate()
            .map(|(index, track)| ImportResult {
                spotify_track: track.clone(),
                youtube_id: Some(format!("synthetic-video-{:03}", index + 1)),
                youtube_title: Some(format!("Matched {}", track.track_name)),
                status: ImportStatus::Found,
                alternatives: vec![],
            })
            .collect();

        let playlist_description =
            format!("Imported from Spotify - {} tracks", import_results.len());
        let playlist = db
            .create_playlist(&scanned_files[0].name, Some(&playlist_description))
            .expect("Failed to create playlist for synthetic import");

        // Mirror ImportView.createPlaylistWithTracks: create or reuse a playlist,
        // upsert the matched track, set duration, and link it into the playlist.
        for result in &import_results {
            let youtube_id = result
                .youtube_id
                .as_deref()
                .expect("Synthetic result should have youtube id");
            let youtube_title = result
                .youtube_title
                .as_deref()
                .expect("Synthetic result should have youtube title");
            let spotify_track = &result.spotify_track;
            let thumbnail = format!("https://i.ytimg.com/vi/{youtube_id}/mqdefault.jpg");

            let added_track = db
                .add_track(
                    youtube_id,
                    youtube_title,
                    &spotify_track.artist_name,
                    &thumbnail,
                    None,
                )
                .expect("Failed to add synthetic imported track");

            if let Some(duration_ms) = spotify_track.duration_ms {
                db.update_track_duration(youtube_id, duration_ms / 1000)
                    .expect("Failed to persist imported duration");
            }

            db.add_track_to_playlist(&playlist.id, &added_track.id)
                .expect("Failed to link imported track to playlist");
        }

        let after_tracks = count_rows(&db.conn, "tracks");
        let after_playlists = count_rows(&db.conn, "playlists");
        let after_playlist_tracks = count_rows(&db.conn, "playlist_tracks");
        assert_eq!(after_tracks, 2, "Expected two imported tracks in temp DB");
        assert_eq!(
            after_playlists, 1,
            "Expected one imported playlist in temp DB"
        );
        assert_eq!(
            after_playlist_tracks, 2,
            "Expected two playlist links in temp DB"
        );

        let playlists = db
            .get_playlists()
            .expect("Failed to read persisted playlists");
        assert_eq!(playlists.len(), 1, "Expected a single persisted playlist");
        assert_eq!(
            playlists[0].track_count, 2,
            "Persisted playlist should report two tracks"
        );
        assert_eq!(playlists[0].name, scanned_files[0].name);

        let playlist_tracks = db
            .get_playlist_tracks(&playlist.id)
            .expect("Failed to read persisted playlist tracks");
        assert_eq!(
            playlist_tracks.len(),
            2,
            "Expected two persisted playlist tracks"
        );
        assert_eq!(playlist_tracks[0].video_id, "synthetic-video-001");
        assert_eq!(playlist_tracks[0].title, "Matched Synthetic Song One");
        assert_eq!(playlist_tracks[0].artist, "Synthetic Artist");
        assert_eq!(playlist_tracks[0].duration, Some(123));
        assert_eq!(playlist_tracks[1].video_id, "synthetic-video-002");
        assert_eq!(playlist_tracks[1].title, "Matched Synthetic Song Two");
        assert_eq!(playlist_tracks[1].artist, "Second Synthetic Artist");
        assert_eq!(playlist_tracks[1].duration, Some(245));

        drop(db);

        let persisted = Connection::open(&expected_db).expect("Failed to reopen temp database");
        assert_eq!(
            count_rows(&persisted, "tracks"),
            2,
            "Reopened temp DB should retain two tracks"
        );
        assert_eq!(
            count_rows(&persisted, "playlists"),
            1,
            "Reopened temp DB should retain one playlist"
        );
        assert_eq!(
            count_rows(&persisted, "playlist_tracks"),
            2,
            "Reopened temp DB should retain two links"
        );
        drop(persisted);

        let db_size = std::fs::metadata(&expected_db)
            .expect("Failed to stat temp database")
            .len();
        let db_hash = sha256_hex(&expected_db);

        println!(
            "IMPORT_HARNESS temp_data_dir={} temp_csv_dir={} csv_path={} csv_rows=2 before_tracks={} before_playlists={} before_playlist_tracks={} after_tracks={} after_playlists={} after_playlist_tracks={} db_size={} db_sha256={}",
            temp_data_dir.display(),
            temp_csv_dir.display(),
            csv_path.display(),
            before_tracks,
            before_playlists,
            before_playlist_tracks,
            after_tracks,
            after_playlists,
            after_playlist_tracks,
            db_size,
            db_hash,
        );

        std::fs::remove_dir_all(&temp_csv_dir).expect("Failed to remove temp csv dir");
        std::fs::remove_dir_all(&temp_data_dir).expect("Failed to remove temp data dir");
    }

    #[test]
    fn test_controlled_persistence_state_survives_reopen() {
        let _lock = ytm_free_data_dir_test_lock().lock().unwrap();
        let _guard = EnvVarGuard::new("YTM_FREE_DATA_DIR");

        let temp_data_dir = std::env::temp_dir().join(format!(
            "ytm-free-persistence-state-harness-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_data_dir).expect("Failed to create temp data dir");

        std::env::set_var("YTM_FREE_DATA_DIR", &temp_data_dir);
        let expected_db = temp_data_dir.join("ytm-free.db");
        assert_eq!(
            Database::get_db_path().expect("override get_db_path"),
            expected_db,
            "Database path should honor YTM_FREE_DATA_DIR"
        );

        // --- Instance #1: seed synthetic state in the temp DB ---
        let db = Database::new().expect("Failed to create first temp database");
        assert_eq!(
            count_rows(&db.conn, "tracks"),
            0,
            "Temp DB should start empty of tracks"
        );
        assert_eq!(
            count_rows(&db.conn, "playlists"),
            0,
            "Temp DB should start empty of playlists"
        );
        assert_eq!(
            count_rows(&db.conn, "playlist_tracks"),
            0,
            "Temp DB should start empty of links"
        );

        let playlist = db
            .create_playlist(
                "Persistence Harness Playlist",
                Some("Synthetic two-track playlist for reopen persistence"),
            )
            .expect("Failed to create synthetic playlist");

        let synthetic = [
            (
                "persist-video-001",
                "Persist Song One",
                "Persist Artist One",
                123i64,
            ),
            (
                "persist-video-002",
                "Persist Song Two",
                "Persist Artist Two",
                245i64,
            ),
        ];
        for (video_id, title, artist, duration) in synthetic {
            let thumbnail = format!("https://i.ytimg.com/vi/{video_id}/mqdefault.jpg");
            let added = db
                .add_track(video_id, title, artist, &thumbnail, None)
                .expect("Failed to add synthetic track");
            db.update_track_duration(video_id, duration)
                .expect("Failed to persist synthetic duration");
            db.add_track_to_playlist(&playlist.id, &added.id)
                .expect("Failed to link synthetic track to playlist");
        }

        let seeded_tracks = count_rows(&db.conn, "tracks");
        let seeded_playlists = count_rows(&db.conn, "playlists");
        let seeded_links = count_rows(&db.conn, "playlist_tracks");
        assert_eq!(seeded_tracks, 2, "Expected two seeded tracks");
        assert_eq!(seeded_playlists, 1, "Expected one seeded playlist");
        assert_eq!(seeded_links, 2, "Expected two playlist links");

        let seeded_size = std::fs::metadata(&expected_db)
            .expect("Failed to stat seeded db")
            .len();

        // Drop the first Database instance (closes its SQLite connection).
        drop(db);

        // --- Instance #2: reopen the SAME temp DB via Database::new(), which reruns idempotent migrations on the existing file ---
        let db2 =
            Database::new().expect("Failed to reopen temp database with same YTM_FREE_DATA_DIR");

        let reopened_tracks = count_rows(&db2.conn, "tracks");
        let reopened_playlists = count_rows(&db2.conn, "playlists");
        let reopened_links = count_rows(&db2.conn, "playlist_tracks");
        assert_eq!(
            reopened_tracks, 2,
            "Reopened temp DB should retain two tracks"
        );
        assert_eq!(
            reopened_playlists, 1,
            "Reopened temp DB should retain one playlist"
        );
        assert_eq!(
            reopened_links, 2,
            "Reopened temp DB should retain two playlist links"
        );

        let playlists = db2
            .get_playlists()
            .expect("Failed to read persisted playlists after reopen");
        assert_eq!(
            playlists.len(),
            1,
            "Expected a single persisted playlist after reopen"
        );
        assert_eq!(
            playlists[0].track_count, 2,
            "Persisted playlist should still report two tracks"
        );
        assert_eq!(playlists[0].name, "Persistence Harness Playlist");

        let playlist_tracks = db2
            .get_playlist_tracks(&playlist.id)
            .expect("Failed to read persisted playlist tracks after reopen");
        assert_eq!(
            playlist_tracks.len(),
            2,
            "Expected two persisted playlist tracks after reopen"
        );
        assert_eq!(playlist_tracks[0].video_id, "persist-video-001");
        assert_eq!(playlist_tracks[0].title, "Persist Song One");
        assert_eq!(playlist_tracks[0].artist, "Persist Artist One");
        assert_eq!(playlist_tracks[0].duration, Some(123));
        assert_eq!(playlist_tracks[1].video_id, "persist-video-002");
        assert_eq!(playlist_tracks[1].title, "Persist Song Two");
        assert_eq!(playlist_tracks[1].artist, "Persist Artist Two");
        assert_eq!(playlist_tracks[1].duration, Some(245));

        let reopened_size = std::fs::metadata(&expected_db)
            .expect("Failed to stat reopened db")
            .len();
        let reopened_hash = sha256_hex(&expected_db);

        drop(db2);

        println!(
            "PERSISTENCE_HARNESS temp_data_dir={} before_tracks=0 before_playlists=0 before_links=0 seeded_tracks={} seeded_playlists={} seeded_links={} seeded_db_size={} reopened_tracks={} reopened_playlists={} reopened_links={} reopened_db_size={} reopened_db_sha256={}",
            temp_data_dir.display(),
            seeded_tracks,
            seeded_playlists,
            seeded_links,
            seeded_size,
            reopened_tracks,
            reopened_playlists,
            reopened_links,
            reopened_size,
            reopened_hash
        );

        std::fs::remove_dir_all(&temp_data_dir).expect("Failed to remove temp data dir");
    }

    #[test]
    fn test_controlled_delete_state_persists_after_reopen() {
        let _lock = ytm_free_data_dir_test_lock().lock().unwrap();
        let _guard = EnvVarGuard::new("YTM_FREE_DATA_DIR");

        let temp_data_dir = std::env::temp_dir().join(format!(
            "ytm-free-delete-state-harness-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_data_dir).expect("Failed to create temp data dir");

        std::env::set_var("YTM_FREE_DATA_DIR", &temp_data_dir);
        let expected_db = temp_data_dir.join("ytm-free.db");
        assert_eq!(
            Database::get_db_path().expect("override get_db_path"),
            expected_db,
            "Database path should honor YTM_FREE_DATA_DIR"
        );

        let db = Database::new().expect("Failed to create temp database");
        assert_eq!(
            count_rows(&db.conn, "tracks"),
            0,
            "Temp DB should start empty of tracks"
        );
        assert_eq!(
            count_rows(&db.conn, "playlists"),
            0,
            "Temp DB should start empty of playlists"
        );
        assert_eq!(
            count_rows(&db.conn, "playlist_tracks"),
            0,
            "Temp DB should start empty of links"
        );

        let playlist = db
            .create_playlist(
                "Delete Harness Playlist",
                Some("Synthetic two-track playlist for deletion persistence"),
            )
            .expect("Failed to create synthetic playlist");

        let synthetic = [
            (
                "delete-video-001",
                "Delete Song One",
                "Delete Artist One",
                123i64,
            ),
            (
                "delete-video-002",
                "Delete Song Two",
                "Delete Artist Two",
                245i64,
            ),
        ];
        let mut track_ids = Vec::new();
        for (video_id, title, artist, duration) in synthetic {
            let thumbnail = format!("https://i.ytimg.com/vi/{video_id}/mqdefault.jpg");
            let added = db
                .add_track(video_id, title, artist, &thumbnail, None)
                .expect("Failed to add synthetic track");
            db.update_track_duration(video_id, duration)
                .expect("Failed to persist synthetic duration");
            db.add_track_to_playlist(&playlist.id, &added.id)
                .expect("Failed to link synthetic track to playlist");
            track_ids.push(added.id);
        }

        let seeded_tracks = count_rows(&db.conn, "tracks");
        let seeded_playlists = count_rows(&db.conn, "playlists");
        let seeded_links = count_rows(&db.conn, "playlist_tracks");
        assert_eq!(seeded_tracks, 2, "Expected two seeded tracks");
        assert_eq!(seeded_playlists, 1, "Expected one seeded playlist");
        assert_eq!(seeded_links, 2, "Expected two playlist links");

        let seeded_playlist = db
            .get_playlist(&playlist.id)
            .expect("Failed to read seeded playlist");
        assert_eq!(
            seeded_playlist.track_count, 2,
            "Seeded playlist should report two tracks"
        );
        let seeded_playlist_tracks = db
            .get_playlist_tracks(&playlist.id)
            .expect("Failed to read seeded playlist tracks");
        assert_eq!(
            seeded_playlist_tracks.len(),
            2,
            "Expected two seeded playlist tracks"
        );
        assert_eq!(seeded_playlist_tracks[0].video_id, "delete-video-001");
        assert_eq!(seeded_playlist_tracks[1].video_id, "delete-video-002");

        let removed_track_id = track_ids[0].clone();
        let kept_track_id = track_ids[1].clone();
        db.remove_track_from_playlist(&playlist.id, &removed_track_id)
            .expect("Failed to remove synthetic track from playlist");

        let after_delete_tracks = count_rows(&db.conn, "tracks");
        let after_delete_playlists = count_rows(&db.conn, "playlists");
        let after_delete_links = count_rows(&db.conn, "playlist_tracks");
        assert_eq!(
            after_delete_tracks, 2,
            "Removing from playlist should not delete track rows"
        );
        assert_eq!(
            after_delete_playlists, 1,
            "Removing from playlist should not delete the playlist row"
        );
        assert_eq!(
            after_delete_links, 1,
            "Expected one playlist link after removal"
        );
        assert!(
            db.get_track_by_uuid(&removed_track_id).is_ok(),
            "Removed playlist member track row should remain"
        );
        assert!(
            db.get_track_by_uuid(&kept_track_id).is_ok(),
            "Kept playlist member track row should remain"
        );

        let after_delete_playlist = db
            .get_playlist(&playlist.id)
            .expect("Failed to read playlist after removal");
        assert_eq!(
            after_delete_playlist.track_count, 1,
            "Playlist should report one track after removal"
        );
        let after_delete_playlist_tracks = db
            .get_playlist_tracks(&playlist.id)
            .expect("Failed to read playlist tracks after removal");
        assert_eq!(
            after_delete_playlist_tracks.len(),
            1,
            "Expected one playlist track after removal"
        );
        assert_eq!(after_delete_playlist_tracks[0].video_id, "delete-video-002");
        assert_eq!(after_delete_playlist_tracks[0].title, "Delete Song Two");
        assert_eq!(after_delete_playlist_tracks[0].artist, "Delete Artist Two");
        assert_eq!(after_delete_playlist_tracks[0].duration, Some(245));

        let after_delete_size = std::fs::metadata(&expected_db)
            .expect("Failed to stat db after removal")
            .len();

        drop(db);

        let db2 =
            Database::new().expect("Failed to reopen temp database with same YTM_FREE_DATA_DIR");
        let reopened_tracks = count_rows(&db2.conn, "tracks");
        let reopened_playlists = count_rows(&db2.conn, "playlists");
        let reopened_links = count_rows(&db2.conn, "playlist_tracks");
        assert_eq!(
            reopened_tracks, 2,
            "Reopened temp DB should retain two track rows"
        );
        assert_eq!(
            reopened_playlists, 1,
            "Reopened temp DB should retain one playlist row"
        );
        assert_eq!(
            reopened_links, 1,
            "Reopened temp DB should retain one playlist link"
        );

        let removed_link_count: i64 = db2
            .conn
            .query_row(
                "SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
                rusqlite::params![&playlist.id, &removed_track_id],
                |row| row.get(0),
            )
            .expect("Failed to count removed playlist link after reopen");
        assert_eq!(
            removed_link_count, 0,
            "Removed playlist link should stay absent after reopen"
        );

        let kept_link_count: i64 = db2
            .conn
            .query_row(
                "SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
                rusqlite::params![&playlist.id, &kept_track_id],
                |row| row.get(0),
            )
            .expect("Failed to count kept playlist link after reopen");
        assert_eq!(
            kept_link_count, 1,
            "Kept playlist link should remain after reopen"
        );

        let reopened_playlist = db2
            .get_playlist(&playlist.id)
            .expect("Failed to read playlist after reopen");
        assert_eq!(
            reopened_playlist.track_count, 1,
            "Reopened playlist should report one track"
        );
        let reopened_playlist_tracks = db2
            .get_playlist_tracks(&playlist.id)
            .expect("Failed to read playlist tracks after reopen");
        assert_eq!(
            reopened_playlist_tracks.len(),
            1,
            "Expected one playlist track after reopen"
        );
        assert_eq!(reopened_playlist_tracks[0].video_id, "delete-video-002");
        assert_eq!(reopened_playlist_tracks[0].title, "Delete Song Two");
        assert_eq!(reopened_playlist_tracks[0].artist, "Delete Artist Two");
        assert_eq!(reopened_playlist_tracks[0].duration, Some(245));
        assert!(
            db2.get_track_by_uuid(&removed_track_id).is_ok(),
            "Removed playlist member track row should remain after reopen"
        );
        assert!(
            db2.get_track_by_uuid(&kept_track_id).is_ok(),
            "Kept playlist member track row should remain after reopen"
        );

        let reopened_size = std::fs::metadata(&expected_db)
            .expect("Failed to stat reopened db")
            .len();
        let reopened_hash = sha256_hex(&expected_db);

        drop(db2);

        println!(
            "DELETE_HARNESS temp_data_dir={} before_tracks=0 before_playlists=0 before_links=0 seeded_tracks={} seeded_playlists={} seeded_links={} after_delete_tracks={} after_delete_playlists={} after_delete_links={} after_delete_db_size={} reopened_tracks={} reopened_playlists={} reopened_links={} removed_link_count={} kept_link_count={} reopened_db_size={} reopened_db_sha256={}",
            temp_data_dir.display(),
            seeded_tracks,
            seeded_playlists,
            seeded_links,
            after_delete_tracks,
            after_delete_playlists,
            after_delete_links,
            after_delete_size,
            reopened_tracks,
            reopened_playlists,
            reopened_links,
            removed_link_count,
            kept_link_count,
            reopened_size,
            reopened_hash
        );

        std::fs::remove_dir_all(&temp_data_dir).expect("Failed to remove temp data dir");
    }

    #[test]
    fn test_controlled_search_state_filters_persist_after_reopen() {
        let _lock = ytm_free_data_dir_test_lock().lock().unwrap();
        let _guard = EnvVarGuard::new("YTM_FREE_DATA_DIR");

        let temp_data_dir = std::env::temp_dir().join(format!(
            "ytm-free-search-state-harness-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp_data_dir).expect("Failed to create temp data dir");

        std::env::set_var("YTM_FREE_DATA_DIR", &temp_data_dir);
        let expected_db = temp_data_dir.join("ytm-free.db");
        assert_eq!(
            Database::get_db_path().expect("override get_db_path"),
            expected_db,
            "Database path should honor YTM_FREE_DATA_DIR"
        );

        let db = Database::new().expect("Failed to create temp database");
        assert_eq!(
            count_rows(&db.conn, "tracks"),
            0,
            "Temp DB should start empty of tracks"
        );
        assert_eq!(
            count_rows(&db.conn, "track_metadata"),
            0,
            "Temp DB should start empty of metadata"
        );

        let synthetic = [
            (
                "search-video-001",
                "Search Song One",
                "Search Artist One",
                "synthwave",
                "focus",
                8u8,
            ),
            (
                "search-video-002",
                "Search Song Two",
                "Search Artist Two",
                "ambient",
                "calm",
                3u8,
            ),
            (
                "search-video-003",
                "Search Song Three",
                "Search Artist Three",
                "synthwave",
                "calm",
                6u8,
            ),
        ];
        for (video_id, title, artist, genre, mood, energy) in synthetic {
            let thumbnail = format!("https://i.ytimg.com/vi/{video_id}/mqdefault.jpg");
            let added = db
                .add_track(video_id, title, artist, &thumbnail, None)
                .expect("Failed to add synthetic track");
            let metadata = crate::ollama::TrackMetadataAI {
                genre: genre.to_string(),
                sub_genre: None,
                mood: mood.to_string(),
                energy_level: energy,
                tempo: "medium".to_string(),
                danceability: 5,
                vocal_type: "instrumental".to_string(),
                decade: "2020s".to_string(),
                language: "Instrumental".to_string(),
                activity_tags: vec!["test".to_string()],
                occasion_tags: vec!["harness".to_string()],
                keywords: vec![genre.to_string(), mood.to_string()],
            };
            db.save_track_metadata(&added.id, &metadata, "synthetic-search-harness")
                .expect("Failed to save synthetic metadata");
        }

        let seeded_tracks = count_rows(&db.conn, "tracks");
        let seeded_metadata = count_rows(&db.conn, "track_metadata");
        assert_eq!(seeded_tracks, 3, "Expected three seeded tracks");
        assert_eq!(seeded_metadata, 3, "Expected three metadata rows");

        let video_ids = |tracks: Vec<Track>| -> Vec<String> {
            let mut ids: Vec<String> = tracks.into_iter().map(|track| track.video_id).collect();
            ids.sort();
            ids
        };

        let synthwave_ids = video_ids(
            db.get_tracks_by_genre("synthwave")
                .expect("Failed genre filter"),
        );
        assert_eq!(
            synthwave_ids,
            vec![
                "search-video-001".to_string(),
                "search-video-003".to_string()
            ],
        );

        let focus_ids = video_ids(db.get_tracks_by_mood("focus").expect("Failed mood filter"));
        assert_eq!(focus_ids, vec!["search-video-001".to_string()]);

        let high_energy = db
            .get_tracks_by_energy_range(5, 10)
            .expect("Failed energy range filter");
        assert_eq!(high_energy.len(), 2, "Expected two high-energy tracks");
        assert_eq!(
            high_energy[0].video_id, "search-video-001",
            "Energy filter should order by energy descending"
        );
        assert_eq!(
            high_energy[1].video_id, "search-video-003",
            "Energy filter should order by energy descending"
        );

        let missing_genre = db
            .get_tracks_by_genre("metal")
            .expect("Failed missing genre filter");
        assert!(
            missing_genre.is_empty(),
            "Unexpected results for absent exact genre"
        );

        let seeded_size = std::fs::metadata(&expected_db)
            .expect("Failed to stat seeded db")
            .len();

        drop(db);

        let db2 =
            Database::new().expect("Failed to reopen temp database with same YTM_FREE_DATA_DIR");
        let reopened_tracks = count_rows(&db2.conn, "tracks");
        let reopened_metadata = count_rows(&db2.conn, "track_metadata");
        assert_eq!(
            reopened_tracks, 3,
            "Reopened temp DB should retain three tracks"
        );
        assert_eq!(
            reopened_metadata, 3,
            "Reopened temp DB should retain three metadata rows"
        );

        let reopened_synthwave_ids = video_ids(
            db2.get_tracks_by_genre("synthwave")
                .expect("Failed reopened genre filter"),
        );
        assert_eq!(
            reopened_synthwave_ids,
            vec![
                "search-video-001".to_string(),
                "search-video-003".to_string()
            ],
        );

        let reopened_focus_ids = video_ids(
            db2.get_tracks_by_mood("focus")
                .expect("Failed reopened mood filter"),
        );
        assert_eq!(reopened_focus_ids, vec!["search-video-001".to_string()]);

        let reopened_high_energy = db2
            .get_tracks_by_energy_range(5, 10)
            .expect("Failed reopened energy range filter");
        assert_eq!(
            reopened_high_energy.len(),
            2,
            "Expected two reopened high-energy tracks"
        );
        assert_eq!(
            reopened_high_energy[0].video_id, "search-video-001",
            "Reopened energy filter should preserve ordering"
        );
        assert_eq!(
            reopened_high_energy[1].video_id, "search-video-003",
            "Reopened energy filter should preserve ordering"
        );

        let reopened_missing_genre = db2
            .get_tracks_by_genre("metal")
            .expect("Failed reopened missing genre filter");
        assert!(
            reopened_missing_genre.is_empty(),
            "Unexpected reopened results for absent exact genre"
        );

        let reopened_size = std::fs::metadata(&expected_db)
            .expect("Failed to stat reopened db")
            .len();
        let reopened_hash = sha256_hex(&expected_db);

        drop(db2);

        println!(
            "SEARCH_HARNESS temp_data_dir={} before_tracks=0 before_metadata=0 seeded_tracks={} seeded_metadata={} synthwave_matches=2 focus_matches=1 high_energy_matches=2 missing_genre_matches=0 seeded_db_size={} reopened_tracks={} reopened_metadata={} reopened_synthwave_matches=2 reopened_focus_matches=1 reopened_high_energy_matches=2 reopened_missing_genre_matches=0 reopened_db_size={} reopened_db_sha256={}",
            temp_data_dir.display(),
            seeded_tracks,
            seeded_metadata,
            seeded_size,
            reopened_tracks,
            reopened_metadata,
            reopened_size,
            reopened_hash
        );

        std::fs::remove_dir_all(&temp_data_dir).expect("Failed to remove temp data dir");
    }
}
