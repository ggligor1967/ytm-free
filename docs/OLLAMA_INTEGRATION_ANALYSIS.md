# 🧠 Analiză: Integrare Ollama pentru Funcții Smart în YTM-Free

## Sumar Executiv

Aplicația **YTM-Free** este un player de muzică bazat pe Tauri (Rust + React) care oferă:
- Căutare și streaming audio via YouTube
- Management playlist-uri
- Import Spotify CSV
- Descărcări locale
- Favorite și istoric redare

Integrarea cu **Ollama** (LLM local) poate adăuga funcționalități inteligente fără costuri cloud și cu privacy maxim.

---

## 🎯 Funcții Smart Propuse

### 1. **Smart Search Enhancement** (Prioritate: ÎNALTĂ)
**Descriere:** Îmbunătățirea căutărilor prin înțelegerea contextului și intenției utilizatorului.

**Scenarii:**
- "vreau ceva ca Metallica dar mai soft" → LLM sugerează: "Metallica ballads", "Nothing Else Matters"
- "muzică pentru concentrare" → generează query-uri optimizate
- "ceva din anii 80 pentru petrecere" → expandează în căutări multiple relevante

**Implementare:**
```rust
// src-tauri/src/ollama.rs
pub async fn enhance_search_query(user_query: &str, context: &UserContext) -> Vec<String> {
    let prompt = format!(
        "Utilizatorul caută muzică: '{}'. 
         Istoricul genurilor preferate: {:?}.
         Generează 3 căutări YouTube optimizate.",
        user_query, context.favorite_genres
    );
    ollama_generate(prompt).await
}
```

---

### 2. **Auto-Tagging & Categorization** (Prioritate: ÎNALTĂ)
**Descriere:** Clasificarea automată a track-urilor după gen, mood, energie.

**Schema DB extinsă:**
```sql
CREATE TABLE IF NOT EXISTS track_metadata (
    track_id TEXT PRIMARY KEY,
    genre TEXT,
    mood TEXT,        -- "energetic", "chill", "melancholic", etc.
    energy_level INTEGER, -- 1-10
    tempo TEXT,       -- "slow", "medium", "fast"
    keywords TEXT,    -- JSON array
    ai_description TEXT,
    analyzed_at TEXT,
    FOREIGN KEY (track_id) REFERENCES tracks(id)
);
```

**Implementare:**
```rust
pub async fn analyze_track(track: &Track) -> TrackMetadata {
    let prompt = format!(
        "Analizează această piesă muzicală:
         Titlu: {}
         Artist: {}
         
         Returnează JSON cu: genre, mood, energy_level (1-10), tempo, keywords[]",
        track.title, track.artist
    );
    
    let response = ollama_generate(prompt).await;
    serde_json::from_str(&response).unwrap()
}
```

---

### 3. **Smart Playlist Generation** (Prioritate: ÎNALTĂ)
**Descriere:** Generarea automată de playlist-uri bazate pe:
- Descriere text liberă
- Mood/situație
- Track seed

**Scenarii:**
- "Creează un playlist pentru drumul spre muncă, 30 minute"
- "Playlist de workout cu ce am ascultat recent"
- "Mix similar cu melodiile mele favorite"

**API:**
```typescript
// Frontend
interface SmartPlaylistRequest {
  description: string;
  duration_minutes?: number;
  seed_tracks?: string[];
  mood?: string;
  energy_range?: [number, number];
}

// Rust command
#[tauri::command]
async fn generate_smart_playlist(
    state: State<'_, AppState>,
    request: SmartPlaylistRequest,
) -> Result<Vec<Track>, String>
```

---

### 4. **Intelligent Spotify Import Matching** (Prioritate: MEDIE)
**Descriere:** Îmbunătățirea match-urilor Spotify → YouTube folosind LLM pentru dezambiguizare.

**Problema curentă:** 
Căutarea simplă `"artist track_name"` poate returna:
- Cover-uri
- Versiuni live
- Remixuri
- Video-uri non-oficiale

**Soluție:**
```rust
pub async fn verify_youtube_match(
    spotify_track: &SpotifyTrack,
    youtube_results: &[SearchResult],
) -> Option<String> {
    let prompt = format!(
        "Track original Spotify:
         - Titlu: {}
         - Artist: {}
         - Album: {}
         - Durată: {} ms
         
         Rezultate YouTube (selectează cel mai potrivit, returnează ID-ul):
         {}
         
         Criterii: versiune oficială, audio fără video, durată similară.",
        spotify_track.track_name,
        spotify_track.artist_name,
        spotify_track.album_name,
        spotify_track.duration_ms.unwrap_or(0),
        format_youtube_results(youtube_results)
    );
    
    ollama_generate(prompt).await
}
```

---

### 5. **Natural Language Commands** (Prioritate: MEDIE)
**Descriere:** Control prin comenzi vocale/text natural.

**Comenzi supportate:**
| Comandă | Acțiune |
|---------|---------|
| "pune ceva relaxant" | Selectează track cu mood=chill |
| "skip la următorul" | playNext() |
| "adaugă la favorite" | toggleFavorite() |
| "creează playlist cu ultimele 10 ascultate" | Creează playlist |
| "caută mai multe de la acest artist" | Căutare artist curent |

**Implementare:**
```rust
#[derive(Serialize)]
pub enum PlayerCommand {
    Play(Option<String>),  // track_id sau query
    Pause,
    Next,
    Previous,
    AddToFavorites,
    CreatePlaylist { name: String, tracks: Vec<String> },
    Search(String),
}

pub async fn parse_natural_command(input: &str) -> PlayerCommand {
    let prompt = format!(
        "Parsează comanda utilizatorului pentru un player de muzică:
         Input: '{}'
         
         Returnează JSON cu tipul comenzii și parametrii.
         Tipuri: play, pause, next, previous, favorite, create_playlist, search",
        input
    );
    
    let response = ollama_generate(prompt).await;
    serde_json::from_str(&response).unwrap()
}
```

---

### 6. **Listening Insights & Recommendations** (Prioritate: SCĂZUTĂ)
**Descriere:** Analiză a obiceiurilor de ascultare și recomandări personalizate.

**Dashboard insights:**
- "Ascultați mult rock în weekend-uri"
- "Preferați muzică energetică dimineața"
- "Top 5 artiști din ultima lună"
- "Melodii uitate (neascultate >30 zile)"

---

### 7. **Lyrics Understanding** (Prioritate: SCĂZUTĂ)
**Descriere:** Căutare și înțelegere versuri (necesită sursă externă de lyrics).

**Funcții:**
- Căutare după fragment de versuri
- Rezumat temă melodie
- Traducere versuri

---

## 🏗️ Arhitectură Tehnică Propusă

### Structura Fișiere Noi

```
src-tauri/src/
├── ollama/
│   ├── mod.rs           # Export module
│   ├── client.rs        # Ollama HTTP client
│   ├── prompts.rs       # Prompt templates
│   ├── search.rs        # Smart search
│   ├── tagging.rs       # Auto-tagging
│   ├── playlist.rs      # Smart playlist generation
│   └── commands.rs      # NL command parsing
```

### Ollama Client (Rust)

```rust
// src-tauri/src/ollama/client.rs
use reqwest::Client;
use serde::{Deserialize, Serialize};

const OLLAMA_DEFAULT_URL: &str = "http://localhost:11434";

#[derive(Serialize)]
struct GenerateRequest {
    model: String,
    prompt: String,
    stream: bool,
    options: Option<GenerateOptions>,
}

#[derive(Serialize)]
struct GenerateOptions {
    temperature: f32,
    num_predict: i32,
}

#[derive(Deserialize)]
struct GenerateResponse {
    response: String,
}

pub struct OllamaClient {
    client: Client,
    base_url: String,
    model: String,
}

impl OllamaClient {
    pub fn new(model: &str) -> Self {
        Self {
            client: Client::new(),
            base_url: OLLAMA_DEFAULT_URL.to_string(),
            model: model.to_string(),
        }
    }

    pub async fn generate(&self, prompt: &str) -> Result<String, anyhow::Error> {
        let request = GenerateRequest {
            model: self.model.clone(),
            prompt: prompt.to_string(),
            stream: false,
            options: Some(GenerateOptions {
                temperature: 0.7,
                num_predict: 500,
            }),
        };

        let response = self.client
            .post(format!("{}/api/generate", self.base_url))
            .json(&request)
            .send()
            .await?
            .json::<GenerateResponse>()
            .await?;

        Ok(response.response)
    }

    pub async fn is_available(&self) -> bool {
        self.client
            .get(format!("{}/api/tags", self.base_url))
            .send()
            .await
            .is_ok()
    }
}
```

### Settings Extension

```rust
// Adăugare în models.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    // ... existing fields ...
    
    // Ollama settings
    pub ollama_enabled: bool,
    pub ollama_url: String,          // default: "http://localhost:11434"
    pub ollama_model: String,        // default: "llama3.2" sau "mistral"
    pub smart_search_enabled: bool,
    pub auto_tagging_enabled: bool,
}
```

### Frontend Integration

```tsx
// src/components/SmartSearch.tsx
import { invoke } from '@tauri-apps/api/core';

interface SmartSearchProps {
  onResults: (results: SearchResult[]) => void;
}

export function SmartSearch({ onResults }: SmartSearchProps) {
  const [query, setQuery] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSmartSearch = async () => {
    setIsProcessing(true);
    try {
      // LLM enhances query
      const enhancedQueries = await invoke<string[]>('enhance_search_query', { query });
      
      // Search YouTube with each enhanced query
      const allResults = await Promise.all(
        enhancedQueries.map(q => invoke<SearchResult[]>('search_youtube', { query: q }))
      );
      
      // Deduplicate and rank
      const uniqueResults = deduplicateResults(allResults.flat());
      onResults(uniqueResults);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Descrie ce vrei să asculți..."
        className="w-full bg-zinc-800 rounded-lg px-4 py-3"
      />
      {isProcessing && <Sparkles className="animate-spin" />}
    </div>
  );
}
```

---

## 📊 Modele Ollama Recomandate

| Model | Dimensiune | Use Case | Viteză |
|-------|-----------|----------|--------|
| **llama3.2:3b** | 2GB | Comenzi rapide, tagging | ⚡ Rapid |
| **mistral:7b** | 4GB | Echilibrat, toate funcțiile | ⚡⚡ Mediu |
| **llama3.1:8b** | 5GB | Înțelegere complexă | ⚡⚡⚡ Lent |
| **phi3:mini** | 2.3GB | Resource-constrained | ⚡ Rapid |

**Recomandare:** `mistral:7b` pentru echilibru calitate/viteză.

---

## 🔄 Plan de Implementare

### Faza 1: Infrastructură (1-2 zile)
- [ ] Creare modul `ollama/` în Rust
- [ ] Implementare client HTTP pentru Ollama API
- [ ] Adăugare setări în DB și UI
- [ ] Verificare disponibilitate Ollama la startup

### Faza 2: Smart Search (2-3 zile)
- [ ] Prompt engineering pentru expandare query
- [ ] Integrare în SearchView
- [ ] UI indicator "AI-enhanced search"
- [ ] Fallback la căutare normală dacă Ollama indisponibil

### Faza 3: Auto-Tagging (2-3 zile)
- [ ] Schema DB pentru metadata
- [ ] Background job pentru analiză track-uri
- [ ] UI pentru vizualizare/editare tags
- [ ] Filtrare library după mood/gen

### Faza 4: Smart Playlists (2-3 zile)
- [ ] UI pentru descriere playlist
- [ ] Algoritm selecție track-uri bazat pe metadata
- [ ] Preview înainte de salvare

### Faza 5: Polish & Optimization (1-2 zile)
- [ ] Caching răspunsuri LLM frecvente
- [ ] Batch processing pentru tagging
- [ ] Error handling robust
- [ ] Documentație utilizator

---

## ⚠️ Considerații

### Avantaje
✅ **Privacy complet** - toate datele rămân locale  
✅ **Fără costuri** - nu necesită API keys sau subscripții  
✅ **Offline capable** - funcționează fără internet (pentru funcții locale)  
✅ **Customizabil** - modele fine-tuned pentru muzică  

### Dezavantaje/Riscuri
❌ **Resurse hardware** - necesită 4-8GB RAM pentru model  
❌ **Latență** - 2-10 secunde per request (depinde de hardware)  
❌ **Instalare separată** - utilizatorul trebuie să instaleze Ollama  
❌ **Variabilitate output** - răspunsurile LLM nu sunt deterministe  

### Mitigări
- **Graceful degradation**: Toate funcțiile smart sunt opționale
- **Caching agresiv**: Memorare răspunsuri pentru query-uri similare
- **Timeout strict**: Max 10s per request, apoi fallback
- **UI feedback**: Progress indicators clari când AI procesează

---

## 🚀 Quick Start pentru Dezvoltare

```bash
# 1. Instalare Ollama
winget install Ollama.Ollama

# 2. Descărcare model
ollama pull mistral:7b

# 3. Verificare funcționare
ollama run mistral "Hello, test"

# 4. Server-ul Ollama rulează automat pe localhost:11434
```

---

## Concluzie

Integrarea Ollama în YTM-Free este **fezabilă și valoroasă**. Cele mai impactante funcții sunt:

1. **Smart Search** - îmbunătățește experiența de descoperire muzică
2. **Auto-Tagging** - permite filtrare și organizare automată
3. **Smart Playlists** - diferențiator major față de alte playere

Recomand începerea cu **Faza 1 + 2** pentru validare rapidă a conceptului.
