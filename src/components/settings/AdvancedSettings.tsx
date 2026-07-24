import { useState } from "react";
import { Brain, HardDrive, Loader2, Sparkles } from "lucide-react";
import clsx from "clsx";
import * as api from "../../api";
import { showToast } from "../../lib/toast";
import type { Settings as SettingsType, SettingsAdviceResponse, StorageAnalysisResponse } from "../../types";

interface Props {
  settings: SettingsType;
}

export function AdvancedSettings({ settings }: Props) {
  const [settingsAdvice, setSettingsAdvice] = useState<SettingsAdviceResponse | null>(null);
  const [settingsAdviceLoading, setSettingsAdviceLoading] = useState(false);
  const [storageAnalysis, setStorageAnalysis] = useState<StorageAnalysisResponse | null>(null);
  const [storageAnalysisLoading, setStorageAnalysisLoading] = useState(false);

  if (!settings.ollama_enabled) return null;

  return (
    <>
      {/* AI Settings Advisor */}
      <section className="bg-ytm-surface rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-ytm-accent" />
            <div>
              <h2 className="text-lg font-semibold">AI Settings Advisor</h2>
              <p className="text-sm text-ytm-text-secondary">Get optimization suggestions based on your usage</p>
            </div>
          </div>
          <button
            onClick={async () => {
              setSettingsAdviceLoading(true);
              try {
                const advice = await api.aiSettingsAdvice();
                setSettingsAdvice(advice);
              } catch {
                showToast("Failed to get settings advice", "error");
              } finally {
                setSettingsAdviceLoading(false);
              }
            }}
            disabled={settingsAdviceLoading}
            className="flex items-center gap-2 px-4 py-2 bg-ytm-accent text-white rounded-lg hover:bg-ytm-accent/80 disabled:opacity-50 transition-colors"
          >
            {settingsAdviceLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
            {settingsAdvice ? "Refresh" : "Optimize"}
          </button>
        </div>

        {settingsAdviceLoading && !settingsAdvice && (
          <div className="flex items-center gap-2 py-6 justify-center text-ytm-text-secondary text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Analyzing your settings...
          </div>
        )}

        {settingsAdvice && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <span className="text-sm text-ytm-text-secondary">Score:</span>
                <span className={clsx("text-lg font-bold",
                  settingsAdvice.overall_score >= 8 ? "text-green-400" :
                  settingsAdvice.overall_score >= 5 ? "text-yellow-400" : "text-red-400"
                )}>
                  {settingsAdvice.overall_score}/10
                </span>
              </div>
              <p className="text-sm text-ytm-text-secondary flex-1">{settingsAdvice.summary}</p>
            </div>

            {settingsAdvice.suggestions.length > 0 && (
              <div className="space-y-2">
                {settingsAdvice.suggestions.map((s, i) => (
                  <div key={i} className="bg-ytm-bg rounded-lg p-3 border border-ytm-border">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-ytm-accent">{s.setting}</span>
                      <span className="text-xs text-ytm-text-secondary">
                        {s.current} → <span className="text-green-400">{s.recommended}</span>
                      </span>
                    </div>
                    <p className="text-xs text-ytm-text-secondary">{s.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Storage Analyzer */}
      <section className="bg-ytm-surface rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HardDrive className="w-6 h-6 text-ytm-accent" />
            <div>
              <h2 className="text-lg font-semibold">Storage Analyzer</h2>
              <p className="text-sm text-ytm-text-secondary">Analyze disk usage and find space savings</p>
            </div>
          </div>
          <button
            onClick={async () => {
              setStorageAnalysisLoading(true);
              try {
                const analysis = await api.aiStorageAnalysis();
                setStorageAnalysis(analysis);
              } catch {
                showToast("Storage analysis failed", "error");
              } finally {
                setStorageAnalysisLoading(false);
              }
            }}
            disabled={storageAnalysisLoading}
            className="flex items-center gap-2 px-4 py-2 bg-ytm-accent text-white rounded-lg hover:bg-ytm-accent/80 disabled:opacity-50 transition-colors"
          >
            {storageAnalysisLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <HardDrive className="w-4 h-4" />}
            {storageAnalysis ? "Refresh" : "Analyze"}
          </button>
        </div>

        {storageAnalysisLoading && !storageAnalysis && (
          <div className="flex items-center gap-2 py-6 justify-center text-ytm-text-secondary text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Scanning storage...
          </div>
        )}

        {storageAnalysis && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-ytm-bg rounded-lg p-3 border border-ytm-border text-center">
                <p className="text-2xl font-bold text-white">{storageAnalysis.total_size_mb} MB</p>
                <p className="text-xs text-ytm-text-secondary">Estimated Total</p>
              </div>
              <div className="bg-ytm-bg rounded-lg p-3 border border-ytm-border text-center">
                <p className="text-2xl font-bold text-white">{storageAnalysis.tracks_analyzed}</p>
                <p className="text-xs text-ytm-text-secondary">Tracks Analyzed</p>
              </div>
            </div>
            <p className="text-sm text-ytm-text-secondary">{storageAnalysis.summary}</p>

            {storageAnalysis.suggestions.length > 0 && (
              <div className="space-y-2">
                {storageAnalysis.suggestions.map((s, i) => (
                  <div key={i} className="bg-ytm-bg rounded-lg p-3 border border-ytm-border flex items-center justify-between">
                    <div>
                      <p className="text-sm">{s.action}</p>
                      <p className="text-xs text-ytm-text-secondary">{s.affected_tracks} tracks · ~{s.savings_mb} MB savings</p>
                    </div>
                    <span className="text-green-400 text-sm font-medium">-{s.savings_mb}MB</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
