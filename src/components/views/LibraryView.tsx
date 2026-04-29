import { useEffect, useState, useMemo } from "react";
import { useAppStore } from "../../store";
import * as api from "../../api";
import { TrackCard } from "../TrackCard";
import { Library, Loader2, Filter, X, Sparkles } from "lucide-react";
import type { TrackMetadataDB } from "../../types";
import { listen } from "@tauri-apps/api/event";
import clsx from "clsx";

interface Filters {
  genre: string;
  mood: string;
  energyMin: number;
  energyMax: number;
  decade: string;
}

export function LibraryView() {
  const { library, setLibrary, settings } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [metadata, setMetadata] = useState<Map<string, TrackMetadataDB>>(new Map());
  const [filters, setFilters] = useState<Filters>({
    genre: "",
    mood: "",
    energyMin: 1,
    energyMax: 10,
    decade: "",
  });
  const [showFilters, setShowFilters] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [tagProgress, setTagProgress] = useState<{ current: number; total: number; title?: string } | null>(null);

  useEffect(() => {
    async function loadLibrary() {
      try {
        const tracks = await api.getLibrary();
        setLibrary(tracks);
        
        // Load metadata for tracks (only if AI tagging enabled)
        if (settings?.auto_tagging_enabled) {
          const metadataMap = new Map<string, TrackMetadataDB>();
          const batchSize = 10;
          for (let i = 0; i < tracks.length; i += batchSize) {
            const batch = tracks.slice(i, i + batchSize);
            const results = await Promise.allSettled(
              batch.map(t => api.ollamaGetTrackMetadata(t.id).then(m => ({ id: t.id, meta: m })))
            );
            for (const result of results) {
              if (result.status === 'fulfilled' && result.value.meta) {
                metadataMap.set(result.value.id, result.value.meta);
              }
            }
          }
          setMetadata(metadataMap);
        }
      } catch (error) {
        console.error("Failed to load library:", error);
      } finally {
        setLoading(false);
      }
    }
    loadLibrary();
  }, [setLibrary, settings?.auto_tagging_enabled]);

  // Listen for tagging progress events
  useEffect(() => {
    const unlistenProgress = listen<{ current: number; total: number; title: string }>("ai-tagging-progress", (event) => {
      setTagProgress(event.payload);
    });
    const unlistenComplete = listen<{ analyzed: number; errors: number }>("ai-tagging-complete", async (_event) => {
      setTagging(false);
      setTagProgress(null);
      // Reload metadata after tagging (batched)
      const metadataMap = new Map<string, TrackMetadataDB>();
      const batchSize = 10;
      for (let i = 0; i < library.length; i += batchSize) {
        const batch = library.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(t => api.ollamaGetTrackMetadata(t.id).then(m => ({ id: t.id, meta: m })))
        );
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value.meta) {
            metadataMap.set(result.value.id, result.value.meta);
          }
        }
      }
      setMetadata(metadataMap);
    });
    return () => {
      unlistenProgress.then(fn => fn());
      unlistenComplete.then(fn => fn());
    };
  }, [library]);

  const handleTagAll = async () => {
    if (tagging) return;
    setTagging(true);
    setTagProgress({ current: 0, total: library.length });
    try {
      const untaggedIds = library
        .filter(t => !metadata.has(t.id))
        .map(t => t.video_id);
      if (untaggedIds.length === 0) {
        setTagging(false);
        setTagProgress(null);
        return;
      }
      await api.ollamaBatchAnalyzeTracks(untaggedIds);
    } catch (error) {
      console.error("Batch tagging failed:", error);
      setTagging(false);
      setTagProgress(null);
    }
  };

  // Extract unique values for dropdowns
  const filterOptions = useMemo(() => {
    const genres = new Set<string>();
    const moods = new Set<string>();
    const decades = new Set<string>();

    metadata.forEach((meta) => {
      if (meta.genre) genres.add(meta.genre);
      if (meta.mood) moods.add(meta.mood);
      if (meta.decade) decades.add(meta.decade);
    });

    return {
      genres: Array.from(genres).sort(),
      moods: Array.from(moods).sort(),
      decades: Array.from(decades).sort(),
    };
  }, [metadata]);

  // Filter tracks based on metadata
  const filteredLibrary = useMemo(() => {
    if (!filters.genre && !filters.mood && filters.energyMin === 1 && filters.energyMax === 10 && !filters.decade) {
      return library;
    }

    return library.filter((track) => {
      const meta = metadata.get(track.id);
      if (!meta) return false; // Hide tracks without metadata when filtering

      if (filters.genre && meta.genre !== filters.genre) return false;
      if (filters.mood && meta.mood !== filters.mood) return false;
      if (filters.decade && meta.decade !== filters.decade) return false;
      
      if (meta.energy_level !== undefined) {
        if (meta.energy_level < filters.energyMin || meta.energy_level > filters.energyMax) {
          return false;
        }
      }

      return true;
    });
  }, [library, metadata, filters]);

  const clearFilters = () => {
    setFilters({
      genre: "",
      mood: "",
      energyMin: 1,
      energyMax: 10,
      decade: "",
    });
  };

  const hasActiveFilters = filters.genre || filters.mood || filters.energyMin > 1 || filters.energyMax < 10 || filters.decade;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-ytm-accent" />
      </div>
    );
  }

  if (library.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-24 h-24 bg-ytm-surface rounded-full flex items-center justify-center mb-4">
          <Library className="w-12 h-12 text-ytm-text-secondary" />
        </div>
        <h2 className="text-xl font-bold mb-2">Your library is empty</h2>
        <p className="text-ytm-text-secondary">
          Start searching and playing music to build your library
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Your Library</h1>
          <p className="text-ytm-text-secondary">
            {filteredLibrary.length} {hasActiveFilters && `of ${library.length}`} tracks
            {metadata.size > 0 && ` • ${metadata.size} tagged`}
          </p>
        </div>
        
        {metadata.size > 0 && (
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 px-4 py-2 bg-ytm-surface border border-ytm-border rounded-lg hover:bg-ytm-surface-hover transition-colors"
          >
            <Filter className="w-4 h-4" />
            <span>Filters</span>
            {hasActiveFilters && (
              <span className="w-2 h-2 bg-ytm-accent rounded-full" />
            )}
          </button>
        )}

        {/* Tag All Button */}
        {settings?.ollama_enabled && settings?.auto_tagging_enabled && (
          <button
            onClick={handleTagAll}
            disabled={tagging}
            className={clsx(
              "flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors",
              tagging
                ? "bg-ytm-surface text-ytm-text-secondary cursor-wait"
                : "bg-ytm-accent text-white hover:bg-ytm-accent-hover"
            )}
          >
            {tagging ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {tagging
              ? `Tagging ${tagProgress?.current || 0}/${tagProgress?.total || library.length}...`
              : metadata.size < library.length
                ? `Tag ${library.length - metadata.size} Tracks`
                : "All Tagged ✓"
            }
          </button>
        )}
      </div>

      {/* Tagging Progress Bar */}
      {tagging && tagProgress && (
        <div className="bg-ytm-surface border border-ytm-border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-ytm-accent animate-pulse" />
              Analyzing: {tagProgress.title || "..."}
            </span>
            <span className="text-ytm-text-secondary">
              {tagProgress.current}/{tagProgress.total}
            </span>
          </div>
          <div className="w-full bg-ytm-bg rounded-full h-2">
            <div
              className="bg-ytm-accent h-2 rounded-full transition-all duration-300"
              style={{ width: `${Math.round((tagProgress.current / tagProgress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {showFilters && metadata.size > 0 && (
        <div className="bg-ytm-surface border border-ytm-border rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              <Filter className="w-4 h-4" />
              Filter by Tags
            </h3>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 text-sm text-ytm-accent hover:underline"
              >
                <X className="w-3 h-3" />
                Clear all
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Genre Filter */}
            <div>
              <label className="block text-sm font-medium mb-1">Genre</label>
              <select
                value={filters.genre}
                onChange={(e) => setFilters({ ...filters, genre: e.target.value })}
                className="w-full px-3 py-2 bg-ytm-bg border border-ytm-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ytm-accent"
              >
                <option value="">All genres</option>
                {filterOptions.genres.map((genre) => (
                  <option key={genre} value={genre}>
                    {genre}
                  </option>
                ))}
              </select>
            </div>

            {/* Mood Filter */}
            <div>
              <label className="block text-sm font-medium mb-1">Mood</label>
              <select
                value={filters.mood}
                onChange={(e) => setFilters({ ...filters, mood: e.target.value })}
                className="w-full px-3 py-2 bg-ytm-bg border border-ytm-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ytm-accent"
              >
                <option value="">All moods</option>
                {filterOptions.moods.map((mood) => (
                  <option key={mood} value={mood}>
                    {mood}
                  </option>
                ))}
              </select>
            </div>

            {/* Decade Filter */}
            <div>
              <label className="block text-sm font-medium mb-1">Decade</label>
              <select
                value={filters.decade}
                onChange={(e) => setFilters({ ...filters, decade: e.target.value })}
                className="w-full px-3 py-2 bg-ytm-bg border border-ytm-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ytm-accent"
              >
                <option value="">All decades</option>
                {filterOptions.decades.map((decade) => (
                  <option key={decade} value={decade}>
                    {decade}
                  </option>
                ))}
              </select>
            </div>

            {/* Energy Range Filter */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Energy Level: {filters.energyMin}-{filters.energyMax}
              </label>
              <div className="flex gap-2 items-center">
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={filters.energyMin}
                  onChange={(e) => setFilters({ ...filters, energyMin: Number(e.target.value) })}
                  className="flex-1"
                />
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={filters.energyMax}
                  onChange={(e) => setFilters({ ...filters, energyMax: Number(e.target.value) })}
                  className="flex-1"
                />
              </div>
              <div className="flex justify-between text-xs text-ytm-text-secondary mt-1">
                <span>Low</span>
                <span>High</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-1">
        {filteredLibrary.map((track, i) => (
          <TrackCard key={track.id} track={track} index={i} showIndex initialMetadata={metadata.get(track.id) ?? null} />
        ))}
      </div>
    </div>
  );
}
