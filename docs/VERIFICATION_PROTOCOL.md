# VERIFICATION_PROTOCOL — how to establish what actually works

Run this whenever you (a) start significant work, (b) are about to claim something is done, or (c) need to update PROJECT_STATE.md. Record outputs in a ledger (see EVIDENCE_LEDGER_TEMPLATE.md). There is no CI — this protocol is the CI.

Rules:
- A check "passes" only if you ran it in this session and saw the output. Cached knowledge, doc claims, and previous sessions don't count.
- On failure: first check PROJECT_STATE.md and .claude/skills/repo-recovery/SKILL.md — the failure may be a known environment issue, not your change. Distinguish "my diff broke it" from "it was already broken" by stashing/checking out main and re-running.
- Never weaken a check to make it pass (raising timeouts, skipping tests, `|| true`).

## Level 0 — Environment sanity (~10 s)

```
node --version          # expect v22.x
yt-dlp --version        # expect a version string; needed for runtime features
git branch --show-current
git status --short      # know what's dirty before you start
```

## Level 1 — Frontend static (~1 min) — REQUIRED for any TS/TSX change

```
npx tsc --noEmit        # PASS = exit 0, no output
npm test                # PASS = N/N, all discovered tests green (record the exact
                        # count from this session's output; see PROJECT_STATE.md
                        # for the last-known count). N-1/N acceptable ONLY if the
                        # failure is LibraryView "handles 1000 tracks" timeout AND
                        # it passes with:
npx vitest run src/__tests__/LibraryView.test.tsx -t "handles 1000 tracks"
```

## Level 2 — Frontend build (~30 s) — REQUIRED before merge to main

```
npm run build           # PASS = "built in Ns", dist/ produced, exit 0
```

## Level 3 — Rust (~2–10 min) — REQUIRED for any src-tauri change

```
cd src-tauri
cargo test              # PASS = compiles and all tests green (N/N — record the
                         # exact count from this session's output; see
                         # PROJECT_STATE.md for the last-known count)
```

Normal PowerShell shells on this machine auto-bootstrap MSVC + Windows SDK `10.0.26100.0` (see CLAUDE.md/AGENT_BRIEF.md), so this is not blocked by default. A shell that bypasses that bootstrap can still fail with `LNK1181 dbghelp.lib` (broken Windows SDK 10.0.28000.0 — see docs/RECOVERY_PLAN.md Step 1). If it fails this way, the environment is broken, not your code — but that also means **your Rust change is unverified**; you must say so wherever you report the work.

## Level 4 — Runtime smoke — REQUIRED before any "the app works" claim

```
npm run tauri dev                        # app window opens
curl http://localhost:3456/health        # stream server responds
```
Then manually: search → play → download → add to playlist → restart → data persisted.
This full flow has never passed in project history as one unified, continuous run
(see PROJECT_STATE.md `FULL_PRODUCT_E2E_ON_CURRENT_MAIN`, currently NOT PROVEN). It
is no longer blocked by Level 3, which now passes regularly (see PROJECT_STATE.md
for the current count). Multiple narrower runtime harnesses have proven individual
pieces of this flow on real Tauri/UI/Ollama — see PROJECT_STATE.md's Step-6R.* and
PR #12 entries — but no single current-main run has chained all of them together.

## Level 5 — Production build — REQUIRED before any release/"production-ready" claim

```
npm run tauri build      # PASS = bundle in src-tauri/target/release/ AND the
                         # built exe passes the Level 4 manual smoke
```
The build step alone has succeeded multiple times (see PROJECT_STATE.md Step-3A and
later rebuilds), but the full "build + built exe passes Level 4" combination has
never succeeded as one continuous run — see PROJECT_STATE.md `PRODUCTION_READY`
(currently NO) for the current status.

## Reporting matrix

| You want to claim | Minimum level with fresh evidence |
|---|---|
| "typecheck passes" | 1 |
| "tests pass" | 1 (+3 if Rust touched) |
| "safe to merge" | 2 (+3 if Rust touched) |
| "feature works" | 4 |
| "production-ready" | 5 |

If you can't reach the required level (e.g. Level 3 broken), the honest claim is: "implemented, compiles at level N, unverified above that because X".
