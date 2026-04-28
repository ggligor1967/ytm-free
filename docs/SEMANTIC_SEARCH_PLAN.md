# 🧠 Semantic Search cu Embeddings — Plan de Implementare

## Viziune
Utilizatorul scrie **"ceva ca Bohemian Rhapsody dar mai trist"** și primește rezultate din biblioteca locală bazate pe **similaritate semantică**, nu keyword matching. Sub capotă: fiecare track are un vector embedding generat de Ollama, iar căutarea face cosine similarity între query embedding și toate track-urile indexate.

---

## Arhitectura

```
┌──────────────────────────────────────────────────────┐
│                    FRONTEND (React)                   │
│                                                       │
│  SearchView.tsx ─── [🔍 "sad rock ballad"] ──────────│
│      ↕ toggle: YouTube Search ↔ Semantic Search       │
│      ↕ afișează: similarity score, match reason       │
│                                                       │
│  SettingsView.tsx ─── [Embedding Model] [Re-index]   │
│      ↕ progress bar, status text                      │
├───────────────────────────────────────────────────────┤
│                     api.ts (IPC)                      │
│  semanticSearch() | semanticIndexAll() |              │
│  semanticIndexTrack() | getSemanticStatus()           │
├───────────────────────────────────────────────────────┤
│                  BACKEND (Rust/Tauri)                  │
│                                                       │
│  lib.rs ──── #[tauri::command] semantic_search        │
│              #[tauri::command] semantic_index_all      │
│              #[tauri::command] semantic_index_track    │
│              #[tauri::command] get_semantic_status     │
│                                                       │
│  ollama/client.rs ── embed() → POST /api/embed        │
│                                                       │
│  db.rs ──── track_embeddings table (BLOB vectors)     │
│             save/get/delete/count embeddings           │
│                                                       │
│  models.rs ── TrackEmbedding struct                   │
│               SemanticSearchResult struct              │
└───────────────────────────────────────────────────────┘
```

---

## Faze de Implementare

### FAZA 1: Backend Foundation (Rust) ⏱️ ~45 min

#### 1.1 Modele noi → `src-tauri/src/models.rs`

Adaugă la finalul fișierului (după `AICacheEntry`):

```rust
// ============================================================================
// SEMANTIC SEARCH MODELS
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackEmbedding {
    pub track_id: String,
    pub embedding: Vec<f32>,          // vectorul de embedding
    pub text_used: String,            // textul din care s-a generat (pt re-index)
    pub model_used: String,           // "all-minilm", "nomic-embed-text", etc.
    pub dimensions: i32,              // 384, 768, etc.
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticSearchResult {
    pub track: Track,
    pub similarity: f64,              // cosine similarity 0.0 → 1.0
    pub match_reason: String,         // "Similar mood and genre" (generat de LLM)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticIndexStatus {
    pub total_tracks: i64,
    pub indexed_tracks: i64,
    pub model_used: String,
    pub is_indexing: bool,
}
```

#### 1.2 Tabelă nouă + migrații → `src-tauri/src/db.rs`

**A. Tabelă în `init_tables()` (în blocul `execute_batch`, după `ai_cache`):**

```sql
CREATE TABLE IF NOT EXISTS track_embeddings (
    track_id TEXT PRIMARY KEY,
    embedding BLOB NOT NULL,
    text_used TEXT NOT NULL,
    model_used TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
);
```

**B. Migrație settings (după migrările DJ Mode, linia ~201):**

```rust
let _ = self.conn.execute(
    "ALTER TABLE settings ADD COLUMN semantic_search_enabled INTEGER DEFAULT 0",
    [],
);
let _ = self.conn.execute(
    "ALTER TABLE settings ADD COLUMN embedding_model TEXT DEFAULT 'all-minilm'",
    [],
);
```

**C. Câmp nou în `Settings` struct (`models.rs`) + `Default::default()`:**
- `pub semantic_search_enabled: bool` → default `false`
- `pub embedding_model: String` → default `"all-minilm".to_string()`

**D. Update `get_settings()` și `update_settings()` în `db.rs`** — adaugă cele 2 coloane noi în SELECT/UPDATE.

**E. Operații CRUD embeddings în `db.rs`** (secțiune nouă):

```rust
// ========================================================================
// TRACK EMBEDDINGS
// ========================================================================

pub fn save_embedding(&self, track_id: &str, embedding: &[f32], text_used: &str, 
                       model_used: &str, dimensions: i32) -> Result<(), DbError>
// INSERT OR REPLACE → serializează Vec<f32> ca BLOB (little-endian bytes)

pub fn get_embedding(&self, track_id: &str) -> Result<Option<TrackEmbedding>, DbError>
// SELECT → deserializează BLOB → Vec<f32>

pub fn get_all_embeddings(&self) -> Result<Vec<TrackEmbedding>, DbError>
// SELECT * → pentru cosine similarity scan

pub fn delete_embedding(&self, track_id: &str) -> Result<(), DbError>
// DELETE WHERE track_id = ?

pub fn delete_all_embeddings(&self) -> Result<(), DbError>
// DELETE FROM track_embeddings (pentru re-index complet)

pub fn count_embeddings(&self) -> Result<i64, DbError>
// SELECT COUNT(*) FROM track_embeddings
```

**Serializare Vec<f32> ↔ BLOB:**
```rust
// Save: Vec<f32> → bytes
let bytes: Vec<u8> = embedding.iter()
    .flat_map(|f| f.to_le_bytes())
    .collect();

// Load: bytes → Vec<f32>
let embedding: Vec<f32> = blob.chunks_exact(4)
    .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
    .collect();
```

---

### FAZA 2: Ollama Embed Client (Rust) ⏱️ ~20 min

#### 2.1 Metode noi → `src-tauri/src/ollama/client.rs`

Adaugă structuri request/response + metoda `embed()`:

```rust
// === EMBEDDING STRUCTS ===

#[derive(Serialize)]
struct EmbedRequest {
    model: String,
    input: Vec<String>,      // suportă batch
}

#[derive(Deserialize)]
struct EmbedResponse {
    embeddings: Vec<Vec<f32>>,
    #[allow(dead_code)]
    model: Option<String>,
}

impl OllamaClient {
    /// Generate embeddings via POST /api/embed (new API)
    pub async fn embed(&self, texts: Vec<String>, model: &str) -> Result<Vec<Vec<f32>>, OllamaError> {
        let request = EmbedRequest {
            model: model.to_string(),
            input: texts,
        };

        let response = self.client
            .post(format!("{}/api/embed", self.base_url))
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() { OllamaError::Timeout }
                else { OllamaError::Network(e.to_string()) }
            })?;

        if !response.status().is_success() {
            return Err(OllamaError::Network(
                format!("Embed failed: {}", response.status())
            ));
        }

        let result: EmbedResponse = response
            .json()
            .await
            .map_err(|e| OllamaError::Parse(e.to_string()))?;

        Ok(result.embeddings)
    }

    /// Embed single text (convenience)
    pub async fn embed_single(&self, text: &str, model: &str) -> Result<Vec<f32>, OllamaError> {
        let results = self.embed(vec![text.to_string()], model).await?;
        results.into_iter().next()
            .ok_or(OllamaError::Parse("No embedding returned".to_string()))
    }
}
```

**Endpoint Ollama:** `POST /api/embed` (new API, preferat vs deprecated `/api/embeddings`)
- Request: `{ "model": "all-minilm", "input": ["text1", "text2"] }`
- Response: `{ "embeddings": [[0.01, -0.001, ...], [...]], "model": "all-minilm" }`

---

### FAZA 3: Cosine Similarity + Search Logic (Rust) ⏱️ ~30 min

#### 3.1 Funcție cosine similarity (în `lib.rs` sau un fișier dedicat `semantic.rs`)

```rust
/// Cosine similarity între doi vectori normalizați
fn cosine_similarity(a: &[f32], b: &[f32]) -> f64 {
    if a.len() != b.len() || a.is_empty() { return 0.0; }
    
    let mut dot = 0.0_f64;
    let mut norm_a = 0.0_f64;
    let mut norm_b = 0.0_f64;
    
    for (x, y) in a.iter().zip(b.iter()) {
        let x = *x as f64;
        let y = *y as f64;
        dot += x * y;
        norm_a += x * x;
        norm_b += y * y;
    }
    
    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom == 0.0 { 0.0 } else { dot / denom }
}
```

#### 3.2 Text representation per track

Funcție care compune textul de indexat dintr-un track + metadatele sale:

```rust
fn build_track_text(track: &Track, metadata: Option<&TrackMetadataDB>) -> String {
    let mut parts = vec![
        format!("{} by {}", track.title, track.artist),
    ];
    
    if let Some(meta) = metadata {
        if let Some(genre) = &meta.genre { parts.push(format!("Genre: {}", genre)); }
        if let Some(mood) = &meta.mood { parts.push(format!("Mood: {}", mood)); }
        if let Some(desc) = &meta.ai_description { parts.push(desc.clone()); }
        if let Some(keywords) = &meta.keywords { parts.push(format!("Keywords: {}", keywords)); }
        if let Some(tempo) = &meta.tempo { parts.push(format!("Tempo: {}", tempo)); }
        if let Some(decade) = &meta.decade { parts.push(format!("Decade: {}", decade)); }
        if let Some(activity) = &meta.activity_tags { parts.push(format!("Activities: {}", activity)); }
    }
    
    parts.join(". ")
}
```

#### 3.3 Tauri Commands → `src-tauri/src/lib.rs`

```rust
/// Index un singur track
#[tauri::command]
async fn semantic_index_track(
    track_id: String,
    state: State<'_, AppState>,
) -> Result<bool, String> { ... }

/// Index TOATE track-urile (cu progress events)
#[tauri::command]
async fn semantic_index_all(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<SemanticIndexStatus, String> { ... }
// Emite event "semantic-index-progress" cu { indexed, total, current_track }

/// Căutare semantică
#[tauri::command]
async fn semantic_search(
    query: String,
    limit: Option<i32>,
    state: State<'_, AppState>,
) -> Result<Vec<SemanticSearchResult>, String> {
    // 1. Embed query-ul cu acelasi model
    // 2. Încarcă toate embedding-urile din DB
    // 3. Cosine similarity cu fiecare
    // 4. Sortează descrescător, returnează top N (default 20)
    // 5. Filtru: similarity > 0.3 (threshold)
}

/// Status semantic index
#[tauri::command]
async fn get_semantic_status(
    state: State<'_, AppState>,
) -> Result<SemanticIndexStatus, String> { ... }
```

**Înregistrare în `.invoke_handler()`** — adaugă cele 4 comenzi noi.

---

### FAZA 4: Frontend API + Types (TypeScript) ⏱️ ~15 min

#### 4.1 Types → `src/types.ts`

```typescript
export interface SemanticSearchResult {
  track: Track;
  similarity: number;
  match_reason: string;
}

export interface SemanticIndexStatus {
  total_tracks: number;
  indexed_tracks: number;
  model_used: string;
  is_indexing: boolean;
}
```

#### 4.2 API wrappers → `src/api.ts`

```typescript
export async function semanticSearch(query: string, limit?: number): Promise<SemanticSearchResult[]> {
  return invoke('semantic_search', { query, limit });
}

export async function semanticIndexAll(): Promise<SemanticIndexStatus> {
  return invoke('semantic_index_all');
}

export async function semanticIndexTrack(trackId: string): Promise<boolean> {
  return invoke('semantic_index_track', { trackId });
}

export async function getSemanticStatus(): Promise<SemanticIndexStatus> {
  return invoke('get_semantic_status');
}
```

#### 4.3 Actualizare Settings type → `src/types.ts`

Adaugă în interfața `Settings`:
```typescript
semantic_search_enabled: boolean;
embedding_model: string;
```

---

### FAZA 5: UI — SearchView Semantic Mode ⏱️ ~30 min

#### 5.1 `src/components/views/SearchView.tsx`

**Modificări:**
1. **Toggle YouTube ↔ Semantic** — buton/tab deasupra search bar-ului
2. **Detectare automată** — dacă query-ul e natural language ("something like X but Y"), activează semantic automat
3. **Rezultate cu scor** — afișează `similarity %` pe fiecare TrackCard
4. **Empty state** — "Trebuie să indexezi biblioteca. [Index Now]"
5. **Fallback** — dacă semantic search returnează 0 rezultate, sugerează YouTube search

```
┌─────────────────────────────────────────────────┐
│  [🔍 YouTube Search] [🧠 Semantic Search]        │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │ 🔍 "electronic music for late night coding" │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  ✨ Semantic results from your library:           │
│                                                   │
│  ┌─────┐  Tycho - Awake           96% match      │
│  │ 🎵  │  Electronic · Focused · Calm             │
│  └─────┘                                          │
│  ┌─────┐  Boards of Canada - Dayvan   89% match  │
│  │ 🎵  │  Electronic · Dreamy                     │
│  └─────┘                                          │
│  ┌─────┐  Aphex Twin - Xtal        84% match     │
│  │ 🎵  │  Electronic · Ambient                    │
│  └─────┘                                          │
│                                                   │
│  Didn't find what you want? [Search YouTube →]    │
└─────────────────────────────────────────────────┘
```

---

### FAZA 6: UI — Settings + Index Management ⏱️ ~20 min

#### 6.1 `src/components/views/SettingsView.tsx`

Adaugă secțiune nouă **"Semantic Search"** (după DJ Mode):

```
┌─────────────────────────────────────────┐
│ 🧠 Semantic Search                       │
│                                          │
│ Enable Semantic Search    [  Toggle  ]   │
│                                          │
│ Embedding Model                          │
│ [all-minilm          ▼]                  │
│   all-minilm (fast, 384d)                │
│   nomic-embed-text (quality, 768d)       │
│   mxbai-embed-large (best, 1024d)        │
│                                          │
│ Index Status: 142/350 tracks indexed     │
│ [████████░░░░░░░░] 40%                   │
│                                          │
│ [🔄 Re-index All]  [🗑️ Clear Index]     │
└─────────────────────────────────────────┘
```

---

## Prioritatea Modelelor de Embedding Ollama

| Model                  | Dimensiuni | Viteză | Calitate | Size   |
|------------------------|------------|--------|----------|--------|
| `all-minilm`           | 384        | ⚡⚡⚡  | ★★★      | 23MB   |
| `nomic-embed-text`     | 768        | ⚡⚡    | ★★★★     | 274MB  |
| `mxbai-embed-large`    | 1024       | ⚡      | ★★★★★    | 670MB  |

**Recomandare default:** `all-minilm` — cel mai rapid, suficient de bun pentru muzică, user-ul poate upgrade din Settings.

---

## Performance Considerations

### Memorie
- 1000 tracks × 384 dimensions × 4 bytes = **~1.5 MB** în memorie
- 1000 tracks × 768 dimensions × 4 bytes = **~3 MB** în memorie
- Absolut neglijabil — se pot ține TOATE în RAM

### Indexare
- Batch embedding: 10 tracks per request la Ollama
- Progress events: emit la fiecare track indexat
- Pe un PC mediu: ~2-5 sec per track → 1000 tracks ≈ 30-80 min (background)
- **Optimizare:** indexare automată la add/import track (1 track = instant)

### Căutare
- Cosine similarity pe 1000 vectori × 384d = **< 5ms** (brute force)
- Nu e nevoie de ANN (approximate nearest neighbor) sub 10k tracks
- Response time total: embed query (~200ms) + similarity scan (~5ms) = **~200ms**

---

## Modele de Embedding Suportate

Utilizatorul trebuie să aibă un model de embedding instalat în Ollama. Auto-detect la primul use:

```rust
// Verifică dacă modelul de embedding e disponibil
let models = client.list_models().await?;
if !models.iter().any(|m| m.contains("minilm") || m.contains("embed") || m.contains("nomic")) {
    return Err("No embedding model found. Run: ollama pull all-minilm".into());
}
```

---

## Fișiere Afectate (Checklist)

### Rust Backend
- [ ] `src-tauri/src/models.rs` — +3 structs (TrackEmbedding, SemanticSearchResult, SemanticIndexStatus), +2 fields Settings
- [ ] `src-tauri/src/db.rs` — +1 tabelă, +2 migrații settings, +6 metode CRUD, update get/update_settings
- [ ] `src-tauri/src/ollama/client.rs` — +2 structs (EmbedRequest, EmbedResponse), +2 metode (embed, embed_single)
- [ ] `src-tauri/src/lib.rs` — +4 comenzi Tauri, +2 funcții helper (cosine_similarity, build_track_text), +4 în invoke_handler

### TypeScript Frontend
- [ ] `src/types.ts` — +2 interfaces, +2 fields în Settings
- [ ] `src/api.ts` — +4 funcții wrapper
- [ ] `src/components/views/SearchView.tsx` — toggle mode, semantic results, similarity display
- [ ] `src/components/views/SettingsView.tsx` — secțiune Semantic Search cu model picker, status, re-index

### Verificare Build
- [ ] `cargo check` — 0 errors
- [ ] `npx tsc --noEmit` — 0 errors

---

## Riscuri & Mitigare

| Risc | Mitigare |
|------|----------|
| User nu are model embedding instalat | Auto-detect + mesaj clar "Run: `ollama pull all-minilm`" |
| Indexare lentă pe biblioteci mari | Background indexing cu progress bar, skip already indexed |
| Embedding model schimbat → vectori incompatibili | Re-index automat când se schimbă modelul (delete_all + re-index) |
| Ollama nu e pornit | Același handling ca restul features-urilor AI — fallback message |

---

## Estimare Totală: ~2.5-3 ore

| Fază | Timp   | Complexitate |
|------|--------|--------------|
| 1. Backend Foundation | 45 min | Medie |
| 2. Ollama Embed Client | 20 min | Ușoară |
| 3. Cosine Similarity + Commands | 30 min | Medie |
| 4. Frontend API + Types | 15 min | Ușoară |
| 5. SearchView UI | 30 min | Medie |
| 6. Settings UI | 20 min | Ușoară |
| Build & Test | 15 min | — |
| **TOTAL** | **~3h** | |

---

## Comenzi de Test Post-Implementare

```bash
# 1. Pull embedding model
ollama pull all-minilm

# 2. Build & Run
npm run tauri dev

# 3. Settings → Enable Semantic Search → Click "Re-index All"
# 4. Așteaptă indexarea (vezi progress bar)
# 5. Search → Tab "Semantic" → Scrie "energetic rock for workout"
# 6. Verifică rezultate cu similarity scores
```
