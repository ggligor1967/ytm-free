import { useState, useCallback, useEffect, useRef } from "react";
import { useAppStore } from "../store";
import * as api from "../api";
import { Search, X, Loader2, Sparkles, Music, User, Radio, Disc, Command } from "lucide-react";
import type { AutocompleteSuggestion } from "../types";
import clsx from "clsx";

// Icon mapping for suggestion types
const typeIcons: Record<string, typeof Music> = {
  artist: User,
  genre: Radio,
  mood: Sparkles,
  song: Disc,
};

export function Header({ onOpenCommandBar }: { onOpenCommandBar?: () => void }) {
  const {
    searchQuery,
    setSearchQuery,
    setSearchResults,
    setView,
    isSearching,
    setIsSearching,
    settings,
    ollamaAvailable,
  } = useAppStore();

  const [localQuery, setLocalQuery] = useState(searchQuery);
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Smart autocomplete - debounced AI suggestions
  const aiEnabled = settings?.ollama_enabled && settings?.smart_search_enabled && ollamaAvailable;

  useEffect(() => {
    if (!aiEnabled || localQuery.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    // Debounce 300ms
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setIsLoadingSuggestions(true);
      try {
        const response = await api.ollamaSmartAutocomplete(localQuery.trim());
        if (response?.completions?.length > 0) {
          setSuggestions(response.completions.slice(0, 8));
          setShowSuggestions(true);
          setSelectedIndex(-1);
        } else {
          setSuggestions([]);
          setShowSuggestions(false);
        }
      } catch (error) {
        console.error("Autocomplete failed:", error);
        setSuggestions([]);
        setShowSuggestions(false);
      } finally {
        setIsLoadingSuggestions(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [localQuery, aiEnabled]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = useCallback(async (query?: string) => {
    const q = query || localQuery;
    if (!q.trim()) return;

    setSuggestions([]);
    setShowSuggestions(false);
    setIsSearching(true);
    setSearchQuery(q);
    setLocalQuery(q);
    setView("search");

    try {
      const results = await api.searchYoutube(q, settings?.search_results_count);
      setSearchResults(results);
    } catch (error) {
      console.error("Search error:", error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [localQuery, settings?.search_results_count, setIsSearching, setSearchQuery, setSearchResults, setView]);

  const handleSelectSuggestion = (suggestion: AutocompleteSuggestion) => {
    handleSearch(suggestion.text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
      } else if (e.key === "Enter" && selectedIndex >= 0) {
        e.preventDefault();
        handleSelectSuggestion(suggestions[selectedIndex]);
        return;
      } else if (e.key === "Escape") {
        setShowSuggestions(false);
        setSelectedIndex(-1);
        return;
      }
    }

    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const clearSearch = () => {
    setLocalQuery("");
    setSearchQuery("");
    setSearchResults([]);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  return (
    <header className="h-16 px-6 flex items-center gap-4 border-b border-ytm-border bg-ytm-bg/80 backdrop-blur-sm">
      {/* Search Bar */}
      <div className="flex-1 max-w-2xl">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-ytm-text-secondary" />
          <input
            ref={inputRef}
            type="text"
            value={localQuery}
            onChange={(e) => setLocalQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (suggestions.length > 0) setShowSuggestions(true);
            }}
            placeholder="Search for songs, artists, albums..."
            className={clsx(
              "w-full h-11 pl-12 pr-12 rounded-full",
              "bg-ytm-surface border border-ytm-border",
              "text-ytm-text placeholder:text-ytm-text-secondary",
              "focus:outline-none focus:border-ytm-accent",
              "transition-colors"
            )}
          />
          {localQuery && (
            <button
              onClick={clearSearch}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-ytm-text-secondary hover:text-white"
            >
              {isSearching ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <X className="w-5 h-5" />
              )}
            </button>
          )}

          {/* Smart Autocomplete Dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div
              ref={dropdownRef}
              className="absolute top-full left-0 right-0 mt-1 z-50 bg-ytm-surface border border-ytm-border rounded-xl shadow-lg overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
            >
              {/* AI indicator */}
              <div className="flex items-center gap-1.5 px-4 py-1.5 text-xs text-ytm-text-secondary border-b border-ytm-border/50">
                <Sparkles className="w-3 h-3 text-ytm-accent" />
                <span>AI Suggestions</span>
                {isLoadingSuggestions && <Loader2 className="w-3 h-3 animate-spin ml-auto" />}
              </div>

              {/* Suggestions list */}
              {suggestions.map((suggestion, index) => {
                const TypeIcon = typeIcons[suggestion.type] || Search;
                return (
                  <button
                    key={`${suggestion.text}-${index}`}
                    onClick={() => handleSelectSuggestion(suggestion)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={clsx(
                      "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                      index === selectedIndex
                        ? "bg-ytm-accent/10 text-ytm-text"
                        : "hover:bg-white/5 text-ytm-text"
                    )}
                  >
                    <TypeIcon className={clsx(
                      "w-4 h-4 flex-shrink-0",
                      index === selectedIndex ? "text-ytm-accent" : "text-ytm-text-secondary"
                    )} />
                    <span className="flex-1 truncate text-sm">{suggestion.text}</span>
                    <span className={clsx(
                      "text-[10px] px-1.5 py-0.5 rounded-full uppercase tracking-wider font-medium",
                      suggestion.type === "artist" && "bg-blue-500/20 text-blue-400",
                      suggestion.type === "genre" && "bg-green-500/20 text-green-400",
                      suggestion.type === "mood" && "bg-purple-500/20 text-purple-400",
                      suggestion.type === "song" && "bg-orange-500/20 text-orange-400",
                      !["artist", "genre", "mood", "song"].includes(suggestion.type) && "bg-white/10 text-ytm-text-secondary"
                    )}>
                      {suggestion.type}
                    </span>
                  </button>
                );
              })}

              {/* Keyboard hint */}
              <div className="flex items-center gap-3 px-4 py-1.5 text-[10px] text-ytm-text-secondary border-t border-ytm-border/50">
                <span><kbd className="px-1 py-0.5 bg-white/10 rounded text-[9px]">↑↓</kbd> navigate</span>
                <span><kbd className="px-1 py-0.5 bg-white/10 rounded text-[9px]">Enter</kbd> select</span>
                <span><kbd className="px-1 py-0.5 bg-white/10 rounded text-[9px]">Esc</kbd> close</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Search Button */}
      <button
        onClick={() => handleSearch()}
        disabled={!localQuery.trim() || isSearching}
        className={clsx(
          "h-11 px-6 rounded-full font-medium transition-colors",
          "bg-ytm-accent text-white",
          "hover:bg-ytm-accent-hover",
          "disabled:opacity-50 disabled:cursor-not-allowed"
        )}
      >
        Search
      </button>

      {/* Command Bar Trigger */}
      {settings?.ollama_enabled && onOpenCommandBar && (
        <button
          onClick={onOpenCommandBar}
          title="Command Bar (Ctrl+K)"
          className={clsx(
            "h-11 px-3 rounded-full transition-colors flex items-center gap-2",
            "bg-ytm-surface border border-ytm-border",
            "hover:border-ytm-accent/50 hover:bg-ytm-surface-hover",
            "text-ytm-text-secondary hover:text-ytm-text"
          )}
        >
          <Command className="w-4 h-4" />
          <kbd className="text-[10px] px-1.5 py-0.5 bg-white/10 rounded hidden sm:inline">
            Ctrl+K
          </kbd>
        </button>
      )}
    </header>
  );
}
