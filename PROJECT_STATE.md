# PROJECT_STATE — YTM Free

> Single source of truth for "what actually works right now".
> Every claim below is dated and backed by a command. When you re-verify, update the date and result — never leave a stale ✅.
> If this file disagrees with any other doc (README, docs/FAZA_*, CHANGELOG), **this file wins**; update the other doc or flag it.

**Last full verification:** 2026-07-06 (Claude Code session, Windows 11, local machine)
**Step-1 re-verification (same day, second session):** the `dbghelp.lib` toolchain block is **bypassable** via a session-only SDK pin — see "Verified BROKEN" table below for the new finding and the changed blocker.
**Step-1B re-verification (same day, third session):** the disk-space blocker is **resolved** (C: now 11.2 GB free). With the SDK 10.0.26100.0 pin, `cargo test` now **compiles and runs** (Finished in 35.98s, only warnings) — but reveals **8 real failures in `db::tests::*`** (20 passed / 8 failed of 28). Rust is no longer BLOCKED-ENV; it is **PASS-COMPILE-BUT-TEST-FAIL**. Root cause is a pre-existing bug in `run_migrations` (version-0 baseline collision), not the toolchain. See "Verified BROKEN" table.

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
| Rust lib + test binary compile with SDK pin (2026-07-06, 3rd session) | `vcvarsall.bat x64 10.0.26100.0` then `cargo test` in `src-tauri/` → `Finished test profile [unoptimized + debuginfo] target(s) in 35.98s`; only 8 dead-code warnings, no errors. (Plain `cargo test` without the pin still fails — see BROKEN table.) |

## Verified BROKEN (2026-07-06)

| Problem | Evidence |
|---|---|
| **Rust toolchain `dbghelp.lib` block is BYPASSABLE (verified 2026-07-06, 2nd session)** — a plain `cargo test` still fails with `LNK1181: cannot open input file 'dbghelp.lib'`, but pinning the SDK to 10.0.26100.0 for the session makes the whole tree compile | Plain `cargo test` in `src-tauri/` → `LNK1181: cannot open input file 'dbghelp.lib'` on build scripts (MSVC 14.50.35717, VS 18 BuildTools). With `vcvarsall.bat x64 10.0.26100.0` first → ~280 crates + the `ytm-free` lib compile cleanly (only warnings, no errors). |
| Root cause confirmed unchanged: Windows SDK 10.0.28000.0 is a **partial install** — `um/x64` has 115 libs (no `dbghelp.lib`) vs 481 in SDK 10.0.26100.0 (which has it); the toolchain auto-selects the newest SDK | `ls ...\10.0.28000.0\um\x64\dbghelp.lib` → No such file; `ls ...\10.0.26100.0\um\x64\dbghelp.lib` → exists. Counts: 28000 = 115 libs, 26100 = 481 libs (re-verified 2026-07-06). |
| ~~NEW blocker — disk space (verified 2026-07-06, 2nd session)~~ **RESOLVED 2026-07-06 (3rd session):** C: now has 11.2 GB free; `cargo test` with the SDK pin completed the build (`Finished in 35.98s`) and ran all 28 tests. | (Was) `fsutil volume diskfree C:` → 354.8 MB free; `du -sh src-tauri/target` → 4.7 GB. (Now) `fsutil volume diskfree C:` → Total free 11,994,079,232 bytes (**11.2 GB**). Build artifacts: `src-tauri/target` 4.7G, `node_modules` 171M, `dist` 461K. |
| **NEW — 8 real `db::tests::*` failures (verified 2026-07-06, 3rd session):** `cargo test` now runs and reports `20 passed; 8 failed` of 28. All 8 failures are in `db::tests` (migrations + CRUD). The other 20 (ollama/client 6, ollama/prompts 2, semantic 5, spotify_import 7) pass. **Root cause: pre-existing bug in `run_migrations` (`src-tauri/src/db.rs:27-73`)** — on a fresh DB, `last_version = COALESCE(MAX(version),0)` = 0, and the only migration is version 0, so the guard `if migration.version > last_version` (`0 > 0`) is false → migration 0 never runs → `tracks`/`playlists`/etc. never created and no `schema_migrations` row inserted. Not fixed this session (no source changes per session rules). | `cargo test` (SDK-pinned) → `test result: FAILED. 20 passed; 8 failed`. Failing tests: `test_run_migrations_creates_all_tables` ("tracks table missing"), `test_run_migrations_creates_schema_migrations_table` (`QueryReturnedNoRows`), `test_run_migrations_is_idempotent` (assert 0==1), `test_in_memory_database_creation`, `test_track_crud`, `test_favorites`, `test_play_counts`, `test_playlist_crud` (all "no such table: tracks/playlists"). |

Fix procedure: see `docs/RECOVERY_PLAN.md`. **Step 1 part 1 (dbghelp.lib) is solved in practice** — either (A) repair/remove the partial Windows SDK 10.0.28000.0 in Visual Studio Installer so a plain `cargo test` works without the pin, or (B) keep using the session pin: run `vcvarsall.bat x64 10.0.26100.0` (from `C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\`) before cargo commands in a given shell. **Step 1 part 2 (disk space) — RESOLVED 2026-07-06 (3rd session):** C: now has 11.2 GB free and the build completed. **Step 1 part 3 (NEW) — 8 real `db::tests` failures:** with the toolchain compiling, `cargo test` now runs and exposes a pre-existing bug in `run_migrations` (db.rs:27-73): the baseline migration is version 0, but `last_version` defaults to 0 via `COALESCE(MAX(version),0)`, so `migration.version > last_version` (`0 > 0`) is false and the initial schema migration is never applied. Fix (deferred — no source changes this session): renumber the initial migration to version 1 (or change the guard to `>=` with a sentinel baseline of `-1`/`u32::MAX`, or insert a baseline row). The 28 Rust `#[test]` functions (db.rs: 8, semantic.rs: 5, spotify_import.rs: 7, ollama/client.rs: 6, ollama/prompts.rs: 2) are **now verifiable** (no longer "unverifiable"): 20 pass, 8 fail (all db.rs). Net: `cargo test` is no longer BLOCKED-ENV — it is **PASS-COMPILE-BUT-TEST-FAIL**.

## Never verified (open since project start)

- End-to-end app run (search → stream → download → playlist) — ROADMAP_STATUS.md item 1, "NEFACUT". `verify.sh` exists for a smoke check but depends on the broken Rust build.
- `npm run tauri build` (production bundle) — blocked by the same toolchain issue since ~Feb 2026.
- Ollama-dependent features against a live Ollama instance.

## Git state (2026-07-06)

- `main` @ 2fc459f. **`main` is the real trunk.** (Was 65c6e6b at last verification; 82a44c2 + 2fc459f are doc-only recovery commits since. `origin/main` not re-checked this session — no network.)
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
