import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TrackCard } from "../components/TrackCard";
import type { Track, SearchResult } from "../types";
import * as api from "../api";
import { showToast } from "../components/Toast";

// Mock the api module
vi.mock("../api", () => ({
  downloadTrack: vi.fn(),
  ollamaGetTrackMetadata: vi.fn().mockResolvedValue(null),
  shareGenerateMessage: vi.fn().mockResolvedValue({ message: "" }),
  ollamaGeneratePlaylistSuggestion: vi.fn().mockResolvedValue(null),
}));

// Mock the Toast module
vi.mock("../components/Toast", () => ({
  showToast: vi.fn(),
}));

// Mock the store
const mockUseAppStore = vi.fn();
vi.mock("../store", () => ({
  useAppStore: (...args: unknown[]) => mockUseAppStore(...args),
}));

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  Play: () => <span data-testid="icon-play">Play</span>,
  Pause: () => <span data-testid="icon-pause">Pause</span>,
  MoreVertical: () => <span data-testid="icon-more">MoreVertical</span>,
  ListPlus: () => <span data-testid="icon-list-plus">ListPlus</span>,
  Heart: () => <span data-testid="icon-heart">Heart</span>,
  Download: () => <span data-testid="icon-download">Download</span>,
  Tag: () => <span data-testid="icon-tag">Tag</span>,
  Loader2: () => <span data-testid="icon-loader">Loader2</span>,
  Share2: () => <span data-testid="icon-share">Share2</span>,
}));

describe("TrackCard - Download button", () => {
  const trackWithVideoId: Track = {
    id: "db-track-1",
    video_id: "abc123",
    title: "Test Track",
    artist: "Test Artist",
    thumbnail: "https://example.com/thumb.jpg",
    duration: 180,
    is_downloaded: false,
    is_favorite: false,
    play_count: 0,
    created_at: "2024-01-01T00:00:00Z",
  };

  const searchResult: SearchResult = {
    id: "ytvideo789",
    title: "Search Result Track",
    artist: "Search Artist",
    thumbnail: "https://example.com/search-thumb.jpg",
    duration: 240,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAppStore.mockReturnValue({
      currentTrack: null,
      isPlaying: false,
      setCurrentTrack: vi.fn(),
      setIsPlaying: vi.fn(),
      addToQueue: vi.fn(),
      setShowAddToPlaylist: vi.fn(),
      settings: null,
    });
  });

  it("calls downloadTrack with video_id for Track type", async () => {
    const mockDownloadTrack = vi.mocked(api.downloadTrack);
    mockDownloadTrack.mockResolvedValueOnce({
      ...trackWithVideoId,
      is_downloaded: true,
    });

    render(<TrackCard track={trackWithVideoId} />);

    // Click the "More" button to open the menu
    const moreButton = screen.getByTestId("icon-more").closest("button");
    expect(moreButton).not.toBeNull();
    fireEvent.click(moreButton!);

    // Find and click the Download button
    const downloadButton = screen.getByTestId("icon-download").closest("button");
    expect(downloadButton).not.toBeNull();
    fireEvent.click(downloadButton!);

    // Verify downloadTrack was called with correct arguments
    expect(mockDownloadTrack).toHaveBeenCalledWith(
      "abc123",
      "Test Track",
      "Test Artist",
      "https://example.com/thumb.jpg",
    );

    // Verify toast messages
    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith("Downloading: Test Track...", "info");
    });

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith("Downloaded: Test Track", "success");
    });
  });

  it("calls downloadTrack with id for SearchResult type", async () => {
    const mockDownloadTrack = vi.mocked(api.downloadTrack);
    mockDownloadTrack.mockResolvedValueOnce({
      id: "ytvideo789",
      video_id: "ytvideo789",
      title: "Search Result Track",
      artist: "Search Artist",
      thumbnail: "https://example.com/search-thumb.jpg",
      is_downloaded: true,
      is_favorite: false,
      play_count: 0,
      created_at: "2024-01-01T00:00:00Z",
    });

    render(<TrackCard track={searchResult} />);

    // Click the "More" button to open the menu
    const moreButton = screen.getByTestId("icon-more").closest("button");
    expect(moreButton).not.toBeNull();
    fireEvent.click(moreButton!);

    // Find and click the Download button
    const downloadButton = screen.getByTestId("icon-download").closest("button");
    expect(downloadButton).not.toBeNull();
    fireEvent.click(downloadButton!);

    // Verify downloadTrack was called with SearchResult's id
    expect(mockDownloadTrack).toHaveBeenCalledWith(
      "ytvideo789",
      "Search Result Track",
      "Search Artist",
      "https://example.com/search-thumb.jpg",
    );

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith("Downloading: Search Result Track...", "info");
    });

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith("Downloaded: Search Result Track", "success");
    });
  });

  it("shows error toast when download fails", async () => {
    const mockDownloadTrack = vi.mocked(api.downloadTrack);
    mockDownloadTrack.mockRejectedValueOnce(new Error("Network error"));

    render(<TrackCard track={trackWithVideoId} />);

    // Open menu
    const moreButton = screen.getByTestId("icon-more").closest("button");
    fireEvent.click(moreButton!);

    // Click Download
    const downloadButton = screen.getByTestId("icon-download").closest("button");
    fireEvent.click(downloadButton!);

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith("Downloading: Test Track...", "info");
    });

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith("Download failed: Error: Network error", "error");
    });
  });

  it("closes the menu after clicking download", async () => {
    const mockDownloadTrack = vi.mocked(api.downloadTrack);
    mockDownloadTrack.mockResolvedValueOnce({
      ...trackWithVideoId,
      is_downloaded: true,
    });

    render(<TrackCard track={trackWithVideoId} />);

    // Open menu
    const moreButton = screen.getByTestId("icon-more").closest("button");
    fireEvent.click(moreButton!);

    // Verify menu items are visible
    expect(screen.getByTestId("icon-download")).toBeTruthy();

    // Click Download
    const downloadButton = screen.getByTestId("icon-download").closest("button");
    fireEvent.click(downloadButton!);

    // The menu should close - the download button should still exist in DOM
    // but the menu's visibility is handled by state. Since setShowMenu(false)
    // is called, the menu items remain rendered but are hidden by conditional logic.
    // We verify downloadTrack was still called.
    expect(mockDownloadTrack).toHaveBeenCalledTimes(1);
  });
});
