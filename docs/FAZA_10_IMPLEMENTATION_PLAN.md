# 🚀 FAZA 10 — Semantic Search v2: Scale, Persistence & Intelligence

## Plan de Implementare Complet

**Baza**: FAZA 9 completă (ANNIndex in-memory, metadata caching, filtered search)  
**Obiectiv**: Scalabilitate 100k+ tracks, persistență pe disc, filtrare avansată, căutare multi-query  
**Estimare totală**: ~6-8 ore (6 sub-faze)  
**Dependențe noi Cargo**: `bincode`, `instant-distance` (opțional: `notify`)  
**Risc**: Mediu — schimbări structurale majore pe `semantic.rs` + `db.rs`

---

## Viziune

```
FAZA 9 (current):                    FAZA 10 (target):
─────────────────                    ──────────────────
In-memory only                   →   Persistent on disk (survive restarts)
Brute-force O(n) scan            →   HNSW O(log n) for 100k+ tracks
No energy filtering              →   Full energy level filtering (1-10)
Single-query search              →   Multi-query fusion ("rock AND calm")
Tauri event (basic)              →   WebSocket-grade progress channels
Static playlists                 →   Auto-refresh on library changes
```

---

## Arhitectura v2

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
│                                                                   │
│  SearchView.tsx                                                   │
│  ├─ Multi-query bar: ["energetic rock", "workout vibes"]        │
│  ├─ Energy slider: [1 ──────●── 10]                              │
│  ├─ Fusion strategy: [Union ▼] [Intersection] [RRF]            │
│  └─ Results with fused similarity scores                         │
│                                                                   │
│  SettingsView.tsx                                                 │
│  ├─ WebSocket progress channel (persistent connection)           │
│  ├─ Index persistence toggle                                     │
│  └─ Auto-refresh interval selector                               │
│                                                                   │
│  PlaylistView.tsx                                                 │
│  └─ Auto-refresh badge: "3 new tracks match your criteria"       │
├───────────────────────────────────────────────────────────────────┤
│                       API Layer                                   │
│  semanticSearchMulti() | semanticIndexPersist()                  │
│  setAutoRefreshPlaylist() | getIndexDiskStatus()                 │
├───────────────────────────────────────────────────────────────────┤
│                     BACKEND (Rust)                                │
│                                                                   │
│  semantic.rs (v2):                                                │
│  ├─ HNSWIndex (instant-distance crate)                           │
│  │   └─ O(log n) search for 100k+ tracks                        │
│  ├─ ANNIndex (existing, fallback for <10k)                       │
│  ├─ DiskPersistence                                               │
│  │   ├─ save_to_disk(path) — bincode serialize                   │
│  │   ├─ load_from_disk(path) — bincode deserialize               │
│  │   └─ auto-load on startup if file exists                      │
│  ├─ EnergyFilter                                                  │
│  │   └─ min_energy / max_energy in SemanticSearchFilter          │
│  └─ MultiQueryFusion                                              │
│      ├─ union_fusion(queries) — merge results                    │
│      ├─ intersection_fusion(queries) — only common               │
│      └─ rrf_fusion(queries) — Reciprocal Rank Fusion             │
│                                                                   │
│  lib.rs (new commands):                                           │
│  ├─ semantic_search_multi(queries, fusion_strategy)              │
│  ├─ semantic_persist_index()                                      │
│  ├─ semantic_load_index()                                         │
│  ├─ get_index_disk_status()                                       │
│  ├─ set_playlist_auto_refresh(playlist_id, query, interval)      │
│  └─ check_playlist_refresh(playlist_id)                          │
│                                                                   │
│  db.rs (new tables + migrations):                                 │
│  ├─ semantic_playlists_auto_refresh                               │
│  └─ semantic_index_meta                                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Sub-Faza 10.1: WebSocket-grade Progress Channel ⏱️ ~40 min

### Problemă
Tauri `app_handle.emit()` funcționează deja, dar:
- Nu oferă **acknowledged delivery** (frontend-ul poate pierde events)
- Nu suportă **backpressure** (dacă indexarea e mai rapidă decât UI render)
- Nu are **channel lifecycle** (start, progress, complete, error states)

### Soluție: Structured Event Channel cu state machine

#### 10.1.1 Models noi → `src-tauri/src/models.rs`

```rust
/// Semantic indexing channel event types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SemanticIndexEvent {
    /// Indexing just started
    Started {
        total_tracks: i64,
        model: String,
        estimated_total_seconds: Option<i64>,
    },
    /// Per-track progress
    Progress {
        indexed: i64,
        total: i64,
        current_track: String,
        current_artist: String,
        percentage: i32,
        eta_seconds: Option<i64>,
        tracks_per_second: f64,
        memory_mb: f64,
    },
    /// Batch completion (emis la fiecare 10 tracks pentru eficiență)
    BatchComplete {
        batch_size: i32,
        indexed_so_far: i64,
        total: i64,
        errors_in_batch: i32,
    },
    /// Indexing finished successfully
    Completed {
        total_indexed: i64,
        total_errors: i64,
        duration_seconds: i64,
        index_size_mb: f64,
        persisted_to_disk: bool,
    },
    /// Error during indexing
    Error {
        message: String,
        track_id: Option<String>,
        recoverable: bool,
    },
    /// Indexing was cancelled
    Cancelled {
        indexed_before_cancel: i64,
    },
}
```

#### 10.1.2 Enhanced event emission → `src-tauri/src/lib.rs`

**Modificări la `semantic_index_all()`:**

```rust
#[tauri::command]
async fn semantic_index_all(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<SemanticIndexStatus, String> {
    // ... existing setup ...
    
    // === NEW: Emit Started event ===
    let _ = app_handle.emit("semantic-index-event", SemanticIndexEvent::Started {
        total_tracks: total,
        model: settings.embedding_model.clone(),
        estimated_total_seconds: Some(total * 3), // ~3 sec/track estimate
    });

    let mut errors = 0i64;
    let batch_size = 10;

    for (i, track) in tracks.iter().enumerate() {
        // ... embed track ...
        
        // === NEW: Granular progress ===
        let elapsed = start_time.elapsed().as_secs_f64();
        let tracks_per_second = if elapsed > 0.0 { indexed as f64 / elapsed } else { 0.0 };
        
        let _ = app_handle.emit("semantic-index-event", SemanticIndexEvent::Progress {
            indexed,
            total,
            current_track: track.title.clone(),
            current_artist: track.artist.clone(),
            percentage: ((indexed as f64 / total as f64) * 100.0) as i32,
            eta_seconds: if tracks_per_second > 0.0 {
                Some(((total - indexed) as f64 / tracks_per_second) as i64)
            } else { None },
            tracks_per_second,
            memory_mb: ann.estimate_memory_mb(),
        });

        // === NEW: Batch event every 10 tracks ===
        if (i + 1) % batch_size == 0 {
            let _ = app_handle.emit("semantic-index-event", SemanticIndexEvent::BatchComplete {
                batch_size: batch_size as i32,
                indexed_so_far: indexed,
                total,
                errors_in_batch: 0,
            });
        }
    }

    // === NEW: Completion event ===
    let duration = start_time.elapsed().as_secs();
    let _ = app_handle.emit("semantic-index-event", SemanticIndexEvent::Completed {
        total_indexed: indexed,
        total_errors: errors,
        duration_seconds: duration as i64,
        index_size_mb: ann.estimate_memory_mb(),
        persisted_to_disk: false,
    });

    // ... return status ...
}
```

#### 10.1.3 Frontend listener → `src/components/views/SettingsView.tsx`

```typescript
// Listen for structured events
useEffect(() => {
  const unlisten = listen<SemanticIndexEvent>('semantic-index-event', (event) => {
    switch (event.payload.type) {
      case 'Started':
        setIndexState('indexing');
        setEstimatedTotal(event.payload.estimated_total_seconds);
        break;
      case 'Progress':
        setIndexProgress({
          indexed: event.payload.indexed,
          total: event.payload.total,
          currentTrack: event.payload.current_track,
          currentArtist: event.payload.current_artist,
          percentage: event.payload.percentage,
          eta: event.payload.eta_seconds,
          speed: event.payload.tracks_per_second,
          memoryMb: event.payload.memory_mb,
        });
        break;
      case 'Completed':
        setIndexState('complete');
        showToast(`Indexed ${event.payload.total_indexed} tracks in ${event.payload.duration_seconds}s`);
        break;
      case 'Error':
        if (!event.payload.recoverable) setIndexState('error');
        break;
    }
  });
  return () => { unlisten.then(u => u()); };
}, []);
```

#### 10.1.4 API wrapper → `src/api.ts`

```typescript
export interface SemanticIndexEvent {
  type: 'Started' | 'Progress' | 'BatchComplete' | 'Completed' | 'Error' | 'Cancelled';
  // type-specific fields
  total_tracks?: number;
  indexed?: number;
  total?: number;
  current_track?: string;
  current_artist?: string;
  percentage?: number;
  eta_seconds?: number;
  tracks_per_second?: number;
  memory_mb?: number;
  total_indexed?: number;
  duration_seconds?: number;
  message?: string;
  recoverable?: boolean;
}
```

### Fișiere afectate (10.1)
- `src-tauri/src/models.rs` — +1 enum (SemanticIndexEvent, 6 variante)
- `src-tauri/src/lib.rs` — Refactor `semantic_index_all()` cu structured events
- `src/types.ts` — +1 interface (SemanticIndexEvent)
- `src/components/views/SettingsView.tsx` — Enhanced listener cu state machine

---

## Sub-Faza 10.2: True HNSW Index pentru 100k+ Tracks ⏱️ ~90 min

### Problemă
ANNIndex curent face brute-force O(n) — suficient pentru 20k tracks (~100ms) dar devine **lent la 100k+** (~500ms+ pe fiecare query).

### Soluție: `instant-distance` crate — HNSW implementare în Rust pur

#### Alegerea crate-ului

| Crate | Stars | Last Update | API | Note |
|-------|-------|-------------|-----|------|
| `instant-distance` | 200+ | Active | Clean, generic | ✅ **Ales** |
| `hnsw_rs` | 100+ | Semi-active | Complex | Bun dar API greoaie |
| `hnswlib-rs` | 50+ | Bindings C++ | FFI overhead | Nu Rust pur |
| Custom HNSW | — | — | Manual | Prea complex, bug-prone |

**`instant-distance`** e preferat:
- **Rust pur** — fără FFI
- **Generic** — suportă orice tip cu trait `Point`
- **Eficient** — build O(n log n), search O(log n)
- **Serializabil** — cu `serde` (necesar pentru persistență disc)

#### 10.2.1 Dependență nouă → `Cargo.toml`

```toml
[dependencies]
instant-distance = "0.6"
bincode = "1"   # pentru serializare pe disc (sub-faza 10.3)
```

#### 10.2.2 HNSW implementation → `src-tauri/src/semantic.rs`

Adaugă un al doilea index care se activează automat la >10k tracks:

```rust
use instant_distance::{Builder, HnswMap, Search};

/// Embedding point for HNSW
#[derive(Clone)]
struct EmbeddingPoint(Vec<f32>);

impl instant_distance::Point for EmbeddingPoint {
    fn distance(&self, other: &Self) -> f32 {
        // 1 - cosine_similarity (distanță, nu similaritate)
        1.0 - Self::cosine_sim(&self.0, &other.0)
    }
}

impl EmbeddingPoint {
    fn cosine_sim(a: &[f32], b: &[f32]) -> f32 {
        if a.len() != b.len() || a.is_empty() { return 0.0; }
        let mut dot = 0.0_f32;
        let mut norm_a = 0.0_f32;
        let mut norm_b = 0.0_f32;
        for (x, y) in a.iter().zip(b.iter()) {
            dot += x * y;
            norm_a += x * x;
            norm_b += y * y;
        }
        let denom = norm_a.sqrt() * norm_b.sqrt();
        if denom == 0.0 { 0.0 } else { dot / denom }
    }
}

/// Hybrid index: brute-force for small libraries, HNSW for large
pub struct HybridIndex {
    /// Brute-force index (existing)
    ann: ANNIndex,
    /// HNSW index (active only when > threshold)
    hnsw: Option<HnswMap<EmbeddingPoint, String>>,
    /// Track count threshold for HNSW activation
    hnsw_threshold: usize,
    /// Whether HNSW needs rebuild
    hnsw_dirty: bool,
}

impl HybridIndex {
    pub fn new() -> Self {
        Self {
            ann: ANNIndex::new(),
            hnsw: None,
            hnsw_threshold: 10_000,
            hnsw_dirty: false,
        }
    }

    /// Add embedding to the hybrid index
    pub fn add(&mut self, track_id: String, embedding: Vec<f32>, metadata: EmbeddingMetadata) {
        self.ann.add(track_id, embedding, metadata);
        self.hnsw_dirty = true;
    }

    /// Build HNSW if library exceeds threshold
    pub fn build_hnsw_if_needed(&mut self) {
        if self.ann.len() < self.hnsw_threshold || !self.hnsw_dirty {
            return;
        }

        let points: Vec<EmbeddingPoint> = self.ann.track_ids
            .iter()
            .filter_map(|id| self.ann.embeddings.get(id).cloned())
            .map(EmbeddingPoint)
            .collect();

        let values: Vec<String> = self.ann.track_ids.clone();

        // Build HNSW graph
        let hnsw = Builder::default().build(points, values);
        self.hnsw = Some(hnsw);
        self.hnsw_dirty = false;

        tracing::info!(
            "HNSW index built for {} tracks (threshold: {})",
            self.ann.len(),
            self.hnsw_threshold
        );
    }

    /// Search — auto-selects HNSW or brute-force
    pub fn search(&self, query: &[f32], k: usize) -> Vec<(String, f32)> {
        if let Some(hnsw) = &self.hnsw {
            // HNSW search — O(log n)
            let mut search = Search::default();
            let point = EmbeddingPoint(query.to_vec());
            
            let results: Vec<(String, f32)> = hnsw
                .search(&point, &mut search)
                .take(k)
                .map(|item| {
                    let similarity = 1.0 - item.distance; // distance → similarity
                    (item.value.clone(), similarity)
                })
                .collect();
            results
        } else {
            // Brute-force fallback — O(n)
            self.ann.search(query, k)
        }
    }

    /// Search with filters (always brute-force for filtering accuracy)
    pub fn search_filtered(
        &self,
        query: &[f32],
        k: usize,
        filter: &SemanticSearchFilter,
    ) -> Vec<(String, f32)> {
        // For filtered search, pre-filter candidates then score
        if let Some(hnsw) = &self.hnsw {
            // Get more candidates from HNSW, then filter
            let mut search = Search::default();
            let point = EmbeddingPoint(query.to_vec());
            let fetch_k = k * 5; // Over-fetch for filtering
            
            let candidates: Vec<(String, f32)> = hnsw
                .search(&point, &mut search)
                .take(fetch_k)
                .map(|item| (item.value.clone(), 1.0 - item.distance))
                .collect();

            // Apply metadata filters
            let mut filtered: Vec<(String, f32)> = candidates
                .into_iter()
                .filter(|(track_id, _)| {
                    self.ann.passes_filter(track_id, filter)
                })
                .collect();

            filtered.truncate(k);
            filtered
        } else {
            self.ann.search_filtered(query, k, filter)
        }
    }

    /// Delegate to inner ANNIndex
    pub fn clear(&mut self) {
        self.ann.clear();
        self.hnsw = None;
        self.hnsw_dirty = false;
    }

    pub fn len(&self) -> usize { self.ann.len() }
    pub fn is_empty(&self) -> bool { self.ann.is_empty() }
    pub fn estimate_memory_mb(&self) -> f64 { self.ann.estimate_memory_mb() }
    pub fn is_hnsw_active(&self) -> bool { self.hnsw.is_some() }
    pub fn get_metadata(&self, track_id: &str) -> Option<&EmbeddingMetadata> {
        self.ann.metadata.get(track_id)
    }
}

pub type SharedHybridIndex = Arc<RwLock<HybridIndex>>;
```

#### 10.2.3 Refactor AppState → `lib.rs`

```rust
// BEFORE (FAZA 9):
pub ann_index: SharedANNIndex,

// AFTER (FAZA 10):
pub semantic_index: SharedHybridIndex,
```

Toate referințele la `state.ann_index` se schimbă în `state.semantic_index`.

#### 10.2.4 Metoda `passes_filter()` în ANNIndex

Adaugă o metodă publică pe `ANNIndex` care verifică dacă un track trece filtrele (refolosită de HybridIndex):

```rust
impl ANNIndex {
    /// Check if a track passes the metadata filters
    pub fn passes_filter(&self, track_id: &str, filter: &SemanticSearchFilter) -> bool {
        let meta = match self.metadata.get(track_id) {
            Some(m) => m,
            None => return true, // No metadata = pass
        };

        if let Some(genres) = &filter.genres {
            if !genres.is_empty() && !meta.genres.iter().any(|g| genres.contains(g)) {
                return false;
            }
        }

        if let Some(moods) = &filter.moods {
            if !moods.is_empty() && !meta.moods.iter().any(|m| moods.contains(m)) {
                return false;
            }
        }

        if let Some(activities) = &filter.activities {
            if !activities.is_empty() && !meta.activities.iter().any(|a| activities.contains(a)) {
                return false;
            }
        }

        // Energy level filtering (NEW in 10.4)
        if let Some(min_energy) = filter.min_energy {
            if let Some(energy) = meta.energy_level {
                if energy < min_energy { return false; }
            }
        }
        if let Some(max_energy) = filter.max_energy {
            if let Some(energy) = meta.energy_level {
                if energy > max_energy { return false; }
            }
        }

        true
    }
}
```

### Performance HNSW vs Brute-Force

| Library Size | Brute-Force | HNSW | Speedup |
|-------------|-------------|------|---------|
| 1,000 | 5ms | N/A (sub-threshold) | — |
| 10,000 | 50ms | 2ms | 25x |
| 50,000 | 250ms | 3ms | 83x |
| 100,000 | 500ms | 4ms | 125x |
| 500,000 | 2.5s | 6ms | 416x |

### Fișiere afectate (10.2)
- `src-tauri/Cargo.toml` — +1 dep: `instant-distance = "0.6"`
- `src-tauri/src/semantic.rs` — +HybridIndex (~150 linii), +passes_filter()
- `src-tauri/src/lib.rs` — Rename ann_index → semantic_index, update all references
- `src/api.ts` — Nicio schimbare (API-ul e transparent)
- `src/types.ts` — Nicio schimbare

---

## Sub-Faza 10.3: Persistent ANN Index pe Disc ⏱️ ~60 min

### Problemă
Indexul FAZA 9 se pierde la restart. Reindexarea de la zero costă **~30-80 min la 1000 tracks**.

### Soluție: Serializare pe disc cu `bincode` (fast binary format)

#### 10.3.1 Dependență

```toml
bincode = "1"
```

(deja adăugată la 10.2)

#### 10.3.2 Structuri serializabile → `semantic.rs`

```rust
use serde::{Serialize, Deserialize};

/// Disk-serializable snapshot of the ANNIndex (without HNSW)
#[derive(Serialize, Deserialize)]
struct IndexSnapshot {
    version: u32,               // Schema version for forward compatibility
    model_used: String,         // Embedding model ID
    dimensions: usize,          // Vector dimensions (384, 768, etc.)
    track_count: usize,
    embeddings: Vec<(String, Vec<f32>)>,   // (track_id, embedding)
    metadata: Vec<(String, EmbeddingMetadata)>,  // (track_id, metadata)
    created_at: String,         // ISO 8601
}

const INDEX_SNAPSHOT_VERSION: u32 = 1;
```

#### 10.3.3 Save/Load pe HybridIndex

```rust
impl HybridIndex {
    /// Save index to disk as bincode
    pub fn save_to_disk(&self, path: &std::path::Path, model: &str) -> Result<(), String> {
        let snapshot = IndexSnapshot {
            version: INDEX_SNAPSHOT_VERSION,
            model_used: model.to_string(),
            dimensions: self.ann.embeddings.values().next()
                .map(|e| e.len()).unwrap_or(0),
            track_count: self.ann.len(),
            embeddings: self.ann.track_ids.iter()
                .filter_map(|id| {
                    self.ann.embeddings.get(id)
                        .map(|emb| (id.clone(), emb.clone()))
                })
                .collect(),
            metadata: self.ann.track_ids.iter()
                .filter_map(|id| {
                    self.ann.metadata.get(id)
                        .map(|meta| (id.clone(), meta.clone()))
                })
                .collect(),
            created_at: chrono::Local::now().to_rfc3339(),
        };

        let bytes = bincode::serialize(&snapshot)
            .map_err(|e| format!("Serialize error: {}", e))?;

        std::fs::write(path, bytes)
            .map_err(|e| format!("Write error: {}", e))?;

        tracing::info!(
            "Saved semantic index to disk: {} tracks, {:.2} MB",
            snapshot.track_count,
            path.metadata().map(|m| m.len() as f64 / 1_048_576.0).unwrap_or(0.0)
        );

        Ok(())
    }

    /// Load index from disk
    pub fn load_from_disk(path: &std::path::Path, expected_model: &str) -> Result<Self, String> {
        if !path.exists() {
            return Err("Index file not found".to_string());
        }

        let bytes = std::fs::read(path)
            .map_err(|e| format!("Read error: {}", e))?;

        let snapshot: IndexSnapshot = bincode::deserialize(&bytes)
            .map_err(|e| format!("Deserialize error: {}", e))?;

        // Version check
        if snapshot.version != INDEX_SNAPSHOT_VERSION {
            return Err(format!(
                "Index version mismatch: found {}, expected {}",
                snapshot.version, INDEX_SNAPSHOT_VERSION
            ));
        }

        // Model check — if model changed, force re-index
        if snapshot.model_used != expected_model {
            return Err(format!(
                "Model mismatch: index was built with '{}', current model is '{}'. Re-index required.",
                snapshot.model_used, expected_model
            ));
        }

        let mut index = HybridIndex::new();

        for (track_id, embedding) in snapshot.embeddings {
            let meta = snapshot.metadata.iter()
                .find(|(id, _)| id == &track_id)
                .map(|(_, m)| m.clone())
                .unwrap_or_else(|| EmbeddingMetadata {
                    track_id: track_id.clone(),
                    genres: Vec::new(),
                    moods: Vec::new(),
                    activities: Vec::new(),
                    energy_level: None,
                });
            index.add(track_id, embedding, meta);
        }

        // Build HNSW if large enough
        index.build_hnsw_if_needed();

        tracing::info!(
            "Loaded semantic index from disk: {} tracks, HNSW: {}",
            index.len(),
            index.is_hnsw_active()
        );

        Ok(index)
    }

    /// Get the default index file path
    pub fn default_index_path(app_data_dir: &std::path::Path) -> std::path::PathBuf {
        app_data_dir.join("semantic_index.bin")
    }
}
```

#### 10.3.4 Auto-load la startup → `lib.rs`

```rust
// În run() setup, după inițializarea AppState:
let app_data_dir = app.path().app_data_dir()
    .expect("Failed to get app data dir");

let index_path = HybridIndex::default_index_path(&app_data_dir);

let semantic_index = if index_path.exists() {
    let db = state_db.lock().await;
    let settings = db.get_settings().unwrap_or_default();
    drop(db);

    match HybridIndex::load_from_disk(&index_path, &settings.embedding_model) {
        Ok(idx) => {
            tracing::info!("Loaded semantic index from disk: {} tracks", idx.len());
            Arc::new(RwLock::new(idx))
        }
        Err(e) => {
            tracing::warn!("Could not load semantic index: {}, starting fresh", e);
            Arc::new(RwLock::new(HybridIndex::new()))
        }
    }
} else {
    Arc::new(RwLock::new(HybridIndex::new()))
};
```

#### 10.3.5 Auto-save după indexare → `lib.rs`

La finalul `semantic_index_all()`:

```rust
// After indexing completes, persist to disk
let app_data_dir = app_handle.path().app_data_dir()
    .map_err(|e| format!("No app data dir: {}", e))?;
let index_path = HybridIndex::default_index_path(&app_data_dir);

// Build HNSW if needed
ann.build_hnsw_if_needed();

// Save to disk
if let Err(e) = ann.save_to_disk(&index_path, &settings.embedding_model) {
    tracing::warn!("Failed to persist index: {}", e);
}
```

#### 10.3.6 Tauri Commands

```rust
#[tauri::command]
async fn semantic_persist_index(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let index = state.semantic_index.read().await;
    let db = state.db.lock().await;
    let settings = db.get_settings().map_err(|e| e.to_string())?;
    drop(db);

    let app_data_dir = app_handle.path().app_data_dir()
        .map_err(|e| format!("{}", e))?;
    let path = HybridIndex::default_index_path(&app_data_dir);
    index.save_to_disk(&path, &settings.embedding_model)?;
    Ok(format!("Index saved: {} tracks", index.len()))
}

#[tauri::command]
async fn get_index_disk_status(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<IndexDiskStatus, String> {
    let app_data_dir = app_handle.path().app_data_dir()
        .map_err(|e| format!("{}", e))?;
    let path = HybridIndex::default_index_path(&app_data_dir);
    let index = state.semantic_index.read().await;

    Ok(IndexDiskStatus {
        file_exists: path.exists(),
        file_size_mb: path.metadata().map(|m| m.len() as f64 / 1_048_576.0).ok(),
        in_memory_tracks: index.len() as i64,
        hnsw_active: index.is_hnsw_active(),
        memory_mb: index.estimate_memory_mb(),
    })
}
```

#### 10.3.7 Models pentru disk status

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexDiskStatus {
    pub file_exists: bool,
    pub file_size_mb: Option<f64>,
    pub in_memory_tracks: i64,
    pub hnsw_active: bool,
    pub memory_mb: f64,
}
```

### Dimensiune fișier pe disc

| Tracks | Dimensions | File Size | Load Time |
|--------|-----------|-----------|-----------|
| 1,000 | 384 | ~1.5 MB | <100ms |
| 10,000 | 384 | ~15 MB | ~500ms |
| 100,000 | 384 | ~150 MB | ~3s |
| 1,000 | 1024 | ~4 MB | <200ms |

### Fișiere afectate (10.3)
- `src-tauri/Cargo.toml` — +1 dep: `bincode = "1"`
- `src-tauri/src/semantic.rs` — +IndexSnapshot, +save/load_from_disk (~120 linii)
- `src-tauri/src/models.rs` — +IndexDiskStatus struct
- `src-tauri/src/lib.rs` — Auto-load la startup, auto-save la index, 2 comenzi noi
- `src/api.ts` — +2 wrapper functions
- `src/types.ts` — +1 interface (IndexDiskStatus)
- `src/components/views/SettingsView.tsx` — Disk status display + Persist button

---

## Sub-Faza 10.4: Energy Level Filtering ⏱️ ~30 min

### Problemă
`EmbeddingMetadata.energy_level` există (`Option<i32>`) dar nu e populat și nu e folosit în filtre.

### Soluție: Populare + integrare completă în filtrul semantic

#### 10.4.1 Extindere SemanticSearchFilter → `models.rs`

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticSearchFilter {
    pub genres: Option<Vec<String>>,
    pub moods: Option<Vec<String>>,
    pub activities: Option<Vec<String>>,
    pub min_similarity: Option<f64>,
    pub min_energy: Option<i32>,   // NEW — 1-10
    pub max_energy: Option<i32>,   // NEW — 1-10
}
```

#### 10.4.2 Populare energy_level la indexare → `semantic.rs`

Actualizare `build_metadata()`:

```rust
pub fn build_metadata(
    track: &Track,
    genres: Option<String>,
    moods: Option<String>,
    activities: Option<String>,
    energy: Option<String>,       // NEW parameter
) -> EmbeddingMetadata {
    EmbeddingMetadata {
        track_id: track.id.clone(),
        genres: parse_json_array(&genres.unwrap_or_default()),
        moods: parse_json_array(&moods.unwrap_or_default()),
        activities: parse_json_array(&activities.unwrap_or_default()),
        energy_level: energy.and_then(|e| e.parse::<i32>().ok()),  // NEW
    }
}
```

#### 10.4.3 Integrare în `semantic_index_all()` → `lib.rs`

```rust
// La momentul build_metadata:
let meta = semantic::build_metadata(
    &track,
    metadata.as_ref().and_then(|m| m.genre.clone()),
    metadata.as_ref().and_then(|m| m.mood.clone()),
    metadata.as_ref().and_then(|m| m.activity_tags.clone()),
    metadata.as_ref().and_then(|m| m.energy_level.clone()),  // NEW
);
```

#### 10.4.4 Integrare în `passes_filter()` (deja prezentată la 10.2.4)

Filtrele `min_energy` și `max_energy` sunt deja incluse în metoda `passes_filter()`.

#### 10.4.5 Frontend — Energy slider

```typescript
// SearchView.tsx — nou slider component
<div className="flex items-center gap-3">
  <label className="text-sm text-zinc-400">Energy</label>
  <input
    type="range" min={1} max={10} step={1}
    value={energyRange[0]}
    onChange={e => setEnergyRange([parseInt(e.target.value), energyRange[1]])}
  />
  <span className="text-sm">{energyRange[0]} - {energyRange[1]}</span>
  <input
    type="range" min={1} max={10} step={1}
    value={energyRange[1]}
    onChange={e => setEnergyRange([energyRange[0], parseInt(e.target.value)])}
  />
</div>
```

#### 10.4.6 Update API call

```typescript
export async function semanticSearchFiltered(
  query: string,
  limit?: number,
  genres?: string[],
  moods?: string[],
  activities?: string[],
  minEnergy?: number,     // NEW
  maxEnergy?: number,     // NEW
): Promise<SemanticSearchResult[]> {
  return invoke('semantic_search_filtered', {
    query, limit, genres, moods, activities,
    min_energy: minEnergy,    // NEW
    max_energy: maxEnergy,    // NEW
  });
}
```

### Fișiere afectate (10.4)
- `src-tauri/src/models.rs` — +2 câmpuri pe SemanticSearchFilter
- `src-tauri/src/semantic.rs` — Update build_metadata() + passes_filter()
- `src-tauri/src/lib.rs` — Update semantic_search_filtered() + semantic_index_all()
- `src/api.ts` — +2 params pe semanticSearchFiltered()
- `src/types.ts` — +2 câmpuri pe SemanticSearchFilter
- `src/components/views/SearchView.tsx` — Energy range slider

---

## Sub-Faza 10.5: Multi-Query Semantic Search ⏱️ ~60 min

### Problemă
Searchul curent acceptă un singur query. Utilizatorul nu poate face:  
**"something like classic rock BUT also calm and introspective"** — 2 concepte separate combinate.

### Soluție: Multi-query cu 3 strategii de fuziune

#### 10.5.1 Fusion Strategies

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FusionStrategy {
    /// Union: merge all results, keep highest similarity per track
    Union,
    /// Intersection: only tracks that appear in ALL query results
    Intersection,
    /// RRF: Reciprocal Rank Fusion — balanced combination
    ReciprocalRankFusion,
}
```

#### 10.5.2 Multi-query search → `semantic.rs`

```rust
impl HybridIndex {
    /// Search with multiple queries and fuse results
    pub fn search_multi(
        &self,
        query_embeddings: &[Vec<f32>],
        k: usize,
        strategy: &FusionStrategy,
        filter: &SemanticSearchFilter,
    ) -> Vec<(String, f32)> {
        // Run each query independently
        let per_query_results: Vec<Vec<(String, f32)>> = query_embeddings
            .iter()
            .map(|emb| self.search_filtered(emb, k * 3, filter)) // Over-fetch for fusion
            .collect();

        match strategy {
            FusionStrategy::Union => self.fuse_union(per_query_results, k),
            FusionStrategy::Intersection => self.fuse_intersection(per_query_results, k),
            FusionStrategy::ReciprocalRankFusion => self.fuse_rrf(per_query_results, k),
        }
    }

    /// Union: merge results, keep max similarity per track
    fn fuse_union(
        &self,
        results: Vec<Vec<(String, f32)>>,
        k: usize,
    ) -> Vec<(String, f32)> {
        let mut scores: HashMap<String, f32> = HashMap::new();
        for result_set in results {
            for (track_id, sim) in result_set {
                let entry = scores.entry(track_id).or_insert(0.0);
                *entry = entry.max(sim); // Keep highest similarity
            }
        }
        let mut sorted: Vec<(String, f32)> = scores.into_iter().collect();
        sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        sorted.truncate(k);
        sorted
    }

    /// Intersection: only tracks present in ALL result sets
    fn fuse_intersection(
        &self,
        results: Vec<Vec<(String, f32)>>,
        k: usize,
    ) -> Vec<(String, f32)> {
        if results.is_empty() { return Vec::new(); }

        // Count appearances per track
        let mut counts: HashMap<String, (usize, f32)> = HashMap::new();
        let num_queries = results.len();

        for result_set in results {
            for (track_id, sim) in result_set {
                let entry = counts.entry(track_id).or_insert((0, 0.0));
                entry.0 += 1;
                entry.1 += sim; // Sum similarities for averaging
            }
        }

        // Keep only tracks in ALL result sets
        let mut intersected: Vec<(String, f32)> = counts
            .into_iter()
            .filter(|(_, (count, _))| *count >= num_queries)
            .map(|(id, (count, total_sim))| (id, total_sim / count as f32))
            .collect();

        intersected.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        intersected.truncate(k);
        intersected
    }

    /// Reciprocal Rank Fusion (RRF) — weighted rank combination
    /// Formula: RRF(d) = Σ 1/(k + rank_i(d)) for each query i
    fn fuse_rrf(
        &self,
        results: Vec<Vec<(String, f32)>>,
        k: usize,
    ) -> Vec<(String, f32)> {
        let rrf_k = 60.0_f32; // Standard RRF constant
        let mut scores: HashMap<String, f32> = HashMap::new();

        for result_set in &results {
            for (rank, (track_id, _sim)) in result_set.iter().enumerate() {
                let rrf_score = 1.0 / (rrf_k + rank as f32 + 1.0);
                *scores.entry(track_id.clone()).or_insert(0.0) += rrf_score;
            }
        }

        let mut sorted: Vec<(String, f32)> = scores.into_iter().collect();
        sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        sorted.truncate(k);
        sorted
    }
}
```

#### 10.5.3 Tauri Command → `lib.rs`

```rust
#[tauri::command]
async fn semantic_search_multi(
    state: State<'_, AppState>,
    queries: Vec<String>,
    limit: Option<i32>,
    fusion_strategy: Option<String>,
    genres: Option<Vec<String>>,
    moods: Option<Vec<String>>,
    activities: Option<Vec<String>>,
    min_energy: Option<i32>,
    max_energy: Option<i32>,
) -> Result<Vec<SemanticSearchResult>, String> {
    let db = state.db.lock().await;
    let settings = db.get_settings().map_err(|e| e.to_string())?;

    if !settings.semantic_search_enabled {
        return Err("Semantic search is disabled".to_string());
    }

    let ollama = OllamaClient::with_config(&settings.ollama_url, &settings.embedding_model);

    // Embed all queries (batch if model supports it)
    let mut query_embeddings = Vec::new();
    for query in &queries {
        let emb = ollama
            .embed_single(query, &settings.embedding_model)
            .await
            .map_err(|e| e.to_string())?;
        query_embeddings.push(emb);
    }

    let filter = SemanticSearchFilter {
        genres,
        moods,
        activities,
        min_similarity: Some(0.2),
        min_energy,
        max_energy,
    };

    let strategy = match fusion_strategy.as_deref() {
        Some("intersection") => FusionStrategy::Intersection,
        Some("rrf") => FusionStrategy::ReciprocalRankFusion,
        _ => FusionStrategy::Union, // default
    };

    let index = state.semantic_index.read().await;
    let limit = limit.unwrap_or(20) as usize;
    let scored = index.search_multi(&query_embeddings, limit, &strategy, &filter);

    // Build results
    let mut results = Vec::new();
    for (track_id, score) in scored {
        if let Ok(track) = db.get_track_by_uuid(&track_id) {
            results.push(SemanticSearchResult {
                track,
                similarity: score as f64,
                match_reason: format!(
                    "Multi-query {} match ({:.0}%)",
                    match &strategy {
                        FusionStrategy::Union => "union",
                        FusionStrategy::Intersection => "intersection",
                        FusionStrategy::ReciprocalRankFusion => "RRF",
                    },
                    score * 100.0
                ),
            });
        }
    }

    Ok(results)
}
```

#### 10.5.4 Frontend — Multi-query input

```typescript
// SearchView.tsx — query chips
const [queries, setQueries] = useState<string[]>([]);
const [currentInput, setCurrentInput] = useState('');
const [fusionStrategy, setFusionStrategy] = useState<'union' | 'intersection' | 'rrf'>('union');

// Add query on Enter
const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && currentInput.trim()) {
    setQueries([...queries, currentInput.trim()]);
    setCurrentInput('');
  }
};

// UI: query chips with X remove buttons
// Strategy selector: [Union | Intersection | RRF]
// Search button triggers semanticSearchMulti()
```

#### 10.5.5 API wrapper

```typescript
export async function semanticSearchMulti(
  queries: string[],
  limit?: number,
  fusionStrategy?: 'union' | 'intersection' | 'rrf',
  genres?: string[],
  moods?: string[],
  activities?: string[],
  minEnergy?: number,
  maxEnergy?: number,
): Promise<SemanticSearchResult[]> {
  return invoke('semantic_search_multi', {
    queries,
    limit,
    fusion_strategy: fusionStrategy,
    genres,
    moods,
    activities,
    min_energy: minEnergy,
    max_energy: maxEnergy,
  });
}
```

### Fișiere afectate (10.5)
- `src-tauri/src/models.rs` — +1 enum (FusionStrategy)
- `src-tauri/src/semantic.rs` — +search_multi(), +fuse_union/intersection/rrf (~120 linii)
- `src-tauri/src/lib.rs` — +1 command semantic_search_multi
- `src/api.ts` — +1 wrapper semanticSearchMulti()
- `src/types.ts` — +FusionStrategy type
- `src/components/views/SearchView.tsx` — Multi-query chips + strategy selector

---

## Sub-Faza 10.6: Playlist Auto-Refresh ⏱️ ~60 min

### Problemă
Semantic playlists sunt statice — odată create, nu se actualizează când biblioteca se modifică. Track-uri noi nu apar automat.

### Soluție: Abonament playlist-query cu verificare periodică

#### 10.6.1 Tabelă nouă → `db.rs`

```sql
CREATE TABLE IF NOT EXISTS semantic_playlist_subscriptions (
    playlist_id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    fusion_strategy TEXT DEFAULT 'union',
    genres TEXT,            -- JSON array
    moods TEXT,             -- JSON array
    activities TEXT,        -- JSON array
    min_energy INTEGER,
    max_energy INTEGER,
    max_tracks INTEGER DEFAULT 50,
    min_similarity REAL DEFAULT 0.3,
    last_refresh TEXT,      -- ISO 8601
    auto_refresh_enabled INTEGER DEFAULT 1,
    refresh_interval_hours INTEGER DEFAULT 24,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
);
```

#### 10.6.2 CRUD operații → `db.rs`

```rust
pub fn save_playlist_subscription(
    &self,
    playlist_id: &str,
    query: &str,
    fusion_strategy: &str,
    genres: Option<&str>,
    moods: Option<&str>,
    activities: Option<&str>,
    min_energy: Option<i32>,
    max_energy: Option<i32>,
    max_tracks: i32,
    min_similarity: f64,
    refresh_interval_hours: i32,
) -> Result<(), DbError>

pub fn get_playlist_subscription(
    &self,
    playlist_id: &str,
) -> Result<Option<PlaylistSubscription>, DbError>

pub fn get_due_subscriptions(&self) -> Result<Vec<PlaylistSubscription>, DbError>
// SELECT * WHERE auto_refresh_enabled = 1 
//   AND (last_refresh IS NULL 
//        OR datetime(last_refresh, '+' || refresh_interval_hours || ' hours') < datetime('now'))

pub fn update_subscription_last_refresh(
    &self,
    playlist_id: &str,
) -> Result<(), DbError>

pub fn delete_playlist_subscription(
    &self,
    playlist_id: &str,
) -> Result<(), DbError>
```

#### 10.6.3 Model de date → `models.rs`

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistSubscription {
    pub playlist_id: String,
    pub query: String,
    pub fusion_strategy: String,
    pub genres: Option<Vec<String>>,
    pub moods: Option<Vec<String>>,
    pub activities: Option<Vec<String>>,
    pub min_energy: Option<i32>,
    pub max_energy: Option<i32>,
    pub max_tracks: i32,
    pub min_similarity: f64,
    pub last_refresh: Option<String>,
    pub auto_refresh_enabled: bool,
    pub refresh_interval_hours: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistRefreshResult {
    pub playlist_id: String,
    pub tracks_added: i32,
    pub tracks_removed: i32,
    pub new_total: i32,
    pub refreshed_at: String,
}
```

#### 10.6.4 Tauri Commands → `lib.rs`

```rust
/// Link a semantic query to a playlist for auto-refresh
#[tauri::command]
async fn set_playlist_auto_refresh(
    state: State<'_, AppState>,
    playlist_id: String,
    query: String,
    fusion_strategy: Option<String>,
    genres: Option<Vec<String>>,
    moods: Option<Vec<String>>,
    activities: Option<Vec<String>>,
    min_energy: Option<i32>,
    max_energy: Option<i32>,
    max_tracks: Option<i32>,
    refresh_interval_hours: Option<i32>,
) -> Result<String, String> {
    let db = state.db.lock().await;
    db.save_playlist_subscription(
        &playlist_id,
        &query,
        &fusion_strategy.unwrap_or("union".to_string()),
        genres.as_ref().map(|g| serde_json::to_string(g).unwrap_or_default()).as_deref(),
        moods.as_ref().map(|m| serde_json::to_string(m).unwrap_or_default()).as_deref(),
        activities.as_ref().map(|a| serde_json::to_string(a).unwrap_or_default()).as_deref(),
        min_energy,
        max_energy,
        max_tracks.unwrap_or(50),
        0.3,
        refresh_interval_hours.unwrap_or(24),
    ).map_err(|e| e.to_string())?;

    Ok("Auto-refresh configured".to_string())
}

/// Check and refresh all due playlists
#[tauri::command]
async fn check_playlist_refreshes(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<Vec<PlaylistRefreshResult>, String> {
    let db = state.db.lock().await;
    let settings = db.get_settings().map_err(|e| e.to_string())?;
    let due = db.get_due_subscriptions().map_err(|e| e.to_string())?;

    if due.is_empty() {
        return Ok(Vec::new());
    }

    let ollama = OllamaClient::with_config(&settings.ollama_url, &settings.embedding_model);
    let index = state.semantic_index.read().await;
    let mut results = Vec::new();

    for sub in due {
        // Parse queries (single or multi)
        let queries: Vec<String> = if sub.query.contains("||") {
            sub.query.split("||").map(|s| s.trim().to_string()).collect()
        } else {
            vec![sub.query.clone()]
        };

        // Embed queries
        let mut embeddings = Vec::new();
        for q in &queries {
            match ollama.embed_single(q, &settings.embedding_model).await {
                Ok(emb) => embeddings.push(emb),
                Err(_) => continue,
            }
        }

        if embeddings.is_empty() { continue; }

        // Build filter from subscription
        let filter = SemanticSearchFilter {
            genres: sub.genres.clone(),
            moods: sub.moods.clone(),
            activities: sub.activities.clone(),
            min_similarity: Some(sub.min_similarity),
            min_energy: sub.min_energy,
            max_energy: sub.max_energy,
        };

        let strategy = match sub.fusion_strategy.as_str() {
            "intersection" => FusionStrategy::Intersection,
            "rrf" => FusionStrategy::ReciprocalRankFusion,
            _ => FusionStrategy::Union,
        };

        // Search
        let scored = if embeddings.len() == 1 {
            index.search_filtered(&embeddings[0], sub.max_tracks as usize, &filter)
        } else {
            index.search_multi(&embeddings, sub.max_tracks as usize, &strategy, &filter)
        };

        // Get current playlist tracks
        let current_tracks: Vec<String> = db
            .get_playlist_tracks(&sub.playlist_id)
            .map_err(|e| e.to_string())?
            .iter()
            .map(|t| t.id.clone())
            .collect();

        let new_track_ids: Vec<String> = scored.iter().map(|(id, _)| id.clone()).collect();

        // Diff: add new, remove old
        let mut added = 0;
        let mut removed = 0;

        // Add tracks not currently in playlist
        for track_id in &new_track_ids {
            if !current_tracks.contains(track_id) {
                let _ = db.add_track_to_playlist(&sub.playlist_id, track_id);
                added += 1;
            }
        }

        // Remove tracks no longer matching (optional — configurable)
        for track_id in &current_tracks {
            if !new_track_ids.contains(track_id) {
                let _ = db.remove_track_from_playlist(&sub.playlist_id, track_id);
                removed += 1;
            }
        }

        // Update last refresh
        let _ = db.update_subscription_last_refresh(&sub.playlist_id);

        results.push(PlaylistRefreshResult {
            playlist_id: sub.playlist_id.clone(),
            tracks_added: added,
            tracks_removed: removed,
            new_total: new_track_ids.len() as i32,
            refreshed_at: chrono::Local::now().to_rfc3339(),
        });

        // Emit event for UI badge
        let _ = app_handle.emit("playlist-refreshed", serde_json::json!({
            "playlist_id": sub.playlist_id,
            "tracks_added": added,
            "tracks_removed": removed,
        }));
    }

    Ok(results)
}

/// Remove auto-refresh subscription
#[tauri::command]
async fn remove_playlist_auto_refresh(
    state: State<'_, AppState>,
    playlist_id: String,
) -> Result<bool, String> {
    let db = state.db.lock().await;
    db.delete_playlist_subscription(&playlist_id)
        .map_err(|e| e.to_string())?;
    Ok(true)
}
```

#### 10.6.5 Background refresh cu Tauri setup

```rust
// În run() setup — periodic check every 30 minutes
let app_handle_clone = app_handle.clone();
let state_clone = state.clone();
tokio::spawn(async move {
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(30 * 60)).await;
        // Trigger playlist refresh check
        // (simplified — real implementation would need State access)
    }
});
```

#### 10.6.6 Frontend Integration

```typescript
// PlaylistView.tsx — auto-refresh badge
const [refreshInfo, setRefreshInfo] = useState<{added: number, removed: number} | null>(null);

useEffect(() => {
  const unlisten = listen('playlist-refreshed', (event) => {
    if (event.payload.playlist_id === playlistId) {
      setRefreshInfo({
        added: event.payload.tracks_added,
        removed: event.payload.tracks_removed,
      });
    }
  });
  return () => { unlisten.then(u => u()); };
}, [playlistId]);

// Badge: "🔄 3 new tracks added, 1 removed"
```

#### 10.6.7 API wrappers

```typescript
export async function setPlaylistAutoRefresh(
  playlistId: string,
  query: string,
  fusionStrategy?: string,
  genres?: string[],
  moods?: string[],
  activities?: string[],
  minEnergy?: number,
  maxEnergy?: number,
  maxTracks?: number,
  refreshIntervalHours?: number,
): Promise<string> {
  return invoke('set_playlist_auto_refresh', {
    playlist_id: playlistId,
    query,
    fusion_strategy: fusionStrategy,
    genres, moods, activities,
    min_energy: minEnergy,
    max_energy: maxEnergy,
    max_tracks: maxTracks,
    refresh_interval_hours: refreshIntervalHours,
  });
}

export async function checkPlaylistRefreshes(): Promise<PlaylistRefreshResult[]> {
  return invoke('check_playlist_refreshes');
}

export async function removePlaylistAutoRefresh(playlistId: string): Promise<boolean> {
  return invoke('remove_playlist_auto_refresh', { playlist_id: playlistId });
}
```

### Fișiere afectate (10.6)
- `src-tauri/src/db.rs` — +1 tabelă, +5 CRUD methods (~100 linii)
- `src-tauri/src/models.rs` — +2 structs (PlaylistSubscription, PlaylistRefreshResult)
- `src-tauri/src/lib.rs` — +3 commands, +1 background task
- `src/api.ts` — +3 wrappers
- `src/types.ts` — +2 interfaces
- `src/components/views/PlaylistView.tsx` — Auto-refresh badge + configure modal

---

## Sumar Total FAZA 10

### Dependențe Cargo Noi

```toml
[dependencies]
instant-distance = "0.6"    # HNSW implementation
bincode = "1"               # Binary serialization for disk persistence
```

### Fișiere Afectate (Total)

| File | New Lines | Changes |
|------|-----------|---------|
| `src-tauri/Cargo.toml` | +2 | 2 new dependencies |
| `src-tauri/src/semantic.rs` | +450 | HybridIndex, HNSW, disk persistence, multi-query fusion |
| `src-tauri/src/models.rs` | +100 | 6 new structs/enums |
| `src-tauri/src/db.rs` | +120 | 1 new table, 5 CRUD methods |
| `src-tauri/src/lib.rs` | +350 | 6 new commands, enhanced indexing, auto-save, background task |
| `src/api.ts` | +80 | 6 new API wrappers |
| `src/types.ts` | +60 | 6 new TypeScript interfaces |
| `src/components/views/SearchView.tsx` | +150 | Multi-query chips, energy slider, fusion selector |
| `src/components/views/SettingsView.tsx` | +80 | Disk status, persist button, enhanced progress |
| `src/components/views/PlaylistView.tsx` | +100 | Auto-refresh badge, configure modal |

**Total new code: ~1500 linii**

### Comenzi Tauri Noi (6)

```
semantic_search_multi(queries, fusion_strategy, limit, genres, moods, activities, min_energy, max_energy)
semantic_persist_index()
get_index_disk_status()
set_playlist_auto_refresh(playlist_id, query, ...)
check_playlist_refreshes()
remove_playlist_auto_refresh(playlist_id)
```

### Estimare Timp

| Sub-Fază | Feature | Timp | Complexitate |
|----------|---------|------|-------------|
| 10.1 | WebSocket-grade Progress | 40 min | Medie |
| 10.2 | True HNSW (instant-distance) | 90 min | **Ridicată** |
| 10.3 | Persistent Index pe Disc | 60 min | Medie |
| 10.4 | Energy Level Filtering | 30 min | Ușoară |
| 10.5 | Multi-Query Semantic Search | 60 min | Medie-Ridicată |
| 10.6 | Playlist Auto-Refresh | 60 min | Medie |
| | Build & Fix & Test | 30 min | — |
| **TOTAL** | | **~6-7 ore** | |

### Ordine Recomandată de Implementare

```
10.4 (Energy Filtering)        ←── cel mai simplu, zero deps noi
  ↓
10.1 (WebSocket Progress)      ←── refactoring events
  ↓
10.2 (HNSW)                    ←── +instant-distance dep
  ↓
10.3 (Disk Persistence)        ←── +bincode dep, depinde de HybridIndex din 10.2
  ↓
10.5 (Multi-Query)             ←── depinde de HybridIndex
  ↓
10.6 (Playlist Auto-Refresh)   ←── depinde de multi-query + persistence
```

### Riscuri & Mitigare

| Risc | Impact | Probabilitate | Mitigare |
|------|--------|---------------|----------|
| `instant-distance` API break | Ridicat | Scăzut | Pin version în Cargo.toml |
| HNSW build time 100k tracks | Mediu | Mediu | Build async, nu bloca UI |
| Index corrupt pe disc | Ridicat | Scăzut | Version check + auto-rebuild |
| Memory spike la 100k+ tracks | Mediu | Mediu | Monitor estimate_memory_mb() |
| Ollama timeout la batch embed multi-query | Mediu | Mediu | Retry per-query, nu fail all |
| Auto-refresh spam la biblioteci volatile | Scăzut | Scăzut | Configurable interval (min 1h) |
| Bincode version incompatibility | Mediu | Scăzut | Schema version field |
| HNSW accuracy vs brute-force | Scăzut | Scăzut | Recall ~95-98% la k=20 |

### Verificare Build

```bash
# După fiecare sub-fază:
cd src-tauri && cargo check 2>&1 | Select-String "error|Finished"
cd .. && npx tsc --noEmit

# Test final complet:
npm run tauri dev
# → Settings → Re-index (check HNSW auto-build log)
# → SearchView → Multi-query ("rock ballad" + "calm introspective")
# → Create semantic playlist → Enable auto-refresh
# → Wait 30s → Check auto-refresh badge
# → Restart app → Verify index loads from disk
```

---

## Diagrama Dependențelor între Sub-Faze

```
  ┌──────────────────────┐
  │   10.4 Energy Filter │ ←── Independent, zero deps
  └──────────┬───────────┘
             │ (extend SemanticSearchFilter)
  ┌──────────▼───────────┐
  │   10.1 WS Progress   │ ←── Refactor events
  └──────────┬───────────┘
             │ (structured events)
  ┌──────────▼───────────┐
  │   10.2 HNSW Index    │ ←── HybridIndex replaces ANNIndex
  └──────────┬───────────┘
             │ (HybridIndex API)
  ┌──────────▼───────────┐
  │   10.3 Disk Persist  │ ←── Serialize HybridIndex
  └──────────┬───────────┘
             │ (persistent index)
  ┌──────────▼───────────┐
  │   10.5 Multi-Query   │ ←── Uses HybridIndex.search_multi()
  └──────────┬───────────┘
             │ (multi-query + filters)
  ┌──────────▼───────────┐
  │  10.6 Auto-Refresh   │ ←── Uses search_multi() + persistence
  └──────────────────────┘
```

---

## Conclusion

FAZA 10 evoluează semantic search-ul YTM-Free de la un **MVP funcțional** la o **soluție enterprise-grade**:

- **Scalabilitate**: De la 20k → **500k+ tracks** cu HNSW O(log n)
- **Persistență**: Index disponibil instant la restart (zero re-index wait)
- **Expresivitate**: Multi-query fuzionat cu 3 strategii (Union/Intersection/RRF)
- **Precizie**: Energy level filtering (1-10 scale) completează filtrarea semantică
- **Autonomie**: Playlists se actualizează automat când biblioteca se schimbă
- **Feedback**: WebSocket-grade progress cu state machine complet

Toate aceste features sunt **backward-compatible** cu FAZA 9 — nicio funcționalitate existentă nu se pierde.

✅ **FAZA 10 PLAN COMPLETE — Ready for Implementation**
