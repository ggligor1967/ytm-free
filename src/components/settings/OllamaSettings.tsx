import { useState } from "react";
import { Brain, Loader2, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import clsx from "clsx";
import * as api from "../../api";
import type { Settings as SettingsType } from "../../types";

interface Props {
  settings: SettingsType;
  onUpdate: (partial: Partial<SettingsType>) => void;
  ollamaModels: string[];
  setOllamaModels: (models: string[]) => void;
}

export function OllamaSettings({ settings, onUpdate, ollamaModels, setOllamaModels }: Props) {
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "success" | "error">("idle");
  const [loadingModels, setLoadingModels] = useState(false);

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionStatus("idle");
    try {
      const available = await api.ollamaCheckAvailable(settings.ollama_url);
      setConnectionStatus(available ? "success" : "error");
      setTimeout(() => setConnectionStatus("idle"), 3000);
      if (available) handleLoadModels();
    } catch {
      setConnectionStatus("error");
      setTimeout(() => setConnectionStatus("idle"), 3000);
    } finally {
      setTestingConnection(false);
    }
  };

  const handleLoadModels = async () => {
    setLoadingModels(true);
    try {
      const models = await api.ollamaListModels(settings.ollama_url);
      setOllamaModels(models);
      if (models.length > 0 && !models.includes(settings.ollama_model)) {
        onUpdate({ ollama_model: models[0] });
      }
    } catch (error) {
      console.error("Failed to load Ollama models:", error);
    } finally {
      setLoadingModels(false);
    }
  };

  const Toggle = ({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) => (
    <label className="relative inline-block cursor-pointer">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
      <div className="w-11 h-6 bg-ytm-border rounded-full peer peer-checked:bg-ytm-accent transition-colors">
        <div className={clsx("absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform", checked && "translate-x-5")} />
      </div>
    </label>
  );

  return (
    <section className="bg-ytm-surface rounded-xl p-6 space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <Brain className="w-6 h-6 text-ytm-accent" />
        <h2 className="text-lg font-semibold">AI Assistant (Ollama)</h2>
      </div>

      {/* Enable Ollama */}
      <div className="flex items-center justify-between">
        <div>
          <label className="font-medium">Enable Ollama AI</label>
          <p className="text-sm text-ytm-text-secondary">Use local AI for smart search and recommendations</p>
        </div>
        <Toggle checked={settings.ollama_enabled} onChange={(v) => onUpdate({ ollama_enabled: v })} />
      </div>

      {/* Ollama URL */}
      <div className={clsx(!settings.ollama_enabled && "opacity-50")}>
        <label className="block text-sm font-medium mb-2">Ollama URL</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={settings.ollama_url}
            onChange={(e) => onUpdate({ ollama_url: e.target.value })}
            disabled={!settings.ollama_enabled}
            placeholder="http://localhost:11434"
            className="flex-1 px-4 py-2 bg-ytm-bg border border-ytm-border rounded-lg focus:outline-none focus:border-ytm-accent disabled:opacity-50"
          />
          <button
            onClick={handleTestConnection}
            disabled={!settings.ollama_enabled || testingConnection}
            className={clsx(
              "px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2",
              connectionStatus === "success" && "bg-green-600 text-white",
              connectionStatus === "error" && "bg-red-600 text-white",
              connectionStatus === "idle" && "bg-ytm-accent text-white hover:bg-ytm-accent-hover",
              "disabled:opacity-50"
            )}
          >
            {testingConnection ? <Loader2 className="w-4 h-4 animate-spin" />
              : connectionStatus === "success" ? <CheckCircle2 className="w-4 h-4" />
              : connectionStatus === "error" ? <XCircle className="w-4 h-4" /> : null}
            {connectionStatus === "success" ? "Connected" : connectionStatus === "error" ? "Failed" : "Test"}
          </button>
        </div>
      </div>

      {/* Model Selection */}
      <div className={clsx(!settings.ollama_enabled && "opacity-50")}>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium">Model</label>
          <button
            onClick={handleLoadModels}
            disabled={!settings.ollama_enabled || loadingModels}
            className="text-sm text-ytm-accent hover:text-ytm-accent-hover flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw className={clsx("w-4 h-4", loadingModels && "animate-spin")} />
            Refresh Models
          </button>
        </div>
        <input
          type="text"
          value={settings.ollama_model}
          onChange={(e) => onUpdate({ ollama_model: e.target.value })}
          disabled={!settings.ollama_enabled}
          placeholder="e.g. mistral:7b, llama3.2:3b"
          className="w-full px-4 py-2 bg-ytm-bg border border-ytm-border rounded-lg focus:outline-none focus:border-ytm-accent disabled:opacity-50"
        />
        {ollamaModels.length > 0 && (
          <div className="mt-2">
            <p className="text-xs text-ytm-text-secondary mb-2">Available models — click to select:</p>
            <div className="flex flex-wrap gap-2">
              {ollamaModels.map((model) => (
                <button
                  key={model}
                  onClick={() => onUpdate({ ollama_model: model })}
                  disabled={!settings.ollama_enabled}
                  className={clsx(
                    "px-3 py-1.5 rounded-lg text-sm transition-colors border",
                    settings.ollama_model === model
                      ? "border-ytm-accent bg-ytm-accent/10 text-ytm-accent"
                      : "border-ytm-border bg-ytm-bg hover:border-ytm-text-secondary",
                    "disabled:opacity-50"
                  )}
                >
                  {model}
                </button>
              ))}
            </div>
          </div>
        )}
        {ollamaModels.length === 0 && settings.ollama_enabled && (
          <p className="text-xs text-ytm-text-secondary mt-2">No models detected. Click "Refresh Models" or type a model name manually.</p>
        )}
      </div>

      {/* AI Feature Toggles */}
      {([
        ["smart_search_enabled", "Enhance Search with AI", "Generate additional search queries for better results"],
        ["auto_tagging_enabled", "Auto-tag Tracks with AI", "Automatically classify genre, mood, and energy level"],
        ["smart_queue_enabled", "Smart Queue", "AI-powered playlist continuation based on mood and energy"],
        ["daily_mix_enabled", "Daily Mix", "Auto-generate a personalized playlist at startup based on your listening habits"],
      ] as const).map(([key, label, desc]) => (
        <div key={key} className={clsx("flex items-center justify-between", !settings.ollama_enabled && "opacity-50")}>
          <div>
            <label className="font-medium">{label}</label>
            <p className="text-sm text-ytm-text-secondary">{desc}</p>
          </div>
          <Toggle
            checked={settings[key] as boolean}
            disabled={!settings.ollama_enabled}
            onChange={(v) => onUpdate({ [key]: v } as Partial<SettingsType>)}
          />
        </div>
      ))}
    </section>
  );
}
