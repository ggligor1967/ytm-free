---
name: quality-gate
description: Use before claiming any ytm-free work is complete, fixed, or passing — defines the exact commands, pass criteria, and honest-reporting rules. No evidence, no claim.
---

# Quality Gate — ytm-free

Run the gate that matches what you touched. Paste real output into your report using docs/EVIDENCE_LEDGER_TEMPLATE.md. There is no CI; this gate is the only thing standing between a bug and `main`.

## Gate A — any TypeScript/React change

```
npm run lint                      # must exit 0
npx tsc --noEmit -p tsconfig.json # must exit 0
npm run typecheck:wdio            # must exit 0
npm test                          # must be N/N; record the exact count
npm run build                     # REQUIRED before merge for TypeScript/React changes; must produce dist/ and exit 0
```

The historical LibraryView 1000-tracks timeout has been flaky under load; if it is the only failure, rerun that test in isolation and report both results rather than masking it.

## Gate B — any Rust (src-tauri) change

Tauri's `generate_context!()` requires the configured `dist/` frontend directory even for
Rust check/test builds. From a fresh checkout or after cleaning `dist/`, build the frontend
first; do not treat the missing generated frontend artifact as a Rust-source failure.

```
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features
```

Record exact exit codes, test counts, ignored tests, and warnings. On 2026-09-19 a normal PowerShell shell found Visual Studio Build Tools 18 / MSVC and Rust 1.94.1, and `cargo check`, `cargo test`, and Clippy all completed. If a different shell fails before compilation, diagnose the MSVC/Windows SDK environment first; do not classify source as broken from an environment bootstrap failure.

## Gate C — cross-boundary change (new/changed Tauri command)

A Tauri command spans 4 files; verify all were updated together:
- handler + registration in `src-tauri/src/lib.rs` (`generate_handler!` list)
- binding in `src/api.ts`
- types in `src/types.ts`
- caller/state in `src/store.ts` or the view
Then Gate A + Gate B both apply.

## Gate D — "the feature works" claims

Gates A–C prove compilation and unit behavior only. Claiming user-visible behavior requires VERIFICATION_PROTOCOL.md Level 4 (run `npm run tauri dev`, exercise the actual flow, describe what you saw). If Level 4 is unreachable, the claim is "implemented and unit-tested, not exercised in the running app".

## Honest-reporting rules

1. Quote outputs verbatim (trimmed), with the command. "Tests pass" alone is not acceptable.
2. Report the gate you *couldn't* run as prominently as the ones you could.
3. Never apply "production-ready" to the current repository state unless VERIFICATION_PROTOCOL.md Level 5 evidence exists for the exact commit being claimed. Historical `v1.0.0` runtime proof does not automatically transfer to later commits; see PROJECT_STATE.md.
4. If the gate reveals a pre-existing failure unrelated to your diff, don't silently fix or silently ignore it: record it in PROJECT_STATE.md and mention it in your report.
5. After passing gates, if the state of the world changed (something newly works/broken), update PROJECT_STATE.md — that's part of the gate, not optional.
