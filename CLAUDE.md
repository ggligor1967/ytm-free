# CLAUDE.md — ytm-free

Desktop music player (personal use): Tauri 2.x + React 18/TypeScript frontend, Rust backend. npm only (package-lock.json committed). SQLite (rusqlite bundled), Axum stream server on port 3456, yt-dlp for YouTube, Ollama for local-AI features.

## Read first

- `AGENT_BRIEF.md` — ground rules, trust order for docs, hard traps. Read before your first change.
- `PROJECT_STATE.md` — dated, evidence-backed status. **The only status doc you may trust.** README and `docs/*COMPLETE*.md` contain stale "Production-Ready" claims — they describe intent, not reality.

## Commands

```
npm test              # vitest run (frontend; src/__tests__/)
npx tsc --noEmit      # typecheck
npm run build         # tsc + vite build
npm run tauri dev     # full app — BROKEN as of 2026-07-06 (Rust toolchain, see below)
cargo test            # in src-tauri/ — works in normal PowerShell shells after the 2026-07-08 SDK 10.0.26100.0 env/profile bootstrap
```

## Known traps (verified 2026-07-06 — re-verify before assuming still true)

1. **Underlying Windows SDK defect still exists on this machine**: SDK 10.0.28000.0 is a partial install, so raw/unbootstrapped shells can still fail with `LNK1181: dbghelp.lib`. As of 2026-07-08, normal PowerShell shells are auto-bootstrapped to SDK 10.0.26100.0 via user env + PowerShell profile, and `cargo test` passes there without manual `vcvarsall`. OS-level cleanup guidance remains in `docs/RECOVERY_PLAN.md`.
2. **GitHub default branch is wrong**: `origin/HEAD` → `phase-2-frontend-bugs` (stale). Trunk is `main`. Always branch from and PR into `main`.
3. **Flaky test**: `LibraryView.test.tsx` › "handles 1000 tracks…" times out under full-suite load, passes in isolation. Verify with `npx vitest run src/__tests__/LibraryView.test.tsx -t "handles 1000 tracks"` before treating a red run as your fault (or as fine).
4. `Cargo.lock` is gitignored (known debt). Rust dependency versions are not pinned — a clean clone may resolve different crates.
5. Docs and commit messages are partly Romanian ("Faza N" = phase N). `docs/ROADMAP_STATUS.md` is Romanian and is the most accurate roadmap.
6. `.omx/` is agent-session state; `Spotify/` holds personal CSV exports. Don't commit the former, don't delete either.

## Workflow requirements

- Before claiming any work complete: run the quality gate in `.claude/skills/quality-gate/SKILL.md` and paste actual output. No evidence → no success claim.
- Before opening a PR: `.claude/skills/pr-verification/SKILL.md`.
- If the environment itself seems broken: `.claude/skills/repo-recovery/SKILL.md` — diagnose before "fixing" code that isn't the problem.
- If you changed what works/what's broken: update `PROJECT_STATE.md` (dated, with the command you ran).

## Style

- Conventional-commit style messages, imperative, scope prefixes as in `git log` (`fix(frontend): …`, `feat: Faza N — …`).
- `src-tauri/src/lib.rs` is 3300+ lines of Tauri commands — make surgical edits, don't reformat or reorder it.
- Frontend: Zustand store in `src/store.ts`, API bindings in `src/api.ts`, types in `src/types.ts`. New Tauri commands need all three plus `lib.rs` registration.
