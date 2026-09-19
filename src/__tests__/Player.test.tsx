import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { Player } from "../components/Player";
import { getTrackId } from "../lib/trackId";
import { useAppStore } from "../store";
import type { Track, SearchResult } from "../types";

vi.mock("../api", () => ({
  getStreamUrl: vi.fn(),
  getTotalPlayCount: vi.fn(),
}));

const playerTrack: SearchResult = {
  id: "video-123",
  title: "Test Song",
  artist: "Test Artist",
  thumbnail: "http://example.com/thumb.jpg",
  duration: 200,
};

describe("Player playback state", () => {
  let playMock: ReturnType<typeof vi.spyOn>;
  let pauseMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getStreamUrl).mockResolvedValue("http://localhost:3456/stream/video-123");
    playMock = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    pauseMock = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => undefined);
    useAppStore.setState({
      currentTrack: playerTrack,
      isPlaying: true,
      progress: 0,
      duration: 0,
      playbackRestartRequestId: 0,
      settings: null,
      favorites: [],
      queue: [],
      queueIndex: 0,
      isVideoMode: false,
      djPendingEvent: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAppStore.setState({ currentTrack: null, isPlaying: false });
  });

  it("ignores AbortError play rejections without forcing playback false", async () => {
    const diagnosticSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    playMock.mockRejectedValueOnce(
      new DOMException("The play request was interrupted", "AbortError")
    );

    const { container } = render(<Player />);

    await waitFor(() => expect(playMock).toHaveBeenCalledOnce());
    await act(async () => Promise.resolve());
    expect(useAppStore.getState().isPlaying).toBe(true);
    expect(container.querySelector(".lucide-pause")).not.toBeNull();
    expect(diagnosticSpy).not.toHaveBeenCalledWith(
      "[Player] Audio playback failed:",
      expect.anything()
    );
  });

  it("sets isPlaying false when the media element reports an error", async () => {
    const diagnosticSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sensitiveCurrentSrc = "https://media.example/audio?sig=SECRET_QUERY_VALUE";
    const { container } = render(<Player />);
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    Object.defineProperty(audio!, "error", {
      configurable: true,
      value: { code: 3 },
    });
    Object.defineProperty(audio!, "currentSrc", {
      configurable: true,
      value: sensitiveCurrentSrc,
    });

    await waitFor(() => expect(playMock).toHaveBeenCalledOnce());
    fireEvent.error(audio!);

    expect(useAppStore.getState().isPlaying).toBe(false);
    expect(container.querySelector(".lucide-play")).not.toBeNull();
    expect(diagnosticSpy).toHaveBeenCalledWith(
      "[Player] Audio playback failed:",
      { type: "error", mediaErrorCode: 3 }
    );
    const diagnosticText = diagnosticSpy.mock.calls
      .flat()
      .map((value) => typeof value === "string" ? value : JSON.stringify(value))
      .join(" ");
    expect(diagnosticText).not.toContain(sensitiveCurrentSrc);
    expect(diagnosticText).not.toContain("currentSrc");
    expect(diagnosticText).not.toContain("sig=");
  });

  it("sets isPlaying false and logs a sanitized diagnostic for non-AbortError rejection", async () => {
    const playbackError = new DOMException("No supported source", "NotSupportedError");
    playMock.mockRejectedValueOnce(playbackError);
    const diagnosticSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { container } = render(<Player />);

    await waitFor(() => expect(useAppStore.getState().isPlaying).toBe(false));
    expect(playMock).toHaveBeenCalledOnce();
    expect(container.querySelector(".lucide-play")).not.toBeNull();
    expect(diagnosticSpy).toHaveBeenCalledWith(
      "[Player] Audio playback failed:",
      { type: "play-rejection", errorName: "NotSupportedError" }
    );
    expect(diagnosticSpy).not.toHaveBeenCalledWith(
      "[Player] Audio playback failed:",
      playbackError
    );
  });

  it("keeps isPlaying true when play succeeds", async () => {
    const { container } = render(<Player />);

    await waitFor(() => expect(playMock).toHaveBeenCalledOnce());
    expect(useAppStore.getState().isPlaying).toBe(true);
    expect(container.querySelector(".lucide-pause")).not.toBeNull();
    expect(pauseMock).not.toHaveBeenCalled();
  });

  it("does not let a previous track AbortError pause the newly selected track", async () => {
    const diagnosticSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let rejectPreviousPlay!: (reason: unknown) => void;
    const previousPlay = new Promise<void>((_, reject) => {
      rejectPreviousPlay = reject;
    });
    playMock.mockImplementationOnce(() => previousPlay).mockResolvedValue(undefined);
    vi.mocked(api.getStreamUrl).mockImplementation(
      async (videoId) => `http://localhost:3456/stream/${videoId}`
    );
    const nextTrack: SearchResult = {
      ...playerTrack,
      id: "video-456",
      title: "Next Song",
    };

    const { container } = render(<Player />);
    await waitFor(() => expect(playMock).toHaveBeenCalledOnce());

    act(() => {
      useAppStore.setState({ currentTrack: nextTrack, isPlaying: true });
    });
    await waitFor(() => expect(playMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      rejectPreviousPlay(
        new DOMException("The play request was interrupted by a new load request", "AbortError")
      );
      await Promise.resolve();
    });

    expect(useAppStore.getState().isPlaying).toBe(true);
    expect(container.querySelector(".lucide-pause")).not.toBeNull();
    expect(diagnosticSpy).not.toHaveBeenCalledWith(
      "[Player] Audio playback failed:",
      expect.anything()
    );
  });

  it("restarts the current media element when Previous emits a restart request", async () => {
    useAppStore.setState({
      queue: [playerTrack],
      queueIndex: 0,
      currentTrack: playerTrack,
      isPlaying: true,
      progress: 4,
    });

    const { container } = render(<Player />);
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    await waitFor(() => expect(playMock).toHaveBeenCalledOnce());

    Object.defineProperty(audio!, "currentTime", {
      configurable: true,
      writable: true,
      value: 12,
    });
    const sourceBeforeRestart = audio!.getAttribute("src");

    act(() => {
      useAppStore.getState().playPrevious();
    });

    await waitFor(() => expect(audio!.currentTime).toBe(0));
    expect(useAppStore.getState().currentTrack).toBe(playerTrack);
    expect(useAppStore.getState().queueIndex).toBe(0);
    expect(useAppStore.getState().isPlaying).toBe(true);
    expect(audio!.getAttribute("src")).toBe(sourceBeforeRestart);
    expect(api.getStreamUrl).toHaveBeenCalledTimes(1);

    audio!.currentTime = 0.75;
    fireEvent.timeUpdate(audio!);

    expect(useAppStore.getState().progress).toBe(0.75);
  });

  it("keeps the main player button synchronized with media pause and play", async () => {
    const { container } = render(<Player />);
    const playbackButton = container.querySelector<HTMLButtonElement>("button.w-12.h-12");
    expect(playbackButton).not.toBeNull();
    await waitFor(() => expect(playMock).toHaveBeenCalledOnce());

    fireEvent.click(playbackButton!);

    await waitFor(() => expect(pauseMock).toHaveBeenCalledOnce());
    expect(useAppStore.getState().isPlaying).toBe(false);

    fireEvent.click(playbackButton!);

    await waitFor(() => expect(playMock).toHaveBeenCalledTimes(2));
    expect(useAppStore.getState().isPlaying).toBe(true);
  });
});

describe("getTrackId", () => {
  it("returns id from a Track object", () => {
    const track: Track = {
      id: "track-123",
      video_id: "vid-abc",
      title: "Test Song",
      artist: "Test Artist",
      thumbnail: "http://example.com/thumb.jpg",
      duration: 200,
      is_downloaded: false,
      is_favorite: false,
      play_count: 0,
      created_at: "2024-01-01T00:00:00Z",
    };

    expect(getTrackId(track)).toBe("track-123");
  });

  it("returns id from a SearchResult object", () => {
    const result: SearchResult = {
      id: "search-456",
      title: "Found Song",
      artist: "Found Artist",
      thumbnail: "http://example.com/thumb2.jpg",
      duration: 180,
    };

    expect(getTrackId(result)).toBe("search-456");
  });

  it("returns the correct id when Track has different id and video_id", () => {
    const track: Track = {
      id: "track-id-999",
      video_id: "youtube-video-id",
      title: "Another Song",
      artist: "Another Artist",
      thumbnail: "http://example.com/thumb3.jpg",
      duration: 240,
      is_downloaded: true,
      is_favorite: true,
      play_count: 5,
      created_at: "2024-06-15T00:00:00Z",
    };

    const id = getTrackId(track);
    // Should return the `id` field (not `video_id`)
    expect(id).toBe("track-id-999");
    expect(id).not.toBe(track.video_id);
  });
});
