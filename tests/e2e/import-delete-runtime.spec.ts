import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

type Phase = "create" | "restart";

interface RuntimeProbe {
  runtime_process_id: number;
}

interface SettingsRow {
  ollama_enabled: boolean;
  ollama_url: string;
}

interface PlaylistRow {
  id: string;
  name: string;
  description: string | null;
  track_count: number;
}

interface TrackRow {
  id: string;
  video_id: string;
  title: string;
  artist: string;
}

interface IpcLedgerEntry {
  timestamp_utc: string;
  command: string;
  argument_keys: string[];
}

interface CreateState {
  run_token: string;
  playlist_name: string;
  playlist_id: string;
  runtime_process_id: number;
  alpha_track_id: string;
  beta_track_id: string;
  beta_video_id: string;
}

interface LogicalTableSnapshot {
  row_count: number;
  sha256: string;
}

interface LogicalSnapshot {
  mode: "logical-read-only-snapshot";
  database: string;
  captured_at_utc: string;
  tables: Record<string, LogicalTableSnapshot>;
  logical_sha256: string;
}

const execFileAsync = promisify(execFile);

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} must be set`);
  return value;
}

function parsePhase(): Phase {
  const value = requireEnvironment("IMPORT_DELETE_PHASE");
  assert.ok(value === "create" || value === "restart", `Unsupported IMPORT_DELETE_PHASE: ${value}`);
  return value;
}

async function writeJson(evidenceRoot: string, name: string, value: unknown): Promise<void> {
  await writeFile(path.join(evidenceRoot, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function captureLogicalSnapshot(evidenceRoot: string, outputName: string): Promise<LogicalSnapshot> {
  const dataDir = requireEnvironment("YTM_FREE_DATA_DIR");
  const { stdout, stderr } = await execFileAsync(
    "py",
    ["-3", path.join("scripts", "seed-semantic-search-query-fixture.py"), "--data-dir", dataDir, "--logical-snapshot"],
    { cwd: process.cwd(), encoding: "utf8", maxBuffer: 10 * 1024 * 1024, windowsHide: true },
  );
  assert.equal(stderr.trim(), "", `Logical SQLite snapshot wrote to stderr: ${stderr.trim()}`);
  const snapshot = JSON.parse(stdout) as LogicalSnapshot;
  assert.equal(snapshot.mode, "logical-read-only-snapshot");
  assert.ok(snapshot.logical_sha256);
  await writeJson(evidenceRoot, outputName, snapshot);
  return snapshot;
}

function changedTables(before: LogicalSnapshot, after: LogicalSnapshot): string[] {
  const names = [...new Set([...Object.keys(before.tables), ...Object.keys(after.tables)])].sort();
  return names.filter((name) => {
    const left = before.tables[name];
    const right = after.tables[name];
    return !left || !right || left.row_count !== right.row_count || left.sha256 !== right.sha256;
  });
}

async function invokeIpc<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const outcome = await browser.executeAsync(
    (cmd: string, argumentObject: Record<string, unknown> | undefined, done: (result: unknown) => void) => {
      type Invoke = (commandName: string, commandArgs?: Record<string, unknown>) => Promise<unknown>;
      const internals = (window as Window & { __TAURI_INTERNALS__?: { invoke?: Invoke } }).__TAURI_INTERNALS__;
      if (typeof internals?.invoke !== "function") {
        done({ ok: false, error: "TAURI IPC is unavailable" });
        return;
      }
      internals.invoke(cmd, argumentObject)
        .then((value) => done({ ok: true, value }))
        .catch((error) => done({ ok: false, error: String(error) }));
    },
    command,
    args,
  ) as { ok: boolean; value?: T; error?: string };
  assert.equal(outcome.ok, true, outcome.error || `${command} failed`);
  return outcome.value as T;
}

async function getRuntimeProbe(): Promise<RuntimeProbe> {
  return invokeIpc<RuntimeProbe>("get_semantic_status");
}

async function installIpcLedger(): Promise<void> {
  const installed = await browser.execute(() => {
    type Invoke = (commandName: string, commandArgs?: Record<string, unknown>) => Promise<unknown>;
    type HarnessWindow = Window & {
      __TAURI_INTERNALS__?: { invoke?: Invoke };
      __IMPORT_DELETE_IPC_LEDGER__?: IpcLedgerEntry[];
      __IMPORT_DELETE_ORIGINAL_INVOKE__?: Invoke;
    };
    const harnessWindow = window as HarnessWindow;
    const internals = harnessWindow.__TAURI_INTERNALS__;
    if (typeof internals?.invoke !== "function") return false;
    if (harnessWindow.__IMPORT_DELETE_ORIGINAL_INVOKE__) return true;

    const original = internals.invoke.bind(internals);
    harnessWindow.__IMPORT_DELETE_IPC_LEDGER__ = [];
    harnessWindow.__IMPORT_DELETE_ORIGINAL_INVOKE__ = original;
    internals.invoke = (commandName: string, commandArgs?: Record<string, unknown>) => {
      harnessWindow.__IMPORT_DELETE_IPC_LEDGER__?.push({
        timestamp_utc: new Date().toISOString(),
        command: commandName,
        argument_keys: commandArgs ? Object.keys(commandArgs).sort() : [],
      });
      return original(commandName, commandArgs);
    };
    return true;
  });
  assert.equal(installed, true, "Unable to install Tauri IPC command ledger");
}

async function readIpcLedger(): Promise<IpcLedgerEntry[]> {
  return browser.execute(() => {
    const harnessWindow = window as Window & { __IMPORT_DELETE_IPC_LEDGER__?: IpcLedgerEntry[] };
    return harnessWindow.__IMPORT_DELETE_IPC_LEDGER__ ?? [];
  }) as Promise<IpcLedgerEntry[]>;
}

function assertNoForbiddenCommands(entries: IpcLedgerEntry[]): void {
  const forbidden = entries.filter(({ command }) =>
    /^(ollama_|smart_|ai_|insights_|share_)/.test(command)
      || command === "create_semantic_playlist"
      || command.startsWith("semantic_search")
      || command.startsWith("semantic_index"),
  );
  assert.deepEqual(
    forbidden.map(({ command }) => command),
    [],
    `Smart/AI commands were invoked: ${forbidden.map(({ command }) => command).join(", ")}`,
  );
}

async function clickAccessibleButton(text: string): Promise<void> {
  const buttons = await $$(`//button[normalize-space(.)=${JSON.stringify(text)}]`);
  assert.equal(buttons.length, 1, `Expected exactly one accessible button named ${text}`);
  await buttons[0].waitForClickable({ timeout: 15_000 });
  await buttons[0].click();
}

async function navigateToImport(): Promise<void> {
  await clickAccessibleButton("Import Spotify");
  await $("h1=Import from Spotify").waitForDisplayed({ timeout: 15_000 });
}

async function navigateToPlaylists(): Promise<void> {
  await clickAccessibleButton("Playlists");
  await $("h1=Playlists").waitForDisplayed({ timeout: 15_000 });
}

async function selectStandardMode(): Promise<void> {
  const standardButtons = await $$(`//button[normalize-space(.)='Standard']`);
  const standardButtonCount = await standardButtons.length;
  if (standardButtonCount > 0 && await standardButtons[0].isDisplayed()) {
    assert.equal(standardButtonCount, 1, "Standard mode selector is ambiguous");
    await standardButtons[0].click();
  }

  const startButton = await $('[data-testid="import-start-button"]');
  await browser.waitUntil(async () => (await startButton.getText()).trim() === "Start Import", {
    timeout: 10_000,
    timeoutMsg: "STANDARD-IMPORT-MODE-NOT-PROVEN: Start Import was not visible",
  });
  assert.equal((await startButton.getText()).includes("Smart Import"), false);
  const smartBanners = await $$(`//*[normalize-space(.)='AI-Enhanced Import Active']`);
  const displayedSmartBanners = await smartBanners.map((element) => element.isDisplayed());
  assert.equal(displayedSmartBanners.some(Boolean), false, "STANDARD-IMPORT-MODE-NOT-PROVEN: AI banner remains visible");
}

function trackByMarker(tracks: TrackRow[], marker: "Alpha" | "Beta", runToken: string): TrackRow {
  const expectedTitle = `Step6R3B1 ${marker} ${runToken}`;
  const matches = tracks.filter((track) => track.title === expectedTitle);
  assert.equal(matches.length, 1, `Expected exactly one ${marker} IPC track`);
  return matches[0];
}

async function findExactPlaylist(name: string): Promise<PlaylistRow> {
  const playlists = await invokeIpc<PlaylistRow[]>("get_playlists");
  const matches = playlists.filter((playlist) => playlist.name === name);
  assert.equal(matches.length, 1, `Expected exactly one playlist named ${name}`);
  return matches[0];
}

async function openPlaylistByName(name: string): Promise<void> {
  const cards = await $$(`//div[@data-testid=${JSON.stringify(`playlist-${name}`)}]`);
  assert.equal(await cards.length, 1, `Expected exactly one playlist card named ${name}`);
  await cards[0].click();
  await browser.waitUntil(async () => {
    const headings = await $$(`//h1[normalize-space(.)=${JSON.stringify(name)}]`);
    return (await headings.length) === 1;
  }, { timeout: 15_000, timeoutMsg: `Playlist ${name} did not open` });
}

async function wrapperCount(trackId: string): Promise<number> {
  return (await $$(`[data-testid="playlist-track-${trackId}"]`)).length;
}

async function capturePhaseEvidence(
  evidenceRoot: string,
  phase: Phase,
  runtimeProbe: RuntimeProbe,
  settings: SettingsRow,
  playlist: PlaylistRow,
  tracks: TrackRow[],
): Promise<void> {
  const ipcLedger = await readIpcLedger();
  assertNoForbiddenCommands(ipcLedger);
  await writeJson(evidenceRoot, `${phase}-ipc-command-ledger.json`, ipcLedger);
  await writeJson(evidenceRoot, `${phase}-state.json`, {
    phase,
    runtime_process_id: runtimeProbe.runtime_process_id,
    ollama_enabled: settings.ollama_enabled,
    settings: {
      ollama_enabled: Boolean(settings.ollama_enabled),
      ollama_url: String(settings.ollama_url),
    },
    playlist,
    tracks,
  });
  await browser.saveScreenshot(path.join(evidenceRoot, `${phase}-screenshot.png`));
  await writeFile(path.join(evidenceRoot, `${phase}-dom.html`), await browser.getPageSource(), "utf8");
}

describe("Step-6R.3B1 import/remove/restart runtime", () => {
  it("proves the requested UI phase without direct remove IPC", async () => {
    const phase = parsePhase();
    const runToken = requireEnvironment("RUN_TOKEN");
    const playlistName = requireEnvironment("PLAYLIST_NAME");
    const fixtureStem = requireEnvironment("FIXTURE_STEM");
    const evidenceRoot = requireEnvironment("EVIDENCE_ROOT");
    requireEnvironment("YTM_FREE_DATA_DIR");

    await installIpcLedger();
    const runtimeProbe = await getRuntimeProbe();
    assert.ok(runtimeProbe.runtime_process_id > 0, "Runtime PID must be positive");
    const settings = await invokeIpc<SettingsRow>("get_settings");
    assert.equal(settings.ollama_enabled, false, "OLLAMA-INVOCATION-DETECTED: settings.ollama_enabled is true");
    assert.equal(typeof settings.ollama_url, "string", "OLLAMA-STATE-EVIDENCE-SCHEMA-MISMATCH: ollama_url is not a string");
    assert.ok(settings.ollama_url.trim(), "OLLAMA-STATE-EVIDENCE-SCHEMA-MISMATCH: ollama_url is empty");

    if (phase === "create") {
      const databaseBefore = await captureLogicalSnapshot(evidenceRoot, "pre-create-logical-snapshot.json");
      await navigateToImport();

      const fixtureButtons = await $$(`[data-testid="import-file-${fixtureStem}"]`);
      assert.equal(await fixtureButtons.length, 1, `Expected exactly one fixture selector for ${fixtureStem}`);
      await fixtureButtons[0].click();

      await browser.waitUntil(async () => {
        const body = await $("body").getText();
        return body.includes("2 tracks")
          && body.includes(`Step6R3B1 Alpha ${runToken}`)
          && body.includes(`Step6R3B1 Beta ${runToken}`);
      }, { timeout: 15_000, timeoutMsg: "Synthetic fixture did not parse as exactly two tracks" });

      await selectStandardMode();

      const nameInputs = await $('input[placeholder="Playlist name"]');
      await nameInputs.waitForDisplayed({ timeout: 10_000 });
      await nameInputs.clearValue();
      await nameInputs.setValue(playlistName);
      assert.equal(await nameInputs.getValue(), playlistName, "Playlist name read-back mismatch");

      await $('[data-testid="import-start-button"]').click();
      await browser.waitUntil(async () => {
        const foundSummaries = await $$(`//div[contains(@class, 'bg-green-500/20') and .//p[normalize-space(.)='Found'] and .//p[normalize-space(.)='2']]`);
        return (await foundSummaries.length) === 1;
      }, { timeout: 30_000, timeoutMsg: "Expected exactly two Found import results" });

      const createButtons = await $$('[data-testid="import-create-playlist-button"]');
      assert.equal(createButtons.length, 1, "Create playlist button is ambiguous");
      assert.equal((await createButtons[0].getText()).includes("2 tracks"), true);
      await createButtons[0].click();

      const createdPlaylist = await findExactPlaylist(playlistName);
      let createdTracks: TrackRow[] = [];
      await browser.waitUntil(async () => {
        assert.equal(await browser.getTitle(), "YTM Free", "Application window is not alive while waiting for playlist tracks");
        const errorBanners = await $$(`//div[contains(@class, 'bg-red-500/20') and contains(@class, 'border-red-500/50')]`);
        assert.equal(await errorBanners.length, 0, "Error UI appeared while waiting for playlist tracks");
        createdTracks = await invokeIpc<TrackRow[]>("get_playlist_tracks", { playlistId: createdPlaylist.id });
        return createdTracks.length === 2;
      }, {
        timeout: 15_000,
        timeoutMsg: "Created playlist did not report exactly two tracks before the bounded timeout",
      });
      assert.equal(createdTracks.length, 2, "Created playlist IPC must return two tracks");
      const alpha = trackByMarker(createdTracks, "Alpha", runToken);
      const beta = trackByMarker(createdTracks, "Beta", runToken);

      assert.equal(await wrapperCount(alpha.id), 1, "Alpha wrapper cardinality mismatch");
      assert.equal(await wrapperCount(beta.id), 1, "Beta wrapper cardinality mismatch");

      const alphaWrapper = await $(`[data-testid="playlist-track-${alpha.id}"]`);
      const removeBefore = await alphaWrapper.$$('[data-testid="track-remove-from-playlist"]');
      assert.equal(removeBefore.length, 0, "Remove must be hidden before the TrackCard menu opens");
      const menuButtons = await alphaWrapper.$$(
        "./div[contains(concat(' ', normalize-space(@class), ' '), ' group ')]/div[contains(concat(' ', normalize-space(@class), ' '), ' relative ')]/button",
      );
      assert.equal(menuButtons.length, 1, "TRACKCARD-MENU-STRUCTURE-AMBIGUOUS");
      await menuButtons[0].click();
      const removeAfter = await alphaWrapper.$$('[data-testid="track-remove-from-playlist"]');
      assert.equal(removeAfter.length, 1, "Expected exactly one scoped Remove action after menu open");
      await removeAfter[0].click();

      await browser.waitUntil(async () => (await wrapperCount(alpha.id)) === 0, {
        timeout: 15_000,
        timeoutMsg: "Alpha remained visible after scoped UI Remove",
      });
      assert.equal(await wrapperCount(beta.id), 1, "Beta wrapper disappeared after removing Alpha");

      const playlistAfterRemove = await findExactPlaylist(playlistName);
      const tracksAfterRemove = await invokeIpc<TrackRow[]>("get_playlist_tracks", {
        playlistId: playlistAfterRemove.id,
      });
      assert.equal(playlistAfterRemove.track_count, 1, "Playlist count did not reload to one");
      assert.deepEqual(tracksAfterRemove.map((track) => track.id), [beta.id]);

      const ledger = await readIpcLedger();
      const removeLedgerCount = ledger.filter(({ command }) => command === "remove_from_playlist").length;
      const removeLedgerObservation = removeLedgerCount === 1
        ? "OBSERVED_EXACTLY_ONCE"
        : removeLedgerCount === 0 ? "NOT_OBSERVED" : "INCONCLUSIVE";
      console.log(`REMOVE_LEDGER_OBSERVATION:${removeLedgerObservation}`);
      console.log(`REMOVE_LEDGER_COUNT:${removeLedgerCount}`);
      assert.equal(ledger.some(({ command }) => command === "download_track"), false);
      assertNoForbiddenCommands(ledger);

      const createState: CreateState = {
        run_token: runToken,
        playlist_name: playlistName,
        playlist_id: playlistAfterRemove.id,
        runtime_process_id: runtimeProbe.runtime_process_id,
        alpha_track_id: alpha.id,
        beta_track_id: beta.id,
        beta_video_id: beta.video_id,
      };
      await writeJson(evidenceRoot, "create-contract-state.json", createState);
      const databaseAfter = await captureLogicalSnapshot(evidenceRoot, "post-create-logical-snapshot.json");
      assert.notEqual(databaseAfter.logical_sha256, databaseBefore.logical_sha256, "Import/remove did not change the logical database");
      await writeJson(evidenceRoot, "create-logical-delta.json", {
        before_sha256: databaseBefore.logical_sha256,
        after_sha256: databaseAfter.logical_sha256,
        changed_tables: changedTables(databaseBefore, databaseAfter),
      });
      await capturePhaseEvidence(
        evidenceRoot,
        phase,
        runtimeProbe,
        settings,
        playlistAfterRemove,
        tracksAfterRemove,
      );
    } else {
      const createStatePath = path.join(path.dirname(evidenceRoot), "create", "create-contract-state.json");
      const createState = JSON.parse(await readFile(createStatePath, "utf8")) as CreateState;
      assert.equal(createState.run_token, runToken);
      assert.equal(createState.playlist_name, playlistName);
      assert.notEqual(runtimeProbe.runtime_process_id, createState.runtime_process_id, "Restart reused create PID");

      await navigateToPlaylists();
      const playlistCards = await $$(`//div[@data-testid=${JSON.stringify(`playlist-${playlistName}`)}]`);
      assert.equal(playlistCards.length, 1, "Restart playlist card cardinality mismatch");
      assert.equal((await playlistCards[0].getText()).includes("1 tracks"), true, "Restart card count is not one");
      await openPlaylistByName(playlistName);

      const restartPlaylist = await findExactPlaylist(playlistName);
      assert.equal(restartPlaylist.id, createState.playlist_id, "Playlist ID changed across restart");
      assert.equal(restartPlaylist.track_count, 1, "Restart playlist count is not one");
      const restartTracks = await invokeIpc<TrackRow[]>("get_playlist_tracks", {
        playlistId: restartPlaylist.id,
      });
      assert.equal(restartTracks.length, 1);
      assert.equal(restartTracks[0].id, createState.beta_track_id);
      assert.equal(restartTracks[0].video_id, createState.beta_video_id);
      assert.equal(await wrapperCount(createState.alpha_track_id), 0, "Alpha reappeared after restart");
      assert.equal(await wrapperCount(createState.beta_track_id), 1, "Beta missing after restart");

      const databaseAfterRestart = await captureLogicalSnapshot(evidenceRoot, "post-restart-logical-snapshot.json");
      const databaseAfterCreate = JSON.parse(
        await readFile(path.join(path.dirname(evidenceRoot), "create", "post-create-logical-snapshot.json"), "utf8"),
      ) as LogicalSnapshot;
      assert.equal(
        databaseAfterRestart.logical_sha256,
        databaseAfterCreate.logical_sha256,
        "Restart mutated the logical database",
      );
      assert.deepEqual(changedTables(databaseAfterCreate, databaseAfterRestart), []);

      const ledger = await readIpcLedger();
      assert.equal(ledger.some(({ command }) => command === "remove_from_playlist"), false);
      assert.equal(ledger.some(({ command }) => command === "download_track"), false);
      assertNoForbiddenCommands(ledger);
      await capturePhaseEvidence(
        evidenceRoot,
        phase,
        runtimeProbe,
        settings,
        restartPlaylist,
        restartTracks,
      );
    }
  });
});
