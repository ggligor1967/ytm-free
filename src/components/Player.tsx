import { useEffect, useRef, useState, useCallback } from "react";
import { useAppStore } from "../store";
import * as api from "../api";
import { useTriggerEngine } from "../hooks/useTriggerEngine";
import { getTrackId } from "../lib/trackId";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Repeat,
  Repeat1,
  Shuffle,
  Heart,
  ListPlus,
  Download,
  Loader2,
  Zap,
  Mic,
  Radio,
  MonitorPlay,
} from "lucide-react";
import clsx from "clsx";

export function Player() {
  const {
    currentTrack,
    isPlaying,
    setIsPlaying,
    volume,
    setVolume,
    progress,
    setProgress,
    duration,
    setDuration,
    isShuffle,
    toggleShuffle,
    repeatMode,
    toggleRepeat,
    playNext,
    playPrevious,
    setShowAddToPlaylist,
    favorites,
    setFavorites,
    setQueue,
    setQueueIndex,
    smartQueueActive,
    setSmartQueueActive,
    smartQueueLoading,
    setSmartQueueLoading,
    recentlyPlayedIds,
    addRecentlyPlayedId,
    settings,
    djPendingEvent,
    setDjPendingEvent,
    isVideoMode,
    openVideo,
    closeVideo,
    setVideoLoading,
  } = useAppStore();

  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isWatchLoading, setIsWatchLoading] = useState(false);

  // DJ Mode state
  const [djSpeaking, setDjSpeaking] = useState(false);
  const [djCommentary, setDjCommentary] = useState<string | null>(null);
  const djSongCountRef = useRef(0);
  const djPrefetchedRef = useRef<{ commentary: string; transition_type: string } | null>(null);
  const djPrefetchingRef = useRef(false);

  // Initialize DJ Trigger Engine
  useTriggerEngine(settings?.dj_mode_enabled ?? false);

  // Get video ID from track
  const videoId = currentTrack
    ? "video_id" in currentTrack
      ? currentTrack.video_id
      : currentTrack.id
    : null;

  // Check if track is favorite
  const isFavorite = videoId
    ? favorites.some((f) => f.video_id === videoId)
    : false;

  // Load audio URL when track changes
  useEffect(() => {
    async function loadAudio() {
      console.log("[Player] loadAudio called!", { videoId });
      if (!videoId) {
        console.log("[Player] No videoId, cannot load audio");
        setAudioUrl(null);
        return;
      }

      setIsLoading(true);
      try {
        const url = await api.getStreamUrl(videoId);
        console.log("[Player] Got stream URL:", url);
        setAudioUrl(url);
      } catch (error) {
        console.error("[Player] Failed to get stream URL:", error);
        setAudioUrl(null);
      } finally {
        setIsLoading(false);
      }
    }

    loadAudio();
  }, [videoId]);

  // Handle play/pause
  useEffect(() => {
    if (!audioRef.current || !audioUrl) return;

    if (isPlaying) {
      audioRef.current.play().catch(console.error);
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying, audioUrl]);

  // Handle volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Mute/unmute audio element when video mode is toggled
  // (video stream carries its own audio — avoid doubling)
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = isVideoMode;
    }
  }, [isVideoMode]);

  // Update progress + DJ prefetch
  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setProgress(audioRef.current.currentTime);

      // Prefetch DJ commentary when ~20s remain
      const remaining = audioRef.current.duration - audioRef.current.currentTime;
      if (
        remaining > 0 &&
        remaining <= 20 &&
        !djPrefetchedRef.current &&
        !djPrefetchingRef.current &&
        settings?.dj_mode_enabled &&
        settings?.ollama_enabled
      ) {
        const { queue: q, queueIndex: qi } = useAppStore.getState();
        const nextTrack = q[qi + 1];
        if (nextTrack && currentTrack) {
          const currentId = getTrackId(currentTrack);
          const nextId = getTrackId(nextTrack);
          if (currentId && nextId && shouldDjSpeak()) {
            djPrefetchingRef.current = true;
            api
              .aiDjCommentary(
                currentTrack.title,
                currentTrack.artist,
                currentId,
                nextTrack.title,
                nextTrack.artist,
                nextId,
                settings.dj_style,
                settings.dj_language
              )
              .then((result) => {
                djPrefetchedRef.current = { commentary: result.commentary, transition_type: result.transition_type };
              })
              .catch((err) => console.error("DJ prefetch failed:", err))
              .finally(() => {
                djPrefetchingRef.current = false;
              });
          }
        }
      }
    }
  };

  // Set duration when loaded
  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
      // Update play count
      if (videoId) {
        api.updatePlayCount(videoId).catch(console.error);
      }
    }
  };

  // Smart queue auto-play: when queue ends, ask AI for next tracks
  const handleSmartAutoPlay = useCallback(async () => {
    if (!currentTrack || smartQueueLoading) return;
    
    setSmartQueueLoading(true);
    try {
      const title = currentTrack.title;
      const artist = currentTrack.artist;
      const trackId = "video_id" in currentTrack ? currentTrack.id : undefined;
      
      const nextTracks = await api.smartQueueNext(
        title,
        artist,
        trackId,
        recentlyPlayedIds,
        5
      );
      
      if (nextTracks.length > 0) {
        setQueue(nextTracks);
        setQueueIndex(0);
        useAppStore.setState({
          currentTrack: nextTracks[0],
          isPlaying: true,
        });
      }
    } catch (err) {
      console.error("Smart queue failed:", err);
    } finally {
      setSmartQueueLoading(false);
    }
  }, [currentTrack, smartQueueLoading, recentlyPlayedIds, setSmartQueueLoading, setQueue, setQueueIndex]);

  // DJ Mode: check if it's time to speak based on frequency setting
  const shouldDjSpeak = useCallback(() => {
    if (!settings?.dj_mode_enabled || !settings?.ollama_enabled) return false;
    const freq = settings.dj_frequency || 1;
    // freq=1: every song, freq=3: every 3 songs, freq=0: random (~30% chance)
    if (freq === 0) return Math.random() < 0.3;
    return djSongCountRef.current >= freq - 1;
  }, [settings]);

  // DJ Mode: speak commentary using Web Speech API or edge-tts
  const speakDjCommentary = useCallback(
    (text: string): Promise<void> => {
      return new Promise((resolve) => {
        const ttsEngine = settings?.tts_engine ?? 'web_speech';

        // ── edge-tts path ────────────────────────────────────────────────────
        if (ttsEngine === 'edge_tts') {
          const voice = settings?.dj_voice || 'en-US-ChristopherNeural';
          const rate = settings?.dj_rate ?? 1.05;
          const pitch = settings?.dj_pitch ?? 1.0;

          setDjSpeaking(true);
          setDjCommentary(text);
          if (audioRef.current) {
            audioRef.current.volume = Math.max(0.05, volume * 0.15);
          }

          api.speakWithEdgeTts(text, voice, rate, pitch)
            .then((url) => {
              const ttsAudio = new Audio(url);
              ttsAudio.onended = () => {
                setDjSpeaking(false);
                setDjCommentary(null);
                if (audioRef.current) {
                  audioRef.current.volume = isMuted ? 0 : volume;
                }
                resolve();
              };
              ttsAudio.onerror = () => {
                setDjSpeaking(false);
                setDjCommentary(null);
                if (audioRef.current) {
                  audioRef.current.volume = isMuted ? 0 : volume;
                }
                resolve();
              };
              ttsAudio.play().catch(() => {
                setDjSpeaking(false);
                setDjCommentary(null);
                if (audioRef.current) {
                  audioRef.current.volume = isMuted ? 0 : volume;
                }
                resolve();
              });
            })
            .catch(() => {
              setDjSpeaking(false);
              setDjCommentary(null);
              if (audioRef.current) {
                audioRef.current.volume = isMuted ? 0 : volume;
              }
              resolve();
            });
          return;
        }

        // ── Web Speech API path ──────────────────────────────────────────────
        if (!window.speechSynthesis) {
          resolve();
          return;
        }
        // Cancel any ongoing speech
        window.speechSynthesis.cancel();

        setDjSpeaking(true);
        setDjCommentary(text);

        // Lower music volume during speech
        if (audioRef.current) {
          audioRef.current.volume = Math.max(0.05, volume * 0.15);
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = settings?.dj_rate ?? 1.05;
        utterance.pitch = settings?.dj_pitch ?? 1.0;

        // Try to find a good voice
        const voices = window.speechSynthesis.getVoices();
        const lang = settings?.dj_language === "Română" ? "ro" : "en";
        
        // If user selected a specific voice, use it
        let preferred: SpeechSynthesisVoice | undefined;
        if (settings?.dj_voice) {
          preferred = voices.find((v) => v.name === settings.dj_voice);
        }
        
        // Otherwise, find a good voice for the language
        if (!preferred) {
          preferred = voices.find(
            (v) => v.lang.startsWith(lang) && v.name.toLowerCase().includes("natural")
          ) || voices.find((v) => v.lang.startsWith(lang));
        }
        
        if (preferred) utterance.voice = preferred;

        utterance.onend = () => {
          setDjSpeaking(false);
          setDjCommentary(null);
          if (audioRef.current) {
            audioRef.current.volume = isMuted ? 0 : volume;
          }
          resolve();
        };
        utterance.onerror = () => {
          setDjSpeaking(false);
          setDjCommentary(null);
          if (audioRef.current) {
            audioRef.current.volume = isMuted ? 0 : volume;
          }
          resolve();
        };

        window.speechSynthesis.speak(utterance);
      });
    },
    [volume, isMuted, settings]
  );

  // DJ Trigger Engine: Consume pending events
  useEffect(() => {
    if (!djPendingEvent || djSpeaking) return;

    const handleDjEvent = async () => {
      try {
        console.log('[Player] Processing DJ event:', djPendingEvent.trigger_type);
        const result = await api.aiDjEvent(djPendingEvent);
        setDjPendingEvent(null); // Clear event before speaking
        await speakDjCommentary(result.commentary);
      } catch (err) {
        console.error('[Player] Failed to process DJ event:', err);
        setDjPendingEvent(null); // Clear even on error
      }
    };

    handleDjEvent();
  }, [djPendingEvent, djSpeaking, speakDjCommentary, setDjPendingEvent]);

  // DJ Mode: Manual user request
  const handleDjRequest = useCallback(() => {
    if (!settings?.dj_mode_enabled || djSpeaking || djPendingEvent) return;

    const context: import ('../types').DjEventContext = {
      trigger_type: 'UserRequest',
      current_title: currentTrack && 'title' in currentTrack ? currentTrack.title : undefined,
      current_artist: currentTrack && 'artist' in currentTrack ? currentTrack.artist : undefined,
      current_track_id: currentTrack && 'id' in currentTrack ? currentTrack.id : undefined,
      style: settings.dj_style,
      language: settings.dj_language,
      model: settings.ollama_model,
    };

    setDjPendingEvent(context);
  }, [settings, djSpeaking, djPendingEvent, currentTrack, setDjPendingEvent]);

  // Handle track end
  const handleEnded = async () => {
    // Track recently played
    if (videoId) {
      addRecentlyPlayedId(videoId);
    }

    const { queue: q, queueIndex: qi, repeatMode: rm } = useAppStore.getState();
    const isQueueEnd = q.length === 0 || (qi >= q.length - 1 && rm !== "all");

    // DJ Mode: speak between tracks
    if (settings?.dj_mode_enabled && settings?.ollama_enabled && !isQueueEnd) {
      djSongCountRef.current += 1;
      if (djPrefetchedRef.current) {
        // Use prefetched commentary
        const prefetched = djPrefetchedRef.current;
        djPrefetchedRef.current = null;
        djSongCountRef.current = 0;
        await speakDjCommentary(prefetched.commentary);
      } else if (shouldDjSpeak()) {
        // Fetch live if not prefetched
        const nextTrack = q[qi + 1];
        if (nextTrack && currentTrack) {
          try {
            const currentId = getTrackId(currentTrack);
            const nextId = getTrackId(nextTrack);
            const result = await api.aiDjCommentary(
              currentTrack.title,
              currentTrack.artist,
              currentId,
              nextTrack.title,
              nextTrack.artist,
              nextId,
              settings.dj_style,
              settings.dj_language
            );
            djSongCountRef.current = 0;
            await speakDjCommentary(result.commentary);
          } catch (err) {
            console.error("DJ commentary failed:", err);
          }
        }
      }
    }

    // Reset prefetch state for next track
    djPrefetchedRef.current = null;

    if (isQueueEnd && smartQueueActive && settings?.smart_queue_enabled) {
      // Queue ended — ask AI for next tracks
      handleSmartAutoPlay();
    } else {
      playNext();
    }
  };

  // Seek
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setProgress(time);
    }
  };

  // Toggle favorite
  const handleToggleFavorite = async () => {
    if (!videoId) return;
    try {
      await api.toggleFavorite(videoId);
      const favorites = await api.getFavorites();
      setFavorites(favorites);
    } catch (error) {
      console.error("Failed to toggle favorite:", error);
    }
  };

  // Download track
  const handleDownload = async () => {
    if (!currentTrack) return;

    const title = currentTrack.title;
    const artist = currentTrack.artist;
    const thumbnail = currentTrack.thumbnail;
    const id = "video_id" in currentTrack ? currentTrack.video_id : currentTrack.id;

    setIsDownloading(true);
    try {
      await api.downloadTrack(id, title, artist, thumbnail);
    } catch (error) {
      console.error("Download failed:", error);
    } finally {
      setIsDownloading(false);
    }
  };

  // Watch Video: try ffmpeg proxy first, fall back to YouTube iframe
  const handleWatchVideo = async () => {
    if (!videoId) return;

    if (isVideoMode) {
      // Toggle off
      closeVideo();
      return;
    }

    setIsWatchLoading(true);
    setVideoLoading(true);
    try {
      // Check if ffmpeg is available
      await api.checkFfmpegInstalled();
      // ffmpeg OK — use local mux proxy
      const url = await api.getVideoStreamUrl(videoId);
      openVideo(videoId, "ytdlp", url);
    } catch {
      // ffmpeg missing or error — fall back to embed
      openVideo(videoId, "iframe", "");
    } finally {
      setIsWatchLoading(false);
      setVideoLoading(false);
    }
  };

  // Format time
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (!currentTrack) {
    return (
      <div className="h-24 bg-ytm-surface border-t border-ytm-border flex items-center justify-center">
        <p className="text-ytm-text-secondary">No track selected</p>
      </div>
    );
  }

  return (
    <div className="h-24 bg-ytm-surface border-t border-ytm-border px-4 flex items-center gap-4">
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={audioUrl || undefined}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />

      {/* Track Info */}
      <div className="flex items-center gap-3 w-64">
        <img
          src={currentTrack.thumbnail}
          alt={currentTrack.title}
          className="w-14 h-14 rounded-lg object-cover"
        />
        <div className="min-w-0">
          <p className="font-medium truncate">{currentTrack.title}</p>
          <p className="text-sm text-ytm-text-secondary truncate">
            {currentTrack.artist}
          </p>
        </div>
      </div>

      {/* Main Controls */}
      <div className="flex-1 flex flex-col items-center gap-2">
        {/* Buttons */}
        <div className="flex items-center gap-4">
          <button
            onClick={toggleShuffle}
            className={clsx(
              "p-2 rounded-full transition-colors",
              isShuffle ? "text-ytm-accent" : "text-ytm-text-secondary hover:text-white"
            )}
          >
            <Shuffle className="w-5 h-5" />
          </button>

          <button
            onClick={playPrevious}
            className="p-2 text-ytm-text-secondary hover:text-white transition-colors"
          >
            <SkipBack className="w-5 h-5" />
          </button>

          <button
            onClick={(e) => {
              e.preventDefault();
              console.log("[Player] Play button clicked!", { isPlaying, isLoading, audioUrl, videoId, track: currentTrack?.title });
              setIsPlaying(!isPlaying);
            }}
            disabled={isLoading || !audioUrl}
            className={clsx(
              "w-12 h-12 rounded-full flex items-center justify-center",
              "bg-white text-black hover:scale-105 transition-transform",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {isLoading ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-6 h-6" />
            ) : (
              <Play className="w-6 h-6 ml-0.5" />
            )}
          </button>

          <button
            onClick={playNext}
            className="p-2 text-ytm-text-secondary hover:text-white transition-colors"
          >
            <SkipForward className="w-5 h-5" />
          </button>

          <button
            onClick={toggleRepeat}
            className={clsx(
              "p-2 rounded-full transition-colors",
              repeatMode !== "none"
                ? "text-ytm-accent"
                : "text-ytm-text-secondary hover:text-white"
            )}
          >
            {repeatMode === "one" ? (
              <Repeat1 className="w-5 h-5" />
            ) : (
              <Repeat className="w-5 h-5" />
            )}
          </button>

          {/* Smart Queue Toggle */}
          {settings?.smart_queue_enabled && (
            <button
              onClick={() => setSmartQueueActive(!smartQueueActive)}
              title={smartQueueActive ? "Smart Queue ON — AI picks next tracks" : "Smart Queue OFF"}
              className={clsx(
                "p-2 rounded-full transition-colors relative",
                smartQueueActive
                  ? "text-ytm-accent"
                  : "text-ytm-text-secondary hover:text-white"
              )}
            >
              <Zap className={clsx("w-5 h-5", smartQueueActive && "fill-current")} />
              {smartQueueLoading && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-ytm-accent rounded-full animate-pulse" />
              )}
            </button>
          )}

          {/* DJ Mode Indicator */}
          {settings?.dj_mode_enabled && (
            <div
              title={djSpeaking ? `🎙️ ${djCommentary?.slice(0, 80)}...` : "AI DJ Mode ON"}
              className={clsx(
                "p-2 rounded-full transition-colors relative",
                djSpeaking
                  ? "text-yellow-400 animate-pulse"
                  : "text-ytm-accent"
              )}
            >
              <Mic className={clsx("w-5 h-5", djSpeaking && "fill-current")} />
              {djSpeaking && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-yellow-400 rounded-full animate-ping" />
              )}
            </div>
          )}
        </div>

        {/* Progress Bar */}
        <div className="w-full max-w-xl flex items-center gap-2">
          <span className="text-xs text-ytm-text-secondary w-10 text-right">
            {formatTime(progress)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={progress}
            onChange={handleSeek}
            className="flex-1 h-1 accent-ytm-accent"
          />
          <span className="text-xs text-ytm-text-secondary w-10">
            {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2 w-64 justify-end">
        <button
          onClick={handleToggleFavorite}
          className={clsx(
            "p-2 rounded-full transition-colors",
            isFavorite ? "text-ytm-accent" : "text-ytm-text-secondary hover:text-white"
          )}
        >
          <Heart className={clsx("w-5 h-5", isFavorite && "fill-current")} />
        </button>

        <button
          onClick={() => setShowAddToPlaylist(currentTrack)}
          className="p-2 text-ytm-text-secondary hover:text-white transition-colors"
        >
          <ListPlus className="w-5 h-5" />
        </button>

        <button
          onClick={handleDownload}
          disabled={isDownloading}
          className="p-2 text-ytm-text-secondary hover:text-white transition-colors disabled:opacity-50"
        >
          {isDownloading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Download className="w-5 h-5" />
          )}
        </button>

        {/* Watch Video button */}
        {currentTrack && (
          <button
            onClick={handleWatchVideo}
            disabled={isWatchLoading}
            className={clsx(
              "p-2 rounded-full transition-colors disabled:opacity-50",
              isVideoMode
                ? "text-ytm-accent"
                : "text-ytm-text-secondary hover:text-white"
            )}
            title={isVideoMode ? "Opre\u0219te video" : "Videoclip"}
          >
            {isWatchLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <MonitorPlay className={clsx("w-5 h-5", isVideoMode && "fill-current")} />
            )}
          </button>
        )}

        {/* DJ Request Button */}
        {settings?.dj_mode_enabled && (
          <button
            onClick={handleDjRequest}
            disabled={djSpeaking || !!djPendingEvent}
            className={clsx(
              "p-2 transition-colors rounded-full disabled:opacity-50",
              djSpeaking || djPendingEvent
                ? "text-ytm-accent animate-pulse"
                : "text-ytm-text-secondary hover:text-white"
            )}
            title="Request DJ commentary"
          >
            <Radio className="w-5 h-5" />
          </button>
        )}

        {/* Volume */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="p-2 text-ytm-text-secondary hover:text-white transition-colors"
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="w-5 h-5" />
            ) : (
              <Volume2 className="w-5 h-5" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={isMuted ? 0 : volume}
            onChange={(e) => {
              setVolume(parseFloat(e.target.value));
              setIsMuted(false);
            }}
            className="w-24 h-1 accent-white"
          />
        </div>
      </div>
    </div>
  );
}
