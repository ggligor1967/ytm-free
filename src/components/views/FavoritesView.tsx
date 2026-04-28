import { useEffect, useState } from "react";
import { useAppStore } from "../../store";
import * as api from "../../api";
import { TrackCard } from "../TrackCard";
import { Heart, Loader2, Play, Shuffle } from "lucide-react";

export function FavoritesView() {
  const {
    favorites,
    setFavorites,
    setQueue,
    setQueueIndex,
    setCurrentTrack,
    setIsPlaying,
  } = useAppStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadFavorites() {
      try {
        const tracks = await api.getFavorites();
        setFavorites(tracks);
      } catch (error) {
        console.error("Failed to load favorites:", error);
      } finally {
        setLoading(false);
      }
    }
    loadFavorites();
  }, [setFavorites]);

  const handlePlayAll = () => {
    if (favorites.length === 0) return;
    setQueue(favorites);
    setQueueIndex(0);
    setCurrentTrack(favorites[0]);
    setIsPlaying(true);
  };

  const handleShuffle = () => {
    if (favorites.length === 0) return;
    const shuffled = [...favorites].sort(() => Math.random() - 0.5);
    setQueue(shuffled);
    setQueueIndex(0);
    setCurrentTrack(shuffled[0]);
    setIsPlaying(true);
  };

  const handlePlayTrack = (index: number) => {
    setQueue(favorites);
    setQueueIndex(index);
    setCurrentTrack(favorites[index]);
    setIsPlaying(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-ytm-accent" />
      </div>
    );
  }

  if (favorites.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-24 h-24 bg-ytm-surface rounded-full flex items-center justify-center mb-4">
          <Heart className="w-12 h-12 text-ytm-text-secondary" />
        </div>
        <h2 className="text-xl font-bold mb-2">No favorites yet</h2>
        <p className="text-ytm-text-secondary text-center max-w-md">
          Like songs by clicking the heart icon to add them to your favorites.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Liked Songs</h1>
          <p className="text-ytm-text-secondary">{favorites.length} tracks</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleShuffle}
            className="flex items-center gap-2 px-4 py-2 border border-ytm-border rounded-full font-medium hover:bg-ytm-surface transition-colors"
          >
            <Shuffle className="w-5 h-5" />
            Shuffle
          </button>
          <button
            onClick={handlePlayAll}
            className="flex items-center gap-2 px-6 py-2 bg-ytm-accent text-white rounded-full font-medium hover:bg-ytm-accent-hover transition-colors"
          >
            <Play className="w-5 h-5" />
            Play All
          </button>
        </div>
      </div>

      {/* Tracks */}
      <div className="space-y-1">
        {favorites.map((track, i) => (
          <TrackCard
            key={track.id}
            track={track}
            index={i}
            showIndex
            onPlay={() => handlePlayTrack(i)}
          />
        ))}
      </div>
    </div>
  );
}
