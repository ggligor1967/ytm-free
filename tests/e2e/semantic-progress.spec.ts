import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

interface ProgressSample {
  timestamp: number;
  percentage: number | null;
  indexed: number | null;
  total: number | null;
  currentTrack: string | null;
}

describe("semantic indexing progress", () => {
  it("observes real intermediate progress and the final 10 / 10 UI state", async () => {
    const evidenceRoot = process.env.EVIDENCE_ROOT;
    assert.ok(evidenceRoot, "EVIDENCE_ROOT must be set");
    await mkdir(evidenceRoot, { recursive: true });

    const root = await $("#root");
    await root.waitForDisplayed({ timeout: 30_000 });

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

    await browser.execute(() => {
      type HarnessWindow = Window & {
        __ytmSemanticProgressSamples?: ProgressSample[];
        __ytmSemanticProgressObserver?: MutationObserver;
      };

      const harnessWindow = window as HarnessWindow;
      harnessWindow.__ytmSemanticProgressObserver?.disconnect();
      harnessWindow.__ytmSemanticProgressSamples = [];

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
        const sample: ProgressSample = {
          timestamp: Date.now(),
          percentage: percentageMatch ? Number(percentageMatch[1]) : null,
          indexed: countMatch ? Number(countMatch[1]) : null,
          total: countMatch ? Number(countMatch[2]) : null,
          currentTrack,
        };
        const samples = harnessWindow.__ytmSemanticProgressSamples!;
        const previous = samples.at(-1);
        const signature = `${sample.percentage}|${sample.indexed}|${sample.total}|${sample.currentTrack}`;
        const previousSignature = previous
          ? `${previous.percentage}|${previous.indexed}|${previous.total}|${previous.currentTrack}`
          : null;

        if (signature !== previousSignature) {
          samples.push(sample);
        }
      };

      harnessWindow.__ytmSemanticProgressObserver = new MutationObserver(capture);
      harnessWindow.__ytmSemanticProgressObserver.observe(document.body, {
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
        return /10\s*\/\s*10\s+tracks indexed/i.test(text) && /Re-index All/i.test(text);
      },
      { timeout: 180_000, interval: 250, timeoutMsg: "Semantic indexing did not reach the final 10 / 10 UI state" },
    );

    const samples = await browser.execute(() => {
      type HarnessWindow = Window & {
        __ytmSemanticProgressSamples?: ProgressSample[];
        __ytmSemanticProgressObserver?: MutationObserver;
      };
      const harnessWindow = window as HarnessWindow;
      const captured = [...(harnessWindow.__ytmSemanticProgressSamples ?? [])];
      harnessWindow.__ytmSemanticProgressObserver?.disconnect();
      return captured;
    });

    const preFinalSamples = samples.filter(
      (sample) => sample.percentage !== 100 && !(sample.indexed === 10 && sample.total === 10),
    );
    const hasIntermediatePercentage = preFinalSamples.some(
      (sample) => sample.percentage !== null && sample.percentage >= 1 && sample.percentage <= 99,
    );
    const distinctCurrentTracks = new Set(
      preFinalSamples.map((sample) => sample.currentTrack).filter((track): track is string => Boolean(track)),
    );

    assert.ok(
      hasIntermediatePercentage || distinctCurrentTracks.size >= 2,
      "Expected an intermediate percentage or at least two distinct current-track values",
    );

    const bodyText = await $("body").getText();
    assert.match(bodyText, /10\s*\/\s*10\s+tracks indexed/i);

    await writeFile(
      path.join(evidenceRoot, "semantic-progress-samples.json"),
      `${JSON.stringify(samples, null, 2)}\n`,
      "utf8",
    );
    await writeFile(path.join(evidenceRoot, "semantic-progress-dom.html"), await browser.getPageSource(), "utf8");
  });
});
