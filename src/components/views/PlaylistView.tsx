import { useEffect, useState } from "react";
import { useAppStore } from "../../store";
import * as api from "../../api";
import { TrackCard } from "../TrackCard";
import { Play, Shuffle, ArrowLeft, Loader2, ListMusic } from "lucide-react";
import type { Track } from "../../types";

export function PlaylistView() {
  const {
    selectedPlaylistId,
    playlists,
    setView,
    setQueue,
    setQueueIndex,
    setCurrentTrack,
    setIsPlaying,
    toggleShuffle,
  } = useAppStore();

  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);

  const playlist = playlists.find((p) => p.id === selectedPlaylistId);

  useEffect(() => {
    async function loadTracks() {
      if (!selectedPlaylistId) return;

      setLoading(true);
      try {
        const playlistTracks = await api.getPlaylistTracks(selectedPlaylistId);
        setTracks(playlistTracks);
      } catch (error) {
        console.error("Failed to load playlist tracks:", error);
      } finally {
        setLoading(false);
      }
    }

    loadTracks();
  }, [selectedPlaylistId]);

  const handlePlayAll = () => {
    if (tracks.length === 0) return;
    setQueue(tracks);
    setQueueIndex(0);
    setCurrentTrack(tracks[0]);
    setIsPlaying(true);
  };

  const handleShuffle = () => {
    if (tracks.length === 0) return;
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    setQueue(shuffled);
    setQueueIndex(0);
    setCurrentTrack(shuffled[0]);
    setIsPlaying(true);
    toggleShuffle();
  };

  const handlePlayTrack = (index: number) => {
    setQueue(tracks);
    setQueueIndex(index);
    setCurrentTrack(tracks[index]);
    setIsPlaying(true);
  };

  if (!playlist) {
    return (
      <div className="text-center py-20">
        <p className="text-ytm-text-secondary">Playlist not found</p>
        <button
          onClick={() => setView("playlists")}
          className="mt-4 text-ytm-accent hover:underline"
        >
          Back to playlists
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-6">
        {/* Back Button */}
        <button
          onClick={() => setView("playlists")}
          className="p-2 text-ytm-text-secondary hover:text-white rounded-full hover:bg-ytm-surface transition-colors"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>

        {/* Playlist Art */}
        <div className="w-48 h-48 bg-ytm-surface rounded-xl flex items-center justify-center flex-shrink-0">
          <ListMusic className="w-20 h-20 text-ytm-text-secondary" />
        </div>

        {/* Info */}
        <div className="flex-1">
          <p className="text-sm text-ytm-text-secondary uppercase tracking-wider mb-2">
            Playlist
          </p>
          <h1 className="text-4xl font-bold mb-2">{playlist.name}</h1>
          {playlist.description && (
            <p className="text-ytm-text-secondary mb-4">{playlist.description}</p>
          )}
          <p className="text-sm text-ytm-text-secondary">
            {playlist.track_count} tracks
          </p>

          {/* Actions */}
          <div className="flex items-center gap-3 mt-6">
            <button
              onClick={handlePlayAll}
              disabled={tracks.length === 0}
              className="flex items-center gap-2 px-6 py-3 bg-ytm-accent text-white rounded-full font-medium hover:bg-ytm-accent-hover transition-colors disabled:opacity-50"
            >
              <Play className="w-5 h-5" />
              Play
            </button>
            <button
              onClick={handleShuffle}
              disabled={tracks.length === 0}
              className="flex items-center gap-2 px-6 py-3 border border-ytm-border rounded-full font-medium hover:bg-ytm-surface transition-colors disabled:opacity-50"
            >
              <Shuffle className="w-5 h-5" />
              Shuffle
            </button>
          </div>
        </div>
      </div>

      {/* Tracks */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-ytm-accent" />
        </div>
      ) : tracks.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-ytm-text-secondary">
            This playlist is empty. Search for music and add tracks!
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {tracks.map((track, i) => (
            <TrackCard
              key={track.id}
              track={track}
              index={i}
              showIndex
              onPlay={() => handlePlayTrack(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
