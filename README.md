# 🎵 YTM Free

A personal YouTube Music alternative built with **Tauri 2.x**, **React**, and **Rust**. Stream music for free using yt-dlp as the backend - no subscriptions needed!

![YTM Free](https://img.shields.io/badge/version-1.0.0-blue) ![Tauri](https://img.shields.io/badge/Tauri-2.x-orange) ![License](https://img.shields.io/badge/license-Personal%20Use-green)

## 📌 Status

This is a personal-use v1.0.0 release. Core playback (search, stream, download, playlists,
favorites, import) and the AI features below are implemented and covered by unit/integration
tests and quality gates passed on the exact v1.0.0 release commit. Full end-to-end runtime proof — a single continuous
search → playback → real download → organize into a playlist → close → restart → persistence
pass, plus NSIS install/uninstall and application-config deletion — has been demonstrated
against the exact tagged `v1.0.0` build. Exhaustive per-feature runtime verification of every
one of the ~110 AI functions is still **not** claimed by this document — see **Known
Limitations** below and `PROJECT_STATE.md` in the repository for the dated, evidence-backed
status of individual subsystems.

## ✨ Features

### Core
- 🔍 **YouTube Search** - Search and stream any music from YouTube
- 📻 **Free Streaming** - No Spotify/Apple Music subscription needed
- 💾 **Offline Downloads** - Download tracks for offline listening
- 📋 **Playlists** - Create and manage unlimited playlists
- ❤️ **Favorites** - Quick access to your liked songs
- 🔄 **Queue Management** - Shuffle, repeat, and queue controls
- 📥 **Spotify Import** - Import playlists from Spotify CSV exports with AI-powered smart matching
- 🎨 **Modern UI** - Clean, YouTube Music-inspired dark interface
- 🪶 **Lightweight** - Native desktop performance with Tauri

### AI-Powered (Ollama) — optional

Everything in **Core** above works fully without Ollama installed or running. The features
below require a local Ollama instance (see Prerequisites); if Ollama is not installed or not
running, the app still starts and functions normally, and these sections show as unavailable
instead of failing the app.
- 🧠 **Smart Search** - Mood, activity, era, lyric & cross-language search pills (A1-A10)
- 🏷️ **Auto-Tagging** - Automatic genre, mood, energy, tempo, decade tagging via LLM (B1-B13)
- ✨ **Smart Autocomplete** - AI-enhanced search suggestions with type badges
- 🎵 **Smart Playlists** - AI-generated playlists by mood, activity, seed track + Daily Mix (C1-C12)
- 🔀 **Smart Queue / AutoDJ** - Wake Up, Sleep Timer, Workout & Context-Aware modes (I1-I6)
- ⌨️ **Natural Language Commands** - Ctrl+K command bar with RO+EN support (E1-E14)
- 💬 **AI Chat** - Conversational music assistant, trivia & quiz (J1-J5)
- 📊 **Insights & Analytics** - Listening profile, weekly summary, hourly breakdown, streaks (F1-F10)
- 💡 **AI Recommendations** - Artist Deep Dive, Genre Explorer, Surprise Me, Seasonal picks (G1-G9)
- 🧹 **Library Cleanup** - Duplicate detection, title cleanup, artist normalization, auto-organize (H1-H7)
- 📤 **Share & Social** - AI-generated share messages, playlist descriptions, Year in Review (K1-K3)
- 🛠️ **AI Utilities** - Error explainer, settings advisor, storage analyzer (L1-L3)

### Semantic Search (Vector-Based, FAZA 9)
- 🧠 **Semantic Library Search** - Find music using natural language descriptions from your library
- 📊 **Real-time Indexing Progress** - Visual progress bar with ETA during vector indexing
- ⚡ **Lightning-Fast Vector Index** - In-memory ANN index (no external dependencies) for 20k+ tracks
- 🎯 **Multi-Dimensional Filtering** - Filter semantic results by genre, mood, activity, energy level
- 🎵 **Semantic Playlist Generation** - Auto-create thematic playlists from semantic queries
- 💾 **Metadata Caching** - O(1) filter lookups, ~1000x faster filtering than DB queries

### AI Radio Host (FAZA 11)
- 🎙️ **AI DJ Companion** - Contextual AI commentary while listening to your music
- 📻 **9 Smart Triggers** - TrackStart, TrackEnd, QueueEmpty, LongSession, FirstTrackOfDay, Milestone, TimeAnnouncement, MoodShift, UserRequest
- 🔊 **Web Speech TTS** - Natural-sounding voice narration using browser speech synthesis
- ⏱️ **Intelligent Cooldown** - 60-second global cooldown + per-trigger customization to avoid over-commenting
- 🎯 **Per-Trigger Toggles** - Enable/disable individual DJ features in Settings
- 🎉 **Context-Aware Commentary** - DJ reacts to song starts, queue status, time of day, mood changes, and milestones

## 🛠️ Prerequisites

### 1. Install yt-dlp

**Windows (winget):**
```bash
winget install yt-dlp
```

**Windows (pip):**
```bash
pip install yt-dlp
```

**macOS (Homebrew):**
```bash
brew install yt-dlp
```

**Linux:**
```bash
sudo apt install yt-dlp
# or
pip install yt-dlp
```

**Verify the install** (required before search/stream/download will work):

```bash
yt-dlp --version
```

### 2. Install Development Tools

- **Node.js** 18+ - [nodejs.org](https://nodejs.org/)
- **Rust** - [rustup.rs](https://rustup.rs/)
- **Tauri CLI**: `cargo install tauri-cli`

### 3. Install Ollama (Optional - for AI features)

Download from [ollama.com](https://ollama.com/) and install a model:
```bash
ollama pull deepseek-v3.1:671b-cloud
# or any other model
ollama pull llama3.2:3b
```

## 🚀 Quick Start

### Clone and Setup

```bash
# Clone the repository
git clone <your-repo-url>
cd ytm-free

# Install Node dependencies
npm install

# Run in development mode
npm run tauri dev
```

### Build for Production

```bash
# Build optimized release
npm run tauri build
```

The built application will be in `src-tauri/target/release/`.

## 📁 Project Structure

```
ytm-free/
├── src/                    # React frontend
│   ├── components/         # UI components
│   │   ├── views/          # 14 page views
│   │   │   ├── HomeView.tsx          # Home + Daily Mix + contextual suggestions
│   │   │   ├── SearchView.tsx        # Search + AI smart search pills + Semantic mode
│   │   │   ├── LibraryView.tsx       # Library + AI tag filters
│   │   │   ├── PlaylistsView.tsx     # Playlist management
│   │   │   ├── PlaylistView.tsx      # Single playlist view
│   │   │   ├── SmartPlaylistView.tsx  # AI playlist wizard (5 methods)
│   │   │   ├── SmartQueueView.tsx    # AI queue (Wake Up/Sleep/Workout/Smart Mix)
│   │   │   ├── InsightsView.tsx      # Analytics dashboard (4 tabs)
│   │   │   ├── LibraryCleanupView.tsx # AI cleanup tools (5 tabs)
│   │   │   ├── AIChatView.tsx        # Conversational AI (Chat/Trivia/Quiz)
│   │   │   ├── FavoritesView.tsx     # Liked songs
│   │   │   ├── DownloadsView.tsx     # Downloaded tracks
│   │   │   ├── ImportView.tsx        # Spotify CSV import (Standard/Smart AI)
│   │   │   └── SettingsView.tsx      # Settings + AI advisor + storage + DJ triggers + semantic indexing
│   │   ├── Header.tsx      # Search header + AI autocomplete
│   │   ├── Sidebar.tsx     # Navigation + AI status indicator
│   │   ├── Player.tsx      # Audio player + controls + AI DJ commentary
│   │   ├── TrackCard.tsx   # Track item + AI badges + share
│   │   ├── CommandBar.tsx  # Natural language command palette (Ctrl+K)
│   │   ├── Toast.tsx       # Global toast notifications
│   │   ├── ErrorBoundary.tsx # Error boundary for AI views
│   │   └── AddToPlaylistModal.tsx # Playlist picker
│   ├── hooks/
│   │   ├── useCommandExecutor.ts # Command execution hook
│   │   └── useTriggerEngine.ts   # AI DJ trigger detection (FAZA 11)
│   ├── api.ts              # Tauri API bindings (92+ functions)
│   ├── store.ts            # Zustand state management
│   ├── types.ts            # TypeScript types (95+ interfaces)
│   └── App.tsx             # Main app + routing + Ollama health polling
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── lib.rs          # Tauri commands (92 total: 89 previous + 3 DJ mode)
│   │   ├── db.rs           # SQLite operations (46+ methods)
│   │   ├── ytdlp.rs        # yt-dlp wrapper
│   │   ├── server.rs       # HTTP streaming (Axum, port 3456)
│   │   ├── models.rs       # Data models (130+ structs)
│   │   ├── semantic.rs     # Vector ANNIndex for semantic search (FAZA 9)
│   │   ├── spotify_import.rs # Spotify CSV import + smart matching
│   │   └── ollama/         # AI integration
│   │       ├── mod.rs      # Module exports
│   │       ├── client.rs   # Ollama HTTP client + caching + embeddings
│   │       └── prompts.rs  # LLM prompt templates (72 prompts: 64 original + 8 DJ)
│   ├── Cargo.toml          # Rust dependencies
│   └── tauri.conf.json     # Tauri config
├── docs/                   # Project documentation (FAZA 0-11 complete)
│   ├── FAZA_0_COMPLETE.md
│   ├── FAZA_1_COMPLETE.md
│   ├── ...
│   ├── FAZA_9_COMPLETE.md  # Advanced Semantic Search
│   ├── FAZA_11_COMPLETE.md # NEW: AI Radio Host with Trigger Engine
│   ├── FAZA_9_TEST_PLAN.md # Semantic Search Testing
│   ├── IMPLEMENTATION_SUMMARY_COMPLETE.md # Final status report
│   └── (test plans)
└── package.json            # Node dependencies
```

## 🔧 How It Works

### Architecture

```
┌─────────────────┐     ┌──────────────────┐
│   React UI      │────▶│  Tauri Commands  │
│   (Frontend)    │◀────│  (IPC Bridge)    │
└─────────────────┘     └──────────────────┘
                               │
    ┌──────────────┬───────────┼──────────┬──────────────┐
    ▼              ▼           ▼          ▼              ▼
┌─────────┐  ┌──────────┐  ┌────────┐  ┌────────┐  ┌────────┐
│ yt-dlp  │  │ SQLite   │  │ HTTP   │  │ Ollama │  │Spotify │
│ Search  │  │ Database │  │ Stream │  │ AI/LLM │  │ Import │
└─────────┘  └──────────┘  └────────┘  └────────┘  └────────┘
```

### Key Components

1. **yt-dlp Integration** (`ytdlp.rs`)
   - Searches YouTube via `ytsearch10:`
   - Extracts audio stream URLs
   - Downloads tracks as MP3

2. **HTTP Streaming Server** (`server.rs`)
   - Axum-based local server on port 3456
   - Caches audio URLs (5-minute TTL)
   - CORS-enabled for frontend access

3. **SQLite Database** (`db.rs`)
   - Tracks, playlists, settings
   - Play counts, favorites, history
   - Stored in app data directory

4. **React Frontend**
   - Zustand for state management
   - Tailwind CSS for styling
   - Native HTML5 audio player

5. **Ollama AI Integration** (`ollama/`)
   - Smart Search: mood, activity, era, lyric, cross-language pills
   - Smart Autocomplete: AI-powered search suggestions
   - Auto-Tagging: genre, mood, energy, tempo, decade classification
   - Smart Playlists: AI-generated playlist wizard + Daily Mix
   - Smart Queue / AutoDJ: Wake Up, Sleep, Workout, Context-Aware modes
   - AI Chat: Music Q&A, Track Trivia, Music Quiz
   - Library Cleanup: Duplicate detection, title cleanup, artist normalization
   - Insights: Listening profile, weekly summary, forgotten gems, recommendations
   - Share & Social: AI share messages, playlist descriptions, Year in Review
   - Natural Language Commands: Ctrl+K command bar (RO+EN)
   - 61 prompt templates for AI tasks
   - Health polling with brain icon indicator

## 📋 Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Build frontend |
| `npm run tauri dev` | Run app in development |
| `npm run tauri build` | Build production app |

## ⚙️ Configuration

### Settings (in-app)

- **Audio Quality**: Low/Medium/High/Best
- **Download Location**: Custom path for offline tracks
- **Auto-download**: Automatically download playlist tracks
- **Crossfade**: Smooth transitions between songs
- **Theme**: Dark/Light/System

### Data Locations

| Platform | Database | Downloads |
|----------|----------|-----------|
| Windows | `%APPDATA%\ytm-free\` | `%USERPROFILE%\Music\YTM-Free\` |
| macOS | `~/Library/Application Support/ytm-free/` | `~/Music/YTM-Free/` |
| Linux | `~/.local/share/ytm-free/` | `~/Music/YTM-Free/` |

### Environment Variable Overrides (isolation / testing)

Two environment variables let you redirect the app's data away from the default locations
above, useful for running an isolated instance without touching your real library:

| Variable | Overrides |
|----------|-----------|
| `YTM_FREE_DATA_DIR` | SQLite database directory (the `Database`/AppData path). Unset or empty falls back to the default platform data directory. |
| `YTM_FREE_DOWNLOAD_DIR` | Directory downloaded audio files are written to. Unset or empty falls back to the default platform downloads/audio directory. |

Both must be set in the environment of the process that launches the app (they are read once
at startup, not from a config file).

## 🔒 Privacy & Legal

- **Personal Use Only**: This app is for personal, non-commercial use
- **No Data Collection**: All data stays on your device
- **Respects ToS**: Uses official yt-dlp tool within fair use guidelines
- **No API Keys**: No YouTube API keys required

## ⚠️ Known Limitations

- The full user flow (search → playback → real download → organize into a playlist → close →
  restart → persistence) has been runtime-verified against the exact tagged `v1.0.0` release
  build: NSIS install and installed-runtime validation **PASS**, the complete flow **PASS**,
  NSIS uninstall and application-config deletion **PASS**, download preservation **PASS**. The
  source EXE and the installed EXE are not claimed to be byte-identical. During this validation
  a real-user-data incident occurred and was recovered — see `REAL_USER_DATA_INCIDENT` below.
- MSI was built and SHA-256 hashed for this release but was **not runtime-tested** against the
  exact `v1.0.0` build (NSIS was the installer exercised end-to-end).
- The AI-Powered feature set is broad (~110 functions across search, tagging, playlists, DJ
  commentary, insights, chat, cleanup, and sharing). Representative flows in each family have
  been runtime-verified through real Tauri/Ollama IPC; the full set remains representative
  coverage only, not exhaustively runtime-exercised end-to-end.
- **REAL_USER_DATA_INCIDENT: DETECTED_AND_RECOVERED.** During exact-release runtime validation,
  the real AppData database was briefly opened and its content altered outside the isolated test
  environment; this was detected, the modified file preserved as evidence, and the real database
  restored from a SHA-256-verified backup. See `PROJECT_STATE.md` for the full record — this is
  not to be read as "no incident occurred."
- There is no CI. Quality gates (typecheck, lint, unit/integration tests, `cargo fmt`/`clippy`)
  are run manually before each release; nothing enforces them automatically on every commit.

## 🐛 Troubleshooting

### "yt-dlp not found"
Ensure yt-dlp is installed and in your PATH:
```bash
yt-dlp --version
```

### Audio not playing
Check that the streaming server started (port 3456):
```bash
curl http://localhost:3456/health
```

### Search returns no results
Update yt-dlp to the latest version:
```bash
yt-dlp -U
```

## 🤝 Contributing

This is a personal project, but feel free to fork and customize!

## 📄 License

For personal use only. Not for distribution or commercial use.

---

Built with ❤️ using Tauri, React, and Rust
