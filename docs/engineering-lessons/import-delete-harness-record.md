# Engineering record — import/remove/restart runtime proof and the frozen harness

**Date of record:** 2026-07-16
**Status of the harness:** FROZEN on branch `feat/import-delete-runtime-harness` @ `69277dcca96f5c940b685b3d970beee4197401c2` (tag: `forensic/import-delete-harness-proof`). By owner decision (option O4), the harness does **not** merge into `main`.
**Application source modified by this work:** NO — the entire series added exactly three net-new files (harness, shim, spec) and touched nothing else.
**Application shown to be defective:** NO — every defect the series found was in the measuring instrument, not in the application.

All `file:line` citations below refer to the pinned commit `69277dc` on `feat/import-delete-runtime-harness` unless stated otherwise. The cited files do not exist on `main`; read them with `git show 69277dc:<path>`.

---

## 1. What was proven, and where

**The functional flow — CSV import → playlist creation → UI track removal → application restart → persistence — was demonstrated end-to-end against the real application** (Tauri 2.x release-style build, real WebView2, real SQLite), driven by WebdriverIO, with a deterministic `yt-dlp` shim standing in for the network.

**Proof run token:** `20260716-032504-7bb64827`
**EvidenceRoot:** `%TEMP%\ytm-free-import-delete-evidence-b3200d4f8d41-20260716-032504-7bb64827` (61 files; see §6 for integrity hashes and expiry).

Facts, each re-verified against the evidence files on 2026-07-16:

| Fact | Value | Evidence |
|---|---|---|
| Playlist ID (stable across restart) | `2edf0f3a-8827-4dc1-8ef0-83ab47b82086` | `create/create-state.json`, `restart/restart-state.json` |
| Alpha track UUID (removed via UI) | `569b3689-e4a4-4ce3-96df-b6cc6cd86ace` | `create/create-contract-state.json` |
| Beta track UUID (persists) | `98385ac2-111f-45e4-b390-3c5407495dd5` | both phase states; sole member after remove and after restart |
| Create-phase PID ≠ restart-phase PID | `8304` ≠ `18972` | `runtime_process_id` in both phase states; asserted by spec (`tests/e2e/import-delete-runtime.spec.ts:402`) and harness |
| Post-remove logical DB SHA-256 == post-restart logical DB SHA-256 | `DA200AD00C3EDCB79EB47EFD8976D148F03BA3CC3FA5D213DE6D7E36726B237D` | `create/post-create-logical-snapshot.json`, `restart/post-restart-logical-snapshot.json`, `final-logical-snapshot.json`; equality asserted at spec:426-429 |
| Tables changed across restart | none (SHA equality above) | same three snapshot files carry the identical hash |
| Global track rows / playlist-track rows after the flow | 2 / 1 | `restart/post-restart-logical-snapshot.json` (`tracks: 2`, `playlist_tracks: 1`) |
| Import-phase DB delta | `DEA4DD05…7D80` → `DA200AD0…237D`; changed tables `playlist_tracks`, `playlists`, `tracks` | `create/create-logical-delta.json` |
| Ollama disabled, no Ollama connection | `ollama_enabled: false` both phases | phase states; connection oracle at harness:5353-5361 |
| Evidence finalization | `run_status: PASS`, `finalization_status: FINALIZED`, `evidence_completeness: COMPLETE`, `finalization_failures: []` | `final-manifest.json` |
| Redaction | PASS — `clear_personal_path_match_count: 0`, 0 username matches; the two screenshots (`create/create-screenshot.png`, `restart/restart-screenshot.png`) were independently inspected clean | `clear-path-scan.json` |

**Verdicts of the proof session:** `FUNCTIONAL_RUNTIME: PASS` · `METADATA_RECONCILIATION: M1 (EVIDENCE-TIMING-GAP)` · `PLAYLIST_METADATA_CONSISTENCY: NO-DEFECT-DEMONSTRATED` · `NETWORK_ISOLATION: BLOCKED` · `DATA_SAFETY: PASS` · `OVERALL: PARTIAL` (partial only because of the network-isolation track, §4.1).

The proof run executed with `-NetworkGateMode Observe` (recorded in `create/network-gate-create.json` and `restart/network-gate-restart.json`): network observations were collected but did not gate the functional verdict; the functional result is proven by the DB/IPC/UI oracles above, not by network state.

---

## 2. How to get the instrument back

The instrument is **not on `main` and never was**. It lives, complete and runnable, at a frozen reference:

```
Branch:  feat/import-delete-runtime-harness
Commit:  69277dcca96f5c940b685b3d970beee4197401c2
Tag:     forensic/import-delete-harness-proof  (annotated, points at the commit above)
Parent baseline (origin/main at freeze time): b3200d4f8d4187bc25cc1f1d49d55bcbcf277212
```

Recovery commands:

```powershell
git fetch origin
git checkout feat/import-delete-runtime-harness        # or detached:
git checkout forensic/import-delete-harness-proof
```

That restores exactly three files (net-new relative to the baseline; nothing else differs):

```
scripts/run-import-delete-runtime-harness.ps1   (5645 lines — the orchestrator)
scripts/yt-dlp-import-delete-shim.rs            (227 lines — deterministic yt-dlp test double)
tests/e2e/import-delete-runtime.spec.ts         (447 lines — the WDIO functional-proof spec)
```

### 2.1 Nature of the instrument — know this before planning anything around it

- **Windows-only.** PowerShell 5.1 with `Set-StrictMode -Version Latest`; uses `Get-CimInstance Win32_Process`, `Get-NetTCPConnection`, `msedgewebview2.exe` process inspection, and a Win32 `kernel32` snapshot inside the Rust shim.
- **Manually invoked.** No tracked file references it; no `package.json` script runs it; the repository has no CI at all (no `.github/workflows`). Discoverability is exactly this document plus the branch and tag.
- **Self-gating.** It refuses to run unless: branch is `feat/import-delete-runtime-harness`, `origin/main` equals the pinned baseline, the tracked worktree is clean, staging is empty, and the only untracked files are the four allow-listed governance files (`Assert-GitContext`, harness:403-425; expected identity constants at harness:20-21, 46-56). To run it from any other branch/baseline you must consciously edit those constants — that is by design.
- **External dependencies not carried by the three files:** `wdio.conf.ts`, `src-tauri/tauri.wdio.conf.json`, `scripts/seed-semantic-search-query-fixture.py` (logical DB snapshot helper, harness:44), the `harness:build` npm script, `node_modules/.bin/wdio`, `rustc`, `py`, and the UI selectors in `src/components/**` that the contract validation asserts.

### 2.2 Entry points (harness:1-11 parameter block)

```powershell
# The demonstrated functional flow (preflight → fixture → shim compile → app build →
# wdio create/remove → wdio restart → DB proof → finalization). Default mode:
powershell -ExecutionPolicy Bypass -File scripts\run-import-delete-runtime-harness.ps1

# The proof run of record used the network gate in observe mode:
powershell -ExecutionPolicy Bypass -File scripts\run-import-delete-runtime-harness.ps1 -NetworkGateMode Observe

# Self-validation modes (no app run; each exercises one subsystem against synthetic state):
...\run-import-delete-runtime-harness.ps1 -ContractValidateOnly
...\run-import-delete-runtime-harness.ps1 -PreflightOnly
...\run-import-delete-runtime-harness.ps1 -LaunchPlanValidateOnly
...\run-import-delete-runtime-harness.ps1 -MonitorAndFinalizationValidateOnly
...\run-import-delete-runtime-harness.ps1 -ExternalCommandValidateOnly
...\run-import-delete-runtime-harness.ps1 -WebViewIsolationValidateOnly   # the BLOCKED network track (§4.1)
```

Modes are mutually exclusive (dispatch guard, harness:5450-5462). `-NetworkGateMode` accepts `Enforce` (abort on non-loopback traffic) or `Observe` (record and continue).

---

## 3. Do not rebuild this

**~6319 lines of working, self-validating orchestration already exist on that branch** (5645 harness + 227 shim + 447 spec). If you are tempted to write a new runtime harness for this application — or "a small script, just for this one check" — read this section first.

The failure mode of this series has a name: **the instrument grew larger than the code it measured.** Eleven commits were spent between the first version of the harness and the first completed end-to-end run — ten of them repairing or hardening the instrument itself (exit-code capture twice, finalization four times, monitor cleanup, redaction, empty-log semantics), zero of them fixing the application, because the application was never broken. Every one of those repairs is already embodied in the frozen code and distilled in §5.

If you need the proof again: check out the tag and run the harness (§2). If you need a different proof: start from the frozen harness's K-region primitives (preflight, `Invoke-ExternalCaptured`, `Start-WdioPhase`/`Monitor-WdioPhase`, the finalization machinery) rather than rewriting them — they encode a long list of Windows/PowerShell 5.1 failure modes that will otherwise be relearned one flaky run at a time.

---

## 4. Known limitations — stated without softening

### 4.1 `NETWORK_ISOLATION: BLOCKED` (separate track; not fixed, not merged)

The attempt to force the application's WebView2 into behavioral network isolation did **not** succeed:

- The temporary Tauri config overlay (`-WebViewIsolationValidateOnly` path) does place the intended flags — proxy to an owned loopback deny-proxy, `--disable-background-networking`, etc. — on the WebView2 browser-root command line (`New-TemporaryTauriConfiguration`, harness:2013-2089; verified by `Assert-WebViewBrowserRoot`, harness:2361-2437). **Flag application is proven; behavioral isolation is not achieved:** owned WebView2 processes still opened non-loopback TCP connections, and the validation gate aborts with `WEBVIEW2-NETWORK-ISOLATION-NOT-AVAILABLE` (harness:4874-4877). The isolation run of 2026-07-15 aborted with `UNEXPECTED-OWNED-PROCESS-NETWORK-CONNECTION` (its `primary-failure.json`).
- Observed connections included `8.8.8.8:443` and `8.8.4.4:443` (`create/owned-tcp-create.json`, `restart/owned-tcp-restart.json` in the proof EvidenceRoot). **Hypothesis, not fact:** these may be DNS-over-HTTPS traffic from the browser stack. No domain is attributed to any IP; no capture of payload or SNI exists in the evidence.
- **The functional flow does not apply the isolation flags at all** (`WEBVIEW2_ARGS_APPLIED: False`). The config overlay is wired only into `-WebViewIsolationValidateOnly`. The functional flow instead sets the `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` environment variable (harness:5287-5308), and that path is **ineffective**: in both phases of the proof run the browser-root audit recorded `webview_gate_status: OBSERVED-FAILED` with `webview_gate_error: WEBVIEW2-BROWSER-FLAGS-MISSING` (`create/network-gate-create.json`, `restart/network-gate-restart.json`; non-loopback counts 37 create / 15 restart). The functional proof therefore ran **without** network isolation, in Observe mode, and its verdict does not depend on network state.

### 4.2 D1 — the reported StrictMode `.Count`-on-scalar at harness line 4996

Two prior reports contradicted each other: the runtime session that produced `69277dc` reported that `-WebViewIsolationValidateOnly` exposed a StrictMode defect — `.Count` on a scalar — at `scripts/run-import-delete-runtime-harness.ps1:4996`; the later static integration audit of the same pinned HEAD reported the defect **not present**. Reconciliation performed 2026-07-16, on the pinned files:

- **`D1_PRESENT_IN_HEAD: False.`** Line 4996 at `69277dc` reads `$result = [ordered]@{` — the opening of the ValidateOnly result-assembly statement (harness:4996-5039). Every `.Count` inside that statement, and every `.Count` reachable from it, is applied to an `@()`-wrapped array or a real collection (`$evidenceFiles` wrapped at 4988-4991; the non-loopback filter wrapped at 5008-5011; `$nonLoopbackConnections` wrapped at 4859-4861). A full-file enumeration of `.Count` sites found no scalar receiver.
- No committed tree of the series contains a `.Count`-on-scalar at *its* line 4996 either. Only three distinct harness blobs ever contained the ValidateOnly mode — `fe4c4d2`, `77e361d` (identical harness through `e12edac`), and `69277dc` — and all three were checked at that line and through their result blocks: the `@()` wrapping is present from `fe4c4d2` onward (i.e., from the moment the subsystem was born).
- The harness's own git gate (`Assert-GitContext`, harness:403-425) refuses to run past preflight with unstaged or staged tracked changes, so any run that reached line 4996 executed a committed blob. The single surviving ValidateOnly EvidenceRoot (2026-07-15, executed at `fe4c4d2` per its `git-preflight.json`) records `UNEXPECTED-OWNED-PROCESS-NETWORK-CONNECTION` as its primary failure — not a StrictMode error.
- **What remains unproven (INFERRED):** the origin of the runtime report's claim. The most consistent explanation is that the error was observed against a transient, uncommitted working-tree state during the `69277dc` session (such a state is unrecoverable from git, and a dirty-tree attempt aborts at preflight — *after* which the result-assembly code of the *current file on disk* still executes on the failure path), or that the report mis-attributed the line. Neither can be shown now. The defect is absent from the frozen code; **it was not fixed as part of this record and lives nowhere that is being merged.**

### 4.3 D2 — `Sort-Object` on `[ordered]` dictionary keys (latent, in the frozen X region)

`Monitor-WdioPhase`'s network-gate tuple summary sorts `[ordered]@{}` connection records with `Sort-Object observed_at_utc` (harness:2544) and takes `first_seen_utc`/`last_seen_utc` from the ends of the result (harness:2554-2555). `Sort-Object` cannot bind a dictionary key as a property, so the sort is a no-op and the values fall back to append order. Because `$connections` is appended chronologically, the emitted values are usually correct in practice — the defect is latent, affects only network-gate diagnostic timestamps, and is dead code when no non-loopback connection exists. It lives inside the network-isolation (X) region that is **not** being merged, and by owner decision it stays unfixed on the frozen branch. If the network gate is ever revived: sort the raw source list (or real `[datetime]` values), not the dictionary key.

### 4.4 The `e12edac` assertion downgrade — recorded here so it is visible, not buried

Commit `e12edac` converted a hard post-remove oracle — `assert.equal(ledger.filter(remove_from_playlist).length, 1)` — into a **non-failing diagnostic**: `REMOVE_LEDGER_OBSERVATION` (`OBSERVED_EXACTLY_ONCE` / `NOT_OBSERVED` / `INCONCLUSIVE`) plus `REMOVE_LEDGER_COUNT`, emitted via `console.log` (spec:362-368). In the proof run the diagnostic read `NOT_OBSERVED` / count `0` (`create/wdio.stdout.log`) — the IPC ledger had not yet stabilized when read. This is the `M1 EVIDENCE-TIMING-GAP` reconciliation: an evidence-timing artifact, not a product defect.

**The risk, stated honestly:** this is exactly the class of change the project's protocol forbids — *do not modify an expectation to mask a defect.* It is defensible here **only** because the underlying fact (the remove happened and persisted) is proven by three independent surviving oracles, and only the timing-dependent IPC counter was downgraded:

1. **UI wrapper disappearance** — Alpha's wrapper count polled to `0` with a bounded failing timeout, Beta stays `1` (spec:349-353; re-checked after restart at spec:419-420);
2. **`get_playlist_tracks` IPC** — exactly `[beta.id]` remains after remove (spec:356-360) and after restart (spec:413-418);
3. **DB logical delta** — post-remove logical SHA recorded (spec:382-388) and proven identical after restart (spec:426-429; the `DA200AD0…237D` equality in §1).

The owner ruled the downgrade **acceptable on condition that it is recorded here explicitly**, with rationale and risk side by side. It is. Any future strengthening should re-promote the ledger check by polling the ledger with a bounded timeout (the lesson-7 pattern) rather than reading it once.

---

## 5. Lessons register (11 entries, re-verified against the pinned files on 2026-07-16)

Confidence labels are preserved exactly from the audit: **PROVEN** = demonstrated by code/diff/run evidence; **INFERRED** = plausible explanation not directly demonstrated. All 11 entries were substantiated; none dropped. Citations are to `69277dc`.

1. **`Sort-Object -Unique` dedups by the sort key, not by value.** In redaction-rule builders, dedup by value first (`Select-Object -Unique`, or a `HashSet`) and sort by length separately, longest-first — otherwise distinct same-length tokens are dropped and text is under-redacted. Evidence: `Get-EvidenceRedactionRules`, harness:1036-1073 (HashSet dedup at 1053-1057; `Select-Object -Unique | Sort-Object Length -Descending` at 1062; final longest-first sort at 1072). **PROVEN.**
2. **PowerShell automatic variables are case-insensitive and often read-only — never assign `$PID`, `$Matches`, `$Host`, `$Error`, `$Input`, …** The harness enforces this with an AST self-audit that fails the run on any write to a forbidden name. Evidence: `Get-AutomaticVariableWriteCollisions`, harness:489-541 (forbidden list 491-497); the guard is a HIGH-value validation and should survive any future edit of the file. **PROVEN.**
3. **`Start-Process -PassThru` `.ExitCode` is unreliable on PowerShell 5.1 with redirected output.** Construct `System.Diagnostics.Process` directly, drain stdout/stderr with `ReadToEndAsync()`, `WaitForExit()`, then read `ExitCode` once into a validated `[int]` before `Dispose` — and treat a non-int as a hard failure (`WDIO-EXIT-CODE-CAPTURE-FAILED`). Evidence: `Invoke-ExternalCaptured`, harness:1262-1492; the same pattern retrofitted onto the WDIO launch path in the `69277dc` diff (`Start-WdioPhase`/`Monitor-WdioPhase`). **PROVEN.**
4. **A `[Parameter(Mandatory)] [string]` rejects the empty string; empty stdout/stderr is a valid success.** Use `[AllowEmptyString()]` and reject only `$null`; publish empty streams as zero-byte evidence without classifying them as a file lock. Evidence: `Write-Utf8NoBom`, harness:135-150 (`WRITE-UTF8-VALUE-NULL`); `Invoke-EmptyLogFinalizationValidation`, harness:4125-4264 (asserts `PASS_EMPTY`, zero bytes, and no false `RUNTIME-FILE-LOCK-PERSISTED`). **PROVEN.**
5. **WebView2 flag injection: the Tauri config `additionalBrowserArgs` overlay works mechanically; the env-var path does not — and neither achieved isolation.** PROVEN parts: the overlay places the flags on the browser-root command line (harness:2013-2089, audited at 2361-2437); `additionalBrowserArgs` *replaces* the default Wry flags, so the harness re-includes `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection` and asserts `DEFAULT_WRY_DISABLE_FEATURES_PRESERVED` (harness:2000-2011, 2064-2070); behavioral isolation still failed (gate at harness:4874-4877). INFERRED part: *why* the plain `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` env var was ineffective (suspected: the app constructs its WebView2 environment programmatically, bypassing the env var). The ValidateOnly path abandons the env var — sets it to `$null` (harness:4824) — and uses the overlay instead; the functional flow still uses the env var and demonstrably gets no flags (§4.1). **PROVEN (overlay behavior) + INFERRED (env-var root cause).**
6. **`finalization_status` and `evidence_completeness` are different properties — never conflate them.** Structural finalization (`PARTIAL` → `FINALIZED`: the ledgers/inventory/manifest exist and agree) is independent of whether the evidence set is `COMPLETE`/`INCOMPLETE`. A publication failure must yield `FINALIZED` + `INCOMPLETE`, not a stuck `PARTIAL`. Evidence: `Invoke-HarnessFinalization`, harness:3604-3633 (completeness set at 3606, `FINALIZED` decided structurally at 3623-3628); asserted together in `Invoke-PublicationFailureFinalizationValidation` (harness:4359-4360). **PROVEN.**
7. **An oracle read immediately after a UI click observes transient state — poll the underlying fact with a bounded, failing timeout, never a fixed sleep or a single immediate read.** Evidence: the `e5fb6b0` diff replaced an immediate post-create `track_count`/`get_playlist_tracks` read with `browser.waitUntil(…, 15s)` that also asserts the window is alive and no error banner appeared (now spec:317-329). **PROVEN.**
8. **Metadata/IPC counters ≠ membership row counts (the M1 gap).** Reading an IPC ledger before it stabilizes is an evidence-timing gap, not a product defect; prove state through rows/DB and keep the counter as a diagnostic. Evidence: the `e12edac` diff and §4.4 — remove proven by wrapper disappearance + `get_playlist_tracks` + DB delta while `REMOVE_LEDGER_COUNT` read `0`. **PROVEN** (as the M1 reconciliation; no product-defect claim is made).
9. **Reject reparse points before any recursive enumeration or delete on temp trees** — a junction placed in an owned tree can redirect `Remove-Item -Recurse` outside it. Evidence: `Get-SafeFileTree` (reparse rejection at harness:256-264 and 290-299, containment at 287-289), `Assert-NoReparseDescendant` (harness:309-321), proven against a synthetic junction with an external sentinel file in `Invoke-SafeTreeContractValidation` (harness:835-943, junction at 880-887). **PROVEN.**
10. **Write a per-run ownership marker on temp roots and verify it before destructive cleanup**, so a pre-existing or spoofed directory is never deleted. Evidence: `New-OwnedRoot` / `Assert-OwnedRoot`, harness:774-809 (marker `.step6r3b1-owned.json` with contract + run token; mismatch → `TEMP-ROOT-UNSAFE`). **PROVEN.**
11. **Emit path evidence as per-run HMACs with a non-persisted key** — evidence stays comparable across snapshots without leaking personal paths, and the key is zeroed, never written. Evidence: `Get-HmacHex` (harness:821-833), `Get-PrivacySnapshot` (harness:944-973, `path_hmac`), `comparison_key_persisted = $false` (harness:3262, 3287), `[Array]::Clear($hmacKey, …)` at every exit path (e.g. harness:940, 3858, 5431). **PROVEN.**

Register totals: **11 carried · 10 fully PROVEN · 1 with an INFERRED component (the env-var root cause inside #5) · 0 dropped.** One citation drift found during re-verification and corrected here: the audit cited the env-var abandonment at harness:4808; at the pinned HEAD it is harness:4824.

---

## 6. The evidence pointer and its expiry

The proof EvidenceRoot lives under `%TEMP%` and **Windows will eventually delete it** (temp cleanup, disk cleanup, OS reinstall). Nothing in the repository depends on it — this record and the frozen branch are self-sufficient — but if the evidence is archived, verify the copy against these hashes:

```
EvidenceRoot:  %TEMP%\ytm-free-import-delete-evidence-b3200d4f8d41-20260716-032504-7bb64827
Files:         61
Inventory SHA-256 (final-evidence-inventory.json):  CC94346CE3EBD8668118B6038174B10BBE2A5152ED11AC0A0E85B11719638C51
Manifest  SHA-256 (final-manifest.json):            AA7A4B9E6E5CD713D7E2210D466BF2882F40C8CF5E49DF1C3590D947AF59DCCE
evidence_completeness: COMPLETE · finalization_failures: []
Redaction: PASS (0 clear-path matches, all variants; 2 screenshots visually clean)
```

Archive it to a durable location **outside the repository**; the destination is owner-selected. Never commit evidence into the repo.

**RESTRICTED:** the earlier isolation-run EvidenceRoot `20260715-225227-93754cce` (`%TEMP%\ytm-free-webview-isolation-evidence-20260715-225227-93754cce`) contains clear personal-path occurrences (a redaction false-negative, since fixed by the username-level redaction added in `77e361d`). It must **never** be archived, published, or copied into the repository. It stays read-only in `%TEMP%` until Windows removes it.

---

*End of record. The application was never modified and never shown to be defective; the instrument that proved it is frozen at `forensic/import-delete-harness-proof`; and the eleven lessons above are the durable yield of the series.*
