import { useState, useEffect } from "react";
import { useAppStore } from "../../store";
import * as api from "../../api";
import type { SpotifyTrack, ImportResult, CsvFileInfo, SmartImportResult, SimilarTrackSuggestion, MatchConfidence } from "../../types";
import {
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
  Music,
  Plus,
  RefreshCw,
  FolderOpen,
  FileSpreadsheet,
  ExternalLink,
  Brain,
  Sparkles,
  ArrowRight,
  Search,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Zap,
} from "lucide-react";
import clsx from "clsx";

type ImportPhase = "select" | "preview" | "importing" | "results";
type ImportMode = "standard" | "smart";

function ConfidenceBadge({ confidence }: { confidence: MatchConfidence }) {
  const styles: Record<MatchConfidence, { bg: string; text: string; icon: typeof ShieldCheck; label: string }> = {
    High: { bg: "bg-green-500/20 border-green-500/40", text: "text-green-400", icon: ShieldCheck, label: "High" },
    Medium: { bg: "bg-yellow-500/20 border-yellow-500/40", text: "text-yellow-400", icon: Shield, label: "Medium" },
    Low: { bg: "bg-red-500/20 border-red-500/40", text: "text-red-400", icon: ShieldAlert, label: "Low" },
  };
  const s = styles[confidence];
  const Icon = s.icon;
  return (
    <span className={clsx("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border", s.bg, s.text)}>
      <Icon className="w-3 h-3" />
      {s.label}
    </span>
  );
}

function QualityScore({ score }: { score: number }) {
  const color = score >= 75 ? "text-green-400" : score >= 50 ? "text-yellow-400" : "text-red-400";
  const bg = score >= 75 ? "bg-green-500" : score >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-ytm-bg rounded-full overflow-hidden">
        <div className={clsx("h-full rounded-full transition-all", bg)} style={{ width: `${score}%` }} />
      </div>
      <span className={clsx("text-xs font-medium", color)}>{score}%</span>
    </div>
  );
}

export function ImportView() {
  const { playlists, addPlaylist, setView, setSelectedPlaylistId } = useAppStore();
  const ollamaAvailable = useAppStore((s) => s.ollamaAvailable);
  
  const [phase, setPhase] = useState<ImportPhase>("select");
  const [importMode, setImportMode] = useState<ImportMode>(ollamaAvailable ? "smart" : "standard");
  const [csvFiles, setCsvFiles] = useState<CsvFileInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState<CsvFileInfo | null>(null);
  const [spotifyTracks, setSpotifyTracks] = useState<SpotifyTrack[]>([]);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [smartResults, setSmartResults] = useState<SmartImportResult[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playlistName, setPlaylistName] = useState("Spotify Import");
  const [error, setError] = useState<string | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<string>("new");
  const [folderPath, setFolderPath] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [reMatchingTrack, setReMatchingTrack] = useState<number | null>(null);
  const [similarSuggestions, setSimilarSuggestions] = useState<Record<number, SimilarTrackSuggestion>>({});
  const [loadingSimilar, setLoadingSimilar] = useState<number | null>(null);

  const isSmartMode = importMode === "smart" && ollamaAvailable;

  // Load CSV files on mount
  useEffect(() => {
    async function loadCsvFiles() {
      setIsLoading(true);
      try {
        const defaultPath = await api.getDefaultSpotifyFolder();
        setFolderPath(defaultPath);
        const files = await api.scanSpotifyFolder(defaultPath);
        setCsvFiles(files);
        setError(null);
      } catch (err) {
        console.error("Failed to scan folder:", err);
        setError("No CSV files found. Export your Spotify playlists from exportify.net and save them to the Spotify folder.");
      } finally {
        setIsLoading(false);
      }
    }
    loadCsvFiles();
  }, []);

  // Update mode when ollama availability changes
  useEffect(() => {
    if (!ollamaAvailable && importMode === "smart") {
      setImportMode("standard");
    }
  }, [ollamaAvailable, importMode]);

  const refreshFolder = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const files = await api.scanSpotifyFolder(folderPath);
      setCsvFiles(files);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to scan folder");
    } finally {
      setIsLoading(false);
    }
  };

  const selectFile = async (file: CsvFileInfo) => {
    setError(null);
    setSelectedFile(file);
    try {
      const content = await api.readCsvFile(file.path);
      const tracks = await api.parseSpotifyCsv(content);
      if (tracks.length === 0) {
        setError("No tracks found in this CSV file");
        return;
      }
      setSpotifyTracks(tracks);
      setPlaylistName(file.name);
      setPhase("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read CSV file");
    }
  };

  // Standard import
  const startStandardImport = async () => {
    setPhase("importing");
    setImportResults([]);
    setCurrentIndex(0);
    const results: ImportResult[] = [];
    for (let i = 0; i < spotifyTracks.length; i++) {
      setCurrentIndex(i);
      try {
        const result = await api.searchTrackOnYoutube(spotifyTracks[i]);
        results.push(result);
        setImportResults([...results]);
      } catch (err) {
        results.push({
          spotify_track: spotifyTracks[i],
          youtube_id: undefined,
          youtube_title: undefined,
          status: "NotFound",
          alternatives: [],
        });
        setImportResults([...results]);
      }
    }
    setPhase("results");
  };

  // Smart AI import
  const startSmartImport = async () => {
    setPhase("importing");
    setSmartResults([]);
    setCurrentIndex(0);
    const results: SmartImportResult[] = [];
    for (let i = 0; i < spotifyTracks.length; i++) {
      setCurrentIndex(i);
      try {
        const result = await api.smartSearchTrackWithFallback(spotifyTracks[i]);
        results.push(result);
        setSmartResults([...results]);
      } catch (err) {
        // Fallback to standard search on error
        try {
          const stdResult = await api.searchTrackOnYoutube(spotifyTracks[i]);
          results.push({
            spotify_track: spotifyTracks[i],
            youtube_id: stdResult.youtube_id,
            youtube_title: stdResult.youtube_title,
            status: stdResult.status,
            confidence: "Medium" as MatchConfidence,
            ai_reason: "Fallback to standard search (AI error)",
            alternatives: stdResult.alternatives,
            quality_score: 50,
          });
        } catch {
          results.push({
            spotify_track: spotifyTracks[i],
            youtube_id: undefined,
            youtube_title: undefined,
            status: "NotFound",
            confidence: "Low" as MatchConfidence,
            ai_reason: "Both AI and standard search failed",
            alternatives: [],
            quality_score: 0,
          });
        }
        setSmartResults([...results]);
      }
    }
    setPhase("results");
  };

  const startImport = () => {
    if (isSmartMode) {
      startSmartImport();
    } else {
      startStandardImport();
    }
  };

  // Smart re-match a single track [D1]
  const handleSmartReMatch = async (index: number) => {
    if (!ollamaAvailable) return;
    setReMatchingTrack(index);
    try {
      const track = isSmartMode ? smartResults[index].spotify_track : importResults[index].spotify_track;
      const result = await api.smartSearchTrackWithFallback(track);
      if (isSmartMode) {
        const updated = [...smartResults];
        updated[index] = result;
        setSmartResults(updated);
      } else {
        // Convert smart result to standard result and update
        const updated = [...importResults];
        updated[index] = {
          spotify_track: result.spotify_track,
          youtube_id: result.youtube_id,
          youtube_title: result.youtube_title,
          status: result.status,
          alternatives: result.alternatives,
        };
        setImportResults(updated);
      }
    } catch (err) {
      console.error("Smart re-match failed:", err);
    } finally {
      setReMatchingTrack(null);
    }
  };

  // Suggest similar tracks [D5]
  const handleSuggestSimilar = async (index: number) => {
    if (!ollamaAvailable) return;
    const track = isSmartMode ? smartResults[index].spotify_track : importResults[index].spotify_track;
    setLoadingSimilar(index);
    try {
      const suggestions = await api.smartSuggestSimilarTrack(track);
      setSimilarSuggestions((prev) => ({ ...prev, [index]: suggestions }));
    } catch (err) {
      console.error("Similar track suggestion failed:", err);
    } finally {
      setLoadingSimilar(null);
    }
  };

  // Search and apply a similar track suggestion
  const applySimilarSuggestion = async (index: number, query: string) => {
    try {
      const results = await api.searchYoutube(query, 1);
      if (results.length > 0) {
        const best = results[0];
        if (isSmartMode) {
          const updated = [...smartResults];
          updated[index] = {
            ...updated[index],
            youtube_id: best.id,
            youtube_title: best.title,
            status: "AlternativeFound",
            confidence: "Medium",
            ai_reason: `Applied similar track suggestion: "${query}"`,
            quality_score: 55,
          };
          setSmartResults(updated);
        } else {
          const updated = [...importResults];
          updated[index] = {
            ...updated[index],
            youtube_id: best.id,
            youtube_title: best.title,
            status: "AlternativeFound",
          };
          setImportResults(updated);
        }
        // Clear suggestions for this track
        setSimilarSuggestions((prev) => {
          const next = { ...prev };
          delete next[index];
          return next;
        });
      }
    } catch (err) {
      console.error("Failed to search for similar track:", err);
    }
  };

  // Create playlist from results
  const createPlaylistWithTracks = async () => {
    const foundTracks = isSmartMode
      ? smartResults.filter((r) => r.youtube_id)
      : importResults.filter((r) => r.youtube_id);

    if (foundTracks.length === 0) {
      setError("No tracks were found to add to playlist");
      return;
    }

    try {
      let playlistId: string;
      if (selectedPlaylist === "new") {
        const desc = isSmartMode
          ? `Imported from Spotify (AI-enhanced) - ${foundTracks.length} tracks`
          : `Imported from Spotify - ${foundTracks.length} tracks`;
        const playlist = await api.createPlaylist(playlistName, desc);
        addPlaylist(playlist);
        playlistId = playlist.id;
      } else {
        playlistId = selectedPlaylist;
      }

      for (const result of foundTracks) {
        const ytId = isSmartMode ? (result as SmartImportResult).youtube_id : (result as ImportResult).youtube_id;
        const ytTitle = isSmartMode ? (result as SmartImportResult).youtube_title : (result as ImportResult).youtube_title;
        const spotifyTrack = isSmartMode ? (result as SmartImportResult).spotify_track : (result as ImportResult).spotify_track;
        if (ytId && ytTitle) {
          await api.addToPlaylist(
            playlistId,
            ytId,
            ytTitle,
            spotifyTrack.artist_name,
            `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`,
            spotifyTrack.duration_ms ? Math.floor(spotifyTrack.duration_ms / 1000) : undefined
          );
        }
      }

      setSelectedPlaylistId(playlistId);
      setView("playlist");
    } catch (err) {
      console.error("[Import] Error:", err);
      setError(err instanceof Error ? err.message : "Failed to create playlist");
    }
  };

  const reset = () => {
    setPhase("select");
    setSelectedFile(null);
    setSpotifyTracks([]);
    setImportResults([]);
    setSmartResults([]);
    setCurrentIndex(0);
    setError(null);
    setSimilarSuggestions({});
    setReMatchingTrack(null);
  };

  // Stats
  const activeResults = isSmartMode ? smartResults : importResults;
  const foundCount = activeResults.filter((r) => r.status === "Found").length;
  const alternativeCount = activeResults.filter((r) => r.status === "AlternativeFound").length;
  const notFoundCount = activeResults.filter((r) => r.status === "NotFound").length;
  const avgQuality = isSmartMode && smartResults.length > 0
    ? Math.round(smartResults.reduce((sum, r) => sum + r.quality_score, 0) / smartResults.length)
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Import from Spotify</h1>
          <p className="text-ytm-text-secondary mt-1">
            Select a playlist to import from your Spotify CSV exports
          </p>
        </div>
        {/* Import Mode Toggle */}
        {ollamaAvailable && phase === "select" && (
          <div className="flex items-center gap-2 bg-ytm-surface rounded-full p-1">
            <button
              onClick={() => setImportMode("standard")}
              className={clsx(
                "px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
                importMode === "standard" ? "bg-ytm-accent text-white" : "text-ytm-text-secondary hover:text-white"
              )}
            >
              Standard
            </button>
            <button
              onClick={() => setImportMode("smart")}
              className={clsx(
                "px-3 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5",
                importMode === "smart" ? "bg-purple-600 text-white" : "text-ytm-text-secondary hover:text-white"
              )}
            >
              <Brain className="w-3.5 h-3.5" />
              Smart AI
            </button>
          </div>
        )}
      </div>

      {/* Smart mode info banner */}
      {isSmartMode && phase === "select" && (
        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-purple-200 font-medium">AI-Enhanced Import Active</p>
            <p className="text-purple-300/70 mt-0.5">
              Ollama will verify each match, assess quality, and suggest alternatives for missing tracks.
            </p>
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 flex items-center gap-3">
          <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <p className="text-red-200">{error}</p>
        </div>
      )}

      {/* Phase: Select CSV */}
      {phase === "select" && (
        <div className="space-y-6">
          <div className="bg-ytm-surface rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-ytm-accent" />
                <span className="font-medium">Spotify Folder</span>
              </div>
              <button
                onClick={refreshFolder}
                className="p-2 hover:bg-ytm-surface-hover rounded-lg transition-colors"
                title="Refresh"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
            <code className="text-sm text-ytm-text-secondary bg-ytm-bg px-3 py-2 rounded block">
              {folderPath}
            </code>
          </div>

          <div className="bg-ytm-surface/50 rounded-lg p-4 border border-ytm-border">
            <p className="text-sm text-ytm-text-secondary mb-2">
              <strong>Don't see your playlists?</strong>
            </p>
            <ol className="text-sm text-ytm-text-secondary space-y-1 list-decimal list-inside">
              <li>Go to <a href="https://exportify.net" target="_blank" rel="noopener noreferrer" className="text-ytm-accent hover:underline inline-flex items-center gap-1">exportify.net <ExternalLink className="w-3 h-3" /></a></li>
              <li>Login with Spotify & export your playlists as CSV</li>
              <li>Save them to: <code className="text-xs bg-ytm-bg px-1 rounded">{folderPath}</code></li>
              <li>Click refresh above</li>
            </ol>
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-ytm-accent" />
            </div>
          )}

          {!isLoading && csvFiles.length === 0 && (
            <div className="text-center py-12">
              <FileSpreadsheet className="w-16 h-16 text-ytm-text-secondary mx-auto mb-4" />
              <p className="text-ytm-text-secondary">No CSV files found</p>
            </div>
          )}

          {!isLoading && csvFiles.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-ytm-text-secondary mb-3">
                {csvFiles.length} playlist{csvFiles.length !== 1 ? "s" : ""} found:
              </p>
              <div className="grid gap-2">
                {csvFiles.map((file) => (
                  <button
                    key={file.path}
                    onClick={() => selectFile(file)}
                    className="w-full flex items-center gap-4 p-4 bg-ytm-surface hover:bg-ytm-surface-hover rounded-lg transition-colors text-left"
                  >
                    <div className="w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Music className="w-6 h-6 text-green-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{file.name}</p>
                      <p className="text-sm text-ytm-text-secondary">
                        {file.track_count} track{file.track_count !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <Plus className="w-5 h-5 text-ytm-text-secondary" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Phase: Preview */}
      {phase === "preview" && selectedFile && (
        <div className="space-y-6">
          <div className="bg-ytm-surface rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">{selectedFile.name}</h2>
              <div className="flex items-center gap-3">
                {isSmartMode && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-purple-500/20 border border-purple-500/30 rounded-full text-xs text-purple-300">
                    <Brain className="w-3 h-3" />
                    AI-Enhanced
                  </span>
                )}
                <span className="text-ytm-text-secondary">{spotifyTracks.length} tracks</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm text-ytm-text-secondary mb-2">
                Add to playlist:
              </label>
              <select
                value={selectedPlaylist}
                onChange={(e) => setSelectedPlaylist(e.target.value)}
                className="w-full bg-ytm-bg border border-ytm-border rounded-lg px-4 py-2 text-white"
                title="Select destination playlist"
              >
                <option value="new">+ Create new playlist</option>
                {playlists.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {selectedPlaylist === "new" && (
              <div className="mb-4">
                <label className="block text-sm text-ytm-text-secondary mb-2">
                  New playlist name:
                </label>
                <input
                  type="text"
                  value={playlistName}
                  onChange={(e) => setPlaylistName(e.target.value)}
                  className="w-full bg-ytm-bg border border-ytm-border rounded-lg px-4 py-2 text-white"
                  placeholder="Playlist name"
                />
              </div>
            )}

            <div className="max-h-64 overflow-y-auto space-y-1">
              {spotifyTracks.slice(0, 10).map((track, i) => (
                <div key={i} className="flex items-center gap-3 p-2 rounded hover:bg-ytm-bg">
                  <Music className="w-4 h-4 text-ytm-text-secondary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{track.track_name}</p>
                    <p className="text-sm text-ytm-text-secondary truncate">{track.artist_name}</p>
                  </div>
                </div>
              ))}
              {spotifyTracks.length > 10 && (
                <p className="text-ytm-text-secondary text-sm text-center py-2">
                  ...and {spotifyTracks.length - 10} more tracks
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-4">
            <button
              onClick={reset}
              className="px-6 py-2 border border-ytm-border rounded-full hover:bg-ytm-surface transition-colors"
            >
              Back
            </button>
            <button
              onClick={startImport}
              className={clsx(
                "px-6 py-2 text-white rounded-full font-medium transition-colors flex items-center gap-2",
                isSmartMode
                  ? "bg-purple-600 hover:bg-purple-700"
                  : "bg-ytm-accent hover:bg-ytm-accent-hover"
              )}
            >
              {isSmartMode ? <Brain className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
              {isSmartMode ? "Smart Import" : "Start Import"}
            </button>
          </div>
        </div>
      )}

      {/* Phase: Importing */}
      {phase === "importing" && (
        <div className="space-y-6">
          <div className="bg-ytm-surface rounded-lg p-6">
            <div className="flex items-center gap-4 mb-4">
              {isSmartMode ? (
                <div className="relative">
                  <Brain className="w-8 h-8 text-purple-400" />
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-purple-500 rounded-full animate-pulse" />
                </div>
              ) : (
                <Loader2 className="w-8 h-8 text-ytm-accent animate-spin" />
              )}
              <div>
                <h2 className="font-semibold">
                  {isSmartMode ? "AI-Enhanced Search..." : "Searching YouTube..."}
                </h2>
                <p className="text-ytm-text-secondary">
                  {currentIndex + 1} of {spotifyTracks.length} tracks
                </p>
              </div>
            </div>

            <div className="h-2 bg-ytm-bg rounded-full overflow-hidden mb-4">
              <div
                className={clsx(
                  "h-full transition-all duration-300",
                  isSmartMode ? "bg-purple-500" : "bg-ytm-accent"
                )}
                style={{ width: `${((currentIndex + 1) / spotifyTracks.length) * 100}%` }}
              />
            </div>

            {spotifyTracks[currentIndex] && (
              <div className="flex items-center gap-3 p-3 bg-ytm-bg rounded-lg">
                <Music className="w-5 h-5 text-ytm-accent" />
                <div className="min-w-0">
                  <p className="truncate">{spotifyTracks[currentIndex].track_name}</p>
                  <p className="text-sm text-ytm-text-secondary truncate">
                    {spotifyTracks[currentIndex].artist_name}
                  </p>
                </div>
              </div>
            )}

            <div className="flex gap-6 mt-4 text-sm">
              <span className="text-green-400">✓ {foundCount} found</span>
              <span className="text-yellow-400">◐ {alternativeCount} alternatives</span>
              <span className="text-red-400">✗ {notFoundCount} not found</span>
            </div>
          </div>
        </div>
      )}

      {/* Phase: Results */}
      {phase === "results" && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-green-500/20 border border-green-500/30 rounded-lg p-4 text-center">
              <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-green-400">{foundCount}</p>
              <p className="text-sm text-green-300">Found</p>
            </div>
            <div className="bg-yellow-500/20 border border-yellow-500/30 rounded-lg p-4 text-center">
              <AlertCircle className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-yellow-400">{alternativeCount}</p>
              <p className="text-sm text-yellow-300">Alternatives</p>
            </div>
            <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-4 text-center">
              <XCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-red-400">{notFoundCount}</p>
              <p className="text-sm text-red-300">Not Found</p>
            </div>
          </div>

          {/* Overall Quality Score (Smart mode only) */}
          {isSmartMode && avgQuality !== null && (
            <div className="bg-ytm-surface rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-purple-400" />
                  <span className="font-medium">Overall Import Quality</span>
                </div>
                <span className={clsx(
                  "text-lg font-bold",
                  avgQuality >= 75 ? "text-green-400" : avgQuality >= 50 ? "text-yellow-400" : "text-red-400"
                )}>
                  {avgQuality}%
                </span>
              </div>
              <QualityScore score={avgQuality} />
            </div>
          )}

          {/* Results list */}
          <div className="bg-ytm-surface rounded-lg p-4 max-h-[32rem] overflow-y-auto">
            <div className="space-y-2">
              {activeResults.map((result, i) => {
                const smartResult = isSmartMode ? (result as SmartImportResult) : null;
                const hasSimilar = similarSuggestions[i] !== undefined;

                return (
                  <div key={i}>
                    <div
                      className={clsx(
                        "flex items-center gap-3 p-3 rounded-lg",
                        result.status === "Found" && "bg-green-500/10",
                        result.status === "AlternativeFound" && "bg-yellow-500/10",
                        result.status === "NotFound" && "bg-red-500/10"
                      )}
                    >
                      {/* Status icon */}
                      {result.status === "Found" && <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />}
                      {result.status === "AlternativeFound" && <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0" />}
                      {result.status === "NotFound" && <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />}

                      {/* Track info */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm">
                            {result.spotify_track.track_name} - {result.spotify_track.artist_name}
                          </p>
                          {/* Confidence badge */}
                          {smartResult && <ConfidenceBadge confidence={smartResult.confidence} />}
                        </div>
                        {(isSmartMode ? smartResult?.youtube_title : (result as ImportResult).youtube_title) && (
                          <p className="truncate text-sm text-ytm-text-secondary flex items-center gap-1">
                            <ArrowRight className="w-3 h-3" />
                            {isSmartMode ? smartResult?.youtube_title : (result as ImportResult).youtube_title}
                          </p>
                        )}
                        {/* AI reason */}
                        {smartResult?.ai_reason && (
                          <p className="text-xs text-ytm-text-secondary/70 mt-0.5 italic">
                            {smartResult.ai_reason}
                          </p>
                        )}
                        {/* Quality bar for smart mode */}
                        {smartResult && (
                          <div className="mt-1 max-w-[200px]">
                            <QualityScore score={smartResult.quality_score} />
                          </div>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {/* Smart Re-match button */}
                        {ollamaAvailable && (result.status === "NotFound" || (smartResult && smartResult.confidence === "Low")) && (
                          <button
                            onClick={() => handleSmartReMatch(i)}
                            disabled={reMatchingTrack === i}
                            className="p-1.5 hover:bg-ytm-bg rounded-lg transition-colors text-purple-400 hover:text-purple-300 disabled:opacity-50"
                            title="Smart Re-match with AI"
                          >
                            {reMatchingTrack === i ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Brain className="w-4 h-4" />
                            )}
                          </button>
                        )}
                        {/* Suggest similar */}
                        {ollamaAvailable && result.status === "NotFound" && (
                          <button
                            onClick={() => handleSuggestSimilar(i)}
                            disabled={loadingSimilar === i}
                            className="p-1.5 hover:bg-ytm-bg rounded-lg transition-colors text-ytm-text-secondary hover:text-white disabled:opacity-50"
                            title="Suggest similar tracks"
                          >
                            {loadingSimilar === i ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Search className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Similar track suggestions panel */}
                    {hasSimilar && (
                      <div className="ml-8 mt-1 mb-2 p-3 bg-ytm-bg rounded-lg border border-ytm-border">
                        <p className="text-xs font-medium text-purple-300 mb-2 flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          Similar Track Suggestions
                        </p>
                        <div className="space-y-1.5">
                          {similarSuggestions[i].search_queries.slice(0, 4).map((query, qi) => (
                            <button
                              key={qi}
                              onClick={() => applySimilarSuggestion(i, query)}
                              className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-ytm-surface transition-colors flex items-center gap-2"
                            >
                              <Music className="w-3 h-3 text-ytm-text-secondary flex-shrink-0" />
                              <span className="truncate">{query}</span>
                              <ArrowRight className="w-3 h-3 text-ytm-text-secondary flex-shrink-0 ml-auto" />
                            </button>
                          ))}
                        </div>
                        {similarSuggestions[i].same_artist_alternatives.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-ytm-border">
                            <p className="text-xs text-ytm-text-secondary mb-1">Same artist:</p>
                            {similarSuggestions[i].same_artist_alternatives.slice(0, 2).map((alt, ai) => (
                              <button
                                key={ai}
                                onClick={() => applySimilarSuggestion(i, `${result.spotify_track.artist_name} ${alt.title}`)}
                                className="w-full text-left text-xs px-2 py-1 rounded hover:bg-ytm-surface transition-colors text-ytm-text-secondary"
                              >
                                {alt.title} — <span className="italic">{alt.reason}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-4">
            <button
              onClick={reset}
              className="px-6 py-2 border border-ytm-border rounded-full hover:bg-ytm-surface transition-colors"
            >
              Import Another
            </button>
            <button
              onClick={createPlaylistWithTracks}
              disabled={foundCount + alternativeCount === 0}
              className={clsx(
                "px-6 py-2 text-white rounded-full font-medium transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed",
                isSmartMode ? "bg-purple-600 hover:bg-purple-700" : "bg-ytm-accent hover:bg-ytm-accent-hover"
              )}
            >
              <Plus className="w-4 h-4" />
              Create Playlist ({foundCount + alternativeCount} tracks)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
