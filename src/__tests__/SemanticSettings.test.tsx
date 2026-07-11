import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SemanticSettings } from "../components/settings/SemanticSettings";
import * as api from "../api";
import { showToast } from "../components/Toast";
import type { SemanticIndexStatus, Settings } from "../types";

type SemanticProgressPayload = {
  indexed?: number;
  total?: number;
  current_track?: string;
  percentage?: number;
  estimated_time_remaining_seconds?: number;
};

type SemanticProgressHandler = (event: { payload: SemanticProgressPayload }) => void;

const { listenMock, unlistenMock } = vi.hoisted(() => ({
  listenMock: vi.fn(),
  unlistenMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

vi.mock("../api", () => ({
  getSemanticStatus: vi.fn(),
  semanticIndexAll: vi.fn(),
  semanticClearIndex: vi.fn(),
}));

vi.mock("../components/Toast", () => ({
  showToast: vi.fn(),
}));

function createSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    audio_quality: "high",
    download_path: "C:/Music",
    auto_download: false,
    theme: "dark",
    volume: 50,
    crossfade: false,
    crossfade_duration: 0,
    ollama_enabled: true,
    ollama_url: "http://127.0.0.1:11434",
    ollama_model: "llama3",
    smart_search_enabled: false,
    auto_tagging_enabled: false,
    smart_queue_enabled: false,
    daily_mix_enabled: false,
    search_results_count: 20,
    dj_mode_enabled: false,
    dj_style: "classic",
    dj_language: "en",
    dj_frequency: 1,
    dj_voice: "default",
    dj_pitch: 0,
    dj_rate: 1,
    dj_triggers_enabled: {
      track_start: false,
      track_end: false,
      queue_empty: false,
      long_session: false,
      first_track_of_day: false,
      milestone: false,
      time_announcement: false,
      mood_shift: false,
    },
    semantic_search_enabled: true,
    embedding_model: "all-minilm",
    tts_engine: "web_speech",
    ...overrides,
  };
}

function createSemanticStatus(overrides: Partial<SemanticIndexStatus> = {}): SemanticIndexStatus {
  return {
    total_tracks: 10,
    indexed_tracks: 2,
    model_used: "all-minilm",
    is_indexing: false,
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

describe("SemanticSettings semantic index progress listener", () => {
  let progressHandler: SemanticProgressHandler | null;

  beforeEach(() => {
    progressHandler = null;

    listenMock.mockReset();
    unlistenMock.mockReset();
    vi.clearAllMocks();

    vi.mocked(api.getSemanticStatus).mockResolvedValue(createSemanticStatus());
    vi.mocked(api.semanticIndexAll).mockResolvedValue(createSemanticStatus({ indexed_tracks: 10 }));
    listenMock.mockImplementation(async (eventName: string, handler: SemanticProgressHandler) => {
      if (eventName === "semantic-index-progress") {
        progressHandler = handler;
      }

      return unlistenMock;
    });
  });

  it("înregistrează listener-ul semantic-index-progress și pornește reindexarea la click", async () => {
    const indexing = createDeferred<SemanticIndexStatus>();
    vi.mocked(api.semanticIndexAll).mockReturnValue(indexing.promise);

    render(<SemanticSettings settings={createSettings()} onUpdate={vi.fn()} />);

    await waitFor(() => {
      expect(api.getSemanticStatus).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: /re-index all/i }));

    await waitFor(() => {
      expect(listenMock).toHaveBeenCalledWith("semantic-index-progress", expect.any(Function));
      expect(api.semanticIndexAll).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByRole("button", { name: /indexing 0%/i })).toBeDisabled();

    await act(async () => {
      indexing.resolve(createSemanticStatus({ indexed_tracks: 10, total_tracks: 10 }));
      await indexing.promise;
    });

    await waitFor(() => {
      expect(unlistenMock).toHaveBeenCalledTimes(1);
    });
  });

  it("actualizează UI-ul din payload-ul semantic-index-progress", async () => {
    const indexing = createDeferred<SemanticIndexStatus>();
    vi.mocked(api.semanticIndexAll).mockReturnValue(indexing.promise);

    render(<SemanticSettings settings={createSettings()} onUpdate={vi.fn()} />);

    await waitFor(() => {
      expect(api.getSemanticStatus).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: /re-index all/i }));

    await waitFor(() => {
      expect(progressHandler).not.toBeNull();
    });

    await act(async () => {
      progressHandler?.({
        payload: {
          indexed: 3,
          total: 10,
          current_track: "Track 3",
          percentage: 42,
          estimated_time_remaining_seconds: 18,
        },
      });
    });

    expect(screen.getByRole("button", { name: /indexing 42%/i })).toBeDisabled();
    expect(screen.getByText("3 / 10 tracks indexed")).toBeInTheDocument();
    expect(screen.getByText("Indexing: Track 3")).toBeInTheDocument();

    await act(async () => {
      indexing.resolve(createSemanticStatus({ indexed_tracks: 10, total_tracks: 10 }));
      await indexing.promise;
    });
  });

  it("curăță listener-ul, finalizează progresul și face refresh la succes", async () => {
    const indexing = createDeferred<SemanticIndexStatus>();
    vi.mocked(api.semanticIndexAll).mockReturnValue(indexing.promise);

    render(<SemanticSettings settings={createSettings()} onUpdate={vi.fn()} />);

    await waitFor(() => {
      expect(api.getSemanticStatus).toHaveBeenCalledTimes(1);
    });

    vi.mocked(api.getSemanticStatus).mockClear();
    vi.mocked(api.getSemanticStatus).mockResolvedValue(createSemanticStatus({ indexed_tracks: 10, total_tracks: 10 }));

    fireEvent.click(screen.getByRole("button", { name: /re-index all/i }));

    await waitFor(() => {
      expect(progressHandler).not.toBeNull();
    });

    await act(async () => {
      progressHandler?.({
        payload: {
          indexed: 7,
          total: 10,
          current_track: "Track 7",
          percentage: 70,
        },
      });
    });

    await act(async () => {
      indexing.resolve(createSemanticStatus({ indexed_tracks: 10, total_tracks: 10 }));
      await indexing.promise;
    });

    await waitFor(() => {
      expect(unlistenMock).toHaveBeenCalledTimes(1);
      expect(api.getSemanticStatus).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText("10 / 10 tracks indexed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /re-index all/i })).toBeEnabled();
    expect(showToast).toHaveBeenCalledWith("Library indexed successfully!");
  });

  it("curăță listener-ul și oprește indexing-ul când semanticIndexAll eșuează", async () => {
    vi.mocked(api.semanticIndexAll).mockRejectedValueOnce(new Error("boom"));

    render(<SemanticSettings settings={createSettings()} onUpdate={vi.fn()} />);

    await waitFor(() => {
      expect(api.getSemanticStatus).toHaveBeenCalledTimes(1);
    });

    vi.mocked(api.getSemanticStatus).mockClear();

    fireEvent.click(screen.getByRole("button", { name: /re-index all/i }));

    await waitFor(() => {
      expect(api.semanticIndexAll).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(unlistenMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByRole("button", { name: /re-index all/i })).toBeEnabled();
    expect(api.getSemanticStatus).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("Indexing failed: boom");
  });

  it("curăță listener-ul la unmount chiar dacă promise-ul listen se rezolvă târziu", async () => {
    const indexing = createDeferred<SemanticIndexStatus>();
    let resolveListen: ((value: () => void) => void) | null = null;

    vi.mocked(api.semanticIndexAll).mockReturnValue(indexing.promise);
    listenMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveListen = resolve;
    }));

    const view = render(<SemanticSettings settings={createSettings()} onUpdate={vi.fn()} />);

    await waitFor(() => {
      expect(api.getSemanticStatus).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: /re-index all/i }));

    await waitFor(() => {
      expect(listenMock).toHaveBeenCalledTimes(1);
    });

    view.unmount();

    expect(resolveListen).not.toBeNull();

    await act(async () => {
      resolveListen?.(unlistenMock);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(unlistenMock).toHaveBeenCalledTimes(1);
    });

    expect(api.semanticIndexAll).not.toHaveBeenCalled();
  });
});
