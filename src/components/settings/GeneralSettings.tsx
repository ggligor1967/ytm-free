import { Volume2, FolderOpen, Settings } from "lucide-react";
import clsx from "clsx";
import type { Settings as SettingsType } from "../../types";

interface Props {
  settings: SettingsType;
  onUpdate: (partial: Partial<SettingsType>) => void;
}

export function GeneralSettings({ settings, onUpdate }: Props) {
  return (
    <>
      {/* Audio Settings */}
      <section className="bg-ytm-surface rounded-xl p-6 space-y-6">
        <div className="flex items-center gap-3 mb-4">
          <Volume2 className="w-6 h-6 text-ytm-accent" />
          <h2 className="text-lg font-semibold">Audio</h2>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Audio Quality</label>
          <select
            value={settings.audio_quality}
            onChange={(e) => onUpdate({ audio_quality: e.target.value as SettingsType["audio_quality"] })}
            className="w-full px-4 py-2 bg-ytm-bg border border-ytm-border rounded-lg focus:outline-none focus:border-ytm-accent"
          >
            <option value="low">Low (64 kbps)</option>
            <option value="medium">Medium (128 kbps)</option>
            <option value="high">High (256 kbps)</option>
            <option value="best">Best (320 kbps)</option>
          </select>
          <p className="text-xs text-ytm-text-secondary mt-1">Higher quality uses more bandwidth</p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Default Volume: {Math.round(settings.volume * 100)}%</label>
          <input
            type="range" min={0} max={1} step={0.01}
            value={settings.volume}
            onChange={(e) => onUpdate({ volume: parseFloat(e.target.value) })}
            className="w-full accent-ytm-accent"
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Crossfade</p>
            <p className="text-sm text-ytm-text-secondary">Smooth transition between tracks</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.crossfade}
              onChange={(e) => onUpdate({ crossfade: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-ytm-border rounded-full peer peer-checked:bg-ytm-accent transition-colors">
              <div className={clsx("absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform", settings.crossfade && "translate-x-5")} />
            </div>
          </label>
        </div>

        {settings.crossfade && (
          <div>
            <label className="block text-sm font-medium mb-2">Crossfade Duration: {settings.crossfade_duration}s</label>
            <input
              type="range" min={1} max={12} step={1}
              value={settings.crossfade_duration}
              onChange={(e) => onUpdate({ crossfade_duration: parseInt(e.target.value) })}
              className="w-full accent-ytm-accent"
            />
          </div>
        )}
      </section>

      {/* Downloads */}
      <section className="bg-ytm-surface rounded-xl p-6 space-y-6">
        <div className="flex items-center gap-3 mb-4">
          <FolderOpen className="w-6 h-6 text-ytm-accent" />
          <h2 className="text-lg font-semibold">Downloads</h2>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Download Location</label>
          <input
            type="text"
            value={settings.download_path}
            onChange={(e) => onUpdate({ download_path: e.target.value })}
            className="w-full px-4 py-2 bg-ytm-bg border border-ytm-border rounded-lg focus:outline-none focus:border-ytm-accent text-sm"
          />
          <p className="text-xs text-ytm-text-secondary mt-1">Where downloaded tracks will be saved</p>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Auto-download</p>
            <p className="text-sm text-ytm-text-secondary">Automatically download tracks when added to playlists</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.auto_download}
              onChange={(e) => onUpdate({ auto_download: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-ytm-border rounded-full peer peer-checked:bg-ytm-accent transition-colors">
              <div className={clsx("absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform", settings.auto_download && "translate-x-5")} />
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

        <div>
          <label className="block text-sm font-medium mb-2">Theme</label>
          <div className="flex gap-3">
            {(["dark", "light", "system"] as const).map((theme) => (
              <button
                key={theme}
                onClick={() => onUpdate({ theme })}
                className={clsx(
                  "flex-1 px-4 py-3 rounded-lg border transition-colors capitalize",
                  settings.theme === theme
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

      {/* Search */}
      <section className="bg-ytm-surface rounded-xl p-6 space-y-6">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-lg font-semibold">Search</h2>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Search Results Count: {settings.search_results_count}</label>
          <input
            type="range" min={5} max={50} step={5}
            value={settings.search_results_count}
            onChange={(e) => onUpdate({ search_results_count: parseInt(e.target.value) })}
            className="w-full accent-ytm-accent"
          />
          <div className="flex justify-between text-xs text-ytm-text-secondary mt-1"><span>5</span><span>25</span><span>50</span></div>
          <p className="text-xs text-ytm-text-secondary mt-1">Maximum number of YouTube results per search (more results = slower search)</p>
        </div>
      </section>
    </>
  );
}
