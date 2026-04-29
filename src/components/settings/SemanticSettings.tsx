import { useState, useEffect } from "react";
import { Brain, Loader2, RefreshCw, Zap } from "lucide-react";
import clsx from "clsx";
import * as api from "../../api";
import { showToast } from "../Toast";
import type { Settings as SettingsType, SemanticIndexStatus } from "../../types";

interface Props {
  settings: SettingsType;
  onUpdate: (partial: Partial<SettingsType>) => void;
}

export function SemanticSettings({ settings, onUpdate }: Props) {
  const [semanticStatus, setSemanticStatus] = useState<SemanticIndexStatus | null>(null);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState(0);

  useEffect(() => {
    if (settings.ollama_enabled && settings.semantic_search_enabled) {
      loadSemanticStatus();
    }
  }, [settings.ollama_enabled, settings.semantic_search_enabled]);

  const loadSemanticStatus = async () => {
    try {
      const status = await api.getSemanticStatus();
      setSemanticStatus(status);
    } catch {
      // Ollama not available
    }
  };

  const handleReindexAll = async () => {
    if (!settings.semantic_search_enabled) {
      showToast("Semantic search is not enabled");
      return;
    }
    setIsIndexing(true);
    setIndexProgress(0);
    try {
      await api.semanticIndexAll();
      setIndexProgress(100);
      await loadSemanticStatus();
      showToast("Library indexed successfully!");
    } catch (error) {
      showToast("Indexing failed: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsIndexing(false);
    }
  };

  const handleClearIndex = async () => {
    if (confirm("Clear all semantic embeddings? You can re-index anytime.")) {
      try {
        await api.semanticClearIndex();
        setSemanticStatus(null);
        setIndexProgress(0);
        await loadSemanticStatus();
        showToast("Semantic index cleared successfully!");
      } catch (error) {
        showToast("Failed to clear index: " + (error instanceof Error ? error.message : String(error)));
      }
    }
  };

  if (!settings.ollama_enabled) return null;

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
              <button onClick={loadSemanticStatus} disabled={isIndexing}
                className="text-xs text-ytm-accent hover:text-ytm-accent-hover transition-colors">
                <RefreshCw className="w-4 h-4 inline" /> Refresh
              </button>
            </div>
            {semanticStatus ? (
              <>
                <div className="text-sm text-ytm-text-secondary mb-2">
                  {semanticStatus.indexed_tracks} / {semanticStatus.total_tracks} tracks indexed
                </div>
                <div className="w-full bg-ytm-border rounded-full h-2">
                  <div className="bg-ytm-accent h-2 rounded-full transition-all"
                    style={{ width: semanticStatus.total_tracks > 0 ? `${(semanticStatus.indexed_tracks / semanticStatus.total_tracks) * 100}%` : "0%" }} />
                </div>
              </>
            ) : (
              <div className="text-sm text-ytm-text-secondary">Loading status...</div>
            )}
          </div>

          {/* Re-index Buttons */}
          <div className="flex gap-3 pt-2">
            <button onClick={handleReindexAll} disabled={isIndexing}
              className={clsx(
                "flex-1 px-4 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2",
                isIndexing ? "bg-ytm-accent/50 text-white cursor-not-allowed" : "bg-ytm-accent text-white hover:bg-ytm-accent-hover"
              )}>
              {isIndexing ? <><Loader2 className="w-4 h-4 animate-spin" /> Indexing {indexProgress}%</>
                : <><Zap className="w-4 h-4" /> Re-index All</>}
            </button>
            <button onClick={handleClearIndex} disabled={isIndexing}
              className="flex-1 px-4 py-2 rounded-lg font-medium transition-colors bg-ytm-surface text-ytm-text-secondary hover:bg-red-500/20 hover:text-red-400 border border-ytm-border">
              Clear Index
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
