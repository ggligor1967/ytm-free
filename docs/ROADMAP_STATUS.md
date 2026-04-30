# ROADMAP YTM Free - Stare actualizata (30 Apr 2026)

## Progres faze

| Faza | Status | Descriere |
|------|--------|-----------|
| 1 | DONE | Audit exhaustiv |
| 2 | DONE | Frontend bugs (9 fixuri, 32 teste) |
| 2.5 | DONE | Debt sprint |
| 3 | DONE | Smart Playlist UI, HomeView AI, 25 Rust tests |
| 4 | DONE | Client hardening, Settings refactor, DB migrations |
| 5 | DONE | Merge + polish: toast, error callbacks, test fixes |

---

## CORE (Must-have MVP)

| # | Sarcina | Stare | Detalii |
|---|---------|-------|---------|
| 1 | Testare end-to-end | NEFACUT | Necesita Tauri runtime + yt-dlp |
| 2 | Build productie | BLOCAT | dbghelp.lib lipseste din VS toolchain |
| 3 | Documentatie README | NEFACUT | Instalare yt-dlp, troubleshooting, Ollama |

---

## UX and Polish

| # | Sarcina | Stare | Detalii |
|---|---------|-------|---------|
| 4 | Toast-uri erori | DONE | 8 views cu showToast |
| 5 | Error handling | DONE | SmartPlaylistView callbacks + ErrorBoundary |
| 6 | Loading indicators | DONE | Loader2 pe toate views |
| 7 | Recommended section | DONE | HomeView AI recs |
| 8 | More Like This | DONE | SmartPlaylistView cu API |
| 9 | Semantic Search | DONE | SearchView dual mode + progress |
| 10 | Smart Queue | DONE | SmartQueueView |
| 11 | AI Chat | DONE | AIChatView trivia/quiz |
| 12 | Library Cleanup | DONE | Duplicates, metadata, auto-organize |
| 13 | Insights | DONE | 11 endpointuri |
| 14 | Settings refactor | DONE | 5 tab-uri |
| 15 | DJ Mode | DONE | aiDjCommentary + TTS |

---

## Features avansate

| # | Sarcina | Stare | Detalii |
|---|---------|-------|---------|
| 16 | Ollama Caching | PARTIAL | DB table exista, nu integrat in client |
| 17 | ANN Leak Prevention | PARTIAL | LRU eviction default=0 (no limit) |
| 18 | Semantic Batch Indexing | DONE | Progress bar + re-index + clear |
| 19 | Smart Spotify Import | DONE | 7 Rust commands |
| 20 | Voice/TTS | DONE | edge-tts |
| 21 | Ollama Retry/Hardening | DONE | RetryConfig + backoff |
