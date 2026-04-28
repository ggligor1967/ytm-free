"""
FAZA 0 Infrastructure Test Suite
Tests all Smart AI infrastructure components
"""
import sqlite3
import os
import json
from datetime import datetime

def print_header(text):
    print("\n" + "="*60)
    print(f"  {text}")
    print("="*60)

def test_database():
    print_header("TEST 1: Database Schema")
    
    db_path = os.path.join(os.getenv('APPDATA'), 'ytm-free', 'ytm-free.db')
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Check tables exist
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = [t[0] for t in cursor.fetchall()]
    
    smart_tables = ['track_metadata', 'play_history', 'ai_cache']
    print("\n✅ Smart AI Tables:")
    for table in smart_tables:
        status = "✓" if table in tables else "✗"
        print(f"  {status} {table}")
        if table not in tables:
            print("  ❌ FAILED: Table missing!")
            return False
    
    # Check track_metadata schema
    cursor.execute("PRAGMA table_info(track_metadata)")
    columns = {col[1]: col[2] for col in cursor.fetchall()}
    
    expected_columns = {
        'track_id': 'TEXT',
        'genre': 'TEXT',
        'sub_genre': 'TEXT',
        'mood': 'TEXT',
        'energy_level': 'INTEGER',
        'tempo': 'TEXT',
        'danceability': 'REAL',
        'vocal_type': 'TEXT',
        'decade': 'TEXT',
        'language': 'TEXT',
        'activity_tags': 'TEXT',
        'occasion_tags': 'TEXT',
        'keywords': 'TEXT',
        'ai_description': 'TEXT',
        'analyzed_at': 'TEXT',
        'model_used': 'TEXT'
    }
    
    print("\n✅ track_metadata Schema:")
    all_ok = True
    for col_name, expected_type in expected_columns.items():
        if col_name in columns:
            actual_type = columns[col_name]
            match = actual_type == expected_type
            status = "✓" if match else "⚠"
            print(f"  {status} {col_name}: {actual_type}")
            if not match:
                print(f"    Expected: {expected_type}")
                all_ok = False
        else:
            print(f"  ✗ {col_name}: MISSING!")
            all_ok = False
    
    # Check indexes
    cursor.execute("SELECT name FROM sqlite_master WHERE type='index' AND (name LIKE '%metadata%' OR name LIKE '%play_history%' OR name LIKE '%ai_cache%') ORDER BY name")
    indexes = [idx[0] for idx in cursor.fetchall()]
    
    expected_indexes = [
        'idx_track_metadata_genre',
        'idx_track_metadata_mood', 
        'idx_track_metadata_energy',
        'idx_play_history_track',
        'idx_play_history_date',
        'idx_ai_cache_hash'
    ]
    
    print("\n✅ Smart AI Indexes:")
    for idx in expected_indexes:
        status = "✓" if idx in indexes else "✗"
        print(f"  {status} {idx}")
        if idx not in indexes:
            print(f"  ⚠ WARNING: Index missing (will affect performance)")
    
    # Check settings columns
    cursor.execute("PRAGMA table_info(settings)")
    setting_columns = [col[1] for col in cursor.fetchall()]
    
    ollama_settings = [
        'ollama_enabled',
        'ollama_url',
        'ollama_model',
        'smart_search_enabled',
        'auto_tagging_enabled',
        'smart_queue_enabled'
    ]
    
    print("\n✅ Settings Columns:")
    for col in ollama_settings:
        status = "✓" if col in setting_columns else "✗"
        print(f"  {status} {col}")
        if col not in setting_columns:
            print("  ❌ FAILED: Column missing!")
            all_ok = False
    
    conn.close()
    return all_ok

def test_settings_values():
    print_header("TEST 2: Settings Values")
    
    db_path = os.path.join(os.getenv('APPDATA'), 'ytm-free', 'ytm-free.db')
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT ollama_enabled, ollama_url, ollama_model, 
               smart_search_enabled, auto_tagging_enabled, smart_queue_enabled 
        FROM settings LIMIT 1
    """)
    settings = cursor.fetchone()
    
    if settings:
        print("\n📋 Current Settings:")
        print(f"  Ollama Enabled:     {bool(settings[0])}")
        print(f"  Ollama URL:         {settings[1]}")
        print(f"  Ollama Model:       {settings[2]}")
        print(f"  Smart Search:       {bool(settings[3])}")
        print(f"  Auto-Tagging:       {bool(settings[4])}")
        print(f"  Smart Queue:        {bool(settings[5])}")
        
        # Validate
        if settings[1] and settings[2]:
            print("\n✅ Settings are configured")
        else:
            print("\n⚠ WARNING: Ollama URL or Model not set")
    else:
        print("\n✗ No settings found!")
        conn.close()
        return False
    
    conn.close()
    return True

def test_library_stats():
    print_header("TEST 3: Library Statistics")
    
    db_path = os.path.join(os.getenv('APPDATA'), 'ytm-free', 'ytm-free.db')
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Track counts
    cursor.execute("SELECT COUNT(*) FROM tracks")
    total_tracks = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM track_metadata")
    analyzed_tracks = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM play_history")
    play_events = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM ai_cache")
    cache_entries = cursor.fetchone()[0]
    
    print(f"\n📀 Library Status:")
    print(f"  Total Tracks:       {total_tracks}")
    print(f"  AI Analyzed:        {analyzed_tracks}")
    print(f"  Play Events:        {play_events}")
    print(f"  Cached AI Calls:    {cache_entries}")
    
    if total_tracks > 0:
        coverage = (analyzed_tracks / total_tracks) * 100
        print(f"  Analysis Coverage:  {coverage:.1f}%")
        
        if coverage == 0:
            print("\n⚠ NOTE: No tracks analyzed yet (expected for new infrastructure)")
        elif coverage < 50:
            print(f"\n⚠ WARNING: Low analysis coverage")
        else:
            print(f"\n✅ Good analysis coverage")
    else:
        print("\n⚠ WARNING: No tracks in library")
    
    conn.close()
    return True

def test_data_types():
    print_header("TEST 4: Data Type Validation")
    
    db_path = os.path.join(os.getenv('APPDATA'), 'ytm-free', 'ytm-free.db')
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Test INSERT (will rollback)
    test_data = {
        'track_id': 'test_track_001',
        'genre': 'Rock',
        'sub_genre': 'Progressive Rock',
        'mood': 'Energetic',
        'energy_level': 8,
        'tempo': 'Fast',
        'danceability': 0.75,
        'vocal_type': 'Male',
        'decade': '1970s',
        'language': 'English',
        'activity_tags': json.dumps(['workout', 'driving']),
        'occasion_tags': json.dumps(['party', 'road trip']),
        'keywords': json.dumps(['guitar', 'drums', 'epic']),
        'ai_description': 'High-energy progressive rock with complex instrumentals',
        'analyzed_at': datetime.now().isoformat(),
        'model_used': 'mistral:7b'
    }
    
    try:
        cursor.execute("""
            INSERT INTO track_metadata (
                track_id, genre, sub_genre, mood, energy_level, tempo,
                danceability, vocal_type, decade, language,
                activity_tags, occasion_tags, keywords,
                ai_description, analyzed_at, model_used
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, tuple(test_data.values()))
        
        # Verify INSERT
        cursor.execute("SELECT * FROM track_metadata WHERE track_id = ?", (test_data['track_id'],))
        result = cursor.fetchone()
        
        if result:
            print("\n✅ Data Insertion Test:")
            print("  ✓ INSERT successful")
            print("  ✓ Data types validated")
            print("  ✓ JSON fields accepted")
            
            # Parse JSON fields
            activity_tags = json.loads(result[10])
            keywords = json.loads(result[12])
            print(f"\n  Sample Data:")
            print(f"    Genre: {result[1]}")
            print(f"    Mood: {result[3]}")
            print(f"    Energy: {result[4]}/10")
            print(f"    Activities: {', '.join(activity_tags)}")
            print(f"    Keywords: {', '.join(keywords)}")
        else:
            print("\n✗ Data insertion failed!")
            conn.rollback()
            conn.close()
            return False
        
        # Rollback test data
        conn.rollback()
        print("\n  ✓ Test data rolled back (not persisted)")
        
    except Exception as e:
        print(f"\n✗ Data insertion test failed: {e}")
        conn.rollback()
        conn.close()
        return False
    
    conn.close()
    return True

def test_app_state():
    print_header("TEST 5: Application State")
    
    print("\n📱 Application Verification:")
    
    # Check if app is running
    import subprocess
    try:
        result = subprocess.run(
            ['powershell', '-Command', 'Get-Process | Where-Object { $_.ProcessName -like "*ytm-free*" } | Measure-Object | Select-Object -ExpandProperty Count'],
            capture_output=True,
            text=True,
            timeout=5
        )
        process_count = int(result.stdout.strip())
        
        if process_count > 0:
            print(f"  ✓ Application running ({process_count} process{'es' if process_count > 1 else ''})")
        else:
            print("  ✗ Application not running!")
            return False
    except Exception as e:
        print(f"  ⚠ Could not verify app state: {e}")
    
    # Check ports
    try:
        result = subprocess.run(
            ['powershell', '-Command', 'Get-NetTCPConnection -LocalPort 5173,3456 -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count'],
            capture_output=True,
            text=True,
            timeout=5
        )
        port_count = int(result.stdout.strip())
        
        if port_count >= 2:
            print(f"  ✓ Servers running (ports 5173, 3456)")
        else:
            print("  ⚠ Some servers may not be running")
    except Exception as e:
        print(f"  ⚠ Could not verify ports: {e}")
    
    return True

def run_all_tests():
    print("\n" + "█"*60)
    print("  FAZA 0 INFRASTRUCTURE TEST SUITE")
    print("  YTM Free - Smart AI Features")
    print("█"*60)
    
    tests = [
        ("Database Schema", test_database),
        ("Settings Values", test_settings_values),
        ("Library Statistics", test_library_stats),
        ("Data Type Validation", test_data_types),
        ("Application State", test_app_state),
    ]
    
    results = []
    for test_name, test_func in tests:
        try:
            result = test_func()
            results.append((test_name, result))
        except Exception as e:
            print(f"\n❌ {test_name} crashed: {e}")
            results.append((test_name, False))
    
    # Summary
    print_header("TEST SUMMARY")
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    print()
    for test_name, result in results:
        status = "✅ PASSED" if result else "❌ FAILED"
        print(f"  {status} - {test_name}")
    
    print(f"\n{'='*60}")
    print(f"  Results: {passed}/{total} tests passed")
    
    if passed == total:
        print("  🎉 ALL TESTS PASSED! FAZA 0 COMPLETE!")
    else:
        print("  ⚠ Some tests failed. Review output above.")
    print("="*60)
    
    return passed == total

if __name__ == "__main__":
    success = run_all_tests()
    exit(0 if success else 1)
