use crate::models::{DjTriggersEnabled, ListeningStats, PlayEvent, Playlist, Settings, Track, TrackEmbedding, TrackMetadataDB};
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
}

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
        db.init_tables()?;
        Ok(db)
    }

    fn get_db_path() -> Result<PathBuf, DbError> {
        let data_dir = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("ytm-free");
        Ok(data_dir.join("ytm-free.db"))
    }

    fn init_tables(&self) -> Result<(), DbError> {
        self.conn.execute_batch(
            r#"
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
                crossfade_duration INTEGER DEFAULT 3
            );

            -- Initialize settings if not exists
            INSERT OR IGNORE INTO settings (id) VALUES (1);

            CREATE INDEX IF NOT EXISTS idx_tracks_video_id ON tracks(video_id);
            CREATE INDEX IF NOT EXISTS idx_tracks_favorite ON tracks(is_favorite);
            CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id);
            
            -- Smart AI Tables
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

            CREATE INDEX IF NOT EXISTS idx_track_metadata_genre ON track_metadata(genre);
            CREATE INDEX IF NOT EXISTS idx_track_metadata_mood ON track_metadata(mood);
            CREATE INDEX IF NOT EXISTS idx_track_metadata_energy ON track_metadata(energy_level);
            CREATE INDEX IF NOT EXISTS idx_track_metadata_tempo ON track_metadata(tempo);
            CREATE INDEX IF NOT EXISTS idx_track_metadata_decade ON track_metadata(decade);
            CREATE INDEX IF NOT EXISTS idx_track_metadata_model ON track_metadata(model_used);
            CREATE INDEX IF NOT EXISTS idx_track_embeddings_model ON track_embeddings(model_used);
            CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track ON playlist_tracks(track_id);
            CREATE INDEX IF NOT EXISTS idx_play_history_track ON play_history(track_id);
            CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at);
            CREATE INDEX IF NOT EXISTS idx_play_history_date ON play_history(played_at);
            CREATE INDEX IF NOT EXISTS idx_ai_cache_hash ON ai_cache(prompt_hash);
            CREATE INDEX IF NOT EXISTS idx_track_embeddings_track_id ON track_embeddings(track_id);
            "#,
        )?;

        // Add Ollama columns to settings (migration for existing databases)
        let _ = self.conn.execute(
            "ALTER TABLE settings ADD COLUMN ollama_enabled INTEGER DEFAULT 0",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE settings ADD COLUMN ollama_url TEXT DEFAULT 'http://localhost:11434'",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE settings ADD COLUMN ollama_model TEXT DEFAULT 'mistral:7b'",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE settings ADD COLUMN smart_search_enabled INTEGER DEFAULT 0",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE settings ADD COLUMN auto_tagging_enabled INTEGER DEFAULT 0",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE settings ADD COLUMN smart_queue_enabled INTEGER DEFAULT 0",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE settings ADD COLUMN daily_mix_enabled INTEGER DEFAULT 0",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE settings ADD COLUMN search_results_count INTEGER DEFAULT 25",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE settings ADD COLUMN dj_mode_enabled INTEGER DEFAULT 0",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE settings ADD COLUMN dj_style TEXT DEFAULT 'classic_fm'",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE settings ADD COLUMN dj_language TEXT DEFAULT 'English'",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE settings ADD COLUMN dj_frequency INTEGER DEFAULT 1",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE settings ADD COLUMN dj_triggers_enabled TEXT DEFAULT '{\"track_start\":true,\"track_end\":true,\"queue_empty\":true,\"long_session\":true,\"first_track_of_day\":true,\"milestone\":true,\"time_announcement\":true,\"mood_shift\":true}'",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE settings ADD COLUMN semantic_search_enabled INTEGER DEFAULT 0",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE settings ADD COLUMN embedding_model TEXT DEFAULT 'all-minilm'",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE settings ADD COLUMN tts_engine TEXT DEFAULT 'web_speech'",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE settings ADD COLUMN dj_voice TEXT DEFAULT ''",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE settings ADD COLUMN dj_pitch REAL DEFAULT 1.0",
            [],
        );
        let _ = self.conn.execute(
            "ALTER TABLE settings ADD COLUMN dj_rate REAL DEFAULT 1.05",
            [],
        );

        Ok(())
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
            .query_row(
                "SELECT * FROM tracks WHERE id = ?1",
                params![uuid],
                |row| Self::row_to_track(row),
            )
            .map_err(|_| DbError::NotFound(format!("Track not found by UUID: {}", uuid)))
    }

    pub fn get_all_tracks(&self) -> Result<Vec<Track>, DbError> {
        let mut stmt = self.conn.prepare("SELECT * FROM tracks ORDER BY created_at DESC")?;
        let tracks = stmt
            .query_map([], |row| Self::row_to_track(row))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(tracks)
    }

    pub fn get_downloaded_tracks(&self) -> Result<Vec<Track>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT * FROM tracks WHERE is_downloaded = 1 ORDER BY created_at DESC",
        )?;
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
        let mut stmt = self.conn.prepare(
            "SELECT * FROM tracks WHERE is_favorite = 1 ORDER BY created_at DESC",
        )?;
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

    pub fn create_playlist(&self, name: &str, description: Option<&str>) -> Result<Playlist, DbError> {
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
        self.conn.execute("DELETE FROM playlists WHERE id = ?1", params![id])?;
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

    pub fn remove_track_from_playlist(&self, playlist_id: &str, track_id: &str) -> Result<(), DbError> {
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
            .map_err(|e| DbError::NotFound(format!("Metadata not found for track: {} ({})", track_id, e)))
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
            "SELECT DISTINCT genre FROM track_metadata WHERE genre IS NOT NULL ORDER BY genre"
        )?;
        let genres: Vec<String> = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT mood FROM track_metadata WHERE mood IS NOT NULL ORDER BY mood"
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
        let total_time_seconds: i64 = self.conn.query_row(
            r#"
            SELECT COALESCE(SUM(t.duration), 0) FROM play_history ph
            JOIN tracks t ON ph.track_id = t.id
            WHERE datetime(ph.played_at) >= datetime('now', '-' || ?1 || ' days')
            "#,
            params![days_back],
            |row| row.get(0),
        ).unwrap_or(0);

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
            Err(_) => Err(DbError::NotFound("Cache entry not found or expired".to_string())),
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
        let bytes: Vec<u8> = embedding
            .iter()
            .flat_map(|f| f.to_le_bytes())
            .collect();
        
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
    pub fn get_forgotten_gems(&self, min_days_unplayed: i64, limit: i64) -> Result<Vec<Track>, DbError> {
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
            .query_map(params![min_days_unplayed, limit], |row| Self::row_to_track(row))?
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
            let yesterday = (chrono::Local::now() - chrono::Duration::days(1)).format("%Y-%m-%d").to_string();
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
        self.conn.execute("DELETE FROM track_metadata WHERE track_id = ?1", params![track_id])?;
        self.conn.execute("DELETE FROM playlist_tracks WHERE track_id = ?1", params![track_id])?;
        self.conn.execute("DELETE FROM play_history WHERE track_id = ?1", params![track_id])?;
        self.conn.execute("DELETE FROM tracks WHERE id = ?1", params![track_id])?;
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
        let mut stmt = self.conn.prepare(
            "SELECT * FROM track_metadata ORDER BY analyzed_at DESC"
        )?;
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
