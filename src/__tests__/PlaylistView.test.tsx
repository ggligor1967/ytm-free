import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlaylistView } from "../components/views/PlaylistView";
import type { Playlist, Track } from "../types";
import * as api from "../api";
import { showToast } from "../components/Toast";

vi.mock("../api", () => ({
  getPlaylistTracks: vi.fn(),
  getPlaylists: vi.fn(),
  removeFromPlaylist: vi.fn(),
  downloadTrack: vi.fn(),
  ollamaGetTrackMetadata: vi.fn().mockResolvedValue(null),
  shareGenerateMessage: vi.fn().mockResolvedValue({ message: "" }),
}));

vi.mock("../components/Toast", () => ({
  showToast: vi.fn(),
}));

const mockUseAppStore = vi.fn();
vi.mock("../store", () => ({
  useAppStore: (...args: unknown[]) => mockUseAppStore(...args),
}));

vi.mock("lucide-react", () => ({
  Play: () => <span data-testid="icon-play">Play</span>,
  Pause: () => <span data-testid="icon-pause">Pause</span>,
  Shuffle: () => <span>Shuffle</span>,
  ArrowLeft: () => <span>Back</span>,
  Loader2: () => <span>Loading</span>,
  ListMusic: () => <span>Playlist</span>,
  MoreVertical: () => <span data-testid="icon-more">More</span>,
  ListPlus: () => <span>Queue</span>,
  Heart: () => <span>Playlist</span>,
  Download: () => <span>Download</span>,
  Tag: () => <span>Tag</span>,
  Share2: () => <span>Share</span>,
  Trash2: () => <span>Remove</span>,
}));

describe("PlaylistView remove from playlist", () => {
  const track: Track = {
    id: "track-uuid-1",
    video_id: "video-1",
    title: "Playlist Track",
    artist: "Test Artist",
    thumbnail: "https://example.com/track.jpg",
    duration: 180,
    is_downloaded: false,
    is_favorite: false,
    play_count: 0,
    created_at: "2026-01-01T00:00:00Z",
  };

  const playlist: Playlist = {
    id: "playlist-1",
    name: "Test Playlist",
    track_count: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  const setPlaylists = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAppStore.mockReturnValue({
      selectedPlaylistId: playlist.id,
      playlists: [playlist],
      setPlaylists,
      setView: vi.fn(),
      setQueue: vi.fn(),
      setQueueIndex: vi.fn(),
      setCurrentTrack: vi.fn(),
      setIsPlaying: vi.fn(),
      toggleShuffle: vi.fn(),
      currentTrack: null,
      isPlaying: false,
      addToQueue: vi.fn(),
      setShowAddToPlaylist: vi.fn(),
      settings: null,
    });
  });

  it("removes by selected playlist and track id, then reloads tracks and playlists", async () => {
    const updatedPlaylists: Playlist[] = [{ ...playlist, track_count: 0 }];
    vi.mocked(api.getPlaylistTracks)
      .mockResolvedValueOnce([track])
      .mockResolvedValueOnce([]);
    vi.mocked(api.removeFromPlaylist).mockResolvedValueOnce(undefined);
    vi.mocked(api.getPlaylists).mockResolvedValueOnce(updatedPlaylists);

    render(<PlaylistView />);

    await screen.findByTestId(`playlist-track-${track.id}`);
    fireEvent.click(screen.getByTestId("icon-more").closest("button")!);
    fireEvent.click(screen.getByTestId("track-remove-from-playlist"));

    await waitFor(() => {
      expect(api.removeFromPlaylist).toHaveBeenCalledWith(playlist.id, track.id);
    });
    await waitFor(() => {
      expect(screen.queryByTestId(`playlist-track-${track.id}`)).toBeNull();
    });
    expect(api.getPlaylistTracks).toHaveBeenCalledTimes(2);
    expect(api.getPlaylistTracks).toHaveBeenLastCalledWith(playlist.id);
    expect(api.getPlaylists).toHaveBeenCalledTimes(1);
    expect(setPlaylists).toHaveBeenCalledWith(updatedPlaylists);
  });

  it("keeps the track and reports one error when removal fails", async () => {
    vi.mocked(api.getPlaylistTracks).mockResolvedValueOnce([track]);
    vi.mocked(api.removeFromPlaylist).mockRejectedValueOnce(new Error("remove failed"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<PlaylistView />);

    await screen.findByTestId(`playlist-track-${track.id}`);
    fireEvent.click(screen.getByTestId("icon-more").closest("button")!);
    fireEvent.click(screen.getByTestId("track-remove-from-playlist"));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(
        "Failed to remove track from playlist: remove failed",
        "error",
      );
    });
    expect(screen.getByTestId(`playlist-track-${track.id}`)).toBeTruthy();
    expect(api.getPlaylistTracks).toHaveBeenCalledTimes(1);
    expect(api.getPlaylists).not.toHaveBeenCalled();
    expect(setPlaylists).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledTimes(1);

    consoleError.mockRestore();
  });
});
