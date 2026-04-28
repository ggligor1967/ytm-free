Plan: Implementare Completă Funcții Smart Ollama (97 funcții)
TL;DR: Implementarea celor 97 de funcții Smart este structurată în 8 faze incrementale (de la infrastructură la polish), fiecare fază construind pe cea anterioară. Faza 0 rezolvă toate gapurile tehnice descoperite (lipsă frontend API, lipsă tabele DB, lipsă setări Ollama). Fiecare fază ulterioară atacă o familie de funcții, prioritizând impactul asupra utilizatorului. Estimare totală: ~25-35 zile de dezvoltare.

FAZA 0 — INFRASTRUCTURĂ SMART (fundația pentru toate cele 97 funcții)
Această fază este BLOCANTĂ — nimic altceva nu poate fi implementat fără ea.

Step 0.1 — Extindere Schema DB (db.rs)

Adăugare tabel track_metadata cu coloanele: track_id (FK→tracks.id), genre, sub_genre, mood, energy_level (INTEGER 1-10), tempo, danceability (INTEGER 1-10), vocal_type, decade, language, activity_tags (JSON), occasion_tags (JSON), keywords (JSON), ai_description, analyzed_at (TIMESTAMP), model_used
Adăugare tabel play_history cu: id, track_id (FK→tracks.id), played_at (TIMESTAMP), duration_listened (INTEGER seconds), context (JSON — ce view era activ, ora, ziua)
Adăugare tabel ai_cache cu: id, prompt_hash (TEXT UNIQUE), response (TEXT), model (TEXT), created_at, ttl_seconds (INTEGER)
Adăugare coloane Ollama în settings: ollama_enabled (INTEGER DEFAULT 0), ollama_url (TEXT DEFAULT 'http://localhost:11434'), ollama_model (TEXT DEFAULT 'mistral:7b'), smart_search_enabled (INTEGER DEFAULT 1), auto_tagging_enabled (INTEGER DEFAULT 0), smart_queue_enabled (INTEGER DEFAULT 0)
Creare indexuri: idx_track_metadata_genre, idx_track_metadata_mood, idx_track_metadata_energy, idx_play_history_track, idx_play_history_date, idx_ai_cache_hash
Metodă db.migrate_smart_tables() apelată în init_tables() cu CREATE TABLE IF NOT EXISTS
Step 0.2 — DB CRUD pentru Smart (db.rs)

save_track_metadata(track_id, metadata: TrackMetadataAI)
get_track_metadata(track_id) → Option<TrackMetadataAI>
get_tracks_by_mood(mood) → Vec<Track>
get_tracks_by_genre(genre) → Vec<Track>
get_tracks_by_energy_range(min, max) → Vec<Track>
get_unanalyzed_tracks() → Vec<Track>
log_play_event(track_id, duration_listened, context)
get_play_history(days_back, limit) → Vec<PlayEvent>
get_listening_stats(days_back) → ListeningStats
cache_ai_response(prompt_hash, response, ttl)
get_cached_response(prompt_hash) → Option<String>
cleanup_expired_cache()
Step 0.3 — Modele Rust noi (models.rs)

Adăugare struct TrackMetadataDB (versiunea persistată, cu track_id + analyzed_at)
Adăugare struct PlayEvent (id, track_id, played_at, duration_listened, context)
Adăugare struct ListeningStats (total_tracks, total_time, top_genres, top_artists, top_moods, daily_breakdown)
Adăugare în Settings: câmpurile Ollama (ollama_enabled, ollama_url, ollama_model, etc.)
Actualizare Default impl pentru Settings
Step 0.4 — AI Response Caching (client.rs)

Adăugare metode generate_cached(db, prompt, ttl) care verifică cache-ul înainte de a trimite la Ollama
Hash prompt cu sha256 sau simplu hash_map digest
Caching agresiv pentru funcții repetitive (tagging, genre detection)
Step 0.5 — Ollama Client Improvements (client.rs)

Adăugare metode generate_streaming() cu Tauri events pentru progres
Adăugare retry_with_backoff() pentru 429/timeout
Adăugare parameter timeout_override per request
Adăugare batch_generate() pentru procesare multiplă secvențială cu progres
Step 0.6 — TypeScript Types AI (types.ts)

Adăugare tip TrackMetadataAI (genre, sub_genre, mood, energy_level, tempo, danceability, vocal_type, decade, language, activity_tags, occasion_tags, keywords)
Adăugare tip PlaylistSuggestion (name, description, search_queries)
Adăugare tip PlayerCommand cu discriminated union (command: 'play'|'pause'|'next'|...)
Adăugare tip PlayEvent, ListeningStats, OllamaStatus
Extindere Settings cu câmpurile Ollama
Extindere View cu: 'smart-search' | 'ai-chat' | 'insights' | 'smart-playlist'
Step 0.7 — Frontend API Layer (api.ts)

Adăugare secțiune // OLLAMA AI cu wrapper-e pentru TOATE comenzile Ollama
ollamaCheckAvailable(url?), ollamaListModels(url?), ollamaEnhanceSearch(query, genres, model?), ollamaAnalyzeTrack(title, artist, model?), ollamaParseCommand(input, model?), ollamaGeneratePlaylist(desc, duration?, artists, model?)
Funcții noi care vor fi adăugate progresiv pe măsură ce se implementează comenzile Rust
Step 0.8 — Store Extension (store.ts)

Adăugare state: ollamaAvailable: boolean, ollamaModels: string[], aiProcessing: boolean, aiChatMessages: ChatMessage[], trackMetadata: Map<string, TrackMetadataAI>
Adăugare actions: setOllamaAvailable, setAiProcessing, addChatMessage, setTrackMetadata
Step 0.9 — Ollama Settings UI (SettingsView.tsx)

Secțiune nouă "🧠 Smart AI (Ollama)" în Settings
Toggle enable/disable
Input URL server Ollama
Dropdown model selectat (populat de ollamaListModels)
Buton "Test Connection" cu feedback vizual
Sub-toggles: Smart Search on/off, Auto-Tagging on/off, Smart Queue on/off
Status indicator (verde=conectat, roșu=indisponibil) persistent în sidebar
Step 0.10 — Sidebar AI Indicator (Sidebar.tsx)

Adăugare icon "🧠" sau <Brain> lângă logo când Ollama e activ
Adăugare nav item-uri noi sub secțiunea "SMART": AI Chat, Insights, Smart Playlist
Indicator vizual subtil (pulsating dot) când AI procesează
Step 0.11 — Tauri Events System (lib.rs)

Setup app.emit("ai-progress", payload) pattern
Frontend listener listen("ai-progress", callback) în App.tsx
Evenimente: ai-progress (curent/total), ai-tagging-complete, ai-error
Dependență Cargo: Adăugare sha2 în Cargo.toml pentru hashing cache

FAZA 1 — CĂUTARE & DESCOPERIRE (funcțiile A1–A10)
Step 1.1 — Smart Search Backend (prompts.rs)

Prompt template nou: Prompts::mood_search(mood) → query-uri YouTube [A2]
Prompt template: Prompts::activity_search(activity) → query-uri YouTube [A3]
Prompt template: Prompts::era_search(decade) [A4]
Prompt template: Prompts::similar_artists(artist, known_artists) [A5]
Prompt template: Prompts::lyric_search(fragment) [A6]
Prompt template: Prompts::cross_language_search(query, source_lang) [A7]
Prompt template: Prompts::contextual_suggestions(hour, day_of_week, season, recent_genres) [A8]
Prompt template: Prompts::smart_autocomplete(partial_query, library_artists) [A9]
Prompt template: Prompts::resolve_vague_query(description) [A10]
Step 1.2 — Tauri Commands (lib.rs)

ollama_mood_search(mood, model?) → Vec<String>
ollama_activity_search(activity, model?) → Vec<String>
ollama_era_search(decade, model?) → Vec<String>
ollama_similar_artists(artist, model?) → Vec<SimilarArtist>
ollama_lyric_search(fragment, model?) → Vec<String>
ollama_contextual_suggestions(model?) → Vec<String> (ora/ziua auto-detectate)
ollama_autocomplete(partial, model?) → Vec<String>
ollama_resolve_query(description, model?) → Vec<String>
Step 1.3 — SearchView Enhancement (SearchView.tsx)

Sub search bar: pill buttons cu mood-uri rapide (🎉 Party, 😴 Sleep, 💪 Workout, 📚 Study, 🚗 Drive)
Când se scrie un query natural (detectat prin lungime > 3 cuvinte sau keywords speciale): indicator "✨ AI-enhanced search"
Rezultate grupate: "Main Results" + "AI Suggestions"
Toggle ✨ on/off lângă butonul de search
Step 1.4 — Smart Autocomplete (Header.tsx)

Pe onChange cu debounce 500ms: dacă ollamaAvailable, afișează dropdown cu AI autocomplete
Mixing: primele 3 sugestii din librăria locală + 3 sugestii AI
Navigare cu săgeți sus/jos, Enter selectează
Step 1.5 — HomeView Contextual (HomeView.tsx)

Secțiune nouă "🧠 Suggested for you" cu sugestii contextuale (oră/zi)
"Similar to what you've been listening" bazat pe recent tracks
Loading skeleton cu animație shimmer
FAZA 2 — AUTO-TAGGING & CLASIFICARE (funcțiile B1–B13)
Step 2.1 — Extended Prompts (prompts.rs)

Refactor Prompts::analyze_track() pentru a include TOATE câmpurile B1-B11 într-un singur prompt
Format output: { genre, sub_genre, mood, energy_level, tempo, danceability, vocal_type, decade, language, activity_tags[], occasion_tags[], keywords[] }
Prompt optimizat: specific, cu exemple, temperature scăzută (0.2) pentru consistență
Step 2.2 — Batch Tagging Command (lib.rs)

ollama_batch_analyze_tracks(track_ids: Vec<String>) — procesare secvențială cu events progres [B13]
ollama_get_track_metadata(track_id) — return cached sau analyze on-demand
ollama_get_untagged_count() — număr track-uri neanalzate
Background task opțional: la auto_tagging_enabled, analizează track-urile noi automat
Step 2.3 — Library Filter by Tags (LibraryView.tsx)

Adăugare filter bar: dropdown Genre, dropdown Mood, slider Energy (1-10), dropdown Decade
Filtrare client-side pe baza metadata-urilor stocate
Badge-uri vizuale pe TrackCard: gen/mood cu culori codate
Step 2.4 — TrackCard Enhancement (TrackCard.tsx)

Mini-badge-uri sub titlu: gen, mood, energy dot (roșu/galben/verde)
Tooltip cu toate metadata-urile AI
Buton "🏷️ Tag" în context menu dacă track-ul nu e analizat
Step 2.5 — Tag Management View

Secțiune nouă în LibraryView sau tab: "Browse by Tags"
Grid vizual: genuri ca cards cu count track-uri
Click pe gen → filtrare instant
FAZA 3 — PLAYLIST-URI INTELIGENTE (funcțiile C1–C12)
Step 3.1 — Smart Playlist Generator View (fișier nou: src/components/views/SmartPlaylistView.tsx)

Input text liber: "Descrie playlist-ul dorit..." [C1]
Dropdown: Mood preset [C2]
Slider: Durată (15min – 180min) [C3]
Mood transition picker: Start mood → End mood [C4]
Seed tracks selector: drag din librărie [C5]
Preview rezultat înainte de salvare
Buton "✨ Generate" și "🔄 Regenerate"
Step 3.2 — Prompts Playlist (prompts.rs)

Prompts::mood_playlist(mood, library_tracks) → selecție din librărie [C2]
Prompts::duration_playlist(duration_min, theme, library_tracks) [C3]
Prompts::transition_playlist(start_mood, end_mood, library_tracks) [C4]
Prompts::seed_playlist(seed_track_titles, library_or_search) [C5]
Prompts::daily_mix(play_history, library) [C6]
Prompts::discovery_playlist(known_artists, preferred_genres) [C7]
Prompts::name_playlist(track_list) → nume + descriere creativă [C8]
Prompts::describe_playlist_cover(track_list) → prompt imagine [C9]
Prompts::reorder_playlist(tracks_with_metadata) → ordine optimizată [C10]
Prompts::merge_playlists(playlist_a_tracks, playlist_b_tracks) [C11]
Prompts::split_playlist(tracks_with_metadata) → categorii sugerate [C12]
Step 3.3 — Tauri Commands (lib.rs)

Comenzi noi pentru fiecare tip de smart playlist
Pattern comun: LLM generează query-uri → ytdlp::search() pentru fiecare → returnează rezultate combinate
Pentru C2/C3/C4/C10: lucrează cu track-urile existente din DB bazat pe metadata
Step 3.4 — UI Integration PlaylistsView (PlaylistsView.tsx)

Buton "✨ Smart Playlist" lângă "Create Playlist"
Context menu pe playlist existent: "🔄 Reorder Smart", "✂️ Split", "🤖 Rename AI"
Step 3.5 — Daily Mix Auto-generation ✅

La startup (dacă opțional activat): ollama_daily_mix() → playlist temporar "Daily Mix 🧠"
Badge "AI" pe playlist-urile generate automat
FAZA 4 — IMPORT SPOTIFY ÎMBUNĂTĂȚIT (funcțiile D1–D5)
Step 4.1 — Smart Match Backend (spotify_import.rs)

Integrare Prompts::verify_spotify_match() în flow-ul search_youtube_for_track() [D1]
Noua funcție search_youtube_for_track_smart() care: caută YT, trimite top 5 rezultate la LLM, LLM selectează best match cu confidence score
Fallback la metoda veche dacă Ollama indisponibil
Step 4.2 — Noi Prompts (prompts.rs)

Prompts::disambiguate_track(title, artist, results) [D2]
Prompts::alternative_queries(track_name, artist_name, album) [D3]
Prompts::assess_match_quality(spotify_track, youtube_match) [D4]
Prompts::suggest_similar_track(missing_track) [D5]
Step 4.3 — ImportView Enhancement (fișier nou: ImportView.tsx — recreare)

Quality badge per match: 🟢 High / 🟡 Medium / 🔴 Low confidence
Buton "🤖 Smart Re-match" pe track-urile cu Low confidence
Sugestii "Similar tracks" pentru NotFound
Overall import quality score
FAZA 5 — COMENZI LIMBAJ NATURAL (funcțiile E1–E14) ✅
Step 5.1 — Command Parser Enhancement (prompts.rs) ✅

Extindere PlayerCommand enum cu: SetVolume { level: f32 }, AddToQueue, ToggleShuffle, SetRepeat { mode: String }, Navigate { view: String }, Download, MultiCommand { commands: Vec<PlayerCommand> } [E14]
Prompt actualizat cu toate comenzile și exemple în RO + EN
Step 5.2 — Command Bar UI (fișier nou: src/components/CommandBar.tsx) ✅

Overlay activat cu Ctrl+K sau / — stil command palette
Input text natural + rezultat parsesat afișat ca preview
Execuție pe Enter, Cancel pe Escape
Istoric comenzi recente
Animație slide-down
Step 5.3 — Command Executor (fișier nou: src/hooks/useCommandExecutor.ts) ✅

Hook React care primește PlayerCommand parsesat și execută acțiuni corespunzătoare
Mapping: play → setIsPlaying(true) + opțional search, pause → setIsPlaying(false), etc.
Feedback toast: "✓ Added to favorites" / "♫ Playing rock music"
Multi-command support secvențial [E14]
Step 5.4 — Integration in Header (Header.tsx) ✅

Icon "⌨" (Command) lângă search bar care activează command mode
Global shortcut Ctrl+K / — deschide CommandBar
FAZA 6 — ANALIZĂ, INSIGHT-URI & RECOMANDĂRI (funcțiile F1–F10, G1–G9)
Step 6.1 — Play History Tracking (lib.rs)

Modificare update_play_count → adaugă și entry în play_history cu timestamp, durată estimată, context (ora, ziua)
Frontend: trimite context extra la update_play_count
Step 6.2 — Analytics Prompts (prompts.rs)

Prompts::listening_profile(stats: ListeningStats) → text narativ [F1]
Prompts::weekly_summary(stats_7d) → rezumat [F2]
Prompts::time_patterns(hourly_data) [F3]
Prompts::forgotten_gems(old_tracks) [F6]
Prompts::mood_timeline(history_with_moods) [F8]
Prompts::taste_evolution(monthly_stats) [F10]
Prompts::more_like_this(track_title, track_artist) [G1]
Prompts::artist_deep_dive(artist) [G2]
Prompts::genre_explorer(genre) [G3]
Prompts::because_you_liked(favorites_summary) [G5]
Prompts::surprise_me(profile_summary) [G6]
Prompts::seasonal_recommendations(season, preferences) [G8]
Step 6.3 — Insights View (fișier nou: src/components/views/InsightsView.tsx)

Layout dashboard cu cards
"Your Listening Profile" — text AI generat [F1]
"This Week" — rezumat cu stats [F2]
"Forgotten Gems" — tracks neascultate [F6]
"Top Genres" — pie chart simplu CSS [F5]
"Top Artists" — bar chart CSS [F4]
"Listening Streak" — counter cu flame icon [F7]
Buton refresh per secțiune
Step 6.4 — Dependență charting (package.json)

Adăugare recharts sau implementare charts CSS-only (simple bars/pies cu Tailwind)
Preferabil CSS-only pentru a menține bundle-ul mic
Step 6.5 — Recommendations Integration

În HomeView: secțiune "🧠 Recommended for You" cu [G5] results
Pe TrackCard context menu: "Find Similar" → [G1]
Pe artist name click: "Deep Dive" option → [G2]
În Player, buton "💡" lângă track info → "More Like This" [G1]
FAZA 7 — ORGANIZARE, QUEUE INTELIGENT & CHAT (funcțiile H1–H7, I1–I6, J1–J5)
Step 7.1 — Library Cleanup Prompts (prompts.rs)

Prompts::detect_duplicates(track_pairs) → similaritate % [H1, H6]
Prompts::clean_metadata(title, artist) → titlu+artist curățat [H3]
Prompts::normalize_artist(variants) → formă canonică [H4]
Prompts::suggest_album_grouping(tracks_by_artist) [H5]
Prompts::auto_organize(all_tracks_with_metadata) [H2]
Prompts::suggest_deletions(tracks_never_played) [H7]
Step 7.2 — Library Cleanup View (fișier nou: src/components/views/LibraryCleanupView.tsx sau tab în LibraryView)

"🔍 Find Duplicates" → lista perechi cu % similaritate [H1]
"🧹 Clean Titles" → preview batch cu before/after [H3]
"📁 Auto-Organize" → sugestii de playlist-uri noi [H2]
"🗑️ Cleanup Suggestions" → tracks niciodată ascultate [H7]
Acțiuni: Merge duplicates, Apply clean names, Create suggested playlists, Delete
Step 7.3 — Smart Queue (prompts.rs + store.ts)

Prompts::smart_queue(current_track, library_with_metadata, queue_size) → track IDs ordonate [I1]
Modificare playNext() în store: dacă smart_queue_enabled și coada e goală, solicită AI next track
Prompts::crossfade_suggestion(track_a, track_b) → durată crossfade optimă [I2]
Prompts::wake_up_sequence(preferences, duration) [I3]
Prompts::sleep_timer_sequence(library, duration) [I4]
Prompts::workout_pacer(bpm_target, library) [I5]
Prompts::context_aware_autoplay(hour, day, history) [I6]
Step 7.4 — AI Chat View (fișier nou: src/components/views/AIChatView.tsx)

Interfață chat cu mesaje user/AI
Input text cu Enter to send
Funcții: music Q&A [J1], track trivia [J2], recommendation dialog [J3], help [J4]
State: aiChatMessages în store
Backend: ollama_chat(messages: Vec<ChatMessage>) — prompt cu context conversational
Music quiz mode [J5] cu buton "🎮 Start Quiz"
Step 7.5 — Chat Prompts (prompts.rs)

Prompts::chat_system_prompt(library_summary, current_track) — system context
Prompts::track_trivia(title, artist) [J2]
Prompts::music_quiz(library_tracks) [J5]
Prompts::help_assistant(question, available_features) [J4]
FAZA 8 — SOCIAL, UTILITĂȚI & POLISH (funcțiile K1–K3, L1–L3)
Step 8.1 — Share & Social Prompts

Prompts::share_message(track_title, track_artist, mood) → text partajabil [K1]
Prompts::playlist_description(track_list) → descriere atractivă [K2]
Prompts::year_in_review(annual_stats) → narativ "Wrapped" [K3]
Step 8.2 — UI Share

Buton "Share" pe TrackCard → generare text → copy to clipboard
"Year in Review" buton în Insights (disponibil din ianuarie)
Playlist export cu descriere AI
Step 8.3 — Error Handling AI (prompts.rs)

Prompts::explain_error(error_message) → text user-friendly [L1]
Frontend: interceptor global care trimite erori la LLM pentru explicații
Step 8.4 — Settings Advisor

Prompts::settings_advice(current_settings, usage_stats) → sugestii [L2]
Buton "🤖 Optimize Settings" în SettingsView
Step 8.5 — Storage Analyzer

ollama_storage_analysis() → raport vizual despre spațiu utilizat, fișiere nefolosite [L3]
Afișare în SettingsView sau Insights
Step 8.6 — Final Polish

Animații tranziție pentru toate componentele AI (shimmer loading, fade-in rezultate)
Toast notifications pentru acțiuni AI completate
Keyboard shortcuts documentation
Error boundaries pe toate view-urile AI
Performance profiling și optimizare timeout-uri
---

# ✅ STATUS FINAL — TOATE CELE 8 FAZE COMPLETE

**Data completare totală:** 12 Februarie 2026

| Fază | Descriere | Funcții | Status |
|------|-----------|---------|--------|
| FAZA 0 | Infrastructură Smart (DB, Ollama Client, Types, Settings UI) | F0.1–F0.11 | ✅ COMPLET |
| FAZA 1 | Căutare & Descoperire (Smart Search, Autocomplete, Context) | A1–A10 | ✅ COMPLET |
| FAZA 2 | Auto-Tagging & Clasificare (AI Metadata, Batch Analysis, Filters) | B1–B13 | ✅ COMPLET |
| FAZA 3 | Playlist-uri Inteligente (Smart Playlist Wizard, Daily Mix) | C1–C12 | ✅ COMPLET |
| FAZA 4 | Import Spotify Îmbunătățit (Smart Match, Disambiguation, Quality) | D1–D5 | ✅ COMPLET |
| FAZA 5 | Comenzi Limbaj Natural (Command Bar, Multi-Command, RO+EN) | E1–E14 | ✅ COMPLET |
| FAZA 6 | Analiză, Insight-uri & Recomandări (Dashboard, AI Recommendations) | F1–F10, G1–G9 | ✅ COMPLET |
| FAZA 7 | Organizare, Smart Queue & AI Chat (Library Cleanup, AutoDJ, Chat) | H1–H7, I1–I6, J1–J5 | ✅ COMPLET |
| FAZA 8 | Social, Utilități & Polish (Share, Year in Review, Error Explainer) | K1–K3, L1–L3 | ✅ COMPLET |

---

## SUMAR FIȘIERE AFECTATE PER FAZĂ
| Fază | Fișiere noi | Fișiere modificate |
|------|-------------|-------------------|
| F0 | — | db.rs, models.rs, client.rs, lib.rs, types.ts, api.ts, store.ts, SettingsView.tsx, Sidebar.tsx, App.tsx, Cargo.toml |
| F1 | — | prompts.rs, lib.rs, api.ts, SearchView.tsx, Header.tsx, HomeView.tsx |
| F2 | — | prompts.rs, lib.rs, api.ts, LibraryView.tsx, TrackCard.tsx |
| F3 | SmartPlaylistView.tsx | prompts.rs, lib.rs, api.ts, types.ts, store.ts, Sidebar.tsx, App.tsx, PlaylistsView.tsx, HomeView.tsx, SettingsView.tsx |
| F4 | ImportView.tsx (recreare) | spotify_import.rs, prompts.rs, lib.rs, api.ts, types.ts |
| F5 | CommandBar.tsx, useCommandExecutor.ts | prompts.rs, lib.rs, api.ts, types.ts, Header.tsx, App.tsx |
| F6 | InsightsView.tsx | prompts.rs, lib.rs, api.ts, store.ts, Sidebar.tsx, App.tsx, HomeView.tsx, TrackCard.tsx, db.rs |
| F7 | AIChatView.tsx, LibraryCleanupView.tsx, SmartQueueView.tsx | prompts.rs, lib.rs, api.ts, types.ts, store.ts, Sidebar.tsx, App.tsx, db.rs |
| F8 | Toast.tsx, ErrorBoundary.tsx | prompts.rs, lib.rs, api.ts, TrackCard.tsx, SettingsView.tsx, InsightsView.tsx, App.tsx, index.css |

## TAURI COMMANDS — FINAL COUNT

| Categorie | Comenzi | Total |
|-----------|---------|-------|
| YT-DLP | search_youtube, get_track_info, get_stream_url, download_track, check_ytdlp | 5 |
| Playlists | get_playlists, create_playlist, delete_playlist, update_playlist, get_playlist_tracks, add_to_playlist, remove_from_playlist | 7 |
| Library | get_library, get_downloads, get_recently_played, update_play_count, toggle_favorite, get_favorites | 6 |
| Settings | get_settings, update_settings | 2 |
| Spotify Import | parse_spotify_csv, search_track_on_youtube, import_spotify_csv_file, scan_spotify_folder, get_default_spotify_folder, read_csv_file | 6 |
| Ollama Core | ollama_check_available, ollama_list_models, ollama_enhance_search, ollama_analyze_track, ollama_parse_command, ollama_generate_playlist, ollama_verify_spotify_match | 7 |
| Smart Search (F1) | ollama_mood_search, ollama_activity_search, ollama_era_search, ollama_similar_artists, ollama_lyric_search, ollama_cross_language_search, ollama_contextual_suggestions, ollama_smart_autocomplete, ollama_resolve_vague_query | 9 |
| Auto-Tagging (F2) | ollama_get_track_metadata, ollama_get_untagged_count, ollama_batch_analyze_tracks | 3 |
| Smart Playlist (F3) | smart_playlist_generate_plan, smart_playlist_match_library, smart_playlist_from_seed, smart_playlist_save, ollama_daily_mix | 5 |
| Smart Import (F4) | smart_search_track_on_youtube, smart_search_track_with_fallback, smart_disambiguate_track, smart_alternative_queries, smart_assess_match_quality, smart_suggest_similar_track, smart_import_batch | 7 |
| Insights (F6) | insights_listening_profile, insights_weekly_summary, insights_time_patterns, insights_stats, insights_forgotten_gems, insights_more_like_this, insights_artist_deep_dive, insights_genre_explorer, insights_because_you_liked, insights_surprise_me, insights_seasonal | 11 |
| Library Cleanup (F7) | cleanup_find_duplicates, cleanup_fix_metadata, cleanup_apply_metadata, cleanup_normalize_artists, cleanup_auto_organize, cleanup_suggest_deletions, cleanup_delete_track | 7 |
| Smart Queue (F7) | smart_queue_next, smart_queue_crossfade, smart_queue_sequence, smart_queue_contextual | 4 |
| AI Chat (F7) | ai_chat_send, ai_chat_trivia, ai_chat_quiz | 3 |
| Share & Social (F8) | share_generate_message, share_playlist_description, share_year_in_review | 3 |
| Utilities (F8) | ai_explain_error, ai_settings_advice, ai_storage_analysis | 3 |
| **TOTAL** | | **88** |

## FRONTEND API FUNCTIONS — FINAL COUNT: 88

## OLLAMA PROMPTS — FINAL COUNT: 61

## FRONTEND VIEWS — 14 TOTAL
| View | Sidebar | Route | ErrorBoundary |
|------|---------|-------|---------------|
| HomeView | ✅ Home | ✅ | — |
| SearchView | ✅ Search | ✅ | — |
| LibraryView | ✅ Library | ✅ | — |
| PlaylistsView | ✅ Playlists | ✅ | — |
| PlaylistView | — (via click) | ✅ | — |
| SmartPlaylistView | ✅ Smart Playlist | ✅ | ✅ |
| SmartQueueView | ✅ Smart Queue | ✅ | ✅ |
| InsightsView | ✅ Insights | ✅ | ✅ |
| LibraryCleanupView | ✅ Library Cleanup | ✅ | ✅ |
| AIChatView | ✅ AI Chat | ✅ | ✅ |
| FavoritesView | ✅ Favorites | ✅ | — |
| DownloadsView | ✅ Downloads | ✅ | — |
| ImportView | ✅ Import Spotify | ✅ | — |
| SettingsView | — (via gear) | ✅ | — |

## COMPONENTS — 10
| Component | Purpose |
|-----------|---------|
| Header.tsx | Search bar + AI autocomplete + Command Bar button |
| Sidebar.tsx | Navigation + AI status indicator + playlists |
| Player.tsx | Audio player + controls + queue |
| TrackCard.tsx | Track item + AI badges + context menu + share |
| CommandBar.tsx | Natural language command overlay (Ctrl+K) |
| Toast.tsx | Global toast notification system |
| ErrorBoundary.tsx | React error boundary for AI views |
| AddToPlaylistModal.tsx | Playlist picker modal |
| useCommandExecutor.ts | Hook for executing parsed AI commands |

## DECISIONS TAKEN
- Charts: CSS-only Tailwind bars/pies (no external charting library)
- Streaming: Request-response pattern (no streaming for simplicity)
- Prompturi: Limba engleză cu suport RO+EN pentru comenzi
- Cache TTL: 24h tagging, 1h recomandări, 0 chat
- Tagging: Un singur prompt mega (1 request vs 11)
- Smart Queue: Unified `smart_queue_sequence` command handles wake_up/sleep/workout modes