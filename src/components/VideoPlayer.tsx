import { useRef, useState, useCallback } from "react";
import { X, Maximize2, Minimize2, Loader2, AlertCircle } from "lucide-react";
import { useAppStore } from "../store";

/**
 * Floating Picture-in-Picture video player.
 * Positioned above the bottom player bar (bottom: 104px so it clears the 96px player).
 * Supports two sources:
 *   - 'ytdlp'  → <video> fed from the local ffmpeg proxy endpoint
 *   - 'iframe' → youtube-nocookie.com embed (fallback when ffmpeg is absent)
 */
export function VideoPlayer() {
  const {
    isVideoMode,
    videoSource,
    videoUrl,
    videoVideoId,
    isVideoLoading,
    closeVideo,
  } = useAppStore();

  const [isExpanded, setIsExpanded] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  // ── Drag-to-reposition ─────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startY: number; origRight: number; origBottom: number } | null>(null);
  const [pos, setPos] = useState({ right: 16, bottom: 104 });

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag from the header bar, not from controls
    e.preventDefault();
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      origRight: pos.right,
      origBottom: pos.bottom,
    };

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragState.current) return;
      const dx = ev.clientX - dragState.current.startX;
      const dy = ev.clientY - dragState.current.startY;
      setPos({
        right: Math.max(8, dragState.current.origRight - dx),
        bottom: Math.max(104, dragState.current.origBottom - dy),
      });
    };

    const onMouseUp = () => {
      dragState.current = null;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [pos]);

  // ── Dimensions ─────────────────────────────────────────────────────────────
  const width = isExpanded ? 640 : 320;
  const height = isExpanded ? 360 : 180;

  if (!isVideoMode) return null;

  return (
    <div
      ref={containerRef}
      className="fixed z-50 rounded-xl overflow-hidden shadow-2xl border border-ytm-border bg-black"
      style={{ right: pos.right, bottom: pos.bottom, width, transition: "width 0.2s, height 0.2s" }}
    >
      {/* Header bar – drag handle */}
      <div
        className="flex items-center justify-between px-2 py-1 bg-ytm-surface cursor-grab active:cursor-grabbing select-none"
        onMouseDown={onMouseDown}
      >
        <span className="text-xs text-ytm-text-secondary font-medium">
          {videoSource === "iframe" ? "YouTube Embed" : "Video"}
        </span>
        <div className="flex items-center gap-1">
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setIsExpanded((v) => !v)}
            className="p-1 text-ytm-text-secondary hover:text-white transition-colors"
            title={isExpanded ? "Micșorează" : "Mărește"}
          >
            {isExpanded ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={closeVideo}
            className="p-1 text-ytm-text-secondary hover:text-red-400 transition-colors"
            title="Închide video"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Video area */}
      <div className="relative bg-black" style={{ width, height }}>
        {/* Loading spinner */}
        {isVideoLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
            <Loader2 className="w-8 h-8 text-ytm-accent animate-spin" />
          </div>
        )}

        {/* Error state */}
        {videoError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-10 p-4 text-center">
            <AlertCircle className="w-8 h-8 text-red-400 mb-2" />
            <p className="text-xs text-red-300">{videoError}</p>
          </div>
        )}

        {/* yt-dlp → ffmpeg stream via local proxy */}
        {videoSource === "ytdlp" && videoUrl && (
          <video
            src={videoUrl}
            autoPlay
            controls
            controlsList="nodownload noremoteplayback"
            className="w-full h-full object-contain"
            onError={() => setVideoError("Nu s-a putut reda stream-ul video. Verifică dacă ffmpeg este instalat.")}
            onCanPlay={() => setVideoError(null)}
          />
        )}

        {/* YouTube iframe fallback */}
        {videoSource === "iframe" && videoVideoId && (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${videoVideoId}?autoplay=1&rel=0`}
            title="YouTube video"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            className="w-full h-full border-0"
          />
        )}

        {/* Nothing to show yet */}
        {!isVideoLoading && !videoError && !videoUrl && !videoVideoId && (
          <div className="inset-0 absolute flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-ytm-accent animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
