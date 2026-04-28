import { useState, useCallback, useMemo } from "react";
import { useAppStore } from "../store";
import * as api from "../api";
import type { SmartPlaylistPlan, SmartPlaylistTrackMatch, Track } from "../types";
import {
  Sparkles,
  Loader2,
  Play,
  Save,
  X,
  Music2,
  Clock,
  Zap,
  Wand2,
  Share2,
  RefreshCw,
  Check,
} from "lucide-react";
import clsx from "clsx";

interface GeneratedPlaylist {
  plan: SmartPlaylistPlan;
  libraryMatches: SmartPlaylistTrackMatch[];
  youtubeResults: Track[];
  coverUrl?: string;
}

const EXAMPLE_PROMPTS = [
  "workout energic de 45 minute",
  "muzică chill pentru citit",
  "rock clasic de condus",
  "ceva melancolic pentru seară",
  "party cu prietenii",
];

// Mood-based color schemes
const MOOD_COLORS: Record<string, { from: string; via: string; to: string; icon: string }> = {
  energetic: { from: "from-red-500", via: "via-orange-500", to: "to-yellow-500", icon: "text-red-400" },
  aggressive: { from: "from-red-600", via: "via-red-500", to: "to-orange-600", icon: "text-red-500" },
  peaceful: { from: "from-blue-400", via: "via-cyan-400", to: "to-teal-400", icon: "text-blue-400" },
  chill: { from: "from-blue-500", via: "via-indigo-500", to: "to-purple-500", icon: "text-blue-400" },
  melancholic: { from: "from-slate-600", via: "via-purple-600", to: "to-indigo-700", icon: "text-purple-400" },
  romantic: { from: "from-pink-500", via: "via-rose-500", to: "to-red-400", icon: "text-pink-400" },
  happy: { from: "from-yellow-400", via: "via-orange-400", to: "to-pink-400", icon: "text-yellow-400" },
  dark: { from: "from-slate-800", via: "via-gray-700", to: "to-zinc-800", icon: "text-gray-400" },
  mysterious: { from: "from-indigo-600", via: "via-purple-600", to: "to-violet-700", icon: "text-indigo-400" },
  nostalgic: { from: "from-amber-600", via: "via-orange-500", to: "to-yellow-600", icon: "text-amber-400" },
};

// Get color scheme based on plan
function getMoodColors(plan: SmartPlaylistPlan): { from: string; via: string; to: string; icon: string } {
  // Check moods first
  for (const mood of plan.moods) {
    const lower = mood.toLowerCase();
    if (MOOD_COLORS[lower]) return MOOD_COLORS[lower];
  }
  
  // Check energy level
  const avgEnergy = ((plan.energy_min || 5) + (plan.energy_max || 5)) / 2;
  if (avgEnergy >= 7) return MOOD_COLORS.energetic;
  if (avgEnergy <= 4) return MOOD_COLORS.peaceful;
  
  // Check genres
  const genreMoodMap: Record<string, keyof typeof MOOD_COLORS> = {
    metal: "aggressive",
    rock: "energetic",
    jazz: "chill",
    classical: "peaceful",
    ambient: "peaceful",
    electronic: "energetic",
    pop: "happy",
    blues: "melancholic",
  };
  
  for (const genre of plan.genres) {
    const lower = genre.toLowerCase();
    for (const [key, mood] of Object.entries(genreMoodMap)) {
      if (lower.includes(key)) return MOOD_COLORS[mood];
    }
  }
  
  // Default
  return { from: "from-purple-500", via: "via-ytm-accent", to: "to-pink-500", icon: "text-ytm-accent" };
}

// Confetti component
function Confetti({ active }: { active: boolean }) {
  if (!active) return null;
  
  const colors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
  
  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {Array.from({ length: 50 }).map((_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.5;
        const duration = 1 + Math.random();
        const color = colors[Math.floor(Math.random() * colors.length)];
        
        return (
          <div
            key={i}
            className="absolute w-2 h-2 rounded-full animate-confetti"
            style={{
              left: `${left}%`,
              top: '-10px',
              backgroundColor: color,
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s`,
              transform: `rotate(${Math.random() * 360}deg)`,
            }}
          />
        );
      })}
    </div>
  );
}

// Share card component
function ShareCard({ playlist, onClose }: { playlist: GeneratedPlaylist; onClose: () => void }) {
  const shareText = useMemo(() => {
    const total = playlist.libraryMatches.length + playlist.youtubeResults.length;
    return `🎵 ${playlist.plan.name}\n📝 ${playlist.plan.description}\n⏱️ ~${Math.round(total * 3.5)} min • ${total} tracks\n🏷️ ${playlist.plan.genres.slice(0, 3).join(', ')}`;
  }, [playlist]);

  const handleCopy = () => {
    navigator.clipboard.writeText(shareText);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-ytm-surface rounded-2xl p-6 max-w-sm w-full animate-in zoom-in-95 duration-200">
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
          <Share2 className="w-5 h-5 text-ytm-accent" />
          Share Playlist
        </h3>
        
        <div className="bg-ytm-bg rounded-xl p-4 mb-4 font-mono text-sm whitespace-pre-wrap">
          {shareText}
        </div>
        
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="flex-1 px-4 py-2 bg-ytm-accent text-black font-medium rounded-xl hover:bg-ytm-accent/90 transition-colors"
          >
            Copy to Clipboard
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-ytm-surface hover:bg-ytm-surface-hover rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function QuickSmartPlaylist() {
  const {
    setView,
    setPlaylists,
    setSelectedPlaylistId,
    addPlaylist,
    setQueue,
    setQueueIndex,
    setCurrentTrack,
    setIsPlaying,
    settings,
    ollamaAvailable,
  } = useAppStore();

  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedPlaylist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [previewTrack, setPreviewTrack] = useState<Track | null>(null);

  const isEnabled = settings?.ollama_enabled && ollamaAvailable;

  // Get mood colors for generated playlist
  const moodColors = useMemo(() => {
    if (!generated) return { from: "from-purple-500", via: "via-ytm-accent", to: "to-pink-500", icon: "text-ytm-accent" };
    return getMoodColors(generated.plan);
  }, [generated]);

  const generatePlaylist = useCallback(async () => {
    if (!input.trim() || isGenerating) return;

    setIsGenerating(true);
    setError(null);
    setGenerated(null);
    setShowConfetti(false);

    try {
      // Step 1: Generate plan with AI
      const plan = await api.smartPlaylistGeneratePlan(
        input.trim(),
        "description",
        undefined,
        settings?.ollama_model
      );

      // Step 2: Match against library
      const libraryMatches = await api.smartPlaylistMatchLibrary(
        plan.genres,
        plan.moods,
        plan.energy_min || 1,
        plan.energy_max || 10,
        plan.decades,
        plan.activities,
        30
      );

      // Step 3: Search YouTube for additional tracks
      const youtubeResults: Track[] = [];
      const searchQueries = plan.search_queries?.slice(0, 3) || [];
      
      for (const query of searchQueries) {
        try {
          const results = await api.searchYoutube(query, 2);
          for (const result of results) {
            const trackInfo = await api.getTrackInfo(result.id);
            youtubeResults.push({
              id: `yt_${result.id}`,
              video_id: result.id,
              title: result.title,
              artist: result.artist,
              thumbnail: result.thumbnail,
              duration: trackInfo.duration,
              is_downloaded: false,
              is_favorite: false,
              play_count: 0,
              created_at: new Date().toISOString(),
            });
          }
        } catch {
          // Ignore search failures
        }
      }

      // Step 4: Generate cover idea (fire and forget)
      api.smartPlaylistCoverIdea(
        [...libraryMatches.map(m => m.track.id), ...youtubeResults.map(t => t.id)]
      ).catch(() => {});

      setGenerated({
        plan,
        libraryMatches,
        youtubeResults,
      });

    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate playlist");
    } finally {
      setIsGenerating(false);
    }
  }, [input, isGenerating, settings?.ollama_model]);

  // Generate "more like this" variation
  const generateVariation = useCallback(async () => {
    if (!generated) return;
    
    const variations = [
      `More ${generated.plan.moods[0] || "energetic"} music`,
      `Similar to ${generated.plan.name}`,
      `${generated.plan.genres[0] || "Rock"} from ${generated.plan.decades[0] || "different era"}`,
    ];
    const randomVariation = variations[Math.floor(Math.random() * variations.length)];
    
    setInput(randomVariation);
    setTimeout(() => generatePlaylist(), 100);
  }, [generated, generatePlaylist]);

  const handleSave = useCallback(async () => {
    if (!generated) return;

    setSaving(true);
    try {
      const trackIds = generated.libraryMatches.map(m => m.track.id);
      const youtubeTracks: [string, string, string, string][] = generated.youtubeResults.map(t => [
        t.video_id,
        t.title,
        t.artist,
        t.thumbnail,
      ]);

      const playlist = await api.smartPlaylistSave(
        generated.plan.name,
        generated.plan.description,
        trackIds,
        youtubeTracks
      );

      addPlaylist(playlist);
      setPlaylists([...useAppStore.getState().playlists, playlist]);
      
      // Show confetti on success
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3000);
      
      // Open the playlist
      setSelectedPlaylistId(playlist.id);
      setView("playlist");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save playlist");
    } finally {
      setSaving(false);
    }
  }, [generated, addPlaylist, setPlaylists, setSelectedPlaylistId, setView]);

  const handlePlayNow = useCallback(() => {
    if (!generated) return;

    const allTracks = [
      ...generated.libraryMatches.map(m => m.track),
      ...generated.youtubeResults,
    ];

    if (allTracks.length > 0) {
      setQueue(allTracks);
      setQueueIndex(0);
      setCurrentTrack(allTracks[0]);
      setIsPlaying(true);
    }
  }, [generated, setQueue, setQueueIndex, setCurrentTrack, setIsPlaying]);

  const handleReset = useCallback(() => {
    setGenerated(null);
    setInput("");
    setError(null);
    setShowConfetti(false);
    setPreviewTrack(null);
  }, []);

  if (!isEnabled) {
    return (
      <div className="bg-ytm-surface/50 rounded-xl p-4 border border-ytm-border/50">
        <div className="flex items-center gap-2 text-ytm-text-secondary">
          <Sparkles className="w-4 h-4" />
          <span className="text-sm">Enable Ollama in Settings for AI playlists</span>
        </div>
      </div>
    );
  }

  // Show generated playlist preview
  if (generated) {
    const totalTracks = generated.libraryMatches.length + generated.youtubeResults.length;
    const estimatedMinutes = Math.round(totalTracks * 3.5);

    return (
      <>
        <Confetti active={showConfetti} />
        {showShare && <ShareCard playlist={generated} onClose={() => setShowShare(false)} />}
        
        <div className="bg-gradient-to-br from-purple-600/20 to-ytm-accent/10 rounded-2xl p-6 border border-ytm-border animate-in fade-in slide-in-from-bottom-4 duration-300">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-5 h-5 text-ytm-accent" />
                <span className="text-xs font-medium text-ytm-accent uppercase tracking-wide">
                  AI Generated
                </span>
              </div>
              <h3 className="text-xl font-bold truncate">{generated.plan.name}</h3>
              <p className="text-sm text-ytm-text-secondary line-clamp-2">
                {generated.plan.description}
              </p>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setShowShare(true)}
                className="p-2 hover:bg-ytm-surface rounded-lg transition-colors"
                title="Share"
              >
                <Share2 className="w-4 h-4" />
              </button>
              <button
                onClick={handleReset}
                className="p-2 hover:bg-ytm-surface rounded-lg transition-colors"
                title="New"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Dynamic Mood-Based Cover */}
          <div className={clsx(
            "aspect-video rounded-xl mb-4 relative overflow-hidden group bg-gradient-to-br",
            moodColors.from, moodColors.via, moodColors.to
          )}>
            {/* Animated background pattern */}
            <div className="absolute inset-0 opacity-30">
              <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-white/20 rounded-full blur-3xl animate-pulse" />
              <div className="absolute bottom-1/3 right-1/4 w-40 h-40 bg-white/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
            </div>
            
            <div className="absolute inset-0 flex items-center justify-center">
              <Music2 className={clsx("w-16 h-16 opacity-50", moodColors.icon)} />
            </div>
            <div className="absolute inset-0 bg-black/20" />
            <div className="absolute bottom-3 left-3 right-3">
              <div className="flex items-center gap-3 text-white/90 text-sm">
                <span className="flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  ~{estimatedMinutes} min
                </span>
                <span className="flex items-center gap-1">
                  <Music2 className="w-4 h-4" />
                  {totalTracks} tracks
                </span>
              </div>
            </div>
            
            {generated.plan.energy_min && (
              <div className="absolute top-3 right-3">
                <div className="flex items-center gap-1 bg-black/40 backdrop-blur-sm px-2 py-1 rounded-full">
                  <Zap className={clsx("w-3 h-3", moodColors.icon)} />
                  <span className="text-xs text-white font-medium">
                    {generated.plan.energy_min}-{generated.plan.energy_max}/10
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Tags */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {generated.plan.genres.slice(0, 3).map(g => (
              <span key={g} className="px-2 py-0.5 bg-ytm-bg rounded-full text-xs text-ytm-text-secondary">
                {g}
              </span>
            ))}
            {generated.plan.moods.slice(0, 2).map(m => (
              <span key={m} className={clsx(
                "px-2 py-0.5 rounded-full text-xs",
                moodColors.icon.replace("text-", "bg-").replace("-400", "-500/20") + " " + moodColors.icon
              )}>
                {m}
              </span>
            ))}
            {generated.plan.decades.slice(0, 2).map(d => (
              <span key={d} className="px-2 py-0.5 bg-ytm-bg rounded-full text-xs text-ytm-text-secondary">
                {d}
              </span>
            ))}
          </div>

          {/* Track Preview with hover */}
          <div className="bg-ytm-bg/50 rounded-lg p-3 mb-4">
            <p className="text-xs text-ytm-text-secondary mb-2">
              Matched {generated.libraryMatches.length} from library &bull; Found {generated.youtubeResults.length} new tracks
            </p>
            <div className="flex -space-x-2 overflow-x-auto pb-2">
              {generated.libraryMatches.slice(0, 8).map((m, i) => (
                <div
                  key={m.track.id}
                  className="relative group cursor-pointer"
                  style={{ zIndex: 8 - i }}
                  onMouseEnter={() => setPreviewTrack(m.track)}
                  onMouseLeave={() => setPreviewTrack(null)}
                >
                  <img
                    src={m.track.thumbnail}
                    alt=""
                    className="w-10 h-10 rounded-full border-2 border-ytm-surface object-cover transition-transform group-hover:scale-110"
                  />
                  {previewTrack?.id === m.track.id && (
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-ytm-surface px-2 py-1 rounded text-xs whitespace-nowrap z-20">
                      {m.track.title}
                    </div>
                  )}
                </div>
              ))}
              {totalTracks > 8 && (
                <div className="w-10 h-10 rounded-full border-2 border-ytm-surface bg-ytm-surface flex items-center justify-center text-xs font-medium">
                  +{totalTracks - 8}
                </div>
              )}
            </div>
          </div>

          {/* Smart Actions */}
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={generateVariation}
              disabled={isGenerating}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-ytm-surface hover:bg-ytm-surface-hover rounded-full text-xs transition-colors disabled:opacity-50"
            >
              <RefreshCw className={clsx("w-3 h-3", isGenerating && "animate-spin")} />
              More like this
            </button>
          </div>

          {/* Main Actions */}
          <div className="flex gap-2">
            <button
              onClick={handlePlayNow}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-ytm-accent text-black font-medium rounded-xl hover:bg-ytm-accent/90 transition-colors"
            >
              <Play className="w-4 h-4 fill-black" />
              Play Now
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-ytm-surface hover:bg-ytm-surface-hover rounded-xl transition-colors disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : showConfetti ? (
                <Check className="w-4 h-4 text-green-400" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {showConfetti ? "Saved!" : "Save"}
            </button>
          </div>
        </div>
      </>
    );
  }

  // Input form
  return (
    <div className="bg-ytm-surface rounded-2xl p-6 border border-ytm-border">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-ytm-accent flex items-center justify-center animate-pulse">
          <Wand2 className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className="font-bold">Create Smart Playlist</h3>
          <p className="text-sm text-ytm-text-secondary">
            Describe what you want, AI finds the perfect tracks
          </p>
        </div>
      </div>

      {/* Input */}
      <div className="relative mb-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && generatePlaylist()}
          placeholder="e.g., workout energic de 45 minute..."
          disabled={isGenerating}
          className="w-full bg-ytm-bg border border-ytm-border rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:border-ytm-accent focus:ring-2 focus:ring-ytm-accent/20 placeholder:text-ytm-text-secondary/50 disabled:opacity-50 transition-all"
        />
        <button
          onClick={generatePlaylist}
          disabled={!input.trim() || isGenerating}
          className={clsx(
            "absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-all duration-200",
            input.trim() && !isGenerating
              ? "bg-ytm-accent text-black hover:bg-ytm-accent/90 hover:scale-105"
              : "bg-ytm-surface text-ytm-text-secondary"
          )}
        >
          {isGenerating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Example prompts */}
      <div className="flex flex-wrap gap-2 mb-4">
        {EXAMPLE_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            onClick={() => setInput(prompt)}
            disabled={isGenerating}
            className="px-3 py-1.5 bg-ytm-bg hover:bg-ytm-surface-hover rounded-full text-xs text-ytm-text-secondary hover:text-white transition-colors disabled:opacity-50 border border-transparent hover:border-ytm-accent/30"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2 flex items-center gap-2">
          <X className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* Loading state with animated bars */}
      {isGenerating && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-3 text-sm text-ytm-text-secondary">
            <div className="flex gap-1">
              <div className="w-2 h-2 bg-ytm-accent rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="w-2 h-2 bg-ytm-accent rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="w-2 h-2 bg-ytm-accent rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
            <span className="animate-pulse">AI is curating your perfect playlist...</span>
          </div>
          
          {/* Progress bars simulation */}
          <div className="space-y-2">
            <div className="h-1 bg-ytm-bg rounded-full overflow-hidden">
              <div className="h-full bg-ytm-accent rounded-full animate-[shimmer_1.5s_infinite]" style={{ width: "60%" }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
