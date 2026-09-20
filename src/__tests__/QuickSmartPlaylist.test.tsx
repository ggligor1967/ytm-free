import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as api from "../api";
import { PlaylistsView } from "../components/views/PlaylistsView";
import { useAppStore } from "../store";
import type { Playlist, SearchResult, Settings, SmartPlaylistPlan, Track } from "../types";

vi.mock("../api");
vi.mock("../lib/toast", () => ({ showToast: vi.fn() }));

const plan: SmartPlaylistPlan = {
  name: "Road Rage Hard Rock",
  description: "Hard rock for an energetic drive.",
  genres: ["rock"], moods: ["energetic"], energy_min: 7, energy_max: 10,
  decades: ["1980s"], tempo: "fast", activities: ["driving"],
  search_queries: ["hard rock driving", "classic road rock"],
};
const libraryTrack: Track = {
  id: "library-uuid", video_id: "library-video", title: "Library Rock", artist: "Test Artist",
  thumbnail: "", duration: 200, is_downloaded: false, is_favorite: false,
  play_count: 0, created_at: "2026-09-20T00:00:00Z",
};
const video: SearchResult = {
  id: "youtube-video", title: "Road Rock", artist: "Test Band", thumbnail: "",
};
const saved: Playlist = {
  id: "saved-playlist", name: plan.name, description: plan.description, track_count: 1,
  created_at: "2026-09-20T00:00:00Z", updated_at: "2026-09-20T00:00:00Z",
};
const initialState = useAppStore.getState();

async function generate(description = plan.name) {
  render(<PlaylistsView />);
  fireEvent.click(screen.getByRole("button", { name: "Generate Smart Playlist" }));
  expect(screen.getByRole("heading", { name: "Create Smart Playlist" })).toBeVisible();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: description } });
  fireEvent.click(screen.getByRole("button", { name: "Generate" }));
  await screen.findByRole("button", { name: "Save" });
}

function matchLibrary() {
  vi.mocked(api.smartPlaylistMatchLibrary).mockResolvedValue([{
    track: libraryTrack, genre: "rock", mood: "energetic", energy_level: 8,
    decade: "1980s", score: 1,
  }]);
}

beforeEach(() => {
  vi.resetAllMocks();
  useAppStore.setState({
    ...initialState,
    settings: { ollama_enabled: true, ollama_model: "test-model", semantic_search_enabled: true } as Settings,
    ollamaAvailable: true,
  }, true);
  vi.mocked(api.smartPlaylistGeneratePlan).mockResolvedValue(plan);
  vi.mocked(api.smartPlaylistMatchLibrary).mockResolvedValue([]);
  vi.mocked(api.searchYoutube).mockResolvedValue([]);
  vi.mocked(api.getTrackInfo).mockResolvedValue({ ...video, duration: 210, formats: [] });
  vi.mocked(api.smartPlaylistCoverIdea).mockResolvedValue({ description: "", style: "", colors: [] });
  vi.mocked(api.smartPlaylistSave).mockResolvedValue(saved);
  vi.mocked(api.getPlaylists).mockResolvedValue([saved]);
});

afterEach(() => {
  cleanup();
  useAppStore.setState(initialState, true);
});

describe("canonical Smart Playlist creation from PlaylistsView", () => {
  it("renders English examples while preserving free-form multilingual input", () => {
    render(<PlaylistsView />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Smart Playlist" }));

    const examples = [
      "energetic 45-minute workout",
      "chill music for reading",
      "classic rock for driving",
      "something melancholic for the evening",
      "party with friends",
    ];
    examples.forEach((example) => {
      expect(screen.getByRole("button", { name: example })).toBeVisible();
    });
    expect(screen.getByPlaceholderText("e.g., energetic 45-minute workout...")).toBeVisible();

    [
      "workout energic de 45 minute",
      "muzică chill pentru citit",
      "rock clasic de condus",
      "ceva melancolic pentru seară",
      "party cu prietenii",
    ].forEach((oldExample) => {
      expect(screen.queryByRole("button", { name: oldExample })).not.toBeInTheDocument();
    });
  });

  it.each(["Road Rage Hard Rock", "muzică rock pentru condus"])(
    "uses the canonical plan/match/search/preview/save workflow for %s", async (description) => {
      matchLibrary();
      await generate(description);
      expect(api.smartPlaylistGeneratePlan).toHaveBeenCalledWith(description, "description", undefined, "test-model");
      expect(api.smartPlaylistMatchLibrary).toHaveBeenCalledWith(
        plan.genres, plan.moods, 7, 10, plan.decades, plan.activities, 30,
      );
      expect(api.searchYoutube).toHaveBeenCalledWith(plan.search_queries[0], 2);
      expect(api.searchYoutube).toHaveBeenCalledWith(plan.search_queries[1], 2);
      expect(screen.getByText(plan.description)).toBeVisible();
      expect(api.smartPlaylistSave).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(api.smartPlaylistSave).toHaveBeenCalledWith(
        plan.name, plan.description, [libraryTrack.id], [],
      ));
      expect(api.ollamaGeneratePlaylist).not.toHaveBeenCalled();
      expect(api.createPlaylist).not.toHaveBeenCalled();
    },
  );

  it("deduplicates YouTube results across queries and saves both membership IDs and metadata", async () => {
    vi.mocked(api.searchYoutube).mockResolvedValue([video]);
    await generate();
    expect(screen.getByText("Matched 0 from library • Found 1 new tracks")).toBeVisible();
    expect(api.getTrackInfo).toHaveBeenCalledExactlyOnceWith(video.id);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.smartPlaylistSave).toHaveBeenCalledExactlyOnceWith(
      plan.name, plan.description, [video.id], [[video.id, video.title, video.artist, video.thumbnail]],
    ));
  });

  it("deduplicates YouTube candidates already matched in the library", async () => {
    matchLibrary();
    vi.mocked(api.searchYoutube).mockResolvedValue([{ ...video, id: libraryTrack.video_id }, video]);
    await generate();
    fireEvent.click(screen.getByRole("button", { name: "Play Now" }));
    expect(useAppStore.getState().queue.map(track => track.id)).toEqual([libraryTrack.id, `yt_${video.id}`]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.smartPlaylistSave).toHaveBeenCalledWith(
      plan.name, plan.description, [libraryTrack.id, video.id], [[video.id, video.title, video.artist, video.thumbnail]],
    ));
  });

  it.each([false, true])("blocks empty creation and playback (search failure: %s)", async (searchFails) => {
    if (searchFails) vi.mocked(api.searchYoutube).mockRejectedValue(new Error("Search unavailable"));
    await generate();
    expect(screen.getByRole("alert")).toHaveTextContent("No matching tracks found. Try a different description.");
    const save = screen.getByRole("button", { name: "Save" });
    const play = screen.getByRole("button", { name: "Play Now" });
    expect(save).toBeDisabled();
    expect(play).toBeDisabled();
    fireEvent.click(save);
    fireEvent.click(play);
    expect(api.smartPlaylistSave).not.toHaveBeenCalled();
    expect(api.createPlaylist).not.toHaveBeenCalled();
    expect(useAppStore.getState().playlists).toEqual([]);
    expect(useAppStore.getState().queue).toEqual([]);
  });

  it("refreshes real Zustand playlist state exactly once with one visible saved entry", async () => {
    const existing = { ...saved, id: "existing", name: "Existing Playlist" };
    useAppStore.setState({ playlists: [existing] });
    vi.mocked(api.getPlaylists).mockResolvedValue([existing, saved]);
    matchLibrary();
    const playlistChanges = vi.fn();
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (state.playlists !== previous.playlists) playlistChanges(state.playlists);
    });
    try {
      await generate();
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(useAppStore.getState().selectedPlaylistId).toBe(saved.id));
      expect(api.getPlaylists).toHaveBeenCalledTimes(1);
      expect(playlistChanges).toHaveBeenCalledExactlyOnceWith([existing, saved]);
      expect(useAppStore.getState().playlists).toEqual([existing, saved]);
      expect(screen.getAllByTestId(`playlist-${saved.name}`)).toHaveLength(1);
      expect(within(screen.getByTestId(`playlist-${saved.name}`)).getByText("1 tracks")).toBeVisible();
    } finally {
      unsubscribe();
    }
  });

  it("shows save failures in the preview without changing playlist state", async () => {
    matchLibrary();
    vi.mocked(api.smartPlaylistSave).mockRejectedValue(new Error("Cannot save playlist"));
    await generate();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot save playlist");
    expect(api.getPlaylists).not.toHaveBeenCalled();
    expect(useAppStore.getState().playlists).toEqual([]);
  });

  it("preserves normal manual playlist creation", async () => {
    render(<PlaylistsView />);
    fireEvent.click(screen.getByRole("button", { name: "Create Playlist" }));
    fireEvent.change(screen.getByPlaceholderText("Playlist name"), { target: { value: "Manual" } });
    fireEvent.change(screen.getByPlaceholderText("Description (optional)"), { target: { value: "My songs" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(api.getPlaylists).toHaveBeenCalledTimes(1));
    expect(api.createPlaylist).toHaveBeenCalledExactlyOnceWith("Manual", "My songs");
    expect(api.smartPlaylistGeneratePlan).not.toHaveBeenCalled();
    expect(api.smartPlaylistSave).not.toHaveBeenCalled();
  });

  it("preserves semantic playlist creation", async () => {
    vi.mocked(api.createSemanticPlaylist).mockResolvedValue({
      playlist_id: saved.id, playlist_name: saved.name, track_count: 1,
      average_similarity: 0.9, created_at: saved.created_at,
    });
    render(<PlaylistsView />);
    fireEvent.click(screen.getByRole("button", { name: "Create Semantic Playlist" }));
    fireEvent.change(screen.getByPlaceholderText("Describe what you want (e.g., ambient music for calm focus and sleep)"), {
      target: { value: "  calm focus  " },
    });
    fireEvent.change(screen.getByPlaceholderText("Leave empty for auto-generated name"), { target: { value: "  Focus  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(useAppStore.getState().selectedPlaylistId).toBe(saved.id));
    expect(api.createSemanticPlaylist).toHaveBeenCalledExactlyOnceWith("calm focus", "Focus");
    expect(api.smartPlaylistGeneratePlan).not.toHaveBeenCalled();
    expect(api.smartPlaylistSave).not.toHaveBeenCalled();
  });
});
