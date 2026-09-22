# VERIFICATION_PROTOCOL — how to establish what actually works

Run this whenever you (a) start significant work, (b) are about to claim something is done, or (c) need to update PROJECT_STATE.md. Record outputs in a ledger (see EVIDENCE_LEDGER_TEMPLATE.md). GitHub Actions enforces the static/unit/build `Quality Gates` on pull requests and pushes to protected `main`. A separate path-filtered Windows `Release Gate` verifies exact-source production-bundle generation and artifact integrity. This protocol remains authoritative for environment, runtime, E2E, installer, and evidence-level claims that hosted build workflows do not establish.

Rules:
- A check "passes" only if you ran it in this session and saw the output. Cached knowledge, doc claims, and previous sessions don't count.
- On failure: first check PROJECT_STATE.md and .claude/skills/repo-recovery/SKILL.md — the failure may be a known environment issue, not your change. Distinguish "my diff broke it" from "it was already broken" by stashing/checking out main and re-running.
- Never weaken a check to make it pass (raising timeouts, skipping tests, `|| true`).

## Level 0 — Environment sanity (~10 s)

```
node --version          # expect v22.x
yt-dlp --version        # PASS only if parsed date version is >= 2026.08.19; nightly suffixes are allowed
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

Tauri's `generate_context!()` requires the configured `dist/` directory during Rust
compilation. Therefore Level 3 includes a frontend build prerequisite so it also works from a
fresh checkout or after `dist/` was cleaned.

```
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features
```

PASS requires the frontend prerequisite plus all four Rust commands to complete successfully. Record exact exit codes, Rust test
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
historical proof does **not** automatically transfer to later commits. A fresh full-flow
Tauri/WebView2 run on the current `main` baseline is **NOT RUN**. Multiple narrower runtime
harnesses prove individual subsystems only on their recorded SHAs; see `PROJECT_STATE.md`
for the evidence lineage and current-main qualifications.

## Level 5 — Production build — REQUIRED before any release/"production-ready" claim

```
npm run tauri build      # build portion PASS = release bundle(s) generated from the
                         # exact source being claimed; complete Level 5 also requires
                         # the resulting executable to satisfy the Level 4 runtime smoke
```

The hosted Windows `Release Gate` automates the production-build artifact portion of this level: it binds execution to an exact source SHA, verifies version metadata and `Cargo.toml`/`Cargo.lock` consistency, runs `npm run tauri build`, requires the standalone EXE plus MSI and NSIS bundles, and records file sizes and SHA-256 hashes in an evidence artifact.

A successful `Release Gate` is therefore evidence that production bundles were generated and inventoried from the exact commit. It does **not** launch or install those artifacts and does not execute Level 4. PR #37 has fresh Release Gate build/artifact-integrity evidence bound to its exact merged SHA. A later docs-only commit does not receive a new exact-SHA release artifact unless Release Gate is explicitly run for that commit. Do not infer a complete Level 5 or `production-ready` claim from Release Gate success alone.

Historical release/runtime evidence remains bound to the exact SHA on which it was recorded; see `PROJECT_STATE.md`.

## Reporting matrix

| You want to claim | Minimum level with fresh evidence |
|---|---|
| "typecheck passes" | 1 |
| "tests pass" | 1 (+3 if Rust touched) |
| "safe to merge" | 2 (+3 if Rust touched) |
| "feature works" | 4 |
| "production-ready" | 5 |

If you can't reach the required level (e.g. Level 3 broken), the honest claim is: "implemented, compiles at level N, unverified above that because X".
