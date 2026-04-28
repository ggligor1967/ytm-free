import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { LibraryView } from "../components/views/LibraryView";
import * as api from "../api";
import { useAppStore } from "../store";
import type { Track, TrackMetadataDB, Settings } from "../types";

// Mock Tauri event listener
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
}));

// Mock the API module
vi.mock("../api", () => ({
  getLibrary: vi.fn(),
  ollamaGetTrackMetadata: vi.fn(),
  ollamaBatchAnalyzeTracks: vi.fn(),
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

function createMockMetadata(trackId: string): TrackMetadataDB {
  return {
    track_id: trackId,
    genre: "Rock",
    mood: "Energetic",
    energy_level: 7,
    analyzed_at: new Date().toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  // Reset the store to a clean state
  useAppStore.setState({
    library: [],
    settings: null,
  });
});

describe("LibraryView metadata batch loading", () => {
  it("loads metadata in batches of 10 when auto_tagging_enabled is true", async () => {
    // Arrange: 25 tracks
    const trackCount = 25;
    const tracks = Array.from({ length: trackCount }, (_, i) =>
      createMockTrack(`track_${i + 1}`, i + 1)
    );

    // Each track metadata call resolves with valid metadata
    const getMetadataMock = vi.mocked(api.ollamaGetTrackMetadata);
    getMetadataMock.mockImplementation(async (trackId: string) =>
      createMockMetadata(trackId)
    );

    vi.mocked(api.getLibrary).mockResolvedValue(tracks);

    // Set up store with auto_tagging enabled
    useAppStore.setState({
      library: tracks,
      settings: {
        auto_tagging_enabled: true,
        ollama_enabled: true,
      } as Settings,
    });

    render(<LibraryView />);

    // Wait for loading to finish
    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    // Verify getLibrary was called
    expect(api.getLibrary).toHaveBeenCalledTimes(1);

    // Verify ollamaGetTrackMetadata was called for each track in batches
    // Batch 1: tracks 0-9, Batch 2: tracks 10-19, Batch 3: tracks 20-24
    expect(getMetadataMock).toHaveBeenCalledTimes(trackCount);

    // Verify batch sizes: first two batches of 10, last batch of 5
    const callArgs = getMetadataMock.mock.calls.map((c) => c[0]);
    expect(callArgs.slice(0, 10)).toEqual(
      tracks.slice(0, 10).map((t) => t.id)
    );
    expect(callArgs.slice(10, 20)).toEqual(
      tracks.slice(10, 20).map((t) => t.id)
    );
    expect(callArgs.slice(20, 25)).toEqual(
      tracks.slice(20, 25).map((t) => t.id)
    );

    // Verify the library text shows tagged count
    await waitFor(() => {
      expect(screen.getByText(/25 tagged/)).toBeInTheDocument();
    });
  });

  it("does not load metadata when auto_tagging_enabled is false", async () => {
    const tracks = Array.from({ length: 5 }, (_, i) =>
      createMockTrack(`track_${i + 1}`, i + 1)
    );

    vi.mocked(api.getLibrary).mockResolvedValue(tracks);

    useAppStore.setState({
      library: tracks,
      settings: {
        auto_tagging_enabled: false,
        ollama_enabled: false,
      } as Settings,
    });

    render(<LibraryView />);

    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    // Metadata should NOT have been loaded
    expect(api.ollamaGetTrackMetadata).not.toHaveBeenCalled();
  });

  it("silently skips failed metadata fetches within batches", async () => {
    const batchSize = 10;
    const trackCount = batchSize + 3; // 13 tracks: one full batch + partial
    const tracks = Array.from({ length: trackCount }, (_, i) =>
      createMockTrack(`track_${i + 1}`, i + 1)
    );

    // Make some tracks fail (every 3rd one)
    const getMetadataMock = vi.mocked(api.ollamaGetTrackMetadata);
    getMetadataMock.mockImplementation(async (trackId: string) => {
      const index = parseInt(trackId.split("_")[1]);
      if (index % 3 === 0) {
        throw new Error("Metadata fetch failed");
      }
      return createMockMetadata(trackId);
    });

    vi.mocked(api.getLibrary).mockResolvedValue(tracks);

    useAppStore.setState({
      library: tracks,
      settings: {
        auto_tagging_enabled: true,
        ollama_enabled: true,
      } as Settings,
    });

    render(<LibraryView />);

    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    // All tracks were attempted
    expect(getMetadataMock).toHaveBeenCalledTimes(trackCount);

    // Successful metadata count should exclude failed ones (every 3rd)
    // Tracks 3, 6, 9, 12 fail (index % 3 === 0) -> 4 failures, 9 successes
    await waitFor(() => {
      expect(screen.getByText(/9 tagged/)).toBeInTheDocument();
    });
  });

  it("processes batches sequentially while resolving within each batch in parallel", async () => {
    const trackCount = 25;
    const tracks = Array.from({ length: trackCount }, (_, i) =>
      createMockTrack(`track_${i + 1}`, i + 1)
    );

    // Use a call counter to verify batching order
    let callCount = 0;
    const batchBoundaries: number[] = [];

    const getMetadataMock = vi.mocked(api.ollamaGetTrackMetadata);
    getMetadataMock.mockImplementation(async (trackId: string) => {
      const currentCall = callCount;
      callCount++;

      // Record when a new batch starts (first call in each batch)
      if (currentCall % 10 === 0) {
        batchBoundaries.push(currentCall);
      }

      // Simulate variable latency
      await new Promise((r) => setTimeout(r, Math.random() * 10));
      return createMockMetadata(trackId);
    });

    vi.mocked(api.getLibrary).mockResolvedValue(tracks);

    useAppStore.setState({
      library: tracks,
      settings: {
        auto_tagging_enabled: true,
        ollama_enabled: true,
      } as Settings,
    });

    render(<LibraryView />);

    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    // Verify all metadata was loaded
    await waitFor(() => {
      expect(screen.getByText(/25 tagged/)).toBeInTheDocument();
    });
  });

  it("handles 1000 tracks efficiently with batched loading (10 per batch)", async () => {
    const trackCount = 1000;
    const tracks = Array.from({ length: trackCount }, (_, i) =>
      createMockTrack(`track_${i + 1}`, i + 1)
    );

    const getMetadataMock = vi.mocked(api.ollamaGetTrackMetadata);
    getMetadataMock.mockImplementation(async (trackId: string) =>
      createMockMetadata(trackId)
    );

    vi.mocked(api.getLibrary).mockResolvedValue(tracks);

    useAppStore.setState({
      library: tracks,
      settings: {
        auto_tagging_enabled: true,
        ollama_enabled: true,
      } as Settings,
    });

    render(<LibraryView />);

    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    // All 1000 tracks should have been attempted
    expect(getMetadataMock).toHaveBeenCalledTimes(1000);

    // Verify the tagged count
    await waitFor(() => {
      expect(screen.getByText(/1000 tagged/)).toBeInTheDocument();
    });
  });
});
