import { useCallback } from 'react';
import { useAppStore } from '../store';
import * as api from '../api';
import type { PlayerCommand, View } from '../types';

interface CommandResult {
  success: boolean;
  feedback: string;
}

const VALID_VIEWS: View[] = [
  'home', 'search', 'library', 'playlists', 'playlist',
  'downloads', 'favorites', 'settings', 'import',
  'smart-playlist', 'smart-queue',
];

export function useCommandExecutor() {
  const {
    setIsPlaying,
    setVolume,
    toggleShuffle,
    toggleRepeat,
    setView,
    setSearchQuery,
    setSearchResults,
    setIsSearching,
    currentTrack,
    isPlaying,
    playNext,
    playPrevious,
    addToQueue,
    settings,
  } = useAppStore();

  const executeCommand = useCallback(async (cmd: PlayerCommand): Promise<CommandResult> => {
    try {
      switch (cmd.command) {
        case 'play': {
          if (cmd.query) {
            // Search and play first result
            setIsSearching(true);
            setSearchQuery(cmd.query);
            setView('search');
            try {
              const results = await api.searchYoutube(cmd.query, settings?.search_results_count);
              setSearchResults(results);
              if (results.length > 0) {
                useAppStore.getState().setCurrentTrack(results[0]);
                setIsPlaying(true);
                return { success: true, feedback: `♫ Playing "${results[0].title}"` };
              }
              return { success: false, feedback: `No results found for "${cmd.query}"` };
            } finally {
              setIsSearching(false);
            }
          } else {
            setIsPlaying(true);
            return { success: true, feedback: '▶ Playback resumed' };
          }
        }

        case 'pause':
          setIsPlaying(false);
          return { success: true, feedback: '⏸ Paused' };

        case 'next':
          playNext();
          return { success: true, feedback: '⏭ Next track' };

        case 'previous':
          playPrevious();
          return { success: true, feedback: '⏮ Previous track' };

        case 'favorite': {
          const track = currentTrack;
          if (track && 'video_id' in track) {
            await api.toggleFavorite(track.video_id);
            return { success: true, feedback: '❤️ Added to favorites' };
          } else if (track && 'id' in track) {
            await api.toggleFavorite(track.id);
            return { success: true, feedback: '❤️ Toggled favorite' };
          }
          return { success: false, feedback: 'No track playing' };
        }

        case 'search': {
          setSearchQuery(cmd.query);
          setView('search');
          setIsSearching(true);
          try {
            const results = await api.searchYoutube(cmd.query, settings?.search_results_count);
            setSearchResults(results);
            return { success: true, feedback: `🔍 Found ${results.length} results for "${cmd.query}"` };
          } finally {
            setIsSearching(false);
          }
        }

        case 'create_playlist': {
          const playlist = await api.createPlaylist(cmd.name, cmd.description);
          useAppStore.getState().addPlaylist(playlist);
          return { success: true, feedback: `📋 Created playlist "${cmd.name}"` };
        }

        case 'set_mood':
          return { success: true, feedback: `🎭 Mood set to "${cmd.mood}"` };

        case 'set_volume': {
          const level = Math.max(0, Math.min(1, cmd.level));
          setVolume(level);
          const pct = Math.round(level * 100);
          return { success: true, feedback: `🔊 Volume: ${pct}%` };
        }

        case 'add_to_queue': {
          setIsSearching(true);
          try {
            const results = await api.searchYoutube(cmd.query, 1);
            if (results.length > 0) {
              addToQueue(results[0]);
              return { success: true, feedback: `➕ Added "${results[0].title}" to queue` };
            }
            return { success: false, feedback: `No results for "${cmd.query}"` };
          } finally {
            setIsSearching(false);
          }
        }

        case 'toggle_shuffle':
          toggleShuffle();
          return { success: true, feedback: `🔀 Shuffle ${useAppStore.getState().isShuffle ? 'off' : 'on'}` };

        case 'set_repeat': {
          // Cycle repeat to match target mode
          const state = useAppStore.getState();
          const targetMode = cmd.mode;
          let currentMode = state.repeatMode;
          // Toggle until we match (max 3 toggles)
          for (let i = 0; i < 3 && currentMode !== targetMode; i++) {
            toggleRepeat();
            currentMode = useAppStore.getState().repeatMode;
          }
          const labels: Record<string, string> = { none: 'Off', one: 'One', all: 'All' };
          return { success: true, feedback: `🔁 Repeat: ${labels[targetMode] || targetMode}` };
        }

        case 'navigate': {
          const view = cmd.view as View;
          if (VALID_VIEWS.includes(view)) {
            setView(view);
            return { success: true, feedback: `📍 Navigated to ${view}` };
          }
          return { success: false, feedback: `Unknown view: "${cmd.view}"` };
        }

        case 'download': {
          if (cmd.query) {
            // Search then download first result
            const results = await api.searchYoutube(cmd.query, 1);
            if (results.length > 0) {
              const r = results[0];
              await api.downloadTrack(r.id, r.title, r.artist, r.thumbnail);
              return { success: true, feedback: `⬇️ Downloaded "${r.title}"` };
            }
            return { success: false, feedback: `No results for "${cmd.query}"` };
          } else if (currentTrack) {
            const id = 'video_id' in currentTrack ? currentTrack.video_id : currentTrack.id;
            const title = currentTrack.title;
            const artist = currentTrack.artist;
            const thumb = currentTrack.thumbnail;
            await api.downloadTrack(id, title, artist, thumb);
            return { success: true, feedback: `⬇️ Downloaded "${title}"` };
          }
          return { success: false, feedback: 'No track to download' };
        }

        case 'multi': {
          const results: string[] = [];
          for (const subCmd of cmd.commands) {
            const result = await executeCommand(subCmd);
            results.push(result.feedback);
          }
          return { success: true, feedback: results.join(' • ') };
        }

        case 'unknown':
          return { success: false, feedback: '❓ Command not recognized' };

        default:
          return { success: false, feedback: '❓ Unknown command' };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, feedback: `❌ Error: ${msg}` };
    }
  }, [
    setIsPlaying, setVolume, toggleShuffle, toggleRepeat,
    setView, setSearchQuery, setSearchResults, setIsSearching,
    currentTrack, isPlaying, playNext, playPrevious, addToQueue, settings,
  ]);

  return { executeCommand };
}
