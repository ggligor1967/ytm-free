import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SearchView } from "../components/views/SearchView";
import * as api from "../api";
import type { Settings, Track } from "../types";

const mockUseAppStore = vi.fn();

vi.mock("../store", () => ({
  useAppStore: (...args: unknown[]) => mockUseAppStore(...args),
}));

vi.mock("../api", () => ({
  semanticSearch: vi.fn(),
  semanticSearchFiltered: vi.fn(),
  ollamaEnhanceSearch: vi.fn(),
}));

vi.mock("../lib/toast", () => ({
  showToast: vi.fn(),
}));

vi.mock("../components/TrackCard", () => ({
  TrackCard: ({ track }: { track: Track }) => <div data-testid="track-card">{track.title}</div>,
}));

function createMockTrack(id: string, index: number): Track {
  return {
    id,
    video_id: `video_${index}`,
    title: `Track ${index}`,
    artist: `Artist ${index}`,
    thumbnail: `https://example.com/thumb_${index}.jpg`,
    duration: 180 + index,
    is_downloaded: false,
    is_favorite: false,
    play_count: 0,
    created_at: new Date().toISOString(),
  };
}

function createSemanticResult(id: string, index: number) {
  return {
    track: createMockTrack(id, index),
    similarity: 0.87,
    match_reason: "Semantic match 87%",
  };
}

function buildStore() {
  return {
    searchQuery: "focus coding mix",
    searchResults: [createMockTrack("track-1", 1)],
    isSearching: false,
    settings: {
      semantic_search_enabled: true,
      ollama_enabled: false,
      smart_search_enabled: false,
      search_results_count: 20,
    } as Settings,
    ollamaAvailable: false,
    aiSearchResults: [],
    setAISearchResults: vi.fn(),
    isAISearching: false,
    setIsAISearching: vi.fn(),
    setQueue: vi.fn(),
    setQueueIndex: vi.fn(),
    setCurrentTrack: vi.fn(),
    setIsPlaying: vi.fn(),
    setSearchQuery: vi.fn(),
    setSearchResults: vi.fn(),
    setIsSearching: vi.fn(),
  };
}

function createStoreOverrides(overrides: Partial<ReturnType<typeof buildStore>> = {}) {
  return {
    ...buildStore(),
    ...overrides,
  };
}

describe("SearchView semantic filtered consumer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Build the store object once per test and return the SAME reference on
    // every render, matching real Zustand's stable-action-identity guarantee.
    // (mockImplementation(() => createStoreOverrides()) would rebuild fresh
    // vi.fn() setters on every render, which masks any bug that depends on
    // setter/callback identity being stable across renders.)
    const store = createStoreOverrides();
    mockUseAppStore.mockImplementation(() => store);
    vi.mocked(api.semanticSearch).mockResolvedValue([createSemanticResult("semantic-track-1", 1)]);
    vi.mocked(api.semanticSearchFiltered).mockResolvedValue([createSemanticResult("semantic-track-2", 2)]);
    vi.mocked(api.ollamaEnhanceSearch).mockResolvedValue([]);
  });

  it("fără filtre active apelează semanticSearch", async () => {
    render(<SearchView />);

    fireEvent.click(screen.getByRole("button", { name: /semantic/i }));

    await waitFor(() => {
      expect(api.semanticSearch).toHaveBeenCalledWith("focus coding mix", 20);
    });
    expect(api.semanticSearchFiltered).not.toHaveBeenCalled();
  });

  it("cu filtre active apelează semanticSearchFiltered", async () => {
    render(<SearchView />);

    fireEvent.click(screen.getByRole("button", { name: /semantic/i }));

    await waitFor(() => {
      expect(api.semanticSearch).toHaveBeenCalledTimes(1);
    });

    vi.mocked(api.semanticSearch).mockClear();
    vi.mocked(api.semanticSearchFiltered).mockClear();

    fireEvent.change(screen.getByLabelText("Semantic genres filter"), {
      target: { value: "rock" },
    });

    fireEvent.click(screen.getByRole("button", { name: /apply filters/i }));

    await waitFor(() => {
      expect(api.semanticSearchFiltered).toHaveBeenCalledWith(
        "focus coding mix",
        20,
        ["rock"],
        undefined,
        undefined
      );
    });
    expect(api.semanticSearch).not.toHaveBeenCalled();
  });

  it("filtre goale sau whitespace nu activează semanticSearchFiltered", async () => {
    render(<SearchView />);

    fireEvent.click(screen.getByRole("button", { name: /semantic/i }));

    await waitFor(() => {
      expect(api.semanticSearch).toHaveBeenCalledTimes(1);
    });

    vi.mocked(api.semanticSearch).mockClear();
    vi.mocked(api.semanticSearchFiltered).mockClear();

    fireEvent.change(screen.getByLabelText("Semantic genres filter"), {
      target: { value: "  ,   , " },
    });
    fireEvent.change(screen.getByLabelText("Semantic moods filter"), {
      target: { value: "   " },
    });

    fireEvent.click(screen.getByRole("button", { name: /apply filters/i }));

    await waitFor(() => {
      expect(api.semanticSearch).toHaveBeenCalledWith("focus coding mix", 20);
    });
    expect(api.semanticSearchFiltered).not.toHaveBeenCalled();
  });

  it("trimite payload-ul corect pentru genres, moods și activities", async () => {
    render(<SearchView />);

    fireEvent.click(screen.getByRole("button", { name: /semantic/i }));

    await waitFor(() => {
      expect(api.semanticSearch).toHaveBeenCalledTimes(1);
    });

    vi.mocked(api.semanticSearch).mockClear();
    vi.mocked(api.semanticSearchFiltered).mockClear();

    fireEvent.change(screen.getByLabelText("Semantic genres filter"), {
      target: { value: "rock, synthwave" },
    });
    fireEvent.change(screen.getByLabelText("Semantic moods filter"), {
      target: { value: "focus, calm" },
    });
    fireEvent.change(screen.getByLabelText("Semantic activities filter"), {
      target: { value: "coding, driving" },
    });

    fireEvent.click(screen.getByRole("button", { name: /apply filters/i }));

    await waitFor(() => {
      expect(api.semanticSearchFiltered).toHaveBeenCalledWith(
        "focus coding mix",
        20,
        ["rock", "synthwave"],
        ["focus", "calm"],
        ["coding", "driving"]
      );
    });
  });

  it("apelează semanticSearchFiltered o singură dată la apply filters (F007 regresie)", async () => {
    render(<SearchView />);

    fireEvent.click(screen.getByRole("button", { name: /semantic/i }));

    await waitFor(() => {
      expect(api.semanticSearch).toHaveBeenCalledTimes(1);
    });

    vi.mocked(api.semanticSearch).mockClear();
    vi.mocked(api.semanticSearchFiltered).mockClear();

    fireEvent.change(screen.getByLabelText("Semantic genres filter"), {
      target: { value: "rock" },
    });

    fireEvent.click(screen.getByRole("button", { name: /apply filters/i }));

    await waitFor(() => {
      expect(api.semanticSearchFiltered).toHaveBeenCalled();
    });

    // Regression guard: a naive exhaustive-deps fix that adds an unmemoized
    // performSemanticSearch (and appliedSemanticFilters directly) to the
    // effect's dependency array causes a second, concurrent search — one
    // fire-and-forget from the effect, one awaited from the Apply handler.
    expect(api.semanticSearchFiltered).toHaveBeenCalledTimes(1);
    expect(api.semanticSearch).not.toHaveBeenCalled();
  });
});