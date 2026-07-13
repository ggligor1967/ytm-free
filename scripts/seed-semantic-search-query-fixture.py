#!/usr/bin/env python3
"""Seed and verify the isolated semantic-search RUNTIME fixture.

This is a SEPARATE fixture from scripts/seed-semantic-fixture.py (which seeds 10
generic synthetic tracks with no metadata). This fixture seeds exactly 5
semantically distinct, named tracks WITH track_metadata so that the real
"quiet music for sleeping" query can be ranked by the real all-minilm embeddings
computed at runtime by the application's Re-index All command.

The application must create the canonical schema before this script runs.
This script never creates tables or runs migrations.

Modes:
  default (seed)  : requires --data-dir and --evidence-root
  --check-only     : probe the DB lock via BEGIN IMMEDIATE + ROLLBACK
  --verify-final   : assert 5 tracks, 5 embeddings, model all-minilm, settings
  --snapshot       : print the current DB state (no assertions) for evidence
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

EXPECTED_TABLES = {
    "schema_migrations",
    "settings",
    "tracks",
    "track_embeddings",
    "track_metadata",
}
TRACK_COUNT = 5
OLLAMA_URL = "http://127.0.0.1:11434"
EMBEDDING_MODEL = "all-minilm"

# Five semantically distinct tracks. The query "quiet music for sleeping" must
# rank "Calm Piano Sleep Meditation" at the top and "Aggressive Metal Gym
# Workout" last (or below the >0.3 cosine cutoff) once all-minilm embeddings are
# computed by the application at runtime.
TRACKS: list[dict[str, Any]] = [
    {
        "id": "00000000-0000-4000-8000-0000000000a1",
        "video_id": "semantic-search-calm-01",
        "title": "Calm Piano Sleep Meditation",
        "artist": "Serene Nights",
        "duration": 420,
        "metadata": {
            "genre": "Ambient",
            "mood": "Calm",
            "energy_level": 1,
            "tempo": "60 BPM",
            "decade": "2020s",
            "activity_tags": [
                "sleep",
                "meditation",
                "relaxation",
                "insomnia",
                "bedtime",
            ],
            "keywords": [
                "calm",
                "piano",
                "sleep",
                "meditation",
                "quiet",
                "gentle",
                "peaceful",
                "relax",
                "night",
                "lullaby",
            ],
            "ai_description": "A calm and quiet piano piece for sleep and meditation, with gentle peaceful melodies perfect for relaxation and falling asleep at night.",
        },
    },
    {
        "id": "00000000-0000-4000-8000-0000000000a2",
        "video_id": "semantic-search-metal-02",
        "title": "Aggressive Metal Gym Workout",
        "artist": "Iron Forge",
        "duration": 210,
        "metadata": {
            "genre": "Metal",
            "mood": "Aggressive",
            "energy_level": 10,
            "tempo": "180 BPM",
            "decade": "2010s",
            "activity_tags": ["gym", "workout", "running", "cardio", "lifting"],
            "keywords": [
                "aggressive",
                "metal",
                "gym",
                "workout",
                "intense",
                "heavy",
                "energy",
                "distortion",
                "fast",
            ],
            "ai_description": "Aggressive metal with heavy distorted guitars and fast drums, intense high-energy music for gym workouts and lifting.",
        },
    },
    {
        "id": "00000000-0000-4000-8000-0000000000a3",
        "video_id": "semantic-search-dance-03",
        "title": "Upbeat Summer Dance Party",
        "artist": "Neon Pulse",
        "duration": 198,
        "metadata": {
            "genre": "Dance",
            "mood": "Upbeat",
            "energy_level": 9,
            "tempo": "128 BPM",
            "decade": "2020s",
            "activity_tags": ["party", "dancing", "summer", "celebration", "festival"],
            "keywords": [
                "upbeat",
                "summer",
                "dance",
                "party",
                "energetic",
                "fun",
                "festival",
                "celebration",
            ],
            "ai_description": "Upbeat summer dance track with a fast infectious beat, energetic and fun, made for parties and dancing at summer festivals.",
        },
    },
    {
        "id": "00000000-0000-4000-8000-0000000000a4",
        "video_id": "semantic-search-acoustic-04",
        "title": "Melancholic Acoustic Rainy Evening",
        "artist": "Grey Window",
        "duration": 245,
        "metadata": {
            "genre": "Acoustic",
            "mood": "Melancholic",
            "energy_level": 2,
            "tempo": "72 BPM",
            "decade": "2010s",
            "activity_tags": [
                "rainy day",
                "reflection",
                "nostalgia",
                "lonely",
                "quiet evening",
            ],
            "keywords": [
                "melancholic",
                "acoustic",
                "rainy",
                "evening",
                "sad",
                "reflective",
                "lonely",
                "nostalgic",
                "quiet",
                "guitar",
            ],
            "ai_description": "A melancholic acoustic song for a rainy evening, quiet and reflective, with sad gentle guitar for lonely introspective nights.",
        },
    },
    {
        "id": "00000000-0000-4000-8000-0000000000a5",
        "video_id": "semantic-search-ambient-05",
        "title": "Instrumental Ambient Focus Coding",
        "artist": "Deep Flow",
        "duration": 360,
        "metadata": {
            "genre": "Ambient",
            "mood": "Focus",
            "energy_level": 3,
            "tempo": "90 BPM",
            "decade": "2020s",
            "activity_tags": ["coding", "focus", "studying", "work", "concentration"],
            "keywords": [
                "instrumental",
                "ambient",
                "focus",
                "coding",
                "work",
                "concentration",
                "productive",
                "calm",
                "steady",
            ],
            "ai_description": "Instrumental ambient music for focus and concentration while coding or studying, calm and unobtrusive for productive deep work.",
        },
    },
]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def require_canonical_schema(connection: sqlite3.Connection) -> list[int]:
    tables = {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }
    missing = sorted(EXPECTED_TABLES - tables)
    if missing:
        raise RuntimeError(
            f"Canonical schema is missing required tables: {', '.join(missing)}"
        )

    versions = [
        row[0]
        for row in connection.execute(
            "SELECT version FROM schema_migrations ORDER BY version"
        )
    ]
    if not versions or versions[0] != 0:
        raise RuntimeError(f"Canonical migration baseline is absent: {versions}")

    settings_count = connection.execute(
        "SELECT COUNT(*) FROM settings WHERE id = 1"
    ).fetchone()[0]
    if settings_count != 1:
        raise RuntimeError(
            f"Expected canonical settings row id=1, found {settings_count}"
        )

    return versions


def open_existing_database(data_dir: Path) -> tuple[Path, sqlite3.Connection]:
    database_path = data_dir / "ytm-free.db"
    if not database_path.is_file():
        raise RuntimeError(
            f"Application-created database does not exist: {database_path}"
        )

    connection = sqlite3.connect(database_path, timeout=5.0, isolation_level=None)
    connection.execute("PRAGMA foreign_keys = ON")
    return database_path, connection


def db_state(connection: sqlite3.Connection, database_path: Path) -> dict[str, Any]:
    versions = require_canonical_schema(connection)
    tracks = connection.execute("SELECT COUNT(*) FROM tracks").fetchone()[0]
    embeddings = connection.execute("SELECT COUNT(*) FROM track_embeddings").fetchone()[
        0
    ]
    models = [
        row[0]
        for row in connection.execute(
            "SELECT DISTINCT model_used FROM track_embeddings ORDER BY model_used"
        )
    ]
    settings = connection.execute(
        "SELECT ollama_enabled, ollama_url, semantic_search_enabled, embedding_model, auto_download "
        "FROM settings WHERE id = 1"
    ).fetchone()
    return {
        "database": str(database_path),
        "database_sha256": sha256_file(database_path),
        "schema_versions": versions,
        "tracks": tracks,
        "track_embeddings": embeddings,
        "model_used": models,
        "settings": {
            "ollama_enabled": bool(settings[0]),
            "ollama_url": settings[1],
            "semantic_search_enabled": bool(settings[2]),
            "embedding_model": settings[3],
            "auto_download": bool(settings[4]),
        },
    }


def check_unlock(data_dir: Path) -> dict[str, Any]:
    database_path, connection = open_existing_database(data_dir)
    try:
        versions = require_canonical_schema(connection)
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("ROLLBACK")
        return {
            "database": str(database_path),
            "schema_versions": versions,
            "begin_immediate_rollback": "PASS",
        }
    finally:
        connection.close()


def seed_fixture(data_dir: Path, evidence_root: Path) -> dict[str, Any]:
    database_path, connection = open_existing_database(data_dir)
    tracks_out: list[dict[str, Any]] = []
    try:
        versions = require_canonical_schema(connection)
        existing_tracks = connection.execute("SELECT COUNT(*) FROM tracks").fetchone()[
            0
        ]
        existing_embeddings = connection.execute(
            "SELECT COUNT(*) FROM track_embeddings"
        ).fetchone()[0]
        if existing_tracks != 0 or existing_embeddings != 0:
            raise RuntimeError(
                f"Fixture database is not empty: tracks={existing_tracks}, track_embeddings={existing_embeddings}"
            )

        connection.execute("BEGIN IMMEDIATE")
        try:
            connection.execute(
                """
                UPDATE settings
                SET ollama_enabled = 1,
                    ollama_url = ?,
                    semantic_search_enabled = 1,
                    embedding_model = ?,
                    auto_download = 0,
                    download_path = NULL
                WHERE id = 1
                """,
                (OLLAMA_URL, EMBEDDING_MODEL),
            )

            for track in TRACKS:
                meta = track["metadata"]
                connection.execute(
                    """
                    INSERT INTO tracks (
                        id, video_id, title, artist, thumbnail, duration, local_path,
                        is_downloaded, is_favorite, play_count
                    ) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, 0, 0)
                    """,
                    (
                        track["id"],
                        track["video_id"],
                        track["title"],
                        track["artist"],
                        f"https://example.invalid/{track['video_id']}.jpg",
                        track["duration"],
                    ),
                )
                # activity_tags and keywords are stored as compact JSON arrays of
                # strings, matching the application's save_track_metadata encoding
                # (serde_json::to_string). build_track_text concatenates these
                # strings into the embedding text.
                connection.execute(
                    """
                    INSERT INTO track_metadata (
                        track_id, genre, mood, energy_level, tempo, decade,
                        activity_tags, keywords, ai_description, model_used
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        track["id"],
                        meta["genre"],
                        meta["mood"],
                        meta["energy_level"],
                        meta["tempo"],
                        meta["decade"],
                        json.dumps(meta["activity_tags"], separators=(",", ":")),
                        json.dumps(meta["keywords"], separators=(",", ":")),
                        meta["ai_description"],
                        "manual-fixture",
                    ),
                )
                tracks_out.append(
                    {
                        "id": track["id"],
                        "video_id": track["video_id"],
                        "title": track["title"],
                        "artist": track["artist"],
                        "metadata": meta,
                    }
                )

            connection.execute("COMMIT")
        except BaseException:
            connection.execute("ROLLBACK")
            raise

        track_count = connection.execute("SELECT COUNT(*) FROM tracks").fetchone()[0]
        embedding_count = connection.execute(
            "SELECT COUNT(*) FROM track_embeddings"
        ).fetchone()[0]
        metadata_count = connection.execute(
            "SELECT COUNT(*) FROM track_metadata"
        ).fetchone()[0]
        if (
            track_count != TRACK_COUNT
            or embedding_count != 0
            or metadata_count != TRACK_COUNT
        ):
            raise RuntimeError(
                f"Unexpected post-seed counts: tracks={track_count}, "
                f"track_embeddings={embedding_count}, track_metadata={metadata_count}"
            )
        settings_after = connection.execute(
            "SELECT ollama_enabled, ollama_url, semantic_search_enabled, embedding_model, auto_download "
            "FROM settings WHERE id = 1"
        ).fetchone()
        if settings_after != (1, OLLAMA_URL, 1, EMBEDDING_MODEL, 0):
            raise RuntimeError(
                f"Unexpected semantic settings after seed: {settings_after}"
            )
    finally:
        connection.close()

    evidence_root.mkdir(parents=True, exist_ok=True)
    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "database": str(database_path),
        "database_sha256_after_seed": sha256_file(database_path),
        "schema_versions": versions,
        "ollama_url": OLLAMA_URL,
        "embedding_model": EMBEDDING_MODEL,
        "download": "prohibited",
        "spotify_data": "prohibited",
        "auto_download": "disabled",
        "track_count": TRACK_COUNT,
        "tracks": tracks_out,
    }
    manifest_path = evidence_root / "fixture-manifest.json"
    manifest_path.write_text(f"{json.dumps(manifest, indent=2)}\n", encoding="utf-8")
    manifest["manifest_path"] = str(manifest_path)
    manifest["manifest_sha256"] = sha256_file(manifest_path)
    return manifest


def verify_final(data_dir: Path) -> dict[str, Any]:
    database_path, connection = open_existing_database(data_dir)
    try:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("ROLLBACK")
        state = db_state(connection, database_path)
        if state["tracks"] != TRACK_COUNT:
            raise RuntimeError(
                f"Expected {TRACK_COUNT} tracks, found {state['tracks']}"
            )
        if state["track_embeddings"] != TRACK_COUNT:
            raise RuntimeError(
                f"Expected {TRACK_COUNT} track_embeddings, found {state['track_embeddings']}"
            )
        if state["model_used"] != [EMBEDDING_MODEL]:
            raise RuntimeError(
                f"Expected model_used={EMBEDDING_MODEL}, found {state['model_used']}"
            )
        if not (
            state["settings"]["ollama_enabled"]
            and state["settings"]["ollama_url"] == OLLAMA_URL
            and state["settings"]["semantic_search_enabled"]
            and state["settings"]["embedding_model"] == EMBEDDING_MODEL
            and not state["settings"]["auto_download"]
        ):
            raise RuntimeError(f"Unexpected semantic settings: {state['settings']}")
        state["begin_immediate_rollback"] = "PASS"
        return state
    finally:
        connection.close()


def snapshot(data_dir: Path) -> dict[str, Any]:
    database_path, connection = open_existing_database(data_dir)
    try:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("ROLLBACK")
        state = db_state(connection, database_path)
        state["begin_immediate_rollback"] = "PASS"
        return state
    finally:
        connection.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--evidence-root", type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check-only", action="store_true")
    mode.add_argument("--verify-final", action="store_true")
    mode.add_argument("--snapshot", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.check_only:
            result = check_unlock(args.data_dir)
        elif args.verify_final:
            result = verify_final(args.data_dir)
        elif args.snapshot:
            result = snapshot(args.data_dir)
        else:
            if args.evidence_root is None:
                raise RuntimeError("--evidence-root is required when seeding")
            result = seed_fixture(args.data_dir, args.evidence_root)
        print(json.dumps(result, indent=2))
        return 0
    except Exception as error:
        print(f"SEMANTIC_SEARCH_FIXTURE_ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
