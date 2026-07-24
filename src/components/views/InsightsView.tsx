import { useAppStore } from "../../store";
import {
  BarChart3, Brain, Clock, Flame, Heart, Loader2, Music,
  RefreshCw, Sparkles, TrendingUp, User, Disc, Globe, Zap, Calendar, Gift
} from "lucide-react";
import * as api from "../../api";
import { showToast } from "../../lib/toast";
import { useState, useEffect, useCallback } from "react";
import type {
  ListeningProfileResponse,
  WeeklySummaryResponse,
  TimePatternsResponse,
  ForgottenGemsResponse,
  ArtistDeepDiveResponse,
  GenreExplorerResponse,
  BecauseYouLikedResponse,
  SurpriseMeResponse,
  SeasonalResponse,
  YearInReviewResponse,
} from "../../types";

type InsightsTab = "overview" | "profile" | "discover" | "explore" | "wrapped";

export function InsightsView() {
  const {
    ollamaAvailable,
    insightsStats,
    setInsightsStats,
    insightsLoading,
    setInsightsLoading,
    setSearchQuery,
    setView,
    setIsSearching,
    setSearchResults,
    settings,
  } = useAppStore();

  // Helper: search YouTube and navigate to SearchView
  const searchYoutube = async (query: string) => {
    setSearchQuery(query);
    setView("search");
    setIsSearching(true);
    try {
      const results = await api.searchYoutube(query, settings?.search_results_count);
      setSearchResults(results);
    } catch (error) {
      console.error("Search error:", error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const [tab, setTab] = useState<InsightsTab>("overview");

  // Overview tab state
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [weekly, setWeekly] = useState<WeeklySummaryResponse | null>(null);
  const [timePatterns, setTimePatterns] = useState<TimePatternsResponse | null>(null);
  const [timePatternsLoading, setTimePatternsLoading] = useState(false);

  // Profile tab state
  const [profile, setProfile] = useState<ListeningProfileResponse | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // Discover tab state
  const [forgottenGems, setForgottenGems] = useState<ForgottenGemsResponse | null>(null);
  const [forgottenGemsLoading, setForgottenGemsLoading] = useState(false);
  const [becauseYouLiked, setBecauseYouLiked] = useState<BecauseYouLikedResponse | null>(null);
  const [becauseYouLikedLoading, setBecauseYouLikedLoading] = useState(false);
  const [surpriseMe, setSurpriseMe] = useState<SurpriseMeResponse | null>(null);
  const [surpriseMeLoading, setSurpriseMeLoading] = useState(false);
  const [seasonal, setSeasonal] = useState<SeasonalResponse | null>(null);
  const [seasonalLoading, setSeasonalLoading] = useState(false);

  // Wrapped / Year in Review tab state
  const [yearInReview, setYearInReview] = useState<YearInReviewResponse | null>(null);
  const [yearInReviewLoading, setYearInReviewLoading] = useState(false);

  // Explore tab state
  const [artistQuery, setArtistQuery] = useState("");
  const [genreQuery, setGenreQuery] = useState("");
  const [artistDive, setArtistDive] = useState<ArtistDeepDiveResponse | null>(null);
  const [artistDiveLoading, setArtistDiveLoading] = useState(false);
  const [genreExplore, setGenreExplore] = useState<GenreExplorerResponse | null>(null);
  const [genreExploreLoading, setGenreExploreLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // Load stats on mount
  const loadStats = useCallback(async () => {
    setInsightsLoading(true);
    setError(null);
    try {
      const stats = await api.insightsStats(30);
      setInsightsStats(stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInsightsLoading(false);
    }
  }, [setInsightsStats, setInsightsLoading]);

  useEffect(() => {
    if (!insightsStats) loadStats();
  }, [insightsStats, loadStats]);

  // AI loaders
  const loadWeekly = async () => {
    setWeeklyLoading(true);
    try { setWeekly(await api.insightsWeeklySummary()); } catch (e) { setError(String(e)); }
    finally { setWeeklyLoading(false); }
  };

  const loadTimePatterns = async () => {
    setTimePatternsLoading(true);
    try { setTimePatterns(await api.insightsTimePatterns()); } catch (e) { setError(String(e)); }
    finally { setTimePatternsLoading(false); }
  };

  const loadProfile = async () => {
    setProfileLoading(true);
    try { setProfile(await api.insightsListeningProfile()); } catch (e) { setError(String(e)); }
    finally { setProfileLoading(false); }
  };

  const loadForgottenGems = async () => {
    setForgottenGemsLoading(true);
    try { setForgottenGems(await api.insightsForgottenGems()); } catch (e) { setError(String(e)); }
    finally { setForgottenGemsLoading(false); }
  };

  const loadBecauseYouLiked = async () => {
    setBecauseYouLikedLoading(true);
    try { setBecauseYouLiked(await api.insightsBecauseYouLiked()); } catch (e) { setError(String(e)); }
    finally { setBecauseYouLikedLoading(false); }
  };

  const loadSurpriseMe = async () => {
    setSurpriseMeLoading(true);
    try { setSurpriseMe(await api.insightsSurpriseMe()); } catch (e) { setError(String(e)); }
    finally { setSurpriseMeLoading(false); }
  };

  const loadSeasonal = async () => {
    setSeasonalLoading(true);
    try { setSeasonal(await api.insightsSeasonal()); } catch (e) { setError(String(e)); }
    finally { setSeasonalLoading(false); }
  };

  const loadArtistDive = async (name?: string) => {
    const q = name || artistQuery.trim();
    if (!q) return;
    if (name) setArtistQuery(name);
    setArtistDiveLoading(true);
    try { setArtistDive(await api.insightsArtistDeepDive(q)); } catch (e) { setError(String(e)); }
    finally { setArtistDiveLoading(false); }
  };

  const loadGenreExplore = async (name?: string) => {
    const q = name || genreQuery.trim();
    if (!q) return;
    if (name) setGenreQuery(name);
    setGenreExploreLoading(true);
    try { setGenreExplore(await api.insightsGenreExplorer(q)); } catch (e) { setError(String(e)); }
    finally { setGenreExploreLoading(false); }
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const maxHourly = insightsStats?.hourly_breakdown
    ? Math.max(...insightsStats.hourly_breakdown.map(([, c]) => c), 1)
    : 1;

  const tabs: { id: InsightsTab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Prezentare", icon: <BarChart3 size={16} /> },
    { id: "profile", label: "Profil AI", icon: <User size={16} /> },
    { id: "discover", label: "Descoperă", icon: <Sparkles size={16} /> },
    { id: "explore", label: "Explorează", icon: <Globe size={16} /> },
    { id: "wrapped", label: "Year in Review", icon: <Gift size={16} /> },
  ];

  const loadYearInReview = async () => {
    setYearInReviewLoading(true);
    try { setYearInReview(await api.shareYearInReview()); } catch (e) { setError(String(e)); }
    finally { setYearInReviewLoading(false); }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <BarChart3 size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Insights & Analytics</h1>
            <p className="text-sm text-zinc-400">
              {insightsStats ? `${insightsStats.total_tracks} tracks tracked` : "Loading..."}
              {insightsStats?.streak_days ? ` · 🔥 ${insightsStats.streak_days} day streak` : ""}
            </p>
          </div>
        </div>
        <button
          onClick={loadStats}
          disabled={insightsLoading}
          className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition disabled:opacity-50"
          title="Refresh stats"
        >
          <RefreshCw size={18} className={insightsLoading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-zinc-800/50 rounded-lg p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${
              tab === t.id
                ? "bg-purple-600 text-white"
                : "text-zinc-400 hover:text-white hover:bg-zinc-700"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* ─── OVERVIEW TAB ─── */}
      {tab === "overview" && (
        <div className="space-y-6">
          {/* Stat cards */}
          {insightsStats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard icon={<Music size={20} />} label="Tracks" value={insightsStats.total_tracks} color="blue" />
              <StatCard icon={<Clock size={20} />} label="Total Time" value={formatTime(insightsStats.total_time_seconds)} color="green" />
              <StatCard icon={<Flame size={20} />} label="Streak" value={`${insightsStats.streak_days} days`} color="orange" />
              <StatCard icon={<TrendingUp size={20} />} label="Top Genre" value={insightsStats.top_genres[0]?.[0] || "—"} color="purple" />
            </div>
          )}

          {/* Hourly chart */}
          {insightsStats && insightsStats.hourly_breakdown.length > 0 && (
            <div className="bg-zinc-800/50 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                <Clock size={18} className="text-blue-400" /> Listening by Hour
              </h3>
              <div className="flex items-end gap-1 h-32">
                {Array.from({ length: 24 }, (_, h) => {
                  const count = insightsStats.hourly_breakdown.find(([hour]) => hour === h)?.[1] || 0;
                  const pct = (count / maxHourly) * 100;
                  return (
                    <div key={h} className="flex-1 flex flex-col items-center gap-1 group relative">
                      <div
                        className="w-full rounded-t bg-gradient-to-t from-purple-600 to-purple-400 transition-all hover:from-purple-500 hover:to-purple-300 min-h-[2px]"
                        style={{ height: `${Math.max(pct, 2)}%` }}
                        title={`${h}:00 — ${count} plays`}
                      />
                      {h % 4 === 0 && (
                        <span className="text-[10px] text-zinc-500">{h}h</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Top artists & genres */}
          {insightsStats && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TopList title="Top Artists" icon={<User size={18} />} items={insightsStats.top_artists} color="pink" />
              <TopList title="Top Genres" icon={<Disc size={18} />} items={insightsStats.top_genres} color="blue" />
            </div>
          )}

          {/* Top tracks */}
          {insightsStats && insightsStats.top_tracks.length > 0 && (
            <div className="bg-zinc-800/50 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                <TrendingUp size={18} className="text-green-400" /> Top Tracks (30 days)
              </h3>
              <div className="space-y-2">
                {insightsStats.top_tracks.slice(0, 5).map((item, i) => (
                  <div key={item.track.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-700/50">
                    <span className="text-lg font-bold text-zinc-500 w-6 text-right">#{i + 1}</span>
                    {item.track.thumbnail && (
                      <img src={item.track.thumbnail} alt="" className="w-10 h-10 rounded object-cover" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{item.track.title}</p>
                      <p className="text-zinc-400 text-xs truncate">{item.track.artist}</p>
                    </div>
                    <span className="text-zinc-400 text-sm">{item.play_count} plays</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Weekly summary (AI) */}
          {ollamaAvailable && (
            <AICard
              title="Weekly Summary"
              icon={<Brain size={18} />}
              loading={weeklyLoading}
              onLoad={loadWeekly}
              loaded={!!weekly}
            >
              {weekly && (
                <div className="space-y-3 text-sm">
                  <p className="text-zinc-300">{weekly.summary_text}</p>
                  <div className="grid grid-cols-3 gap-3">
                    <MiniCard label="Highlight" value={weekly.highlight} />
                    <MiniCard label="Trend" value={weekly.trend} />
                    <MiniCard label="Tip" value={weekly.recommendation} />
                  </div>
                </div>
              )}
            </AICard>
          )}

          {/* Time patterns (AI) */}
          {ollamaAvailable && (
            <AICard
              title="Time Patterns"
              icon={<Clock size={18} />}
              loading={timePatternsLoading}
              onLoad={loadTimePatterns}
              loaded={!!timePatterns}
            >
              {timePatterns && (
                <div className="space-y-2 text-sm">
                  <p className="text-purple-300 font-medium">{timePatterns.pattern_name}</p>
                  <p className="text-zinc-300">{timePatterns.insight}</p>
                  <div className="flex gap-2 flex-wrap">
                    {timePatterns.peak_hours.map((h) => (
                      <span key={h} className="px-2 py-1 rounded bg-green-500/20 text-green-400 text-xs">{h}:00 🔥</span>
                    ))}
                    {timePatterns.quiet_hours.map((h) => (
                      <span key={h} className="px-2 py-1 rounded bg-blue-500/20 text-blue-400 text-xs">{h}:00 🌙</span>
                    ))}
                  </div>
                </div>
              )}
            </AICard>
          )}
        </div>
      )}

      {/* ─── PROFILE TAB ─── */}
      {tab === "profile" && (
        <div className="space-y-6">
          {!ollamaAvailable ? (
            <div className="text-center py-12 text-zinc-400">
              <Brain size={48} className="mx-auto mb-4 opacity-50" />
              <p>Ollama AI is not available. Enable it in Settings to see your music personality.</p>
            </div>
          ) : (
            <AICard
              title="Your Music Personality"
              icon={<User size={18} />}
              loading={profileLoading}
              onLoad={loadProfile}
              loaded={!!profile}
              buttonText="Analyze My Profile"
            >
              {profile && (
                <div className="space-y-4">
                  <div className="text-center py-4">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold text-lg">
                      <Sparkles size={20} /> {profile.music_personality}
                    </div>
                  </div>
                  <p className="text-zinc-300 text-sm leading-relaxed whitespace-pre-line">{profile.profile_text}</p>
                </div>
              )}
            </AICard>
          )}

          {/* Mood & Genre breakdown from stats */}
          {insightsStats && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TopList title="Your Moods" icon={<Heart size={18} />} items={insightsStats.top_moods} color="pink" />
              <TopList title="Your Genres" icon={<Disc size={18} />} items={insightsStats.top_genres} color="purple" />
            </div>
          )}
        </div>
      )}

      {/* ─── DISCOVER TAB ─── */}
      {tab === "discover" && (
        <div className="space-y-6">
          {!ollamaAvailable ? (
            <div className="text-center py-12 text-zinc-400">
              <Sparkles size={48} className="mx-auto mb-4 opacity-50" />
              <p>Ollama AI is required for discovery features.</p>
            </div>
          ) : (
            <>
              {/* Forgotten gems */}
              <AICard
                title="Forgotten Gems 💎"
                icon={<Music size={18} />}
                loading={forgottenGemsLoading}
                onLoad={loadForgottenGems}
                loaded={!!forgottenGems}
                buttonText="Find Hidden Gems"
              >
                {forgottenGems && (
                  <div className="space-y-2">
                    <p className="text-zinc-400 text-sm">{forgottenGems.message}</p>
                    {forgottenGems.gems.map((gem, i) => (
                      <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-zinc-700/30">
                        <span className="text-yellow-400">💎</span>
                        <div className="flex-1">
                          <p className="text-zinc-300 text-sm">{gem.track_id}</p>
                          <p className="text-zinc-500 text-xs">{gem.reason}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </AICard>

              {/* Because You Liked */}
              <AICard
                title="Because You Liked ❤️"
                icon={<Heart size={18} />}
                loading={becauseYouLikedLoading}
                onLoad={loadBecauseYouLiked}
                loaded={!!becauseYouLiked}
                buttonText="Get Recommendations"
              >
                {becauseYouLiked && (
                  <div className="space-y-3">
                    <p className="text-zinc-400 text-sm italic">{becauseYouLiked.insight}</p>
                    {becauseYouLiked.recommendations.map((rec, i) => (
                      <RecommendationCard key={i} title={rec.title} artist={rec.artist} reason={rec.reason} query={rec.search_query} />
                    ))}
                  </div>
                )}
              </AICard>

              {/* Surprise Me */}
              <AICard
                title="Surprise Me! 🎲"
                icon={<Zap size={18} />}
                loading={surpriseMeLoading}
                onLoad={loadSurpriseMe}
                loaded={!!surpriseMe}
                buttonText="Surprise Me!"
              >
                {surpriseMe && (
                  <div className="space-y-3">
                    <p className="text-purple-300 font-medium text-sm">Theme: {surpriseMe.theme}</p>
                    {surpriseMe.surprises.map((s, i) => (
                      <RecommendationCard key={i} title={s.title} artist={s.artist} reason={s.why_surprise} query={s.search_query} />
                    ))}
                  </div>
                )}
              </AICard>

              {/* Seasonal */}
              <AICard
                title="Seasonal Picks 🍂"
                icon={<Calendar size={18} />}
                loading={seasonalLoading}
                onLoad={loadSeasonal}
                loaded={!!seasonal}
                buttonText="Get Seasonal Picks"
              >
                {seasonal && (
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <span className="px-3 py-1 rounded-full bg-orange-500/20 text-orange-300 text-sm">{seasonal.season}</span>
                      <span className="px-3 py-1 rounded-full bg-blue-500/20 text-blue-300 text-sm">{seasonal.mood}</span>
                    </div>
                    {seasonal.recommendations.map((rec, i) => (
                      <RecommendationCard key={i} title={rec.title} artist={rec.artist} reason={rec.seasonal_fit} query={rec.search_query} />
                    ))}
                  </div>
                )}
              </AICard>
            </>
          )}
        </div>
      )}

      {/* ─── EXPLORE TAB ─── */}
      {tab === "explore" && (
        <div className="space-y-6">
          {!ollamaAvailable ? (
            <div className="text-center py-12 text-zinc-400">
              <Globe size={48} className="mx-auto mb-4 opacity-50" />
              <p>Ollama AI is required for exploration features.</p>
            </div>
          ) : (
            <>
              {/* Artist deep dive */}
              <div className="bg-zinc-800/50 rounded-xl p-5">
                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                  <User size={18} className="text-pink-400" /> Artist Deep Dive
                </h3>
                <div className="flex gap-2 mb-4">
                  <input
                    value={artistQuery}
                    onChange={(e) => setArtistQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && loadArtistDive()}
                    placeholder="Enter artist name..."
                    className="flex-1 bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                  />
                  <button
                    onClick={() => loadArtistDive()}
                    disabled={artistDiveLoading || !artistQuery.trim()}
                    className="px-4 py-2 rounded-lg bg-pink-600 hover:bg-pink-500 text-white text-sm disabled:opacity-50 flex items-center gap-2"
                  >
                    {artistDiveLoading ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />} Explore
                  </button>
                </div>
                {artistDive && (
                  <div className="space-y-3">
                    <h4 className="text-lg font-bold text-white">{artistDive.artist}</h4>
                    <p className="text-zinc-300 text-sm leading-relaxed">{artistDive.bio}</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <TagList label="Essential Albums" items={artistDive.essential_albums} emoji="💿" onItemClick={(album) => searchYoutube(`${artistDive.artist} ${album}`)} />
                      <TagList label="Recommended" items={artistDive.recommended_tracks} emoji="🎵" onItemClick={(track) => searchYoutube(`${artistDive.artist} ${track}`)} />
                      <TagList label="Similar Artists" items={artistDive.similar_artists} emoji="👤" onItemClick={(artist) => loadArtistDive(artist)} />
                    </div>
                    {artistDive.fun_fact && (
                      <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 text-sm">
                        💡 {artistDive.fun_fact}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Genre explorer */}
              <div className="bg-zinc-800/50 rounded-xl p-5">
                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                  <Disc size={18} className="text-blue-400" /> Genre Explorer
                </h3>
                <div className="flex gap-2 mb-4">
                  <input
                    value={genreQuery}
                    onChange={(e) => setGenreQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && loadGenreExplore()}
                    placeholder="Enter genre name..."
                    className="flex-1 bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                  />
                  <button
                    onClick={() => loadGenreExplore()}
                    disabled={genreExploreLoading || !genreQuery.trim()}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm disabled:opacity-50 flex items-center gap-2"
                  >
                    {genreExploreLoading ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />} Explore
                  </button>
                </div>
                {genreExplore && (
                  <div className="space-y-3">
                    <h4 className="text-lg font-bold text-white">{genreExplore.genre}</h4>
                    <p className="text-zinc-300 text-sm leading-relaxed">{genreExplore.description}</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <TagList label="Sub-genres" items={genreExplore.sub_genres} emoji="🏷️" onItemClick={(sub) => loadGenreExplore(sub)} />
                      <TagList label="Legendary Artists" items={genreExplore.legendary_artists} emoji="🌟" onItemClick={(artist) => loadArtistDive(artist)} />
                      <TagList label="Essential Tracks" items={genreExplore.essential_tracks} emoji="🎵" onItemClick={(track) => searchYoutube(track)} />
                      <TagList label="Related Genres" items={genreExplore.related_genres} emoji="🔗" onItemClick={(genre) => loadGenreExplore(genre)} />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── YEAR IN REVIEW / WRAPPED TAB ─── */}
      {tab === "wrapped" && (
        <div className="space-y-6">
          <AICard
            title="Year in Review"
            icon={<Gift size={18} />}
            loading={yearInReviewLoading}
            onLoad={loadYearInReview}
            loaded={!!yearInReview}
            buttonText="Generate My Wrapped"
          >
            {yearInReview && (
              <div className="space-y-6">
                <div className="text-center py-4">
                  <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
                    {yearInReview.title}
                  </h2>
                  <p className="text-sm text-zinc-400 mt-1">
                    Your music personality: <span className="text-purple-300 font-semibold">{yearInReview.music_personality}</span>
                  </p>
                </div>

                {yearInReview.sections.map((section, i) => (
                  <div key={i} className="bg-zinc-700/30 rounded-lg p-4">
                    <h4 className="font-semibold text-white mb-2">{section.heading}</h4>
                    <p className="text-zinc-300 text-sm whitespace-pre-wrap">{section.text}</p>
                  </div>
                ))}

                {yearInReview.fun_stats.length > 0 && (
                  <div className="bg-gradient-to-br from-purple-600/20 to-pink-600/20 border border-purple-500/30 rounded-xl p-5">
                    <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
                      <Sparkles size={16} className="text-purple-400" /> Fun Stats
                    </h4>
                    <div className="space-y-2">
                      {yearInReview.fun_stats.map((stat, i) => (
                        <p key={i} className="text-zinc-300 text-sm">• {stat}</p>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  onClick={async () => {
                    const text = [
                      yearInReview.title,
                      `Music Personality: ${yearInReview.music_personality}`,
                      ...yearInReview.fun_stats.map(s => `• ${s}`),
                    ].join('\n');
                    await navigator.clipboard.writeText(text);
                    showToast('Year in Review copied!', 'success');
                  }}
                  className="w-full px-4 py-2 bg-purple-600/20 hover:bg-purple-600/40 text-purple-300 rounded-lg text-sm transition flex items-center justify-center gap-2"
                >
                  <Gift size={14} /> Copy to Clipboard
                </button>
              </div>
            )}
          </AICard>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  const colors: Record<string, string> = {
    blue: "from-blue-600/20 to-blue-500/5 border-blue-500/30",
    green: "from-green-600/20 to-green-500/5 border-green-500/30",
    orange: "from-orange-600/20 to-orange-500/5 border-orange-500/30",
    purple: "from-purple-600/20 to-purple-500/5 border-purple-500/30",
  };
  const iconColors: Record<string, string> = {
    blue: "text-blue-400",
    green: "text-green-400",
    orange: "text-orange-400",
    purple: "text-purple-400",
  };
  return (
    <div className={`rounded-xl bg-gradient-to-br ${colors[color]} border p-4`}>
      <div className={`${iconColors[color]} mb-2`}>{icon}</div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-xs text-zinc-400">{label}</p>
    </div>
  );
}

function TopList({ title, icon, items, color }: { title: string; icon: React.ReactNode; items: [string, number][]; color: string }) {
  const maxCount = Math.max(...items.map(([, c]) => c), 1);
  const barColor = color === "pink" ? "bg-pink-500" : "bg-blue-500";
  return (
    <div className="bg-zinc-800/50 rounded-xl p-5">
      <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
        {icon} {title}
      </h3>
      <div className="space-y-2">
        {items.slice(0, 5).map(([name, count]) => (
          <div key={name} className="flex items-center gap-3">
            <span className="text-zinc-300 text-sm w-24 truncate">{name}</span>
            <div className="flex-1 bg-zinc-700 rounded-full h-2">
              <div className={`${barColor} rounded-full h-2 transition-all`} style={{ width: `${(count / maxCount) * 100}%` }} />
            </div>
            <span className="text-zinc-500 text-xs w-8 text-right">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AICard({
  title, icon, loading, onLoad, loaded, buttonText, children,
}: {
  title: string; icon: React.ReactNode; loading: boolean; onLoad: () => void; loaded: boolean; buttonText?: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-zinc-800/50 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <span className="text-purple-400">{icon}</span> {title}
        </h3>
        <button
          onClick={onLoad}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600/40 text-purple-300 text-sm transition disabled:opacity-50 flex items-center gap-1.5"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
          {loaded ? "Refresh" : (buttonText || "Generate")}
        </button>
      </div>
      {loading && !loaded && (
        <div className="flex items-center gap-2 py-8 justify-center text-zinc-500 text-sm">
          <Loader2 size={18} className="animate-spin" /> AI is thinking...
        </div>
      )}
      {children}
    </div>
  );
}

function MiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-700/50 rounded-lg p-3">
      <p className="text-zinc-500 text-xs mb-1">{label}</p>
      <p className="text-zinc-200 text-sm">{value}</p>
    </div>
  );
}

function RecommendationCard({ title, artist, reason, query }: { title: string; artist: string; reason: string; query: string }) {
  const { setSearchQuery, setView, setIsSearching, setSearchResults, settings } = useAppStore();
  const handleSearch = async () => {
    const q = query || `${artist} - ${title}`;
    setSearchQuery(q);
    setView("search");
    setIsSearching(true);
    try {
      const results = await api.searchYoutube(q, settings?.search_results_count);
      setSearchResults(results);
    } catch (error) {
      console.error("Search error:", error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-700/30 hover:bg-zinc-700/50 transition group">
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-medium">{title}</p>
        <p className="text-zinc-400 text-xs">{artist}</p>
        <p className="text-zinc-500 text-xs mt-1">{reason}</p>
      </div>
      <button
        onClick={handleSearch}
        className="p-2 rounded-lg bg-zinc-600/50 hover:bg-purple-600 text-zinc-400 hover:text-white transition opacity-0 group-hover:opacity-100"
        title="Search for this track"
      >
        <Music size={14} />
      </button>
    </div>
  );
}

function TagList({ label, items, emoji, onItemClick }: { label: string; items: string[]; emoji: string; onItemClick?: (item: string) => void }) {
  return (
    <div>
      <p className="text-zinc-500 text-xs mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) =>
          onItemClick ? (
            <button
              key={i}
              onClick={() => onItemClick(item)}
              className="px-2 py-1 rounded bg-zinc-700/50 text-zinc-300 text-xs hover:bg-purple-600/40 hover:text-white transition cursor-pointer"
              title={`Click to explore: ${item}`}
            >
              {emoji} {item}
            </button>
          ) : (
            <span key={i} className="px-2 py-1 rounded bg-zinc-700/50 text-zinc-300 text-xs">
              {emoji} {item}
            </span>
          )
        )}
      </div>
    </div>
  );
}
