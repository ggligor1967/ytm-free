import { invoke } from "@tauri-apps/api/core";
import type { 
  SearchResult, 
  Track, 
  Playlist, 
  Settings, 
  TrackInfo, 
  SpotifyTrack, 
  ImportResult, 
  CsvFileInfo, 
  TrackMetadataAI, 
  TrackMetadataDB,
  PlaylistSuggestion, 
  PlayerCommand, 
  SpotifyMatchResult,
  SmartImportResult,
  AlternativeQueriesResult,
  MatchQualityResult,
  SimilarTrackSuggestion,
  DisambiguationResult,
  MoodSearchResponse,
  ActivitySearchResponse,
  EraSearchResponse,
  SimilarArtistsResponse,
  LyricSearchResponse,
  CrossLanguageSearchResponse,
  ContextualSuggestionsResponse,
  SmartAutocompleteResponse,
  VagueQueryResponse,
  InsightsStats,
  ListeningProfileResponse,
  WeeklySummaryResponse,
  TimePatternsResponse,
  ForgottenGemsResponse,
  ArtistDeepDiveResponse,
  GenreExplorerResponse,
  BecauseYouLikedResponse,
  SurpriseMeResponse,
  SeasonalResponse,
  SemanticSearchResult,
  SemanticIndexStatus,
  SemanticPlaylistResult,
} from "./types";

// ============================================================================
// YT-DLP
// ============================================================================

export async function searchYoutube(query: string, maxResults?: number): Promise<SearchResult[]> {
  return invoke("search_youtube", { query, maxResults });
}

export async function getTrackInfo(videoId: string): Promise<TrackInfo> {
  return invoke("get_track_info", { videoId });
}

export async function getStreamUrl(videoId: string): Promise<string> {
  return invoke("get_stream_url", { videoId });
}

export async function downloadTrack(
  videoId: string,
  title: string,
  artist: string,
  thumbnail: string
): Promise<Track> {
  return invoke("download_track", { videoId, title, artist, thumbnail });
}

export async function checkYtdlp(): Promise<string> {
  return invoke("check_ytdlp");
}

export async function getVideoStreamUrl(videoId: string): Promise<string> {
  return invoke("get_video_stream_url", { videoId });
}

export async function checkFfmpegInstalled(): Promise<string> {
  return invoke("check_ffmpeg_installed");
}

export async function checkEdgeTts(): Promise<string> {
  return invoke("check_edge_tts");
}

export async function speakWithEdgeTts(
  text: string,
  voice: string,
  rate: number,
  pitch: number
): Promise<string> {
  return invoke("speak_with_edge_tts", { text, voice, rate, pitch });
}

export async function cleanupTtsFiles(): Promise<void> {
  return invoke("cleanup_tts_files");
}

// ============================================================================
// PLAYLISTS
// ============================================================================

export async function getPlaylists(): Promise<Playlist[]> {
  return invoke("get_playlists");
}

export async function createPlaylist(
  name: string,
  description?: string
): Promise<Playlist> {
  return invoke("create_playlist", { name, description });
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  return invoke("delete_playlist", { playlistId });
}

export async function updatePlaylist(
  playlistId: string,
  name: string,
  description?: string
): Promise<Playlist> {
  return invoke("update_playlist", { playlistId, name, description });
}

export async function getPlaylistTracks(playlistId: string): Promise<Track[]> {
  return invoke("get_playlist_tracks", { playlistId });
}

export async function addToPlaylist(
  playlistId: string,
  videoId: string,
  title: string,
  artist: string,
  thumbnail: string,
  duration?: number
): Promise<Track> {
  return invoke("add_to_playlist", {
    playlistId,
    videoId,
    title,
    artist,
    thumbnail,
    duration,
  });
}

export async function removeFromPlaylist(
  playlistId: string,
  trackId: string
): Promise<void> {
  return invoke("remove_from_playlist", { playlistId, trackId });
}

// ============================================================================
// LIBRARY
// ============================================================================

export async function getLibrary(): Promise<Track[]> {
  return invoke("get_library");
}

export async function getDownloads(): Promise<Track[]> {
  return invoke("get_downloads");
}

export async function getRecentlyPlayed(limit?: number): Promise<Track[]> {
  return invoke("get_recently_played", { limit });
}

export async function updatePlayCount(videoId: string): Promise<void> {
  return invoke("update_play_count", { videoId });
}

export async function toggleFavorite(videoId: string): Promise<boolean> {
  return invoke("toggle_favorite", { videoId });
}

export async function getFavorites(): Promise<Track[]> {
  return invoke("get_favorites");
}

// ============================================================================
// SETTINGS
// ============================================================================

export async function getSettings(): Promise<Settings> {
  return invoke("get_settings");
}

export async function updateSettings(settings: Settings): Promise<void> {
  return invoke("update_settings", { settings });
}

// ============================================================================
// SPOTIFY IMPORT
// ============================================================================

export async function parseSpotifyCsv(content: string): Promise<SpotifyTrack[]> {
  return invoke("parse_spotify_csv", { content });
}

export async function searchTrackOnYoutube(track: SpotifyTrack): Promise<ImportResult> {
  return invoke("search_track_on_youtube", { track });
}

export async function importSpotifyCsvFile(filePath: string): Promise<ImportResult[]> {
  return invoke("import_spotify_csv_file", { filePath });
}

export async function scanSpotifyFolder(folderPath: string): Promise<CsvFileInfo[]> {
  return invoke("scan_spotify_folder", { folderPath });
}

export async function getDefaultSpotifyFolder(): Promise<string> {
  return invoke("get_default_spotify_folder");
}

export async function readCsvFile(filePath: string): Promise<string> {
  return invoke("read_csv_file", { filePath });
}

// ============================================================================
// OLLAMA AI
// ============================================================================

export async function ollamaCheckAvailable(url?: string): Promise<boolean> {
  return invoke("ollama_check_available", { url });
}

export async function ollamaListModels(url?: string): Promise<string[]> {
  return invoke("ollama_list_models", { url });
}

export async function ollamaEnhanceSearch(
  query: string,
  recentGenres: string[] = [],
  model?: string
): Promise<string[]> {
  return invoke("ollama_enhance_search", { query, recentGenres, model });
}

export async function ollamaAnalyzeTrack(
  title: string,
  artist: string,
  model?: string
): Promise<TrackMetadataAI> {
  return invoke("ollama_analyze_track", { title, artist, model });
}

export async function ollamaParseCommand(
  input: string,
  model?: string
): Promise<PlayerCommand> {
  return invoke("ollama_parse_command", { input, model });
}

export async function ollamaGeneratePlaylist(
  description: string,
  durationMinutes?: number,
  existingArtists: string[] = [],
  model?: string
): Promise<PlaylistSuggestion> {
  return invoke("ollama_generate_playlist", {
    description,
    durationMinutes,
    existingArtists,
    model,
  });
}

export async function ollamaVerifySpotifyMatch(
  spotifyTitle: string,
  spotifyArtist: string,
  spotifyAlbum: string,
  spotifyDurationSec: number | null,
  youtubeResults: [string, string, string, number | null][],
  model?: string
): Promise<SpotifyMatchResult> {
  return invoke("ollama_verify_spotify_match", {
    spotifyTitle,
    spotifyArtist,
    spotifyAlbum,
    spotifyDurationSec,
    youtubeResults,
    model,
  });
}

// Smart Search Functions (FAZA 1)
export async function ollamaMoodSearch(
  mood: string,
  userLibraryGenres: string[] = [],
  model?: string
): Promise<MoodSearchResponse> {
  return invoke("ollama_mood_search", { mood, userLibraryGenres, model });
}

export async function ollamaActivitySearch(
  activity: string,
  durationMinutes?: number,
  model?: string
): Promise<ActivitySearchResponse> {
  return invoke("ollama_activity_search", { activity, durationMinutes, model });
}

export async function ollamaEraSearch(
  era: string,
  genreFilter?: string,
  model?: string
): Promise<EraSearchResponse> {
  return invoke("ollama_era_search", { era, genreFilter, model });
}

export async function ollamaSimilarArtists(
  artistName: string,
  userFavorites: string[] = [],
  model?: string
): Promise<SimilarArtistsResponse> {
  return invoke("ollama_similar_artists", { artistName, userFavorites, model });
}

export async function ollamaLyricSearch(
  theme: string,
  model?: string
): Promise<LyricSearchResponse> {
  return invoke("ollama_lyric_search", { theme, model });
}

export async function ollamaCrossLanguageSearch(
  query: string,
  targetLanguages: string[] = [],
  model?: string
): Promise<CrossLanguageSearchResponse> {
  return invoke("ollama_cross_language_search", { query, targetLanguages, model });
}

export async function ollamaContextualSuggestions(
  recentTracks: [string, string][],
  timeOfDay: string,
  dayOfWeek: string,
  model?: string
): Promise<ContextualSuggestionsResponse> {
  return invoke("ollama_contextual_suggestions", { recentTracks, timeOfDay, dayOfWeek, model });
}

export async function ollamaSmartAutocomplete(
  partialQuery: string,
  popularSearches: string[] = [],
  model?: string
): Promise<SmartAutocompleteResponse> {
  return invoke("ollama_smart_autocomplete", { partialQuery, popularSearches, model });
}

export async function ollamaResolveVagueQuery(
  vagueQuery: string,
  contextTracks: [string, string][] = [],
  model?: string
): Promise<VagueQueryResponse> {
  return invoke("ollama_resolve_vague_query", { vagueQuery, contextTracks, model });
}

// ============================================================================
// Ollama Auto-Tagging (FAZA 2)
// ============================================================================

export async function ollamaGetTrackMetadata(
  trackId: string
): Promise<TrackMetadataDB | null> {
  return invoke("ollama_get_track_metadata", { trackId });
}

export async function ollamaGetUntaggedCount(): Promise<number> {
  return invoke("ollama_get_untagged_count");
}

export async function ollamaBatchAnalyzeTracks(
  trackIds: string[],
  model?: string
): Promise<string[]> {
  return invoke("ollama_batch_analyze_tracks", { trackIds, model });
}

// ============================================================================
// Smart Playlist (FAZA 3)
// ============================================================================

export async function smartPlaylistGeneratePlan(
  description: string,
  method: string,
  durationMinutes?: number,
  model?: string
): Promise<import('./types').SmartPlaylistPlan> {
  return invoke("smart_playlist_generate_plan", { description, method, durationMinutes, model });
}

export async function smartPlaylistMatchLibrary(
  genres: string[],
  moods: string[],
  energyMin: number,
  energyMax: number,
  decades: string[],
  activities: string[],
  limit?: number
): Promise<import('./types').SmartPlaylistTrackMatch[]> {
  return invoke("smart_playlist_match_library", { genres, moods, energyMin, energyMax, decades, activities, limit });
}

export async function smartPlaylistFromSeed(
  title: string,
  artist: string,
  trackId?: string,
  model?: string
): Promise<import('./types').SmartPlaylistPlan> {
  return invoke("smart_playlist_from_seed", { title, artist, trackId, model });
}

export async function smartPlaylistSave(
  name: string,
  description: string | undefined,
  trackIds: string[],
  youtubeTracks: [string, string, string, string][] = []
): Promise<import('./types').Playlist> {
  return invoke("smart_playlist_save", { name, description, trackIds, youtubeTracks });
}

export async function smartPlaylistCoverIdea(
  trackIds: string[]
): Promise<{ description: string; style: string; colors: string[] }> {
  return invoke("smart_playlist_cover_idea", { trackIds });
}

/** C2: Generate a mood-based playlist */
export async function smartPlaylistByMood(mood: string): Promise<any> {
  return invoke("smart_playlist_by_mood", { mood });
}

/** C3: Generate a duration-limited playlist */
export async function smartPlaylistByDuration(durationMin: number, theme: string): Promise<any> {
  return invoke("smart_playlist_by_duration", { durationMin, theme });
}

/** C4: Generate a mood-transition journey playlist */
export async function smartPlaylistMoodJourney(startMood: string, endMood: string): Promise<any> {
  return invoke("smart_playlist_mood_journey", { startMood, endMood });
}

/** C7: Discovery playlist — find hidden gems */
export async function smartPlaylistDiscovery(): Promise<any> {
  return invoke("smart_playlist_discovery");
}

/** C8: AI-name a playlist based on its tracks */
export async function smartPlaylistName(trackIds: string[]): Promise<any> {
  return invoke("smart_playlist_name", { trackIds });
}

/** C10: Smart reorder a playlist */
export async function smartPlaylistReorder(trackIds: string[]): Promise<any> {
  return invoke("smart_playlist_reorder", { trackIds });
}

/** C11: Merge two playlists */
export async function smartPlaylistMerge(playlistATracks: string[], playlistBTracks: string[]): Promise<any> {
  return invoke("smart_playlist_merge", { playlistATracks, playlistBTracks });
}

/** C12: Split a playlist into themed sub-playlists */
export async function smartPlaylistSplit(trackIds: string[]): Promise<any> {
  return invoke("smart_playlist_split", { trackIds });
}

// ============================================================================
// Daily Mix (FAZA 3 - Step 3.5)
// ============================================================================

export async function ollamaDailyMix(
  model?: string
): Promise<[import('./types').Playlist, import('./types').Track[]]> {
  return invoke("ollama_daily_mix", { model });
}

// ============================================================================
// Smart Queue (FAZA 4 - I1-I6)
// ============================================================================

export async function smartQueueNext(
  currentTitle: string,
  currentArtist: string,
  currentTrackId?: string,
  recentTrackIds: string[] = [],
  count?: number,
  model?: string
): Promise<import('./types').Track[]> {
  return invoke("smart_queue_next", { currentTitle, currentArtist, currentTrackId, recentTrackIds, count, model });
}

export async function smartQueueCrossfade(
  trackATitle: string,
  trackAId?: string,
  trackBTitle: string = '',
  trackBId?: string,
  model?: string
): Promise<import('./types').CrossfadeSuggestion> {
  return invoke("smart_queue_crossfade", { trackATitle, trackAId, trackBTitle, trackBId, model });
}

export async function smartQueueSequence(
  mode: import('./types').SmartQueueMode,
  durationMinutes?: number,
  intensity?: import('./types').WorkoutIntensity,
  model?: string
): Promise<import('./types').Track[]> {
  return invoke("smart_queue_sequence", { mode, durationMinutes, intensity, model });
}

export async function smartQueueContextual(
  model?: string
): Promise<import('./types').Track[]> {
  return invoke("smart_queue_contextual", { model });
}

// ============================================================================
// Smart Spotify Import (FAZA 4 — D1-D5)
// ============================================================================

/** D1: Smart search for a single Spotify track with AI verification */
export async function smartSearchTrackOnYoutube(
  track: SpotifyTrack,
  model?: string
): Promise<SmartImportResult> {
  return invoke("smart_search_track_on_youtube", { track, model });
}

/** D1+D3: Smart search with fallback to AI-generated alternative queries */
export async function smartSearchTrackWithFallback(
  track: SpotifyTrack,
  model?: string
): Promise<SmartImportResult> {
  return invoke("smart_search_track_with_fallback", { track, model });
}

/** D2: Disambiguate YouTube results for a track via AI */
export async function smartDisambiguateTrack(
  title: string,
  artist: string,
  album: string,
  youtubeResults: [string, string, string, number | null][],
  model?: string
): Promise<DisambiguationResult> {
  return invoke("smart_disambiguate_track", { title, artist, album, youtubeResults, model });
}

/** D3: Get alternative search queries from AI */
export async function smartAlternativeQueries(
  track: SpotifyTrack,
  model?: string
): Promise<AlternativeQueriesResult> {
  return invoke("smart_alternative_queries", { track, model });
}

/** D4: Assess match quality between Spotify track and YouTube result */
export async function smartAssessMatchQuality(
  track: SpotifyTrack,
  youtubeTitle: string,
  youtubeChannel: string,
  youtubeDurationSec?: number,
  model?: string
): Promise<MatchQualityResult> {
  return invoke("smart_assess_match_quality", {
    track,
    youtubeTitle,
    youtubeChannel,
    youtubeDurationSec,
    model,
  });
}

/** D5: Suggest similar tracks when a track can't be found */
export async function smartSuggestSimilarTrack(
  track: SpotifyTrack,
  model?: string
): Promise<SimilarTrackSuggestion> {
  return invoke("smart_suggest_similar_track", { track, model });
}

/** D1 batch: Smart import multiple tracks with progress events */
export async function smartImportBatch(
  tracks: SpotifyTrack[],
  useFallback: boolean = true,
  model?: string
): Promise<SmartImportResult[]> {
  return invoke("smart_import_batch", { tracks, useFallback, model });
}

// ============================================================================
// INSIGHTS & ANALYTICS (FAZA 6 — F1-F10, G1-G9)
// ============================================================================

/** F1: AI listening profile */
export async function insightsListeningProfile(model?: string): Promise<ListeningProfileResponse> {
  return invoke("insights_listening_profile", { model });
}

/** F2: Weekly summary */
export async function insightsWeeklySummary(model?: string): Promise<WeeklySummaryResponse> {
  return invoke("insights_weekly_summary", { model });
}

/** F3: Time patterns */
export async function insightsTimePatterns(model?: string): Promise<TimePatternsResponse> {
  return invoke("insights_time_patterns", { model });
}

/** F4+F5: Stats (non-AI, direct data) */
export async function insightsStats(daysBack?: number): Promise<InsightsStats> {
  return invoke("insights_stats", { daysBack });
}

/** F6: Forgotten gems (AI-enhanced) */
export async function insightsForgottenGems(model?: string): Promise<ForgottenGemsResponse> {
  return invoke("insights_forgotten_gems", { model });
}

/** G1: More like this */
export async function insightsMoreLikeThis(title: string, artist: string, model?: string): Promise<string[]> {
  return invoke("insights_more_like_this", { title, artist, model });
}

/** G2: Artist deep dive */
export async function insightsArtistDeepDive(artist: string, model?: string): Promise<ArtistDeepDiveResponse> {
  return invoke("insights_artist_deep_dive", { artist, model });
}

/** G3: Genre explorer */
export async function insightsGenreExplorer(genre: string, model?: string): Promise<GenreExplorerResponse> {
  return invoke("insights_genre_explorer", { genre, model });
}

/** G5: Because you liked */
export async function insightsBecauseYouLiked(model?: string): Promise<BecauseYouLikedResponse> {
  return invoke("insights_because_you_liked", { model });
}

/** G6: Surprise me */
export async function insightsSurpriseMe(model?: string): Promise<SurpriseMeResponse> {
  return invoke("insights_surprise_me", { model });
}

/** G8: Seasonal recommendations */
export async function insightsSeasonal(model?: string): Promise<SeasonalResponse> {
  return invoke("insights_seasonal", { model });
}

// ============================================================================
// LIBRARY CLEANUP (FAZA 7 — H1-H7)
// ============================================================================

/** H1: Find duplicate tracks */
export async function cleanupFindDuplicates(): Promise<import('./types').DuplicatePair[]> {
  const result: any = await invoke("cleanup_find_duplicates");
  return result.duplicates || [];
}

/** H3: Fix/clean track metadata */
export async function cleanupFixMetadata(): Promise<import('./types').CleanedTrack[]> {
  const result: any = await invoke("cleanup_fix_metadata");
  return result.cleaned || [];
}

/** H3: Apply cleaned metadata */
export async function cleanupApplyMetadata(fixes: import('./types').CleanedTrack[]): Promise<number> {
  return invoke("cleanup_apply_metadata", { fixes });
}

/** H4: Normalize artist names */
export async function cleanupNormalizeArtists(): Promise<import('./types').ArtistNormGroup[]> {
  const result: any = await invoke("cleanup_normalize_artists");
  return result.groups || [];
}

/** H2: Auto-organize library */
export async function cleanupAutoOrganize(): Promise<import('./types').OrganizeSuggestion[]> {
  const result: any = await invoke("cleanup_auto_organize");
  return result.suggestions || result.categories || [];
}

/** H7: Suggest deletions */
export async function cleanupSuggestDeletions(): Promise<{ safe_to_delete: import('./types').DeletionSuggestion[]; keep: string[]; summary: string }> {
  const result: any = await invoke("cleanup_suggest_deletions");
  return {
    safe_to_delete: result.safe_to_delete || [],
    keep: result.keep || [],
    summary: result.summary || '',
  };
}

/** Delete a track */
export async function cleanupDeleteTrack(trackId: string): Promise<void> {
  return invoke("cleanup_delete_track", { trackId });
}

// ============================================================================
// AI CHAT (FAZA 7 — J1-J5)
// ============================================================================

/** J1-J4: Send a chat message */
export async function aiChatSend(message: string, history: import('./types').ChatMessage[]): Promise<string> {
  return invoke("ai_chat_send", { message, history });
}

/** J2: Get track trivia */
export async function aiChatTrivia(title: string, artist: string): Promise<import('./types').TriviaResponse> {
  const result: any = await invoke("ai_chat_trivia", { title, artist });
  return result;
}

/** J5: Music quiz */
export async function aiChatQuiz(): Promise<import('./types').QuizQuestion[]> {
  const result: any = await invoke("ai_chat_quiz");
  // Backend may return { questions: [...] } or a single question object
  let questions: any[] = [];
  if (Array.isArray(result.questions)) {
    questions = result.questions;
  } else if (Array.isArray(result)) {
    questions = result;
  } else if (result.question) {
    // Single question returned as flat object
    questions = [result];
  }
  // Normalize: if "correct" is a string (answer text), convert to index
  return questions.map((q: any) => ({
    question: q.question || '',
    options: q.options || [],
    correct: typeof q.correct === 'number'
      ? q.correct
      : typeof q.correct_answer === 'string'
        ? (q.options || []).indexOf(q.correct_answer)
        : 0,
    explanation: q.explanation || '',
  }));
}

// ============================================================================
// SHARE & SOCIAL (FAZA 8 — K1-K3)
// ============================================================================

/** K1: Generate shareable text for a track */
export async function shareGenerateMessage(title: string, artist: string, mood: string): Promise<import('./types').ShareMessageResponse> {
  return invoke("share_generate_message", { title, artist, mood });
}

/** K2: Generate playlist description */
export async function sharePlaylistDescription(trackList: string): Promise<import('./types').PlaylistDescriptionResponse> {
  return invoke("share_playlist_description", { trackList });
}

/** K3: Year in Review */
export async function shareYearInReview(): Promise<import('./types').YearInReviewResponse> {
  return invoke("share_year_in_review");
}

// ============================================================================
// UTILITIES (FAZA 8 — L1-L3)
// ============================================================================

/** L1: Explain error */
export async function aiExplainError(errorMessage: string): Promise<import('./types').ErrorExplanation> {
  return invoke("ai_explain_error", { errorMessage });
}

/** L2: Settings advice */
export async function aiSettingsAdvice(): Promise<import('./types').SettingsAdviceResponse> {
  return invoke("ai_settings_advice");
}

/** L3: Storage analysis */
export async function aiStorageAnalysis(): Promise<import('./types').StorageAnalysisResponse> {
  return invoke("ai_storage_analysis");
}

/** AI DJ Mode: Get commentary for track transition */
export async function aiDjCommentary(
  prevTitle: string,
  prevArtist: string,
  prevTrackId: string | null,
  nextTitle: string,
  nextArtist: string,
  nextTrackId: string | null,
  style?: string,
  language?: string,
  model?: string
): Promise<import('./types').DjCommentary> {
  return invoke("ai_dj_commentary", {
    prevTitle,
    prevArtist,
    prevTrackId,
    nextTitle,
    nextArtist,
    nextTrackId,
    style,
    language,
    model,
  });
}

/** AI DJ Mode: Get commentary for any trigger event */
export async function aiDjEvent(
  context: import('./types').DjEventContext
): Promise<import('./types').DjCommentary> {
  return invoke("ai_dj_event", { context });
}

/** Get total play count across all tracks */
export async function getTotalPlayCount(): Promise<number> {
  return invoke("get_total_play_count");
}

// ============================================================================
// SEMANTIC SEARCH
// ============================================================================

export async function semanticSearch(
  query: string,
  limit?: number
): Promise<SemanticSearchResult[]> {
  return invoke("semantic_search", { query, limit });
}

export async function semanticSearchFiltered(
  query: string,
  limit?: number,
  genres?: string[],
  moods?: string[],
  activities?: string[]
): Promise<SemanticSearchResult[]> {
  return invoke("semantic_search_filtered", {
    query,
    limit,
    genres,
    moods,
    activities,
  });
}

export async function createSemanticPlaylist(
  query: string,
  playlistName?: string
): Promise<SemanticPlaylistResult> {
  return invoke("create_semantic_playlist", {
    query,
    playlistName,
  });
}

export async function semanticIndexAll(): Promise<SemanticIndexStatus> {
  return invoke("semantic_index_all");
}

export async function semanticIndexTrack(
  trackId: string
): Promise<boolean> {
  return invoke("semantic_index_track", { trackId });
}

export async function getSemanticStatus(): Promise<SemanticIndexStatus> {
  return invoke("get_semantic_status");
}

export async function semanticClearIndex(): Promise<void> {
  return invoke("semantic_clear_index");
}
