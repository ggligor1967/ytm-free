import { useEffect, useState } from "react";
import { useAppStore } from "../../store";
import * as api from "../../api";
import { TrackCard } from "../TrackCard";
import { Download, Loader2 } from "lucide-react";
import { showToast } from "../../lib/toast";

export function DownloadsView() {
  const { downloads, setDownloads } = useAppStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDownloads() {
      try {
        const tracks = await api.getDownloads();
        setDownloads(tracks);
      } catch (error) {
        console.error("Failed to load downloads:", error);
        showToast("Failed to load downloads");
      } finally {
        setLoading(false);
      }
    }
    loadDownloads();
  }, [setDownloads]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-ytm-accent" />
      </div>
    );
  }

  if (downloads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-24 h-24 bg-ytm-surface rounded-full flex items-center justify-center mb-4">
          <Download className="w-12 h-12 text-ytm-text-secondary" />
        </div>
        <h2 className="text-xl font-bold mb-2">No downloads yet</h2>
        <p className="text-ytm-text-secondary text-center max-w-md">
          Download tracks to listen offline. Click the download button on any track
          to save it to your device.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Downloads</h1>
        <p className="text-ytm-text-secondary">{downloads.length} tracks downloaded</p>
      </div>

      <div className="space-y-1">
        {downloads.map((track, i) => (
          <TrackCard key={track.id} track={track} index={i} showIndex />
        ))}
      </div>
    </div>
  );
}
