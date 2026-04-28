# 🎙️ FAZA 11 — Trigger Engine Complet: 8 Trigger-uri Lipsă

**Obiectiv**: Implementarea celor 8 tipuri de trigger lipsă din specificația "AI Radio Host".

**Status Curent (verificat în cod)**:
- ✅ `TrackEnd` — există în `Player.tsx:265` (`handleEnded`) + prefetch la -20s (`handleTimeUpdate:128`)
- ✅ DJ commentary backend — `ai_dj_commentary` în `lib.rs:2925`, prompt `dj_commentary` în `prompts.rs:2251`
- ✅ DJ speech — `speakDjCommentary` via Web Speech API (`Player.tsx:224`), cu volume ducking la 15%
- ✅ DJ frequency control — `shouldDjSpeak()` (`Player.tsx:209`), bazat pe `settings.dj_frequency`
- ✅ DJ settings — `dj_mode_enabled`, `dj_style`, `dj_language`, `dj_frequency` în `Settings` type
- ⚠️ API mismatch — `api.ts:718` trimite `currentTrackId`/`nextTrackId`, dar `lib.rs:2930` așteaptă `prev_title`/`prev_artist`/`next_title`/`next_artist` (BUG EXISTENT)
- ❌ 8 trigger-uri lipsă: `TrackStart`, `QueueEmpty`, `LongSession`, `FirstTrackOfDay`, `Milestone`, `TimeAnnouncement`, `MoodShift`, `UserRequest`

---

## 1. Arhitectură: De ce Frontend-First

Trigger Engine-ul va fi implementat **în Frontend (React)**, nu în Rust, din următoarele motive concrete:

1. **Starea player-ului este în React** — `currentTrack`, `queue`, `queueIndex`, `isPlaying`, `progress`, `duration` sunt toate în Zustand store. Rust nu are acces la ele.
2. **Evenimentele audio sunt în browser** — `<audio onEnded>`, `onTimeUpdate`, `onLoadedMetadata` sunt DOM events. Nu există echivalent Rust.
3. **Web Speech API e browser-only** — `speakDjCommentary()` folosește `window.speechSynthesis`. Rust nu poate apela asta direct.
4. **Backend-ul rămâne generator de text** — Trimite context → primește commentary JSON. Pattern-ul existent `ai_dj_commentary` rămâne valid.

**Concret**: Se creează un hook `useTriggerEngine` care detectează condiții + apelează backend-ul pentru generare text + apelează `speakDjCommentary` existent din Player.

---

## 2. Precondiții / Bug-uri de Rezolvat ÎNAINTE

### BUG 1: API Mismatch `aiDjCommentary`

**Problema**: `api.ts:718` trimite `{ currentTrackId, nextTrackId, style, language }`, dar comanda Rust `ai_dj_commentary` la `lib.rs:2925` așteaptă parametri separați: `prev_title`, `prev_artist`, `prev_track_id`, `next_title`, `next_artist`, `next_track_id`, `style`, `language`, `model`.

**Fix necesar**: Alinierea `api.ts` cu semnătura reală din Rust. Player.tsx (linia ~295) trimite deja `currentId`/`nextId` dar api.ts le mapează greșit.

**Fișiere**: `src/api.ts` (linia 718-727)

### BUG 2: `handleEnded` face DJ commentary DOAR pe tranziții

Player.tsx:277-305 — logica DJ folosește `aiDjCommentary` care necesită `prev_track` + `next_track`. Pentru noile trigger-uri (TimeAnnouncement, LongSession, etc.) NU avem neapărat 2 piese.

**Fix necesar**: La Pasul 3 — noua comandă backend `ai_dj_event` va accepta un singur track + context, nu pereche.

---

## 3. Plan de Implementare

### Pasul 1: Fix API Mismatch + Comandă Nouă Backend

**Fișiere**: `lib.rs`, `prompts.rs`, `api.ts`

#### 1A. Fix `api.ts` — Aliniere cu semnătura Rust existentă

```typescript
// BEFORE (BUG):
export async function aiDjCommentary(
  currentTrackId: string, nextTrackId: string, style: string, language: string
): Promise<DjCommentary> {
  return invoke("ai_dj_commentary", { currentTrackId, nextTrackId, style, language });
}

// AFTER (FIX):
export async function aiDjCommentary(
  prevTitle: string, prevArtist: string, prevTrackId: string | null,
  nextTitle: string, nextArtist: string, nextTrackId: string | null,
  style?: string, language?: string, model?: string
): Promise<DjCommentary> {
  return invoke("ai_dj_commentary", {
    prevTitle, prevArtist, prevTrackId,
    nextTitle, nextArtist, nextTrackId,
    style, language, model,
  });
}
```

**IMPACT**: Necesită update și în `Player.tsx` unde se apelează `api.aiDjCommentary(...)`.

#### 1B. Comandă nouă `ai_dj_event` — pentru trigger-uri non-tranziție

**Fișier**: `lib.rs` — lângă `ai_dj_commentary` existent (linia ~2925)

```rust
#[derive(serde::Deserialize)]
pub struct DjEventContext {
    pub trigger_type: String,              // "track_start" | "queue_empty" | "long_session" | etc.
    pub current_title: Option<String>,
    pub current_artist: Option<String>,
    pub current_track_id: Option<String>,
    pub session_minutes: Option<u32>,      // pentru LongSession
    pub total_play_count: Option<u32>,     // pentru Milestone
    pub milestone_type: Option<String>,    // "total_tracks" | "artist_tracks" | "hours_listened"
    pub old_mood: Option<String>,          // pentru MoodShift
    pub new_mood: Option<String>,          // pentru MoodShift
    pub hour: Option<u8>,                  // pentru TimeAnnouncement
    pub style: Option<String>,
    pub language: Option<String>,
}

#[tauri::command]
async fn ai_dj_event(
    state: State<'_, AppState>,
    context: DjEventContext,
) -> Result<DjCommentary, String> { ... }
```

**Justificare**: Un singur command flexibil, nu câte un command per trigger (ar fi 8 comenzi noi inutile). `trigger_type` ca String (nu enum Rust) pentru simplitate la serializare din TS.

#### 1C. Prompt-uri noi în `prompts.rs`

8 funcții noi, adăugate după `dj_commentary` existent (linia ~2305):

| Funcție | Parametri | Output |
|---------|-----------|--------|
| `dj_track_start(title, artist, genre, mood, style, lang)` | Piesa curentă | Intro scurt la piesă |
| `dj_queue_empty(last_title, last_artist, style, lang)` | Ultima piesă | Încheiere sesiune |
| `dj_long_session(minutes, tracks_count, style, lang)` | Durata sesiunii | Menționare timp |
| `dj_first_track_of_day(title, artist, hour, day_of_week, style, lang)` | Prima piesă + context temporal | Salut de zi |
| `dj_milestone(milestone_type, count, title, artist, style, lang)` | Tipul + valoarea | Felicitare |
| `dj_time_announcement(hour, minute, title, artist, style, lang)` | Ora curentă | Anunț oră |
| `dj_mood_shift(old_mood, new_mood, prev_title, next_title, style, lang)` | 2 mood-uri | Comentariu tranziție |
| `dj_user_request(title, artist, genre, mood, user_question, style, lang)` | Piesa curentă + opțional întrebare | Comentariu liber |

Toate returnează același format JSON ca `dj_commentary`:
```json
{ "commentary": "...", "transition_type": "...", "energy": "..." }
```

---

### Pasul 2: TypeScript Types + API Wrappers

**Fișiere**: `types.ts`, `api.ts`

#### 2A. Tipuri noi în `types.ts` (după `DjCommentary` la linia ~620)

```typescript
export type DjTriggerType =
  | 'track_start'
  | 'queue_empty'
  | 'long_session'
  | 'first_track_of_day'
  | 'milestone'
  | 'time_announcement'
  | 'mood_shift'
  | 'user_request';

export interface DjEventContext {
  trigger_type: DjTriggerType;
  current_title?: string;
  current_artist?: string;
  current_track_id?: string;
  session_minutes?: number;
  total_play_count?: number;
  milestone_type?: string;
  old_mood?: string;
  new_mood?: string;
  hour?: number;
  style?: string;
  language?: string;
}

// Extindere Settings existente (câmpuri NOI):
// dj_triggers_enabled: Record<DjTriggerType, boolean>  — toggle per trigger
```

#### 2B. API wrapper în `api.ts` (după `aiDjCommentary`)

```typescript
export async function aiDjEvent(context: DjEventContext): Promise<DjCommentary> {
  return invoke("ai_dj_event", { context });
}
```

Un singur wrapper, nu 8. Context-ul determină comportamentul.

---

### Pasul 3: Frontend — `useTriggerEngine` Hook

**Fișier NOU**: `src/hooks/useTriggerEngine.ts`

Acest hook NU gestionează speech-ul (acela rămâne în Player.tsx via `speakDjCommentary`). Hook-ul doar **emite events** pe care Player-ul le consumă.

#### Stare internă în Zustand store (adăugare la `store.ts`):

```typescript
// DJ Trigger Engine state
djSessionStart: number | null;           // Date.now() la prima piesă din sesiune
djLastInterventionAt: number | null;     // Timestamp ultima intervenție
djInterventionCount: number;             // Câte intervenții în sesiunea curentă
djPendingEvent: DjEventContext | null;   // Event în așteptare de procesat
djPreviousTrackMood: string | null;      // Mood-ul piesei anterioare (pt MoodShift)
djTotalTracksSession: number;            // Track-uri ascultate în sesiune

// Actions:
setDjPendingEvent: (event: DjEventContext | null) => void;
incrementDjSessionTracks: () => void;
resetDjSession: () => void;
```

#### Logica per trigger (în `useTriggerEngine.ts`):

**TRIGGER 1: TrackStart**
```
useEffect pe currentTrack:
  DACĂ !dj_mode_enabled SAU !isPlaying → skip
  DACĂ trigger 'track_start' dezactivat în settings → skip
  DACĂ sessionTrackCount === 0 → REDIRECT la FirstTrackOfDay (nu duplica)
  DACĂ djLastInterventionAt < 3 piese în urmă → skip (cooldown din spec: 3 track-uri)
  ALTFEL 10% șansă random (nu la FIECARE piesă)
  → setDjPendingEvent({ trigger_type: 'track_start', ... })
```

**TRIGGER 2: QueueEmpty**
```
Detectare: NU în hook, CI în Player.tsx handleEnded():
  Condiție: isQueueEnd === true ȘI !smartQueueActive
  → setDjPendingEvent({ trigger_type: 'queue_empty', ... })
  DJ vorbește DUPĂ ultima piesă, nu înainte.
```

**TRIGGER 3: LongSession**
```
setInterval(checkLongSession, 60_000)  // la fiecare 60 secunde
  DACĂ djSessionStart === null → skip (nu rulează muzică)
  DACĂ !isPlaying → skip
  elapsed = Date.now() - djSessionStart
  DACĂ elapsed < 1_800_000 (30 min) → skip
  DACĂ djLastInterventionAt && (Date.now() - djLastInterventionAt) < 900_000 → skip (cooldown 15 min)
  → setDjPendingEvent({ trigger_type: 'long_session', session_minutes: Math.floor(elapsed / 60000) })
  fire doar O DATĂ per 30 min (nu continuu)
```

**TRIGGER 4: FirstTrackOfDay**
```
Se verifică la schimbarea currentTrack:
  DACĂ djTotalTracksSession > 0 → skip (nu e prima piesă)
  lastSessionTimestamp se citește din localStorage('dj_last_session_ts')
  DACĂ lastSessionTimestamp e din aceeași zi calendaristică → skip
  → setDjPendingEvent({ trigger_type: 'first_track_of_day', hour: new Date().getHours(), ... })
  Apoi salvează localStorage('dj_last_session_ts', Date.now())
```

Notă: NU depinde de o verificare DB (cum era scris vag în planul vechi). `localStorage` e suficient și imediat.

**TRIGGER 5: Milestone**
```
Se verifică la fiecare track_end (incrementDjSessionTracks):
  Necesită totalPlayCount din DB.
  PROBLEMĂ REALĂ: Nu avem o funcție API care returnează totalPlayCount global.
  SOLUȚIE: Adăugare comandă backend simplă:
    get_total_play_count() -> u32  (SELECT SUM(play_count) FROM tracks)
  
  Verificare:
    DACĂ totalPlayCount % 50 === 0 → milestone type "total_tracks_50"
    DACĂ totalPlayCount % 100 === 0 → milestone type "total_tracks_100"
    DACĂ totalPlayCount % 500 === 0 → milestone type "total_tracks_500"
  → setDjPendingEvent({ trigger_type: 'milestone', total_play_count, milestone_type })
```

**TRIGGER 6: TimeAnnouncement**
```
setInterval(checkTime, 30_000)  // la fiecare 30 sec (nu 60 — altfel ratezi :00)
  Condiție compusă:
    - isPlaying === true
    - new Date().getMinutes() === 0 (oră fixă)
    - Nu a mai fost anunțat în ultimele 55 minute (cooldown)
  Ore restrictive (din spec): doar 9, 12, 15, 18, 21 (nu fiecare oră — ar fi iritant)
  → setDjPendingEvent({ trigger_type: 'time_announcement', hour: now.getHours() })
```

**TRIGGER 7: MoodShift**
```
Se verifică la schimbarea currentTrack (după ce piesa anterioară se termină):
  oldMood = djPreviousTrackMood (din store)
  newMood = trackMetadata.get(currentTrackId)?.mood
  
  PROBLEMĂ: trackMetadata poate fi gol dacă piesa nu a fost analizată AI
  SOLUȚIE: skip dacă oricare mood este null/undefined
  
  DACĂ oldMood && newMood && areDifferentMoods(oldMood, newMood):
    → setDjPendingEvent({ trigger_type: 'mood_shift', old_mood, new_mood })
  
  Funcția areDifferentMoods: comparație simplă string !== string
  (NU încercăm "diferență semantică" — e over-engineering fără beneficiu real)
  
  Salvează newMood → djPreviousTrackMood
```

**TRIGGER 8: UserRequest**
```
Declanșare:
  A) Buton 🎙️ în Player.tsx (lângă butoanele existente: ❤️, ⬇️, ➕)
  B) Comandă din CommandBar: "/dj" sau "/talk"
  
  → apelează direct api.aiDjEvent({ trigger_type: 'user_request', ... })
  → speakDjCommentary(result.commentary)
  
  Nu trece prin pending event — e sincron la click.
```

#### Consumarea `djPendingEvent` în Player.tsx:

```typescript
useEffect(() => {
  if (!djPendingEvent) return;
  const event = djPendingEvent;
  setDjPendingEvent(null); // consumă imediat
  
  (async () => {
    try {
      const result = await api.aiDjEvent(event);
      await speakDjCommentary(result.commentary);
      // Update last intervention timestamp
      useAppStore.setState({ djLastInterventionAt: Date.now() });
    } catch (err) {
      console.error('DJ event failed:', err);
    }
  })();
}, [djPendingEvent]);
```

---

### Pasul 4: Cooldown System (Anti-Spam)

Specificația originală definește cooldown-uri. Implementare **centralizată** în hook:

```typescript
function canTrigger(type: DjTriggerType): boolean {
  const { djLastInterventionAt, djInterventionCount, isPlaying, settings } = useAppStore.getState();
  
  // Master kill-switch
  if (!settings?.dj_mode_enabled || !settings?.ollama_enabled || !isPlaying) return false;
  
  // Per-trigger toggle
  // settings.dj_triggers_enabled e opțional; default: toate active (backward compat)
  
  // Global cooldown: minim 60 sec între orice intervenție
  if (djLastInterventionAt && (Date.now() - djLastInterventionAt) < 60_000) return false;
  
  // Max per sesiune: 20 intervenții (previne spam)
  if (djInterventionCount >= 20) return false;
  
  return true;
}
```

---

### Pasul 5: Setări Noi

**Fișiere**: `types.ts`, `SettingsView.tsx`, `models.rs`

#### Adăugare la `Settings`:

```typescript
// types.ts — extindere Settings existente
dj_triggers_enabled: {
  track_start: boolean;
  queue_empty: boolean;
  long_session: boolean;
  first_track_of_day: boolean;
  milestone: boolean;
  time_announcement: boolean;
  mood_shift: boolean;
  user_request: boolean;
};
```

**Backward-compat**: Dacă câmpul lipsește (settings vechi), default = `true` pentru toate.

#### UI în SettingsView.tsx — Sub secțiunea DJ existentă:

Toggle individual per trigger cu label descriptiv:
- 🎬 Introducere piese (TrackStart)
- 🏁 Final playlist (QueueEmpty)
- ⏰ Sesiune lungă (LongSession)
- 🌅 Salut de dimineață (FirstTrackOfDay)
- 🏆 Milestones (Milestone)
- 🕐 Anunț oră (TimeAnnouncement)
- 🎭 Schimbare mood (MoodShift)
- 🎙️ La cerere (UserRequest) — acest toggle nu apare, e mereu activ

---

### Pasul 6: Backend — Comandă `get_total_play_count`

**Fișier**: `lib.rs`, `db.rs`

Necesar pentru trigger-ul Milestone. Funcție minimă:

```rust
// db.rs
pub fn get_total_play_count(&self) -> Result<u32, rusqlite::Error> {
    self.conn.query_row(
        "SELECT COALESCE(SUM(play_count), 0) FROM tracks",
        [],
        |row| row.get(0),
    )
}

// lib.rs
#[tauri::command]
async fn get_total_play_count(state: State<'_, AppState>) -> Result<u32, String> {
    let db = state.db.lock().await;
    db.get_total_play_count().map_err(|e| e.to_string())
}
```

---

## 4. Ordinea Execuției (Pași concreți)

| Pas | Fișiere | Descriere | Dependențe |
|-----|---------|-----------|------------|
| 1 | `api.ts`, `Player.tsx` | Fix API mismatch `aiDjCommentary` | Niciuna |
| 2 | `db.rs`, `lib.rs` | `get_total_play_count` + înregistrare în handler | Niciuna |
| 3 | `prompts.rs` | 8 funcții noi de prompt | Niciuna |
| 4 | `lib.rs` | Command `ai_dj_event` + struct `DjEventContext` | Pas 3 |
| 5 | `types.ts` | `DjTriggerType`, `DjEventContext`, extensie `Settings` | Niciuna |
| 6 | `api.ts` | Wrapper `aiDjEvent` + `getTotalPlayCount` | Pas 4-5 |
| 7 | `store.ts` | State DJ session (start, count, pending, previous mood) | Pas 5 |
| 8 | `src/hooks/useTriggerEngine.ts` | Hook complet cu logica celor 8 trigger-uri | Pas 6-7 |
| 9 | `Player.tsx` | Consumare `djPendingEvent` + buton UserRequest 🎙️ + integrare hook | Pas 8 |
| 10 | `SettingsView.tsx` | Toggle-uri per trigger | Pas 5 |
| 11 | `lib.rs` | Înregistrare `ai_dj_event` + `get_total_play_count` în invoke_handler | Pas 2, 4 |

---

## 5. Ce NU se implementează (și de ce)

| Element din spec | Motiv excludere |
|-----------------|-----------------|
| TTS Engine (Piper/Coqui) | Deja există Web Speech API funcțional. Piper ar necesita download ~50MB per voce + binary extern. Over-engineering. |
| Knowledge Base (DB tables) | Ollama generează fapte din training data. Nu avem un web scraper. Tabelele ar rămâne goale. |
| State Machine (RadioHostState enum) | Hook-ul React + `djPendingEvent` rezolvă mai simplu. O state machine Rust nu are ce gestiona fără TTS. |
| Personalities (alex, luna, max) | `dj_style` existent (classic_fm, hype, chill, fun, storyteller) acoperă deja asta. Duplicare. |
| RadioHostWidget.tsx (component separat) | DJ-ul vorbește prin Player existent. Un widget separat nu adaugă valoare. |
| `radio_host/` module Rust | Nu se creează module nou. Se extinde `ai_dj_commentary`/`prompts.rs` existent. |
| Quiet Hours | Se poate adăuga ulterior trivial (verificare oră în `canTrigger`). Nu e parte din cele 8 trigger-uri. |
| `rodio`/`cpal` dependencies | Nu sunt necesare fără Piper TTS. Web Speech API nu necesită dependențe Rust. |

---

## 6. Estimare Realistă

| Pas | Durată | Complexitate |
|-----|--------|-------------|
| Fix API mismatch | 15 min | Trivial |
| `get_total_play_count` | 10 min | Trivial |
| 8 prompt-uri noi | 45 min | Medium (text/format) |
| Command `ai_dj_event` | 30 min | Medium |
| Types + API TS | 15 min | Trivial |
| Store extensions | 15 min | Trivial |
| `useTriggerEngine` hook | 90 min | Complex (8 logici, cooldown, intervals) |
| Player.tsx integrare | 30 min | Medium |
| Settings UI toggles | 20 min | Trivial |
| Testare + debug | 60 min | Medium |
| **TOTAL** | **~5-6 ore** | — |

---

## 7. Riscuri Identificate

| Risc | Probabilitate | Impact | Mitigare |
|------|--------------|--------|----------|
| Ollama timeout la prompt-urile noi | Medium | DJ nu vorbește | try/catch cu timeout 10s, skip silențios |
| Web Speech API indisponibil (Linux) | Low | Fără voce | Afișare text ca toast fallback |
| Milestone false-pozitive (play_count increment la seek) | Low | DJ vorbește prematur | play_count se incrementează doar la `handleLoadedMetadata`, nu la seek |
| LongSession interval leak (memory) | Medium | Interval rămâne activ | cleanup în `useEffect` return |
| TrackStart + FirstTrackOfDay se declanșează ambele | Medium | Dublu speech | FirstTrackOfDay are prioritate, TrackStart skip dacă sessionsTrack === 0 |
