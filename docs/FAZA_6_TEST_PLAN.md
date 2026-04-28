# FAZA 6 — Analiză, Insight-uri & Recomandări — Plan de Testare

**Data:** 12 Februarie 2026  
**Status:** 🔄 TESTARE ÎN CURS (verificări automate PASS, UI manual pending)  
**Prerequisite:** Ollama activ, model configurat, tracks în library (cu metadata), `npm run tauri dev` running

---

## 📋 Prerequisite

- [x] Ollama activat (`ollama_enabled=1`) — verificat cu `check_settings.py`
- [x] Model activ: `deepseek-v3.1:671b-cloud`
- [x] Tracks în library (minim 5-10) — 174 tracks
- [x] Tracks cu metadata AI (tagged) — 162 tracks (93.1%)
- [x] Minim câteva tracks cu `play_count > 0` — 58 tracks
- [x] Minim câteva tracks marcate favorite — 5 tracks
- [x] App pornit cu `npm run tauri dev` (proces activ)

### ✅ Verificări automate executate (12 Feb 2026)

1. `python check_settings.py` → PASS (Ollama + feature toggles active)
2. `python check_db.py` → PASS (DB schema + smart tables prezente)
3. `cargo check` → PASS (fără erori, doar warnings existente)
4. `npx tsc --noEmit` → ⚠️ 4 erori pre-existente (în `Player.tsx` și `LibraryView.tsx`, nelegate de FAZA 6)

---

## Teste Navigare & UI

### T6-1: Sidebar — Insights Nav Item
**Acțiune:** Verifică sidebar-ul conține "Insights" cu icon BarChart3  
**Rezultat așteptat:** Între "Smart Queue" și "Favorites" apare "Insights"  
**Status:** ⬜ PENDING

### T6-2: Navigare → Insights View
**Acțiune:** Click "Insights" în sidebar  
**Rezultat așteptat:** Se deschide InsightsView cu header "Insights & Analytics", 4 tab-uri vizibile  
**Status:** ⬜ PENDING

### T6-3: Tab-uri funcționale
**Acțiune:** Click pe fiecare tab: Prezentare, Profil AI, Descoperă, Explorează  
**Rezultat așteptat:** Conținutul se schimbă corespunzător, tab activ are culoare purple  
**Status:** ⬜ PENDING

---

## Tab: Prezentare (Overview)

### T6-4: Stat Cards — Date Load Automat
**Acțiune:** Deschide Insights (tab Prezentare)  
**Rezultat așteptat:** 4 cards apar automat: Tracks (count), Total Time, Streak (days), Top Genre  
**Status:** ⬜ PENDING

### T6-5: Hourly Breakdown Chart
**Acțiune:** Verifică chart-ul "Listening by Hour"  
**Rezultat așteptat:** 24 bare verticale gradient purple, hover pe bară arată tooltip cu ora și nr plays  
**Status:** ⬜ PENDING

### T6-6: Top Artists / Top Genres Charts
**Acțiune:** Verifică secțiunile "Top Artists" și "Top Genres"  
**Rezultat așteptat:** Bar charts orizontale cu progress bars, max 5 entries, sortate descrescător  
**Status:** ⬜ PENDING

### T6-7: Top Tracks (30 days)
**Acțiune:** Verifică secțiunea "Top Tracks"  
**Rezultat așteptat:** Lista top 5 tracks cu thumbnail, titlu, artist, play count, numerotate #1-#5  
**Status:** ⬜ PENDING

### T6-8: Refresh Button
**Acțiune:** Click butonul Refresh (↻) din header  
**Rezultat așteptat:** Stats se re-încarcă, icon se rotește (animate-spin), date se actualizează  
**Status:** ⬜ PENDING

### T6-9: Weekly Summary (AI)
**Acțiune:** Click butonul "Generate" pe cardul "Weekly Summary"  
**Rezultat așteptat:** Loader "AI is thinking...", apoi apare: summary text + 3 mini-cards (Highlight, Trend, Tip)  
**Status:** ⬜ PENDING

### T6-10: Time Patterns (AI)
**Acțiune:** Click "Generate" pe cardul "Time Patterns"  
**Rezultat așteptat:** Pattern name (purple), insight text, badge-uri cu peak hours (🔥) și quiet hours (🌙)  
**Status:** ⬜ PENDING

---

## Tab: Profil AI

### T6-11: Music Personality
**Acțiune:** Click tab "Profil AI" → Click "Analyze My Profile"  
**Rezultat așteptat:** Loader, apoi badge gradient cu personality name (ex: "The Eclectic Explorer"), text detaliat  
**Status:** ⬜ PENDING

### T6-12: Mood & Genre Breakdown
**Acțiune:** Verifică sub personality secțiunile "Your Moods" și "Your Genres"  
**Rezultat așteptat:** Bar charts din stats (populate dacă tracks au metadata)  
**Status:** ⬜ PENDING

### T6-13: Ollama dezactivat — Mesaj corespunzător
**Acțiune:** Dezactivează Ollama din Settings → Navighează la Profil AI  
**Rezultat așteptat:** Mesaj "Ollama AI is not available. Enable it in Settings..."  
**Status:** ⬜ PENDING

---

## Tab: Descoperă

### T6-14: Forgotten Gems 💎
**Acțiune:** Click tab "Descoperă" → "Find Hidden Gems"  
**Rezultat așteptat:** Lista de tracks neascultate recent cu emoji 💎, motiv per track, mesaj general  
**Nota:** Dacă nu sunt gems (toate ascultate recent), mesaj "No forgotten gems found"  
**Status:** ⬜ PENDING

### T6-15: Because You Liked ❤️
**Acțiune:** Click "Get Recommendations"  
**Rezultat așteptat:** Insight text italic + lista de recomandări cu titlu, artist, motiv, buton search (hover)  
**Nota:** Necesită minim 1 track favorite. Fără favorites → eroare clară  
**Status:** ⬜ PENDING

### T6-16: Recommendation → Search
**Acțiune:** Hover pe o recomandare din Because You Liked → Click butonul 🎵 (search)  
**Rezultat așteptat:** Navighează la Search view cu query pre-completat cu search_query din recomandare  
**Status:** ⬜ PENDING

### T6-17: Surprise Me! 🎲
**Acțiune:** Click "Surprise Me!"  
**Rezultat așteptat:** Theme text, lista de surprize cu titlu/artist, motiv why_surprise, badge genre  
**Status:** ⬜ PENDING

### T6-18: Seasonal Picks 🍂
**Acțiune:** Click "Get Seasonal Picks"  
**Rezultat așteptat:** Badge-uri season + mood, lista recomandări cu seasonal_fit, buton search per track  
**Nota:** Season detectat automat din data curentă (Feb = Winter)  
**Status:** ⬜ PENDING

---

## Tab: Explorează

### T6-19: Artist Deep Dive
**Acțiune:** Scrie "Led Zeppelin" în câmpul Artist → Click "Explore" (sau Enter)  
**Rezultat așteptat:** Bio detaliat, Essential Albums, Recommended Tracks, Similar Artists, Fun Fact (💡)  
**Status:** ⬜ PENDING

### T6-20: Artist Deep Dive — Input Gol
**Acțiune:** Click "Explore" cu input gol  
**Rezultat așteptat:** Butonul disabled (opacity-50), nu se trimite request  
**Status:** ⬜ PENDING

### T6-21: Genre Explorer
**Acțiune:** Scrie "Progressive Rock" → Click "Explore"  
**Rezultat așteptat:** Description, Sub-genres, Legendary Artists, Essential Tracks, Related Genres  
**Status:** ⬜ PENDING

### T6-22: Genre Explorer — Enter key
**Acțiune:** Scrie un gen → Apasă Enter  
**Rezultat așteptat:** Se declanșează explore (nu doar la click pe buton)  
**Status:** ⬜ PENDING

---

## Teste Edge Cases

### T6-23: Library goală — Stats
**Acțiune:** (Cu library goală) Navighează la Insights  
**Rezultat așteptat:** Stats se încarcă dar cu valori 0, charts goale, fără crash  
**Status:** ⬜ PENDING

### T6-24: Eroare AI — Mesaj vizibil
**Acțiune:** Oprește Ollama → Click "Generate" pe orice card AI  
**Rezultat așteptat:** Banner roșu cu mesajul de eroare, buton "dismiss" funcțional  
**Status:** ⬜ PENDING

### T6-25: Refresh AI Cards
**Acțiune:** După generare reușită, click "Refresh" pe un card AI  
**Rezultat așteptat:** Conținutul se regenerează (butonul devine "Refresh" după prima generare)  
**Status:** ⬜ PENDING

### T6-26: Multiple AI Requests
**Acțiune:** Click rapid pe Generate pe 2-3 cards diferite  
**Rezultat așteptat:** Fiecare card arată loader independent, nu se blochează între ele  
**Status:** ⬜ PENDING

---

## Rezumat

| Categorie | Teste | Passed |
|-----------|-------|--------|
| Verificări automate | Setup + Build | ✅ 3/4 *(1 cu erori pre-existente)* |
| Navigare & UI | T6-1 → T6-3 | ⬜ /3 |
| Tab Prezentare | T6-4 → T6-10 | ⬜ /7 |
| Tab Profil AI | T6-11 → T6-13 | ⬜ /3 |
| Tab Descoperă | T6-14 → T6-18 | ⬜ /5 |
| Tab Explorează | T6-19 → T6-22 | ⬜ /4 |
| Edge Cases | T6-23 → T6-26 | ⬜ /4 |
| **TOTAL** | **26 UI teste + 4 automate** | **UI: ⬜ /26 · Auto: ✅ 3/4** |
