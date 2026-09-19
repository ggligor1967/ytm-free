import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../store";
import type { SearchResult } from "../types";

const firstTrack: SearchResult = {
  id: "first-track",
  title: "First Track",
  artist: "Test Artist",
  thumbnail: "https://example.com/first.jpg",
  duration: 180,
};

const secondTrack: SearchResult = {
  id: "second-track",
  title: "Second Track",
  artist: "Test Artist",
  thumbnail: "https://example.com/second.jpg",
  duration: 200,
};

describe("player queue controls", () => {
  beforeEach(() => {
    useAppStore.setState({
      currentTrack: null,
      isPlaying: false,
      progress: 0,
      queue: [],
      queueIndex: 0,
      playbackRestartRequestId: 0,
      repeatMode: "none",
      isShuffle: false,
    });
  });

  it("navigates to the previous queue item at the three-second threshold", () => {
    useAppStore.setState({
      currentTrack: secondTrack,
      isPlaying: true,
      progress: 3,
      queue: [firstTrack, secondTrack],
      queueIndex: 1,
    });

    useAppStore.getState().playPrevious();

    const state = useAppStore.getState();
    expect(state.currentTrack).toBe(firstTrack);
    expect(state.queueIndex).toBe(0);
    expect(state.isPlaying).toBe(true);
    expect(state.playbackRestartRequestId).toBe(0);
  });

  it("retains the current queue item and emits a restart request above three seconds", () => {
    useAppStore.setState({
      currentTrack: secondTrack,
      isPlaying: true,
      progress: 3.01,
      queue: [firstTrack, secondTrack],
      queueIndex: 1,
      playbackRestartRequestId: 7,
    });

    useAppStore.getState().playPrevious();

    const state = useAppStore.getState();
    expect(state.currentTrack).toBe(secondTrack);
    expect(state.queueIndex).toBe(1);
    expect(state.isPlaying).toBe(true);
    expect(state.progress).toBe(0);
    expect(state.playbackRestartRequestId).toBe(8);
  });
});