import { useState } from "react";
import { useAppStore } from "../../store";
import * as api from "../../api";
import { Plus, ListMusic, MoreVertical, Trash2, Loader2, Sparkles } from "lucide-react";
import clsx from "clsx";

export function PlaylistsView() {
  const { 
    playlists, 
    setPlaylists, 
    setView, 
    setSelectedPlaylistId,
    settings,
    ollamaAvailable,
    aiPlaylistSuggestion,
    setAIPlaylistSuggestion,
  } = useAppStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [showAIGen, setShowAIGen] = useState(false);
  const [aiDescription, setAIDescription] = useState("");
  const [generatingAI, setGeneratingAI] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    
    setLoading(true);
    try {
      await api.createPlaylist(newName, newDesc || undefined);
      const updated = await api.getPlaylists();
      setPlaylists(updated);
      setShowCreate(false);
      setNewName("");
      setNewDesc("");
    } catch (error) {
      console.error("Failed to create playlist:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this playlist?")) return;
    
    try {
      await api.deletePlaylist(id);
      const updated = await api.getPlaylists();
      setPlaylists(updated);
    } catch (error) {
      console.error("Failed to delete playlist:", error);
    }
    setMenuOpen(null);
  };

  const openPlaylist = (id: string) => {
    setSelectedPlaylistId(id);
    setView("playlist");
  };

  const handleGenerateAI = async () => {
    if (!aiDescription.trim()) return;

    setGeneratingAI(true);
    try {
      const suggestion = await api.ollamaGeneratePlaylist(aiDescription);
      setAIPlaylistSuggestion(suggestion);
    } catch (error) {
      console.error("Failed to generate AI playlist:", error);
    } finally {
      setGeneratingAI(false);
    }
  };

  const handleCreateFromAI = async () => {
    if (!aiPlaylistSuggestion) return;

    setLoading(true);
    try {
      await api.createPlaylist(aiPlaylistSuggestion.name, aiPlaylistSuggestion.description);
      const updated = await api.getPlaylists();
      setPlaylists(updated);
      setShowAIGen(false);
      setAIDescription("");
      setAIPlaylistSuggestion(null);
    } catch (error) {
      console.error("Failed to create playlist:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Playlists</h1>
          <p className="text-ytm-text-secondary">{playlists.length} playlists</p>
        </div>
        <div className="flex gap-2">
          {settings?.ollama_enabled && ollamaAvailable && (
            <button
              onClick={() => {
                setShowAIGen(true);
                setAIPlaylistSuggestion(null);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-ytm-accent/10 text-ytm-accent border border-ytm-accent rounded-full font-medium hover:bg-ytm-accent/20 transition-colors"
            >
              <Sparkles className="w-5 h-5" />
              Generate Smart Playlist
            </button>
          )}
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-ytm-accent text-white rounded-full font-medium hover:bg-ytm-accent-hover transition-colors"
          >
            <Plus className="w-5 h-5" />
            Create Playlist
          </button>
        </div>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="bg-ytm-surface p-4 rounded-xl space-y-4">
          <h3 className="font-semibold">Create New Playlist</h3>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Playlist name"
            className="w-full px-4 py-2 bg-ytm-bg border border-ytm-border rounded-lg focus:outline-none focus:border-ytm-accent"
          />
          <input
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full px-4 py-2 bg-ytm-bg border border-ytm-border rounded-lg focus:outline-none focus:border-ytm-accent"
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                setShowCreate(false);
                setNewName("");
                setNewDesc("");
              }}
              className="px-4 py-2 border border-ytm-border rounded-lg hover:bg-ytm-surface-hover"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || loading}
              className="px-4 py-2 bg-ytm-accent text-white rounded-lg hover:bg-ytm-accent-hover disabled:opacity-50 flex items-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Create
            </button>
          </div>
        </div>
      )}

      {/* AI Generate Form */}
      {showAIGen && (
        <div className="bg-ytm-surface p-4 rounded-xl space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-ytm-accent" />
            <h3 className="font-semibold">Generate Smart Playlist with AI</h3>
          </div>
          
          {!aiPlaylistSuggestion ? (
            <>
              <textarea
                value={aiDescription}
                onChange={(e) => setAIDescription(e.target.value)}
                placeholder="Describe your ideal playlist... (e.g., 'upbeat rock songs for working out' or 'calm jazz for studying')"
                rows={3}
                className="w-full px-4 py-2 bg-ytm-bg border border-ytm-border rounded-lg focus:outline-none focus:border-ytm-accent resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowAIGen(false);
                    setAIDescription("");
                  }}
                  className="px-4 py-2 border border-ytm-border rounded-lg hover:bg-ytm-surface-hover"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGenerateAI}
                  disabled={!aiDescription.trim() || generatingAI}
                  className="px-4 py-2 bg-ytm-accent text-white rounded-lg hover:bg-ytm-accent-hover disabled:opacity-50 flex items-center gap-2"
                >
                  {generatingAI && <Loader2 className="w-4 h-4 animate-spin" />}
                  Generate
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-ytm-text-secondary">Suggested Name</label>
                  <p className="text-lg font-semibold mt-1">{aiPlaylistSuggestion.name}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-ytm-text-secondary">Description</label>
                  <p className="mt-1">{aiPlaylistSuggestion.description}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-ytm-text-secondary">Suggested Search Queries</label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {aiPlaylistSuggestion.search_queries.map((query, index) => (
                      <span
                        key={index}
                        className={clsx(
                          "px-3 py-1.5 rounded-full text-sm",
                          "bg-ytm-bg border border-ytm-border"
                        )}
                      >
                        {query}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setAIPlaylistSuggestion(null);
                  }}
                  className="px-4 py-2 border border-ytm-border rounded-lg hover:bg-ytm-surface-hover"
                >
                  Regenerate
                </button>
                <button
                  onClick={() => {
                    setShowAIGen(false);
                    setAIDescription("");
                    setAIPlaylistSuggestion(null);
                  }}
                  className="px-4 py-2 border border-ytm-border rounded-lg hover:bg-ytm-surface-hover"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateFromAI}
                  disabled={loading}
                  className="px-4 py-2 bg-ytm-accent text-white rounded-lg hover:bg-ytm-accent-hover disabled:opacity-50 flex items-center gap-2"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Create Playlist
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Playlists Grid */}
      {playlists.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-24 h-24 bg-ytm-surface rounded-full flex items-center justify-center mb-4">
            <ListMusic className="w-12 h-12 text-ytm-text-secondary" />
          </div>
          <h2 className="text-xl font-bold mb-2">No playlists yet</h2>
          <p className="text-ytm-text-secondary">
            Create your first playlist to organize your music
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {playlists.map((playlist) => (
            <div
              key={playlist.id}
              className="group relative bg-ytm-surface rounded-xl p-4 hover:bg-ytm-surface-hover transition-colors cursor-pointer"
              onClick={() => openPlaylist(playlist.id)}
            >
              {/* Playlist Art */}
              <div className="aspect-square bg-ytm-bg rounded-lg mb-3 flex items-center justify-center">
                <ListMusic className="w-12 h-12 text-ytm-text-secondary" />
              </div>

              {/* Info */}
              <h3 className="font-semibold truncate">{playlist.name}</h3>
              <p className="text-sm text-ytm-text-secondary">
                {playlist.track_count} tracks
              </p>

              {/* Menu */}
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(menuOpen === playlist.id ? null : playlist.id);
                  }}
                  className="p-2 bg-ytm-bg/80 rounded-full hover:bg-ytm-bg"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>

                {menuOpen === playlist.id && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(null);
                      }}
                    />
                    <div className="absolute right-0 top-full mt-1 w-40 bg-ytm-surface border border-ytm-border rounded-lg shadow-xl z-50 py-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(playlist.id);
                        }}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-ytm-surface-hover flex items-center gap-2 text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
