import { useState } from "react";
import { useAppStore } from "../store";
import * as api from "../api";
import { X, Plus, Loader2 } from "lucide-react";
import clsx from "clsx";

export function AddToPlaylistModal() {
  const {
    showAddToPlaylist,
    setShowAddToPlaylist,
    playlists,
    setPlaylists,
  } = useAppStore();

  const [isCreating, setIsCreating] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [loading, setLoading] = useState(false);

  if (!showAddToPlaylist) return null;

  const track = showAddToPlaylist;
  const videoId = "video_id" in track ? track.video_id : track.id;

  const handleAddToPlaylist = async (playlistId: string) => {
    setLoading(true);
    try {
      await api.addToPlaylist(
        playlistId,
        videoId,
        track.title,
        track.artist,
        track.thumbnail,
        "duration" in track ? track.duration : undefined
      );
      // Refresh playlists
      const updated = await api.getPlaylists();
      setPlaylists(updated);
      setShowAddToPlaylist(null);
    } catch (error) {
      console.error("Failed to add to playlist:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim()) return;

    setLoading(true);
    try {
      const playlist = await api.createPlaylist(newPlaylistName);
      await api.addToPlaylist(
        playlist.id,
        videoId,
        track.title,
        track.artist,
        track.thumbnail,
        "duration" in track ? track.duration : undefined
      );
      // Refresh playlists
      const updated = await api.getPlaylists();
      setPlaylists(updated);
      setShowAddToPlaylist(null);
      setIsCreating(false);
      setNewPlaylistName("");
    } catch (error) {
      console.error("Failed to create playlist:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md bg-ytm-surface rounded-xl shadow-2xl animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-ytm-border">
          <h2 className="text-lg font-semibold">Add to Playlist</h2>
          <button
            onClick={() => {
              setShowAddToPlaylist(null);
              setIsCreating(false);
            }}
            className="p-2 text-ytm-text-secondary hover:text-white rounded-full hover:bg-ytm-surface-hover"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Track Preview */}
        <div className="p-4 flex items-center gap-3 border-b border-ytm-border">
          <img
            src={track.thumbnail}
            alt={track.title}
            className="w-12 h-12 rounded object-cover"
          />
          <div className="min-w-0">
            <p className="font-medium truncate">{track.title}</p>
            <p className="text-sm text-ytm-text-secondary truncate">
              {track.artist}
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 max-h-80 overflow-y-auto">
          {isCreating ? (
            <div className="space-y-4">
              <input
                type="text"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                placeholder="Playlist name"
                autoFocus
                className={clsx(
                  "w-full px-4 py-3 rounded-lg",
                  "bg-ytm-bg border border-ytm-border",
                  "text-white placeholder:text-ytm-text-secondary",
                  "focus:outline-none focus:border-ytm-accent"
                )}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setIsCreating(false);
                    setNewPlaylistName("");
                  }}
                  className="flex-1 py-2 rounded-lg border border-ytm-border hover:bg-ytm-surface-hover transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreatePlaylist}
                  disabled={!newPlaylistName.trim() || loading}
                  className={clsx(
                    "flex-1 py-2 rounded-lg",
                    "bg-ytm-accent text-white",
                    "hover:bg-ytm-accent-hover",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    "flex items-center justify-center gap-2"
                  )}
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Create & Add
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Create New */}
              <button
                onClick={() => setIsCreating(true)}
                className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-ytm-surface-hover transition-colors"
              >
                <div className="w-10 h-10 rounded-lg bg-ytm-bg flex items-center justify-center">
                  <Plus className="w-5 h-5 text-ytm-accent" />
                </div>
                <span className="font-medium">Create new playlist</span>
              </button>

              {/* Existing Playlists */}
              {playlists.map((playlist) => (
                <button
                  key={playlist.id}
                  onClick={() => handleAddToPlaylist(playlist.id)}
                  disabled={loading}
                  className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-ytm-surface-hover transition-colors disabled:opacity-50"
                >
                  <div className="w-10 h-10 rounded-lg bg-ytm-bg flex items-center justify-center text-ytm-text-secondary">
                    🎵
                  </div>
                  <div className="text-left">
                    <p className="font-medium">{playlist.name}</p>
                    <p className="text-sm text-ytm-text-secondary">
                      {playlist.track_count} tracks
                    </p>
                  </div>
                </button>
              ))}

              {playlists.length === 0 && (
                <p className="text-center text-ytm-text-secondary py-4">
                  No playlists yet. Create one!
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
