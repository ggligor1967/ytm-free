import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTriggerEngine } from "../hooks/useTriggerEngine";
import type { DjEventContext, Settings, Track } from "../types";

const { mockUseAppStoreImpl, mockGetState } = vi.hoisted(() => ({
  mockUseAppStoreImpl: vi.fn(),
  mockGetState: vi.fn(),
}));

vi.mock("../store", () => {
  const useAppStore = (...args: unknown[]) => mockUseAppStoreImpl(...args);
  useAppStore.getState = () => mockGetState();
  return { useAppStore };
});

vi.mock("../api", () => ({
  getTotalPlayCount: vi.fn().mockResolvedValue(0),
}));

function makeTrack(id: string): Track {
  return {
    id,
    video_id: `video-${id}`,
    title: `Title ${id}`,
    artist: `Artist ${id}`,
    thumbnail: "http://example.com/thumb.jpg",
    duration: 200,
    is_downloaded: false,
    is_favorite: false,
    play_count: 0,
    created_at: "2024-01-01T00:00:00Z",
  };
}

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    audio_quality: "high",
    download_path: "C:/Music",
    auto_download: false,
    theme: "dark",
    volume: 1,
    crossfade: false,
    crossfade_duration: 0,
    ollama_enabled: false,
    ollama_url: "",
    ollama_model: "llama3",
    smart_search_enabled: false,
    auto_tagging_enabled: false,
    smart_queue_enabled: false,
    daily_mix_enabled: false,
    search_results_count: 20,
    dj_mode_enabled: true,
    dj_style: "hype",
    dj_language: "en",
    dj_frequency: 1,
    dj_voice: "default",
    dj_pitch: 1,
    dj_rate: 1,
    dj_triggers_enabled: {
      track_start: true,
      track_end: true,
      queue_empty: true,
      long_session: true,
      first_track_of_day: true,
      milestone: true,
      time_announcement: true,
      mood_shift: true,
    },
    ...overrides,
  } as Settings;
}

// Mirrors real Zustand: useAppStore() (reactive selector) and
// useAppStore.getState() (imperative snapshot) both read the SAME live
// state object, and every action mutates that object in place.
function createState(overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    currentTrack: null as Track | null,
    queue: [] as Track[],
    settings: makeSettings(),
    djSessionStart: null as number | null,
    djLastInterventionAt: null as number | null,
    djSessionTracksPlayed: 0,
    djInterventionCount: 0,
    djLastTrackStartAt: 0,
    trackMetadata: new Map<string, { mood?: string }>(),
    djPendingEvent: null as DjEventContext | null,
  };
  state.setDjSessionStart = vi.fn((v: number) => { state.djSessionStart = v; });
  state.setDjLastInterventionAt = vi.fn((v: number) => { state.djLastInterventionAt = v; });
  state.incrementDjSessionTracks = vi.fn(() => {
    state.djSessionTracksPlayed = (state.djSessionTracksPlayed as number) + 1;
  });
  state.setDjPendingEvent = vi.fn((ev: DjEventContext) => { state.djPendingEvent = ev; });
  state.incrementDjInterventionCount = vi.fn(() => {
    state.djInterventionCount = (state.djInterventionCount as number) + 1;
  });
  state.setDjLastTrackStartAt = vi.fn((v: number) => { state.djLastTrackStartAt = v; });
  state.resetDjSession = vi.fn();
  Object.assign(state, overrides);
  return state;
}

function emittedTypes(state: ReturnType<typeof createState>): string[] {
  const fn = state.setDjPendingEvent as unknown as { mock: { calls: [DjEventContext][] } };
  return fn.mock.calls.map(([ev]) => ev.trigger_type);
}

describe("useTriggerEngine", () => {
  let state: ReturnType<typeof createState>;

  beforeEach(() => {
    vi.useFakeTimers();
    // Local-time constructor: getHours() reads exactly this value
    // regardless of the machine's timezone. 03:00 avoids all announcement
    // hours (9/12/15/18/21).
    vi.setSystemTime(new Date(2026, 0, 1, 3, 0, 0));
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires FirstTrackOfDay at most once per session", () => {
    state = createState({ currentTrack: makeTrack("t1") });
    mockUseAppStoreImpl.mockImplementation(() => state);
    mockGetState.mockImplementation(() => state);

    const { rerender } = renderHook(() => useTriggerEngine(true));
    rerender();
    rerender();

    const firstTrackCalls = emittedTypes(state).filter((t) => t === "FirstTrackOfDay");
    expect(firstTrackCalls.length).toBe(1);
  });

  it("blocks a second trigger fired within the cooldown window", () => {
    state = createState({
      currentTrack: makeTrack("t1"),
      queue: [makeTrack("q1")],
    });
    mockUseAppStoreImpl.mockImplementation(() => state);
    mockGetState.mockImplementation(() => state);

    const { rerender } = renderHook(() => useTriggerEngine(true));
    // FirstTrackOfDay already consumed the cooldown window; a second
    // trigger (QueueEmpty) fired immediately after must be blocked.
    act(() => {
      state.queue = [];
    });
    rerender();

    const types = emittedTypes(state);
    expect(types).toContain("FirstTrackOfDay");
    expect(types).not.toContain("QueueEmpty");
  });

  it("fires LongSession at the 30-minute mark despite frequent unrelated re-renders (F017 regression)", () => {
    state = createState({
      currentTrack: makeTrack("t1"),
      queue: [makeTrack("q1")],
    });
    mockUseAppStoreImpl.mockImplementation(() => state);
    mockGetState.mockImplementation(() => state);

    const { rerender } = renderHook(() => useTriggerEngine(true));
    expect(state.djSessionStart).not.toBeNull();

    // Simulate a busy UI (e.g. playback progress updates) causing frequent
    // unrelated re-renders throughout the session — every 5s, far more
    // often than Effect 4's 60s interval period. An unmemoized emitTrigger
    // would give the effect a new dependency identity on every one of
    // these renders, tearing down and recreating the interval before it
    // ever accumulates a full 60s tick — starving the 30-minute check.
    // +1 minute of buffer: the interval isn't created until the first
    // post-mount render (djSessionStart is set by Effect 1's mount commit,
    // one render after the interval-owning effect first evaluates it), so
    // its first tick lands slightly after the nominal session start.
    const totalTicks = (31 * 60_000) / 5_000;
    for (let tick = 0; tick < totalTicks; tick++) {
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      rerender();
    }

    expect(emittedTypes(state)).toContain("LongSession");
  });

  it("fires TimeAnnouncement at a valid hour despite frequent unrelated re-renders (F019 regression)", () => {
    vi.setSystemTime(new Date(2026, 0, 1, 8, 57, 0)); // three minutes before a valid local hour (09:00)

    state = createState({
      currentTrack: makeTrack("t1"),
      queue: [makeTrack("q1")],
    });
    mockUseAppStoreImpl.mockImplementation(() => state);
    mockGetState.mockImplementation(() => state);

    const { rerender } = renderHook(() => useTriggerEngine(true));

    // Same busy-UI simulation as the LongSession test, but against
    // Effect 6's shorter 30s interval period: re-render every 5s while
    // advancing past the 09:00 hour, with a minute of buffer for the
    // same one-render-cycle interval-creation offset as the LongSession
    // test above.
    const totalTicks = (4 * 60_000) / 5_000;
    for (let tick = 0; tick < totalTicks; tick++) {
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      rerender();
    }

    expect(emittedTypes(state)).toContain("TimeAnnouncement");
  });

  it("clears intervals on unmount without throwing", () => {
    state = createState({ currentTrack: makeTrack("t1") });
    mockUseAppStoreImpl.mockImplementation(() => state);
    mockGetState.mockImplementation(() => state);

    const { unmount } = renderHook(() => useTriggerEngine(true));
    expect(() => unmount()).not.toThrow();
  });
});
