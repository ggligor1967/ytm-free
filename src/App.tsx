import { useEffect, useState, useCallback } from "react";
import { useAppStore } from "./store";
import * as api from "./api";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { Player } from "./components/Player";
import { VideoPlayer } from "./components/VideoPlayer";
import { HomeView } from "./components/views/HomeView";
import { SearchView } from "./components/views/SearchView";
import { LibraryView } from "./components/views/LibraryView";
import { PlaylistsView } from "./components/views/PlaylistsView";
import { PlaylistView } from "./components/views/PlaylistView";
import { DownloadsView } from "./components/views/DownloadsView";
import { FavoritesView } from "./components/views/FavoritesView";
import { SettingsView } from "./components/views/SettingsView";
import { ImportView } from "./components/views/ImportView";
import { SmartPlaylistView } from "./components/views/SmartPlaylistView";
import { SmartQueueView } from "./components/views/SmartQueueView";
import { InsightsView } from "./components/views/InsightsView";
import { LibraryCleanupView } from "./components/views/LibraryCleanupView";
import { AIChatView } from "./components/views/AIChatView";
import { AddToPlaylistModal } from "./components/AddToPlaylistModal";
import { CommandBar } from "./components/CommandBar";
import { ToastContainer } from "./components/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AlertCircle, Loader2 } from "lucide-react";

function App() {
  const { 
    view, 
    settings,
    setPlaylists, 
    setRecentlyPlayed, 
    setSettings, 
    setFavorites, 
    setDownloads,
    setOllamaAvailable,
    setOllamaModels,
    setDailyMixPlaylist,
    setDailyMixTracks,
    setDailyMixLoading,
    setDailyMixError,
    addPlaylist,
  } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ytdlpVersion, setYtdlpVersion] = useState<string | null>(null);
  const [commandBarOpen, setCommandBarOpen] = useState(false);

  const openCommandBar = useCallback(() => setCommandBarOpen(true), []);
  const closeCommandBar = useCallback(() => setCommandBarOpen(false), []);

  // Global keyboard shortcut: Ctrl+K or / to open command bar
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Ctrl+K (or Cmd+K on Mac)
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandBarOpen(prev => !prev);
        return;
      }
      // / key when not in an input/textarea
      if (e.key === '/' && !commandBarOpen) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !(e.target as HTMLElement)?.isContentEditable) {
          e.preventDefault();
          setCommandBarOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [commandBarOpen]);

  useEffect(() => {
    async function init() {
      try {
        // Check yt-dlp installation
        const version = await api.checkYtdlp();
        setYtdlpVersion(version);

        // Clean up any leftover TTS temp files from previous sessions
        api.cleanupTtsFiles().catch(() => {/* non-critical */});

        // Load initial data
        const [playlists, recent, favorites, downloads, loadedSettings] = await Promise.all([
          api.getPlaylists(),
          api.getRecentlyPlayed(20),
          api.getFavorites(),
          api.getDownloads(),
          api.getSettings(),
        ]);

        setPlaylists(playlists);
        setRecentlyPlayed(recent);
        setFavorites(favorites);
        setDownloads(downloads);
        setSettings(loadedSettings);

        // Check Ollama availability if enabled
        if (loadedSettings.ollama_enabled) {
          try {
            const available = await api.ollamaCheckAvailable(loadedSettings.ollama_url);
            setOllamaAvailable(available);
            
            if (available) {
              const models = await api.ollamaListModels(loadedSettings.ollama_url);
              setOllamaModels(models);
            }
          } catch (error) {
            console.error("Ollama check failed:", error);
            setOllamaAvailable(false);
          }
        }

        setLoading(false);
      } catch (err) {
        console.error("Initialization error:", err);
        setError(
          err instanceof Error
            ? err.message
            : "Failed to initialize. Make sure yt-dlp is installed."
        );
        setLoading(false);
      }
    }

    init();
  }, [setPlaylists, setRecentlyPlayed, setSettings, setFavorites, setDownloads, setOllamaAvailable, setOllamaModels]);

  // Periodic Ollama health check - every 30s, updates brain icon in real-time
  useEffect(() => {
    if (!settings?.ollama_enabled) {
      setOllamaAvailable(false);
      return;
    }

    const checkOllama = async () => {
      try {
        const available = await api.ollamaCheckAvailable(settings.ollama_url);
        setOllamaAvailable(available);
        if (available) {
          const models = await api.ollamaListModels(settings.ollama_url);
          setOllamaModels(models);
        }
      } catch {
        setOllamaAvailable(false);
      }
    };

    // Check immediately when settings change
    checkOllama();

    // Then poll every 30 seconds
    const interval = setInterval(checkOllama, 30_000);
    return () => clearInterval(interval);
  }, [settings?.ollama_enabled, settings?.ollama_url, setOllamaAvailable, setOllamaModels]);

  // Auto-generate Daily Mix at startup when enabled
  useEffect(() => {
    if (!settings?.ollama_enabled || !settings?.daily_mix_enabled) return;

    const { ollamaAvailable, dailyMixPlaylist } = useAppStore.getState();
    
    // Only generate if Ollama is available and no Daily Mix exists yet
    if (!ollamaAvailable || dailyMixPlaylist) return;

    const generateDailyMix = async () => {
      setDailyMixLoading(true);
      setDailyMixError(null);
      try {
        const [playlist, tracks] = await api.ollamaDailyMix();
        setDailyMixPlaylist(playlist);
        setDailyMixTracks(tracks);
        addPlaylist(playlist);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("Daily Mix auto-generation failed:", msg);
        setDailyMixError(msg);
      } finally {
        setDailyMixLoading(false);
      }
    };

    // Small delay to let the app settle before hitting Ollama
    const timeout = setTimeout(generateDailyMix, 3000);
    return () => clearTimeout(timeout);
  }, [settings?.ollama_enabled, settings?.daily_mix_enabled, setDailyMixLoading, setDailyMixError, setDailyMixPlaylist, setDailyMixTracks, addPlaylist]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-ytm-bg">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-ytm-accent mx-auto mb-4" />
          <p className="text-ytm-text-secondary">Loading YTM Free...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-ytm-bg p-8">
        <div className="max-w-md text-center">
          <AlertCircle className="w-16 h-16 text-ytm-accent mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-4">Initialization Error</h1>
          <p className="text-ytm-text-secondary mb-6">{error}</p>
          <div className="bg-ytm-surface p-4 rounded-lg text-left">
            <p className="text-sm text-ytm-text-secondary mb-2">To install yt-dlp:</p>
            <code className="text-xs bg-ytm-bg p-2 rounded block">
              # Windows (winget)<br />
              winget install yt-dlp<br /><br />
              # Or with pip<br />
              pip install yt-dlp
            </code>
          </div>
        </div>
      </div>
    );
  }

  const renderView = () => {
    switch (view) {
      case "home":
        return <ErrorBoundary key="home"><HomeView /></ErrorBoundary>;
      case "search":
        return <ErrorBoundary key="search"><SearchView /></ErrorBoundary>;
      case "library":
        return <ErrorBoundary key="library"><LibraryView /></ErrorBoundary>;
      case "playlists":
        return <ErrorBoundary key="playlists"><PlaylistsView /></ErrorBoundary>;
      case "playlist":
        return <ErrorBoundary key="playlist"><PlaylistView /></ErrorBoundary>;
      case "downloads":
        return <ErrorBoundary key="downloads"><DownloadsView /></ErrorBoundary>;
      case "favorites":
        return <ErrorBoundary key="favorites"><FavoritesView /></ErrorBoundary>;
      case "settings":
        return <ErrorBoundary key="settings"><SettingsView /></ErrorBoundary>;
      case "import":
        return <ErrorBoundary key="import"><ImportView /></ErrorBoundary>;
      case "smart-playlist":
        return <ErrorBoundary fallbackMessage="Smart Playlist error"><SmartPlaylistView /></ErrorBoundary>;
      case "smart-queue":
        return <ErrorBoundary fallbackMessage="Smart Queue error"><SmartQueueView /></ErrorBoundary>;
      case "insights":
        return <ErrorBoundary fallbackMessage="Insights error"><InsightsView /></ErrorBoundary>;
      case "library-cleanup":
        return <ErrorBoundary fallbackMessage="Library Cleanup error"><LibraryCleanupView /></ErrorBoundary>;
      case "ai-chat":
        return <ErrorBoundary fallbackMessage="AI Chat error"><AIChatView /></ErrorBoundary>;
      default:
        return <HomeView />;
    }
  };

  return (
    <div className="h-full flex flex-col bg-ytm-bg">
      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <Sidebar ytdlpVersion={ytdlpVersion} />

        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <Header onOpenCommandBar={openCommandBar} />

          {/* Content */}
          <main className="flex-1 overflow-y-auto p-6">
            {renderView()}
          </main>
        </div>
      </div>

      {/* Floating PiP video player */}
      <VideoPlayer />

      {/* Player */}
      <Player />

      {/* Modals */}
      <AddToPlaylistModal />

      {/* Command Bar (Ctrl+K) */}
      <CommandBar isOpen={commandBarOpen} onClose={closeCommandBar} />

      {/* Toast Notifications */}
      <ToastContainer />
    </div>
  );
}

export default App;
