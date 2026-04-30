import { useAppStore } from "../../store";
import { showToast } from "../Toast";
import { TrackCard } from "../TrackCard";
import { Clock, TrendingUp, Brain, Loader2, RefreshCw, Play, AlertCircle, Sparkles } from "lucide-react";
import * as api from "../../api";
import { useState, useCallback, useEffect } from "react";
import { QuickSmartPlaylist } from "../QuickSmartPlaylist";
import type { Track } from "../../types";

export function HomeView() {
  const {
    recentlyPlayed,
    favorites,
    ollamaAvailable,
    settings,
    library,
    dailyMixPlaylist,
    dailyMixTracks,
    dailyMixLoading,
    dailyMixError,
    setDailyMixPlaylist,
    setDailyMixTracks,
    setDailyMixLoading,
    setDailyMixError,
    setCurrentTrack,
    setQueue,
    setQueueIndex,
    setIsPlaying,
    setView,
    setSelectedPlaylistId,
    addPlaylist,
  } = useAppStore();

  const [refreshing, setRefreshing] = useState(false);

  // Recommended for You
  const [recTracks, setRecTracks] = useState<Track[]>([]);
  const [recLoading, setRecLoading] = useState(false);

  const generateDailyMix = useCallback(async () => {
    setDailyMixLoading(true);
    setDailyMixError(null);
    try {
      const [playlist, tracks] = await api.ollamaDailyMix();
      setDailyMixPlaylist(playlist);
      setDailyMixTracks(tracks);
      addPlaylist(playlist);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDailyMixError(msg);
      showToast(msg);
    } finally {
      setDailyMixLoading(false);
      setRefreshing(false);
    }
  }, [setDailyMixLoading, setDailyMixError, setDailyMixPlaylist, setDailyMixTracks, addPlaylist]);

  const handleRefreshDailyMix = () => {
    setRefreshing(true);
    generateDailyMix();
  };

  const handlePlayDailyMix = () => {
    if (dailyMixTracks.length > 0) {
      setQueue(dailyMixTracks);
      setQueueIndex(0);
      setCurrentTrack(dailyMixTracks[0]);
      setIsPlaying(true);
    }
  };

  const handleOpenDailyMixPlaylist = () => {
    if (dailyMixPlaylist) {
      setSelectedPlaylistId(dailyMixPlaylist.id);
      setView("playlist");
    }
  };

  const isDailyMixEnabled = settings?.ollama_enabled && settings?.daily_mix_enabled && ollamaAvailable;

  // ========================================================================
  // Recommended for You
  // ========================================================================
  const isRecEnabled = settings?.ollama_enabled && ollamaAvailable;

  const fetchRecommendations = useCallback(async () => {
    setRecLoading(true);
    try {
      const result = await api.insightsSurpriseMe();
      const items = result?.surprises || [];
      // Match surprise items against library tracks by title/artist
      const matched: Track[] = [];
      for (const item of items) {
        if (matched.length >= 8) break;
        const found = library.find(
          (t) =>
            t.title.toLowerCase().includes(item.title.toLowerCase()) ||
            item.title.toLowerCase().includes(t.title.toLowerCase())
        );
        if (found && !matched.some((m) => m.id === found.id)) {
          matched.push(found);
        }
      }
      setRecTracks(matched.slice(0, 8));
    } catch {
      // Silently fail — section will be hidden
      setRecTracks([]);
    } finally {
      setRecLoading(false);
    }
  }, [library]);

  useEffect(() => {
    if (isRecEnabled) {
      fetchRecommendations();
    }
  }, [isRecEnabled, fetchRecommendations]);

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-3xl font-bold mb-2">Welcome back!</h1>
        <p className="text-ytm-text-secondary">
          Your personal music streaming experience
        </p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <QuickAction
          label="Continue Listening"
          icon={<Clock className="w-6 h-6" />}
          count={recentlyPlayed.length}
          color="bg-purple-600"
        />
        <QuickAction
          label="Liked Songs"
          icon={<TrendingUp className="w-6 h-6" />}
          count={favorites.length}
          color="bg-pink-600"
        />
      </div>

      {/* AI Smart Playlist - One Click Generation */}
      <section>
        <QuickSmartPlaylist />
      </section>

      {/* Daily Mix Section */}
      {isDailyMixEnabled && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-ytm-accent" />
              <h2 className="text-xl font-bold">Daily Mix 🧠</h2>
              <span className="text-xs bg-ytm-accent/20 text-ytm-accent px-2 py-0.5 rounded-full font-medium">
                AI
              </span>
            </div>
            <div className="flex items-center gap-2">
              {dailyMixPlaylist && (
                <button
                  onClick={handleOpenDailyMixPlaylist}
                  className="text-sm text-ytm-text-secondary hover:text-white transition-colors"
                >
                  View Playlist →
                </button>
              )}
              <button
                onClick={handleRefreshDailyMix}
                disabled={dailyMixLoading}
                className="p-2 rounded-lg hover:bg-ytm-surface transition-colors disabled:opacity-50"
                title="Regenerate Daily Mix"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Loading State */}
          {dailyMixLoading && (
            <div className="bg-ytm-surface rounded-xl p-8 flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-ytm-accent" />
              <p className="text-ytm-text-secondary text-sm">
                AI is crafting your personalized Daily Mix...
              </p>
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-2 h-2 bg-ytm-accent rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Error State */}
          {!dailyMixLoading && dailyMixError && (
            <div className="bg-ytm-surface rounded-xl p-6 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-ytm-text-secondary">{dailyMixError}</p>
                <button
                  onClick={handleRefreshDailyMix}
                  className="text-sm text-ytm-accent hover:underline mt-2"
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {/* Daily Mix Content */}
          {!dailyMixLoading && !dailyMixError && dailyMixTracks.length > 0 && dailyMixPlaylist && (
            <div className="space-y-3">
              {/* Header Card */}
              <div className="bg-gradient-to-r from-purple-600/30 to-ytm-accent/20 rounded-xl p-5 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-lg truncate">{dailyMixPlaylist.name}</h3>
                  <p className="text-sm text-ytm-text-secondary truncate">
                    {dailyMixPlaylist.description}
                  </p>
                  <p className="text-xs text-ytm-text-secondary mt-1">
                    {dailyMixTracks.length} tracks
                  </p>
                </div>
                <button
                  onClick={handlePlayDailyMix}
                  className="ml-4 p-3 bg-ytm-accent rounded-full hover:bg-ytm-accent/90 transition-colors flex-shrink-0"
                  title="Play Daily Mix"
                >
                  <Play className="w-5 h-5 text-black fill-black" />
                </button>
              </div>

              {/* Track List (first 8) */}
              <div className="space-y-1">
                {dailyMixTracks.slice(0, 8).map((track, i) => (
                  <TrackCard key={track.id} track={track} index={i} showIndex />
                ))}
              </div>

              {dailyMixTracks.length > 8 && (
                <button
                  onClick={handleOpenDailyMixPlaylist}
                  className="text-sm text-ytm-accent hover:underline w-full text-center py-2"
                >
                  Show all {dailyMixTracks.length} tracks →
                </button>
              )}
            </div>
          )}

          {/* Not yet generated */}
          {!dailyMixLoading && !dailyMixError && dailyMixTracks.length === 0 && (
            <div className="bg-ytm-surface rounded-xl p-6 text-center">
              <Brain className="w-10 h-10 text-ytm-text-secondary mx-auto mb-3" />
              <p className="text-ytm-text-secondary text-sm mb-3">
                Your AI-powered Daily Mix will appear here.
              </p>
              <button
                onClick={handleRefreshDailyMix}
                className="px-4 py-2 bg-ytm-accent text-black rounded-lg hover:bg-ytm-accent/90 font-medium text-sm"
              >
                ✨ Generate Daily Mix
              </button>
            </div>
          )}
        </section>
      )}

      {/* Recommended for You — only when Ollama is available */}
      {isRecEnabled && (
        <section data-testid="recommended-section">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-ytm-accent" />
              <h2 className="text-xl font-bold">Recommended for You</h2>
            </div>
            <button
              onClick={fetchRecommendations}
              disabled={recLoading}
              className="p-2 rounded-lg hover:bg-ytm-surface transition-colors disabled:opacity-50"
              title="Refresh recommendations"
            >
              <RefreshCw className={`w-4 h-4 ${recLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Loading: shimmer skeleton cards */}
          {recLoading && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="bg-ytm-surface rounded-xl overflow-hidden animate-pulse">
                  <div className="aspect-square bg-ytm-surface-hover" />
                  <div className="p-3 space-y-2">
                    <div className="h-4 bg-ytm-surface-hover rounded w-3/4" />
                    <div className="h-3 bg-ytm-surface-hover rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Cards */}
          {!recLoading && recTracks.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {recTracks.map((track) => (
                <div
                  key={track.id}
                  onClick={() => {
                    setQueue([track]);
                    setQueueIndex(0);
                    setCurrentTrack(track);
                    setIsPlaying(true);
                  }}
                  className="bg-ytm-surface rounded-xl overflow-hidden hover:bg-ytm-surface-hover transition-colors cursor-pointer group"
                >
                  <div className="aspect-square relative overflow-hidden">
                    <img
                      src={track.thumbnail}
                      alt={track.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <div className="w-12 h-12 bg-ytm-accent rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Play className="w-5 h-5 text-black fill-black ml-0.5" />
                      </div>
                    </div>
                  </div>
                  <div className="p-3">
                    <p className="font-medium text-sm truncate">{track.title}</p>
                    <p className="text-xs text-ytm-text-secondary truncate">{track.artist}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty state (no matching library tracks) */}
          {!recLoading && recTracks.length === 0 && <div />}
        </section>
      )}

      {/* Recently Played */}
      {recentlyPlayed.length > 0 && (
        <section>
          <h2 className="text-xl font-bold mb-4">Recently Played</h2>
          <div className="space-y-1">
            {recentlyPlayed.slice(0, 10).map((track, i) => (
              <TrackCard key={track.id} track={track} index={i} showIndex />
            ))}
          </div>
        </section>
      )}

      {/* Favorites */}
      {favorites.length > 0 && (
        <section>
          <h2 className="text-xl font-bold mb-4">Your Favorites</h2>
          <div className="space-y-1">
            {favorites.slice(0, 5).map((track, i) => (
              <TrackCard key={track.id} track={track} index={i} showIndex />
            ))}
          </div>
        </section>
      )}

      {/* Empty State */}
      {recentlyPlayed.length === 0 && favorites.length === 0 && (
        <div className="text-center py-12">
          <div className="w-24 h-24 bg-ytm-surface rounded-full flex items-center justify-center mx-auto mb-4">
            <TrendingUp className="w-12 h-12 text-ytm-text-secondary" />
          </div>
          <h2 className="text-xl font-bold mb-2">Start your journey</h2>
          <p className="text-ytm-text-secondary max-w-md mx-auto">
            Search for your favorite music and start building your personal library.
            All powered by yt-dlp for free, unlimited streaming.
          </p>
        </div>
      )}
    </div>
  );
}

interface QuickActionProps {
  label: string;
  icon: React.ReactNode;
  count: number;
  color: string;
}

function QuickAction({ label, icon, count, color }: QuickActionProps) {
  return (
    <div
      className={`${color} rounded-xl p-4 flex items-center gap-4 cursor-pointer hover:opacity-90 transition-opacity`}
    >
      <div className="p-2 bg-white/20 rounded-lg">{icon}</div>
      <div>
        <p className="font-semibold">{label}</p>
        <p className="text-sm opacity-80">{count} tracks</p>
      </div>
    </div>
  );
}
