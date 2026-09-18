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

## Level 1 — Frontend static/unit (~1 min) — REQUIRED for any TS/TSX change

```
npm run lint                      # PASS = exit 0
npx tsc --noEmit -p tsconfig.json # PASS = exit 0
npm run typecheck:wdio            # PASS = exit 0
npm test                          # PASS = N/N, all discovered tests green; record
                                  # the exact count from this session
```

The historical LibraryView "handles 1000 tracks" test has been flaky under load. If it is
the only failure, rerun it in isolation and report both results; do not weaken or skip the
suite.

## Level 2 — Frontend build (~30 s) — REQUIRED before merge to main

```
npm run build           # PASS = "built in Ns", dist/ produced, exit 0
```

## Level 3 — Rust (~2–10 min) — REQUIRED for any src-tauri change

```
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features
```

PASS requires all four commands to complete successfully. Record exact exit codes, Rust test
counts, ignored tests, and Clippy warnings. On 2026-09-19 the normal PowerShell environment
found Visual Studio Build Tools 18 / MSVC and Rust 1.94.1 and completed these Rust gates.
If another shell fails before compilation, diagnose the MSVC/Windows SDK environment before
changing source; a Rust change remains unverified until the gate runs.

## Level 4 — Runtime smoke — REQUIRED before any "the app works" claim

```
npm run tauri dev                        # app window opens
curl http://localhost:3456/health        # stream server responds
```
Then manually: search → play → download → add to playlist → restart → data persisted.
The exact tagged `v1.0.0` release has a recorded unified full-flow runtime proof. That
historical proof does **not** automatically transfer to later commits: a fresh full-flow
Tauri/WebView2 run on post-PR #26 current `main` is **NOT RUN**. Multiple narrower runtime
harnesses also prove individual subsystems on their recorded SHAs; see `PROJECT_STATE.md`
for the evidence lineage and current-main qualifications.

## Level 5 — Production build — REQUIRED before any release/"production-ready" claim

```
npm run tauri build      # PASS = bundle in src-tauri/target/release/ AND the
                         # built exe passes the Level 4 manual smoke
```
The exact tagged `v1.0.0` release has recorded build + installed-runtime/full-flow evidence.
Do not reuse that result for later commits: current post-PR #26 `main` has not had a fresh
Level 5 rerun. Any release/"production-ready" claim must bind the Level 5 evidence to the
exact commit being claimed; see `PROJECT_STATE.md`.

## Reporting matrix

| You want to claim | Minimum level with fresh evidence |
|---|---|
| "typecheck passes" | 1 |
| "tests pass" | 1 (+3 if Rust touched) |
| "safe to merge" | 2 (+3 if Rust touched) |
| "feature works" | 4 |
| "production-ready" | 5 |

If you can't reach the required level (e.g. Level 3 broken), the honest claim is: "implemented, compiles at level N, unverified above that because X".
