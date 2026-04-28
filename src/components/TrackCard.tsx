import { useAppStore } from "../store";
import type { Track, SearchResult, TrackMetadataDB } from "../types";
import { Play, Pause, MoreVertical, ListPlus, Heart, Download, Tag, Loader2, Share2 } from "lucide-react";
import clsx from "clsx";
import { useState, useEffect } from "react";
import * as api from "../api";
import { showToast } from "./Toast";

interface TrackCardProps {
  track: Track | SearchResult;
  index?: number;
  showIndex?: boolean;
  onPlay?: () => void;
  initialMetadata?: TrackMetadataDB | null;
}

export function TrackCard({ track, index, showIndex, onPlay, initialMetadata }: TrackCardProps) {
  const {
    currentTrack,
    isPlaying,
    setCurrentTrack,
    setIsPlaying,
    addToQueue,
    setShowAddToPlaylist,
    settings,
  } = useAppStore();

  const [showMenu, setShowMenu] = useState(false);
  const [metadata, setMetadata] = useState<TrackMetadataDB | null>(initialMetadata ?? null);
  const [showTooltip, setShowTooltip] = useState(false);
  const [isTagging, setIsTagging] = useState(false);

  // Sync with parent-provided metadata
  useEffect(() => {
    if (initialMetadata !== undefined) {
      setMetadata(initialMetadata);
    }
  }, [initialMetadata]);

  // Load metadata for this track (only if not provided by parent)
  useEffect(() => {
    if (initialMetadata !== undefined) return; // parent controls metadata
    if (settings?.auto_tagging_enabled && "id" in track) {
      api.ollamaGetTrackMetadata(track.id)
        .then(meta => setMetadata(meta))
        .catch(() => setMetadata(null));
    }
  }, [track, settings?.auto_tagging_enabled, initialMetadata]);

  const videoId = "video_id" in track ? track.video_id : track.id;
  const currentVideoId = currentTrack
    ? "video_id" in currentTrack
      ? currentTrack.video_id
      : currentTrack.id
    : null;

  const isCurrentTrack = videoId === currentVideoId;
  const isCurrentPlaying = isCurrentTrack && isPlaying;

  const handlePlay = () => {
    console.log("[TrackCard] handlePlay called!", {
      videoId,
      isCurrentTrack,
      isPlaying,
      trackTitle: track.title,
    });
    if (onPlay) {
      onPlay();
    } else if (isCurrentTrack) {
      setIsPlaying(!isPlaying);
    } else {
      console.log("[TrackCard] Setting current track and playing");
      setCurrentTrack(track);
      setIsPlaying(true);
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return "--:--";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const duration = "duration" in track ? track.duration : undefined;
  const durationStr = "duration_string" in track ? track.duration_string : undefined;

  return (
    <div
      className={clsx(
        "group flex items-center gap-4 p-3 rounded-lg transition-colors",
        "hover:bg-ytm-surface-hover",
        isCurrentTrack && "bg-ytm-surface"
      )}
    >
      {/* Index or Play Button */}
      <div className="w-8 flex items-center justify-center">
        {showIndex && !isCurrentTrack ? (
          <span className="text-ytm-text-secondary group-hover:hidden">
            {(index ?? 0) + 1}
          </span>
        ) : null}
        <button
          onClick={handlePlay}
          className={clsx(
            "w-8 h-8 rounded-full flex items-center justify-center",
            "bg-ytm-accent text-white",
            "opacity-0 group-hover:opacity-100 transition-opacity",
            isCurrentTrack && "opacity-100",
            !showIndex && "opacity-100"
          )}
        >
          {isCurrentPlaying ? (
            <Pause className="w-4 h-4" />
          ) : (
            <Play className="w-4 h-4 ml-0.5" />
          )}
        </button>
      </div>

      {/* Thumbnail */}
      <img
        src={track.thumbnail}
        alt={track.title}
        className="w-12 h-12 rounded object-cover"
      />
  
      {/* Track Info */}
      <div className="flex-1 min-w-0">
        <p
          className={clsx(
            "font-medium truncate",
            isCurrentTrack && "text-ytm-accent"
          )}
        >
          {track.title}
        </p>
        <p className="text-sm text-ytm-text-secondary truncate">{track.artist}</p>
        
        {/* AI Tags Badges (FAZA 2) */}
        {metadata && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {metadata.genre && (
              <span className="text-xs px-2 py-0.5 bg-ytm-surface border border-ytm-border rounded-full text-ytm-text-secondary">
                {metadata.genre}
              </span>
            )}
            {metadata.mood && (
              <span className="text-xs px-2 py-0.5 bg-ytm-surface border border-ytm-border rounded-full text-ytm-text-secondary">
                {metadata.mood}
              </span>
            )}
            {metadata.energy_level !== undefined && (
              <div className="relative">
                <span
                  className={clsx(
                    "text-xs px-2 py-0.5 rounded-full flex items-center gap-1 cursor-pointer select-none",
                    metadata.energy_level <= 3 && "bg-blue-500/20 text-blue-400",
                    metadata.energy_level > 3 && metadata.energy_level <= 7 && "bg-yellow-500/20 text-yellow-400",
                    metadata.energy_level > 7 && "bg-red-500/20 text-red-400"
                  )}
                  onClick={(e) => { e.stopPropagation(); setShowTooltip(!showTooltip); }}
                >
                  <span className="inline-block w-2 h-2 rounded-full bg-current flex-shrink-0" aria-hidden="true"></span>
                  <span>{metadata.energy_level}/10</span>
                </span>
                
                {/* Tooltip with full metadata */}
                {showTooltip && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowTooltip(false)} />
                    <div className="absolute left-0 top-full mt-2 w-64 bg-ytm-surface border border-ytm-border rounded-lg shadow-xl p-3 text-xs z-50 animate-slide-down">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1 font-semibold mb-2">
                        <Tag className="w-3 h-3" />
                        <span>AI Tags</span>
                      </div>
                      {metadata.genre && (
                        <div><span className="text-ytm-text-secondary">Genre:</span> {metadata.genre}</div>
                      )}
                      {metadata.sub_genre && (
                        <div><span className="text-ytm-text-secondary">Sub-genre:</span> {metadata.sub_genre}</div>
                      )}
                      {metadata.mood && (
                        <div><span className="text-ytm-text-secondary">Mood:</span> {metadata.mood}</div>
                      )}
                      {metadata.energy_level !== undefined && (
                        <div><span className="text-ytm-text-secondary">Energy:</span> {metadata.energy_level}/10</div>
                      )}
                      {metadata.tempo && (
                        <div><span className="text-ytm-text-secondary">Tempo:</span> {metadata.tempo}</div>
                      )}
                      {metadata.danceability !== undefined && (
                        <div><span className="text-ytm-text-secondary">Danceability:</span> {metadata.danceability}/10</div>
                      )}
                      {metadata.vocal_type && (
                        <div><span className="text-ytm-text-secondary">Vocals:</span> {metadata.vocal_type}</div>
                      )}
                      {metadata.decade && (
                        <div><span className="text-ytm-text-secondary">Decade:</span> {metadata.decade}</div>
                      )}
                      {metadata.language && (
                        <div><span className="text-ytm-text-secondary">Language:</span> {metadata.language}</div>
                      )}
                    </div>
                  </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        {isTagging && (
          <div className="flex items-center gap-1 mt-1 text-xs text-ytm-accent">
            <Loader2 className="w-3 h-3 animate-spin" />
            Analyzing...
          </div>
        )}
      </div>

      {/* Duration */}
      <span className="text-sm text-ytm-text-secondary">
        {durationStr || formatDuration(duration)}
      </span>

      {/* Actions */}
      <div className="relative">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="p-2 text-ytm-text-secondary hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <MoreVertical className="w-5 h-5" />
        </button>

        {showMenu && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowMenu(false)}
            />
            <div className="absolute right-0 top-full mt-1 w-48 bg-ytm-surface border border-ytm-border rounded-lg shadow-xl z-50 py-1 animate-slide-down">
              <button
                onClick={() => {
                  addToQueue(track);
                  setShowMenu(false);
                }}
                className="w-full px-4 py-2 text-left text-sm hover:bg-ytm-surface-hover flex items-center gap-3"
              >
                <ListPlus className="w-4 h-4" />
                Add to Queue
              </button>
              <button
                onClick={() => {
                  setShowAddToPlaylist(track);
                  setShowMenu(false);
                }}
                className="w-full px-4 py-2 text-left text-sm hover:bg-ytm-surface-hover flex items-center gap-3"
              >
                <Heart className="w-4 h-4" />
                Add to Playlist
              </button>
              <button
                onClick={() => {
                  // Download logic
                  setShowMenu(false);
                }}
                className="w-full px-4 py-2 text-left text-sm hover:bg-ytm-surface-hover flex items-center gap-3"
              >
                <Download className="w-4 h-4" />
                Download
              </button>
              {/* Share button (FAZA 8 — K1) */}
              {settings?.ollama_enabled && (
                <button
                  onClick={async () => {
                    setShowMenu(false);
                    try {
                      const mood = metadata?.mood || 'vibing';
                      const result = await api.shareGenerateMessage(track.title, track.artist, mood);
                      const text = `${result.message} ${result.hashtags.map((t: string) => `#${t}`).join(' ')}`;
                      await navigator.clipboard.writeText(text);
                      showToast('Share message copied!', 'success');
                    } catch (err) {
                      // Fallback: copy basic text
                      await navigator.clipboard.writeText(`🎵 Listening to ${track.title} by ${track.artist}`);
                      showToast('Basic share text copied', 'info');
                    }
                  }}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-ytm-surface-hover flex items-center gap-3"
                >
                  <Share2 className="w-4 h-4" />
                  Share
                </button>
              )}
              {/* AI Tag button (FAZA 2) */}
              {settings?.ollama_enabled && settings?.auto_tagging_enabled && !metadata && "video_id" in track && (
                <button
                  onClick={async () => {
                    setShowMenu(false);
                    setIsTagging(true);
                    try {
                      await api.ollamaBatchAnalyzeTracks([track.video_id]);
                      // Reload metadata after tagging
                      const meta = await api.ollamaGetTrackMetadata(track.id);
                      if (meta) setMetadata(meta);
                    } catch (err) {
                      console.error("Failed to tag track:", err);
                    } finally {
                      setIsTagging(false);
                    }
                  }}
                  disabled={isTagging}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-ytm-surface-hover flex items-center gap-3 text-ytm-accent"
                >
                  <Tag className="w-4 h-4" />
                  {isTagging ? "Tagging..." : "🏷️ Tag with AI"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
