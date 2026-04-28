import { useState, useCallback } from "react";
import { useAppStore } from "../../store";
import * as api from "../../api";
import type { SmartPlaylistPlan, SmartPlaylistTrackMatch, SearchResult, Track, SmartMethod } from "../../types";
import {
  Sparkles,
  Loader2,
  Music2,
  Heart,
  Zap,
  Moon,
  Dumbbell,
  BookOpen,
  PartyPopper,
  Car,
  Disc3,
  Library,
  ArrowLeft,
  ArrowRight,
  Check,
  Search,
  Plus,
  X,
  Clock,
  ListMusic,
} from "lucide-react";
import clsx from "clsx";

// ============================================================================
// PRESETS
// ============================================================================

const PRESETS = [
  { id: "workout", label: "Workout", icon: Dumbbell, description: "High energy workout music with fast tempo and powerful beats", color: "text-red-400" },
  { id: "chill", label: "Chill & Relax", icon: Moon, description: "Relaxing chill music to unwind after a long day", color: "text-blue-400" },
  { id: "focus", label: "Deep Focus", icon: BookOpen, description: "Ambient and calm instrumental music for deep concentration and study", color: "text-purple-400" },
  { id: "party", label: "Party", icon: PartyPopper, description: "Upbeat party anthems and dance hits for a great time", color: "text-yellow-400" },
  { id: "roadtrip", label: "Road Trip", icon: Car, description: "Classic and modern road trip songs, singalong anthems", color: "text-green-400" },
  { id: "sleep", label: "Sleep", icon: Moon, description: "Gentle, slow, quiet music for falling asleep peacefully", color: "text-indigo-400" },
] as const;

const MOODS = [
  "energetic", "peaceful", "melancholic", "aggressive", "romantic",
  "dark", "happy", "mysterious", "nostalgic", "uplifting",
];

const ACTIVITIES = [
  "workout", "study", "sleep", "driving", "party",
  "cooking", "meditation", "gaming", "reading", "cleaning",
];

type WizardStep = "method" | "configure" | "preview";

export function SmartPlaylistView() {
  const { library, setView, setPlaylists, setSelectedPlaylistId, settings, ollamaAvailable } = useAppStore();

  // Wizard state
  const [step, setStep] = useState<WizardStep>("method");
  const [method, setMethod] = useState<SmartMethod | null>(null);

  // Configure state
  const [description, setDescription] = useState("");
  const [selectedMood, setSelectedMood] = useState("");
  const [selectedActivity, setSelectedActivity] = useState("");
  const [seedTrack, setSeedTrack] = useState<Track | null>(null);
  const [seedSearch, setSeedSearch] = useState("");
  const [durationMinutes, setDurationMinutes] = useState<number | undefined>();

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [plan, setPlan] = useState<SmartPlaylistPlan | null>(null);
  const [libraryMatches, setLibraryMatches] = useState<SmartPlaylistTrackMatch[]>([]);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [playlistName, setPlaylistName] = useState("");
  const [playlistDesc, setPlaylistDesc] = useState("");

  // YouTube search
  const [searchingQuery, setSearchingQuery] = useState<string | null>(null);
  const [youtubeResults, setYoutubeResults] = useState<Map<string, SearchResult[]>>(new Map());
  const [addedFromYT, setAddedFromYT] = useState<Map<string, Track>>(new Map());

  // Save state
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Error
  const [error, setError] = useState<string | null>(null);

  // ========================================================================
  // HANDLERS
  // ========================================================================

  const handleMethodSelect = useCallback((m: SmartMethod) => {
    setMethod(m);
    setStep("configure");
    setError(null);
    // Reset configure state
    setDescription("");
    setSelectedMood("");
    setSelectedActivity("");
    setSeedTrack(null);
    setDurationMinutes(undefined);
  }, []);

  const handlePresetSelect = useCallback((presetId: string) => {
    const preset = PRESETS.find(p => p.id === presetId);
    if (preset) {
      setMethod("preset");
      setDescription(preset.description);
      setPlaylistName(preset.label);
      setStep("configure");
      setError(null);
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);

    try {
      let generatedPlan: SmartPlaylistPlan;

      if (method === "seed" && seedTrack) {
        // Seed track flow
        generatedPlan = await api.smartPlaylistFromSeed(
          seedTrack.title,
          seedTrack.artist,
          seedTrack.id,
        );
      } else {
        // Description / mood / activity / preset flow
        let desc = description;
        let meth = method || "description";

        if (method === "mood") {
          desc = selectedMood;
          meth = "mood";
        } else if (method === "activity") {
          desc = selectedActivity;
          meth = "activity";
        } else if (method === "preset") {
          meth = "description";
        }

        if (!desc.trim()) {
          setError("Please provide a description.");
          setGenerating(false);
          return;
        }

        generatedPlan = await api.smartPlaylistGeneratePlan(
          desc,
          meth,
          durationMinutes,
        );
      }

      setPlan(generatedPlan);
      setPlaylistName(generatedPlan.name);
      setPlaylistDesc(generatedPlan.description);

      // Match library tracks
      const matches = await api.smartPlaylistMatchLibrary(
        generatedPlan.genres,
        generatedPlan.moods,
        generatedPlan.energy_min,
        generatedPlan.energy_max,
        generatedPlan.decades,
        generatedPlan.activities,
      );

      setLibraryMatches(matches);

      // Auto-select all matches with score > 0.5
      const autoSelected = new Set<string>(
        matches.filter(m => m.score > 0.5).map(m => m.track.id)
      );
      setSelectedTrackIds(autoSelected);

      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }, [method, description, selectedMood, selectedActivity, seedTrack, durationMinutes]);

  const handleSearchYouTube = useCallback(async (query: string) => {
    setSearchingQuery(query);
    try {
      const results = await api.searchYoutube(query, 5);
      setYoutubeResults(prev => {
        const updated = new Map(prev);
        updated.set(query, results);
        return updated;
      });
    } catch (err) {
      console.error("YouTube search failed:", err);
    } finally {
      setSearchingQuery(null);
    }
  }, []);

  const handleAddYoutubeTrack = useCallback(async (result: SearchResult) => {
    try {
      // Add track to library (ensures it exists in DB)
      const track: Track = {
        id: result.id,
        video_id: result.id,
        title: result.title,
        artist: result.artist,
        thumbnail: result.thumbnail,
        duration: result.duration,
        local_path: undefined,
        is_downloaded: false,
        is_favorite: false,
        play_count: 0,
        created_at: new Date().toISOString(),
      };

      setAddedFromYT(prev => {
        const updated = new Map(prev);
        updated.set(result.id, track);
        return updated;
      });
      setSelectedTrackIds(prev => {
        const updated = new Set(prev);
        updated.add(result.id);
        return updated;
      });
    } catch (err) {
      console.error("Failed to add track:", err);
    }
  }, []);

  const toggleTrackSelection = useCallback((trackId: string) => {
    setSelectedTrackIds(prev => {
      const updated = new Set(prev);
      if (updated.has(trackId)) {
        updated.delete(trackId);
      } else {
        updated.add(trackId);
      }
      return updated;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!playlistName.trim() || selectedTrackIds.size === 0) return;

    setSaving(true);
    try {
      // Collect YouTube tracks that need to be added to DB
      const ytTracks: [string, string, string, string][] = [];
      for (const [, track] of addedFromYT) {
        if (selectedTrackIds.has(track.video_id)) {
          ytTracks.push([track.video_id, track.title, track.artist, track.thumbnail]);
        }
      }

      // Get track IDs - for library tracks use UUID, for YT tracks use video_id
      const trackIds = Array.from(selectedTrackIds);

      const playlist = await api.smartPlaylistSave(
        playlistName,
        playlistDesc || undefined,
        trackIds,
        ytTracks,
      );

      // Update playlists list
      const playlists = await api.getPlaylists();
      setPlaylists(playlists);

      setSaved(true);

      // Navigate to the new playlist after brief delay
      setTimeout(() => {
        setSelectedPlaylistId(playlist.id);
        setView("playlist");
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [playlistName, playlistDesc, selectedTrackIds, addedFromYT, setPlaylists, setSelectedPlaylistId, setView]);

  const handleBack = useCallback(() => {
    if (step === "preview") {
      setStep("configure");
      setPlan(null);
      setLibraryMatches([]);
      setYoutubeResults(new Map());
      setAddedFromYT(new Map());
      setSelectedTrackIds(new Set());
    } else if (step === "configure") {
      setStep("method");
      setMethod(null);
    }
  }, [step]);

  // ========================================================================
  // AI not available
  // ========================================================================
  if (!settings?.ollama_enabled || !ollamaAvailable) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Sparkles className="w-16 h-16 text-ytm-text-secondary mb-4" />
        <h2 className="text-xl font-bold mb-2">AI Not Available</h2>
        <p className="text-ytm-text-secondary text-center max-w-md">
          Smart Playlists require Ollama AI to be enabled and connected.
          Go to Settings to configure Ollama.
        </p>
        <button
          onClick={() => setView("settings")}
          className="mt-4 px-4 py-2 bg-ytm-accent text-white rounded-lg hover:bg-ytm-accent-hover"
        >
          Open Settings
        </button>
      </div>
    );
  }

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        {step !== "method" && (
          <button
            onClick={handleBack}
            className="p-2 rounded-lg hover:bg-ytm-surface transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-ytm-accent" />
            Smart Playlist Generator
          </h1>
          <p className="text-ytm-text-secondary text-sm">
            Let AI create the perfect playlist for you
          </p>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-2 px-4">
        {(["method", "configure", "preview"] as WizardStep[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2 flex-1">
            <div className={clsx(
              "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors",
              step === s ? "bg-ytm-accent text-white" :
              (["method", "configure", "preview"].indexOf(step) > i) ? "bg-green-600 text-white" :
              "bg-ytm-surface text-ytm-text-secondary"
            )}>
              {(["method", "configure", "preview"].indexOf(step) > i) ? (
                <Check className="w-4 h-4" />
              ) : i + 1}
            </div>
            <span className={clsx(
              "text-sm hidden sm:block",
              step === s ? "text-white font-medium" : "text-ytm-text-secondary"
            )}>
              {s === "method" ? "Choose Method" : s === "configure" ? "Configure" : "Preview & Save"}
            </span>
            {i < 2 && <div className="flex-1 h-px bg-ytm-border" />}
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm flex items-center gap-2">
          <X className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* ================================================================== */}
      {/* STEP 1: METHOD SELECTION */}
      {/* ================================================================== */}
      {step === "method" && (
        <div className="space-y-6">
          {/* Main Methods */}
          <div>
            <h2 className="text-lg font-semibold mb-3">How would you like to create your playlist?</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <MethodCard
                icon={Sparkles}
                label="Describe It"
                description="Tell AI what you want"
                color="text-ytm-accent"
                onClick={() => handleMethodSelect("description")}
              />
              <MethodCard
                icon={Heart}
                label="By Mood"
                description="Select a mood/feeling"
                color="text-pink-400"
                onClick={() => handleMethodSelect("mood")}
              />
              <MethodCard
                icon={Zap}
                label="By Activity"
                description="For what you're doing"
                color="text-yellow-400"
                onClick={() => handleMethodSelect("activity")}
              />
              <MethodCard
                icon={Disc3}
                label="More Like This"
                description="Seed from a track"
                color="text-green-400"
                onClick={() => handleMethodSelect("seed")}
              />
              <MethodCard
                icon={Library}
                label="From Library"
                description="Filter your tracks"
                color="text-blue-400"
                onClick={() => handleMethodSelect("library")}
              />
            </div>
          </div>

          {/* Quick Presets */}
          <div>
            <h2 className="text-lg font-semibold mb-3">Quick Presets</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {PRESETS.map(preset => {
                const Icon = preset.icon;
                return (
                  <button
                    key={preset.id}
                    onClick={() => handlePresetSelect(preset.id)}
                    className="flex items-center gap-3 p-3 bg-ytm-surface rounded-xl hover:bg-ytm-surface-hover transition-colors text-left group"
                  >
                    <div className={clsx("p-2 rounded-lg bg-ytm-bg", preset.color)}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{preset.label}</p>
                      <p className="text-xs text-ytm-text-secondary truncate">{preset.description.slice(0, 40)}...</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* STEP 2: CONFIGURE */}
      {/* ================================================================== */}
      {step === "configure" && (
        <div className="space-y-6">
          <div className="bg-ytm-surface rounded-xl p-5 space-y-5">
            {/* Description input */}
            {(method === "description" || method === "preset") && (
              <div>
                <label className="block text-sm font-medium mb-2">
                  {method === "preset" ? "Preset Description (edit if you want)" : "Describe your ideal playlist"}
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g., 'upbeat classic rock anthems for a road trip' or 'calm piano music for studying late at night'"
                  rows={3}
                  className="w-full px-4 py-3 bg-ytm-bg border border-ytm-border rounded-lg focus:outline-none focus:border-ytm-accent resize-none text-sm"
                  autoFocus
                />
              </div>
            )}

            {/* Mood selector */}
            {method === "mood" && (
              <div>
                <label className="block text-sm font-medium mb-2">Select a mood</label>
                <div className="flex flex-wrap gap-2">
                  {MOODS.map(mood => (
                    <button
                      key={mood}
                      onClick={() => setSelectedMood(mood)}
                      className={clsx(
                        "px-4 py-2 rounded-full text-sm font-medium transition-colors",
                        selectedMood === mood
                          ? "bg-ytm-accent text-white"
                          : "bg-ytm-bg border border-ytm-border hover:border-ytm-accent"
                      )}
                    >
                      {mood}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Activity selector */}
            {method === "activity" && (
              <div>
                <label className="block text-sm font-medium mb-2">Select an activity</label>
                <div className="flex flex-wrap gap-2">
                  {ACTIVITIES.map(activity => (
                    <button
                      key={activity}
                      onClick={() => setSelectedActivity(activity)}
                      className={clsx(
                        "px-4 py-2 rounded-full text-sm font-medium transition-colors",
                        selectedActivity === activity
                          ? "bg-ytm-accent text-white"
                          : "bg-ytm-bg border border-ytm-border hover:border-ytm-accent"
                      )}
                    >
                      {activity}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Seed track selector */}
            {method === "seed" && (
              <div>
                <label className="block text-sm font-medium mb-2">Choose a seed track from your library</label>
                {!seedTrack ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={seedSearch}
                      onChange={(e) => setSeedSearch(e.target.value)}
                      placeholder="Search your library..."
                      className="w-full px-4 py-2 bg-ytm-bg border border-ytm-border rounded-lg focus:outline-none focus:border-ytm-accent text-sm"
                      autoFocus
                    />
                    <div className="max-h-60 overflow-y-auto space-y-1">
                      {library
                        .filter(t =>
                          !seedSearch ||
                          t.title.toLowerCase().includes(seedSearch.toLowerCase()) ||
                          t.artist.toLowerCase().includes(seedSearch.toLowerCase())
                        )
                        .slice(0, 20)
                        .map(track => (
                          <button
                            key={track.id}
                            onClick={() => setSeedTrack(track)}
                            className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-ytm-bg text-left text-sm"
                          >
                            <img src={track.thumbnail} alt="" className="w-10 h-10 rounded object-cover" />
                            <div className="min-w-0 flex-1">
                              <p className="font-medium truncate">{track.title}</p>
                              <p className="text-xs text-ytm-text-secondary truncate">{track.artist}</p>
                            </div>
                          </button>
                        ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-3 bg-ytm-bg rounded-lg">
                    <img src={seedTrack.thumbnail} alt="" className="w-12 h-12 rounded object-cover" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{seedTrack.title}</p>
                      <p className="text-sm text-ytm-text-secondary truncate">{seedTrack.artist}</p>
                    </div>
                    <button
                      onClick={() => setSeedTrack(null)}
                      className="p-1.5 rounded-full hover:bg-ytm-surface"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Library filter method */}
            {method === "library" && (
              <div>
                <label className="block text-sm font-medium mb-2">
                  Describe what kind of tracks from your library you want
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g., 'energetic rock songs from the 80s and 90s' or 'calm instrumental tracks for meditation'"
                  rows={3}
                  className="w-full px-4 py-3 bg-ytm-bg border border-ytm-border rounded-lg focus:outline-none focus:border-ytm-accent resize-none text-sm"
                  autoFocus
                />
              </div>
            )}

            {/* Duration target (for all methods) */}
            {method !== "seed" && (
              <div>
                <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Target Duration (optional)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={durationMinutes || ""}
                    onChange={(e) => setDurationMinutes(e.target.value ? Number(e.target.value) : undefined)}
                    placeholder="30"
                    min={5}
                    max={300}
                    className="w-24 px-3 py-2 bg-ytm-bg border border-ytm-border rounded-lg focus:outline-none focus:border-ytm-accent text-sm text-center"
                  />
                  <span className="text-sm text-ytm-text-secondary">minutes</span>
                  {[15, 30, 60, 120].map(d => (
                    <button
                      key={d}
                      onClick={() => setDurationMinutes(d)}
                      className={clsx(
                        "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                        durationMinutes === d
                          ? "bg-ytm-accent text-white"
                          : "bg-ytm-bg border border-ytm-border hover:border-ytm-accent"
                      )}
                    >
                      {d}min
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Generate Button */}
          <div className="flex justify-end">
            <button
              onClick={handleGenerate}
              disabled={generating || (
                method === "mood" ? !selectedMood :
                method === "activity" ? !selectedActivity :
                method === "seed" ? !seedTrack :
                !description.trim()
              )}
              className="flex items-center gap-2 px-6 py-3 bg-ytm-accent text-white rounded-xl font-medium hover:bg-ytm-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  AI is generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  Generate Playlist
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* STEP 3: PREVIEW & SAVE */}
      {/* ================================================================== */}
      {step === "preview" && plan && (
        <div className="space-y-6">
          {/* Plan Summary */}
          <div className="bg-ytm-surface rounded-xl p-5 space-y-3">
            <div>
              <label className="text-xs font-medium text-ytm-text-secondary uppercase tracking-wider">Playlist Name</label>
              <input
                type="text"
                value={playlistName}
                onChange={(e) => setPlaylistName(e.target.value)}
                className="w-full mt-1 px-3 py-2 bg-ytm-bg border border-ytm-border rounded-lg focus:outline-none focus:border-ytm-accent text-lg font-semibold"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-ytm-text-secondary uppercase tracking-wider">Description</label>
              <input
                type="text"
                value={playlistDesc}
                onChange={(e) => setPlaylistDesc(e.target.value)}
                className="w-full mt-1 px-3 py-2 bg-ytm-bg border border-ytm-border rounded-lg focus:outline-none focus:border-ytm-accent text-sm"
              />
            </div>

            {/* Criteria Tags */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {plan.genres.map(g => (
                <span key={g} className="px-2 py-0.5 rounded-full text-xs bg-blue-500/20 text-blue-300">{g}</span>
              ))}
              {plan.moods.map(m => (
                <span key={m} className="px-2 py-0.5 rounded-full text-xs bg-purple-500/20 text-purple-300">{m}</span>
              ))}
              {plan.decades.map(d => (
                <span key={d} className="px-2 py-0.5 rounded-full text-xs bg-green-500/20 text-green-300">{d}</span>
              ))}
              {plan.tempo && (
                <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-500/20 text-yellow-300">{plan.tempo} tempo</span>
              )}
              <span className="px-2 py-0.5 rounded-full text-xs bg-red-500/20 text-red-300">
                Energy: {plan.energy_min}-{plan.energy_max}
              </span>
            </div>
          </div>

          {/* Library Matches */}
          <div className="bg-ytm-surface rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Library className="w-4 h-4 text-blue-400" />
                From Your Library
                <span className="text-xs text-ytm-text-secondary font-normal">
                  ({libraryMatches.length} matches)
                </span>
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedTrackIds(new Set(libraryMatches.map(m => m.track.id)))}
                  className="text-xs text-ytm-accent hover:underline"
                >
                  Select All
                </button>
                <span className="text-ytm-border">|</span>
                <button
                  onClick={() => {
                    const ytIds = new Set(Array.from(addedFromYT.keys()));
                    setSelectedTrackIds(ytIds);
                  }}
                  className="text-xs text-ytm-text-secondary hover:underline"
                >
                  Deselect All
                </button>
              </div>
            </div>

            {libraryMatches.length === 0 ? (
              <p className="text-sm text-ytm-text-secondary py-4 text-center">
                No matching tracks in your library. Try searching YouTube below!
              </p>
            ) : (
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {libraryMatches.map((match) => (
                  <div
                    key={match.track.id}
                    onClick={() => toggleTrackSelection(match.track.id)}
                    className={clsx(
                      "flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors",
                      selectedTrackIds.has(match.track.id)
                        ? "bg-ytm-accent/10 border border-ytm-accent/30"
                        : "hover:bg-ytm-bg"
                    )}
                  >
                    <div className={clsx(
                      "w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                      selectedTrackIds.has(match.track.id)
                        ? "bg-ytm-accent border-ytm-accent"
                        : "border-ytm-border"
                    )}>
                      {selectedTrackIds.has(match.track.id) && (
                        <Check className="w-3 h-3 text-white" />
                      )}
                    </div>
                    <img src={match.track.thumbnail} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{match.track.title}</p>
                      <p className="text-xs text-ytm-text-secondary truncate">{match.track.artist}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {match.genre && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-ytm-bg text-ytm-text-secondary">{match.genre}</span>
                      )}
                      {match.mood && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-ytm-bg text-ytm-text-secondary">{match.mood}</span>
                      )}
                      <span className={clsx(
                        "px-1.5 py-0.5 rounded text-[10px] font-medium",
                        match.score >= 0.75 ? "bg-green-500/20 text-green-300" :
                        match.score >= 0.5 ? "bg-yellow-500/20 text-yellow-300" :
                        "bg-red-500/20 text-red-300"
                      )}>
                        {Math.round(match.score * 100)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* YouTube Added Tracks */}
          {addedFromYT.size > 0 && (
            <div className="bg-ytm-surface rounded-xl p-5">
              <h3 className="font-semibold flex items-center gap-2 mb-3">
                <Music2 className="w-4 h-4 text-red-400" />
                Added from YouTube
                <span className="text-xs text-ytm-text-secondary font-normal">
                  ({addedFromYT.size} tracks)
                </span>
              </h3>
              <div className="space-y-1">
                {Array.from(addedFromYT.values()).map(track => (
                  <div
                    key={track.video_id}
                    className="flex items-center gap-3 p-2 rounded-lg bg-ytm-accent/10 border border-ytm-accent/30"
                  >
                    <div className="w-5 h-5 rounded border-2 bg-ytm-accent border-ytm-accent flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                    <img src={track.thumbnail} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{track.title}</p>
                      <p className="text-xs text-ytm-text-secondary truncate">{track.artist}</p>
                    </div>
                    <button
                      onClick={() => {
                        setAddedFromYT(prev => {
                          const updated = new Map(prev);
                          updated.delete(track.video_id);
                          return updated;
                        });
                        setSelectedTrackIds(prev => {
                          const updated = new Set(prev);
                          updated.delete(track.video_id);
                          return updated;
                        });
                      }}
                      className="p-1 rounded-full hover:bg-ytm-surface text-ytm-text-secondary"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* YouTube Search Suggestions */}
          <div className="bg-ytm-surface rounded-xl p-5">
            <h3 className="font-semibold flex items-center gap-2 mb-3">
              <Search className="w-4 h-4 text-ytm-accent" />
              Search YouTube for More
            </h3>
            <div className="space-y-3">
              {plan.search_queries.map((query, idx) => (
                <div key={idx} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-sm text-ytm-text-secondary truncate">
                      "{query}"
                    </span>
                    <button
                      onClick={() => handleSearchYouTube(query)}
                      disabled={searchingQuery === query}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-ytm-bg border border-ytm-border rounded-lg hover:border-ytm-accent transition-colors disabled:opacity-50"
                    >
                      {searchingQuery === query ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Search className="w-3 h-3" />
                      )}
                      Search
                    </button>
                  </div>

                  {/* Results */}
                  {youtubeResults.has(query) && (
                    <div className="pl-4 space-y-1">
                      {youtubeResults.get(query)!.map(result => (
                        <div
                          key={result.id}
                          className="flex items-center gap-2 p-1.5 rounded hover:bg-ytm-bg text-sm"
                        >
                          <img src={result.thumbnail} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium truncate">{result.title}</p>
                            <p className="text-[10px] text-ytm-text-secondary">{result.artist}</p>
                          </div>
                          {addedFromYT.has(result.id) ? (
                            <span className="text-xs text-green-400 flex items-center gap-1">
                              <Check className="w-3 h-3" /> Added
                            </span>
                          ) : (
                            <button
                              onClick={() => handleAddYoutubeTrack(result)}
                              className="flex items-center gap-1 px-2 py-1 text-xs bg-ytm-accent/10 text-ytm-accent rounded hover:bg-ytm-accent/20"
                            >
                              <Plus className="w-3 h-3" /> Add
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Save Section */}
          <div className="bg-ytm-surface rounded-xl p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold flex items-center gap-2">
                  <ListMusic className="w-4 h-4" />
                  {selectedTrackIds.size} tracks selected
                </p>
                <p className="text-xs text-ytm-text-secondary mt-1">
                  Will be saved as a new playlist
                </p>
              </div>
              <button
                onClick={handleSave}
                disabled={saving || saved || selectedTrackIds.size === 0 || !playlistName.trim()}
                className={clsx(
                  "flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition-colors",
                  saved
                    ? "bg-green-600 text-white"
                    : "bg-ytm-accent text-white hover:bg-ytm-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {saving ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Saving...
                  </>
                ) : saved ? (
                  <>
                    <Check className="w-5 h-5" />
                    Saved! Opening...
                  </>
                ) : (
                  <>
                    <ListMusic className="w-5 h-5" />
                    Save as Playlist
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface MethodCardProps {
  icon: typeof Sparkles;
  label: string;
  description: string;
  color: string;
  onClick: () => void;
}

function MethodCard({ icon: Icon, label, description, color, onClick }: MethodCardProps) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 p-5 bg-ytm-surface rounded-xl hover:bg-ytm-surface-hover transition-colors group text-center"
    >
      <div className={clsx("p-3 rounded-xl bg-ytm-bg group-hover:scale-110 transition-transform", color)}>
        <Icon className="w-6 h-6" />
      </div>
      <p className="font-semibold text-sm">{label}</p>
      <p className="text-xs text-ytm-text-secondary">{description}</p>
    </button>
  );
}
