# PROJECT_STATE — YTM Free

> Single source of truth for "what actually works right now".
> Every claim below is dated and backed by a command. When you re-verify, update the date and result — never leave a stale ✅.
> If this file disagrees with any other doc (README, docs/FAZA_*, CHANGELOG), **this file wins**; update the other doc or flag it.

**Last full verification:** 2026-07-06 (Claude Code session, Windows 11, local machine)
**Step-1 re-verification (same day, second session):** the `dbghelp.lib` toolchain block is **bypassable** via a session-only SDK pin — see "Verified BROKEN" table below for the new finding and the changed blocker.

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
| **Rust toolchain `dbghelp.lib` block is BYPASSABLE (verified 2026-07-06, 2nd session)** — a plain `cargo test` still fails with `LNK1181: cannot open input file 'dbghelp.lib'`, but pinning the SDK to 10.0.26100.0 for the session makes the whole tree compile | Plain `cargo test` in `src-tauri/` → `LNK1181: cannot open input file 'dbghelp.lib'` on build scripts (MSVC 14.50.35717, VS 18 BuildTools). With `vcvarsall.bat x64 10.0.26100.0` first → ~280 crates + the `ytm-free` lib compile cleanly (only warnings, no errors). |
| Root cause confirmed unchanged: Windows SDK 10.0.28000.0 is a **partial install** — `um/x64` has 115 libs (no `dbghelp.lib`) vs 481 in SDK 10.0.26100.0 (which has it); the toolchain auto-selects the newest SDK | `ls ...\10.0.28000.0\um\x64\dbghelp.lib` → No such file; `ls ...\10.0.26100.0\um\x64\dbghelp.lib` → exists. Counts: 28000 = 115 libs, 26100 = 481 libs (re-verified 2026-07-06). |
| **NEW blocker — disk space (verified 2026-07-06, 2nd session):** with the SDK pin applied, `cargo test` compiles the entire dep tree but fails at the final step building `libytm_free_lib.rlib` with `os error 112` (disk full). The Rust code itself is fine. | `fsutil volume diskfree C:` → Total free 371,990,528 bytes (**354.8 MB** free of 585 GB). `du -sh src-tauri/target` → 4.7 GB. The debug build needs several GB; not enough room. |

Fix procedure: see `docs/RECOVERY_PLAN.md`. **Step 1 part 1 (dbghelp.lib) is solved in practice** — either (A) repair/remove the partial Windows SDK 10.0.28000.0 in Visual Studio Installer so a plain `cargo test` works without the pin, or (B) keep using the session pin: run `vcvarsall.bat x64 10.0.26100.0` (from `C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\`) before cargo commands in a given shell. **Step 1 part 2 (NEW) — free disk space on C:**: the user must free several GB on the C: drive (currently 354.8 MB free). `cargo clean` would free ~4.7 GB but a fresh build peaks higher than that, so it is not a reliable fix on its own — the volume itself needs headroom. Until both are addressed, `cargo test` remains BLOCKED-ENV (now on disk space, not the linker). The 28 Rust `#[test]` functions (db.rs: 8, semantic.rs: 5, spotify_import.rs: 7, ollama/client.rs: 6, ollama/prompts.rs: 2) were last known green around 2026-04-30 and are **still unverifiable** — but the reason is now disk space, not the linker.

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
