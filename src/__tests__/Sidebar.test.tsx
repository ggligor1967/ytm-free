import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "../components/Sidebar";
import { useAppStore } from "../store";

// Mock lucide-react icons to avoid SVG rendering issues in jsdom
vi.mock("lucide-react", () => ({
  Home: () => <div data-testid="icon-home" />,
  Search: () => <div data-testid="icon-search" />,
  Library: () => <div data-testid="icon-library" />,
  ListMusic: () => <div data-testid="icon-list-music" />,
  Download: () => <div data-testid="icon-download" />,
  Heart: () => <div data-testid="icon-heart" />,
  Settings: () => <div data-testid="icon-settings" />,
  Music2: () => <div data-testid="icon-music2" />,
  Upload: () => <div data-testid="icon-upload" />,
  Brain: () => <div data-testid="icon-brain" />,
  Sparkles: () => <div data-testid="icon-sparkles" />,
  Zap: () => <div data-testid="icon-zap" />,
  BarChart3: () => <div data-testid="icon-barchart3" />,
  Wrench: () => <div data-testid="icon-wrench" />,
  MessageCircle: () => <div data-testid="icon-message-circle" />,
}));

// Sample playlists for testing
const mockPlaylists = [
  { id: "pl-1", name: "Chill Vibes", track_count: 15, description: "", created_at: "", updated_at: "" },
  { id: "pl-2", name: "Workout Mix", track_count: 22, description: "", created_at: "", updated_at: "" },
  { id: "pl-3", name: "Late Night Jazz", track_count: 8, description: "", created_at: "", updated_at: "" },
];

describe("Sidebar", () => {
  beforeEach(() => {
    // Reset the store to default state before each test
    useAppStore.setState({
      view: "home",
      selectedPlaylistId: null,
      playlists: mockPlaylists,
      settings: null,
      ollamaAvailable: false,
      aiProcessing: false,
    });
  });

  it("renders all main navigation items", () => {
    render(<Sidebar ytdlpVersion="2024.1.1" />);

    expect(screen.getByText("Home")).toBeDefined();
    expect(screen.getByText("Search")).toBeDefined();
  });

  it("renders library navigation items", () => {
    render(<Sidebar ytdlpVersion="2024.1.1" />);

    expect(screen.getByText("Library")).toBeDefined();
    expect(screen.getAllByText("Playlists").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Favorites")).toBeDefined();
    expect(screen.getByText("Downloads")).toBeDefined();
    expect(screen.getByText("Settings")).toBeDefined();
  });

  it("renders all playlists from store", () => {
    render(<Sidebar ytdlpVersion="2024.1.1" />);

    expect(screen.getByText("Chill Vibes")).toBeDefined();
    expect(screen.getByText("Workout Mix")).toBeDefined();
    expect(screen.getByText("Late Night Jazz")).toBeDefined();
  });

  it("renders track count for each playlist", () => {
    render(<Sidebar ytdlpVersion="2024.1.1" />);

    expect(screen.getByText("15 tracks")).toBeDefined();
    expect(screen.getByText("22 tracks")).toBeDefined();
    expect(screen.getByText("8 tracks")).toBeDefined();
  });

  it("shows empty state when no playlists exist", () => {
    useAppStore.setState({ playlists: [] });
    render(<Sidebar ytdlpVersion="2024.1.1" />);

    expect(screen.getByText("No playlists yet")).toBeDefined();
  });

  it("shows yt-dlp version when provided", () => {
    render(<Sidebar ytdlpVersion="2024.1.1" />);

    expect(screen.getByText("yt-dlp 2024.1.1")).toBeDefined();
  });

  it("does not show yt-dlp version when null", () => {
    render(<Sidebar ytdlpVersion={null} />);

    expect(screen.queryByText(/yt-dlp/)).toBeNull();
  });

  it("highlights the active playlist when selectedPlaylistId matches", () => {
    // Set view to "playlist" and select a playlist
    useAppStore.setState({
      view: "playlist",
      selectedPlaylistId: "pl-2",
    });

    render(<Sidebar ytdlpVersion="2024.1.1" />);

    // The "Workout Mix" button should be the one that's highlighted
    const workoutButton = screen.getByText("Workout Mix").closest("button");
    expect(workoutButton?.className).toContain("bg-ytm-surface");
    expect(workoutButton?.className).toContain("text-white");

    // Other playlists should NOT have the highlight classes
    const chillButton = screen.getByText("Chill Vibes").closest("button");
    expect(chillButton?.className).not.toContain("text-white");

    const jazzButton = screen.getByText("Late Night Jazz").closest("button");
    expect(jazzButton?.className).not.toContain("text-white");
  });

  it("reactively updates highlighted playlist when selectedPlaylistId changes", () => {
    const { rerender } = render(<Sidebar ytdlpVersion="2024.1.1" />);

    // Initially no playlist should be highlighted (view is "home")
    const chillButton = screen.getByText("Chill Vibes").closest("button");
    expect(chillButton?.className).not.toContain("text-white");

    // Update store state to select a playlist
    useAppStore.setState({
      view: "playlist",
      selectedPlaylistId: "pl-1",
    });

    // Re-render to pick up the new state
    rerender(<Sidebar ytdlpVersion="2024.1.1" />);

    // Now "Chill Vibes" should be highlighted
    const updatedChillButton = screen.getByText("Chill Vibes").closest("button");
    expect(updatedChillButton?.className).toContain("bg-ytm-surface");
    expect(updatedChillButton?.className).toContain("text-white");
  });

  it("calls setSelectedPlaylistId and setView when a playlist is clicked", () => {
    // Spy on store actions
    const setSelectedPlaylistIdSpy = vi.spyOn(useAppStore.getState(), "setSelectedPlaylistId");
    const setViewSpy = vi.spyOn(useAppStore.getState(), "setView");

    render(<Sidebar ytdlpVersion="2024.1.1" />);

    // Click on "Late Night Jazz"
    fireEvent.click(screen.getByText("Late Night Jazz"));

    expect(setSelectedPlaylistIdSpy).toHaveBeenCalledWith("pl-3");
    expect(setViewSpy).toHaveBeenCalledWith("playlist");
  });

  it("does not render Brain icon when ollama is disabled", () => {
    useAppStore.setState({ settings: null });
    render(<Sidebar ytdlpVersion="2024.1.1" />);

    expect(screen.queryByTestId("icon-brain")).toBeNull();
  });

  it("renders AI connection indicator when ollama is enabled", () => {
    useAppStore.setState({
      settings: { ollama_enabled: true } as any,
      ollamaAvailable: true,
    });
    render(<Sidebar ytdlpVersion="2024.1.1" />);

    // When ollama is enabled and available, Brain icon shows
    expect(screen.getByTestId("icon-brain")).toBeDefined();
  });

  it("sets selectedPlaylistId to null when navigating away from playlist view", () => {
    // First set up a selected playlist
    useAppStore.setState({
      view: "playlist",
      selectedPlaylistId: "pl-1",
    });

    const setSelectedPlaylistIdSpy = vi.spyOn(useAppStore.getState(), "setSelectedPlaylistId");

    render(<Sidebar ytdlpVersion="2024.1.1" />);

    // Click on a non-playlist nav item (e.g., "Home")
    fireEvent.click(screen.getByText("Home"));

    expect(setSelectedPlaylistIdSpy).toHaveBeenCalledWith(null);
  });
});
