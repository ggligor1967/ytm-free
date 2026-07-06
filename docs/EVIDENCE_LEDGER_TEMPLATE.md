# EVIDENCE_LEDGER — template

Copy this into your PR description, session summary, or a dated file (e.g. `docs/ledgers/2026-07-06-faza-6.md`) whenever you make a claim about the state of the project. One row per claim. A claim without a row is an opinion.

```markdown
## Evidence Ledger — <date> — <branch> — <who/which agent>

| # | Claim | Command run | Key output (verbatim, trimmed) | Verdict | Level* |
|---|-------|-------------|-------------------------------|---------|--------|
| 1 | TypeScript clean | `npx tsc --noEmit` | exit 0 | PASS | 1 |
| 2 | Frontend tests | `npm test` | `Tests 1 failed | 31 passed (32)` | PASS-WITH-KNOWN-FLAKE | 1 |
| 3 | Flake confirmed env-only | `npx vitest run src/__tests__/LibraryView.test.tsx -t "handles 1000 tracks"` | `1 passed` | PASS | 1 |
| 4 | Rust tests | `cargo test` (src-tauri/) | `LNK1181 dbghelp.lib` | BLOCKED-ENV | 3 |

### Unverified claims in this work
- <anything you implemented but could not verify, and why>

### State changes discovered (must be copied into PROJECT_STATE.md)
- <e.g. "cargo test now green as of <date>" or "none">
```

\* Level = the VERIFICATION_PROTOCOL.md level the command belongs to.

Verdict vocabulary (use exactly these):
- **PASS** — command ran, output matched the pass criterion.
- **FAIL** — command ran, criterion not met, and it's attributable to the current diff.
- **PASS-WITH-KNOWN-FLAKE** — failed in a way already documented in PROJECT_STATE.md, and the isolation re-run passed.
- **BLOCKED-ENV** — could not be evaluated because of a documented environment problem (cite it).
- **NOT-RUN** — you consciously skipped it; say why.

Anti-patterns this template exists to prevent:
- "All tests pass" with no output attached.
- Declaring "Production-Ready" in a doc (this repo has three such stale claims from 2026-02-14; don't create a fourth).
- Blaming your diff for the pre-existing `dbghelp.lib` breakage — or hiding behind it.
