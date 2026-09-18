# CLAUDE.md — ytm-free

Desktop music player (personal use): Tauri 2.x + React 18/TypeScript frontend, Rust backend. npm only (package-lock.json committed). SQLite (rusqlite bundled), Axum stream server on port 3456, yt-dlp for YouTube, Ollama for local-AI features.

## Read first

- `AGENT_BRIEF.md` — ground rules, trust order for docs, hard traps. Read before your first change.
- `PROJECT_STATE.md` — dated, evidence-backed status. **The only status doc you may trust for current verification state.** README was reconciled after PR #26; several historical `docs/*COMPLETE*.md` files still contain stale "Production-Ready" language and should be treated as historical narrative.

## Commands

```
npm test                         # 2026-09-19: 67/67 PASS
npm run lint                     # 2026-09-19: PASS
npx tsc --noEmit -p tsconfig.json # 2026-09-19: PASS
npm run typecheck:wdio           # 2026-09-19: PASS
npm run build                    # tsc + vite build; not rerun in PR #26 mission
npm run tauri dev                # full app; not rerun in PR #26 mission
cargo check --manifest-path src-tauri/Cargo.toml # 2026-09-19: PASS
cargo test --manifest-path src-tauri/Cargo.toml  # 2026-09-19: 106 passed / 0 failed / 2 ignored
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features # 2026-09-19: exit 0 with warnings
```

## Known traps (reconciled 2026-09-19 — re-verify environment-specific items)

1. **Toolchain is environment-sensitive, but the current normal PowerShell shell is healthy**: on 2026-09-19, `vswhere` found Visual Studio Build Tools 18, `cl.exe` was on PATH, Rust 1.94.1 targeted `x86_64-pc-windows-msvc`, and `cargo check` / `cargo test` passed without a manual `vcvarsall` step. If a different shell fails, inspect MSVC/SDK environment variables before changing source.
2. **Canonical/default branch is `main`**: post-PR #26, `origin/HEAD -> origin/main`. Historical branches such as `phase-2-frontend-bugs` are not the trunk.
3. **Flaky test**: `LibraryView.test.tsx` › "handles 1000 tracks…" has historically timed out under full-suite load but passed in the 2026-09-19 suite. Re-run it in isolation before attributing a future timeout to a patch.
4. `src-tauri/Cargo.lock` is tracked and not ignored; the former reproducibility debt is closed.
5. Docs and commit messages are partly Romanian ("Faza N" = phase N). `docs/ROADMAP_STATUS.md` is Romanian and is the most accurate roadmap.
6. `.omx/` is agent-session state; `Spotify/` holds personal CSV exports. Don't commit the former, don't delete either.

## Workflow requirements

- Before claiming any work complete: run the quality gate in `.claude/skills/quality-gate/SKILL.md` and paste actual output. No evidence → no success claim.
- Before opening a PR: `.claude/skills/pr-verification/SKILL.md`.
- If the environment itself seems broken: `.claude/skills/repo-recovery/SKILL.md` — diagnose before "fixing" code that isn't the problem.
- If you changed what works/what's broken: update `PROJECT_STATE.md` (dated, with the command you ran).

## Style

- Conventional-commit style messages, imperative, scope prefixes as in `git log` (`fix(frontend): …`, `feat: Faza N — …`).
- `src-tauri/src/lib.rs` is 6,930 lines with 112 registered logical Tauri commands and 113 `#[tauri::command]` annotations because `get_semantic_status` has mutually exclusive cfg implementations — make surgical edits, don't reformat or reorder it.
- Frontend: Zustand store in `src/store.ts`, API bindings in `src/api.ts`, types in `src/types.ts`. New Tauri commands need all three plus `lib.rs` registration.
