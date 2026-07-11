import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Brain, Loader2, RefreshCw, Zap } from "lucide-react";
import clsx from "clsx";
import * as api from "../../api";
import { showToast } from "../Toast";
import type { Settings as SettingsType, SemanticIndexStatus } from "../../types";

interface Props {
  settings: SettingsType;
  onUpdate: (partial: Partial<SettingsType>) => void;
}

interface SemanticIndexProgressPayload {
  indexed?: unknown;
  total?: unknown;
  current_track?: unknown;
  percentage?: unknown;
  estimated_time_remaining_seconds?: unknown;
}

interface SemanticIndexProgressState {
  indexed: number | null;
  total: number | null;
  currentTrack: string | null;
  percentage: number | null;
  estimatedTimeRemainingSeconds: number | null;
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.round(value);
}

function normalizePercentage(value: unknown): number | null {
  const normalized = normalizeNonNegativeInteger(value);

  if (normalized === null) {
    return null;
  }

  return Math.min(100, normalized);
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSemanticIndexProgress(
  payload: SemanticIndexProgressPayload | null | undefined
): SemanticIndexProgressState | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const indexed = normalizeNonNegativeInteger(payload.indexed);
  const total = normalizeNonNegativeInteger(payload.total);
  const currentTrack = normalizeText(payload.current_track);
  const explicitPercentage = normalizePercentage(payload.percentage);
  const percentage = explicitPercentage ?? (
    indexed !== null && total !== null && total > 0
      ? Math.min(100, Math.round((indexed / total) * 100))
      : null
  );
  const estimatedTimeRemainingSeconds = normalizeNonNegativeInteger(payload.estimated_time_remaining_seconds);

  if (
    indexed === null
    && total === null
    && currentTrack === null
    && percentage === null
    && estimatedTimeRemainingSeconds === null
  ) {
    return null;
  }

  return {
    indexed,
    total,
    currentTrack,
    percentage,
    estimatedTimeRemainingSeconds,
  };
}

export function SemanticSettings({ settings, onUpdate }: Props) {
  const [semanticStatus, setSemanticStatus] = useState<SemanticIndexStatus | null>(null);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState(0);
  const [indexProgressDetails, setIndexProgressDetails] = useState<SemanticIndexProgressState | null>(null);
  const isMountedRef = useRef(true);
  const progressListenerIdRef = useRef(0);
  const progressUnlistenRef = useRef<null | (() => void)>(null);

  function cleanupProgressListener() {
    progressListenerIdRef.current += 1;

    const unlisten = progressUnlistenRef.current;
    progressUnlistenRef.current = null;
    unlisten?.();
  }

  async function registerProgressListener() {
    cleanupProgressListener();

    const listenerId = progressListenerIdRef.current;

    const unlisten = await listen<SemanticIndexProgressPayload>("semantic-index-progress", (event) => {
      if (!isMountedRef.current) {
        return;
      }

      const nextProgress = normalizeSemanticIndexProgress(event.payload);

      if (!nextProgress) {
        return;
      }

      if (nextProgress.percentage !== null) {
        setIndexProgress(nextProgress.percentage);
      }

      setIndexProgressDetails(nextProgress);
    });

    if (!isMountedRef.current || progressListenerIdRef.current !== listenerId) {
      unlisten();
      return;
    }

    progressUnlistenRef.current = unlisten;
  }

  async function loadSemanticStatus() {
    try {
      const status = await api.getSemanticStatus();

      if (isMountedRef.current) {
        setSemanticStatus(status);
      }
    } catch {
      // Ollama not available
    }
  }

  useEffect(() => {
    if (settings.ollama_enabled && settings.semantic_search_enabled) {
      loadSemanticStatus();
    }
  }, [settings.ollama_enabled, settings.semantic_search_enabled]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      cleanupProgressListener();
    };
  }, []);

  const handleReindexAll = async () => {
    if (!settings.semantic_search_enabled) {
      showToast("Semantic search is not enabled");
      return;
    }

    setIsIndexing(true);
    setIndexProgress(0);
    setIndexProgressDetails({
      indexed: 0,
      total: semanticStatus?.total_tracks ?? null,
      currentTrack: null,
      percentage: 0,
      estimatedTimeRemainingSeconds: null,
    });

    try {
      await registerProgressListener();

      if (!isMountedRef.current) {
        return;
      }

      await api.semanticIndexAll();
      cleanupProgressListener();

      if (isMountedRef.current) {
        setIndexProgress(100);
        setIndexProgressDetails((current) => current ? { ...current, percentage: 100 } : current);
      }

      await loadSemanticStatus();
      showToast("Library indexed successfully!");
    } catch (error) {
      cleanupProgressListener();
      showToast("Indexing failed: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      if (isMountedRef.current) {
        setIsIndexing(false);
      }
    }
  };

  const handleClearIndex = async () => {
    if (confirm("Clear all semantic embeddings? You can re-index anytime.")) {
      try {
        await api.semanticClearIndex();
        setSemanticStatus(null);
        setIndexProgress(0);
        setIndexProgressDetails(null);
        await loadSemanticStatus();
        showToast("Semantic index cleared successfully!");
      } catch (error) {
        showToast("Failed to clear index: " + (error instanceof Error ? error.message : String(error)));
      }
    }
  };

  if (!settings.ollama_enabled) return null;

  const displayedIndexedTracks = isIndexing
    ? indexProgressDetails?.indexed ?? semanticStatus?.indexed_tracks ?? 0
    : semanticStatus?.indexed_tracks ?? 0;
  const displayedTotalTracks = isIndexing
    ? indexProgressDetails?.total ?? semanticStatus?.total_tracks ?? 0
    : semanticStatus?.total_tracks ?? 0;
  const displayedProgressPercentage = isIndexing
    ? indexProgress
    : semanticStatus && semanticStatus.total_tracks > 0
      ? (semanticStatus.indexed_tracks / semanticStatus.total_tracks) * 100
      : 0;
  const currentTrackLabel = isIndexing ? indexProgressDetails?.currentTrack : null;

  return (
    <section className="bg-ytm-surface rounded-xl p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Brain className="w-6 h-6 text-ytm-accent" />
        <div className="flex-grow">
          <h2 className="text-lg font-semibold">Semantic Search</h2>
          <p className="text-sm text-ytm-text-secondary">Find similar songs from your library using AI embeddings</p>
        </div>
        <label className="relative inline-block cursor-pointer">
          <input
            type="checkbox"
            checked={settings.semantic_search_enabled}
            onChange={(e) => onUpdate({ semantic_search_enabled: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-ytm-border rounded-full peer peer-checked:bg-ytm-accent transition-colors">
            <div className={clsx("absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform", settings.semantic_search_enabled && "translate-x-5")} />
          </div>
        </label>
      </div>

      {settings.semantic_search_enabled && (
        <div className="space-y-4 pt-2 border-t border-ytm-border">
          {/* Embedding Model */}
          <div>
            <label className="block text-sm font-medium mb-2">Embedding Model</label>
            <select
              value={settings.embedding_model}
              onChange={(e) => onUpdate({ embedding_model: e.target.value })}
              className="w-full px-4 py-2 bg-ytm-bg border border-ytm-border rounded-lg focus:outline-none focus:border-ytm-accent"
            >
              <option value="all-minilm">all-minilm (Fast, 384D) - Recommended</option>
              <option value="nomic-embed-text">nomic-embed-text (Quality, 768D)</option>
              <option value="mxbai-embed-large">mxbai-embed-large (Best, 1024D)</option>
            </select>
            <p className="text-xs text-ytm-text-secondary mt-1">Changing model will require re-indexing your library</p>
          </div>

          {/* Index Status */}
          <div className="bg-ytm-bg rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium">Index Status</span>
              <button
                onClick={loadSemanticStatus}
                disabled={isIndexing}
                className="text-xs text-ytm-accent hover:text-ytm-accent-hover transition-colors"
              >
                <RefreshCw className="w-4 h-4 inline" /> Refresh
              </button>
            </div>
            {semanticStatus || isIndexing ? (
              <>
                <div className="text-sm text-ytm-text-secondary mb-2">
                  {displayedIndexedTracks} / {displayedTotalTracks} tracks indexed
                </div>
                {currentTrackLabel && (
                  <div className="text-xs text-ytm-text-secondary mb-2 truncate" title={currentTrackLabel}>
                    Indexing: {currentTrackLabel}
                  </div>
                )}
                <div className="w-full bg-ytm-border rounded-full h-2">
                  <div
                    className="bg-ytm-accent h-2 rounded-full transition-all"
                    style={{ width: `${displayedProgressPercentage}%` }}
                  />
                </div>
              </>
            ) : (
              <div className="text-sm text-ytm-text-secondary">Loading status...</div>
            )}
          </div>

          {/* Re-index Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleReindexAll}
              disabled={isIndexing}
              className={clsx(
                "flex-1 px-4 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2",
                isIndexing ? "bg-ytm-accent/50 text-white cursor-not-allowed" : "bg-ytm-accent text-white hover:bg-ytm-accent-hover"
              )}
            >
              {isIndexing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Indexing {indexProgress}%
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" /> Re-index All
                </>
              )}
            </button>
            <button
              onClick={handleClearIndex}
              disabled={isIndexing}
              className="flex-1 px-4 py-2 rounded-lg font-medium transition-colors bg-ytm-surface text-ytm-text-secondary hover:bg-red-500/20 hover:text-red-400 border border-ytm-border"
            >
              Clear Index
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
