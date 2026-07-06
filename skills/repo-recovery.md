---
name: repo-recovery
description: Use when a build/test command in ytm-free fails for reasons that look environmental (linker errors, missing tools, port conflicts, wrong branch) — diagnose the environment before touching code.
---

# Repo Recovery — ytm-free

Principle: **when a command that "should work" fails, first prove whether the environment or the code is at fault.** Check out `main` (or `git stash`) and re-run the failing command. Same failure on clean main = environment/known issue; different = your diff.

## Known failure signatures (verified 2026-07-06)

### 1. `LNK1181: cannot open input file 'dbghelp.lib'` on any cargo build
- **Cause (verified):** partial Windows SDK 10.0.28000.0 (`Lib\10.0.28000.0\um\x64` has ~115 libs, no dbghelp.lib; 10.0.26100.0 has 481 incl. dbghelp.lib). MSVC picks the newest SDK.
- **Fix:** docs/RECOVERY_PLAN.md Step 1 (complete/remove SDK 28000 via VS Installer — needs the human; or pin LIB to 26100 for the session).
- **Do NOT:** edit Cargo.toml, downgrade crates, or "fix" Rust code in response to this error. The code is not the problem.
- After fixing, update PROJECT_STATE.md.

### 2. `npm test` shows 1 failure: LibraryView "handles 1000 tracks…" timeout
- Known flake (5s vitest timeout, test needs ~7s under full-suite load).
- **Confirm:** `npx vitest run src/__tests__/LibraryView.test.tsx -t "handles 1000 tracks"` → if it passes alone, environment/load flake, proceed with PASS-WITH-KNOWN-FLAKE verdict.
- **Do NOT:** delete the test or raise the global testTimeout to hide it. A real fix is a per-test timeout or batching improvement — separate, deliberate change.

### 3. Vite dev port conflicts / zombie processes
- `npm run dev` already runs `scripts/cleanup-ports.mjs` first. If ports are still stuck, run `npm run cleanup` alone, then retry.

### 4. Working on / PRing against the wrong branch
- Symptom: fresh clone or `gh pr create` defaults to `phase-2-frontend-bugs`.
- Cause: GitHub default branch is stale (RECOVERY_PLAN.md Step 4.1). Real trunk = `main`.
- Fix for your session: `git checkout main`, base branches on main, pass `--base main` to `gh pr create`.

### 5. Runtime: search returns nothing / streaming fails
- Check `yt-dlp --version` (must exist in PATH; 2026.02.04 known-good). Update with `yt-dlp -U`.
- Check stream server: `curl http://localhost:3456/health` while the app runs.
- Ollama features degrade gracefully when Ollama is down — a dead brain icon is not a bug in your diff.

## Escalation rule

If a failure matches none of the above after 2–3 diagnostic attempts: STOP. Write what you observed (exact command, exact error, what you ruled out) into the session summary and, if it's reproducible, add a new signature section to this file. Do not push speculative fixes.
