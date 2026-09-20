import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

interface DownloadedTrack {
  id: string;
  video_id: string;
  title: string;
  artist: string;
  local_path?: string;
  is_downloaded: boolean;
}

const fixtures = [
  {
    kind: "clean",
    videoId: "2PuFyjAs7JA",
    title: "4K 2K 1080p 720p 480p video resolution test",
    artist: "Runtime Fixture",
  },
  {
    kind: "problematic",
    videoId: "taSchMy4dlE",
    title: "DDG, BJRNCK, DreamDoll - Familiar (Official Audio) | HIT-A-THON 2: ATL",
    artist: "Runtime Fixture",
  },
] as const;

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} must be set`);
  return value;
}

async function invokeIpc<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const outcome = await browser.executeAsync(
    (cmd: string, argObj: Record<string, unknown> | undefined, done: (result: unknown) => void) => {
      type Invoke = (name: string, values?: Record<string, unknown>) => Promise<unknown>;
      const internals = (window as Window & { __TAURI_INTERNALS__?: { invoke?: Invoke } }).__TAURI_INTERNALS__;
      if (typeof internals?.invoke !== "function") {
        done({ ok: false, error: "TAURI-IPC-UNAVAILABLE" });
        return;
      }
      internals.invoke(cmd, argObj)
        .then((value) => done({ ok: true, value }))
        .catch((error) => done({ ok: false, error: String(error) }));
    },
    command,
    args,
  ) as { ok: boolean; value?: T; error?: string };

  assert.equal(outcome.ok, true, outcome.error || `${command} failed`);
  return outcome.value as T;
}

async function describeFile(filePath: string) {
  const contents = await readFile(filePath);
  const metadata = await stat(filePath);
  return {
    path: filePath,
    filename: path.basename(filePath),
    size: metadata.size,
    sha256: createHash("sha256").update(contents).digest("hex").toUpperCase(),
  };
}

async function waitForApplication(): Promise<void> {
  await browser.waitUntil(
    async () => browser.execute(() => document.readyState === "complete" && Boolean(document.querySelector("#root"))),
    { timeout: 30_000, timeoutMsg: "Primary DOM did not become ready" },
  );
  await $("#root").waitForDisplayed({ timeout: 30_000 });
}

async function assertDownloadsUiContains(titles: readonly string[]): Promise<string> {
  const downloadsButton = await $("//button[normalize-space(.)='Downloads']");
  await downloadsButton.waitForClickable({ timeout: 20_000 });
  await downloadsButton.click();
  await $("//h1[normalize-space(.)='Downloads']").waitForDisplayed({ timeout: 20_000 });
  const bodyText = await $("body").getText();
  for (const title of titles) {
    assert.ok(bodyText.includes(title), `Downloads UI did not render ${title}`);
  }
  return bodyText;
}

describe("download final-path runtime contract", () => {
  it("uses the same existing file path across IPC, persistence, restart, UI, and cleanup", async () => {
    const phase = requireEnvironment("E1_RUNTIME_PHASE");
    const evidenceRoot = requireEnvironment("EVIDENCE_ROOT");
    const downloadDir = path.resolve(requireEnvironment("YTM_FREE_DOWNLOAD_DIR"));
    await mkdir(evidenceRoot, { recursive: true });
    await waitForApplication();

    if (phase === "create") {
      const returnedTracks: DownloadedTrack[] = [];
      for (const fixture of fixtures) {
        returnedTracks.push(await invokeIpc<DownloadedTrack>("download_track", {
          videoId: fixture.videoId,
          title: fixture.title,
          artist: fixture.artist,
          thumbnail: "",
        }));
      }

      const persistedTracks = await invokeIpc<DownloadedTrack[]>("get_downloads");
      const actualPaths = (await readdir(downloadDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mp3"))
        .map((entry) => path.join(downloadDir, entry.name))
        .sort();
      const uiText = await assertDownloadsUiContains(fixtures.map((fixture) => fixture.title));
      const evidence = {
        phase,
        returnedTracks,
        persistedTracks,
        actualFiles: await Promise.all(actualPaths.map(describeFile)),
        uiContains: fixtures.map((fixture) => ({
          videoId: fixture.videoId,
          title: fixture.title,
          rendered: uiText.includes(fixture.title),
        })),
      };
      await writeFile(path.join(evidenceRoot, "download-path-create.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

      for (const fixture of fixtures) {
        const returned = returnedTracks.find((track) => track.video_id === fixture.videoId);
        const persisted = persistedTracks.find((track) => track.video_id === fixture.videoId);
        assert.ok(returned?.is_downloaded, `${fixture.kind} IPC result was not marked downloaded`);
        assert.ok(persisted?.is_downloaded, `${fixture.kind} persisted result was not marked downloaded`);
        assert.equal(persisted.local_path, returned.local_path, `${fixture.kind} API and persisted paths differ`);
        assert.ok(returned.local_path, `${fixture.kind} IPC result has no local_path`);
        assert.ok(path.isAbsolute(returned.local_path), `${fixture.kind} local_path is not absolute`);
        assert.ok(existsSync(returned.local_path), `${fixture.kind} persisted path does not exist: ${returned.local_path}`);
        assert.ok(actualPaths.includes(returned.local_path), `${fixture.kind} persisted path is not an actual created file`);
      }
      return;
    }

    if (phase === "restart") {
      const persistedTracks = await invokeIpc<DownloadedTrack[]>("get_downloads");
      const uiText = await assertDownloadsUiContains(fixtures.map((fixture) => fixture.title));
      await writeFile(
        path.join(evidenceRoot, "download-path-restart.json"),
        `${JSON.stringify({ phase, persistedTracks, uiContainsAll: fixtures.every((fixture) => uiText.includes(fixture.title)) }, null, 2)}\n`,
        "utf8",
      );
      for (const fixture of fixtures) {
        const persisted = persistedTracks.find((track) => track.video_id === fixture.videoId);
        assert.ok(persisted?.is_downloaded, `${fixture.kind} state did not survive restart`);
        assert.ok(persisted.local_path && existsSync(persisted.local_path), `${fixture.kind} file was not found after restart`);
      }
      return;
    }

    if (phase === "cleanup") {
      const before = await invokeIpc<DownloadedTrack[]>("get_downloads");
      const problematic = before.find((track) => track.video_id === fixtures[1].videoId);
      const clean = before.find((track) => track.video_id === fixtures[0].videoId);
      assert.ok(problematic?.local_path && clean?.local_path, "Expected both persisted downloads before cleanup");
      await invokeIpc<void>("cleanup_delete_track", { trackId: problematic.id });
      const after = await invokeIpc<DownloadedTrack[]>("get_downloads");
      const evidence = {
        phase,
        removedTrackId: problematic.id,
        removedPersistedPath: problematic.local_path,
        removedFileStillExists: existsSync(problematic.local_path),
        siblingPersistedPath: clean.local_path,
        siblingFileStillExists: existsSync(clean.local_path),
        downloadedStateRemoved: !after.some((track) => track.id === problematic.id),
      };
      await writeFile(path.join(evidenceRoot, "download-path-cleanup.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
      assert.equal(evidence.downloadedStateRemoved, true, "Application cleanup did not remove downloaded state");
      assert.equal(evidence.removedFileStillExists, true, "Current cleanup contract unexpectedly removed the media file");
      assert.equal(evidence.siblingFileStillExists, true, "Cleanup removed the unrelated sibling file");
      return;
    }

    assert.fail(`Unsupported E1_RUNTIME_PHASE: ${phase}`);
  });
});
