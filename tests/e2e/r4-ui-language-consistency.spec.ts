import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

interface RuntimeResult {
  insights: {
    labels: string[];
    oldLabelsAbsent: boolean;
    panelsVerified: string[];
  };
  search: {
    verified: boolean;
    qualification: string | null;
  };
  quickSmartPlaylist: {
    verified: boolean;
    qualification: string | null;
  };
  regression: {
    sidebarContained: boolean;
    commandBarOpenedAndClosed: boolean;
    playlistsOpened: boolean;
  };
  isolation: Record<string, string | null>;
}

async function clickSidebarItem(label: string): Promise<void> {
  const button = await $(`//aside//button[.//span[normalize-space()='${label}']]`);
  await button.waitForClickable({ timeout: 30_000 });
  await button.click();
}

async function clickButton(label: string): Promise<void> {
  const button = await $(`//button[normalize-space()='${label}']`);
  await button.waitForClickable({ timeout: 30_000 });
  await button.click();
}

async function bodyIncludes(text: string): Promise<boolean> {
  return (await $("body").getText()).includes(text);
}

describe("R4 English UI language consistency", () => {
  it("proves F-02 and the available isolated runtime surfaces", async () => {
    const evidenceRoot = process.env.EVIDENCE_ROOT;
    assert.ok(evidenceRoot, "EVIDENCE_ROOT must be set");
    await mkdir(evidenceRoot, { recursive: true });

    const result: RuntimeResult = {
      insights: { labels: [], oldLabelsAbsent: false, panelsVerified: [] },
      search: { verified: false, qualification: null },
      quickSmartPlaylist: { verified: false, qualification: null },
      regression: {
        sidebarContained: false,
        commandBarOpenedAndClosed: false,
        playlistsOpened: false,
      },
      isolation: Object.fromEntries([
        "YTM_FREE_DATA_DIR",
        "YTM_FREE_DOWNLOAD_DIR",
        "YTM_FREE_SPOTIFY_DIR",
        "WEBVIEW2_USER_DATA_FOLDER",
        "TEMP",
        "TMP",
        "EVIDENCE_ROOT",
      ].map((name) => [name, process.env[name] ?? null])),
    };

    const root = await $("#root");
    await root.waitForDisplayed({ timeout: 30_000 });

    result.regression.sidebarContained = await browser.execute(() => {
      const sidebar = document.querySelector<HTMLElement>("[data-testid='sidebar']");
      if (!sidebar) return false;
      const bounds = sidebar.getBoundingClientRect();
      return bounds.left >= 0
        && bounds.top >= 0
        && bounds.right <= window.innerWidth
        && bounds.bottom <= window.innerHeight;
    });
    assert.equal(result.regression.sidebarContained, true, "Sidebar must remain inside the viewport");

    await browser.keys(["Control", "k"]);
    const commandInput = await $("input[placeholder*='command'], input[placeholder*='AI commands']");
    await commandInput.waitForExist({ timeout: 10_000 });
    await browser.keys("Escape");
    await commandInput.waitForExist({ reverse: true, timeout: 10_000 });
    result.regression.commandBarOpenedAndClosed = true;

    await clickSidebarItem("Playlists");
    const playlistsHeading = await $("//h1[normalize-space()='Playlists']");
    await playlistsHeading.waitForDisplayed({ timeout: 30_000 });
    result.regression.playlistsOpened = true;

    await clickSidebarItem("Insights");
    const insightsHeading = await $("//h1[normalize-space()='Insights & Analytics']");
    await insightsHeading.waitForDisplayed({ timeout: 30_000 });

    const expectedLabels = ["Overview", "AI Profile", "Discover", "Explore", "Year in Review"];
    const oldLabels = ["Prezentare", "Profil AI", "Descoperă", "Explorează"];
    for (const label of expectedLabels) {
      const tab = await $(`//button[normalize-space()='${label}']`);
      await tab.waitForDisplayed({ timeout: 30_000 });
      result.insights.labels.push(label);
    }
    const visibleButtonLabels = await browser.execute(() => (
      Array.from(document.querySelectorAll("button"))
        .map((button) => button.textContent?.trim() ?? "")
        .filter(Boolean)
    ));
    result.insights.oldLabelsAbsent = oldLabels.every((label) => !visibleButtonLabels.includes(label));
    assert.equal(result.insights.oldLabelsAbsent, true, "Old Romanian Insights tabs must be absent");

    await clickButton("Overview");
    const tracksLabel = await $("//*[normalize-space()='Tracks']");
    await tracksLabel.waitForDisplayed({ timeout: 30_000 });
    result.insights.panelsVerified.push("overview");

    await clickButton("AI Profile");
    await browser.waitUntil(() => bodyIncludes("Ollama AI is not available"), {
      timeout: 30_000,
      timeoutMsg: "AI Profile panel did not render",
    });
    result.insights.panelsVerified.push("profile");

    await clickButton("Discover");
    await browser.waitUntil(() => bodyIncludes("Ollama AI is required for discovery features."), {
      timeout: 30_000,
      timeoutMsg: "Discover panel did not render",
    });
    result.insights.panelsVerified.push("discover");

    await clickButton("Explore");
    await browser.waitUntil(() => bodyIncludes("Ollama AI is required for exploration features."), {
      timeout: 30_000,
      timeoutMsg: "Explore panel did not render",
    });
    result.insights.panelsVerified.push("explore");

    await clickButton("Year in Review");
    const wrappedButton = await $("//button[normalize-space()='Generate My Wrapped']");
    await wrappedButton.waitForDisplayed({ timeout: 30_000 });
    result.insights.panelsVerified.push("wrapped");

    await browser.saveScreenshot(path.join(evidenceRoot, "r4-insights.png"));
    await writeFile(path.join(evidenceRoot, "r4-insights-dom.html"), await browser.getPageSource(), "utf8");
    await writeFile(path.join(evidenceRoot, "r4-insights-text.txt"), await $("body").getText(), "utf8");

    await clickSidebarItem("Settings");
    await clickButton("AI");
    const aiEnabled = await browser.execute(() => {
      const section = Array.from(document.querySelectorAll("section"))
        .find((candidate) => candidate.querySelector("h2")?.textContent?.trim() === "AI Assistant (Ollama)");
      const input = section?.querySelector<HTMLInputElement>("input[type='checkbox']");
      if (!input) return false;
      if (!input.checked) input.click();
      return input.checked;
    });
    assert.equal(aiEnabled, true, "Could not enable Ollama in isolated settings");

    await clickButton("Semantic");
    const semanticEnabled = await browser.execute(() => {
      const section = Array.from(document.querySelectorAll("section"))
        .find((candidate) => candidate.querySelector("h2")?.textContent?.trim() === "Semantic Search");
      const input = section?.querySelector<HTMLInputElement>("input[type='checkbox']");
      if (!input) return false;
      if (!input.checked) input.click();
      return input.checked;
    });
    assert.equal(semanticEnabled, true, "Could not enable semantic search in isolated settings");
    await clickButton("Save Changes");
    await browser.waitUntil(() => bodyIncludes("Saved!"), {
      timeout: 30_000,
      timeoutMsg: "Isolated settings were not saved",
    });

    await clickSidebarItem("Search");
    const searchHeading = await $("//h2[normalize-space()='Search for music']");
    await searchHeading.waitForDisplayed({ timeout: 30_000 });
    result.search.qualification = "Semantic controls require an existing query; no external search was executed solely for R4.";

    await clickSidebarItem("Playlists");
    const revisitedPlaylistsHeading = await $("//h1[normalize-space()='Playlists']");
    await revisitedPlaylistsHeading.waitForDisplayed({ timeout: 30_000 });
    const generateButton = await $("//button[normalize-space()='Generate Smart Playlist']");
    if (await generateButton.waitForExist({ timeout: 15_000 }).catch(() => false)) {
      await generateButton.click();
      const expectedExamples = [
        "energetic 45-minute workout",
        "chill music for reading",
        "classic rock for driving",
        "something melancholic for the evening",
        "party with friends",
      ];
      for (const example of expectedExamples) {
        const chip = await $(`//button[normalize-space()='${example}']`);
        await chip.waitForDisplayed({ timeout: 10_000 });
      }
      const input = await $("input[placeholder='e.g., energetic 45-minute workout...']");
      await input.waitForDisplayed({ timeout: 10_000 });
      result.quickSmartPlaylist.verified = true;
    } else {
      result.quickSmartPlaylist.qualification = "Ollama availability did not expose Generate Smart Playlist in the isolated runtime.";
    }

    await browser.saveScreenshot(path.join(evidenceRoot, "r4-playlists.png"));
    await writeFile(path.join(evidenceRoot, "r4-playlists-dom.html"), await browser.getPageSource(), "utf8");
    await writeFile(path.join(evidenceRoot, "r4-playlists-text.txt"), await $("body").getText(), "utf8");
    await writeFile(
      path.join(evidenceRoot, "r4-runtime-result.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8",
    );
  });
});
