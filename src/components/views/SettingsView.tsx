import { useState } from "react";
import { useAppStore } from "../../store";
import * as api from "../../api";
import { GeneralSettings } from "../settings/GeneralSettings";
import { OllamaSettings } from "../settings/OllamaSettings";
import { DJSettings } from "../settings/DJSettings";
import { SemanticSettings } from "../settings/SemanticSettings";
import { AdvancedSettings } from "../settings/AdvancedSettings";
import { Save, Loader2, Volume2, Brain, Sparkles, Search, HardDrive } from "lucide-react";
import clsx from "clsx";
import type { Settings as SettingsType } from "../../types";

const TABS = [
  { id: "general", label: "General", icon: Volume2 },
  { id: "ollama", label: "AI", icon: Brain },
  { id: "dj", label: "DJ", icon: Sparkles },
  { id: "semantic", label: "Semantic", icon: Search },
  { id: "advanced", label: "Advanced", icon: HardDrive },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SettingsView() {
  const { settings, setSettings, ollamaModels, setOllamaModels, setOllamaAvailable } = useAppStore();
  const [localSettings, setLocalSettings] = useState<SettingsType | null>(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("general");

  if (!localSettings) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-ytm-accent" />
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateSettings(localSettings);
      setSettings(localSettings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);

      if (localSettings.ollama_enabled) {
        try {
          const available = await api.ollamaCheckAvailable(localSettings.ollama_url);
          setOllamaAvailable(available);
          if (available) {
            const models = await api.ollamaListModels(localSettings.ollama_url);
            setOllamaModels(models);
          }
        } catch {
          setOllamaAvailable(false);
        }
      } else {
        setOllamaAvailable(false);
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
    } finally {
      setSaving(false);
    }
  };

  const onUpdate = (partial: Partial<SettingsType>) => {
    setLocalSettings((prev) => prev ? { ...prev, ...partial } : prev);
  };

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-ytm-text-secondary">Customize your experience</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={clsx(
            "flex items-center gap-2 px-6 py-2 rounded-full font-medium transition-colors",
            saved ? "bg-green-600 text-white" : "bg-ytm-accent text-white hover:bg-ytm-accent-hover",
            "disabled:opacity-50"
          )}
        >
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
          {saved ? "Saved!" : "Save Changes"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-ytm-surface rounded-xl p-1 border border-ytm-border overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap",
              activeTab === tab.id
                ? "bg-ytm-accent text-white"
                : "text-ytm-text-secondary hover:text-white hover:bg-ytm-surface-hover"
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "general" && <GeneralSettings settings={localSettings} onUpdate={onUpdate} />}
      {activeTab === "ollama" && (
        <OllamaSettings
          settings={localSettings}
          onUpdate={onUpdate}
          ollamaModels={ollamaModels}
          setOllamaModels={setOllamaModels}
        />
      )}
      {activeTab === "dj" && <DJSettings settings={localSettings} onUpdate={onUpdate} />}
      {activeTab === "semantic" && <SemanticSettings settings={localSettings} onUpdate={onUpdate} />}
      {activeTab === "advanced" && <AdvancedSettings settings={localSettings} />}

      {/* About */}
      <section className="bg-ytm-surface rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4">About</h2>
        <div className="space-y-2 text-sm text-ytm-text-secondary">
          <p><strong className="text-white">YTM Free</strong> v0.1.0</p>
          <p>A personal music streaming app powered by yt-dlp.</p>
          <p>For personal use only. Respects YouTube's Terms of Service.</p>
          <p className="pt-2">Built with Tauri, React, and Rust.</p>
        </div>
      </section>
    </div>
  );
}
