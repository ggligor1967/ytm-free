---
name: tauri-command-scaffold
description: Use when adding or modifying a Tauri command in ytm-free — enforces the four-file pattern (lib.rs handler + registration, api.ts binding, types.ts types, store.ts/view caller) that PR review checks for.
---

# Tauri Command Scaffold — ytm-free

A Tauri command in this repo is never one file. `.claude/skills/pr-verification/SKILL.md` explicitly reviews for "four-file consistency" — missing any of the four is a reject. Work through all four in one pass, in this order.

## 1. `src-tauri/src/lib.rs` — handler + registration

Add the handler function, grouped near related commands under its section comment (e.g. `// YT-DLP`):

```rust
#[tauri::command]
async fn COMMAND_NAME(
    ARG_NAME: ARG_TYPE,
    OPTIONAL_ARG: Option<ARG_TYPE>,
) -> Result<RETURN_TYPE, String> {
    // delegate to a module fn; map errors to String with .map_err(|e| e.to_string())
    todo!()
}
```

Then add it to the `generate_handler!` macro list (search for `.invoke_handler(tauri::generate_handler![` — currently ~line 3885), in the same section-grouped order as the handler itself:

```rust
        .invoke_handler(tauri::generate_handler![
            // <SECTION>
            COMMAND_NAME,
```

lib.rs is 6,900+ lines — make a surgical, additive edit. Don't reformat or reorder surrounding commands.

## 2. `src/types.ts` — request/response types

Add any new shapes the command's args or return value need:

```typescript
export interface CommandNameResult {
  // mirror the Rust return struct's serde field names (camelCase if #[serde(rename_all = "camelCase")], else snake_case)
}
```

## 3. `src/api.ts` — invoke binding

Add a thin wrapper under the matching section comment, importing any new types from `./types`. Rust arg names are snake_case; the JS wrapper takes camelCase params and `invoke()` handles the conversion — pass an object literal with the camelCase keys matching the Rust fn signature by position/name:

```typescript
export async function commandNameCamel(argName: ArgType, optionalArg?: ArgType): Promise<ReturnType> {
  return invoke("COMMAND_NAME", { argName, optionalArg });
}
```

## 4. `src/store.ts` (or the calling view/hook) — caller

Wire it up where the data is actually consumed:
- **Global/shared state** (needed by multiple views, persisted across navigation) → add an action in `src/store.ts` that calls the `api.ts` wrapper and updates state.
- **View-local only** → call the `api.ts` wrapper directly from the component/hook in `src/components/` or `src/hooks/`.

Either is valid per CLAUDE.md; don't force store.ts if nothing else needs the state.

## Verification checklist

Before calling this done, confirm all four:

- [ ] `lib.rs`: `#[tauri::command] async fn COMMAND_NAME` exists
- [ ] `lib.rs`: `COMMAND_NAME` appears in the `generate_handler![...]` list
- [ ] `types.ts`: any new request/response types added (skip if primitives only)
- [ ] `api.ts`: `invoke("COMMAND_NAME", {...})` wrapper exported
- [ ] `store.ts` or a view/hook: the wrapper is actually called from somewhere

Then run `.claude/skills/quality-gate/SKILL.md` Gate C (cross-boundary change) — Gate A + Gate B both apply.
