# AGENT_BRIEF — read this before doing anything in ytm-free

Audience: any AI agent (Claude Code, Codex, Copilot, etc.) or human maintainer starting a session in this repo.

## 30-second orientation

- Desktop music player, personal use only. Tauri 2.x + React/TS frontend (`src/`) + Rust backend (`src-tauri/src/`). npm is the package manager. Docs are mixed English/Romanian ("Faza" = "Phase").
- The project is **feature-complete on paper but never validated end-to-end**. The underlying Windows SDK `10.0.28000.0` install is still partial on this machine, but as of 2026-07-08 normal PowerShell shells auto-bootstrap MSVC + SDK `10.0.26100.0`, so the routine Rust test workflow is no longer blocked there. Current truth: `PROJECT_STATE.md`.
- There is **no CI**. Nothing checks your work except you. Run the checks in `docs/VERIFICATION_PROTOCOL.md` yourself.

## Trust order for documentation

1. Command output you produced in this session (highest)
2. `PROJECT_STATE.md`
3. `docs/ROADMAP_STATUS.md` (Romanian, 2026-04-30)
4. Code itself (`src/`, `src-tauri/src/`)
5. Everything else in `docs/` and `README.md` — treat as **historical narrative**, not status. Several docs claim "Production-Ready ✅"; this has never been true (see PROJECT_STATE.md, "Known-stale documents").

## Hard rules

1. **Never claim "production-ready", "all tests pass", or "done" without pasting the command output that proves it.** This repo's docs are already polluted with unverified success claims; do not add more.
2. **Branch trap:** GitHub's default branch is `phase-2-frontend-bugs` (stale). The real trunk is `main`. Base branches and PRs on `main` explicitly. Never push to or "fix" `phase-2-frontend-bugs`.
3. **Do not assume every shell is healthy.** On this machine, PowerShell shells now auto-bootstrap SDK `10.0.26100.0`, but the partial SDK `10.0.28000.0` still exists on disk. If you are not in a normal PowerShell session, verify with `cargo test --no-run` before making claims; if it fails, say so instead of assuming Rust code compiles.
4. Do not commit `.omx/` (agent session state), `dist/`, logs, or anything already gitignored.
5. The GDPR remediation docs (`docs/GDPR_REMEDIATION_PLAN.md`, `gdpr-compliance-audit-report.md`) are uncommitted DRAFTs awaiting the owner's decision. Don't implement them or delete them without being asked.
6. One known-flaky test: `LibraryView.test.tsx` "handles 1000 tracks..." can time out (>5s) under full-suite load but passes in isolation. Re-run it in isolation before blaming your change; don't delete it and don't raise the global timeout to hide it.

## Commands that work (verified 2026-07-06)

```
npm test              # vitest run — expect 31–32/32 (see flaky note above)
npx tsc --noEmit      # expect 0 errors
npm run build         # tsc + vite build → dist/
npm run dev           # vite only (frontend in browser, Tauri APIs unavailable)
cargo test            # verified again 2026-07-08 in a normal PowerShell shell after the SDK 10.0.26100.0 bootstrap/profile fix
```

## Commands that can still fail in raw or unbootstrapped shells

```
npm run tauri dev
npm run tauri build
./verify.sh           # depends on tauri dev
```

If a shell bypasses the PowerShell bootstrap and the persisted user env fix, `cargo test` can still hit `LNK1181 dbghelp.lib`; see `docs/RECOVERY_PLAN.md`.

## Where things live

| What | Where |
|---|---|
| Tauri command handlers (112) | `src-tauri/src/lib.rs` (3372 lines — the god-file; be surgical) |
| SQLite layer | `src-tauri/src/db.rs` |
| yt-dlp wrapper / stream server | `src-tauri/src/ytdlp.rs`, `src-tauri/src/server.rs` (port 3456) |
| Ollama client + 72 prompts | `src-tauri/src/ollama/` |
| Frontend API bindings | `src/api.ts` |
| Global state | `src/store.ts` (Zustand) |
| Views (14) | `src/components/views/` |
| Frontend tests | `src/__tests__/` |
| Playbooks for common situations | `skills/` (repo-recovery, quality-gate, pr-verification) |

## Session-end duty

If you changed code or discovered a state change (something newly broken/fixed), update `PROJECT_STATE.md` with the date and evidence before finishing. That file is the handoff to the next agent.
