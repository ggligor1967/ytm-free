import { useState } from "react";
import { Loader2, Volume2, Sparkles } from "lucide-react";
import clsx from "clsx";
import * as api from "../../api";
import { showToast } from "../Toast";
import { VoiceSelector } from "../VoiceSelector";
import type { Settings as SettingsType } from "../../types";

interface Props {
  settings: SettingsType;
  onUpdate: (partial: Partial<SettingsType>) => void;
}

const EDGE_TTS_VOICES = [
  { value: "en-US-ChristopherNeural", label: "Christopher (EN-US, Male)" },
  { value: "en-US-AriaNeural", label: "Aria (EN-US, Female)" },
  { value: "en-GB-RyanNeural", label: "Ryan (EN-GB, Male)" },
  { value: "en-GB-SoniaNeural", label: "Sonia (EN-GB, Female)" },
  { value: "ro-RO-EmilNeural", label: "Emil (RO, Male)" },
  { value: "ro-RO-AlinaNeural", label: "Alina (RO, Female)" },
] as const;

export function DJSettings({ settings, onUpdate }: Props) {
  const [testingTts, setTestingTts] = useState(false);

  const handleTestTtsVoice = async () => {
    if (testingTts) return;
    const sampleText = settings.dj_language === "Română"
      ? "Salut! Aceasta este vocea DJ-ului tău."
      : "Hey there! This is your AI DJ voice preview.";
    setTestingTts(true);
    try {
      const voice = settings.dj_voice || "en-US-ChristopherNeural";
      const url = await api.speakWithEdgeTts(sampleText, voice, settings.dj_rate ?? 1.05, settings.dj_pitch ?? 1.0);
      const audio = new Audio(url);
      audio.onended = () => setTestingTts(false);
      audio.onerror = () => setTestingTts(false);
      audio.play().catch(() => setTestingTts(false));
    } catch {
      showToast("edge-tts not installed. Run: pip install edge-tts", "error");
      setTestingTts(false);
    }
  };

  const enabled = settings.ollama_enabled;

  return (
    <section className="bg-ytm-surface rounded-xl p-6 space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <Sparkles className="w-6 h-6 text-ytm-accent" />
        <h2 className="text-lg font-semibold">AI DJ Mode</h2>
      </div>

      {/* DJ Mode Toggle */}
      <div className={clsx("flex items-center justify-between", !enabled && "opacity-50")}>
        <div>
          <label className="font-medium">AI DJ Mode</label>
          <p className="text-sm text-ytm-text-secondary">AI narrates transitions between songs like a radio DJ</p>
        </div>
        <label className="relative inline-block cursor-pointer">
          <input
            type="checkbox"
            checked={settings.dj_mode_enabled}
            onChange={(e) => onUpdate({ dj_mode_enabled: e.target.checked })}
            disabled={!enabled}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-ytm-border rounded-full peer peer-checked:bg-ytm-accent transition-colors">
            <div className={clsx("absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform", settings.dj_mode_enabled && "translate-x-5")} />
          </div>
        </label>
      </div>

      {settings.dj_mode_enabled && enabled && (
        <div className="space-y-3 pl-2">
          {/* DJ Style */}
          <div>
            <label className="text-sm text-ytm-text-secondary mb-1 block">DJ Style</label>
            <select
              value={settings.dj_style}
              onChange={(e) => onUpdate({ dj_style: e.target.value })}
              className="bg-ytm-bg border border-ytm-border rounded-lg px-3 py-2 text-sm w-full"
            >
              <option value="classic_fm">Classic FM — Smooth & sophisticated</option>
              <option value="hype">Hype — Energetic & exciting</option>
              <option value="chill">Chill — Relaxed & laid-back</option>
              <option value="fun">Fun — Playful with fun facts</option>
              <option value="storyteller">Storyteller — Deep musical context</option>
            </select>
          </div>

          {/* Frequency */}
          <div>
            <label className="text-sm text-ytm-text-secondary mb-1 block">Frequency</label>
            <select
              value={settings.dj_frequency}
              onChange={(e) => onUpdate({ dj_frequency: Number(e.target.value) })}
              className="bg-ytm-bg border border-ytm-border rounded-lg px-3 py-2 text-sm w-full"
            >
              <option value={1}>Every song</option>
              <option value={3}>Every 3 songs</option>
              <option value={5}>Every 5 songs</option>
              <option value={0}>Random (~30%)</option>
            </select>
          </div>

          {/* Language */}
          <div>
            <label className="text-sm text-ytm-text-secondary mb-1 block">Language</label>
            <select
              value={settings.dj_language}
              onChange={(e) => onUpdate({ dj_language: e.target.value })}
              className="bg-ytm-bg border border-ytm-border rounded-lg px-3 py-2 text-sm w-full"
            >
              <option value="English">English</option>
              <option value="Română">Română</option>
              <option value="Magyar">Magyar</option>
              <option value="Español">Español</option>
              <option value="Deutsch">Deutsch</option>
            </select>
          </div>

          {/* DJ Triggers */}
          <div>
            <label className="text-sm text-ytm-text-secondary mb-2 block">Active Triggers</label>
            <div className="space-y-2 bg-ytm-bg-secondary p-3 rounded-lg">
              {([
                ["track_start", "Track Start"],
                ["track_end", "Track End"],
                ["queue_empty", "Queue Empty"],
                ["long_session", "Long Session (30min)"],
                ["first_track_of_day", "First Track of Day"],
                ["milestone", "Milestone (50/100/500)"],
                ["time_announcement", "Time Announcement"],
                ["mood_shift", "Mood Shift"],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between cursor-pointer group">
                  <span className="text-sm group-hover:text-white transition-colors">{label}</span>
                  <input
                    type="checkbox"
                    checked={(settings.dj_triggers_enabled as any)?.[key] ?? true}
                    onChange={(e) => onUpdate({
                      dj_triggers_enabled: { ...settings.dj_triggers_enabled, [key]: e.target.checked },
                    })}
                    className="w-4 h-4 rounded border-ytm-border bg-ytm-bg checked:bg-ytm-accent"
                  />
                </label>
              ))}
              <div className="pt-2 mt-2 border-t border-ytm-border">
                <p className="text-xs text-ytm-text-secondary">User Request trigger is always available via the button in the player.</p>
              </div>
            </div>
          </div>

          {/* Voice Settings */}
          <div>
            <label className="text-sm text-ytm-text-secondary mb-2 block">Voice Settings</label>
            <div className="space-y-3 bg-ytm-bg-secondary p-3 rounded-lg">
              {/* TTS Engine */}
              <div>
                <label className="text-sm text-ytm-text-secondary mb-1 block">TTS Engine</label>
                <select
                  value={settings.tts_engine ?? "web_speech"}
                  onChange={(e) => onUpdate({ tts_engine: e.target.value as "web_speech" | "edge_tts" })}
                  className="w-full bg-ytm-surface border border-ytm-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-ytm-accent"
                >
                  <option value="web_speech">Web Speech API (built-in, robotic)</option>
                  <option value="edge_tts">Microsoft Neural (edge-tts, natural)</option>
                </select>
                {(settings.tts_engine ?? "web_speech") === "edge_tts" && (
                  <p className="text-xs text-ytm-text-secondary mt-1">
                    Requires Python: <code className="bg-ytm-surface px-1 rounded">pip install edge-tts</code>
                  </p>
                )}
              </div>

              {/* Voice selector */}
              <div>
                <label className="text-sm text-ytm-text-secondary mb-1 block">Voice</label>
                {(settings.tts_engine ?? "web_speech") === "edge_tts" ? (
                  <select
                    value={settings.dj_voice || "en-US-ChristopherNeural"}
                    onChange={(e) => onUpdate({ dj_voice: e.target.value })}
                    className="w-full bg-ytm-surface border border-ytm-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-ytm-accent"
                  >
                    {EDGE_TTS_VOICES.map((v) => (
                      <option key={v.value} value={v.value}>{v.label}</option>
                    ))}
                  </select>
                ) : (
                  <VoiceSelector
                    language={settings.dj_language}
                    selectedVoice={settings.dj_voice}
                    onChange={(voice) => onUpdate({ dj_voice: voice })}
                  />
                )}
              </div>

              {/* Pitch */}
              <div>
                <label className="text-sm text-ytm-text-secondary mb-2 block">Pitch: {(settings.dj_pitch ?? 1.0).toFixed(1)}</label>
                <input type="range" min={0.5} max={2.0} step={0.1}
                  value={settings.dj_pitch ?? 1.0}
                  onChange={(e) => onUpdate({ dj_pitch: parseFloat(e.target.value) })}
                  className="w-full accent-ytm-accent" />
                <p className="text-xs text-ytm-text-secondary mt-1">Lower = deeper voice, Higher = higher pitch</p>
              </div>

              {/* Speed */}
              <div>
                <label className="text-sm text-ytm-text-secondary mb-2 block">Speed: {(settings.dj_rate ?? 1.05).toFixed(2)}x</label>
                <input type="range" min={0.5} max={2.0} step={0.1}
                  value={settings.dj_rate ?? 1.05}
                  onChange={(e) => onUpdate({ dj_rate: parseFloat(e.target.value) })}
                  className="w-full accent-ytm-accent" />
                <p className="text-xs text-ytm-text-secondary mt-1">Slower = more dramatic, Faster = more energetic</p>
              </div>

              {/* Test Voice button */}
              {(settings.tts_engine ?? "web_speech") === "edge_tts" && (
                <button
                  onClick={handleTestTtsVoice}
                  disabled={testingTts}
                  className="flex items-center gap-2 px-3 py-2 bg-ytm-accent/20 hover:bg-ytm-accent/30 text-ytm-accent rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  {testingTts ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
                  {testingTts ? "Playing..." : "Test Voice"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
