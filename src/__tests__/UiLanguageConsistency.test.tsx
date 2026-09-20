import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VideoPlayer } from "../components/VideoPlayer";
import { InsightsView } from "../components/views/InsightsView";
import { useAppStore } from "../store";
import type { InsightsStats } from "../types";

const initialState = useAppStore.getState();

const emptyInsightsStats: InsightsStats = {
  total_tracks: 0,
  total_time_seconds: 0,
  top_genres: [],
  top_artists: [],
  top_moods: [],
  daily_breakdown: [],
  streak_days: 0,
  hourly_breakdown: [],
  top_tracks: [],
};

beforeEach(() => {
  useAppStore.setState({
    ...initialState,
    insightsStats: emptyInsightsStats,
    insightsLoading: false,
    ollamaAvailable: false,
    isVideoMode: false,
    videoSource: null,
    videoUrl: null,
    videoVideoId: null,
    isVideoLoading: false,
  }, true);
});

afterEach(() => {
  cleanup();
  useAppStore.setState(initialState, true);
});

describe("default English UI language", () => {
  it("renders English Insights tabs and preserves tab switching", () => {
    render(<InsightsView />);

    const labels = ["Overview", "AI Profile", "Discover", "Explore", "Year in Review"];
    labels.forEach((label) => {
      expect(screen.getByRole("button", { name: label })).toBeVisible();
    });
    ["Prezentare", "Profil AI", "Descoperă", "Explorează"].forEach((oldLabel) => {
      expect(screen.queryByRole("button", { name: oldLabel })).not.toBeInTheDocument();
    });

    expect(screen.getByText("Tracks")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "AI Profile" }));
    expect(screen.getByText(/Ollama AI is not available/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    expect(screen.getByText("Ollama AI is required for discovery features.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Explore" }));
    expect(screen.getByText("Ollama AI is required for exploration features.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Year in Review" }));
    expect(screen.getByRole("button", { name: "Generate My Wrapped" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(screen.getByText("Tracks")).toBeVisible();
  });

  it("uses English VideoPlayer controls without changing their behavior", () => {
    act(() => useAppStore.setState({
      isVideoMode: true,
      videoSource: "iframe",
      videoVideoId: "test-video-id",
    }));

    render(<VideoPlayer />);

    const expandButton = screen.getByTitle("Expand");
    expect(expandButton).toBeVisible();
    expect(screen.getByTitle("Close video")).toBeVisible();

    fireEvent.click(expandButton);
    expect(screen.getByTitle("Minimize")).toBeVisible();

    fireEvent.click(screen.getByTitle("Close video"));
    expect(screen.queryByTitle("Minimize")).not.toBeInTheDocument();
  });

  it("renders the English VideoPlayer playback error", () => {
    act(() => useAppStore.setState({
      isVideoMode: true,
      videoSource: "ytdlp",
      videoUrl: "http://127.0.0.1:3456/video/test",
    }));

    const { container } = render(<VideoPlayer />);
    const video = container.querySelector("video");
    expect(video).not.toBeNull();

    fireEvent.error(video!);

    expect(screen.getByText(
      "Could not play the video stream. Check that FFmpeg is installed."
    )).toBeVisible();
    expect(screen.queryByText(
      "Nu s-a putut reda stream-ul video. Verifică dacă ffmpeg este instalat."
    )).not.toBeInTheDocument();
  });
});
