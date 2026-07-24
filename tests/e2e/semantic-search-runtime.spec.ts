import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const QUERY = "quiet music for sleeping";
const HEADER_PLACEHOLDER_SUBSTRING = "Search for songs";
const EXPECTED_TRACK_COUNT = 5;
const EXPECTED_TOP_MATCH = "Calm Piano Sleep Meditation";
const execFileAsync = promisify(execFile);

interface IndexSample {
  timestamp: number;
  percentage: number | null;
  indexed: number | null;
  total: number | null;
  currentTrack: string | null;
}

interface PreflightSample {
  timestamp: number;
  youtube_loading: boolean;
  semantic_button_clickable: boolean;
}

interface LoadingSample {
  timestamp: number;
  semantic_loading: boolean;
  results_present: boolean;
  empty_state: boolean;
}

interface ResultRow {
  rank: number;
  title: string | null;
  artist: string | null;
  percent: number | null;
  match_reason: string | null;
  similarity: number | null;
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

function finiteOrNull(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return value;
}

async function captureLogicalSnapshot(
  evidenceRoot: string,
  outputName: "db-before-query.json" | "db-after-query.json",
): Promise<LogicalSnapshot> {
  const dataDir = process.env.YTM_FREE_DATA_DIR;
  assert.ok(dataDir, "YTM_FREE_DATA_DIR must be set for logical SQLite snapshots");
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
  assert.equal(snapshot.mode, "logical-read-only-snapshot", "Unexpected SQLite snapshot mode");
  assert.ok(snapshot.logical_sha256, "Logical SQLite snapshot digest is missing");
  assert.ok(snapshot.tables && Object.keys(snapshot.tables).length > 0, "Logical SQLite snapshot has no tables");
  await writeFile(path.join(evidenceRoot, outputName), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return snapshot;
}

describe("semantic search runtime", () => {
  it("proves the real UI query -> semantic_search -> Ollama embed -> cosine -> UI results flow", async () => {
    const evidenceRoot = process.env.EVIDENCE_ROOT;
    assert.ok(evidenceRoot, "EVIDENCE_ROOT must be set");
    await mkdir(evidenceRoot, { recursive: true });

    const root = await $("#root");
    await root.waitForDisplayed({ timeout: 30_000 });

    // ------------------------------------------------------------------
    // Phase A: Settings -> Semantic -> Re-index All (real Ollama embeddings)
    // ------------------------------------------------------------------
    const settingsButton = await $("//button[.//span[normalize-space()='Settings']]");
    await settingsButton.waitForClickable({ timeout: 30_000 });
    await settingsButton.click();

    const semanticTab = await $("//button[contains(normalize-space(.), 'Semantic')]");
    await semanticTab.waitForClickable({ timeout: 30_000 });
    await semanticTab.click();

    const reindexButton = await $("//button[contains(normalize-space(.), 'Re-index All')]");
    await reindexButton.waitForClickable({ timeout: 30_000 });

    const modelSelect = await $("select");
    assert.equal(await modelSelect.getValue(), "all-minilm", "Fixture must select all-minilm");

    // MutationObserver captures the real intermediate indexing progress emitted
    // by the backend via the "semantic-index-progress" Tauri event.
    await browser.execute(() => {
      type HarnessWindow = Window & {
        __ytmSemanticSearchIndexSamples?: IndexSample[];
        __ytmSemanticSearchIndexObserver?: MutationObserver;
      };
      const harnessWindow = window as HarnessWindow;
      harnessWindow.__ytmSemanticSearchIndexObserver?.disconnect();
      harnessWindow.__ytmSemanticSearchIndexSamples = [];

      const capture = () => {
        const text = document.body.innerText;
        const percentageMatch = text.match(/\bIndexing\s+(\d+)%/i);
        const countMatch = text.match(/(\d+)\s*\/\s*(\d+)\s+tracks indexed/i);
        const currentTrackElement = Array.from(document.querySelectorAll<HTMLElement>("[title]"))
          .find((element) => element.textContent?.trim().startsWith("Indexing:"));
        const textTrackMatch = text.match(/(?:^|\n)Indexing:\s*([^\n]+)/i);
        const currentTrack = currentTrackElement?.getAttribute("title")?.trim()
          || textTrackMatch?.[1]?.trim()
          || null;
        const sample: IndexSample = {
          timestamp: Date.now(),
          percentage: percentageMatch ? Number(percentageMatch[1]) : null,
          indexed: countMatch ? Number(countMatch[1]) : null,
          total: countMatch ? Number(countMatch[2]) : null,
          currentTrack,
        };
        const samples = harnessWindow.__ytmSemanticSearchIndexSamples!;
        const previous = samples.at(-1);
        const signature = `${sample.percentage}|${sample.indexed}|${sample.total}|${sample.currentTrack}`;
        const previousSignature = previous
          ? `${previous.percentage}|${previous.indexed}|${previous.total}|${previous.currentTrack}`
          : null;
        if (signature !== previousSignature) {
          samples.push(sample);
        }
      };

      harnessWindow.__ytmSemanticSearchIndexObserver = new MutationObserver(capture);
      harnessWindow.__ytmSemanticSearchIndexObserver.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["style", "title"],
      });
      capture();
    });

    await reindexButton.click();

    await browser.waitUntil(
      async () => {
        const text = await $("body").getText();
        return (
          new RegExp(`${EXPECTED_TRACK_COUNT}\\s*/\\s*${EXPECTED_TRACK_COUNT}\\s+tracks indexed`, "i").test(text)
          && /Re-index All/i.test(text)
        );
      },
      {
        timeout: 180_000,
        interval: 250,
        timeoutMsg: `Semantic indexing did not reach the final ${EXPECTED_TRACK_COUNT} / ${EXPECTED_TRACK_COUNT} UI state`,
      },
    );

    const indexSamples = await browser.execute(() => {
      type HarnessWindow = Window & {
        __ytmSemanticSearchIndexSamples?: IndexSample[];
        __ytmSemanticSearchIndexObserver?: MutationObserver;
      };
      const harnessWindow = window as HarnessWindow;
      const captured = [...(harnessWindow.__ytmSemanticSearchIndexSamples ?? [])];
      harnessWindow.__ytmSemanticSearchIndexObserver?.disconnect();
      return captured;
    });

    const preFinalIndexSamples = indexSamples.filter(
      (sample) =>
        sample.percentage !== 100
        && !(sample.indexed === EXPECTED_TRACK_COUNT && sample.total === EXPECTED_TRACK_COUNT),
    );
    const hasIntermediatePercentage = preFinalIndexSamples.some(
      (sample) => sample.percentage !== null && sample.percentage >= 1 && sample.percentage <= 99,
    );
    const distinctCurrentTracks = new Set(
      preFinalIndexSamples
        .map((sample) => sample.currentTrack)
        .filter((track): track is string => Boolean(track)),
    );
    assert.ok(
      hasIntermediatePercentage && distinctCurrentTracks.size >= 2,
      "Expected both an intermediate percentage and at least two distinct current-track values during indexing",
    );

    const modelUsedFromUi = await modelSelect.getValue();
    const bodyTextAfterIndex = await $("body").getText();
    assert.match(
      bodyTextAfterIndex,
      new RegExp(`${EXPECTED_TRACK_COUNT}\\s*/\\s*${EXPECTED_TRACK_COUNT}\\s+tracks indexed`, "i"),
    );

    const dbAfterIndex = {
      source: "dom-ui",
      captured_via: "settings-semantic-tab",
      tracks: EXPECTED_TRACK_COUNT,
      embeddings: EXPECTED_TRACK_COUNT,
      model_used: modelUsedFromUi,
      indexing_completed: true,
      index_samples_count: indexSamples.length,
      has_intermediate_percentage: hasIntermediatePercentage,
      distinct_current_tracks: distinctCurrentTracks.size,
      captured_at_utc: new Date().toISOString(),
    };
    await writeFile(
      path.join(evidenceRoot, "db-after-index.json"),
      `${JSON.stringify(dbAfterIndex, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(evidenceRoot, "semantic-indexing-samples.json"),
      `${JSON.stringify(indexSamples, null, 2)}\n`,
      "utf8",
    );

    // ------------------------------------------------------------------
    // Phase B: Header search input -> Enter (YouTube preflight) -> Semantic
    // ------------------------------------------------------------------
    // The Header search input is always visible. Driving it (not Zustand, not a
    // direct invoke) is the UI flow under test. The Header dispatches the
    // YouTube preflight (search_youtube) and navigates to SearchView; the
    // Semantic toggle only becomes reachable after the preflight finishes.
    const dbBeforeQuery = await captureLogicalSnapshot(evidenceRoot, "db-before-query.json");
    const enteredAt = Date.now();
    await browser.execute((placeholderSubstring: string, query: string) => {
      const input = Array.from(document.querySelectorAll<HTMLInputElement>("input[type='text']"))
        .find((el) => (el.placeholder || "").includes(placeholderSubstring));
      if (!input) {
        throw new Error(`Header search input not found by placeholder substring "${placeholderSubstring}"`);
      }
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, query);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }),
      );
    }, HEADER_PLACEHOLDER_SUBSTRING, QUERY);

    await writeFile(
      path.join(evidenceRoot, "semantic-query-input.json"),
      `${JSON.stringify({
        query: QUERY,
        entry_method: "visible-header-input",
        placeholder_substring: HEADER_PLACEHOLDER_SUBSTRING,
        key: "Enter",
        entered_at_epoch_ms: enteredAt,
        captured_at_utc: new Date().toISOString(),
      }, null, 2)}\n`,
      "utf8",
    );

    // Confirm the Enter keydown actually triggered the Header search. If it did,
    // either the YouTube loading state appears or we navigate away from Settings
    // (Re-index All disappears) into SearchView. If the native Enter dispatch did
    // not trigger React's onKeyDown (an environment quirk), fall back to clicking
    // the visible Search button — which calls the same handleSearch() path and is
    // still a UI action, not a Zustand/invoke bypass.
    let enterTriggered = false;
    try {
      await browser.waitUntil(
        async () => {
          const text = await $("body").getText();
          const youtubeLoading = /Searching for\s+"/i.test(text);
          let reindexGone = true;
          try {
            const reindexBtn = await $("//button[contains(normalize-space(.), 'Re-index All')]");
            reindexGone = !(await reindexBtn.isDisplayed());
          } catch { /* element not present yet: reindexGone stays true */ }
          enterTriggered = youtubeLoading || reindexGone;
          return enterTriggered;
        },
        { timeout: 12_000, interval: 200, timeoutMsg: "Enter dispatch did not trigger the Header search" },
      );
    } catch {
      enterTriggered = false;
    }
    let entryVia = "Enter keydown in header input";
    if (!enterTriggered) {
      const searchBtn = await $("//header//button[normalize-space(.)='Search']");
      await searchBtn.waitForClickable({ timeout: 10_000 });
      await searchBtn.click();
      entryVia = "Search button click (Enter keydown did not trigger; fallback still drives handleSearch via the visible button)";
    }

    // Observe the YouTube preflight: poll until the Semantic button becomes
    // clickable (which only happens once isSearching is false, i.e. the
    // preflight finished — succeeding or showing zero results).
    const preflightSamples: PreflightSample[] = [];
    const preflightStart = Date.now();
    const semanticButtonSelector = "//button[contains(normalize-space(.), 'Semantic')]";
    await browser.waitUntil(
      async () => {
        const text = await $("body").getText();
        const youtubeLoading = /Searching for\s+"/i.test(text) && /Searching for/i.test(text);
        let semanticClickable = false;
        try {
          const btn = await $(semanticButtonSelector);
          semanticClickable = await btn.isClickable();
        } catch { /* element not present yet: semanticClickable stays false */ }
        preflightSamples.push({
          timestamp: Date.now(),
          youtube_loading: youtubeLoading,
          semantic_button_clickable: semanticClickable,
        });
        return semanticClickable;
      },
      { timeout: 90_000, interval: 250, timeoutMsg: "Semantic button did not become clickable after YouTube preflight" },
    );
    const preflightEnd = Date.now();
    const youtubeLoadingSeen = preflightSamples.some((sample) => sample.youtube_loading);
    await writeFile(
      path.join(evidenceRoot, "youtube-preflight-result.json"),
      `${JSON.stringify({
        query: QUERY,
        entry_via: entryVia,
        youtube_loading_seen: youtubeLoadingSeen,
        youtube_loading_samples: preflightSamples.filter((sample) => sample.youtube_loading).length,
        semantic_button_became_clickable: true,
        preflight_duration_ms: preflightEnd - preflightStart,
        note: "YouTube preflight (search_youtube) ran via the Header flow; its success/zero outcome is not a PASS criterion for this step, only that it finished and the Semantic button became reachable.",
        samples: preflightSamples,
      }, null, 2)}\n`,
      "utf8",
    );

    // ------------------------------------------------------------------
    // Phase C: click Semantic -> observe "🧠 Searching your library..." -> results
    // ------------------------------------------------------------------
    const semanticButton = await $(semanticButtonSelector);
    await semanticButton.waitForClickable({ timeout: 30_000 });
    // Click the visible Semantic mode toggle. This sets searchMode='semantic',
    // firing the SearchView useEffect that calls performSemanticSearch ->
    // api.semanticSearch -> Tauri semantic_search -> Ollama all-minilm embed.
    await semanticButton.click();

    const loadingSamples: LoadingSample[] = [];
    await browser.waitUntil(
      async () => {
        const text = await $("body").getText();
        const semanticLoading = /Searching your library/i.test(text);
        const resultsPresent = /Semantic match\s+\d+%/i.test(text);
        const emptyState = /No similar tracks found/i.test(text);
        loadingSamples.push({
          timestamp: Date.now(),
          semantic_loading: semanticLoading,
          results_present: resultsPresent,
          empty_state: emptyState,
        });
        return resultsPresent || emptyState;
      },
      { timeout: 90_000, interval: 250, timeoutMsg: "Semantic search results (or empty state) did not appear" },
    );

    const dbAfterQuery = await captureLogicalSnapshot(evidenceRoot, "db-after-query.json");
    const tableNamesBefore = Object.keys(dbBeforeQuery.tables).sort();
    const tableNamesAfter = Object.keys(dbAfterQuery.tables).sort();
    const allTableNames = [...new Set([...tableNamesBefore, ...tableNamesAfter])].sort();
    const changedTables = allTableNames.filter((tableName) => {
      const before = dbBeforeQuery.tables[tableName];
      const after = dbAfterQuery.tables[tableName];
      return !before
        || !after
        || before.row_count !== after.row_count
        || before.sha256 !== after.sha256;
    });
    const dbLogicalEqual = dbAfterQuery.logical_sha256 === dbBeforeQuery.logical_sha256
      && changedTables.length === 0;
    assert.equal(
      dbAfterQuery.logical_sha256,
      dbBeforeQuery.logical_sha256,
      "semantic_search mutated the SQLite logical state",
    );
    assert.deepEqual(tableNamesAfter, tableNamesBefore, "semantic_search changed the SQLite table list");
    for (const tableName of tableNamesBefore) {
      assert.equal(
        dbAfterQuery.tables[tableName].row_count,
        dbBeforeQuery.tables[tableName].row_count,
        `semantic_search changed the row count for SQLite table ${tableName}`,
      );
      assert.equal(
        dbAfterQuery.tables[tableName].sha256,
        dbBeforeQuery.tables[tableName].sha256,
        `semantic_search changed the logical digest for SQLite table ${tableName}`,
      );
    }
    assert.deepEqual(changedTables, [], "semantic_search changed one or more SQLite tables");

    const sawSemanticLoading = loadingSamples.some((sample) => sample.semantic_loading);
    await writeFile(
      path.join(evidenceRoot, "semantic-loading-samples.json"),
      `${JSON.stringify({
        query: QUERY,
        saw_loading_text: sawSemanticLoading,
        loading_text: "🧠 Searching your library...",
        samples: loadingSamples,
      }, null, 2)}\n`,
      "utf8",
    );
    assert.ok(sawSemanticLoading, "Expected to observe the real semantic loading state '🧠 Searching your library...'");

    const bodyTextAfterQuery = await $("body").getText();
    const emptyState = /No similar tracks found/i.test(bodyTextAfterQuery);
    assert.ok(!emptyState, "Semantic search returned no results (empty state) — query produced zero matches above the 0.3 cutoff");

    // Scrape the rendered results from the DOM (UI order = backend order, desc).
    const rows = (await browser.execute(() => {
      const reasonParas = Array.from(document.querySelectorAll("p"))
        .filter((p) => /^Semantic match\s+\d+%$/.test((p.textContent || "").trim()));
      const out: ResultRow[] = [];
      reasonParas.forEach((reason, index) => {
        const row = reason.closest("div.group") as HTMLElement | null;
        const titleEl = row?.querySelector("p.font-medium.truncate") as HTMLParagraphElement | null;
        const artistEl = row?.querySelector("p.text-sm.text-ytm-text-secondary.truncate") as HTMLParagraphElement | null;
        const scoreEl = row?.querySelector("span.text-sm.font-bold.text-ytm-accent") as HTMLSpanElement | null;
        const title = titleEl ? titleEl.textContent?.trim() ?? null : null;
        const artist = artistEl ? artistEl.textContent?.trim() ?? null : null;
        const percentText = scoreEl ? (scoreEl.textContent || "").trim() : null;
        const percent = percentText ? Number(percentText.replace("%", "")) : null;
        const matchReason = reason.textContent?.trim() ?? null;
        out.push({
          rank: index + 1,
          title,
          artist,
          percent: Number.isFinite(percent as number) ? (percent as number) : null,
          match_reason: matchReason,
          similarity: Number.isFinite(percent as number) ? (percent as number) / 100 : null,
        });
      });
      return out;
    })) as ResultRow[];

    // ---- Assertions (simultaneous PASS criteria) ----
    assert.ok(rows.length > 0, "Expected at least one rendered semantic result row");

    for (const row of rows) {
      assert.ok(row.title, `Result rank ${row.rank}: title missing`);
      assert.ok(row.artist, `Result rank ${row.rank}: artist missing`);
      assert.ok(row.match_reason, `Result rank ${row.rank}: match_reason missing`);
      assert.ok(row.percent !== null && Number.isFinite(row.percent), `Result rank ${row.rank}: percent not finite`);
      assert.ok(
        row.similarity !== null && Number.isFinite(row.similarity),
        `Result rank ${row.rank}: similarity not finite`,
      );
      assert.ok(
        (row.similarity as number) >= 0 && (row.similarity as number) <= 1,
        `Result rank ${row.rank}: similarity ${(row.similarity as number)} out of [0,1]`,
      );
      assert.match(row.match_reason as string, /^Semantic match\s+\d+%$/, `Result rank ${row.rank}: match_reason shape`);
    }

    // Descending order by similarity (non-increasing; the frontend trusts the
    // backend's ORDER BY similarity DESC).
    const orderDescending = rows.every(
      (row, index) =>
        index === 0
        || (rows[index - 1].similarity as number) >= (row.similarity as number),
    );
    assert.ok(orderDescending, "Semantic results are not ordered by descending similarity");

    assert.equal(
      rows[0]?.title,
      EXPECTED_TOP_MATCH,
      "Expected 'Calm Piano Sleep Meditation' to be the top semantic result",
    );

    const calmPiano = rows.find((row) => row.title === EXPECTED_TOP_MATCH);
    const calmPianoRank = rows.findIndex((row) => row.title === EXPECTED_TOP_MATCH) + 1;
    const aggressiveMetal = rows.find((row) => row.title === "Aggressive Metal Gym Workout");
    assert.ok(calmPiano, "'Calm Piano Sleep Meditation' must appear in the Top K results");
    if (aggressiveMetal) {
      assert.ok(
        (calmPiano as ResultRow).similarity! > (aggressiveMetal as ResultRow).similarity!,
        "'Aggressive Metal Gym Workout' must have a lower similarity than 'Calm Piano Sleep Meditation'",
      );
    }
    // If aggressiveMetal is absent, the criterion is satisfied by absence.

    const resultOrder = rows.map((row) => row.title);
    const similarityValues = rows.map((row) => row.similarity);
    const allScoresFinite = rows.every((row) => finiteOrNull(row.similarity) !== null);
    const allScoresInUnitInterval = rows.every(
      (row) => row.similarity !== null && row.similarity >= 0 && row.similarity <= 1,
    );

    const resultsPayload = {
      query: QUERY,
      flow: "Header input -> Enter (search_youtube preflight) -> Semantic button -> semantic_search Tauri command -> Ollama all-minilm query embedding -> cosine vs track_embeddings -> UI",
      result_count: rows.length,
      result_order: resultOrder,
      similarity_values: similarityValues,
      all_scores_finite: allScoresFinite,
      all_scores_in_unit_interval: allScoresInUnitInterval,
      order_descending: orderDescending,
      expected_top_match: EXPECTED_TOP_MATCH,
      actual_top_match: rows[0]?.title ?? null,
      top_match_pass: rows[0]?.title === EXPECTED_TOP_MATCH,
      calm_piano_rank: calmPianoRank,
      calm_piano_in_top_k: Boolean(calmPiano),
      aggressive_metal_present: Boolean(aggressiveMetal),
      aggressive_metal_absent_or_lower: !aggressiveMetal
        || ((calmPiano as ResultRow).similarity! > (aggressiveMetal as ResultRow).similarity!),
      db_logical_equal: dbLogicalEqual,
      changed_tables: changedTables,
      results: rows,
    };
    await writeFile(
      path.join(evidenceRoot, "semantic-query-results.json"),
      `${JSON.stringify(resultsPayload, null, 2)}\n`,
      "utf8",
    );

    await browser.saveScreenshot(path.join(evidenceRoot, "semantic-query-screenshot.png"));
    await writeFile(path.join(evidenceRoot, "semantic-query-dom.html"), await browser.getPageSource(), "utf8");

    // ------------------------------------------------------------------
    // Phase D: prove the query did not mutate the DB (read-only)
    // ------------------------------------------------------------------
    // Navigate back to Settings -> Semantic and re-read the "5 / 5 tracks
    // indexed" count from the DOM. It must still be 5 / 5 after the query.
    const settingsButtonAgain = await $("//button[.//span[normalize-space()='Settings']]");
    await settingsButtonAgain.waitForClickable({ timeout: 30_000 });
    await settingsButtonAgain.click();
    const semanticTabAgain = await $("//button[contains(normalize-space(.), 'Semantic')]");
    await semanticTabAgain.waitForClickable({ timeout: 30_000 });
    await semanticTabAgain.click();

    await browser.waitUntil(
      async () => {
        const text = await $("body").getText();
        return new RegExp(`${EXPECTED_TRACK_COUNT}\\s*/\\s*${EXPECTED_TRACK_COUNT}\\s+tracks indexed`, "i").test(text);
      },
      { timeout: 30_000, interval: 250, timeoutMsg: "Index status did not re-render after navigating back to Settings" },
    );
    // Re-query the model <select> fresh: the Phase A `modelSelect` reference is
    // stale because navigating through SearchView (Phase B/C) unmounted and
    // remounted SettingsView, so the <select> is a new DOM node whose cached
    // element id returns a null value property. Also parse the live "N / N
    // tracks indexed" count from the body text (rather than trusting a
    // hardcoded constant) so the read-only assertion is meaningful.
    const bodyTextAfterRequery = await $("body").getText();
    const countMatchAfterQuery = bodyTextAfterRequery.match(/(\d+)\s*\/\s*(\d+)\s+tracks indexed/i);
    const indexedAfterQuery = countMatchAfterQuery ? Number(countMatchAfterQuery[1]) : null;
    const totalAfterQuery = countMatchAfterQuery ? Number(countMatchAfterQuery[2]) : null;
    const modelSelectAfterQuery = await $("select");
    const modelUsedAfterQuery = await modelSelectAfterQuery.getValue();
    const dbAfterQueryUi = {
      source: "dom-ui",
      captured_via: "settings-semantic-tab-after-query",
      tracks: indexedAfterQuery,
      track_embeddings: indexedAfterQuery,
      total_tracks: totalAfterQuery,
      model_used: modelUsedAfterQuery,
      captured_at_utc: new Date().toISOString(),
    };
    await writeFile(
      path.join(evidenceRoot, "db-after-query-ui.json"),
      `${JSON.stringify(dbAfterQueryUi, null, 2)}\n`,
      "utf8",
    );
    assert.equal(
      indexedAfterQuery,
      EXPECTED_TRACK_COUNT,
      `Track index count changed after the query (expected ${EXPECTED_TRACK_COUNT}, got ${indexedAfterQuery}); query must be read-only`,
    );
    assert.equal(
      totalAfterQuery,
      EXPECTED_TRACK_COUNT,
      `Total track count changed after the query (expected ${EXPECTED_TRACK_COUNT}, got ${totalAfterQuery})`,
    );
    assert.equal(modelUsedAfterQuery, dbAfterIndex.model_used, "Embedding model changed after the query");
  });
});
