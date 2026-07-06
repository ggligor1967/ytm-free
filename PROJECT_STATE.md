# PROJECT_STATE — YTM Free

> Single source of truth for "what actually works right now".
> Every claim below is dated and backed by a command. When you re-verify, update the date and result — never leave a stale ✅.
> If this file disagrees with any other doc (README, docs/FAZA_*, CHANGELOG), **this file wins**; update the other doc or flag it.

**Last full verification:** 2026-07-06 (Claude Code session, Windows 11, local machine)

## What the project is

Personal-use desktop music player: Tauri 2.x shell, React 18 + TypeScript + Zustand + Tailwind frontend, Rust backend (SQLite via rusqlite, Axum streaming server on port 3456, yt-dlp for YouTube search/stream/download, Ollama client for ~97 local-AI features). Package manager: **npm** (package-lock.json committed). Repo lives at `C:\Users\gglig\.ytm-free` (yes, a dot-directory in the user profile — this is the real working copy, not a config dir).

## Verified working (2026-07-06)

| Claim | Evidence |
|---|---|
| TypeScript compiles, 0 errors | `npx tsc --noEmit` → exit 0 |
| Frontend production build works | `npm run build` → vite built dist/ in 17.77s, 420 kB JS |
| Frontend tests: 31/32 pass | `npm test` → 1 failed (timeout), 31 passed |
| The 1 failing test is timeout-flaky, not broken | `npx vitest run src/__tests__/LibraryView.test.tsx -t "handles 1000 tracks"` → passes in isolation (needs >5s under full-suite load; vitest default timeout is 5s) |
| yt-dlp installed | `yt-dlp --version` → 2026.02.04 |
| Node v22.22.2 / npm 11.7.0 / rustc+cargo 1.94.1 | `--version` commands |

## Verified BROKEN (2026-07-06)

| Problem | Evidence |
|---|---|
| **Rust cannot compile at all on this machine** — no `cargo test`, no `npm run tauri dev`, no `tauri build` | `cargo test` in `src-tauri/` → `LNK1181: cannot open input file 'dbghelp.lib'` on every build script (MSVC 14.50.35717, VS 18 BuildTools) |
| Root cause: Windows SDK 10.0.28000.0 is a **partial install** — `um/x64` has 115 libs vs 481 in SDK 10.0.26100.0, and `dbghelp.lib` is missing from it; the toolchain auto-selects the newest SDK | `ls "C:\Program Files (x86)\Windows Kits\10\Lib\10.0.28000.0\um\x64"` (115 files) vs `...\10.0.26100.0\um\x64` (481 files, contains dbghelp.lib) |

Fix procedure: see `docs/RECOVERY_PLAN.md`. The 28 Rust `#[test]` functions (db.rs: 8, semantic.rs: 5, spotify_import.rs: 7, ollama/client.rs: 6, ollama/prompts.rs: 2) were last known green around 2026-04-30 (target/debug artifacts exist from then) but are **unverifiable until the toolchain is fixed**.

## Never verified (open since project start)

- End-to-end app run (search → stream → download → playlist) — ROADMAP_STATUS.md item 1, "NEFACUT". `verify.sh` exists for a smoke check but depends on the broken Rust build.
- `npm run tauri build` (production bundle) — blocked by the same toolchain issue since ~Feb 2026.
- Ollama-dependent features against a live Ollama instance.

## Git state (2026-07-06)

- `main` @ 65c6e6b == `origin/main`. **`main` is the real trunk.**
- **Trap:** GitHub's default branch (`origin/HEAD`) is `phase-2-frontend-bugs`, which is stale (main is 9 ahead). PRs and clones default to the wrong branch until this is changed on GitHub.
- 4 merged-and-stale feature branches remain (debt/cleanup-sprint, faza-3/*, faza-4/*, phase-2-frontend-bugs) — squash-merge workflow, so their commits are not ancestors of main.
- Untracked, uncommitted work: `gdpr-compliance-audit-report.md`, `docs/GDPR_REMEDIATION_PLAN.md` (status: DRAFT, awaiting owner approval), `docs/plan-remediere-gdpr-complete.md`, `.omx/` (agent session state — do not commit).
- `Cargo.lock` is **gitignored** (see .gitignore). For an application this breaks reproducible Rust builds — known debt, decision pending.
- `Spotify/*.csv` (personal listening exports) are tracked in git — flagged by the GDPR audit.

## Known-stale documents — do not trust their status claims

| Doc | Stale claim | Reality |
|---|---|---|
| `docs/FINAL_STATUS_97_FUNCTIONS_COMPLETE.md` (2026-02-14) | "Build Status: ✅ Production-Ready" | Production build has never succeeded; Rust build currently broken |
| `docs/IMPLEMENTATION_SUMMARY_COMPLETE.md` (2026-02-14) | "Production-Ready" | Same |
| `docs/CHANGELOG.md` (2026-02-14) | "Status: Production-Ready ✅" | Same |
| `README.md` (2026-02-14) | "92 Tauri commands" | `grep -c '#\[tauri::command\]' src-tauri/src/lib.rs` → 112 |
| `.github/agents/GaborAI.agent.md` | — | Unfilled template, no content |

`docs/ROADMAP_STATUS.md` (2026-04-30, in Romanian) is the most honest status doc and matches command evidence.

## How to update this file

Run `docs/VERIFICATION_PROTOCOL.md`, record results in an evidence ledger (`docs/EVIDENCE_LEDGER_TEMPLATE.md`), then update the tables above with new dates. Never mark something working without the command output in hand.
