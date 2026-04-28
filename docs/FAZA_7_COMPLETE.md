# FAZA 7 — Organizare, Smart Queue & AI Chat ✅ COMPLETE

## Summary

FAZA 7 implementează toate cele 3 grupuri de funcționalități rămase:
- **H1–H7**: Library Cleanup — AI-powered tools for organizing and cleaning the music library
- **I1–I6**: Smart Queue / AutoDJ — Intelligent queue generation with 4 modes
- **J1–J5**: AI Chat — Conversational music assistant with trivia and quiz

---

## H: Library Cleanup (H1–H7) ✅

### H1 — Detect Duplicates ✅
- **Backend**: `cleanup_find_duplicates` command — uses `detect_duplicates` prompt to find similar/duplicate tracks with similarity %
- **Frontend**: `cleanupFindDuplicates()` API, DuplicatesPanel tab in LibraryCleanupView
- **Types**: `DuplicatePair` (track_a_id, track_b_id, track_a_title, track_b_title, similarity, reason)

### H3 — Clean Metadata / Fix Titles ✅
- **Backend**: `cleanup_fix_metadata` command — AI removes "(Official Video)", "[HQ]", etc. from titles + `cleanup_apply_metadata` to persist fixes
- **Frontend**: `cleanupFixMetadata()` + `cleanupApplyMetadata()` APIs, CleanTitlesPanel with before→after preview
- **Types**: `CleanedTrack` (track_id, clean_title, clean_artist, original_title, original_artist)

### H4 — Normalize Artists ✅
- **Backend**: `cleanup_normalize_artists` command — merges artist name variants (e.g., "AC/DC" vs "ACDC")
- **Frontend**: `cleanupNormalizeArtists()` API, NormalizePanel with canonical name + variant chips
- **Types**: `ArtistNormGroup` (canonical, variants)

### H2 — Auto-Organize ✅
- **Backend**: `cleanup_auto_organize` command — AI suggests playlist categories for all tracks
- **Frontend**: `cleanupAutoOrganize()` API, OrganizePanel with category cards + track chips
- **Types**: `OrganizeSuggestion` (category, description, track_ids)

### H5 — Album Grouping ✅
- **Backend**: `suggest_album_grouping` prompt in prompts.rs — suggests grouping tracks by album
- **Integrated**: Via auto-organize flow

### H6 — Duplicate Detection (Extended) ✅
- **Backend**: Covered by H1's `detect_duplicates` — includes cover versions, remixes, live versions
- **UI**: DuplicatesPanel shows similarity % and reason per pair

### H7 — Suggest Deletions ✅
- **Backend**: `cleanup_suggest_deletions` command — finds never-played tracks safe to remove + `cleanup_delete_track` for actual deletion
- **Frontend**: `cleanupSuggestDeletions()` + `cleanupDeleteTrack()` APIs, DeletionsPanel with safe-to-delete list + keep list
- **Types**: `DeletionSuggestion` (track_id, title, artist, reason)

---

## I: Smart Queue / AutoDJ (I1–I6) ✅

### I1 — Smart Auto-Play ✅
- **Backend**: `smart_queue_next` command — AI picks next N tracks from library based on current track's metadata (genre, mood, energy), avoiding recently played
- **Frontend**: `smartQueueNext()` API, used in SmartQueueView contextual mode
- **Algorithm**: Builds library summary, sends to Ollama with current track context → returns ordered track IDs

### I2 — Crossfade Suggestion ✅
- **Backend**: `smart_queue_crossfade` command — AI suggests optimal crossfade duration between two tracks based on genre/energy/tempo
- **Frontend**: `smartQueueCrossfade()` API
- **Types**: `CrossfadeSuggestion` (duration_seconds, reason)

### I3 — Wake-Up Sequence ✅
- **Backend**: `smart_queue_sequence(mode="wake_up")` — generates an energizing sequence that gradually increases energy
- **Frontend**: SmartQueueView Wake Up mode with duration picker (15-120 min)
- **UI**: Energy gradient bars showing progression from low→high energy

### I4 — Sleep Timer Sequence ✅
- **Backend**: `smart_queue_sequence(mode="sleep")` — generates relaxing sequence for bedtime
- **Frontend**: SmartQueueView Sleep mode with duration picker
- **UI**: Energy gradient bars showing progression from medium→low energy

### I5 — Workout Pacer ✅
- **Backend**: `smart_queue_sequence(mode="workout", intensity)` — generates high-energy sequence matched to workout intensity
- **Frontend**: SmartQueueView Workout mode with duration + intensity picker (low/medium/high)
- **UI**: Workout intensity emoji cards (🏃‍♂️💪🔥)

### I6 — Context-Aware Autoplay ✅
- **Backend**: `smart_queue_contextual` command — uses current hour, day of week, and listening history to auto-select tracks
- **Frontend**: `smartQueueContextual()` API, SmartQueueView "Smart Mix" mode (skips config, generates immediately)
- **Algorithm**: Detects time of day + day of week + recent history → contextual selection

### Smart Queue UI Features
- **4-mode selector**: Wake Up, Sleep Timer, Workout, Smart Mix
- **3-step wizard**: Select mode → Configure (duration/intensity) → Preview & apply
- **Auto-Play toggle**: Continuous smart queue mode
- **Preview**: Numbered track list with energy indicators
- **Actions**: Play Now, Add to Queue, Regenerate

---

## J: AI Chat (J1–J5) ✅

### J1 — Music Q&A ✅
- **Backend**: `ai_chat_send` command — conversational chat with library context + current track via `chat_system` prompt
- **Frontend**: `aiChatSend()` API, main chat mode in AIChatView
- **UX**: Free-form text input, message bubbles (user/assistant), suggested prompts for new users

### J2 — Track Trivia ✅
- **Backend**: `ai_chat_trivia` command — generates trivia about a specific track via `track_trivia` prompt
- **Frontend**: `aiChatTrivia()` API, Trivia mode button in AIChatView header
- **Types**: `TriviaResponse` (album, year, facts[], fun_fact)
- **UX**: Formatted trivia card with album, year, facts list, and highlighted fun fact

### J3 — Recommendation Dialog ✅
- **Backend**: Handled via `ai_chat_send` with conversation history — iterative recommendation through natural language
- **Frontend**: Chat interface maintains full conversation context for multi-turn recommendations

### J4 — Help Assistant ✅
- **Backend**: `chat_system` prompt includes library summary + available features context
- **Frontend**: Suggested prompts include "What can you do?" and feature discovery questions

### J5 — Music Quiz ✅
- **Backend**: `ai_chat_quiz` command — generates quiz questions from user's library via `music_quiz` prompt
- **Frontend**: `aiChatQuiz()` API, Quiz mode in AIChatView
- **Types**: `QuizQuestion` (question, options[], correct_index, explanation)
- **UX**: Multiple-choice quiz with color-coded feedback (green correct / red wrong), score tracking, explanations per question

### AI Chat UI Features
- **3 modes**: Chat, Trivia, Quiz (tab selector in header)
- **Chat**: Message bubbles with avatars, suggested prompts, Enter to send
- **Trivia**: Loads trivia for currently playing track
- **Quiz**: Multi-question quiz with scoring and explanations
- **Clear button**: Reset conversation
- **Scrolling**: Auto-scroll to latest message

---

## Files Modified

| File | Changes |
|------|---------|
| `src-tauri/src/ollama/prompts.rs` | +12 prompt templates (H1-H7: detect_duplicates, clean_metadata, normalize_artists, auto_organize, suggest_deletions, suggest_album_grouping; I1-I6: smart_queue_next, crossfade_suggestion, wake_up_sequence, sleep_timer_sequence, workout_pacer, context_aware_autoplay; J1-J5: chat_system, track_trivia, music_quiz) |
| `src-tauri/src/lib.rs` | +14 Tauri commands + handler registration |
| `src-tauri/src/db.rs` | +delete_track, update_track_metadata_cleanup, get_all_metadata |
| `src/types.ts` | +12 TypeScript types (DuplicatePair, CleanedTrack, ArtistNormGroup, OrganizeSuggestion, DeletionSuggestion, CleanupResult, ChatMessage, TriviaResponse, QuizQuestion, SmartQueueMode, WorkoutIntensity, CrossfadeSuggestion) |
| `src/api.ts` | +13 API wrapper functions |
| `src/store.ts` | +smartQueue* state (active, mode, loading) + chatMessages, addChatMessage, clearChatMessages, chatLoading |
| `src/components/Sidebar.tsx` | Nav items: Smart Queue, Library Cleanup, AI Chat |
| `src/App.tsx` | Routes: smart-queue, library-cleanup, ai-chat (all with ErrorBoundary) |

## Files Created

| File | Purpose |
|------|---------|
| `src/components/views/SmartQueueView.tsx` | Smart Queue wizard UI (~497 lines) |
| `src/components/views/LibraryCleanupView.tsx` | Library Cleanup tabbed UI (~499 lines) |
| `src/components/views/AIChatView.tsx` | AI Chat conversational UI (~366 lines) |

---

## Tauri Commands Added (14)

```
# Library Cleanup (H1-H7)
cleanup_find_duplicates
cleanup_fix_metadata
cleanup_apply_metadata
cleanup_normalize_artists
cleanup_auto_organize
cleanup_suggest_deletions
cleanup_delete_track

# Smart Queue (I1-I6)
smart_queue_next
smart_queue_crossfade
smart_queue_sequence      # Handles I3 (wake_up), I4 (sleep), I5 (workout)
smart_queue_contextual    # I6

# AI Chat (J1-J5)
ai_chat_send              # J1, J3, J4
ai_chat_trivia            # J2
ai_chat_quiz              # J5
```

---

## Verification
- ✅ `cargo check` — no errors
- ✅ `npx tsc --noEmit` — no errors
- ✅ All 14 commands registered in `invoke_handler`
- ✅ All 3 views accessible via Sidebar navigation
- ✅ ErrorBoundary wrapping on all 3 views
