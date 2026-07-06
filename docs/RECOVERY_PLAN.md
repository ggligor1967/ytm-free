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
2. **Disk space — NEW blocker.** With the pin applied, `cargo test` fails only at the final archive step: `error: failed to build archive ... libytm_free_lib.rlib: There is not enough space on the disk. (os error 112)`. `fsutil volume diskfree C:` showed **354.8 MB free of 585 GB**; `du -sh src-tauri/target` = 4.7 GB. The user must free several GB on C: before `cargo test` can complete. `cargo clean` alone is not a reliable fix (a fresh build peaks higher than the ~4.7 GB it would free).

Net: Step 1 is no longer "blocked by the linker" — it is blocked by disk space. The Rust code compiles.

## Step 2 — First real end-to-end run (never done in project history)

ROADMAP_STATUS.md item 1 has been "NEFACUT" (not done) since the beginning. Once Step 1 passes:

1. `npm run tauri dev` — app window opens, no panic in console.
2. `curl http://localhost:3456/health` — stream server responds.
3. Manual smoke: search a track → play it → download it → add to playlist → restart app → data persisted.
4. Optional: `./verify.sh` automates the first two checks.

**Exit criterion:** all four pass. Record each in the ledger. Only after this may any doc say the app "works".

## Step 3 — Production build

`npm run tauri build` → installer/exe in `src-tauri/target/release/`. This has **never succeeded** (blocked since ~Feb 2026 by Step 1's issue). Launch the built exe and repeat the Step 2 smoke test against it.

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
