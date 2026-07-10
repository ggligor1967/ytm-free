import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../../store";
import { TrackCard } from "../TrackCard";
import { Search, Loader2, Sparkles, Zap, Clock, Brain } from "lucide-react";
import * as api from "../../api";
import clsx from "clsx";
import { showToast } from "../Toast";
import type { Track } from "../../types";

interface SemanticResult {
  track: Track;
  similarity: number;
  match_reason: string;
}

function parseSemanticFilterInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    )
  );
}

type AppliedSemanticFilters = {
  genres?: string[];
  moods?: string[];
  activities?: string[];
};

export function SearchView() {
  const {
    searchQuery,
    searchResults,
    isSearching,
    settings,
    ollamaAvailable,
    aiSearchResults,
    setAISearchResults,
    isAISearching,
    setIsAISearching,
    setQueue,
    setQueueIndex,
    setCurrentTrack,
    setIsPlaying,
    setSearchQuery,
    setSearchResults,
    setIsSearching,
  } = useAppStore();

  const [activePill, setActivePill] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<'youtube' | 'semantic'>('youtube');
  const [semanticResults, setSemanticResults] = useState<SemanticResult[]>([]);
  const [isSemanticSearching, setIsSemanticSearching] = useState(false);
  const [semanticGenreFilterInput, setSemanticGenreFilterInput] = useState("");
  const [semanticMoodFilterInput, setSemanticMoodFilterInput] = useState("");
  const [semanticActivityFilterInput, setSemanticActivityFilterInput] = useState("");
  const [appliedSemanticFilters, setAppliedSemanticFilters] = useState<AppliedSemanticFilters>({});

  const hasActiveSemanticFilters =
    Boolean(appliedSemanticFilters.genres?.length) ||
    Boolean(appliedSemanticFilters.moods?.length) ||
    Boolean(appliedSemanticFilters.activities?.length);

  const semanticFilterCount = useMemo(
    () =>
      (appliedSemanticFilters.genres?.length ?? 0) +
      (appliedSemanticFilters.moods?.length ?? 0) +
      (appliedSemanticFilters.activities?.length ?? 0),
    [appliedSemanticFilters]
  );

  const buildAppliedSemanticFilters = (): AppliedSemanticFilters => {
    const genres = parseSemanticFilterInput(semanticGenreFilterInput);
    const moods = parseSemanticFilterInput(semanticMoodFilterInput);
    const activities = parseSemanticFilterInput(semanticActivityFilterInput);

    return {
      genres: genres.length > 0 ? genres : undefined,
      moods: moods.length > 0 ? moods : undefined,
      activities: activities.length > 0 ? activities : undefined,
    };
  };

  // Helper: set query and execute YouTube search
  const searchWithQuery = async (query: string) => {
    setSearchQuery(query);
    setIsSearching(true);
    setSemanticResults([]);
    try {
      const results = await api.searchYoutube(query, settings?.search_results_count);
      setSearchResults(results);
    } catch (error) {
      console.error("Search error:", error);
      showToast("Search error");
      setSearchResults([]);
    } finally {
      setIsSearching(false);
      setActivePill(null);
    }
  };

  const performSemanticSearch = async (
    query: string,
    filters?: AppliedSemanticFilters
  ) => {
    setSearchQuery(query);
    setIsSemanticSearching(true);
    setSearchResults([]);
    try {
      const hasFilters = Boolean(
        filters?.genres?.length ||
        filters?.moods?.length ||
        filters?.activities?.length
      );

      const results = hasFilters
        ? await api.semanticSearchFiltered(
            query,
            20,
            filters?.genres?.length ? filters.genres : undefined,
            filters?.moods?.length ? filters.moods : undefined,
            filters?.activities?.length ? filters.activities : undefined
          )
        : await api.semanticSearch(query, 20);

      setSemanticResults(results);
    } catch (error) {
      console.error("Semantic search error:", error);
      showToast("Semantic search error");
      setSemanticResults([]);
    } finally {
      setIsSemanticSearching(false);
      setActivePill(null);
    }
  };

  useEffect(() => {
    if (searchMode === 'semantic' && searchQuery) {
      void performSemanticSearch(searchQuery, appliedSemanticFilters);
    }
  }, [searchMode, searchQuery]);

  useEffect(() => {
    const enhanceSearch = async () => {
      if (!searchQuery || !settings?.ollama_enabled || !settings?.smart_search_enabled || !ollamaAvailable) {
        return;
      }

      setIsAISearching(true);
      try {
        const suggestions = await api.ollamaEnhanceSearch(searchQuery, []);
        setAISearchResults(suggestions.filter((suggestion) => suggestion !== searchQuery));
      } catch (error) {
        console.error("AI search enhancement failed:", error);
        showToast("AI search enhancement failed");
        setAISearchResults([]);
      } finally {
        setIsAISearching(false);
      }
    };

    if (!isSearching && searchResults.length > 0) {
      void enhanceSearch();
    }
  }, [searchQuery, isSearching, searchResults.length, settings, ollamaAvailable]);

  const currentResults = searchMode === 'semantic' ? semanticResults : searchResults;
  const hasResults = currentResults.length > 0;

  const handlePlayAll = () => {
    if (currentResults.length === 0) return;
    const tracksToPlay = searchMode === 'semantic'
      ? semanticResults.map((result) => result.track)
      : searchResults;
    setQueue(tracksToPlay);
    setQueueIndex(0);
    setCurrentTrack(tracksToPlay[0]);
    setIsPlaying(true);
  };

  const handlePlayTrack = (index: number) => {
    const tracksToPlay = searchMode === 'semantic'
      ? semanticResults.map((result) => result.track)
      : searchResults;
    setQueue(tracksToPlay);
    setQueueIndex(index);
    setCurrentTrack(tracksToPlay[index]);
    setIsPlaying(true);
  };

  const applySemanticFilters = async () => {
    if (!searchQuery) return;

    const nextAppliedSemanticFilters = buildAppliedSemanticFilters();
    setAppliedSemanticFilters(nextAppliedSemanticFilters);

    await performSemanticSearch(searchQuery, nextAppliedSemanticFilters);
  };

  const clearSemanticFilters = async () => {
    setSemanticGenreFilterInput("");
    setSemanticMoodFilterInput("");
    setSemanticActivityFilterInput("");
    setAppliedSemanticFilters({});

    if (searchMode === 'semantic' && searchQuery) {
      await performSemanticSearch(searchQuery, {});
    }
  };

  if (isSearching || isSemanticSearching) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-12 h-12 animate-spin text-ytm-accent mb-4" />
        <p className="text-ytm-text-secondary">
          {searchMode === 'semantic' ? '🧠 Searching your library...' : `Searching for "${searchQuery}"...`}
        </p>
      </div>
    );
  }

  if (!searchQuery) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-24 h-24 bg-ytm-surface rounded-full flex items-center justify-center mb-4">
          <Search className="w-12 h-12 text-ytm-text-secondary" />
        </div>
        <h2 className="text-xl font-bold mb-2">Search for music</h2>
        <p className="text-ytm-text-secondary">
          {searchMode === 'semantic' ? '🧠 Find similar tracks from your library' : 'Find songs, artists, and albums from YouTube'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">
              {searchMode === 'semantic' ? '🧠 Library Search' : 'Search Results'}
            </h1>
            {settings?.ollama_enabled && settings?.smart_search_enabled && ollamaAvailable && (
              <span className="px-2 py-1 bg-ytm-accent/10 text-ytm-accent rounded-full text-xs font-medium flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                AI
              </span>
            )}
          </div>
          <p className="text-ytm-text-secondary">
            {searchMode === 'semantic'
              ? `${semanticResults.length} ${hasActiveSemanticFilters ? 'filtered similar tracks' : 'similar tracks'}`
              : `${searchResults.length} results for "${searchQuery}"`}
          </p>
        </div>
        <button
          onClick={handlePlayAll}
          className="px-6 py-2 bg-ytm-accent text-white rounded-full font-medium hover:bg-ytm-accent-hover transition-colors"
        >
          Play All
        </button>
      </div>

      {/* Search Mode Toggle */}
      {settings?.semantic_search_enabled && (
        <div className="flex gap-2">
          <button
            onClick={() => {
              setSearchMode('youtube');
              setSemanticResults([]);
            }}
            className={clsx(
              'px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2',
              searchMode === 'youtube'
                ? 'bg-ytm-accent text-white'
                : 'bg-ytm-surface text-ytm-text-secondary hover:bg-ytm-accent/10'
            )}
          >
            <Search className="w-4 h-4" />
            YouTube
          </button>
          <button
            onClick={() => {
              setSearchMode('semantic');
              setSearchResults([]);
            }}
            className={clsx(
              'px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2',
              searchMode === 'semantic'
                ? 'bg-ytm-accent text-white'
                : 'bg-ytm-surface text-ytm-text-secondary hover:bg-ytm-accent/10'
            )}
          >
            <Brain className="w-4 h-4" />
            Semantic
          </button>
        </div>
      )}

      {searchMode === 'semantic' && (
        <div className="bg-ytm-surface rounded-xl p-4 space-y-4 border border-ytm-border">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Semantic filters</h2>
              <p className="text-xs text-ytm-text-secondary mt-1">
                Folosește valori separate prin virgulă. Dacă toate câmpurile sunt goale, căutarea semantică rămâne nefiltrată.
              </p>
            </div>
            {hasActiveSemanticFilters && (
              <span className="px-2 py-1 bg-ytm-accent/10 text-ytm-accent rounded-full text-xs font-medium">
                {semanticFilterCount} filter{semanticFilterCount === 1 ? '' : 's'} active
              </span>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label htmlFor="semantic-genres-filter" className="block text-sm font-medium mb-2">
                Genres
              </label>
              <input
                id="semantic-genres-filter"
                aria-label="Semantic genres filter"
                type="text"
                value={semanticGenreFilterInput}
                onChange={(e) => setSemanticGenreFilterInput(e.target.value)}
                placeholder="rock, synthwave"
                className="w-full px-3 py-2 bg-ytm-bg border border-ytm-border rounded-lg focus:outline-none focus:border-ytm-accent"
              />
            </div>

            <div>
              <label htmlFor="semantic-moods-filter" className="block text-sm font-medium mb-2">
                Moods
              </label>
              <input
                id="semantic-moods-filter"
                aria-label="Semantic moods filter"
                type="text"
                value={semanticMoodFilterInput}
                onChange={(e) => setSemanticMoodFilterInput(e.target.value)}
                placeholder="focus, calm"
                className="w-full px-3 py-2 bg-ytm-bg border border-ytm-border rounded-lg focus:outline-none focus:border-ytm-accent"
              />
            </div>

            <div>
              <label htmlFor="semantic-activities-filter" className="block text-sm font-medium mb-2">
                Activities
              </label>
              <input
                id="semantic-activities-filter"
                aria-label="Semantic activities filter"
                type="text"
                value={semanticActivityFilterInput}
                onChange={(e) => setSemanticActivityFilterInput(e.target.value)}
                placeholder="coding, driving"
                className="w-full px-3 py-2 bg-ytm-bg border border-ytm-border rounded-lg focus:outline-none focus:border-ytm-accent"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void applySemanticFilters()}
              disabled={!searchQuery || isSemanticSearching}
              className={clsx(
                'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                !searchQuery || isSemanticSearching
                  ? 'bg-ytm-border text-ytm-text-secondary cursor-not-allowed'
                  : 'bg-ytm-accent text-white hover:bg-ytm-accent-hover'
              )}
            >
              Apply Filters
            </button>
            <button
              onClick={() => void clearSemanticFilters()}
              disabled={
                !semanticGenreFilterInput &&
                !semanticMoodFilterInput &&
                !semanticActivityFilterInput &&
                !hasActiveSemanticFilters
              }
              className={clsx(
                'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                !semanticGenreFilterInput &&
                !semanticMoodFilterInput &&
                !semanticActivityFilterInput &&
                !hasActiveSemanticFilters
                  ? 'bg-ytm-border text-ytm-text-secondary cursor-not-allowed'
                  : 'bg-ytm-bg border border-ytm-border text-ytm-text-secondary hover:border-ytm-accent hover:text-ytm-accent'
              )}
            >
              Clear Filters
            </button>
          </div>
        </div>
      )}

      {searchMode === 'youtube' && settings?.ollama_enabled && settings?.smart_search_enabled && ollamaAvailable && (
        <div className="flex flex-col gap-3">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-ytm-accent" />
              <span className="text-xs font-medium text-ytm-text-secondary uppercase tracking-wide">Mood</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {['Energetic', 'Relaxing', 'Happy', 'Melancholic', 'Aggressive', 'Romantic', 'Peaceful'].map((mood) => (
                <button
                  key={mood}
                  disabled={activePill !== null}
                  onClick={async () => {
                    setActivePill(mood);
                    try {
                      const response = await api.ollamaMoodSearch(mood, []);
                      if (response.queries.length > 0) {
                        await searchWithQuery(response.queries[0]);
                      } else {
                        setActivePill(null);
                      }
                    } catch (error) {
                      console.error("Mood search failed:", error);
                      showToast("Mood search failed");
                      setActivePill(null);
                    }
                  }}
                  className={clsx(
                    "px-3 py-1.5 rounded-full text-xs transition-colors",
                    "bg-ytm-surface border border-ytm-border",
                    activePill === mood
                      ? "border-ytm-accent bg-ytm-accent/20 text-ytm-accent animate-pulse"
                      : "hover:border-ytm-accent hover:bg-ytm-accent/10 hover:text-ytm-accent",
                    activePill !== null && activePill !== mood && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {activePill === mood ? '⏳ ' : ''}{mood}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-ytm-accent" />
              <span className="text-xs font-medium text-ytm-text-secondary uppercase tracking-wide">Activity</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {['Workout', 'Study', 'Sleep', 'Driving', 'Party', 'Cooking'].map((activity) => (
                <button
                  key={activity}
                  disabled={activePill !== null}
                  onClick={async () => {
                    setActivePill(activity);
                    try {
                      const response = await api.ollamaActivitySearch(activity);
                      if (response.queries.length > 0) {
                        await searchWithQuery(response.queries[0]);
                      } else {
                        setActivePill(null);
                      }
                    } catch (error) {
                      console.error("Activity search failed:", error);
                      showToast("Activity search failed");
                      setActivePill(null);
                    }
                  }}
                  className={clsx(
                    "px-3 py-1.5 rounded-full text-xs transition-colors",
                    "bg-ytm-surface border border-ytm-border",
                    activePill === activity
                      ? "border-ytm-accent bg-ytm-accent/20 text-ytm-accent animate-pulse"
                      : "hover:border-ytm-accent hover:bg-ytm-accent/10 hover:text-ytm-accent",
                    activePill !== null && activePill !== activity && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {activePill === activity ? '⏳ ' : ''}{activity}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-ytm-accent" />
              <span className="text-xs font-medium text-ytm-text-secondary uppercase tracking-wide">Era</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {['1970s', '1980s', '1990s', '2000s', '2010s', 'Modern'].map((era) => (
                <button
                  key={era}
                  disabled={activePill !== null}
                  onClick={async () => {
                    setActivePill(era);
                    try {
                      const response = await api.ollamaEraSearch(era);
                      if (response.queries.length > 0) {
                        await searchWithQuery(response.queries[0]);
                      } else {
                        setActivePill(null);
                      }
                    } catch (error) {
                      console.error("Era search failed:", error);
                      showToast("Era search failed");
                      setActivePill(null);
                    }
                  }}
                  className={clsx(
                    "px-3 py-1.5 rounded-full text-xs transition-colors",
                    "bg-ytm-surface border border-ytm-border",
                    activePill === era
                      ? "border-ytm-accent bg-ytm-accent/20 text-ytm-accent animate-pulse"
                      : "hover:border-ytm-accent hover:bg-ytm-accent/10 hover:text-ytm-accent",
                    activePill !== null && activePill !== era && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {activePill === era ? '⏳ ' : ''}{era}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {settings?.ollama_enabled && settings?.smart_search_enabled && ollamaAvailable && aiSearchResults.length > 0 && (
        <div className="bg-ytm-surface rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-ytm-accent" />
            <span className="text-sm font-medium">AI Suggestions</span>
            {isAISearching && <Loader2 className="w-3 h-3 animate-spin text-ytm-accent" />}
          </div>
          <div className="flex flex-wrap gap-2">
            {aiSearchResults.map((suggestion, index) => (
              <button
                key={index}
                onClick={() => searchWithQuery(suggestion)}
                className={clsx(
                  "px-3 py-1.5 rounded-full text-sm transition-colors",
                  "bg-ytm-bg border border-ytm-border",
                  "hover:border-ytm-accent hover:bg-ytm-accent/10"
                )}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1">
        {!hasResults ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-24 h-24 bg-ytm-surface rounded-full flex items-center justify-center mb-4">
              {searchMode === 'semantic' ? (
                <Brain className="w-12 h-12 text-ytm-text-secondary" />
              ) : (
                <Search className="w-12 h-12 text-ytm-text-secondary" />
              )}
            </div>
            <h2 className="text-xl font-bold mb-2">
              {searchMode === 'semantic' ? 'No similar tracks found' : 'No results found'}
            </h2>
            <p className="text-ytm-text-secondary mb-4 text-center max-w-md">
              {searchMode === 'semantic'
                ? hasActiveSemanticFilters
                  ? 'Try adjusting or clearing the semantic filters, or search for different keywords.'
                  : 'Try indexing your library or searching for different keywords'
                : 'Try different keywords or check your spelling'}
            </p>
            {searchMode === 'semantic' && (
              <button
                onClick={() => {
                  setSearchMode('youtube');
                  setSemanticResults([]);
                }}
                className="px-4 py-2 bg-ytm-accent/20 text-ytm-accent rounded-lg hover:bg-ytm-accent/30 transition-colors text-sm"
              >
                Try YouTube Search →
              </button>
            )}
          </div>
        ) : searchMode === 'semantic' ? (
          semanticResults.map((result, index) => (
            <div
              key={result.track.id}
              className="group flex items-center gap-3 p-3 rounded-lg hover:bg-ytm-surface transition-colors cursor-pointer"
              onClick={() => handlePlayTrack(index)}
            >
              <div className="flex-shrink-0 w-12 h-12 bg-ytm-accent/20 rounded-lg flex items-center justify-center">
                <span className="text-sm font-bold text-ytm-accent">
                  {Math.round(result.similarity * 100)}%
                </span>
              </div>

              <div className="flex-grow min-w-0">
                <p className="font-medium truncate">{result.track.title}</p>
                <p className="text-sm text-ytm-text-secondary truncate">
                  {result.track.artist}
                </p>
                <p className="text-xs text-ytm-text-secondary mt-0.5">
                  {result.match_reason}
                </p>
              </div>

              {result.track.thumbnail && (
                <img
                  src={result.track.thumbnail}
                  alt={result.track.title}
                  className="w-10 h-10 rounded object-cover flex-shrink-0"
                />
              )}
            </div>
          ))
        ) : (
          searchResults.map((track, index) => (
            <TrackCard
              key={track.id}
              track={track}
              index={index}
              showIndex
              onPlay={() => handlePlayTrack(index)}
            />
          ))
        )}
      </div>
    </div>
  );
}
