import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ImportView } from "../components/views/ImportView";
import type { CsvFileInfo, ImportResult, SpotifyTrack } from "../types";
import * as api from "../api";

vi.mock("../api", () => ({
  getDefaultSpotifyFolder: vi.fn(),
  scanSpotifyFolder: vi.fn(),
  readCsvFile: vi.fn(),
  parseSpotifyCsv: vi.fn(),
  searchTrackOnYoutube: vi.fn(),
  smartSearchTrackWithFallback: vi.fn(),
  ollamaSuggestSimilarTracks: vi.fn(),
  createPlaylist: vi.fn(),
  addTrackToPlaylist: vi.fn(),
}));

const mockUseAppStore = vi.fn();
vi.mock("../store", () => ({
  useAppStore: (...args: unknown[]) => mockUseAppStore(...args),
}));

vi.mock("lucide-react", () => ({
  Loader2: () => <span>Loader2</span>,
  CheckCircle: () => <span>CheckCircle</span>,
  XCircle: () => <span>XCircle</span>,
  AlertCircle: () => <span>AlertCircle</span>,
  Music: () => <span>Music</span>,
  Plus: () => <span>Plus</span>,
  RefreshCw: () => <span>RefreshCw</span>,
  FolderOpen: () => <span>FolderOpen</span>,
  FileSpreadsheet: () => <span>FileSpreadsheet</span>,
  ExternalLink: () => <span>ExternalLink</span>,
  Brain: () => <span>Brain</span>,
  Sparkles: () => <span>Sparkles</span>,
  ArrowRight: () => <span>ArrowRight</span>,
  Search: () => <span>Search</span>,
  Shield: () => <span>Shield</span>,
  Zap: () => <span>Zap</span>,
}));

describe("ImportView selectors", () => {
  const file: CsvFileInfo = {
    name: "Test.csv",
    path: "C:/synthetic/Test.csv",
    track_count: 1,
  };

  const spotifyTrack: SpotifyTrack = {
    track_name: "Test Track",
    artist_name: "Test Artist",
    album_name: "Test Album",
  };

  const importResult: ImportResult = {
    spotify_track: spotifyTrack,
    youtube_id: "video-1",
    youtube_title: "Test Track - Test Artist",
    status: "Found",
    alternatives: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    const storeState = {
      playlists: [],
      addPlaylist: vi.fn(),
      setView: vi.fn(),
      setSelectedPlaylistId: vi.fn(),
      ollamaAvailable: false,
    };
    mockUseAppStore.mockImplementation((selector?: (state: typeof storeState) => unknown) =>
      selector ? selector(storeState) : storeState,
    );
    vi.mocked(api.getDefaultSpotifyFolder).mockResolvedValue("C:/synthetic/Spotify");
    vi.mocked(api.scanSpotifyFolder).mockResolvedValue([file]);
    vi.mocked(api.readCsvFile).mockResolvedValue("csv-content");
    vi.mocked(api.parseSpotifyCsv).mockResolvedValue([spotifyTrack]);
    vi.mocked(api.searchTrackOnYoutube).mockResolvedValue(importResult);
  });

  it("exposes the contracted file, start, and create-playlist selectors", async () => {
    render(<ImportView />);

    const fileButton = await screen.findByTestId(`import-file-${file.name}`);
    fireEvent.click(fileButton);

    const startButton = await screen.findByTestId("import-start-button");
    fireEvent.click(startButton);

    expect(await screen.findByTestId("import-create-playlist-button")).toBeTruthy();
  });
});
