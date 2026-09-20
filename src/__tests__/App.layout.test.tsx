import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { useAppStore } from "../store";

vi.mock("../api", () => ({
  checkYtdlp: vi.fn().mockResolvedValue("test-version"),
  cleanupTtsFiles: vi.fn().mockResolvedValue(undefined),
  getPlaylists: vi.fn().mockResolvedValue([]),
  getRecentlyPlayed: vi.fn().mockResolvedValue([]),
  getFavorites: vi.fn().mockResolvedValue([]),
  getDownloads: vi.fn().mockResolvedValue([]),
  getSettings: vi.fn().mockResolvedValue({ ollama_enabled: false, daily_mix_enabled: false }),
}));

vi.mock("../components/Sidebar", () => ({
  Sidebar: () => <aside>Sidebar</aside>,
}));
vi.mock("../components/Header", () => ({
  Header: () => <header>Header</header>,
}));
vi.mock("../components/Player", () => ({
  Player: () => <div>Player</div>,
}));
vi.mock("../components/VideoPlayer", () => ({
  VideoPlayer: () => null,
}));
vi.mock("../components/AddToPlaylistModal", () => ({
  AddToPlaylistModal: () => null,
}));
vi.mock("../components/CommandBar", () => ({
  CommandBar: () => null,
}));
vi.mock("../components/Toast", () => ({
  ToastContainer: () => null,
}));

vi.mock("../components/views/HomeView", () => ({ HomeView: () => <div>Home view</div> }));
vi.mock("../components/views/SearchView", () => ({ SearchView: () => <div>Search view</div> }));
vi.mock("../components/views/LibraryView", () => ({ LibraryView: () => <div>Library view</div> }));
vi.mock("../components/views/PlaylistsView", () => ({ PlaylistsView: () => <div>Playlists view</div> }));
vi.mock("../components/views/PlaylistView", () => ({ PlaylistView: () => <div>Playlist view</div> }));
vi.mock("../components/views/DownloadsView", () => ({ DownloadsView: () => <div>Downloads view</div> }));
vi.mock("../components/views/FavoritesView", () => ({ FavoritesView: () => <div>Favorites view</div> }));
vi.mock("../components/views/SettingsView", () => ({ SettingsView: () => <div>Settings view</div> }));
vi.mock("../components/views/ImportView", () => ({ ImportView: () => <div>Import view</div> }));
vi.mock("../components/views/SmartPlaylistView", () => ({ SmartPlaylistView: () => <div>Smart Playlist view</div> }));
vi.mock("../components/views/SmartQueueView", () => ({ SmartQueueView: () => <div>Smart Queue view</div> }));
vi.mock("../components/views/InsightsView", () => ({ InsightsView: () => <div>Insights view</div> }));
vi.mock("../components/views/LibraryCleanupView", () => ({ LibraryCleanupView: () => <div>Library Cleanup view</div> }));
vi.mock("../components/views/AIChatView", () => ({ AIChatView: () => <div>AI Chat view</div> }));

describe("App content scroll ownership", () => {
  beforeEach(() => {
    useAppStore.setState({
      view: "home",
      settings: null,
      playlists: [],
      recentlyPlayed: [],
      favorites: [],
      downloads: [],
      selectedPlaylistId: null,
    });
  });

  it("resets the persistent main scroll container for each different top-level view", async () => {
    render(<App />);
    await screen.findByText("Home view");

    const main = document.querySelector("main");
    expect(main).not.toBeNull();

    main!.scrollTop = 180;
    act(() => useAppStore.getState().setView("insights"));
    await screen.findByText("Insights view");
    await waitFor(() => expect(main!.scrollTop).toBe(0));

    main!.scrollTop = 240;
    act(() => useAppStore.getState().setView("home"));
    await screen.findByText("Home view");
    await waitFor(() => expect(main!.scrollTop).toBe(0));
  });

  it("does not reset main scroll for a same-view store update", async () => {
    render(<App />);
    await screen.findByText("Home view");

    const main = document.querySelector("main");
    expect(main).not.toBeNull();
    main!.scrollTop = 160;

    act(() => useAppStore.getState().setSearchQuery("same-view update"));

    await waitFor(() => expect(screen.getByText("Home view")).toBeDefined());
    expect(main!.scrollTop).toBe(160);
  });
});
