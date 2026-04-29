import { useState } from "react";
import { useAppStore } from "../../store";
import * as api from "../../api";
import { showToast } from "../Toast";
import { VoiceSelector } from "../VoiceSelector";
import { Settings, Save, Loader2, FolderOpen, Volume2, Brain, RefreshCw, CheckCircle2, XCircle, Search, Sparkles, HardDrive, Zap } from "lucide-react";
import clsx from "clsx";
import type { Settings as SettingsType, SettingsAdviceResponse, StorageAnalysisResponse, SemanticIndexStatus } from "../../types";

export function SettingsView() {
  const { settings, setSettings, ollamaModels, setOllamaModels, setOllamaAvailable } = useAppStore();
  const [localSettings, setLocalSettings] = useState<SettingsType | null>(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [loadingModels, setLoadingModels] = useState(false);
  const [settingsAdvice, setSettingsAdvice] = useState<SettingsAdviceResponse | null>(null);
  const [settingsAdviceLoading, setSettingsAdviceLoading] = useState(false);
  const [storageAnalysis, setStorageAnalysis] = useState<StorageAnalysisResponse | null>(null);
  const [storageAnalysisLoading, setStorageAnalysisLoading] = useState(false);
  const [semanticStatus, setSemanticStatus] = useState<SemanticIndexStatus | null>(null);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState(0);
  const [testingTts, setTestingTts] = useState(false);

  const EDGE_TTS_VOICES = [
    { value: 'en-US-ChristopherNeural', label: '🇺🇸 Christopher (EN-US, Male)' },
    { value: 'en-US-AriaNeural',        label: '🇺🇸 Aria (EN-US, Female)' },
    { value: 'en-GB-RyanNeural',        label: '🇬🇧 Ryan (EN-GB, Male)' },
    { value: 'en-GB-SoniaNeural',       label: '🇬🇧 Sonia (EN-GB, Female)' },
    { value: 'ro-RO-EmilNeural',        label: '🇷🇴 Emil (RO, Male)' },
    { value: 'ro-RO-AlinaNeural',       label: '🇷🇴 Alina (RO, Female)' },
  ] as const;

  const handleTestTtsVoice = async () => {
    if (!localSettings || testingTts) return;
    const sampleText = localSettings.dj_language === 'Română'
      ? 'Salut! Aceasta este vocea DJ-ului tău.'
      : 'Hey there! This is your AI DJ voice preview.';
    setTestingTts(true);
    try {
      const voice = localSettings.dj_voice || 'en-US-ChristopherNeural';
      const url = await api.speakWithEdgeTts(sampleText, voice, localSettings.dj_rate ?? 1.05, localSettings.dj_pitch ?? 1.0);
      const audio = new Audio(url);
      audio.onended = () => setTestingTts(false);
      audio.onerror = () => setTestingTts(false);
      audio.play().catch(() => setTestingTts(false));
    } catch (err) {
      showToast('edge-tts not installed. Run: pip install edge-tts', 'error');
      setTestingTts(false);
    }
  };

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

      // Update Ollama availability in store after saving
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

  const updateSetting = <K extends keyof SettingsType>(
    key: K,
    value: SettingsType[K]
  ) => {
    setLocalSettings({ ...localSettings, [key]: value });
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionStatus('idle');
    try {
      const available = await api.ollamaCheckAvailable(localSettings.ollama_url);
      setConnectionStatus(available ? 'success' : 'error');
      setTimeout(() => setConnectionStatus('idle'), 3000);
      // Auto-load models on successful connection
      if (available) {
        handleLoadModels();
      }
    } catch (error) {
      console.error("Ollama connection test failed:", error);
      setConnectionStatus('error');
      setTimeout(() => setConnectionStatus('idle'), 3000);
    } finally {
      setTestingConnection(false);
    }
  };

  const handleLoadModels = async () => {
    setLoadingModels(true);
    try {
      const models = await api.ollamaListModels(localSettings.ollama_url);
      setOllamaModels(models);
      // If current model not in list and list not empty, select first one
      if (models.length > 0 && !models.includes(localSettings.ollama_model)) {
        updateSetting('ollama_model', models[0]);
      }
    } catch (error) {
      console.error("Failed to load Ollama models:", error);
    } finally {
      setLoadingModels(false);
    }
  };

  const loadSemanticStatus = async () => {
    try {
      const status = await api.getSemanticStatus();
      setSemanticStatus(status);
    } catch (error) {
      console.error("Failed to load semantic status:", error);
    }
  };

  const handleReindexAll = async () => {
    if (!localSettings?.semantic_search_enabled) {
      showToast("Semantic search is not enabled");
      return;
    }

    setIsIndexing(true);
    setIndexProgress(0);

    try {
      // Start indexing
      await api.semanticIndexAll();
      setIndexProgress(100);
      await loadSemanticStatus();
      showToast("Library indexed successfully!");
    } catch (error) {
      console.error("Indexing error:", error);
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
        console.error("Failed to clear index:", error);
        showToast("Failed to clear index: " + (error instanceof Error ? error.message : String(error)));
      }
    }
  };

  return (
    <div className="max-w-2xl space-y-8">
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
            saved
              ? "bg-green-600 text-white"
              : "bg-ytm-accent text-white hover:bg-ytm-accent-hover",
            "disabled:opacity-50"
          )}
        >
          {saving ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Save className="w-5 h-5" />
          )}
          {saved ? "Saved!" : "Save Changes"}
        </button>
      </div>

      {/* Audio Settings */}
      <section className="bg-ytm-surface rounded-xl p-6 space-y-6">
        <div className="flex items-center gap-3 mb-4">
          <Volume2 className="w-6 h-6 text-ytm-accent" />
          <h2 className="text-lg font-semibold">Audio</h2>
        </div>

        {/* Audio Quality */}
        <div>
          <label className="block text-sm font-medium mb-2">Audio Quality</label>
          <select
            value={localSettings.audio_quality}
            onChange={(e) =>
              updateSetting("audio_quality", e.target.value as SettingsType["audio_quality"])
            }
            className="w-full px-4 py-2 bg-ytm-bg border border-ytm-border rounded-lg focus:outline-none focus:border-ytm-accent"
          >
            <option value="low">Low (64 kbps)</option>
            <option value="medium">Medium (128 kbps)</option>
            <option value="high">High (256 kbps)</option>
            <option value="best">Best (320 kbps)</option>
          </select>
          <p className="text-xs text-ytm-text-secondary mt-1">
            Higher quality uses more bandwidth
          </p>
        </div>

        {/* Volume */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Default Volume: {Math.round(localSettings.volume * 100)}%
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={localSettings.volume}
            onChange={(e) => updateSetting("volume", parseFloat(e.target.value))}
            className="w-full accent-ytm-accent"
          />
        </div>

        {/* Crossfade */}
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Crossfade</p>
            <p className="text-sm text-ytm-text-secondary">
              Smooth transition between tracks
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={localSettings.crossfade}
              onChange={(e) => updateSetting("crossfade", e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-ytm-border rounded-full peer peer-checked:bg-ytm-accent transition-colors">
              <div
                className={clsx(
                  "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform",
                  localSettings.crossfade && "translate-x-5"
                )}
              />
            </div>
          </label>
        </div>

        {localSettings.crossfade && (
          <div>
            <label className="block text-sm font-medium mb-2">
              Crossfade Duration: {localSettings.crossfade_duration}s
            </label>
            <input
              type="range"
              min={1}
              max={12}
              step={1}
              value={localSettings.crossfade_duration}
              onChange={(e) =>
                updateSetting("crossfade_duration", parseInt(e.target.value))
              }
              className="w-full accent-ytm-accent"
            />
          </div>
        )}
      </section>

      {/* Search Settings */}
      <section className="bg-ytm-surface rounded-xl p-6 space-y-6">
        <div className="flex items-center gap-3 mb-4">
          <Search className="w-6 h-6 text-ytm-accent" />
          <h2 className="text-lg font-semibold">Search</h2>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Search Results Count: {localSettings.search_results_count}
          </label>
          <input
            type="range"
            min={5}
            max={50}
            step={5}
            value={localSettings.search_results_count}
            onChange={(e) => updateSetting("search_results_count", parseInt(e.target.value))}
            className="w-full accent-ytm-accent"
          />
          <div className="flex justify-between text-xs text-ytm-text-secondary mt-1">
            <span>5</span>
            <span>25</span>
            <span>50</span>
          </div>
          <p className="text-xs text-ytm-text-secondary mt-1">
            Maximum number of YouTube results per search (more results = slower search)
          </p>
        </div>
      </section>

      {/* Downloads */}
      <section className="bg-ytm-surface rounded-xl p-6 space-y-6">
        <div className="flex items-center gap-3 mb-4">
          <FolderOpen className="w-6 h-6 text-ytm-accent" />
          <h2 className="text-lg font-semibold">Downloads</h2>
        </div>

        {/* Download Path */}
        <div>
          <label className="block text-sm font-medium mb-2">Download Location</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={localSettings.download_path}
              onChange={(e) => updateSetting("download_path", e.target.value)}
              className="flex-1 px-4 py-2 bg-ytm-bg border border-ytm-border rounded-lg focus:outline-none focus:border-ytm-accent text-sm"
            />
          </div>
          <p className="text-xs text-ytm-text-secondary mt-1">
            Where downloaded tracks will be saved
          </p>
        </div>

        {/* Auto Download */}
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Auto-download</p>
            <p className="text-sm text-ytm-text-secondary">
              Automatically download tracks when added to playlists
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={localSettings.auto_download}
              onChange={(e) => updateSetting("auto_download", e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-ytm-border rounded-full peer peer-checked:bg-ytm-accent transition-colors">
              <div
                className={clsx(
                  "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform",
                  localSettings.auto_download && "translate-x-5"
                )}
              />
            </div>
          </label>
        </div>
      </section>

      {/* Appearance */}
      <section className="bg-ytm-surface rounded-xl p-6 space-y-6">
        <div className="flex items-center gap-3 mb-4">
          <Settings className="w-6 h-6 text-ytm-accent" />
          <h2 className="text-lg font-semibold">Appearance</h2>
        </div>

        {/* Theme */}
        <div>
          <label className="block text-sm font-medium mb-2">Theme</label>
          <div className="flex gap-3">
            {(["dark", "light", "system"] as const).map((theme) => (
              <button
                key={theme}
                onClick={() => updateSetting("theme", theme)}
                className={clsx(
                  "flex-1 px-4 py-3 rounded-lg border transition-colors capitalize",
                  localSettings.theme === theme
                    ? "border-ytm-accent bg-ytm-accent/10"
                    : "border-ytm-border hover:border-ytm-text-secondary"
                )}
              >
                {theme}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* AI / Ollama */}
      <section className="bg-ytm-surface rounded-xl p-6 space-y-6">
        <div className="flex items-center gap-3 mb-4">
          <Brain className="w-6 h-6 text-ytm-accent" />
          <h2 className="text-lg font-semibold">AI Assistant (Ollama)</h2>
        </div>

        {/* Enable Ollama */}
        <div className="flex items-center justify-between">
          <div>
            <label className="font-medium">Enable Ollama AI</label>
            <p className="text-sm text-ytm-text-secondary">
              Use local AI for smart search and recommendations
            </p>
          </div>
          <label className="relative inline-block cursor-pointer">
            <input
              type="checkbox"
              checked={localSettings.ollama_enabled}
              onChange={(e) => updateSetting("ollama_enabled", e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-ytm-border rounded-full peer peer-checked:bg-ytm-accent transition-colors">
              <div
                className={clsx(
                  "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform",
                  localSettings.ollama_enabled && "translate-x-5"
                )}
              />
            </div>
          </label>
        </div>

        {/* Ollama URL */}
        <div className={clsx(!localSettings.ollama_enabled && "opacity-50")}>
          <label className="block text-sm font-medium mb-2">Ollama URL</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={localSettings.ollama_url}
              onChange={(e) => updateSetting("ollama_url", e.target.value)}
              disabled={!localSettings.ollama_enabled}
              placeholder="http://localhost:11434"
              className="flex-1 px-4 py-2 bg-ytm-bg border border-ytm-border rounded-lg focus:outline-none focus:border-ytm-accent disabled:opacity-50"
            />
            <button
              onClick={handleTestConnection}
              disabled={!localSettings.ollama_enabled || testingConnection}
              className={clsx(
                "px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2",
                connectionStatus === 'success' && "bg-green-600 text-white",
                connectionStatus === 'error' && "bg-red-600 text-white",
                connectionStatus === 'idle' && "bg-ytm-accent text-white hover:bg-ytm-accent-hover",
                "disabled:opacity-50"
              )}
            >
              {testingConnection ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : connectionStatus === 'success' ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : connectionStatus === 'error' ? (
                <XCircle className="w-4 h-4" />
              ) : null}
              {connectionStatus === 'success' ? 'Connected' : connectionStatus === 'error' ? 'Failed' : 'Test'}
            </button>
          </div>
        </div>

        {/* Model Selection */}
        <div className={clsx(!localSettings.ollama_enabled && "opacity-50")}>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium">Model</label>
            <button
              onClick={handleLoadModels}
              disabled={!localSettings.ollama_enabled || loadingModels}
              className="text-sm text-ytm-accent hover:text-ytm-accent-hover flex items-center gap-1 disabled:opacity-50"
            >
              <RefreshCw className={clsx("w-4 h-4", loadingModels && "animate-spin")} />
              Refresh Models
            </button>
          </div>
          <div className="space-y-2">
            <input
              type="text"
              value={localSettings.ollama_model}
              onChange={(e) => updateSetting("ollama_model", e.target.value)}
              disabled={!localSettings.ollama_enabled}
              placeholder="e.g. mistral:7b, llama3.2:3b"
              className="w-full px-4 py-2 bg-ytm-bg border border-ytm-border rounded-lg focus:outline-none focus:border-ytm-accent disabled:opacity-50"
            />
            {ollamaModels.length > 0 && (
              <div>
                <p className="text-xs text-ytm-text-secondary mb-2">Available models — click to select:</p>
                <div className="flex flex-wrap gap-2">
                  {ollamaModels.map((model) => (
                    <button
                      key={model}
                      onClick={() => updateSetting("ollama_model", model)}
                      disabled={!localSettings.ollama_enabled}
                      className={clsx(
                        "px-3 py-1.5 rounded-lg text-sm transition-colors border",
                        localSettings.ollama_model === model
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
            {ollamaModels.length === 0 && localSettings.ollama_enabled && (
              <p className="text-xs text-ytm-text-secondary">
                No models detected. Click "Refresh Models" or type a model name manually.
              </p>
            )}
          </div>
        </div>

        {/* Smart Search Toggle */}
        <div className={clsx("flex items-center justify-between", !localSettings.ollama_enabled && "opacity-50")}>
          <div>
            <label className="font-medium">Enhance Search with AI</label>
            <p className="text-sm text-ytm-text-secondary">
              Generate additional search queries for better results
            </p>
          </div>
          <label className="relative inline-block cursor-pointer">
            <input
              type="checkbox"
              checked={localSettings.smart_search_enabled}
              onChange={(e) => updateSetting("smart_search_enabled", e.target.checked)}
              disabled={!localSettings.ollama_enabled}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-ytm-border rounded-full peer peer-checked:bg-ytm-accent transition-colors">
              <div
                className={clsx(
                  "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform",
                  localSettings.smart_search_enabled && "translate-x-5"
                )}
              />
            </div>
          </label>
        </div>

        {/* Auto Tagging Toggle */}
        <div className={clsx("flex items-center justify-between", !localSettings.ollama_enabled && "opacity-50")}>
          <div>
            <label className="font-medium">Auto-tag Tracks with AI</label>
            <p className="text-sm text-ytm-text-secondary">
              Automatically classify genre, mood, and energy level
            </p>
          </div>
          <label className="relative inline-block cursor-pointer">
            <input
              type="checkbox"
              checked={localSettings.auto_tagging_enabled}
              onChange={(e) => updateSetting("auto_tagging_enabled", e.target.checked)}
              disabled={!localSettings.ollama_enabled}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-ytm-border rounded-full peer peer-checked:bg-ytm-accent transition-colors">
              <div
                className={clsx(
                  "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform",
                  localSettings.auto_tagging_enabled && "translate-x-5"
                )}
              />
            </div>
          </label>
        </div>

        {/* Smart Queue Toggle */}
        <div className={clsx("flex items-center justify-between", !localSettings.ollama_enabled && "opacity-50")}>
          <div>
            <label className="font-medium">Smart Queue</label>
            <p className="text-sm text-ytm-text-secondary">
              AI-powered playlist continuation based on mood and energy
            </p>
          </div>
          <label className="relative inline-block cursor-pointer">
            <input
              type="checkbox"
              checked={localSettings.smart_queue_enabled}
              onChange={(e) => updateSetting("smart_queue_enabled", e.target.checked)}
              disabled={!localSettings.ollama_enabled}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-ytm-border rounded-full peer peer-checked:bg-ytm-accent transition-colors">
              <div
                className={clsx(
                  "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform",
                  localSettings.smart_queue_enabled && "translate-x-5"
                )}
              />
            </div>
          </label>
        </div>

        {/* Daily Mix Toggle */}
        <div className={clsx("flex items-center justify-between", !localSettings.ollama_enabled && "opacity-50")}>
          <div>
            <label className="font-medium">Daily Mix 🧠</label>
            <p className="text-sm text-ytm-text-secondary">
              Auto-generate a personalized playlist at startup based on your listening habits
            </p>
          </div>
          <label className="relative inline-block cursor-pointer">
            <input
              type="checkbox"
              checked={localSettings.daily_mix_enabled}
              onChange={(e) => updateSetting("daily_mix_enabled", e.target.checked)}
              disabled={!localSettings.ollama_enabled}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-ytm-border rounded-full peer peer-checked:bg-ytm-accent transition-colors">
              <div
                className={clsx(
                  "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform",
                  localSettings.daily_mix_enabled && "translate-x-5"
                )}
              />
            </div>
          </label>
        </div>

        {/* AI DJ Mode */}
        <div className={clsx("space-y-3 pt-2 border-t border-ytm-border", !localSettings.ollama_enabled && "opacity-50")}>
          <div className="flex items-center justify-between">
            <div>
              <label className="font-medium">AI DJ Mode 🎙️</label>
              <p className="text-sm text-ytm-text-secondary">
                AI narrates transitions between songs like a radio DJ
              </p>
            </div>
            <label className="relative inline-block cursor-pointer">
              <input
                type="checkbox"
                checked={localSettings.dj_mode_enabled}
                onChange={(e) => updateSetting("dj_mode_enabled", e.target.checked)}
                disabled={!localSettings.ollama_enabled}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-ytm-border rounded-full peer peer-checked:bg-ytm-accent transition-colors">
                <div
                  className={clsx(
                    "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform",
                    localSettings.dj_mode_enabled && "translate-x-5"
                  )}
                />
              </div>
            </label>
          </div>

          {localSettings.dj_mode_enabled && localSettings.ollama_enabled && (
            <div className="space-y-3 pl-2">
              <div>
                <label className="text-sm text-ytm-text-secondary mb-1 block">DJ Style</label>
                <select
                  value={localSettings.dj_style}
                  onChange={(e) => updateSetting("dj_style", e.target.value)}
                  className="bg-ytm-bg border border-ytm-border rounded-lg px-3 py-2 text-sm w-full"
                >
                  <option value="classic_fm">🎵 Classic FM — Smooth & sophisticated</option>
                  <option value="hype">🔥 Hype — Energetic & exciting</option>
                  <option value="chill">🌊 Chill — Relaxed & laid-back</option>
                  <option value="fun">🎉 Fun — Playful with fun facts</option>
                  <option value="storyteller">📖 Storyteller — Deep musical context</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-ytm-text-secondary mb-1 block">Frequency</label>
                <select
                  value={localSettings.dj_frequency}
                  onChange={(e) => updateSetting("dj_frequency", Number(e.target.value))}
                  className="bg-ytm-bg border border-ytm-border rounded-lg px-3 py-2 text-sm w-full"
                >
                  <option value={1}>Every song</option>
                  <option value={3}>Every 3 songs</option>
                  <option value={5}>Every 5 songs</option>
                  <option value={0}>Random (~30%)</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-ytm-text-secondary mb-1 block">Language</label>
                <select
                  value={localSettings.dj_language}
                  onChange={(e) => updateSetting("dj_language", e.target.value)}
                  className="bg-ytm-bg border border-ytm-border rounded-lg px-3 py-2 text-sm w-full"
                >
                  <option value="English">🇬🇧 English</option>
                  <option value="Română">🇷🇴 Română</option>
                  <option value="Magyar">🇭🇺 Magyar</option>
                  <option value="Español">🇪🇸 Español</option>
                  <option value="Deutsch">🇩🇪 Deutsch</option>
                </select>
              </div>

              {/* DJ Triggers */}
              <div>
                <label className="text-sm text-ytm-text-secondary mb-2 block">Active Triggers</label>
                <div className="space-y-2 bg-ytm-bg-secondary p-3 rounded-lg">
                  <label className="flex items-center justify-between cursor-pointer group">
                    <span className="text-sm group-hover:text-white transition-colors">Track Start</span>
                    <input
                      type="checkbox"
                      checked={localSettings.dj_triggers_enabled?.track_start ?? true}
                      onChange={(e) =>
                        updateSetting("dj_triggers_enabled", {
                          ...localSettings.dj_triggers_enabled,
                          track_start: e.target.checked,
                        })
                      }
                      className="w-4 h-4 rounded border-ytm-border bg-ytm-bg checked:bg-ytm-accent"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer group">
                    <span className="text-sm group-hover:text-white transition-colors">Track End</span>
                    <input
                      type="checkbox"
                      checked={localSettings.dj_triggers_enabled?.track_end ?? true}
                      onChange={(e) =>
                        updateSetting("dj_triggers_enabled", {
                          ...localSettings.dj_triggers_enabled,
                          track_end: e.target.checked,
                        })
                      }
                      className="w-4 h-4 rounded border-ytm-border bg-ytm-bg checked:bg-ytm-accent"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer group">
                    <span className="text-sm group-hover:text-white transition-colors">Queue Empty</span>
                    <input
                      type="checkbox"
                      checked={localSettings.dj_triggers_enabled?.queue_empty ?? true}
                      onChange={(e) =>
                        updateSetting("dj_triggers_enabled", {
                          ...localSettings.dj_triggers_enabled,
                          queue_empty: e.target.checked,
                        })
                      }
                      className="w-4 h-4 rounded border-ytm-border bg-ytm-bg checked:bg-ytm-accent"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer group">
                    <span className="text-sm group-hover:text-white transition-colors">Long Session (30min)</span>
                    <input
                      type="checkbox"
                      checked={localSettings.dj_triggers_enabled?.long_session ?? true}
                      onChange={(e) =>
                        updateSetting("dj_triggers_enabled", {
                          ...localSettings.dj_triggers_enabled,
                          long_session: e.target.checked,
                        })
                      }
                      className="w-4 h-4 rounded border-ytm-border bg-ytm-bg checked:bg-ytm-accent"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer group">
                    <span className="text-sm group-hover:text-white transition-colors">First Track of Day</span>
                    <input
                      type="checkbox"
                      checked={localSettings.dj_triggers_enabled?.first_track_of_day ?? true}
                      onChange={(e) =>
                        updateSetting("dj_triggers_enabled", {
                          ...localSettings.dj_triggers_enabled,
                          first_track_of_day: e.target.checked,
                        })
                      }
                      className="w-4 h-4 rounded border-ytm-border bg-ytm-bg checked:bg-ytm-accent"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer group">
                    <span className="text-sm group-hover:text-white transition-colors">Milestone (50/100/500)</span>
                    <input
                      type="checkbox"
                      checked={localSettings.dj_triggers_enabled?.milestone ?? true}
                      onChange={(e) =>
                        updateSetting("dj_triggers_enabled", {
                          ...localSettings.dj_triggers_enabled,
                          milestone: e.target.checked,
                        })
                      }
                      className="w-4 h-4 rounded border-ytm-border bg-ytm-bg checked:bg-ytm-accent"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer group">
                    <span className="text-sm group-hover:text-white transition-colors">Time Announcement</span>
                    <input
                      type="checkbox"
                      checked={localSettings.dj_triggers_enabled?.time_announcement ?? true}
                      onChange={(e) =>
                        updateSetting("dj_triggers_enabled", {
                          ...localSettings.dj_triggers_enabled,
                          time_announcement: e.target.checked,
                        })
                      }
                      className="w-4 h-4 rounded border-ytm-border bg-ytm-bg checked:bg-ytm-accent"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer group">
                    <span className="text-sm group-hover:text-white transition-colors">Mood Shift</span>
                    <input
                      type="checkbox"
                      checked={localSettings.dj_triggers_enabled?.mood_shift ?? true}
                      onChange={(e) =>
                        updateSetting("dj_triggers_enabled", {
                          ...localSettings.dj_triggers_enabled,
                          mood_shift: e.target.checked,
                        })
                      }
                      className="w-4 h-4 rounded border-ytm-border bg-ytm-bg checked:bg-ytm-accent"
                    />
                  </label>
                  <div className="pt-2 mt-2 border-t border-ytm-border">
                    <p className="text-xs text-ytm-text-secondary">
                      User Request trigger is always available via the 📻 button in the player.
                    </p>
                  </div>
                </div>
              </div>

              {/* Voice Settings */}
              <div>
                <label className="text-sm text-ytm-text-secondary mb-2 block">Voice Settings</label>
                <div className="space-y-3 bg-ytm-bg-secondary p-3 rounded-lg">

                  {/* TTS Engine selector */}
                  <div>
                    <label className="text-sm text-ytm-text-secondary mb-1 block">TTS Engine</label>
                    <select
                      value={localSettings.tts_engine ?? 'web_speech'}
                      onChange={(e) => updateSetting("tts_engine", e.target.value as 'web_speech' | 'edge_tts')}
                      className="w-full bg-ytm-surface border border-ytm-border rounded-lg px-3 py-2 text-sm text-ytm-text focus:outline-none focus:border-ytm-accent"
                    >
                      <option value="web_speech">🗣️ Web Speech API (built-in, robotic)</option>
                      <option value="edge_tts">✨ Microsoft Neural (edge-tts, natural)</option>
                    </select>
                    {(localSettings.tts_engine ?? 'web_speech') === 'edge_tts' && (
                      <p className="text-xs text-ytm-text-secondary mt-1">
                        Requires Python: <code className="bg-ytm-surface px-1 rounded">pip install edge-tts</code>
                      </p>
                    )}
                  </div>

                  {/* Voice selector — adaptive per engine */}
                  <div>
                    <label className="text-sm text-ytm-text-secondary mb-1 block">Voice</label>
                    {(localSettings.tts_engine ?? 'web_speech') === 'edge_tts' ? (
                      <select
                        value={localSettings.dj_voice || 'en-US-ChristopherNeural'}
                        onChange={(e) => updateSetting("dj_voice", e.target.value)}
                        className="w-full bg-ytm-surface border border-ytm-border rounded-lg px-3 py-2 text-sm text-ytm-text focus:outline-none focus:border-ytm-accent"
                      >
                        {EDGE_TTS_VOICES.map((v) => (
                          <option key={v.value} value={v.value}>{v.label}</option>
                        ))}
                      </select>
                    ) : (
                      <VoiceSelector 
                        language={localSettings.dj_language}
                        selectedVoice={localSettings.dj_voice}
                        onChange={(voice) => updateSetting("dj_voice", voice)}
                      />
                    )}
                  </div>

                  <div>
                    <label className="text-sm text-ytm-text-secondary mb-2 block">
                      Pitch: {(localSettings.dj_pitch ?? 1.0).toFixed(1)}
                    </label>
                    <input
                      type="range"
                      min={0.5}
                      max={2.0}
                      step={0.1}
                      value={localSettings.dj_pitch ?? 1.0}
                      onChange={(e) => updateSetting("dj_pitch", parseFloat(e.target.value))}
                      className="w-full accent-ytm-accent"
                    />
                    <p className="text-xs text-ytm-text-secondary mt-1">Lower = deeper voice, Higher = higher pitch</p>
                  </div>
                  <div>
                    <label className="text-sm text-ytm-text-secondary mb-2 block">
                      Speed: {(localSettings.dj_rate ?? 1.05).toFixed(2)}x
                    </label>
                    <input
                      type="range"
                      min={0.5}
                      max={2.0}
                      step={0.1}
                      value={localSettings.dj_rate ?? 1.05}
                      onChange={(e) => updateSetting("dj_rate", parseFloat(e.target.value))}
                      className="w-full accent-ytm-accent"
                    />
                    <p className="text-xs text-ytm-text-secondary mt-1">Slower = more dramatic, Faster = more energetic</p>
                  </div>

                  {/* Test Voice button — only for edge-tts */}
                  {(localSettings.tts_engine ?? 'web_speech') === 'edge_tts' && (
                    <button
                      onClick={handleTestTtsVoice}
                      disabled={testingTts}
                      className="flex items-center gap-2 px-3 py-2 bg-ytm-accent/20 hover:bg-ytm-accent/30 text-ytm-accent rounded-lg text-sm transition-colors disabled:opacity-50"
                    >
                      {testingTts ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
                      {testingTts ? 'Playing...' : 'Test Voice'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Semantic Search Settings */}
      {localSettings.ollama_enabled && (
        <section className="bg-ytm-surface rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Brain className="w-6 h-6 text-ytm-accent" />
            <div className="flex-grow">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">🧠 Semantic Search</h2>
              </div>
              <p className="text-sm text-ytm-text-secondary">
                Find similar songs from your library using AI embeddings
              </p>
            </div>
            <label className="relative inline-block cursor-pointer">
              <input
                type="checkbox"
                checked={localSettings.semantic_search_enabled}
                onChange={(e) => updateSetting("semantic_search_enabled", e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-ytm-border rounded-full peer peer-checked:bg-ytm-accent transition-colors">
                <div
                  className={clsx(
                    "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform",
                    localSettings.semantic_search_enabled && "translate-x-5"
                  )}
                />
              </div>
            </label>
          </div>

          {localSettings.semantic_search_enabled && (
            <div className="space-y-4 pt-2 border-t border-ytm-border">
              {/* Embedding Model Selection */}
              <div>
                <label className="block text-sm font-medium mb-2">Embedding Model</label>
                <select
                  value={localSettings.embedding_model}
                  onChange={(e) => updateSetting("embedding_model", e.target.value)}
                  className="w-full px-4 py-2 bg-ytm-bg border border-ytm-border rounded-lg focus:outline-none focus:border-ytm-accent"
                >
                  <option value="all-minilm">⚡ all-minilm (Fast, 384D) - Recommended</option>
                  <option value="nomic-embed-text">📊 nomic-embed-text (Quality, 768D)</option>
                  <option value="mxbai-embed-large">🏆 mxbai-embed-large (Best, 1024D)</option>
                </select>
                <p className="text-xs text-ytm-text-secondary mt-1">
                  Changing model will require re-indexing your library
                </p>
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

                {semanticStatus ? (
                  <>
                    <div className="text-sm text-ytm-text-secondary mb-2">
                      {semanticStatus.indexed_tracks} / {semanticStatus.total_tracks} tracks indexed
                    </div>
                    <div className="w-full bg-ytm-border rounded-full h-2">
                      <div
                        className="bg-ytm-accent h-2 rounded-full transition-all"
                        style={{
                          width: semanticStatus.total_tracks > 0
                            ? `${(semanticStatus.indexed_tracks / semanticStatus.total_tracks) * 100}%`
                            : '0%'
                        }}
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
                    isIndexing
                      ? "bg-ytm-accent/50 text-white cursor-not-allowed"
                      : "bg-ytm-accent text-white hover:bg-ytm-accent-hover"
                  )}
                >
                  {isIndexing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Indexing {indexProgress}%
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4" />
                      Re-index All
                    </>
                  )}
                </button>
                <button
                  onClick={handleClearIndex}
                  disabled={isIndexing}
                  className="flex-1 px-4 py-2 rounded-lg font-medium transition-colors bg-ytm-surface text-ytm-text-secondary hover:bg-red-500/20 hover:text-red-400 border border-ytm-border"
                >
                  🗑️ Clear Index
                </button>
              </div>
            </div>
          )}
        </section>
      )}
      {localSettings.ollama_enabled && (
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
                } catch (err) {
                  console.error("Settings advice failed:", err);
                  showToast('Failed to get settings advice', 'error');
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
                  <span className={clsx(
                    "text-lg font-bold",
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
      )}

      {/* Storage Analyzer (FAZA 8 — L3) */}
      {localSettings.ollama_enabled && (
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
                } catch (err) {
                  console.error("Storage analysis failed:", err);
                  showToast('Storage analysis failed', 'error');
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
                        <p className="text-xs text-ytm-text-secondary">
                          {s.affected_tracks} tracks · ~{s.savings_mb} MB savings
                        </p>
                      </div>
                      <span className="text-green-400 text-sm font-medium">-{s.savings_mb}MB</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* About */}
      <section className="bg-ytm-surface rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4">About</h2>
        <div className="space-y-2 text-sm text-ytm-text-secondary">
          <p>
            <strong className="text-white">YTM Free</strong> v0.1.0
          </p>
          <p>A personal music streaming app powered by yt-dlp.</p>
          <p>For personal use only. Respects YouTube's Terms of Service.</p>
          <p className="pt-2">
            Built with Tauri, React, and Rust. 🦀
          </p>
        </div>
      </section>
    </div>
  );
}
