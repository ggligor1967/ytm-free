# ROADMAP YTM Free - Stare actualizata (30 Apr 2026)

## Stare lansare v1.0.0 (31 Iul 2026)

Versiunea aplicatiei a fost aliniata la `1.0.0` (`package.json`, `package-lock.json`,
`src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`). Distinctie pe
niveluri de dovada, per `PROJECT_STATE.md`:

- **Implementat**: toate feature-urile Core si familiile AI (~110 functii) exista in cod si
  sunt legate in UI (`src/api.ts` -> comenzi Tauri -> `src-tauri/src/lib.rs`).
- **Verificat prin quality gates**: `npx tsc --noEmit`, `npm run lint`, `npm test`,
  `npm run build`, `cargo fmt --check`, `cargo clippy --all-targets`, `cargo test` — rulate pe
  commit-ul exact de release (vezi `PROJECT_STATE.md` pentru output-ul datat).
- **Verificat prin runtime pe artefactul exact de release**: se limiteaza la ce este consemnat
  explicit in `PROJECT_STATE.md` pentru SHA-ul de release si tag-ul `v1.0.0`; nu se extinde
  automat la commit-uri anterioare sau ulterioare.
- **Familii AI optionale — acoperire reprezentativa, nu exhaustiva**: cautare semantica,
  playlist semantic, DJ Radio Host, chat/insights/cleanup au fost verificate runtime prin
  fluxuri reprezentative (Tauri IPC + Ollama real) pe SHA-uri istorice specifice, nu functie cu
  functie pe fiecare din cele ~110 comenzi.
- **E2E exact-release**: PASS. Fluxul complet cautare -> redare -> descarcare reala -> organizare
  in playlist -> inchidere -> restart -> persistenta a fost demonstrat pe build-ul exact taguit
  `v1.0.0`.
- **NSIS install/uninstall/stergere configuratie**: PASS. Dezinstalarea cu bifa "Delete
  application data" selectata sterge corect baza de date/configuratia proprie a aplicatiei
  (`ytm-free.db` + `-wal`/`-shm`) si pastreaza descarcarile si datele nelegate — PASS.
- **Persistenta la restart**: PASS. **Pastrarea descarcarilor**: PASS.
- **MSI**: construit si hash-uit pentru acest release, dar **NEVERIFICAT runtime** pe build-ul
  exact `v1.0.0` (doar NSIS a fost rulat end-to-end).
- **Acoperire AI optionala**: ramane reprezentativa, nu exhaustiva (nemodificat fata de mai sus).
- **Propagare variabila de mediu in scenarii exotice** (cai UNC, instalare elevata/reinstalare):
  NEDOVEDIT.
- **REAL_USER_DATA_INCIDENT: DETECTED_AND_RECOVERED** — in timpul validarii pe build-ul exact de
  release, baza de date reala din AppData a fost deschisa si alterata accidental in afara
  mediului izolat de test; a fost detectata, pastrata ca dovada, si restaurata dintr-un backup
  verificat prin SHA-256. Vezi `PROJECT_STATE.md` pentru inregistrarea completa — nu se
  interpreteaza drept "niciun incident".

---

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
| 1 | Testare end-to-end | DONE | E2E complet PASS pe build-ul exact `v1.0.0` (vezi sectiunea de mai sus si `PROJECT_STATE.md`) |
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
