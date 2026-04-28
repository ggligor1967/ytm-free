import { useAppStore } from "../store";
import type { View } from "../types";
import {
  Home,
  Search,
  Library,
  ListMusic,
  Download,
  Heart,
  Settings,
  Music2,
  Upload,
  Brain,
  Sparkles,
  Zap,
  BarChart3,
  Wrench,
  MessageCircle,
} from "lucide-react";
import clsx from "clsx";

interface SidebarProps {
  ytdlpVersion: string | null;
}

interface NavItem {
  id: View;
  label: string;
  icon: typeof Home;
}

const mainNav: NavItem[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "search", label: "Search", icon: Search },
];

const libraryNav: NavItem[] = [
  { id: "library", label: "Library", icon: Library },
  { id: "playlists", label: "Playlists", icon: ListMusic },
  { id: "smart-playlist", label: "Smart Playlist", icon: Sparkles },
  { id: "smart-queue", label: "Smart Queue", icon: Zap },
  { id: "insights", label: "Insights", icon: BarChart3 },
  { id: "library-cleanup", label: "Library Cleanup", icon: Wrench },
  { id: "ai-chat", label: "AI Chat", icon: MessageCircle },
  { id: "favorites", label: "Favorites", icon: Heart },
  { id: "downloads", label: "Downloads", icon: Download },
  { id: "import", label: "Import Spotify", icon: Upload },
];

export function Sidebar({ ytdlpVersion }: SidebarProps) {
  const { view, setView, playlists, setSelectedPlaylistId, settings, ollamaAvailable, aiProcessing } = useAppStore();

  const handleNavClick = (navId: View) => {
    setView(navId);
    if (navId !== "playlist") {
      setSelectedPlaylistId(null);
    }
  };

  const handlePlaylistClick = (playlistId: string) => {
    setSelectedPlaylistId(playlistId);
    setView("playlist");
  };

  return (
    <aside className="w-64 bg-ytm-bg border-r border-ytm-border flex flex-col">
      {/* Logo */}
      <div className="p-4 flex items-center gap-3">
        <div className="w-10 h-10 bg-ytm-accent rounded-lg flex items-center justify-center">
          <Music2 className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-bold">YTM Free</h1>
          <p className="text-xs text-ytm-text-secondary">Personal Music</p>
        </div>
        {settings?.ollama_enabled && (
          <div className="relative group" title={ollamaAvailable ? "AI Connected" : "AI Disconnected"}>
            <Brain className={clsx(
              "w-5 h-5 transition-colors",
              ollamaAvailable ? "text-ytm-accent" : "text-ytm-text-secondary opacity-50"
            )} />
            {aiProcessing && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ytm-accent opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-ytm-accent"></span>
              </span>
            )}
            {/* Tooltip */}
            <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-2 py-1 bg-ytm-surface border border-ytm-border rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              {ollamaAvailable ? "🟢 AI Connected" : "🔴 AI Disconnected"}
            </div>
          </div>
        )}
      </div>

      {/* Main Navigation */}
      <nav className="px-2 py-4">
        {mainNav.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            isActive={view === item.id}
            onClick={() => handleNavClick(item.id)}
          />
        ))}
      </nav>

      {/* Divider */}
      <div className="mx-4 h-px bg-ytm-border" />

      {/* Library Navigation */}
      <nav className="px-2 py-4">
        <p className="px-3 mb-2 text-xs font-semibold text-ytm-text-secondary uppercase tracking-wider">
          Your Library
        </p>
        {libraryNav.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            isActive={view === item.id}
            onClick={() => handleNavClick(item.id)}
          />
        ))}
      </nav>

      {/* Divider */}
      <div className="mx-4 h-px bg-ytm-border" />

      {/* Playlists */}
      <div className="flex-1 overflow-y-auto px-2 py-4">
        <p className="px-3 mb-2 text-xs font-semibold text-ytm-text-secondary uppercase tracking-wider">
          Playlists
        </p>
        {playlists.length === 0 ? (
          <p className="px-3 text-sm text-ytm-text-secondary">No playlists yet</p>
        ) : (
          <div className="space-y-1">
            {playlists.map((playlist) => (
              <button
                key={playlist.id}
                onClick={() => handlePlaylistClick(playlist.id)}
                className={clsx(
                  "w-full px-3 py-2 rounded-lg text-left text-sm transition-colors",
                  "hover:bg-ytm-surface-hover",
                  view === "playlist" && playlist.id === useAppStore.getState().selectedPlaylistId
                    ? "bg-ytm-surface text-white"
                    : "text-ytm-text-secondary"
                )}
              >
                <span className="truncate block">{playlist.name}</span>
                <span className="text-xs opacity-60">{playlist.track_count} tracks</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Settings & Version */}
      <div className="p-2 border-t border-ytm-border">
        <NavButton
          item={{ id: "settings", label: "Settings", icon: Settings }}
          isActive={view === "settings"}
          onClick={() => handleNavClick("settings")}
        />
        {ytdlpVersion && (
          <p className="px-3 py-2 text-xs text-ytm-text-secondary">
            yt-dlp {ytdlpVersion}
          </p>
        )}
      </div>
    </aside>
  );
}

interface NavButtonProps {
  item: NavItem;
  isActive: boolean;
  onClick: () => void;
}

function NavButton({ item, isActive, onClick }: NavButtonProps) {
  const Icon = item.icon;

  return (
    <button
      onClick={onClick}
      className={clsx(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors",
        "hover:bg-ytm-surface-hover",
        isActive ? "bg-ytm-surface text-white" : "text-ytm-text-secondary"
      )}
    >
      <Icon className={clsx("w-5 h-5", isActive && "text-ytm-accent")} />
      <span className="font-medium">{item.label}</span>
    </button>
  );
}
