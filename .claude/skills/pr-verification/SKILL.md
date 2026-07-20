---
name: pr-verification
description: Use when creating, updating, or reviewing a pull request in ytm-free — base-branch rules, required evidence, and doc-sync duties before merge.
---

# PR Verification — ytm-free

## Before creating the PR

1. **Base branch = `main`. Always.** GitHub's default branch is the stale `phase-2-frontend-bugs`; `gh pr create` and the web UI will preselect it. Pass `--base main` explicitly. A PR against the wrong base silently diffs against 9-commits-old code.
2. Branch naming follows existing convention: `faza-N/short-description` or `fix/…`, `debt/…`.
3. Run the applicable gates from .claude/skills/quality-gate/SKILL.md **on the final commit** (not an earlier state of the branch).
4. `git status --short` — nothing unintended staged; never include `.omx/`, `dist/`, `*.log`, personal CSVs.

## PR description must contain

- What changed and why (1–3 sentences; English or Romanian, match your audience).
- A filled evidence ledger (docs/EVIDENCE_LEDGER_TEMPLATE.md) — the actual commands and outputs.
- An explicit **Unverified** section if any gate was BLOCKED-ENV (e.g. Rust untestable) or NOT-RUN. An empty Unverified section is a claim in itself — make sure it's true.
- If behavior changed: which VERIFICATION_PROTOCOL.md level you reached, and what you observed at that level.

## Reviewing a PR (yours or another agent's)

1. Re-run the ledger commands yourself; do not accept pasted output on faith for merges to main.
2. Check the four-file consistency for any Tauri command change (lib.rs handler+registration, api.ts, types.ts, store/view).
3. Reject or flag: success adjectives without ledger rows; test deletions/timeout increases that make red tests green; edits to `docs/*COMPLETE*.md` that add new status claims (status belongs in PROJECT_STATE.md only).
4. Squash-merge is this repo's convention (feature-branch commits are not ancestors of main). After merge, delete the remote branch — the branch list already carries 4 stale ones.

## After merge

1. If the merge changed what works/what's broken, update PROJECT_STATE.md on main (dated).
2. If you hit a new failure signature along the way, add it to .claude/skills/repo-recovery/SKILL.md.
