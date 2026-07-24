import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PlaylistsView } from "../components/views/PlaylistsView";
import type { Playlist } from "../types";

const mockUseAppStore = vi.fn();
vi.mock("../store", () => ({
  useAppStore: (...args: unknown[]) => mockUseAppStore(...args),
}));

vi.mock("../api", () => ({
  createPlaylist: vi.fn(),
  getPlaylists: vi.fn(),
  deletePlaylist: vi.fn(),
  ollamaGeneratePlaylist: vi.fn(),
  createSemanticPlaylist: vi.fn(),
}));

vi.mock("../lib/toast", () => ({
  showToast: vi.fn(),
}));

vi.mock("lucide-react", () => ({
  Plus: () => <span>Plus</span>,
  ListMusic: () => <span>Playlist</span>,
  MoreVertical: () => <span>Menu</span>,
  Trash2: () => <span>Delete</span>,
  Loader2: () => <span>Loading</span>,
  Sparkles: () => <span>Sparkles</span>,
}));

describe("PlaylistsView selectors", () => {
  const playlist: Playlist = {
    id: "playlist-1",
    name: "Test Playlist",
    track_count: 2,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAppStore.mockReturnValue({
      playlists: [playlist],
      setPlaylists: vi.fn(),
      setView: vi.fn(),
      setSelectedPlaylistId: vi.fn(),
      settings: null,
      ollamaAvailable: false,
      aiPlaylistSuggestion: null,
      setAIPlaylistSuggestion: vi.fn(),
    });
  });

  it("exposes the contracted playlist, menu, and delete selectors", () => {
    render(<PlaylistsView />);

    expect(screen.getByTestId(`playlist-${playlist.name}`)).toBeTruthy();
    const menuButton = screen.getByTestId(`playlist-menu-${playlist.id}`);
    expect(menuButton).toBeTruthy();

    fireEvent.click(menuButton);

    expect(screen.getByTestId(`playlist-delete-${playlist.id}`)).toBeTruthy();
  });
});
