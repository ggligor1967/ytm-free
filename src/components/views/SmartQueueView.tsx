import { useState, useCallback } from "react";
import { useAppStore } from "../../store";
import * as api from "../../api";
import type { Track, SmartQueueMode, WorkoutIntensity } from "../../types";
import {
  Zap,
  Sun,
  Moon,
  Dumbbell,
  Clock,
  Play,
  Loader2,
  ListMusic,
  Sparkles,
  ChevronRight,
  X,
  Music2,
} from "lucide-react";
import clsx from "clsx";

// ============================================================================
// MODE CARDS
// ============================================================================

interface ModeConfig {
  id: SmartQueueMode | "contextual";
  label: string;
  description: string;
  icon: typeof Sun;
  color: string;
  bgColor: string;
}

const MODES: ModeConfig[] = [
  {
    id: "wake_up",
    label: "Wake Up",
    description: "Start calm, gradually increase energy for a perfect morning",
    icon: Sun,
    color: "text-amber-400",
    bgColor: "bg-amber-400/10 border-amber-400/30",
  },
  {
    id: "sleep",
    label: "Sleep Timer",
    description: "Wind down gradually with decreasing energy until silence",
    icon: Moon,
    color: "text-indigo-400",
    bgColor: "bg-indigo-400/10 border-indigo-400/30",
  },
  {
    id: "workout",
    label: "Workout",
    description: "High-energy BPM-matched tracks to power your exercise",
    icon: Dumbbell,
    color: "text-red-400",
    bgColor: "bg-red-400/10 border-red-400/30",
  },
  {
    id: "contextual",
    label: "Smart Mix",
    description: "AI picks tracks based on time of day and your history",
    icon: Sparkles,
    color: "text-purple-400",
    bgColor: "bg-purple-400/10 border-purple-400/30",
  },
];

const DURATIONS = [15, 30, 45, 60, 90, 120];
const INTENSITIES: { value: WorkoutIntensity; label: string; emoji: string }[] = [
  { value: "low", label: "Light", emoji: "🧘" },
  { value: "medium", label: "Moderate", emoji: "🏃" },
  { value: "high", label: "Intense", emoji: "🔥" },
];

// ============================================================================
// SMART QUEUE VIEW
// ============================================================================

export function SmartQueueView() {
  const {
    setQueue,
    setQueueIndex,
    smartQueueActive,
    setSmartQueueActive,
    setSmartQueueMode,
    settings,
    queue,
    currentTrack,
  } = useAppStore();

  const [selectedMode, setSelectedMode] = useState<SmartQueueMode | "contextual" | null>(null);
  const [duration, setDuration] = useState(30);
  const [intensity, setIntensity] = useState<WorkoutIntensity>("medium");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedTracks, setGeneratedTracks] = useState<Track[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"select" | "configure" | "preview">("select");

  const handleModeSelect = (mode: SmartQueueMode | "contextual") => {
    setSelectedMode(mode);
    setError(null);
    if (mode === "contextual") {
      // Context mode needs no config — go straight to generate
      handleGenerate(mode);
    } else {
      setStep("configure");
    }
  };

  const handleGenerate = useCallback(async (mode?: SmartQueueMode | "contextual") => {
    const m = mode || selectedMode;
    if (!m) return;

    setIsGenerating(true);
    setError(null);
    setGeneratedTracks([]);

    try {
      let tracks: Track[];

      if (m === "contextual") {
        tracks = await api.smartQueueContextual();
      } else {
        tracks = await api.smartQueueSequence(
          m as SmartQueueMode,
          duration,
          m === "workout" ? intensity : undefined
        );
      }

      if (tracks.length === 0) {
        setError("No matching tracks found in your library. Tag more tracks with AI first!");
        return;
      }

      setGeneratedTracks(tracks);
      setStep("preview");
    } catch (err) {
      console.error("Smart queue generation failed:", err);
      setError(typeof err === "string" ? err : "Failed to generate queue. Is Ollama running?");
    } finally {
      setIsGenerating(false);
    }
  }, [selectedMode, duration, intensity]);

  const handleApplyQueue = () => {
    if (generatedTracks.length === 0) return;

    setQueue(generatedTracks);
    setQueueIndex(0);
    setSmartQueueActive(true);
    setSmartQueueMode(selectedMode as SmartQueueMode | "contextual");

    useAppStore.setState({
      currentTrack: generatedTracks[0],
      isPlaying: true,
    });
  };

  const handleReset = () => {
    setSelectedMode(null);
    setGeneratedTracks([]);
    setError(null);
    setStep("select");
  };

  const isEnabled = settings?.smart_queue_enabled && settings?.ollama_enabled;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-ytm-accent/20 rounded-lg flex items-center justify-center">
          <Zap className="w-6 h-6 text-ytm-accent" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Smart Queue</h1>
          <p className="text-ytm-text-secondary text-sm">
            AI-powered queue modes for every moment
          </p>
        </div>

        {/* Auto-play toggle */}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-ytm-text-secondary">Auto-Play</span>
          <button
            onClick={() => setSmartQueueActive(!smartQueueActive)}
            className={clsx(
              "w-12 h-6 rounded-full transition-colors relative",
              smartQueueActive ? "bg-ytm-accent" : "bg-ytm-border"
            )}
          >
            <div
              className={clsx(
                "w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform",
                smartQueueActive ? "translate-x-6" : "translate-x-0.5"
              )}
            />
          </button>
        </div>
      </div>

      {!isEnabled && (
        <div className="bg-ytm-surface rounded-xl p-6 border border-ytm-border text-center">
          <Zap className="w-12 h-12 text-ytm-text-secondary mx-auto mb-3" />
          <h3 className="font-semibold mb-2">Smart Queue requires Ollama AI</h3>
          <p className="text-ytm-text-secondary text-sm">
            Enable Ollama and Smart Queue in Settings to use AI-powered queue modes.
          </p>
        </div>
      )}

      {isEnabled && step === "select" && (
        <>
          {/* Smart Queue Status */}
          {smartQueueActive && (
            <div className="mb-6 bg-ytm-accent/10 border border-ytm-accent/30 rounded-xl p-4 flex items-center gap-3">
              <Zap className="w-5 h-5 text-ytm-accent flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">Smart Auto-Play is ON</p>
                <p className="text-xs text-ytm-text-secondary">
                  When the queue ends, AI will automatically pick the next tracks
                </p>
              </div>
              <button
                onClick={() => setSmartQueueActive(false)}
                className="text-ytm-text-secondary hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Current Queue Info */}
          {queue.length > 0 && (
            <div className="mb-6 bg-ytm-surface rounded-xl p-4 border border-ytm-border">
              <div className="flex items-center gap-2 text-sm text-ytm-text-secondary">
                <ListMusic className="w-4 h-4" />
                <span>Current queue: {queue.length} tracks</span>
                {currentTrack && (
                  <span className="text-xs">
                    • Now playing: {currentTrack.title}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Mode Selection Grid */}
          <h2 className="text-lg font-semibold mb-4">Choose a Mode</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {MODES.map((mode) => (
              <button
                key={mode.id}
                onClick={() => handleModeSelect(mode.id)}
                className={clsx(
                  "p-5 rounded-xl border text-left transition-all hover:scale-[1.02]",
                  "bg-ytm-surface border-ytm-border hover:border-ytm-accent/50"
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={clsx("p-2 rounded-lg", mode.bgColor)}>
                    <mode.icon className={clsx("w-6 h-6", mode.color)} />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold flex items-center gap-2">
                      {mode.label}
                      <ChevronRight className="w-4 h-4 text-ytm-text-secondary" />
                    </h3>
                    <p className="text-sm text-ytm-text-secondary mt-1">
                      {mode.description}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Step 2: Configure */}
      {isEnabled && step === "configure" && selectedMode && (
        <div className="max-w-lg">
          <button
            onClick={handleReset}
            className="text-sm text-ytm-text-secondary hover:text-white mb-4 flex items-center gap-1"
          >
            ← Back to modes
          </button>

          {(() => {
            const mode = MODES.find((m) => m.id === selectedMode)!;
            return (
              <div className={clsx("p-4 rounded-xl border mb-6", mode.bgColor)}>
                <div className="flex items-center gap-2">
                  <mode.icon className={clsx("w-5 h-5", mode.color)} />
                  <h2 className="font-semibold">{mode.label}</h2>
                </div>
              </div>
            );
          })()}

          {/* Duration */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-3">
              <Clock className="w-4 h-4 inline mr-1" />
              Duration
            </label>
            <div className="flex flex-wrap gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={clsx(
                    "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                    duration === d
                      ? "bg-ytm-accent text-white"
                      : "bg-ytm-surface border border-ytm-border hover:border-ytm-accent/50"
                  )}
                >
                  {d} min
                </button>
              ))}
            </div>
          </div>

          {/* Workout Intensity */}
          {selectedMode === "workout" && (
            <div className="mb-6">
              <label className="block text-sm font-medium mb-3">
                Intensity
              </label>
              <div className="flex gap-3">
                {INTENSITIES.map((i) => (
                  <button
                    key={i.value}
                    onClick={() => setIntensity(i.value)}
                    className={clsx(
                      "flex-1 py-3 rounded-lg text-sm font-medium transition-colors text-center",
                      intensity === i.value
                        ? "bg-ytm-accent text-white"
                        : "bg-ytm-surface border border-ytm-border hover:border-ytm-accent/50"
                    )}
                  >
                    <span className="text-lg">{i.emoji}</span>
                    <span className="block mt-1">{i.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Generate Button */}
          <button
            onClick={() => handleGenerate()}
            disabled={isGenerating}
            className={clsx(
              "w-full py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2",
              isGenerating
                ? "bg-ytm-surface text-ytm-text-secondary cursor-wait"
                : "bg-ytm-accent text-white hover:bg-ytm-accent/90"
            )}
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                AI is curating your queue...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                Generate Queue
              </>
            )}
          </button>

          {error && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Step 3: Preview */}
      {isEnabled && step === "preview" && generatedTracks.length > 0 && (
        <div>
          <button
            onClick={handleReset}
            className="text-sm text-ytm-text-secondary hover:text-white mb-4 flex items-center gap-1"
          >
            ← Back to modes
          </button>

          {(() => {
            const mode = MODES.find((m) => m.id === selectedMode);
            return mode ? (
              <div className={clsx("p-4 rounded-xl border mb-4", mode.bgColor)}>
                <div className="flex items-center gap-2">
                  <mode.icon className={clsx("w-5 h-5", mode.color)} />
                  <h2 className="font-semibold">
                    {mode.label} — {generatedTracks.length} tracks
                  </h2>
                  <span className="text-sm text-ytm-text-secondary ml-auto">
                    ~{Math.round(generatedTracks.length * 3.5)} min
                  </span>
                </div>
              </div>
            ) : null;
          })()}

          {/* Track List */}
          <div className="space-y-2 mb-6">
            {generatedTracks.map((track, index) => (
              <div
                key={track.id}
                className="flex items-center gap-3 p-3 bg-ytm-surface rounded-lg border border-ytm-border"
              >
                <span className="text-sm text-ytm-text-secondary w-6 text-right">
                  {index + 1}
                </span>
                <img
                  src={track.thumbnail}
                  alt={track.title}
                  className="w-10 h-10 rounded object-cover"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate text-sm">{track.title}</p>
                  <p className="text-xs text-ytm-text-secondary truncate">
                    {track.artist}
                  </p>
                </div>
                {/* Energy indicator */}
                <div className="flex items-center gap-1">
                  {selectedMode === "wake_up" && (
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-indigo-400 to-amber-400"
                      style={{ width: `${16 + (index / generatedTracks.length) * 32}px` }}
                    />
                  )}
                  {selectedMode === "sleep" && (
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-amber-400 to-indigo-400"
                      style={{ width: `${48 - (index / generatedTracks.length) * 32}px` }}
                    />
                  )}
                  {selectedMode === "workout" && (
                    <Dumbbell className="w-3.5 h-3.5 text-red-400" />
                  )}
                  {selectedMode === "contextual" && (
                    <Music2 className="w-3.5 h-3.5 text-purple-400" />
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleApplyQueue}
              className="flex-1 py-3 rounded-xl bg-ytm-accent text-white font-semibold hover:bg-ytm-accent/90 transition-colors flex items-center justify-center gap-2"
            >
              <Play className="w-5 h-5" />
              Play Now
            </button>
            <button
              onClick={() => {
                // Add to existing queue instead of replacing
                const { queue: currentQueue } = useAppStore.getState();
                setQueue([...currentQueue, ...generatedTracks]);
                handleReset();
              }}
              className="px-6 py-3 rounded-xl bg-ytm-surface border border-ytm-border font-semibold hover:border-ytm-accent/50 transition-colors flex items-center gap-2"
            >
              <ListMusic className="w-5 h-5" />
              Add to Queue
            </button>
            <button
              onClick={() => handleGenerate()}
              disabled={isGenerating}
              className="px-6 py-3 rounded-xl bg-ytm-surface border border-ytm-border font-semibold hover:border-ytm-accent/50 transition-colors"
            >
              {isGenerating ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                "🔄"
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
