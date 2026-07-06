---
name: quality-gate
description: Use before claiming any ytm-free work is complete, fixed, or passing — defines the exact commands, pass criteria, and honest-reporting rules. No evidence, no claim.
---

# Quality Gate — ytm-free

Run the gate that matches what you touched. Paste real output into your report using docs/EVIDENCE_LEDGER_TEMPLATE.md. There is no CI; this gate is the only thing standing between a bug and `main`.

## Gate A — any TypeScript/React change

```
npx tsc --noEmit                  # must exit 0
npm test                          # must be 32/32, OR 31/32 with ONLY the known
                                  # LibraryView 1000-tracks timeout (then run it
                                  # in isolation and record PASS-WITH-KNOWN-FLAKE)
npm run build                     # must produce dist/ and exit 0
```

## Gate B — any Rust (src-tauri) change

```
cd src-tauri && cargo test        # must compile and be green (~28 tests)
```

As of 2026-07-06 this is BLOCKED-ENV (`LNK1181 dbghelp.lib`, see skills/repo-recovery.md #1). While blocked, a Rust change may only be described as: *"implemented; NOT compiled or tested — toolchain broken (PROJECT_STATE.md)"*. Prefer not to merge unverified Rust changes to main at all; park them on a branch.

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
3. Never use the words "production-ready" for this project unless VERIFICATION_PROTOCOL.md Level 5 evidence exists from this session. (Historical docs contain this claim falsely — see PROJECT_STATE.md.)
4. If the gate reveals a pre-existing failure unrelated to your diff, don't silently fix or silently ignore it: record it in PROJECT_STATE.md and mention it in your report.
5. After passing gates, if the state of the world changed (something newly works/broken), update PROJECT_STATE.md — that's part of the gate, not optional.
