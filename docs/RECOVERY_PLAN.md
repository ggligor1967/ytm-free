# RECOVERY_PLAN — restoring ytm-free to a fully buildable, verifiable state

Written 2026-07-06 from verified evidence (see PROJECT_STATE.md). Steps are ordered by risk reduction: each step unblocks the ones after it. Do them in order; record every result in an evidence ledger (docs/EVIDENCE_LEDGER_TEMPLATE.md).

## Step 1 — Repair the Rust toolchain (blocks everything native)

**Symptom:** any `cargo build/test` fails: `LINK : fatal error LNK1181: cannot open input file 'dbghelp.lib'` (MSVC 14.50.35717, VS 18 BuildTools).

**Verified root cause:** Windows SDK **10.0.28000.0** is partially installed — `C:\Program Files (x86)\Windows Kits\10\Lib\10.0.28000.0\um\x64` has 115 libs (no `dbghelp.lib`) vs 481 in `10.0.26100.0` (which has it). The toolchain auto-selects the newest SDK, so linking fails.

**Fix options (pick one, A preferred):**

- **A. Complete or remove the broken SDK.** Open *Visual Studio Installer* → Build Tools → Modify → either install the full "Windows 11 SDK (10.0.28000.0)" component or untick it entirely (26100 remains). This is a GUI step the owner must do — an agent should request it via `! ` command or ask the user.
- **B. Pin the SDK for this shell (no admin):** before cargo commands, set the env so the 26100 libs win, e.g. in PowerShell:
  `$env:LIB = ($env:LIB -replace '10\.0\.28000\.0','10.0.26100.0')` — only works in shells where LIB is already populated (vcvars). Fragile; use only to unblock a single session.

**Exit criterion:** `cd src-tauri && cargo test` compiles and reports test results (pass or fail — compiling at all is the gate). Expected: ~28 tests across db.rs, semantic.rs, spotify_import.rs, ollama/client.rs, ollama/prompts.rs.

**Re-verified 2026-07-06 (2nd session) — Step 1 splits into two sub-blockers:**

1. **dbghelp.lib — SOLVED in practice.** Option B (session pin) was confirmed working: `vcvarsall.bat x64 10.0.26100.0` then `cargo test` compiles the entire dep tree (~280 crates) and the `ytm-free` lib cleanly — only warnings, no errors. The SDK evidence is unchanged (28000/um/x64 = 115 libs, no dbghelp.lib; 26100/um/x64 = 481 libs, has it). Option A (VS Installer repair/remove of SDK 28000) remains the permanent fix so a plain `cargo test` works without the pin.
2. **Disk space — RESOLVED 2026-07-06 (3rd session).** C: now has 11.2 GB free (`fsutil volume diskfree C:` → 11,994,079,232 bytes). With the SDK pin, `cargo test` completed the build (`Finished test profile in 35.98s`, only warnings) and ran all 28 tests. (Historical: 2nd session saw `os error 112` at the final archive step with only 354.8 MB free; `du -sh src-tauri/target` was 4.7 GB.)

3. **db tests — RESOLVED 2026-07-06 (4th session).** The 3rd-session blocker was a real code bug in `run_migrations` (`src-tauri/src/db.rs:27-73`): the baseline migration is version 0, but `last_version = COALESCE(MAX(version),0)` defaulted to 0 on a fresh DB, so the guard `if migration.version > last_version` (`0 > 0`) skipped the initial schema. The fix preserves migration version 0 and treats an empty `schema_migrations` table as baseline `-1`. Evidence with SDK 10.0.26100.0 pin: `cargo test db::tests` → 8 passed; full `cargo test` → 28 passed, 0 failed.

Net: Step 1 is no longer blocked by disk space or db migration failures when using the SDK 10.0.26100.0 session pin. Rust Gate B is now **PASS with SDK pin**. Remaining environment debt: a plain, unpinned `cargo test` still needs SDK 10.0.28000.0 repaired or removed.

## Step 2 — First real runtime/e2e verification

ROADMAP_STATUS.md item 1 has been "NEFACUT" (not done) since the beginning.

**Step 2A — runtime startup smoke: VERIFIED 2026-07-06.** With `vcvarsall.bat x64 10.0.26100.0` in the same shell, `npm run tauri dev` started Vite on `http://localhost:5173`, launched `target\debug\ytm-free.exe` with responding window title `YTM Free`, and started the Axum stream server on `127.0.0.1:3456`. Evidence: `curl.exe -i http://localhost:3456/health` → `HTTP/1.1 200 OK` / `OK`; `curl.exe -I http://localhost:5173/` → `HTTP/1.1 200 OK`; `Get-NetTCPConnection` showed listeners on 5173 and 3456. This verifies startup only.

**Step 2B — minimal non-destructive app flow: VERIFIED for app-local stream redirect on 2026-07-06, branch `fix/stream-audio-url-resolution`.** The first attempt failed because `src-tauri/src/ytdlp.rs::get_audio_url` used strict `yt-dlp -f bestaudio -g`, which returns `Requested format is not available` for ordinary IDs that only expose a combined playable format. The fix changes only that audio URL selector to `bestaudio/best`, preserving audio preference and falling back to a playable `best` URL. Evidence: `curl.exe -i http://localhost:3456/stream/YXZH-eBtmqQ` now returns `HTTP/1.1 307 Temporary Redirect` with a `googlevideo.com/videoplayback` location instead of HTTP 500. No download/import/delete/mutation flow was run.

**Remaining Step 2 flow:** the minimal read-only stream redirect is verified, but this still does not cover full playback, downloads, playlist mutation, restart, persistence, or production packaging. Only run those with explicit approval and fresh evidence.

1. `npm run tauri dev` — app window opens, no panic in console.
2. `curl http://localhost:3456/health` — stream server responds.
3. Read-only smoke: search a track → verify at least one sampled result resolves through `/stream/:video_id` without 500. (**Verified for `YXZH-eBtmqQ` on 2026-07-06.**)
4. Later, only with explicit approval: download → add to playlist → restart app → data persisted.
5. Optional: `./verify.sh` automates the first two checks.

**Exit criterion:** all selected flow checks pass. Record each in the ledger. Only after the full chosen flow passes may any doc say that flow works.

## Step 3 — Production build

`npm run tauri build` → installer/exe in `src-tauri/target/release/`. This has **never succeeded** (blocked since ~Feb 2026 by Step 1's issue). Launch the built exe and repeat the Step 2 smoke test against it.
**Step 3A — first controlled production build attempt: BLOCKED-ENV at the disk decision gate (2026-07-06, 8th session).** Preflight on main (local == origin/main == f8bb649621ea44a33b7aec31175bf3078d5fc44) confirmed the toolchain is ready under the SDK 10.0.26100.0 pin (dbghelp.lib and cvarsall.bat present; rustc/cargo 1.94.1), but sutil volume diskfree C: showed only **8.70 GB free** (down from 11.2 GB in the 3rd session) while src-tauri/target already occupies **10.62 GB**. The Step-3A protocol requires ≥15 GB free before running 
pm run tauri build, so the production build was **not executed** and no source was changed. Classification: **BLOCKED-ENV** (insufficient disk space). No baseline gates or production build were run this session because the disk gate fires first. Build command (for reference): 
pm run tauri build → 	auri build (auto-runs 
pm run build via eforeBuildCommand; undle.targets: "all" → MSI + NSIS under src-tauri/target/release/bundle/). Next minimal action (needs the human): free several more GB on C: (a release profile adds GB on top of the existing 10.62 GB debug 	arget), or explicitly approve a project-local cleanup of build artifacts (cargo clean frees ~10.62 GB but a fresh release build peaks higher than its final size). Do not clean 	arget/dist automatically. Re-run Step 3A only after C: free is ≥15 GB.

**Step 3A re-run after PASS-PREP: FAIL-BUILD before `npm run tauri build` (2026-07-06, 9th session).** After the approved cleanup of only `src-tauri/target` and `dist`, preflight on main again confirmed local == origin == `f71a946fdc49bd34f2ca740bd4ac81de1132d224`, C: had **24.03 GB free**, `dbghelp.lib` and `vcvarsall.bat` both existed, and both artifact directories were absent. The disk gate was therefore clear, but the rerun stopped at the first required baseline gate. In an SDK-pinned shell (`vcvarsall.bat x64 10.0.26100.0` imported into the session), `cd src-tauri && cargo test` exited 101 because `tauri::generate_context!()` panicked: `The frontendDist configuration is set to "../dist" but this path doesn't exist`. `src-tauri/tauri.conf.json` points `frontendDist` at `../dist`, so a clean workspace with `dist/` removed cannot pass that baseline order until the frontend build is recreated. `npm run tauri build` was **not executed**, no source was changed, and the failed cargo invocation recreated a partial `src-tauri/target` (~2.05 GB) while `dist` remained absent. Classification: **FAIL-BUILD** (repo/config coupling in the baseline gate, not disk space or SDK setup). Next minimal action: decide whether Step 3A should recreate `dist/` with `npm run build` before `cargo test`, or whether the Tauri config/test path should be decoupled from `frontendDist` existence; do not patch on `main` without explicit approval.

**Step 3A corrected-order verification: PASS-BUILD (2026-07-06, 10th session).** Re-running Step 3A with the corrected order solved the clean-workspace `frontendDist` issue without any source changes: preflight on main confirmed local == origin == `9bde65010bb4b239224bd012969e603978ec8dcb`, C: **22.10 GB free**, `dist` absent, partial `src-tauri/target` about **2.05 GB**, and SDK `10.0.26100.0` ready (`dbghelp.lib` and `vcvarsall.bat` present). Baseline gates then passed in the corrected sequence: `npx tsc --noEmit` exit 0; `npm test` → 32/32; `npm run build` → rebuilt `dist`; SDK-pinned `cd src-tauri && cargo test` → 28 passed, 0 failed. After that, SDK-pinned `npm run tauri build` exited 0 and produced `src-tauri/target/release/ytm-free.exe`, `src-tauri/target/release/bundle/msi/YTM Free_0.1.0_x64_en-US.msi` (3.63 MB), and `src-tauri/target/release/bundle/nsis/YTM Free_0.1.0_x64-setup.exe` (2.67 MB). Post-build C: free was **18.30 GB**. No listeners remained on 3456 or 5173, and no generated artifacts were installed, launched, uploaded, distributed, staged, or committed. Net: the first controlled production build is now verified; what remains unverified is running the built artifacts through runtime smoke and broader user flows.

**Step 3B - release-runtime smoke against the built release executable only: PASS-ARTIFACT-ONLY / BLOCKED-RUNTIME-ISOLATION (2026-07-07, 11th session).** Goal: launch only `src-tauri/target/release/ytm-free.exe` (no installers, no build, no full e2e, no source change) and run a narrow smoke (`/health`, optional read-only `/stream/:id`). Preflight on `main` confirmed local main == origin/main == `461e761bd5fcde6e5d225a423bb348e9efe2103d` (`git rev-list --left-right --count origin/main...main` -> 0	0), branch `main`, only the known untracked files present, nothing staged. Artifacts verified present and hashed: `ytm-free.exe` 8,760,832 bytes SHA256 `9E30ED8C2E7B70F61E2D32825CD68DE03D0D17FB896BBC0124B042F339950B3C`; `YTM Free_0.1.0_x64_en-US.msi` 3,805,184 bytes SHA256 `679ED84143941BF51DB9C33D35AB4BB4E75403D225A2627E01FC3290A4ACA62D`; `YTM Free_0.1.0_x64-setup.exe` 2,801,097 bytes SHA256 `B5A0F2AA341E0BCC176E5B3520D4D0EEA654B6E91C056FEAF56EF6CCE37233E0`. The release executable was **not launched**. Reason: runtime data-path inspection (`src-tauri/src/db.rs:235-240`, `src-tauri/src/lib.rs:3211-3213`, `src-tauri/src/main.rs`) shows the Tauri `setup` hook unconditionally calls `Database::new()`, whose `get_db_path()` hardcodes `dirs::data_dir().join("ytm-free").join("ytm-free.db")`. The dep is `dirs = "5"`; on Windows `dirs` v5 `data_dir()` resolves `FOLDERID_RoamingAppData` via `SHGetKnownFolderPath` (user profile/registry, **not** the `APPDATA` env var), so `$env:APPDATA` cannot redirect it. `main.rs` parses no CLI data-dir arg and sets no override; the code uses no Tauri app-handle path-resolver override. A real DB already exists at `C:\Users\gglig\AppData\Roaming\ytm-free\ytm-free.db` (1,482,752 bytes, from prior dev smoke runs), so launching would open/mutate real user AppData (SQLite open + `run_migrations` guard + possible WAL/journal writes) with no safe isolation and no source change allowed this session. Per the session's Operating Rule 10, launch was skipped. No MSI/NSIS installer was run; no download/import/delete/personal-data mutation flow was run; no full e2e was run; no build command was run; no source changed; no generated artifact was staged, committed, uploaded, installed, launched, or distributed. At rest: no `ytm-free` process; no listener on 3456; port 5173 held by an unrelated pre-existing Vite (node PID 20652, project `C:\Users\gglig\my_project\D U L A P`) not spawned this session and left untouched. Classification: **PASS-ARTIFACT-ONLY / BLOCKED-RUNTIME-ISOLATION**. Next minimal action (on a branch, not `main`): make `get_db_path()` honor an override env var (e.g. `YTM_FREE_DATA_DIR`) or a CLI flag so the release exe can run against a throwaway temp DB without touching real AppData, then re-run Step 3B (`curl http://localhost:3456/health` and optional read-only `/stream/:id`).

## Step 4 — Git hygiene (cheap, do any time)

1. On GitHub: change default branch from `phase-2-frontend-bugs` to `main` (Settings → Branches). This is the single highest-value 1-click fix in the project.
2. Delete merged remote branches: `phase-2-frontend-bugs`, `debt/cleanup-sprint`, `faza-3/feature-completion`, `faza-4/client-hardening-settings-refactor` (after confirming default branch changed; content was squash-merged into main — verify with `git log main` messages before deleting).
3. Decide fate of uncommitted GDPR docs (`gdpr-compliance-audit-report.md`, `docs/GDPR_REMEDIATION_PLAN.md`, `docs/plan-remediere-gdpr-complete.md`): commit as drafts or archive. They are currently one `git clean` away from oblivion.
4. Add `.omx/` to `.gitignore`.
5. Owner decision: stop gitignoring `Cargo.lock` (recommended for an application — Tauri's own templates commit it) and commit it once Step 1 allows regenerating it.

## Step 5 — Minimal CI (prevents silent regression of Steps 1–3)

No CI exists (`.github/` has no workflows). Add one workflow: on push/PR to main run `npm ci`, `npx tsc --noEmit`, `npm test`, and `cargo test` on `windows-latest`. Do not add release pipelines until Step 3 has succeeded locally at least once.

## Step 6 — Documentation debt

- Mark or delete the stale "Production-Ready" claims in `docs/FINAL_STATUS_97_FUNCTIONS_COMPLETE.md`, `docs/IMPLEMENTATION_SUMMARY_COMPLETE.md`, `docs/CHANGELOG.md`; point them at PROJECT_STATE.md.
- Fix README command count (says 92; `grep -c '#\[tauri::command\]' src-tauri/src/lib.rs` → 112) or replace hard numbers with the grep command.
- Fill in or delete the empty template `.github/agents/GaborAI.agent.md`.
