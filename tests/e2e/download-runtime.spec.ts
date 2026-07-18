import assert from "node:assert/strict";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const VIDEO_ID = "jNQXAC9IVRw";
type Phase = "create" | "restart";

interface DownloadedTrack {
  id: string;
  video_id: string;
  title: string;
  artist: string;
  local_path?: string;
}

interface RuntimeProbe { runtime_process_id: number }
interface CreateState {
  phase: "create";
  process_id: number;
  downloads_count: number;
  track: Pick<DownloadedTrack, "id" | "video_id" | "title" | "artist">;
  relative_path: string;
  downloaded_relative_path: string;
  downloaded_size: number;
  ui_search: boolean;
  ui_download_trigger: boolean;
  downloads_view_visible: boolean;
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} must be set`);
  return value;
}

function phase(): Phase {
  const value = requireEnvironment("DOWNLOAD_RUNTIME_PHASE");
  assert.ok(value === "create" || value === "restart", `Unsupported DOWNLOAD_RUNTIME_PHASE: ${value}`);
  return value;
}

async function writeJson(root: string, name: string, value: unknown): Promise<void> {
  await writeFile(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function invokeIpc<T>(command: string): Promise<T> {
  const outcome = await browser.executeAsync(
    (cmd: string, done: (result: unknown) => void) => {
      type Invoke = (name: string, args?: Record<string, unknown>) => Promise<unknown>;
      const invoke = (window as Window & { __TAURI_INTERNALS__?: { invoke?: Invoke } }).__TAURI_INTERNALS__?.invoke;
      if (typeof invoke !== "function") return done({ ok: false, error: "FAIL — TAURI-IPC-UNAVAILABLE" });
      invoke(cmd).then((value) => done({ ok: true, value })).catch((error) => done({ ok: false, error: String(error) }));
    },
    command,
  ) as { ok: boolean; value?: T; error?: string };
  assert.equal(outcome.ok, true, outcome.error || `IPC ${command} failed`);
  assert.ok(outcome.value !== undefined, `IPC ${command} returned no value`);
  return outcome.value as T;
}

function relativeDownloadPath(root: string, candidate: string): string {
  assert.ok(path.isAbsolute(candidate), "Downloaded local_path is not absolute");
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "Downloaded file escaped YTM_FREE_DOWNLOAD_DIR");
  return relative;
}

async function mp3Files(root: string, current = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const candidate = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await mp3Files(root, candidate));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".mp3")) files.push(path.relative(root, candidate));
  }
  return files.sort();
}

async function navigate(label: "Search" | "Downloads"): Promise<void> {
  const button = await $(`//aside//button[.//span[normalize-space(.)='${label}']]`);
  await button.waitForClickable({ timeout: 30_000 });
  await button.click();
}

function sanitizedDom(source: string): string {
  const replacements = [
    [process.cwd(), "%REPO%"],
    [process.env.EVIDENCE_ROOT || "", "%EVIDENCE_ROOT%"],
    [process.env.YTM_FREE_DOWNLOAD_DIR || "", "%DOWNLOAD_ROOT%"],
    [process.env.YTM_FREE_DATA_DIR || "", "%DATA_DIR%"],
    [process.env.USERPROFILE || "", "%USERPROFILE%"],
    [process.env.USERNAME || "", "%USERNAME%"],
  ].filter(([value]) => value);
  return replacements.reduce((text, [value, alias]) => text.split(value).join(alias), source);
}

describe("download runtime", () => {
  it("proves visible UI download isolation and restart persistence", async () => {
    const currentPhase = phase();
    const evidenceRoot = requireEnvironment("EVIDENCE_ROOT");
    const downloadRoot = path.resolve(requireEnvironment("YTM_FREE_DOWNLOAD_DIR"));
    requireEnvironment("YTM_FREE_DATA_DIR");
    await mkdir(evidenceRoot, { recursive: true });
    const root = await $("#root");
    await root.waitForDisplayed({ timeout: 30_000 });
    const probe = await invokeIpc<RuntimeProbe>("get_semantic_status");
    assert.ok(probe.runtime_process_id > 0);

    if (currentPhase === "create") {
      await navigate("Search");
      const input = await $("//header//input[contains(@placeholder,'Search for songs')]");
      await input.waitForDisplayed({ timeout: 30_000 });
      await input.setValue(VIDEO_ID);
      const searchButton = await $("//header//button[normalize-space(.)='Search']");
      await searchButton.waitForClickable({ timeout: 30_000 });
      await searchButton.click();
      const result = await $(`//img[contains(@src,'${VIDEO_ID}')]/ancestor::div[contains(concat(' ',normalize-space(@class),' '),' group ')][1]`);
      await result.waitForDisplayed({ timeout: 120_000 });
      assert.ok((await result.getText()).trim(), `Search result ${VIDEO_ID} has no visible title`);

      await browser.execute(() => {
        type State = { downloading: boolean; success: boolean; error: string | null; observer?: MutationObserver };
        const target = window as Window & { __downloadRuntimeToast?: State };
        target.__downloadRuntimeToast?.observer?.disconnect();
        const state: State = { downloading: false, success: false, error: null };
        const capture = () => {
          const text = document.body.innerText;
          state.downloading ||= /Downloading:/i.test(text);
          state.success ||= /Downloaded:/i.test(text);
          const failure = text.match(/Download failed:[^\n]*/i);
          if (failure) state.error = failure[0];
        };
        state.observer = new MutationObserver(capture);
        state.observer.observe(document.body, { subtree: true, childList: true, characterData: true });
        target.__downloadRuntimeToast = state;
        capture();
      });
      await result.moveTo();
      const resultButtons = await result.$$("button");
      const buttonCount = await resultButtons.length;
      assert.ok(buttonCount > 0, "Selected TrackCard has no menu button");
      await resultButtons[buttonCount - 1].click();
      const downloadButton = await $("//button[normalize-space(.)='Download']");
      await downloadButton.waitForClickable({ timeout: 30_000 });
      await downloadButton.click();
      await browser.waitUntil(async () => {
        const toast = await browser.execute(() => {
          const target = window as Window & { __downloadRuntimeToast?: { downloading: boolean; success: boolean; error: string | null } };
          const state = target.__downloadRuntimeToast;
          return state
            ? { downloading: state.downloading, success: state.success, error: state.error }
            : { downloading: false, success: false, error: null };
        });
        if (toast.error) throw new Error(toast.error);
        return toast.success;
      }, { timeout: 180_000, interval: 250, timeoutMsg: "Visible download success toast was not observed" });
      const toast = await browser.execute(() => {
        const target = window as Window & { __downloadRuntimeToast?: { downloading: boolean; success: boolean; error: string | null; observer?: MutationObserver } };
        target.__downloadRuntimeToast?.observer?.disconnect();
        const state = target.__downloadRuntimeToast;
        return state ? { downloading: state.downloading, success: state.success, error: state.error } : null;
      });
      assert.ok(toast?.downloading, "Visible downloading toast was not observed");

      const downloads = await invokeIpc<DownloadedTrack[]>("get_downloads");
      assert.equal(downloads.length, 1, "Expected exactly one downloaded track");
      const track = downloads[0];
      assert.equal(track.video_id, VIDEO_ID);
      assert.ok(track.local_path, "get_downloads returned no local_path");
      const relative = relativeDownloadPath(downloadRoot, track.local_path);
      const metadata = await stat(path.join(downloadRoot, relative));
      assert.ok(metadata.isFile() && metadata.size > 0);
      assert.deepEqual(await mp3Files(downloadRoot), [relative]);
      await navigate("Downloads");
      await browser.waitUntil(async () => {
        const text = await $("body").getText();
        return text.includes(track.title) && /1 tracks downloaded/i.test(text);
      }, { timeout: 30_000, interval: 250, timeoutMsg: "Downloads UI did not show the downloaded track and count" });
      const state: CreateState = {
        phase: "create", process_id: probe.runtime_process_id, downloads_count: downloads.length,
        track: { id: track.id, video_id: track.video_id, title: track.title, artist: track.artist },
        relative_path: relative, downloaded_relative_path: `%DOWNLOAD_ROOT%\\${relative}`,
        downloaded_size: metadata.size, ui_search: true, ui_download_trigger: true, downloads_view_visible: true,
      };
      await writeJson(evidenceRoot, "create-state.json", state);
      await browser.saveScreenshot(path.join(evidenceRoot, "create-screenshot.png"));
      await writeFile(path.join(evidenceRoot, "create-dom.html"), sanitizedDom(await browser.getPageSource()), "utf8");
    } else {
      const create = JSON.parse(await readFile(path.join(evidenceRoot, "create-state.json"), "utf8")) as CreateState;
      assert.notEqual(probe.runtime_process_id, create.process_id, "Restart reused the create process");
      const downloads = await invokeIpc<DownloadedTrack[]>("get_downloads");
      assert.equal(downloads.length, 1);
      const track = downloads[0];
      assert.deepEqual({ id: track.id, video_id: track.video_id, title: track.title, artist: track.artist }, create.track);
      assert.ok(track.local_path);
      const relative = relativeDownloadPath(downloadRoot, track.local_path);
      assert.equal(relative, create.relative_path);
      const metadata = await stat(path.join(downloadRoot, relative));
      assert.equal(metadata.size, create.downloaded_size);
      assert.deepEqual(await mp3Files(downloadRoot), [relative]);
      await navigate("Downloads");
      await browser.waitUntil(async () => {
        const text = await $("body").getText();
        return text.includes(track.title) && /1 tracks downloaded/i.test(text);
      }, { timeout: 30_000, interval: 250, timeoutMsg: "Restart Downloads UI did not show the persisted track" });
      await writeJson(evidenceRoot, "restart-state.json", {
        phase: "restart", process_id: probe.runtime_process_id, create_process_id: create.process_id,
        distinct_process: true, downloads_count: downloads.length, track: create.track,
        relative_path: relative, downloaded_relative_path: `%DOWNLOAD_ROOT%\\${relative}`,
        downloaded_size: metadata.size, downloads_view_visible: true,
      });
      await browser.saveScreenshot(path.join(evidenceRoot, "restart-screenshot.png"));
      await writeFile(path.join(evidenceRoot, "restart-dom.html"), sanitizedDom(await browser.getPageSource()), "utf8");
    }
  });
});
