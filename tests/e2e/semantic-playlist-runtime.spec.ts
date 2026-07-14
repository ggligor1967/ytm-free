import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const QUERY = "ambient music for calm focus and sleep";
const PLAYLIST_NAME = "Semantic Calm Focus";
const execFileAsync = promisify(execFile);

const TRACK_IDS: Record<string, string> = {
  "Calm Piano Sleep Meditation": "00000000-0000-4000-8000-0000000000a1",
  "Aggressive Metal Gym Workout": "00000000-0000-4000-8000-0000000000a2",
  "Upbeat Summer Dance Party": "00000000-0000-4000-8000-0000000000a3",
  "Melancholic Acoustic Rainy Evening": "00000000-0000-4000-8000-0000000000a4",
  "Instrumental Ambient Focus Coding": "00000000-0000-4000-8000-0000000000a5",
};

type Phase = "create" | "restart";

interface RuntimeProbe {
  total_tracks: number;
  indexed_tracks: number;
  model_used: string;
  is_indexing: boolean;
  runtime_process_id: number;
  ann_index_size: number;
  semantic_filtered_runtime_path: "ann" | "db_fallback" | null;
}

interface SemanticSearchResultRow {
  track: {
    id: string;
    video_id: string;
    title: string;
    artist: string;
  };
  similarity: number;
  match_reason: string;
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

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} must be set`);
  return value;
}

function parsePhase(): Phase {
  const value = requireEnvironment("SEMANTIC_PLAYLIST_PHASE");
  assert.ok(value === "create" || value === "restart", `Unsupported SEMANTIC_PLAYLIST_PHASE: ${value}`);
  return value;
}

async function writeJson(evidenceRoot: string, name: string, value: unknown): Promise<void> {
  await writeFile(path.join(evidenceRoot, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function getRuntimeProbe(): Promise<RuntimeProbe> {
  const outcome = await browser.executeAsync((done) => {
    type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
    const internals = (window as Window & { __TAURI_INTERNALS__?: { invoke?: Invoke } }).__TAURI_INTERNALS__;
    if (typeof internals?.invoke !== "function") {
      done({ ok: false, error: "FAIL — TAURI-RUNTIME-PROBE-UNAVAILABLE" });
      return;
    }
    internals.invoke("get_semantic_status")
      .then((value) => done({ ok: true, value: value as RuntimeProbe }))
      .catch((error) => done({ ok: false, error: String(error) }));
  }) as { ok: boolean; value?: RuntimeProbe; error?: string };

  assert.equal(outcome.ok, true, outcome.error || "get_semantic_status probe failed");
  assert.ok(outcome.value, "get_semantic_status returned no value");
  return outcome.value;
}

async function captureLogicalSnapshot(evidenceRoot: string, outputName: string): Promise<LogicalSnapshot> {
  const dataDir = requireEnvironment("YTM_FREE_DATA_DIR");
  const fixtureScript = path.join("scripts", "seed-semantic-search-query-fixture.py");
  const { stdout, stderr } = await execFileAsync(
    "py",
    ["-3", fixtureScript, "--data-dir", dataDir, "--logical-snapshot"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    },
  );
  assert.equal(stderr.trim(), "", `Logical SQLite snapshot wrote to stderr: ${stderr.trim()}`);
  const snapshot = JSON.parse(stdout) as LogicalSnapshot;
  assert.equal(snapshot.mode, "logical-read-only-snapshot");
  assert.ok(snapshot.logical_sha256);
  assert.ok(Object.keys(snapshot.tables).length > 0);
  await writeJson(evidenceRoot, outputName, snapshot);
  return snapshot;
}

function getChangedTables(before: LogicalSnapshot, after: LogicalSnapshot): string[] {
  const tableNames = [...new Set([...Object.keys(before.tables), ...Object.keys(after.tables)])].sort();
  return tableNames.filter((tableName) => {
    const left = before.tables[tableName];
    const right = after.tables[tableName];
    return !left || !right || left.row_count !== right.row_count || left.sha256 !== right.sha256;
  });
}

async function invokeIpc<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const outcome = await browser.executeAsync(
    (cmd: string, argObj: Record<string, unknown> | undefined, done: (result: unknown) => void) => {
      type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
      const internals = (window as Window & { __TAURI_INTERNALS__?: { invoke?: Invoke } }).__TAURI_INTERNALS__;
      if (typeof internals?.invoke !== "function") {
        done({ ok: false, error: "FAIL — TAURI-IPC-UNAVAILABLE" });
        return;
      }
      internals.invoke(cmd, argObj)
        .then((value) => done({ ok: true, value }))
        .catch((error) => done({ ok: false, error: String(error) }));
    },
    command,
    args,
  ) as { ok: boolean; value?: T; error?: string };

  assert.equal(outcome.ok, true, outcome.error || `IPC invoke(${command}) failed`);
  assert.ok(outcome.value !== undefined, `IPC invoke(${command}) returned no value`);
  return outcome.value as T;
}

async function getSemanticOracle(): Promise<SemanticSearchResultRow[]> {
  const results = await invokeIpc<SemanticSearchResultRow[]>("semantic_search", { query: QUERY });
  assert.ok(results.length > 0, "Semantic oracle returned no results");
  // Verify descending order.
  for (let i = 1; i < results.length; i++) {
    assert.ok(
      results[i - 1].similarity >= results[i].similarity,
      `Oracle results not descending at index ${i}`,
    );
  }
  return results;
}

async function navigateToPlaylists(): Promise<void> {
  const playlistsNav = await $("//nav//button[normalize-space(.)='Playlists']");
  await playlistsNav.waitForClickable({ timeout: 30_000 });
  await playlistsNav.click();
  await browser.waitUntil(async () => {
    const text = await $("body").getText();
    return /Playlists/i.test(text) && /\d+\s+playlists/i.test(text);
  }, { timeout: 15_000, timeoutMsg: "Did not navigate to Playlists view" });
}

async function indexThroughVisibleUi(): Promise<void> {
  const settings = await $("//button[.//span[normalize-space()='Settings']]");
  await settings.waitForClickable({ timeout: 30_000 });
  await settings.click();
  const semanticTab = await $("//button[contains(normalize-space(.), 'Semantic')]");
  await semanticTab.waitForClickable({ timeout: 30_000 });
  await semanticTab.click();

  const reindex = await $("//button[contains(normalize-space(.), 'Re-index All')]");
  await reindex.waitForClickable({ timeout: 30_000 });
  await reindex.click();
  await browser.waitUntil(async () => {
    const text = await $("body").getText();
    return /5\s*\/\s*5\s+tracks indexed/i.test(text) && /Re-index All/i.test(text);
  }, { timeout: 180_000, interval: 250, timeoutMsg: "Indexing did not reach 5 / 5" });

  // Navigate back to Playlists after indexing.
  await navigateToPlaylists();
}

async function openSemanticForm(): Promise<void> {
  const openButton = await $("#open-semantic-playlist-form");
  await openButton.waitForClickable({ timeout: 30_000 });
  await openButton.click();
  await $("#semantic-playlist-query").waitForDisplayed({ timeout: 10_000 });
}

async function fillAndSubmitSemanticForm(): Promise<void> {
  const queryInput = await $("#semantic-playlist-query");
  await queryInput.setValue(QUERY);

  const nameInput = await $("#semantic-playlist-name");
  await nameInput.setValue(PLAYLIST_NAME);

  const createButton = await $("#semantic-playlist-create");
  await createButton.waitForClickable({ timeout: 10_000 });
  await createButton.click();
}

async function waitForPlaylistNavigation(): Promise<void> {
  // Wait for toast feedback and navigation to PlaylistView.
  await browser.waitUntil(async () => {
    const text = await $("body").getText();
    return new RegExp(`Created\\s+${PLAYLIST_NAME}\\s+with\\s+\\d+\\s+tracks`, "i").test(text)
      || /Playlist/i.test(text) && /\d+\s+tracks/i.test(text);
  }, { timeout: 90_000, interval: 250, timeoutMsg: "Did not navigate to playlist view after create" });

  // Confirm we're on the PlaylistView page by checking for the playlist title.
  await browser.waitUntil(async () => {
    const text = await $("body").getText();
    return text.includes(PLAYLIST_NAME);
  }, { timeout: 15_000, timeoutMsg: "Playlist title not visible in PlaylistView" });
}

async function scrapeRenderedTracks(): Promise<TrackRow[]> {
  return (await browser.execute((trackIds: Record<string, string>) => {
    // TrackCard renders title in <p class="font-medium truncate"> and artist in
    // <p class="text-sm text-ytm-text-secondary truncate">.
    const titleElements = Array.from(document.querySelectorAll<HTMLParagraphElement>("p.font-medium.truncate"));
    const artistElements = Array.from(document.querySelectorAll<HTMLParagraphElement>("p.text-sm.text-ytm-text-secondary.truncate"));

    return titleElements.map((titleEl, index) => {
      const title = titleEl.textContent?.trim() || "";
      const artist = artistElements[index]?.textContent?.trim() || "";
      return {
        id: trackIds[title] ?? "",
        video_id: "",
        title,
        artist,
      };
    }).filter((row) => row.title.length > 0);
  }, TRACK_IDS)) as TrackRow[];
}

async function openPlaylistFromPlaylistsView(playlistName: string): Promise<void> {
  await navigateToPlaylists();
  // Click on the playlist card with the matching name.
  const playlistCard = await $(`//div[contains(@class, 'group') and .//h3[normalize-space(.)='${playlistName}']]`);
  await playlistCard.waitForClickable({ timeout: 30_000 });
  await playlistCard.click();
  await browser.waitUntil(async () => {
    const text = await $("body").getText();
    return text.includes(playlistName) && /\d+\s+tracks/i.test(text);
  }, { timeout: 15_000, timeoutMsg: `Did not open playlist ${playlistName}` });
}

describe("semantic playlist runtime", () => {
  it("proves playlist create → open → restart → persist through UI and IPC", async () => {
    const phase = parsePhase();
    const evidenceRoot = requireEnvironment("EVIDENCE_ROOT");
    requireEnvironment("YTM_FREE_DATA_DIR");
    await mkdir(evidenceRoot, { recursive: true });

    const root = await $("#root");
    await root.waitForDisplayed({ timeout: 30_000 });
    const probe = await getRuntimeProbe();
    await writeJson(evidenceRoot, "runtime-processes.json", {
      phase,
      runtime_process_id: probe.runtime_process_id,
      ann_index_size: probe.ann_index_size,
      indexed_tracks: probe.indexed_tracks,
      captured_at: new Date().toISOString(),
    });
    assert.ok(probe.runtime_process_id > 0, "Runtime PID must be positive");

    if (phase === "create") {
      // ===== CREATE PHASE =====
      assert.equal(probe.indexed_tracks, 0, "Expected 0 indexed tracks at start of create phase");
      assert.equal(probe.ann_index_size, 0, "Expected empty ANN at start of create phase");

      // Index tracks through visible UI (Re-index All).
      await indexThroughVisibleUi();

      // Capture probe after indexing.
      const probeAfterIndex = await getRuntimeProbe();
      assert.equal(probeAfterIndex.indexed_tracks, 5, "Expected 5 indexed tracks after Re-index All");
      assert.equal(probeAfterIndex.ann_index_size, 5, "Expected ANN size 5 after Re-index All");

      // Capture logical snapshot BEFORE playlist creation.
      const dbBeforeCreate = await captureLogicalSnapshot(evidenceRoot, "pre-create-logical-snapshot.json");

      // Get semantic oracle (expected IDs/order) via IPC.
      const oracle = await getSemanticOracle();
      const expectedIds = oracle.map((r) => r.track.id);
      const expectedTitles = oracle.map((r) => r.track.title);
      await writeJson(evidenceRoot, "semantic-oracle.json", {
        query: QUERY,
        expected_ids: expectedIds,
        expected_order: expectedTitles,
        results: oracle,
      });

      // Navigate to Playlists and open the semantic form.
      await navigateToPlaylists();
      await openSemanticForm();
      await fillAndSubmitSemanticForm();
      await waitForPlaylistNavigation();

      // Confirm playlist title in PlaylistView.
      const bodyText = await $("body").getText();
      assert.ok(
        bodyText.includes(PLAYLIST_NAME),
        `Playlist title "${PLAYLIST_NAME}" not visible in PlaylistView`,
      );

      // Scrape rendered tracks from PlaylistView.
      const renderedTracks = await scrapeRenderedTracks();
      assert.ok(renderedTracks.length > 0, "No tracks rendered in PlaylistView");
      assert.equal(
        renderedTracks.length,
        oracle.length,
        "Rendered track count does not match oracle count",
      );

      // Verify rendered order matches oracle order.
      const renderedTitles = renderedTracks.map((t) => t.title);
      assert.deepEqual(
        renderedTitles,
        expectedTitles,
        "Rendered track order does not match oracle order",
      );

      // Verify rendered IDs match oracle IDs.
      const renderedIds = renderedTracks.map((t) => t.id);
      assert.deepEqual(
        renderedIds,
        expectedIds,
        "Rendered track IDs do not match oracle IDs",
      );

      await writeJson(evidenceRoot, "created-playlist-ui.json", {
        playlist_name: PLAYLIST_NAME,
        rendered_track_count: renderedTracks.length,
        rendered_titles: renderedTitles,
        rendered_ids: renderedIds,
        oracle_ids: expectedIds,
        oracle_titles: expectedTitles,
        ui_matches_oracle: JSON.stringify(renderedIds) === JSON.stringify(expectedIds),
      });

      // Confirm via IPC read-only.
      const playlists = await invokeIpc<PlaylistRow[]>("get_playlists");
      const semanticPlaylists = playlists.filter((p) => p.name === PLAYLIST_NAME);
      assert.equal(semanticPlaylists.length, 1, `Expected exactly 1 playlist named "${PLAYLIST_NAME}"`);
      const createdPlaylist = semanticPlaylists[0];
      assert.ok(createdPlaylist.track_count > 0, "Created playlist has 0 tracks");

      const playlistTracks = await invokeIpc<TrackRow[]>("get_playlist_tracks", {
        playlistId: createdPlaylist.id,
      });
      const ipcIds = playlistTracks.map((t) => t.id);
      const ipcTitles = playlistTracks.map((t) => t.title);
      assert.deepEqual(ipcIds, expectedIds, "IPC track IDs do not match oracle IDs");
      assert.deepEqual(ipcTitles, expectedTitles, "IPC track titles do not match oracle titles");

      await writeJson(evidenceRoot, "created-playlist-ipc.json", {
        playlist_id: createdPlaylist.id,
        playlist_name: createdPlaylist.name,
        track_count: createdPlaylist.track_count,
        ipc_track_ids: ipcIds,
        ipc_track_titles: ipcTitles,
        oracle_ids: expectedIds,
        oracle_titles: expectedTitles,
        ipc_matches_oracle: JSON.stringify(ipcIds) === JSON.stringify(expectedIds),
      });

      // Capture logical snapshot AFTER create.
      const dbAfterCreate = await captureLogicalSnapshot(evidenceRoot, "post-create-logical-snapshot.json");

      // Verify only playlists + playlist_tracks changed.
      const changedTables = getChangedTables(dbBeforeCreate, dbAfterCreate);
      assert.deepEqual(
        changedTables.sort(),
        ["playlist_tracks", "playlists"].sort(),
        `Expected only playlists+playlist_tracks to change, got: ${changedTables.join(", ")}`,
      );

      await browser.saveScreenshot(path.join(evidenceRoot, "screenshot-create.png"));
      await writeFile(path.join(evidenceRoot, "dom-create.html"), await browser.getPageSource(), "utf8");
    } else {
      // ===== RESTART PHASE =====
      // Verify this is a new process — PID must differ from create phase.
      const createProcesses = JSON.parse(
        await readFile(path.join(path.dirname(evidenceRoot), "create", "runtime-processes.json"), "utf8"),
      ) as { runtime_process_id: number };
      assert.notEqual(
        probe.runtime_process_id,
        createProcesses.runtime_process_id,
        "Restart phase reused the create phase process",
      );

      // Verify tracks are already indexed (no reseed, no reindex).
      assert.equal(probe.indexed_tracks, 5, "Expected 5 indexed tracks at start of restart phase");
      assert.equal(probe.ann_index_size, 0, "Expected empty ANN at start of restart (fresh process)");

      // Navigate to Playlists.
      await navigateToPlaylists();

      // Confirm the playlist appears exactly once.
      const bodyText = await $("body").getText();
      const playlistCardCount = (await $$(`//div[contains(@class, 'group') and .//h3[normalize-space(.)='${PLAYLIST_NAME}']]`)).length;
      assert.equal(playlistCardCount, 1, `Expected exactly 1 playlist card named "${PLAYLIST_NAME}"`);

      // Open the playlist through UI.
      await openPlaylistFromPlaylistsView(PLAYLIST_NAME);

      // Read the create-phase IPC evidence for comparison.
      const createIpc = JSON.parse(
        await readFile(path.join(path.dirname(evidenceRoot), "create", "created-playlist-ipc.json"), "utf8"),
      ) as {
        playlist_id: string;
        track_count: number;
        ipc_track_ids: string[];
        ipc_track_titles: string[];
      };

      // Scrape rendered tracks from PlaylistView.
      const renderedTracks = await scrapeRenderedTracks();
      assert.equal(
        renderedTracks.length,
        createIpc.ipc_track_ids.length,
        "Restart rendered track count differs from create",
      );

      const renderedTitles = renderedTracks.map((t) => t.title);
      const renderedIds = renderedTracks.map((t) => t.id);
      assert.deepEqual(renderedIds, createIpc.ipc_track_ids, "Restart rendered IDs differ from create");
      assert.deepEqual(renderedTitles, createIpc.ipc_track_titles, "Restart rendered titles differ from create");

      await writeJson(evidenceRoot, "restart-playlist-ui.json", {
        playlist_name: PLAYLIST_NAME,
        rendered_track_count: renderedTracks.length,
        rendered_titles: renderedTitles,
        rendered_ids: renderedIds,
        create_ids: createIpc.ipc_track_ids,
        create_titles: createIpc.ipc_track_titles,
        restart_matches_create: JSON.stringify(renderedIds) === JSON.stringify(createIpc.ipc_track_ids),
      });

      // Confirm via IPC read-only.
      const playlists = await invokeIpc<PlaylistRow[]>("get_playlists");
      const semanticPlaylists = playlists.filter((p) => p.name === PLAYLIST_NAME);
      assert.equal(semanticPlaylists.length, 1, `Expected exactly 1 playlist named "${PLAYLIST_NAME}" after restart`);
      const restartPlaylist = semanticPlaylists[0];
      assert.equal(restartPlaylist.id, createIpc.playlist_id, "Restart playlist ID differs from create");
      assert.equal(restartPlaylist.track_count, createIpc.track_count, "Restart playlist track_count differs from create");

      const restartTracks = await invokeIpc<TrackRow[]>("get_playlist_tracks", {
        playlistId: restartPlaylist.id,
      });
      const restartIds = restartTracks.map((t) => t.id);
      const restartTitles = restartTracks.map((t) => t.title);
      assert.deepEqual(restartIds, createIpc.ipc_track_ids, "Restart IPC track IDs differ from create");
      assert.deepEqual(restartTitles, createIpc.ipc_track_titles, "Restart IPC track titles differ from create");

      await writeJson(evidenceRoot, "restart-playlist-ipc.json", {
        playlist_id: restartPlaylist.id,
        playlist_name: restartPlaylist.name,
        track_count: restartPlaylist.track_count,
        ipc_track_ids: restartIds,
        ipc_track_titles: restartTitles,
        create_ids: createIpc.ipc_track_ids,
        create_titles: createIpc.ipc_track_titles,
        restart_matches_create: JSON.stringify(restartIds) === JSON.stringify(createIpc.ipc_track_ids),
      });

      // Capture logical snapshot after restart.
      const dbAfterRestart = await captureLogicalSnapshot(evidenceRoot, "post-restart-logical-snapshot.json");

      // Read post-create snapshot for comparison.
      const dbAfterCreate = JSON.parse(
        await readFile(path.join(path.dirname(evidenceRoot), "create", "post-create-logical-snapshot.json"), "utf8"),
      ) as LogicalSnapshot;

      assert.equal(
        dbAfterRestart.logical_sha256,
        dbAfterCreate.logical_sha256,
        "post-restart logical SHA != post-create logical SHA — restart mutated DB",
      );

      const changedTables = getChangedTables(dbAfterCreate, dbAfterRestart);
      assert.deepEqual(
        changedTables,
        [],
        `Restart produced unexpected DB mutations: ${changedTables.join(", ")}`,
      );

      await browser.saveScreenshot(path.join(evidenceRoot, "screenshot-restart.png"));
      await writeFile(path.join(evidenceRoot, "dom-restart.html"), await browser.getPageSource(), "utf8");
    }
  });
});