export interface SearchResult {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration?: number;
  duration_string?: string;
  view_count?: number;
}

export interface TrackInfo {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number;
  audio_url?: string;
  formats: AudioFormat[];
}

export interface AudioFormat {
  format_id: string;
  ext: string;
  quality: string;
  abr?: number;
  url?: string;
}

export interface Track {
  id: string;
  video_id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration?: number;
  local_path?: string;
  is_downloaded: boolean;
  is_favorite: boolean;
  play_count: number;
  last_played?: string;
  created_at: string;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  thumbnail?: string;
  track_count: number;
  created_at: string;
  updated_at: string;
}

export interface Settings {
  audio_quality: 'low' | 'medium' | 'high' | 'best';
  download_path: string;
  auto_download: boolean;
  theme: 'dark' | 'light' | 'system';
  volume: number;
  crossfade: boolean;
  crossfade_duration: number;
  ollama_enabled: boolean;
  ollama_url: string;
  ollama_model: string;
  smart_search_enabled: boolean;
  auto_tagging_enabled: boolean;
  smart_queue_enabled: boolean;
  daily_mix_enabled: boolean;
  search_results_count: number;
  dj_mode_enabled: boolean;
  dj_style: string;
  dj_language: string;
  dj_frequency: number;
  dj_voice: string;
  dj_pitch: number;
  dj_rate: number;
  dj_triggers_enabled: {
    track_start: boolean;
    track_end: boolean;
    queue_empty: boolean;
    long_session: boolean;
    first_track_of_day: boolean;
    milestone: boolean;
    time_announcement: boolean;
    mood_shift: boolean;
  };
  semantic_search_enabled: boolean;
  embedding_model: string;
  tts_engine: 'web_speech' | 'edge_tts';
}

export type View = 'home' | 'search' | 'library' | 'playlists' | 'playlist' | 'downloads' | 'favorites' | 'settings' | 'import' | 'smart-playlist' | 'smart-queue' | 'ai-chat' | 'insights' | 'library-cleanup';

export type RepeatMode = 'none' | 'one' | 'all';

// Spotify Import Types
export interface SpotifyTrack {
  track_name: string;
  artist_name: string;
  album_name: string;
  duration_ms?: number;
  spotify_id?: string;
}

export interface Alternative {
  id: string;
  title: string;
  artist: string;
}

export type ImportStatus = 'Found' | 'NotFound' | 'AlternativeFound';

export interface ImportResult {
  spotify_track: SpotifyTrack;
  youtube_id?: string;
  youtube_title?: string;
  status: ImportStatus;
  alternatives: Alternative[];
}

export interface CsvFileInfo {
  name: string;
  path: string;
  track_count: number;
}

// Ollama AI Types (FAZA 2 Extended - B1-B11)
export interface TrackMetadataAI {
  genre: string;
  sub_genre?: string;
  mood: string;
  energy_level: number;      // 1-10
  tempo: string;             // slow, medium, fast
  danceability: number;      // 1-10 (B7)
  vocal_type: string;        // instrumental, female vocals, male vocals, mixed vocals, rap, choir (B8)
  decade: string;            // 1960s, 1970s, 1980s, 1990s, 2000s, 2010s, 2020s (B9)
  language: string;          // English, Romanian, Spanish, French, Italian, German, Instrumental, Other (B10)
  activity_tags: string[];   // workout, study, sleep, driving, party, cooking, meditation, gaming, etc. (B11)
  occasion_tags: string[];   // wedding, birthday, christmas, summer, winter, road trip, etc. (B11)
  keywords: string[];        // max 5 descriptive keywords
}

export interface PlaylistSuggestion {
  name: string;
  description: string;
  search_queries: string[];
}

// Smart Playlist Plan (FAZA 3)
export interface SmartPlaylistPlan {
  name: string;
  description: string;
  genres: string[];
  moods: string[];
  energy_min: number;
  energy_max: number;
  decades: string[];
  tempo: string | null;
  activities: string[];
  search_queries: string[];
}

export interface SmartPlaylistTrackMatch {
  track: Track;
  genre: string | null;
  mood: string | null;
  energy_level: number | null;
  decade: string | null;
  score: number;
}

export type SmartMethod = 'description' | 'mood' | 'activity' | 'seed' | 'preset' | 'library' | 'mood-ai' | 'duration' | 'mood-journey' | 'discovery' | 'merge';

// Smart Queue Types (FAZA 4 - I1-I6)
export interface CrossfadeSuggestion {
  duration_seconds: number;
  reason: string;
}

export type SmartQueueMode = 'wake_up' | 'sleep' | 'workout';
export type WorkoutIntensity = 'low' | 'medium' | 'high';

export type PlayerCommand =
  | { command: 'play'; query?: string }
  | { command: 'pause' }
  | { command: 'next' }
  | { command: 'previous' }
  | { command: 'favorite' }
  | { command: 'search'; query: string }
  | { command: 'create_playlist'; name: string; description?: string }
  | { command: 'set_mood'; mood: string }
  | { command: 'set_volume'; level: number }
  | { command: 'add_to_queue'; query: string }
  | { command: 'toggle_shuffle' }
  | { command: 'set_repeat'; mode: 'none' | 'one' | 'all' }
  | { command: 'navigate'; view: string }
  | { command: 'download'; query?: string }
  | { command: 'multi'; commands: PlayerCommand[] }
  | { command: 'unknown' };

export interface SpotifyMatchResult {
  selected_id: string | null;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

// ============================================================================
// SMART SPOTIFY IMPORT TYPES (FAZA 4 — D1-D5)
// ============================================================================

export type MatchConfidence = 'High' | 'Medium' | 'Low';

export interface SmartImportResult {
  spotify_track: SpotifyTrack;
  youtube_id?: string;
  youtube_title?: string;
  status: ImportStatus;
  confidence: MatchConfidence;
  ai_reason?: string;
  alternatives: Alternative[];
  quality_score: number; // 0-100
}

export interface AlternativeQueriesResult {
  queries: string[];
  likely_issue: string;
  suggestion: string;
}

export interface MatchQualityResult {
  quality: 'high' | 'medium' | 'low' | 'mismatch';
  score: number;
  issues: string[];
  is_correct_track: boolean;
  is_correct_artist: boolean;
  is_studio_version: boolean;
  duration_match: boolean;
  recommendation: 'accept' | 'review' | 'reject' | 're-search';
}

export interface SameArtistAlternative {
  title: string;
  reason: string;
}

export interface OtherArtistAlternative {
  title: string;
  artist: string;
  reason: string;
}

export interface SimilarTrackSuggestion {
  same_artist_alternatives: SameArtistAlternative[];
  other_artist_alternatives: OtherArtistAlternative[];
  search_queries: string[];
}

export interface DisambiguationResult {
  selected_id: string;
  confidence: string;
  reason: string;
  is_cover: boolean;
  is_live: boolean;
  is_remix: boolean;
}

// ============================================================================
// SMART AI TYPES
// ============================================================================
// Note: TrackMetadataAI is defined above in Ollama AI Types section to avoid duplication

export interface TrackMetadataDB {
  track_id: string;
  genre?: string;
  sub_genre?: string;
  mood?: string;
  energy_level?: number;
  tempo?: string;
  danceability?: number;
  vocal_type?: string;
  decade?: string;
  language?: string;
  activity_tags?: string;
  occasion_tags?: string;
  keywords?: string;
  ai_description?: string;
  analyzed_at: string;
  model_used?: string;
}

export interface PlaylistSuggestion {
  name: string;
  description: string;
  search_queries: string[];
}

export interface PlayEvent {
  id: string;
  track_id: string;
  played_at: string;
  duration_listened?: number;
  context?: string;
}

export interface ListeningStats {
  total_tracks: number;
  total_time_seconds: number;
  top_genres: [string, number][];
  top_artists: [string, number][];
  top_moods: [string, number][];
  daily_breakdown: [string, number][];
}

export interface OllamaStatus {
  available: boolean;
  models: string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

// ============================================================================
// LIBRARY CLEANUP (FAZA 7 — H1-H7)
// ============================================================================

export interface DuplicatePair {
  track1: string;
  track2: string;
  similarity: string;
  suggestion: string;
}

export interface CleanedTrack {
  original_title: string;
  original_artist: string;
  clean_title: string;
  clean_artist: string;
  changes: string;
}

export interface ArtistNormGroup {
  canonical: string;
  variants: string[];
}

export interface OrganizeSuggestion {
  category: string;
  tracks: string[];
  reason: string;
}

export interface DeletionSuggestion {
  track: string;
  reason: string;
}

export interface CleanupResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// ============================================================================
// AI CHAT (FAZA 7 — J1-J5)
// ============================================================================

export interface TriviaResponse {
  facts: string[];
  fun_fact: string;
  year_released: string;
  album: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correct: number;
  explanation: string;
}

// Command Bar Types (FAZA 5)
export interface CommandHistoryEntry {
  input: string;
  command: PlayerCommand;
  feedback: string;
  timestamp: string;
}

// Smart Search Response Types (FAZA 1)
export interface MoodSearchResponse {
  queries: string[];
  explanation: string;
}

export interface ActivitySearchResponse {
  queries: string[];
  recommended_bpm: string;
  energy_level: number;
}

export interface EraSearchResponse {
  queries: string[];
  time_period: string;
  notable_artists: string[];
}

export interface SimilarArtist {
  name: string;
  similarity_reason: string;
  confidence: string;
}

export interface SimilarArtistsResponse {
  similar_artists: SimilarArtist[];
  search_queries: string[];
}

export interface LyricSearchResponse {
  queries: string[];
  related_themes: string[];
}

export interface Translation {
  language: string;
  query: string;
  cultural_variant?: string;
}

export interface CrossLanguageSearchResponse {
  original_language: string;
  translations: Translation[];
  search_queries: string[];
}

export interface ContextualSuggestionsResponse {
  detected_patterns: string[];
  suggested_mood: string;
  queries: string[];
  reasoning: string;
}

export interface AutocompleteSuggestion {
  text: string;
  type: string;
  confidence: string;
}

export interface SmartAutocompleteResponse {
  completions: AutocompleteSuggestion[];
}

export interface QueryInterpretation {
  meaning: string;
  confidence: string;
  queries: string[];
}

export interface VagueQueryResponse {
  interpretations: QueryInterpretation[];
  clarification_questions: string[];
  best_guess_queries: string[];
}

// ============================================================================
// INSIGHTS & ANALYTICS (FAZA 6)
// ============================================================================

export interface InsightsStats {
  total_tracks: number;
  total_time_seconds: number;
  top_genres: [string, number][];
  top_artists: [string, number][];
  top_moods: [string, number][];
  daily_breakdown: [string, number][];
  streak_days: number;
  hourly_breakdown: [number, number][];
  top_tracks: { track: Track; play_count: number }[];
}

export interface ListeningProfileResponse {
  profile_text: string;
  music_personality: string;
}

export interface WeeklySummaryResponse {
  summary_text: string;
  highlight: string;
  trend: string;
  recommendation: string;
}

export interface TimePatternsResponse {
  peak_hours: number[];
  quiet_hours: number[];
  pattern_name: string;
  insight: string;
}

export interface ForgottenGem {
  track_id: string;
  reason: string;
}

export interface ForgottenGemsResponse {
  gems: ForgottenGem[];
  message: string;
}

export interface ArtistDeepDiveResponse {
  artist: string;
  bio: string;
  essential_albums: string[];
  recommended_tracks: string[];
  similar_artists: string[];
  fun_fact: string;
}

export interface GenreExplorerResponse {
  genre: string;
  description: string;
  sub_genres: string[];
  legendary_artists: string[];
  essential_tracks: string[];
  related_genres: string[];
}

export interface RecommendationItem {
  title: string;
  artist: string;
  search_query: string;
  reason: string;
}

export interface BecauseYouLikedResponse {
  recommendations: RecommendationItem[];
  insight: string;
}

export interface SurpriseItem {
  title: string;
  artist: string;
  search_query: string;
  genre: string;
  why_surprise: string;
}

export interface SurpriseMeResponse {
  surprises: SurpriseItem[];
  theme: string;
}

export interface SeasonalRecommendation {
  title: string;
  artist: string;
  search_query: string;
  seasonal_fit: string;
}

export interface SeasonalResponse {
  season: string;
  mood: string;
  recommendations: SeasonalRecommendation[];
}

// ============================================================================
// SHARE & SOCIAL (FAZA 8 — K1-K3)
// ============================================================================

export interface ShareMessageResponse {
  message: string;
  hashtags: string[];
}

export interface PlaylistDescriptionResponse {
  description: string;
  vibe_tags: string[];
}

export interface YearInReviewSection {
  heading: string;
  text: string;
}

export interface YearInReviewResponse {
  title: string;
  sections: YearInReviewSection[];
  fun_stats: string[];
  music_personality: string;
}

// ============================================================================
// UTILITIES (FAZA 8 — L1-L3)
// ============================================================================

export interface ErrorExplanation {
  explanation: string;
  suggestion: string;
}

export interface SettingsAdviceSuggestion {
  setting: string;
  current: string;
  recommended: string;
  reason: string;
}

export interface SettingsAdviceResponse {
  suggestions: SettingsAdviceSuggestion[];
  overall_score: number;
  summary: string;
}

export interface StorageSuggestion {
  action: string;
  savings_mb: number;
  affected_tracks: number;
}

export interface StorageAnalysisResponse {
  total_size_mb: number;
  tracks_analyzed: number;
  suggestions: StorageSuggestion[];
  summary: string;
}

export interface DjCommentary {
  commentary: string;
  transition_type: string;
  energy: string;
}

export type DjTriggerType =
  | 'TrackStart'
  | 'TrackEnd'
  | 'QueueEmpty'
  | 'LongSession'
  | 'FirstTrackOfDay'
  | 'Milestone'
  | 'TimeAnnouncement'
  | 'MoodShift'
  | 'UserRequest';

export interface DjEventContext {
  trigger_type: DjTriggerType;
  current_title?: string;
  current_artist?: string;
  current_track_id?: string;
  next_title?: string;
  next_artist?: string;
  time_of_day?: 'morning' | 'afternoon' | 'evening' | 'night';
  session_duration_minutes?: number;
  total_tracks_played?: number;
  milestone_count?: number;
  prev_mood?: string;
  current_mood?: string;
  style?: string;
  language?: string;
  model?: string;
}

export interface SemanticSearchResult {
  track: Track;
  similarity: number;
  match_reason: string;
}

export interface SemanticIndexStatus {
  total_tracks: number;
  indexed_tracks: number;
  model_used: string;
  is_indexing: boolean;
}

export interface SemanticPlaylistResult {
  playlist_id: string;
  playlist_name: string;
  track_count: number;
  average_similarity: number;
  created_at: string;
}

export interface EmbeddingMetadata {
  track_id: string;
  genres: string[];
  moods: string[];
  activities: string[];
  energy_level?: number;
}