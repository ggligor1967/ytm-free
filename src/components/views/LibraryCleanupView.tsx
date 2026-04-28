import { useState } from "react";
import * as api from "../../api";
import type {
  DuplicatePair,
  CleanedTrack,
  ArtistNormGroup,
  OrganizeSuggestion,
  DeletionSuggestion,
} from "../../types";
import {
  Loader2,
  Copy,
  Scissors,
  Users,
  FolderTree,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Search,
} from "lucide-react";
import clsx from "clsx";

type CleanupTab = "duplicates" | "clean-titles" | "normalize" | "organize" | "deletions";

const tabs: { id: CleanupTab; label: string; icon: typeof Copy; desc: string }[] = [
  { id: "duplicates",    label: "Duplicates",        icon: Copy,        desc: "Find duplicate tracks" },
  { id: "clean-titles",  label: "Clean Titles",      icon: Scissors,    desc: "Fix messy track titles" },
  { id: "normalize",     label: "Normalize Artists",  icon: Users,       desc: "Merge artist name variants" },
  { id: "organize",      label: "Auto-Organize",     icon: FolderTree,  desc: "Smart category suggestions" },
  { id: "deletions",     label: "Suggest Deletions",  icon: Trash2,      desc: "Find tracks to remove" },
];

export function LibraryCleanupView() {
  const [activeTab, setActiveTab] = useState<CleanupTab>("duplicates");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Library Cleanup</h2>
        <p className="text-ytm-text-secondary text-sm">
          AI-powered tools to keep your library tidy and organized
        </p>
      </div>

      {/* Tab buttons */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                activeTab === tab.id
                  ? "bg-ytm-accent text-white"
                  : "bg-ytm-surface text-ytm-text-secondary hover:bg-ytm-surface-hover hover:text-white"
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="bg-ytm-surface rounded-xl p-6 border border-ytm-border">
        {activeTab === "duplicates" && <DuplicatesPanel />}
        {activeTab === "clean-titles" && <CleanTitlesPanel />}
        {activeTab === "normalize" && <NormalizePanel />}
        {activeTab === "organize" && <OrganizePanel />}
        {activeTab === "deletions" && <DeletionsPanel />}
      </div>
    </div>
  );
}

// ============================================================================
// DUPLICATES PANEL
// ============================================================================

function DuplicatesPanel() {
  const [loading, setLoading] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicatePair[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scan = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.cleanupFindDuplicates();
      setDuplicates(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Find Duplicates</h3>
          <p className="text-sm text-ytm-text-secondary">Detect similar or duplicate tracks in your library</p>
        </div>
        <button
          onClick={scan}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-ytm-accent text-white rounded-lg hover:bg-ytm-accent/80 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          {loading ? "Scanning..." : "Scan"}
        </button>
      </div>

      {error && <ErrorMsg error={error} />}

      {duplicates !== null && duplicates.length === 0 && (
        <SuccessMsg message="No duplicates found! Your library is clean." />
      )}

      {duplicates && duplicates.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-ytm-text-secondary">Found {duplicates.length} potential duplicate(s)</p>
          {duplicates.map((dup, i) => (
            <div key={i} className="bg-ytm-bg rounded-lg p-4 border border-ytm-border hover:border-ytm-border-hover transition-colors">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Copy className="w-4 h-4 text-yellow-400" />
                  <span className="text-sm font-medium text-yellow-400">Similarity: {dup.similarity}%</span>
                </div>
              </div>
              <div className="space-y-2 mb-3">
                <div className="flex items-start gap-2">
                  <div className="text-xs text-ytm-text-tertiary mt-1 w-12 shrink-0">Track 1:</div>
                  <div className="text-sm text-white font-medium">{dup.track1}</div>
                </div>
                <div className="flex items-start gap-2">
                  <div className="text-xs text-ytm-text-tertiary mt-1 w-12 shrink-0">Track 2:</div>
                  <div className="text-sm text-white font-medium">{dup.track2}</div>
                </div>
              </div>
              {dup.suggestion && (
                <div className="pt-2 border-t border-ytm-border">
                  <p className="text-xs text-ytm-text-secondary italic">{dup.suggestion}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// CLEAN TITLES PANEL
// ============================================================================

function CleanTitlesPanel() {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [cleaned, setCleaned] = useState<CleanedTrack[] | null>(null);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = async () => {
    setLoading(true);
    setError(null);
    setApplied(false);
    try {
      const result = await api.cleanupFixMetadata();
      setCleaned(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const applyFixes = async () => {
    if (!cleaned?.length) return;
    setApplying(true);
    try {
      await api.cleanupApplyMetadata(cleaned);
      setApplied(true);
      setCleaned(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Clean Track Titles</h3>
          <p className="text-sm text-ytm-text-secondary">
            Remove "(Official Video)", "[HQ]", "ft." clutter from track names
          </p>
        </div>
        <button
          onClick={scan}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-ytm-accent text-white rounded-lg hover:bg-ytm-accent/80 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
          {loading ? "Analyzing..." : "Analyze"}
        </button>
      </div>

      {error && <ErrorMsg error={error} />}
      {applied && <SuccessMsg message="Metadata cleaned and applied!" />}

      {cleaned !== null && cleaned.length === 0 && (
        <SuccessMsg message="All titles look clean already!" />
      )}

      {cleaned && cleaned.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-ytm-text-secondary">{cleaned.length} track(s) can be cleaned</p>
            <button
              onClick={applyFixes}
              disabled={applying}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Apply All Fixes
            </button>
          </div>
          {cleaned.map((fix, i) => (
            <div key={i} className="bg-ytm-bg rounded-lg p-4 border border-ytm-border">
              <div className="flex items-center gap-3 text-sm">
                <span className="text-ytm-text-secondary line-through flex-1 truncate">
                  {fix.original_title} — {fix.original_artist}
                </span>
                <ChevronRight className="w-4 h-4 text-ytm-accent shrink-0" />
                <span className="text-white flex-1 truncate">
                  {fix.clean_title} — {fix.clean_artist}
                </span>
              </div>
              <p className="mt-1 text-xs text-ytm-text-secondary">{fix.changes}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// NORMALIZE ARTISTS PANEL
// ============================================================================

function NormalizePanel() {
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<ArtistNormGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scan = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.cleanupNormalizeArtists();
      setGroups(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Normalize Artist Names</h3>
          <p className="text-sm text-ytm-text-secondary">
            Find artist name variants (e.g. "AC/DC" vs "ACDC") and suggest merging
          </p>
        </div>
        <button
          onClick={scan}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-ytm-accent text-white rounded-lg hover:bg-ytm-accent/80 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
          {loading ? "Analyzing..." : "Analyze"}
        </button>
      </div>

      {error && <ErrorMsg error={error} />}

      {groups !== null && groups.length === 0 && (
        <SuccessMsg message="All artist names are consistent!" />
      )}

      {groups && groups.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-ytm-text-secondary">{groups.length} group(s) found with inconsistent names</p>
          {groups.map((group, i) => (
            <div key={i} className="bg-ytm-bg rounded-lg p-4 border border-ytm-border">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-green-400" />
                <span className="text-sm font-medium text-green-400">
                  Canonical: {group.canonical}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {group.variants.map((v, j) => (
                  <span key={j} className="px-2 py-1 bg-ytm-surface rounded text-xs text-ytm-text-secondary">
                    {v}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// AUTO-ORGANIZE PANEL
// ============================================================================

function OrganizePanel() {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<OrganizeSuggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scan = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.cleanupAutoOrganize();
      setSuggestions(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Auto-Organize</h3>
          <p className="text-sm text-ytm-text-secondary">
            Get AI suggestions for organizing your library into smart categories
          </p>
        </div>
        <button
          onClick={scan}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-ytm-accent text-white rounded-lg hover:bg-ytm-accent/80 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderTree className="w-4 h-4" />}
          {loading ? "Analyzing..." : "Analyze"}
        </button>
      </div>

      {error && <ErrorMsg error={error} />}

      {suggestions !== null && suggestions.length === 0 && (
        <SuccessMsg message="Your library is already well organized!" />
      )}

      {suggestions && suggestions.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-ytm-text-secondary">{suggestions.length} category suggestion(s)</p>
          {suggestions.map((sug, i) => (
            <div key={i} className="bg-ytm-bg rounded-lg p-4 border border-ytm-border">
              <h4 className="text-sm font-semibold text-ytm-accent mb-1">{sug.category}</h4>
              <p className="text-xs text-ytm-text-secondary mb-2">{sug.reason}</p>
              <div className="flex flex-wrap gap-1">
                {sug.tracks.map((t, j) => (
                  <span key={j} className="px-2 py-0.5 bg-ytm-surface rounded text-xs text-ytm-text-secondary">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SUGGEST DELETIONS PANEL
// ============================================================================

function DeletionsPanel() {
  const [loading, setLoading] = useState(false);
  const [safeToDelete, setSafeToDelete] = useState<DeletionSuggestion[] | null>(null);
  const [keep, setKeep] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);

  const scan = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.cleanupSuggestDeletions();
      setSafeToDelete(result.safe_to_delete);
      setKeep(result.keep);
      setSummary(result.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Suggest Deletions</h3>
          <p className="text-sm text-ytm-text-secondary">
            Find never-played tracks that might be safe to remove
          </p>
        </div>
        <button
          onClick={scan}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-ytm-accent text-white rounded-lg hover:bg-ytm-accent/80 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          {loading ? "Analyzing..." : "Analyze"}
        </button>
      </div>

      {error && <ErrorMsg error={error} />}

      {summary && (
        <p className="text-sm text-ytm-text-secondary mb-4 italic">{summary}</p>
      )}

      {safeToDelete !== null && safeToDelete.length === 0 && (
        <SuccessMsg message="No deletion suggestions — all tracks are valuable!" />
      )}

      {safeToDelete && safeToDelete.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-yellow-400 text-sm">
            <AlertTriangle className="w-4 h-4" />
            <span>{safeToDelete.length} track(s) could be removed</span>
          </div>
          {safeToDelete.map((item, i) => (
            <div key={i} className="bg-ytm-bg rounded-lg p-3 border border-ytm-border flex items-center justify-between">
              <div>
                <p className="text-sm">{item.track}</p>
                <p className="text-xs text-ytm-text-secondary">{item.reason}</p>
              </div>
              <Trash2 className="w-4 h-4 text-ytm-text-secondary" />
            </div>
          ))}
        </div>
      )}

      {keep.length > 0 && (
        <div className="mt-4">
          <p className="text-sm text-green-400 mb-2 flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4" /> Keep these tracks:
          </p>
          <div className="flex flex-wrap gap-1">
            {keep.map((t, i) => (
              <span key={i} className="px-2 py-0.5 bg-ytm-surface rounded text-xs text-ytm-text-secondary">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SHARED COMPONENTS
// ============================================================================

function ErrorMsg({ error }: { error: string }) {
  return (
    <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm mb-4">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>{error}</span>
    </div>
  );
}

function SuccessMsg({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-green-400 text-sm">
      <CheckCircle2 className="w-4 h-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
