"""
Migration: Fix danceability column type from INTEGER to REAL
"""
import sqlite3
import os

db_path = os.path.join(os.getenv('APPDATA'), 'ytm-free', 'ytm-free.db')
print(f"Database: {db_path}")

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

try:
    # Check current type
    cursor.execute("PRAGMA table_info(track_metadata)")
    columns = {col[1]: col[2] for col in cursor.fetchall()}
    print(f"Current danceability type: {columns.get('danceability', 'NOT FOUND')}")
    
    # SQLite doesn't support ALTER COLUMN TYPE, so we need to:
    # 1. Create new table with correct schema
    # 2. Copy data
    # 3. Drop old table
    # 4. Rename new table
    
    print("\nStarting migration...")
    
    # Create new table
    cursor.execute("""
        CREATE TABLE track_metadata_new (
            track_id TEXT PRIMARY KEY,
            genre TEXT,
            sub_genre TEXT,
            mood TEXT,
            energy_level INTEGER,
            tempo TEXT,
            danceability REAL,
            vocal_type TEXT,
            decade TEXT,
            language TEXT,
            activity_tags TEXT,
            occasion_tags TEXT,
            keywords TEXT,
            ai_description TEXT,
            analyzed_at TEXT DEFAULT CURRENT_TIMESTAMP,
            model_used TEXT,
            FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
        )
    """)
    print("✓ Created new table with REAL type")
    
    # Copy data
    cursor.execute("""
        INSERT INTO track_metadata_new
        SELECT * FROM track_metadata
    """)
    rows_copied = cursor.rowcount
    print(f"✓ Copied {rows_copied} rows")
    
    # Drop old table
    cursor.execute("DROP TABLE track_metadata")
    print("✓ Dropped old table")
    
    # Rename new table
    cursor.execute("ALTER TABLE track_metadata_new RENAME TO track_metadata")
    print("✓ Renamed new table")
    
    # Recreate indexes
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_track_metadata_genre ON track_metadata(genre)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_track_metadata_mood ON track_metadata(mood)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_track_metadata_energy ON track_metadata(energy_level)")
    print("✓ Recreated indexes")
    
    # Commit
    conn.commit()
    print("\n✅ Migration successful!")
    
    # Verify
    cursor.execute("PRAGMA table_info(track_metadata)")
    columns = {col[1]: col[2] for col in cursor.fetchall()}
    print(f"New danceability type: {columns.get('danceability', 'NOT FOUND')}")

except Exception as e:
    print(f"\n❌ Migration failed: {e}")
    conn.rollback()
finally:
    conn.close()
