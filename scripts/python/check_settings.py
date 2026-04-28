import sqlite3
import os
import json

db_path = os.path.join(os.getenv('APPDATA'), 'ytm-free', 'ytm-free.db')
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Check settings values
cursor.execute("SELECT ollama_enabled, ollama_url, ollama_model, smart_search_enabled, auto_tagging_enabled, smart_queue_enabled FROM settings LIMIT 1")
settings = cursor.fetchone()

print("🔧 Current Ollama Settings:")
if settings:
    print(f"  Ollama Enabled: {bool(settings[0])}")
    print(f"  Ollama URL: {settings[1]}")
    print(f"  Ollama Model: {settings[2]}")
    print(f"  Smart Search: {bool(settings[3])}")
    print(f"  Auto-Tagging: {bool(settings[4])}")
    print(f"  Smart Queue: {bool(settings[5])}")
else:
    print("  No settings found (using defaults)")

# Check indexes
cursor.execute("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE '%metadata%' OR name LIKE '%play_history%' OR name LIKE '%ai_cache%' ORDER BY name")
indexes = [idx[0] for idx in cursor.fetchall()]
print(f"\n📊 Smart AI Indexes ({len(indexes)}):")
for idx in indexes:
    print(f"  • {idx}")

# Get track counts
cursor.execute("SELECT COUNT(*) FROM tracks")
track_count = cursor.fetchone()[0]
cursor.execute("SELECT COUNT(*) FROM track_metadata")
analyzed_count = cursor.fetchone()[0]

print(f"\n📀 Library Status:")
print(f"  Total tracks: {track_count}")
print(f"  AI analyzed: {analyzed_count}")
if track_count > 0:
    print(f"  Analysis coverage: {(analyzed_count/track_count)*100:.1f}%")

conn.close()
