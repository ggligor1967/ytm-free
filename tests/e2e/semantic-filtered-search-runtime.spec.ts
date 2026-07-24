import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const QUERY = "ambient music for calm focus and sleep";
const EXPECTED_TRACK_COUNT = 5;
const EXPECTED_GENRE_TITLES = [
  "Calm Piano Sleep Meditation",
  "Instrumental Ambient Focus Coding",
] as const;
const EXPECTED_COMBINED_TITLE = "Calm Piano Sleep Meditation";
const HEADER_PLACEHOLDER_SUBSTRING = "Search for songs";
const execFileAsync = promisify(execFile);

const TRACK_IDS: Record<string, string> = {
  "Calm Piano Sleep Meditation": "00000000-0000-4000-8000-0000000000a1",
  "Aggressive Metal Gym Workout": "00000000-0000-4000-8000-0000000000a2",
  "Upbeat Summer Dance Party": "00000000-0000-4000-8000-0000000000a3",
  "Melancholic Acoustic Rainy Evening": "00000000-0000-4000-8000-0000000000a4",
  "Instrumental Ambient Focus Coding": "00000000-0000-4000-8000-0000000000a5",
};

type Phase = "ann" | "db-fallback";

interface RuntimeProbe {
  total_tracks: number;
  indexed_tracks: number;
  model_used: string;
  is_indexing: boolean;
  runtime_process_id: number;
  ann_index_size: number;
  semantic_filtered_runtime_path: "ann" | "db_fallback" | null;
}

interface ResultRow {
  rank: number;
  id: string | null;
  title: string | null;
  artist: string | null;
  percent: number | null;
  similarity: number | null;
  match_reason: string | null;
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

interface IndexSample {
  timestamp: number;
  percentage: number | null;
  indexed: number | null;
  total: number | null;
  current_track: string | null;
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} must be set`);
  return value;
}

function parsePhase(): Phase {
  const value = requireEnvironment("SEMANTIC_FILTERED_PHASE");
  assert.ok(value === "ann" || value === "db-fallback", `Unsupported SEMANTIC_FILTERED_PHASE: ${value}`);
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

function compareLogicalSnapshots(before: LogicalSnapshot, after: LogicalSnapshot): string[] {
  const tableNames = [...new Set([...Object.keys(before.tables), ...Object.keys(after.tables)])].sort();
  const changedTables = tableNames.filter((tableName) => {
    const left = before.tables[tableName];
    const right = after.tables[tableName];
    return !left || !right || left.row_count !== right.row_count || left.sha256 !== right.sha256;
  });
  assert.equal(after.logical_sha256, before.logical_sha256, "semantic filtered UI flow mutated SQLite logical state");
  assert.deepEqual(changedTables, [], "semantic filtered UI flow changed one or more SQLite tables");
  return changedTables;
}

async function enterQueryThroughHeader(): Promise<void> {
  await browser.execute((placeholderSubstring: string, query: string) => {
    const input = Array.from(document.querySelectorAll<HTMLInputElement>("input[type='text']"))
      .find((element) => (element.placeholder || "").includes(placeholderSubstring));
    if (!input) throw new Error(`Header search input not found: ${placeholderSubstring}`);
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      bubbles: true,
      cancelable: true,
    }));
  }, HEADER_PLACEHOLDER_SUBSTRING, QUERY);

  let triggered = false;
  try {
    await browser.waitUntil(async () => {
      const text = await $("body").getText();
      let settingsVisible = false;
      try {
        settingsVisible = await $("//button[contains(normalize-space(.), 'Re-index All')]").isDisplayed();
      } catch { /* element not present yet: settingsVisible stays false */ }
      triggered = /Searching for\s+"/i.test(text) || !settingsVisible;
      return triggered;
    }, { timeout: 12_000, interval: 200, timeoutMsg: "Header Enter did not start the YouTube preflight" });
  } catch {
    triggered = false;
  }

  if (!triggered) {
    const searchButton = await $("//header//button[normalize-space(.)='Search']");
    await searchButton.waitForClickable({ timeout: 10_000 });
    await searchButton.click();
  }

  const semanticButton = await $("//button[contains(normalize-space(.), 'Semantic')]");
  await semanticButton.waitForClickable({ timeout: 90_000 });
  await semanticButton.click();
  await $("#semantic-genres-filter").waitForDisplayed({ timeout: 90_000 });
}

async function scrapeRows(): Promise<ResultRow[]> {
  return (await browser.execute((trackIds: Record<string, string>) => {
    const reasons = Array.from(document.querySelectorAll("p"))
      .filter((element) => /^Semantic match\s+\d+%$/.test((element.textContent || "").trim()));
    return reasons.map((reason, index) => {
      const row = reason.closest("div.group") as HTMLElement | null;
      const title = row?.querySelector("p.font-medium.truncate")?.textContent?.trim() || null;
      const artist = row?.querySelector("p.text-sm.text-ytm-text-secondary.truncate")?.textContent?.trim() || null;
      const scoreText = row?.querySelector("span.text-sm.font-bold.text-ytm-accent")?.textContent?.trim() || null;
      const percent = scoreText ? Number(scoreText.replace("%", "")) : null;
      return {
        rank: index + 1,
        id: title ? trackIds[title] ?? null : null,
        title,
        artist,
        percent: Number.isFinite(percent as number) ? percent : null,
        similarity: Number.isFinite(percent as number) ? (percent as number) / 100 : null,
        match_reason: reason.textContent?.trim() || null,
      };
    });
  }, TRACK_IDS)) as ResultRow[];
}

function assertRowsValid(rows: ResultRow[]): void {
  assert.ok(rows.length > 0, "Expected rendered semantic results");
  for (const row of rows) {
    assert.ok(row.id, `Result rank ${row.rank}: fixture ID missing`);
    assert.ok(row.title, `Result rank ${row.rank}: title missing`);
    assert.ok(row.artist, `Result rank ${row.rank}: artist missing`);
    assert.ok(row.match_reason, `Result rank ${row.rank}: match reason missing`);
    assert.ok(row.similarity !== null && Number.isFinite(row.similarity));
    assert.ok((row.similarity as number) >= 0 && (row.similarity as number) <= 1);
  }
  const descending = rows.every(
    (row, index) => index === 0 || (rows[index - 1].percent as number) >= (row.percent as number),
  );
  assert.equal(descending, true, "Rendered result percentages are not descending");
}

async function applyFilters(
  evidenceRoot: string,
  kind: "genre" | "combined",
): Promise<ResultRow[]> {
  const genre = await $("#semantic-genres-filter");
  await genre.setValue("Ambient");
  if (kind === "combined") {
    await $("#semantic-moods-filter").setValue("Calm");
    await $("#semantic-activities-filter").setValue("sleep");
  }

  const apply = await $("//button[normalize-space(.)='Apply Filters']");
  await apply.waitForClickable({ timeout: 30_000 });
  await apply.click();
  const expectedCount = kind === "genre" ? 2 : 1;
  const expectedBadge = kind === "genre" ? "1 filter active" : "3 filters active";
  await browser.waitUntil(async () => {
    const text = await $("body").getText();
    return text.includes(expectedBadge)
      && new RegExp(`${expectedCount}\\s+filtered similar track${expectedCount === 1 ? "" : "s"}`, "i").test(text)
      && /Semantic match\s+\d+%/i.test(text);
  }, { timeout: 90_000, interval: 250, timeoutMsg: `${kind} filtered results did not render` });

  const rows = await scrapeRows();
  assertRowsValid(rows);
  const titles = rows.map((row) => row.title);
  if (kind === "genre") {
    assert.deepEqual(new Set(titles), new Set(EXPECTED_GENRE_TITLES), "BLOCKED-FIXTURE-NONDETERMINISTIC");
    assert.equal(rows.length, EXPECTED_GENRE_TITLES.length);
    assert.ok(!titles.some((title) => /Metal|Dance|Acoustic/i.test(title || "")));
  } else {
    assert.deepEqual(titles, [EXPECTED_COMBINED_TITLE], "Combined-filter oracle mismatch");
  }

  await writeJson(evidenceRoot, `${kind}-filter-results.json`, {
    query: QUERY,
    filters: kind === "genre"
      ? { genres: ["Ambient"], moods: [], activities: [] }
      : { genres: ["Ambient"], moods: ["Calm"], activities: ["sleep"] },
    result_ids: rows.map((row) => row.id),
    result_order: titles,
    all_scores_finite: rows.every((row) => row.similarity !== null && Number.isFinite(row.similarity)),
    all_scores_in_unit_interval: rows.every(
      (row) => row.similarity !== null && row.similarity >= 0 && row.similarity <= 1,
    ),
    order_descending: rows.every(
      (row, index) => index === 0 || (rows[index - 1].percent as number) >= (row.percent as number),
    ),
    results: rows,
  });
  return rows;
}

async function clearFilters(evidenceRoot: string): Promise<ResultRow[]> {
  const clear = await $("//button[normalize-space(.)='Clear Filters']");
  await clear.waitForClickable({ timeout: 30_000 });
  await clear.click();
  await browser.waitUntil(async () => {
    const text = await $("body").getText();
    return !/filters? active/i.test(text)
      && /\d+\s+similar tracks/i.test(text)
      && /Semantic match\s+\d+%/i.test(text);
  }, { timeout: 90_000, interval: 250, timeoutMsg: "Clear Filters did not return to unfiltered semantic search" });
  assert.equal(await $("#semantic-genres-filter").getValue(), "");
  assert.equal(await $("#semantic-moods-filter").getValue(), "");
  assert.equal(await $("#semantic-activities-filter").getValue(), "");
  const rows = await scrapeRows();
  assertRowsValid(rows);
  assert.equal(rows[0]?.title, EXPECTED_COMBINED_TITLE, "Unexpected top result after Clear Filters");
  await writeJson(evidenceRoot, "clear-filter-results.json", {
    query: QUERY,
    filters_active: false,
    actual_top_match: rows[0]?.title ?? null,
    result_order: rows.map((row) => row.title),
    results: rows,
  });
  return rows;
}

async function indexThroughVisibleUi(evidenceRoot: string): Promise<IndexSample[]> {
  const settings = await $("//button[.//span[normalize-space()='Settings']]");
  await settings.waitForClickable({ timeout: 30_000 });
  await settings.click();
  const semanticTab = await $("//button[contains(normalize-space(.), 'Semantic')]");
  await semanticTab.waitForClickable({ timeout: 30_000 });
  await semanticTab.click();
  const model = await $("select");
  assert.equal(await model.getValue(), "all-minilm");

  await browser.execute(() => {
    type HarnessWindow = Window & { __filteredIndexSamples?: IndexSample[]; __filteredIndexObserver?: MutationObserver };
    const target = window as HarnessWindow;
    target.__filteredIndexObserver?.disconnect();
    target.__filteredIndexSamples = [];
    const capture = () => {
      const text = document.body.innerText;
      const percentage = text.match(/\bIndexing\s+(\d+)%/i);
      const count = text.match(/(\d+)\s*\/\s*(\d+)\s+tracks indexed/i);
      const current = text.match(/(?:^|\n)Indexing:\s*([^\n]+)/i);
      const sample: IndexSample = {
        timestamp: Date.now(),
        percentage: percentage ? Number(percentage[1]) : null,
        indexed: count ? Number(count[1]) : null,
        total: count ? Number(count[2]) : null,
        current_track: current?.[1]?.trim() || null,
      };
      const samples = target.__filteredIndexSamples!;
      const previous = samples.at(-1);
      if (!previous || JSON.stringify(previous).replace(/"timestamp":\d+,?/, "") !== JSON.stringify(sample).replace(/"timestamp":\d+,?/, "")) {
        samples.push(sample);
      }
    };
    target.__filteredIndexObserver = new MutationObserver(capture);
    target.__filteredIndexObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
    capture();
  });

  const reindex = await $("//button[contains(normalize-space(.), 'Re-index All')]");
  await reindex.waitForClickable({ timeout: 30_000 });
  await reindex.click();
  await browser.waitUntil(async () => {
    const text = await $("body").getText();
    return new RegExp(`${EXPECTED_TRACK_COUNT}\\s*/\\s*${EXPECTED_TRACK_COUNT}\\s+tracks indexed`, "i").test(text)
      && /Re-index All/i.test(text);
  }, { timeout: 180_000, interval: 250, timeoutMsg: "Indexing did not reach 5 / 5" });

  const samples = await browser.execute(() => {
    type HarnessWindow = Window & { __filteredIndexSamples?: IndexSample[]; __filteredIndexObserver?: MutationObserver };
    const target = window as HarnessWindow;
    target.__filteredIndexObserver?.disconnect();
    return [...(target.__filteredIndexSamples ?? [])];
  }) as IndexSample[];
  assert.ok(samples.some((sample) => sample.percentage !== null && sample.percentage > 0 && sample.percentage < 100));
  await writeJson(evidenceRoot, "indexing-samples.json", samples);
  return samples;
}

describe("semantic filtered search runtime", () => {
  it("proves filtered UI parity through ANN and a fresh-process SQLite fallback", async () => {
    const phase = parsePhase();
    const evidenceRoot = requireEnvironment("EVIDENCE_ROOT");
    requireEnvironment("YTM_FREE_DATA_DIR");
    await mkdir(evidenceRoot, { recursive: true });

    const root = await $("#root");
    await root.waitForDisplayed({ timeout: 30_000 });
    const probeBefore = await getRuntimeProbe();
    await writeJson(evidenceRoot, "probe-before.json", probeBefore);
    assert.ok(probeBefore.runtime_process_id > 0);
    assert.equal(probeBefore.ann_index_size, 0);
    assert.equal(probeBefore.semantic_filtered_runtime_path, null);
    assert.equal(probeBefore.model_used, "all-minilm");

    if (phase === "ann") {
      assert.equal(probeBefore.indexed_tracks, 0);
      await indexThroughVisibleUi(evidenceRoot);
      const probeAfterIndex = await getRuntimeProbe();
      await writeJson(evidenceRoot, "probe-after-index.json", probeAfterIndex);
      assert.equal(probeAfterIndex.runtime_process_id, probeBefore.runtime_process_id);
      assert.equal(probeAfterIndex.indexed_tracks, EXPECTED_TRACK_COUNT);
      assert.equal(probeAfterIndex.ann_index_size, EXPECTED_TRACK_COUNT);
      assert.equal(probeAfterIndex.semantic_filtered_runtime_path, null);
    } else {
      assert.equal(probeBefore.indexed_tracks, EXPECTED_TRACK_COUNT);
      const phaseAProbe = JSON.parse(
        await readFile(path.join(path.dirname(evidenceRoot), "phase-a", "probe-before.json"), "utf8"),
      ) as RuntimeProbe;
      assert.notEqual(probeBefore.runtime_process_id, phaseAProbe.runtime_process_id, "Phase B reused the Phase A process");
      await writeJson(evidenceRoot, "reindex-clicked.json", { reindex_clicked: false });
    }

    const dbBefore = await captureLogicalSnapshot(evidenceRoot, "db-before-query.json");
    await enterQueryThroughHeader();
    const genreRows = await applyFilters(evidenceRoot, "genre");
    const genreProbe = await getRuntimeProbe();
    await writeJson(evidenceRoot, "probe-after-genre-filter.json", genreProbe);
    const expectedPath = phase === "ann" ? "ann" : "db_fallback";
    const expectedAnnSize = phase === "ann" ? EXPECTED_TRACK_COUNT : 0;
    assert.equal(genreProbe.runtime_process_id, probeBefore.runtime_process_id);
    assert.equal(genreProbe.ann_index_size, expectedAnnSize);
    assert.equal(genreProbe.semantic_filtered_runtime_path, expectedPath);

    const combinedRows = await applyFilters(evidenceRoot, "combined");
    const combinedProbe = await getRuntimeProbe();
    await writeJson(evidenceRoot, "probe-after-combined-filter.json", combinedProbe);
    assert.equal(combinedProbe.runtime_process_id, probeBefore.runtime_process_id);
    assert.equal(combinedProbe.ann_index_size, expectedAnnSize);
    assert.equal(combinedProbe.semantic_filtered_runtime_path, expectedPath);

    await browser.saveScreenshot(path.join(evidenceRoot, "screenshot.png"));
    await writeFile(path.join(evidenceRoot, "dom.html"), await browser.getPageSource(), "utf8");
    await clearFilters(evidenceRoot);
    const dbAfter = await captureLogicalSnapshot(evidenceRoot, "db-after-query.json");
    const changedTables = compareLogicalSnapshots(dbBefore, dbAfter);

    if (phase === "db-fallback") {
      const phaseARoot = path.join(path.dirname(evidenceRoot), "phase-a");
      const phaseAGenre = JSON.parse(await readFile(path.join(phaseARoot, "genre-filter-results.json"), "utf8")) as {
        result_ids: string[];
        result_order: string[];
      };
      const phaseACombined = JSON.parse(await readFile(path.join(phaseARoot, "combined-filter-results.json"), "utf8")) as {
        result_ids: string[];
        result_order: string[];
      };
      assert.deepEqual(genreRows.map((row) => row.id), phaseAGenre.result_ids, "FAIL — RESULT-PARITY: genre IDs");
      assert.deepEqual(genreRows.map((row) => row.title), phaseAGenre.result_order, "FAIL — RESULT-PARITY: genre order");
      assert.deepEqual(combinedRows.map((row) => row.id), phaseACombined.result_ids, "FAIL — RESULT-PARITY: combined IDs");
      assert.deepEqual(combinedRows.map((row) => row.title), phaseACombined.result_order, "FAIL — RESULT-PARITY: combined order");
    }

    await writeJson(evidenceRoot, "phase-summary.json", {
      phase,
      query: QUERY,
      filters: {
        genre_only: { genres: ["Ambient"], moods: [], activities: [] },
        combined: { genres: ["Ambient"], moods: ["Calm"], activities: ["sleep"] },
      },
      runtime_process_id: probeBefore.runtime_process_id,
      indexed_tracks_before: probeBefore.indexed_tracks,
      ann_index_size_before: probeBefore.ann_index_size,
      ann_index_size_after_filters: combinedProbe.ann_index_size,
      semantic_filtered_runtime_path: combinedProbe.semantic_filtered_runtime_path,
      genre_result_ids: genreRows.map((row) => row.id),
      genre_result_order: genreRows.map((row) => row.title),
      combined_result_ids: combinedRows.map((row) => row.id),
      combined_result_order: combinedRows.map((row) => row.title),
      db_before_logical_sha256: dbBefore.logical_sha256,
      db_after_logical_sha256: dbAfter.logical_sha256,
      db_logical_equal: dbBefore.logical_sha256 === dbAfter.logical_sha256,
      changed_tables: changedTables,
    });
  });
});
