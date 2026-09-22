# AGENT_BRIEF — read this before doing anything in ytm-free

Audience: any AI agent (Claude Code, Codex, Copilot, etc.) or human maintainer starting a session in this repo.

## 30-second orientation

- Desktop music player, personal use only. Tauri 2.x + React/TS frontend (`src/`) + Rust backend (`src-tauri/src/`). npm is the package manager. Docs are mixed English/Romanian (`Faza` = `Phase`).
- The exact tagged `v1.0.0` release has a recorded historical full-flow runtime proof, but later commits do not inherit that proof automatically. PR #37 established the CI/Release Gate infrastructure baseline at `1e4d51baa150e692e0289480e979ac1bd8fb8d23`; read the live repository tip directly from Git. Fresh full-product Tauri/WebView2 E2E on the repository tip remains **NOT RUN**. Current truth: `PROJECT_STATE.md`.
- GitHub Actions `Quality Gates` run on pull requests and pushes to protected `main`. PR #37 has green main-push Quality Gates and Release Gate evidence; later documentation-only merges must still pass their applicable Quality Gates.
- A separate Windows `Release Gate` validates exact source/version metadata and production bundle generation (standalone EXE + MSI + NSIS with size/SHA-256 inventory). It does **not** install/run those artifacts and does not replace runtime/E2E verification.
- The normal PowerShell environment exposes Visual Studio Build Tools 18 / MSVC and Rust `1.94.1` successfully.

## Trust order for documentation

1. Command output you produced in this session (highest)
2. `PROJECT_STATE.md`
3. `docs/ROADMAP_STATUS.md` (Romanian, 2026-04-30)
4. Code itself (`src/`, `src-tauri/src/`)
5. Everything else in `docs/` and `README.md` — treat as **historical narrative**, not status. Several docs claim "Production-Ready ✅"; this has never been true (see PROJECT_STATE.md, "Known-stale documents").

## Hard rules

1. **Never claim "production-ready", "all tests pass", or "done" without pasting the command output that proves it.** This repo's docs are already polluted with unverified success claims; do not add more.
2. **Branch rule:** GitHub's default branch and canonical trunk are now `main` (confirmed post-PR #26). Base branches and PRs on `main` unless a mission explicitly says otherwise. Historical branches such as `phase-2-frontend-bugs` are not the trunk.
3. **Do not assume every shell is healthy.** On this machine, PowerShell shells now auto-bootstrap SDK `10.0.26100.0`, but the partial SDK `10.0.28000.0` still exists on disk. If you are not in a normal PowerShell session, verify with `cargo test --manifest-path src-tauri/Cargo.toml --no-run` before making claims; if it fails, say so instead of assuming Rust code compiles.
4. Do not commit `.omx/` (agent session state), `dist/`, logs, or anything already gitignored.
5. Historical harnesses and old state notes may reference untracked GDPR drafts or `AGENTS.md`. The post-PR #26 canonical clone had a clean working tree and those paths were not present there. Do not assume they exist; if they reappear, do not modify or delete them without an explicit mission.
6. One known-flaky test: `LibraryView.test.tsx` "handles 1000 tracks..." can time out (>5s) under full-suite load but passes in isolation. Re-run it in isolation before blaming your change; don't delete it and don't raise the global timeout to hide it.

## Commands that work (re-verified 2026-09-19 where noted)

```
npm test                         # 2026-09-19: 67/67 PASS
npm run lint                     # 2026-09-19: PASS
npx tsc --noEmit -p tsconfig.json # 2026-09-19: PASS
npm run typecheck:wdio           # 2026-09-19: PASS
npm run build                    # frontend production build; hosted Release Gate separately runs npm run tauri build
npm run dev                      # vite only (frontend in browser, Tauri APIs unavailable)
cargo check --manifest-path src-tauri/Cargo.toml # 2026-09-19: PASS
cargo test --manifest-path src-tauri/Cargo.toml  # 2026-09-19: 106 passed / 0 failed / 2 ignored
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features # 2026-09-19: exit 0 with warnings
```

## Commands that can still fail in raw or unbootstrapped shells

```
npm run tauri dev
npm run tauri build
./verify.sh           # depends on tauri dev
```

If a shell bypasses the PowerShell bootstrap and the persisted user env fix, `cargo test --manifest-path src-tauri/Cargo.toml` can still hit `LNK1181 dbghelp.lib`; see `docs/RECOVERY_PLAN.md`.

## Where things live

| What | Where |
|---|---|
| Tauri command surface | `src-tauri/src/lib.rs` (6,930 lines; 112 registered logical handlers / 113 `#[tauri::command]` annotations because `get_semantic_status` has mutually exclusive cfg implementations) |
| SQLite layer | `src-tauri/src/db.rs` |
| yt-dlp wrapper / stream server | `src-tauri/src/ytdlp.rs`, `src-tauri/src/server.rs` (port 3456) |
| Ollama client + 72 prompts | `src-tauri/src/ollama/` |
| Frontend API bindings | `src/api.ts` |
| Global state | `src/store.ts` (Zustand) |
| Views (14) | `src/components/views/` |
| Frontend tests | `src/__tests__/` |
| Playbooks for common situations | `.claude/skills/{repo-recovery,quality-gate,pr-verification}/SKILL.md` |

## Session-end duty

If you changed code or discovered a state change (something newly broken/fixed), update `PROJECT_STATE.md` with the date and evidence before finishing. That file is the handoff to the next agent.
