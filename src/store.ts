import { create } from "zustand";
import type { Track, Playlist, Settings, View, RepeatMode, SearchResult, PlaylistSuggestion, SmartQueueMode, InsightsStats, ChatMessage } from "./types";

interface AppState {
  // Navigation
  view: View;
  setView: (view: View) => void;
  selectedPlaylistId: string | null;
  setSelectedPlaylistId: (id: string | null) => void;

  // Search
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchResults: SearchResult[];
  setSearchResults: (results: SearchResult[]) => void;
  isSearching: boolean;
  setIsSearching: (loading: boolean) => void;

  // Player
  currentTrack: Track | SearchResult | null;
  setCurrentTrack: (track: Track | SearchResult | null) => void;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  volume: number;
  setVolume: (volume: number) => void;
  progress: number;
  setProgress: (progress: number) => void;
  duration: number;
  setDuration: (duration: number) => void;
  isShuffle: boolean;
  toggleShuffle: () => void;
  repeatMode: RepeatMode;
  toggleRepeat: () => void;

  // Queue
  queue: (Track | SearchResult)[];
  setQueue: (queue: (Track | SearchResult)[]) => void;
  addToQueue: (track: Track | SearchResult) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  queueIndex: number;
  setQueueIndex: (index: number) => void;
  playNext: () => void;
  playPrevious: () => void;

  // Playlists
  playlists: Playlist[];
  setPlaylists: (playlists: Playlist[]) => void;
  addPlaylist: (playlist: Playlist) => void;
  removePlaylist: (id: string) => void;

  // Library
  library: Track[];
  setLibrary: (tracks: Track[]) => void;
  recentlyPlayed: Track[];
  setRecentlyPlayed: (tracks: Track[]) => void;
  favorites: Track[];
  setFavorites: (tracks: Track[]) => void;
  downloads: Track[];
  setDownloads: (tracks: Track[]) => void;

  // Settings
  settings: Settings | null;
  setSettings: (settings: Settings) => void;

  // Ollama AI
  ollamaAvailable: boolean;
  setOllamaAvailable: (available: boolean) => void;
  ollamaModels: string[];
  setOllamaModels: (models: string[]) => void;
  isAISearching: boolean;
  setIsAISearching: (loading: boolean) => void;
  aiSearchResults: string[];
  setAISearchResults: (results: string[]) => void;
  aiPlaylistSuggestion: PlaylistSuggestion | null;
  setAIPlaylistSuggestion: (suggestion: PlaylistSuggestion | null) => void;
  aiProcessing: boolean;
  setAiProcessing: (processing: boolean) => void;
  trackMetadata: Map<string, import('./types').TrackMetadataAI>;
  setTrackMetadata: (trackId: string, metadata: import('./types').TrackMetadataAI) => void;

  // Smart Queue (FAZA 4)
  smartQueueActive: boolean;
  setSmartQueueActive: (active: boolean) => void;
  smartQueueMode: SmartQueueMode | 'auto' | 'contextual' | null;
  setSmartQueueMode: (mode: SmartQueueMode | 'auto' | 'contextual' | null) => void;
  smartQueueLoading: boolean;
  setSmartQueueLoading: (loading: boolean) => void;
  recentlyPlayedIds: string[];
  addRecentlyPlayedId: (id: string) => void;

  // Daily Mix (FAZA 3 - Step 3.5)
  dailyMixPlaylist: import('./types').Playlist | null;
  dailyMixTracks: import('./types').Track[];
  dailyMixLoading: boolean;
  dailyMixError: string | null;
  setDailyMixPlaylist: (playlist: import('./types').Playlist | null) => void;
  setDailyMixTracks: (tracks: import('./types').Track[]) => void;
  setDailyMixLoading: (loading: boolean) => void;
  setDailyMixError: (error: string | null) => void;

  // Insights (FAZA 6)
  insightsStats: InsightsStats | null;
  setInsightsStats: (stats: InsightsStats | null) => void;
  insightsLoading: boolean;
  setInsightsLoading: (loading: boolean) => void;

  // AI Chat (FAZA 7)
  chatMessages: ChatMessage[];
  addChatMessage: (msg: ChatMessage) => void;
  clearChatMessages: () => void;
  chatLoading: boolean;
  setChatLoading: (loading: boolean) => void;

  // DJ Trigger Engine (FAZA 11)
  djSessionStart: number | null;
  djLastInterventionAt: number | null;
  djSessionTracksPlayed: number;
  djPendingEvent: import('./types').DjEventContext | null;
  djInterventionCount: number;
  djLastTrackStartAt: number | null;
  setDjSessionStart: (timestamp: number | null) => void;
  setDjLastInterventionAt: (timestamp: number | null) => void;
  incrementDjSessionTracks: () => void;
  setDjPendingEvent: (event: import('./types').DjEventContext | null) => void;
  incrementDjInterventionCount: () => void;
  setDjLastTrackStartAt: (timestamp: number | null) => void;
  resetDjSession: () => void;

  // UI
  isPlayerExpanded: boolean;
  togglePlayerExpanded: () => void;
  showAddToPlaylist: Track | SearchResult | null;
  setShowAddToPlaylist: (track: Track | SearchResult | null) => void;

  // Video Player
  isVideoMode: boolean;
  videoSource: 'ytdlp' | 'iframe' | null;
  videoUrl: string | null;
  videoVideoId: string | null;
  isVideoLoading: boolean;
  openVideo: (videoId: string, source: 'ytdlp' | 'iframe', url: string) => void;
  closeVideo: () => void;
  setVideoLoading: (loading: boolean) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Navigation
  view: "home",
  setView: (view) => set({ view }),
  selectedPlaylistId: null,
  setSelectedPlaylistId: (id) => set({ selectedPlaylistId: id }),

  // Search
  searchQuery: "",
  setSearchQuery: (query) => set({ searchQuery: query }),
  searchResults: [],
  setSearchResults: (results) => set({ searchResults: results }),
  isSearching: false,
  setIsSearching: (loading) => set({ isSearching: loading }),

  // Player
  currentTrack: null,
  setCurrentTrack: (track) => set({ currentTrack: track }),
  isPlaying: false,
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  volume: 1,
  setVolume: (volume) => set({ volume }),
  progress: 0,
  setProgress: (progress) => set({ progress }),
  duration: 0,
  setDuration: (duration) => set({ duration }),
  isShuffle: false,
  toggleShuffle: () => set((state) => ({ isShuffle: !state.isShuffle })),
  repeatMode: "none",
  toggleRepeat: () =>
    set((state) => ({
      repeatMode:
        state.repeatMode === "none"
          ? "all"
          : state.repeatMode === "all"
          ? "one"
          : "none",
    })),

  // Queue
  queue: [],
  setQueue: (queue) => set({ queue }),
  addToQueue: (track) => set((state) => ({ queue: [...state.queue, track] })),
  removeFromQueue: (index) =>
    set((state) => ({
      queue: state.queue.filter((_, i) => i !== index),
    })),
  clearQueue: () => set({ queue: [], queueIndex: 0 }),
  queueIndex: 0,
  setQueueIndex: (index) => set({ queueIndex: index }),
  playNext: () => {
    const { queue, queueIndex, repeatMode, isShuffle } = get();
    if (queue.length === 0) return;

    let nextIndex: number;
    
    if (repeatMode === "one") {
      // Repeat current track
      nextIndex = queueIndex;
    } else if (isShuffle) {
      // Random next track
      nextIndex = Math.floor(Math.random() * queue.length);
    } else if (queueIndex < queue.length - 1) {
      nextIndex = queueIndex + 1;
    } else if (repeatMode === "all") {
      nextIndex = 0;
    } else {
      return; // End of queue
    }

    set({
      queueIndex: nextIndex,
      currentTrack: queue[nextIndex],
      isPlaying: true,
    });
  },
  playPrevious: () => {
    const { queue, queueIndex, progress } = get();
    if (queue.length === 0) return;

    // If more than 3 seconds in, restart current track
    if (progress > 3) {
      set({ progress: 0 });
      return;
    }

    const prevIndex = queueIndex > 0 ? queueIndex - 1 : queue.length - 1;
    set({
      queueIndex: prevIndex,
      currentTrack: queue[prevIndex],
      isPlaying: true,
    });
  },

  // Playlists
  playlists: [],
  setPlaylists: (playlists) => set({ playlists }),
  addPlaylist: (playlist) =>
    set((state) => ({ playlists: [playlist, ...state.playlists] })),
  removePlaylist: (id) =>
    set((state) => ({
      playlists: state.playlists.filter((p) => p.id !== id),
    })),

  // Library
  library: [],
  setLibrary: (tracks) => set({ library: tracks }),
  recentlyPlayed: [],
  setRecentlyPlayed: (tracks) => set({ recentlyPlayed: tracks }),
  favorites: [],
  setFavorites: (tracks) => set({ favorites: tracks }),
  downloads: [],
  setDownloads: (tracks) => set({ downloads: tracks }),

  // Settings
  settings: null,
  setSettings: (settings) => set({ settings }),

  // Ollama AI
  ollamaAvailable: false,
  setOllamaAvailable: (available) => set({ ollamaAvailable: available }),
  ollamaModels: [],
  setOllamaModels: (models) => set({ ollamaModels: models }),
  isAISearching: false,
  setIsAISearching: (loading) => set({ isAISearching: loading }),
  aiSearchResults: [],
  setAISearchResults: (results) => set({ aiSearchResults: results }),
  aiPlaylistSuggestion: null,
  setAIPlaylistSuggestion: (suggestion) => set({ aiPlaylistSuggestion: suggestion }),
  aiProcessing: false,
  setAiProcessing: (processing) => set({ aiProcessing: processing }),
  trackMetadata: new Map(),
  setTrackMetadata: (trackId, metadata) =>
    set((state) => {
      const newMap = new Map(state.trackMetadata);
      newMap.set(trackId, metadata);
      return { trackMetadata: newMap };
    }),

  // Smart Queue (FAZA 4)
  smartQueueActive: false,
  setSmartQueueActive: (active) => set({ smartQueueActive: active }),
  smartQueueMode: null,
  setSmartQueueMode: (mode) => set({ smartQueueMode: mode }),
  smartQueueLoading: false,
  setSmartQueueLoading: (loading) => set({ smartQueueLoading: loading }),
  recentlyPlayedIds: [],
  addRecentlyPlayedId: (id) =>
    set((state) => ({
      recentlyPlayedIds: [...state.recentlyPlayedIds.slice(-19), id],
    })),

  // Daily Mix (FAZA 3 - Step 3.5)
  dailyMixPlaylist: null,
  dailyMixTracks: [],
  dailyMixLoading: false,
  dailyMixError: null,
  setDailyMixPlaylist: (playlist) => set({ dailyMixPlaylist: playlist }),
  setDailyMixTracks: (tracks) => set({ dailyMixTracks: tracks }),
  setDailyMixLoading: (loading) => set({ dailyMixLoading: loading }),
  setDailyMixError: (error) => set({ dailyMixError: error }),

  // Insights (FAZA 6)
  insightsStats: null,
  setInsightsStats: (stats) => set({ insightsStats: stats }),
  insightsLoading: false,
  setInsightsLoading: (loading) => set({ insightsLoading: loading }),

  // AI Chat (FAZA 7)
  chatMessages: [],
  addChatMessage: (msg) => set((state) => ({ chatMessages: [...state.chatMessages, msg] })),
  clearChatMessages: () => set({ chatMessages: [] }),
  chatLoading: false,
  setChatLoading: (loading) => set({ chatLoading: loading }),

  // DJ Trigger Engine (FAZA 11)
  djSessionStart: null,
  djLastInterventionAt: null,
  djSessionTracksPlayed: 0,
  djPendingEvent: null,
  djInterventionCount: 0,
  djLastTrackStartAt: null,
  setDjSessionStart: (timestamp) => set({ djSessionStart: timestamp }),
  setDjLastInterventionAt: (timestamp) => set({ djLastInterventionAt: timestamp }),
  incrementDjSessionTracks: () => set((state) => ({ djSessionTracksPlayed: state.djSessionTracksPlayed + 1 })),
  setDjPendingEvent: (event) => set({ djPendingEvent: event }),
  incrementDjInterventionCount: () => set((state) => ({ djInterventionCount: state.djInterventionCount + 1 })),
  setDjLastTrackStartAt: (timestamp) => set({ djLastTrackStartAt: timestamp }),
  resetDjSession: () => set({
    djSessionStart: null,
    djLastInterventionAt: null,
    djSessionTracksPlayed: 0,
    djPendingEvent: null,
    djInterventionCount: 0,
    djLastTrackStartAt: null,
  }),

  // UI
  isPlayerExpanded: false,
  togglePlayerExpanded: () =>
    set((state) => ({ isPlayerExpanded: !state.isPlayerExpanded })),
  showAddToPlaylist: null,
  setShowAddToPlaylist: (track) => set({ showAddToPlaylist: track }),

  // Video Player
  isVideoMode: false,
  videoSource: null,
  videoUrl: null,
  videoVideoId: null,
  isVideoLoading: false,
  openVideo: (videoId, source, url) => set({ isVideoMode: true, videoVideoId: videoId, videoSource: source, videoUrl: url, isVideoLoading: false }),
  closeVideo: () => set({ isVideoMode: false, videoSource: null, videoUrl: null, videoVideoId: null, isVideoLoading: false }),
  setVideoLoading: (loading) => set({ isVideoLoading: loading }),
}));
