# PROJECT_STATE — YTM Free

> Single source of truth for "what actually works right now".
> Every claim below is dated and backed by a command. When you re-verify, update the date and result — never leave a stale ✅.
> If this file disagrees with any other doc (README, docs/FAZA_*, CHANGELOG), **this file wins**; update the other doc or flag it.

**Last full verification:** 2026-07-06 (Claude Code session, Windows 11, local machine)
**Step-1 re-verification (same day, second session):** the `dbghelp.lib` toolchain block is **bypassable** via a session-only SDK pin — see "Verified BROKEN" table below for the new finding and the changed blocker.
**Step-1B re-verification (same day, third session):** the disk-space blocker is **resolved** (C: now 11.2 GB free). With the SDK 10.0.26100.0 pin, `cargo test` now **compiles and runs** (Finished in 35.98s, only warnings) — but reveals **8 real failures in `db::tests::*`** (20 passed / 8 failed of 28). Rust is no longer BLOCKED-ENV; it is **PASS-COMPILE-BUT-TEST-FAIL**. Root cause is a pre-existing bug in `run_migrations` (version-0 baseline collision), not the toolchain. See "Verified BROKEN" table.
**Step-1C fix verification (same day, fourth session):** the `db::tests` blocker is **resolved** on branch `fix/db-initial-migration-baseline`. `run_migrations` now treats an empty `schema_migrations` table as baseline `-1`, so migration version 0 runs on fresh databases while preserving existing migration history. With the SDK 10.0.26100.0 pin, `cargo test db::tests` → 8 passed and full `cargo test` → 28 passed. Frontend Gate A also passed: `npx tsc --noEmit` exit 0, `npm test` → 32 passed, `npm run build` → built in 6.98s.
**Step-2A runtime startup smoke (same day, fifth session):** first controlled Tauri dev startup is **verified** with the SDK 10.0.26100.0 pin. `npm run tauri dev` started Vite on `http://localhost:5173`, launched `target\debug\ytm-free.exe` with responding window title `YTM Free`, and the Axum stream server listened on `127.0.0.1:3456`; `curl.exe -i http://localhost:3456/health` → `HTTP/1.1 200 OK` / `OK`. This is startup evidence only, not a full search/stream/download/persistence e2e.

## What the project is

Personal-use desktop music player: Tauri 2.x shell, React 18 + TypeScript + Zustand + Tailwind frontend, Rust backend (SQLite via rusqlite, Axum streaming server on port 3456, yt-dlp for YouTube search/stream/download, Ollama client for ~97 local-AI features). Package manager: **npm** (package-lock.json committed). Repo lives at `C:\Users\gglig\.ytm-free` (yes, a dot-directory in the user profile — this is the real working copy, not a config dir).

## Verified working (2026-07-06)

| Claim | Evidence |
|---|---|
| TypeScript compiles, 0 errors | `npx tsc --noEmit` → exit 0 (2026-07-06, 4th session) |
| Frontend production build works | `npm run build` → vite built dist/ in 6.98s, 420.33 kB JS (2026-07-06, 4th session) |
| Frontend tests pass | `npm test` → 5 files passed, 32 tests passed (2026-07-06, 4th session) |
| Known flaky frontend test did not reproduce in the 4th session | Historical: `LibraryView.test.tsx` "handles 1000 tracks" can time out under full-suite load but passes in isolation. Current run: `npm test` → 32/32, so no isolation rerun needed. |
| yt-dlp installed | `yt-dlp --version` → 2026.02.04 |
| Node v22.22.2 / npm 11.7.0 / rustc+cargo 1.94.1 | `--version` commands |
| Rust tests pass with SDK pin (2026-07-06, 4th session) | `vcvarsall.bat x64 10.0.26100.0` then `cargo test db::tests` in `src-tauri/` → 8 passed; full `cargo test` → 28 passed, 0 failed. Only existing dead-code warnings. (Plain `cargo test` without the pin still fails — see BROKEN table.) |
| Tauri dev runtime starts with SDK pin (2026-07-06, 5th session) | `vcvarsall.bat x64 10.0.26100.0` then `npm run tauri dev` → Vite ready at `http://localhost:5173`, `target\debug\ytm-free.exe` running with responding window title `YTM Free`, `Get-NetTCPConnection` shows `127.0.0.1:3456` listening, and `curl.exe -i http://localhost:3456/health` → `HTTP/1.1 200 OK` / `OK`. |

## Verified BROKEN (2026-07-06)

| Problem | Evidence |
|---|---|
| **Rust toolchain `dbghelp.lib` block is BYPASSABLE (verified 2026-07-06, 2nd session)** — a plain `cargo test` still fails with `LNK1181: cannot open input file 'dbghelp.lib'`, but pinning the SDK to 10.0.26100.0 for the session makes the whole tree compile | Plain `cargo test` in `src-tauri/` → `LNK1181: cannot open input file 'dbghelp.lib'` on build scripts (MSVC 14.50.35717, VS 18 BuildTools). With `vcvarsall.bat x64 10.0.26100.0` first → ~280 crates + the `ytm-free` lib compile cleanly (only warnings, no errors). |
| Root cause confirmed unchanged: Windows SDK 10.0.28000.0 is a **partial install** — `um/x64` has 115 libs (no `dbghelp.lib`) vs 481 in SDK 10.0.26100.0 (which has it); the toolchain auto-selects the newest SDK | `ls ...\10.0.28000.0\um\x64\dbghelp.lib` → No such file; `ls ...\10.0.26100.0\um\x64\dbghelp.lib` → exists. Counts: 28000 = 115 libs, 26100 = 481 libs (re-verified 2026-07-06). |
| ~~NEW blocker — disk space (verified 2026-07-06, 2nd session)~~ **RESOLVED 2026-07-06 (3rd session):** C: now has 11.2 GB free; `cargo test` with the SDK pin completed the build (`Finished in 35.98s`) and ran all 28 tests. | (Was) `fsutil volume diskfree C:` → 354.8 MB free; `du -sh src-tauri/target` → 4.7 GB. (Now) `fsutil volume diskfree C:` → Total free 11,994,079,232 bytes (**11.2 GB**). Build artifacts: `src-tauri/target` 4.7G, `node_modules` 171M, `dist` 461K. |
| ~~NEW — 8 real `db::tests::*` failures (verified 2026-07-06, 3rd session)~~ **RESOLVED 2026-07-06 (4th session):** root cause was the version-0 baseline collision in `run_migrations`; fixed by treating an empty `schema_migrations` table as baseline `-1`, so migration 0 runs on fresh databases. | Before fix: `cargo test` (SDK-pinned) → `test result: FAILED. 20 passed; 8 failed`. After fix: `cargo test db::tests` → `8 passed; 0 failed`; full `cargo test` → `28 passed; 0 failed`. |

Fix procedure: see `docs/RECOVERY_PLAN.md`. **Step 1 part 1 (dbghelp.lib) is solved in practice** — either (A) repair/remove the partial Windows SDK 10.0.28000.0 in Visual Studio Installer so a plain `cargo test` works without the pin, or (B) keep using the session pin: run `vcvarsall.bat x64 10.0.26100.0` (from `C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\`) before cargo commands in a given shell. **Step 1 part 2 (disk space) — RESOLVED 2026-07-06 (3rd session):** C: now has 11.2 GB free and the build completed. **Step 1 part 3 (db migration bug) — RESOLVED 2026-07-06 (4th session):** with the SDK pin, the 28 Rust `#[test]` functions (db.rs: 8, semantic.rs: 5, spotify_import.rs: 7, ollama/client.rs: 6, ollama/prompts.rs: 2) now pass. Net: `cargo test` with the SDK pin is **PASS**. A plain, unpinned `cargo test` still needs the SDK 10.0.28000.0 repair/remove described above.

## Never verified (open since project start)

- Full end-to-end app flow (search → stream → download → playlist → restart → data persisted) — ROADMAP_STATUS.md item 1, "NEFACUT". Step 2A verified startup/server/window only; it did not run the full user-flow e2e.
- `npm run tauri build` (production bundle) — still not run in any verified session. Step 2A intentionally did not start production packaging.
- Ollama-dependent features against a live Ollama instance.

## Git state (2026-07-06)

- **`main` is the real trunk.** At the start of Step 2A, local `main` and `origin/main` both pointed at 7271b84ee63ac3062734af8fc9560473f36d33f5. This file may include later local evidence commits not yet pushed.
- **Trap:** GitHub's default branch (`origin/HEAD`) is `phase-2-frontend-bugs`, which is stale (main is 9 ahead). PRs and clones default to the wrong branch until this is changed on GitHub.
- 4 merged-and-stale feature branches remain (debt/cleanup-sprint, faza-3/*, faza-4/*, phase-2-frontend-bugs) — squash-merge workflow, so their commits are not ancestors of main.
- Untracked, uncommitted work: `gdpr-compliance-audit-report.md`, `docs/GDPR_REMEDIATION_PLAN.md` (status: DRAFT, awaiting owner approval), `docs/plan-remediere-gdpr-complete.md`, `.omx/` (agent session state — do not commit).
- `Cargo.lock` is **gitignored** (see .gitignore). For an application this breaks reproducible Rust builds — known debt, decision pending.
- `Spotify/*.csv` (personal listening exports) are tracked in git — flagged by the GDPR audit.

## Known-stale documents — do not trust their status claims

| Doc | Stale claim | Reality |
|---|---|---|
| `docs/FINAL_STATUS_97_FUNCTIONS_COMPLETE.md` (2026-02-14) | "Build Status: ✅ Production-Ready" | Production build has never succeeded; plain Rust builds still need the SDK pin or SDK repair |
| `docs/IMPLEMENTATION_SUMMARY_COMPLETE.md` (2026-02-14) | "Production-Ready" | Same |
| `docs/CHANGELOG.md` (2026-02-14) | "Status: Production-Ready ✅" | Same |
| `README.md` (2026-02-14) | "92 Tauri commands" | `grep -c '#\[tauri::command\]' src-tauri/src/lib.rs` → 112 |
| `.github/agents/GaborAI.agent.md` | — | Unfilled template, no content |

`docs/ROADMAP_STATUS.md` (2026-04-30, in Romanian) is the most honest status doc and matches command evidence.

## How to update this file

Run `docs/VERIFICATION_PROTOCOL.md`, record results in an evidence ledger (`docs/EVIDENCE_LEDGER_TEMPLATE.md`), then update the tables above with new dates. Never mark something working without the command output in hand.
