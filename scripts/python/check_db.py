import sqlite3
import os

db_path = os.path.join(os.getenv('APPDATA'), 'ytm-free', 'ytm-free.db')
print(f"Database path: {db_path}")
print(f"Database exists: {os.path.exists(db_path)}")

if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Get all tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = [t[0] for t in cursor.fetchall()]
    
    print(f"\n✓ Total tables: {len(tables)}")
    print(f"Tables: {', '.join(tables)}")
    
    # Check Smart AI tables
    smart_tables = ['track_metadata', 'play_history', 'ai_cache']
    print(f"\n🧠 Smart AI Tables:")
    for table in smart_tables:
        exists = table in tables
        print(f"  {'✓' if exists else '✗'} {table}: {exists}")
    
    # Check settings columns
    cursor.execute("PRAGMA table_info(settings)")
    columns = [col[1] for col in cursor.fetchall()]
    print(f"\n⚙️ Settings columns:")
    smart_columns = ['ollama_enabled', 'ollama_url', 'ollama_model', 
                     'smart_search_enabled', 'auto_tagging_enabled', 'smart_queue_enabled']
    for col in smart_columns:
        exists = col in columns
        print(f"  {'✓' if exists else '✗'} {col}: {exists}")
    
    conn.close()
else:
    print("\n⚠️ Database not found!")
