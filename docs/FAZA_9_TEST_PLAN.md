# FAZA 9 — Advanced Semantic Search: Test Plan ✅

## Test Scenarios

### 1. Real-time Progress Events with ETA

#### Test 1.1: Progress Event Emission
**Setup**: Launch app, go to Settings → Semantic Search section
**Action**: Click "Re-index All"
**Expected**:
- Progress bar appears under "Re-index All" button
- Displays: `142/350 (40%)` with ETA countdown: `15 min 30 sec`
- ETA updates as indexing progresses
- Current track name displayed: eg. "Indexing: Bohemian Rhapsody by Queen"

**Verification**:
- [ ] Progress event fires after each track indexed
- [ ] Percentage calculated correctly: `(indexed / total) * 100`
- [ ] ETA: `(remaining * elapsed) / indexed` is accurate (±10%)
- [ ] Progress bar fills smoothly
- [ ] App remains responsive (no UI freeze)

#### Test 1.2: ETA Accuracy
**Setup**: Monitor indexing from 0% to 100%
**Action**: Note start time, calculate actual vs displayed ETA
**Expected**:
- Actual completion time matches ETA ±5 minutes
- ETA improves accuracy as indexing progresses (first 10% estimate may be ±50%)

---

### 2. In-Memory ANNIndex Performance

#### Test 2.1: Index Creation
**Setup**: 500-track library, all-minilm model
**Action**: Start re-index, monitor memory usage (Task Manager or system monitor)
**Expected**:
- Memory increase from baseline: ~750 KB (500 tracks × 1.5 KB)
- Indexing completes in ~25-40 minutes
- No memory leaks (memory stable after completion)

#### Test 2.2: Search Speed
**Setup**: 1000 indexed tracks
**Action**: Perform a semantic search query
  - Query: "uplifting electronic music"
  - Observe latency in browser console/profiler
**Expected**:
- Response time: < 300ms
- Breakdown: ~200ms (embedding query) + <5ms (ANNIndex search)

#### Test 2.3: Large Library (Stress Test)
**Setup**: Import 10000+ tracks if available
**Action**: Run semantic search
**Expected**:
- Response time: <500ms (ANNIndex search ~50ms, still dominated by embedding latency)
- Memory usage: ~15-20 MB (acceptable for a desktop app)
- No crashes or timeout errors

---

### 3. Metadata Caching

#### Test 3.1: Filter Cache Hit
**Setup**: 500 indexed tracks with genres, moods, activities already populated
**Action**: Perform filtered search:
  ```
  Query: "workout"
  Genres: ["Electronic", "Hip-Hop"]
  Moods: ["Energetic"]
  Activities: ["Gym", "Running"]
  ```
**Expected**:
- Only tracks matching ALL filters returned
- Response time: same as unfiltered (metadata filtering is O(1))
  - No additional DB queries visible in logs
  - Filtering adds <1ms to search latency

#### Test 3.2: Empty Filter Results
**Action**: Apply very restrictive filters
  ```
  Query: "jazz"
  Genres: ["Jazz"]
  Moods: ["Sad"]
  Activities: ["Meditation"]
  ```
**Expected**:
- If 0 results: shows "No matches found. Try relaxing filters."
- Fallback suggestion: "Search YouTube instead"

#### Test 3.3: Metadata Consistency
**Setup**: Reindex after adding new track
**Action**: Verify new track appears in searches immediately
**Expected**:
- New track's metadata cached correctly
- Filters apply to new track same as existing tracks

---

### 4. Filtered Semantic Search

#### Test 4.1: Multi-Filter Search
**Setup**: SearchView with filters enabled
**Action**: Apply multiple filter combinations:

| Query | Genres | Moods | Activities | Expected Result |
|-------|--------|-------|-----------|---|
| "chill" | Blues, Folk | Relaxed | Studying | Returns tracks matching all criteria |
| "pump up" | Electronic, Rock | Energetic | Gym | Returns high-energy tracks |
| "work focus" | Ambient, Instrumental | Calm | Work | Returns instrumental focus music |

**Verification**:
- [ ] Results are subset of unfiltered semantic search
- [ ] All returned tracks match every filter criterion
- [ ] Similarity scores still accurate (not affected by filters)

#### Test 4.2: Similarity Threshold Filter
**Setup**: SearchView with similarity slider
**Action**: Drag slider left-right (0.0 → 1.0)
**Expected**:
- 0.2: ~100 results (broad match)
- 0.5: ~20 results (medium match)
- 0.8: ~3-5 results (exact match)
- At 0.95: Usually 0-1 result

#### Test 4.3: No Semantic Index Fallback
**Setup**: App with semantic search disabled or index empty
**Action**: Try semantic search
**Expected**:
- Shows: "Semantic index not ready. [Re-index Now] or [Search YouTube]"
- Clicking "Search YouTube" switches to YouTube mode

---

### 5. Semantic Playlist Generation

#### Test 5.1: Basic Playlist Creation
**Setup**: SearchView with semantic search results displayed
**Action**: Click [+ Add to Playlist] → "Create New Semantic Playlist" on any search result
**Expected**:
- Modal appears: "Generate from this query?"
- Input field pre-filled: Auto-generated name like "🧠 Semantic: uplifting electronic"
- Button: [Create Playlist]
- Confirmation: "Created 'Semantic: uplifting electronic' with 32 tracks"

#### Test 5.2: Playlist Content Quality
**Setup**: Create playlist for query: "music for late night drives"
**Action**: Open created playlist, play a few tracks
**Expected**:
- Tracks have consistent mood/vibe
- No completely unrelated songs mixed in
- Playlist flows naturally (similar artists/moods grouped)
- Tracks count: Usually 20-50 tracks (dependent on library size)

#### Test 5.3: Custom Playlist Names
**Setup**: Semantic search for "relaxing meditation"
**Action**: In the modal, change auto-name to "My Zen Session"
**Expected**:
- Playlist created with custom name
- Tracks still semantically relevant to original query

#### Test 5.4: Playlist Size Variations
**Setup**: Reindex with different library sizes
**Action**: Generate playlists for each (100 tracks, 500 tracks, 1000 tracks)
**Expected**:
- Small library (<100 tracks): Playlist has fewer tracks but still high quality
- Medium library (500-1000 tracks): Playlist has 30-50 tracks
- Large library (5000+ tracks): Playlist has 40-60 tracks
- No playlist exceeds 60 tracks (quality over quantity)

---

### 6. Integration & Cross-Feature

#### Test 6.1: Playlist from Semantic Search
**Setup**: Perform semantic search → create playlist → save to Spotify
**Action**: Search → Playlist creation → [Export to Spotify CSV]
**Expected**:
- Playlist properly exported with all tracks
- CSV is importable later

#### Test 6.2: Search History Effect
**Setup**: Perform multiple semantic searches
**Action**: Check if searches appear in SearchView history
**Expected**:
- Semantic search queries logged same as YouTube searches
- Can repeat previous searches from history

#### Test 6.3: Favorites Integration
**Setup**: Add semantic search results to Favorites
**Action**: Find track in Favorites view
**Expected**:
- Track appears in Favorites
- Metadata (genre, mood) preserved
- Re-indexing doesn't affect Favorite status

---

## Regression Tests

### Performance Regression
- [ ] YouTube search still works fast (<500ms)
- [ ] Manual playlist creation still works
- [ ] Player controls unaffected
- [ ] Settings page loads fast despite ANN in memory

### UI Regression
- [ ] SearchView toggle between YouTube/Semantic is responsive
- [ ] Settings page doesn't slow down with ANN data present
- [ ] Toast notifications appear correctly
- [ ] No console errors during normal flow

### Data Integrity
- [ ] Old tracks not lost during re-index
- [ ] Playlists stable across re-indexes
- [ ] No duplicate tracks in generated playlists
- [ ] Metadata accurate after filter operations

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|---|
| Empty query in semantic search | "Please enter a search query" |
| All filters set to empty | Behaves like unfiltered search |
| Re-index with 0 tracks | Index created as empty, search returns "No index data" |
| Loss of Ollama connection mid-index | Graceful error: "Ollama offline. Try later." |
| Modify track metadata during indexing | Re-index continues, new metadata picked up on next run |
| Very long query (>500 chars) | Truncated to first 500 chars, warning shown |
| Cancel indexing mid-way | ANN partial index retained; can resume or re-index fresh |

---

## Manual Verification Checklist

### Before Deployment
- [ ] All 5 features implemented and tested
- [ ] `cargo check` returns 0 errors
- [ ] `npx tsc --noEmit` returns 0 errors
- [ ] App builds and runs without crashes
- [ ] Index progress events fire smoothly
- [ ] Semantic search returns relevant results
- [ ] Filtered search applies all filters correctly
- [ ] Playlist generation creates playable content
- [ ] No memory leaks after 30-min indexing session
- [ ] No database locks or concurrency issues

### User Testing
- [ ] Ask user to search for descriptive queries
- [ ] Ask user to use filters on semantic results
- [ ] Ask user to generate a semantic playlist & add songs
- [ ] Monitor for any UI freezes or unexpected errors
- [ ] Check memory usage over extended session

**Test Duration**: ~1-2 hours per test scenario  
**Estimated Total**: ~16-20 hours for comprehensive testing

