#!/usr/bin/env python3
"""Seed and verify the isolated semantic runtime fixture.

The application must create the canonical schema before this script runs.
This script never creates tables or runs migrations.
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


EXPECTED_TABLES = {"schema_migrations", "settings", "tracks", "track_embeddings"}
TRACK_COUNT = 10
OLLAMA_URL = "http://127.0.0.1:11434"
EMBEDDING_MODEL = "all-minilm"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def require_canonical_schema(connection: sqlite3.Connection) -> list[int]:
    tables = {
        row[0]
        for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    missing = sorted(EXPECTED_TABLES - tables)
    if missing:
        raise RuntimeError(f"Canonical schema is missing required tables: {', '.join(missing)}")

    versions = [row[0] for row in connection.execute("SELECT version FROM schema_migrations ORDER BY version")]
    if not versions or versions[0] != 0:
        raise RuntimeError(f"Canonical migration baseline is absent: {versions}")

    settings_count = connection.execute("SELECT COUNT(*) FROM settings WHERE id = 1").fetchone()[0]
    if settings_count != 1:
        raise RuntimeError(f"Expected canonical settings row id=1, found {settings_count}")

    return versions


def open_existing_database(data_dir: Path) -> tuple[Path, sqlite3.Connection]:
    database_path = data_dir / "ytm-free.db"
    if not database_path.is_file():
        raise RuntimeError(f"Application-created database does not exist: {database_path}")

    connection = sqlite3.connect(database_path, timeout=5.0, isolation_level=None)
    connection.execute("PRAGMA foreign_keys = ON")
    return database_path, connection


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
    tracks: list[dict[str, str]] = []
    try:
        versions = require_canonical_schema(connection)
        existing_tracks = connection.execute("SELECT COUNT(*) FROM tracks").fetchone()[0]
        existing_embeddings = connection.execute("SELECT COUNT(*) FROM track_embeddings").fetchone()[0]
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

            for index in range(1, TRACK_COUNT + 1):
                track = {
                    "id": f"00000000-0000-4000-8000-{index:012d}",
                    "video_id": f"synthetic-semantic-{index:02d}",
                    "title": f"Synthetic Semantic Track {index:02d}",
                    "artist": f"Synthetic Artist {((index - 1) % 3) + 1}",
                }
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
                        180 + index,
                    ),
                )
                tracks.append(track)

            connection.execute("COMMIT")
        except BaseException:
            connection.execute("ROLLBACK")
            raise

        track_count = connection.execute("SELECT COUNT(*) FROM tracks").fetchone()[0]
        embedding_count = connection.execute("SELECT COUNT(*) FROM track_embeddings").fetchone()[0]
        if track_count != TRACK_COUNT or embedding_count != 0:
            raise RuntimeError(
                f"Unexpected post-seed counts: tracks={track_count}, track_embeddings={embedding_count}"
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
        "track_count": TRACK_COUNT,
        "tracks": tracks,
    }
    manifest_path = evidence_root / "fixture-manifest.json"
    manifest_path.write_text(f"{json.dumps(manifest, indent=2)}\n", encoding="utf-8")
    manifest["manifest_path"] = str(manifest_path)
    manifest["manifest_sha256"] = sha256_file(manifest_path)
    return manifest


def verify_final(data_dir: Path) -> dict[str, Any]:
    database_path, connection = open_existing_database(data_dir)
    try:
        versions = require_canonical_schema(connection)
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("ROLLBACK")
        tracks = connection.execute("SELECT COUNT(*) FROM tracks").fetchone()[0]
        embeddings = connection.execute("SELECT COUNT(*) FROM track_embeddings").fetchone()[0]
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

        if tracks != TRACK_COUNT:
            raise RuntimeError(f"Expected {TRACK_COUNT} tracks, found {tracks}")
        if embeddings != TRACK_COUNT:
            raise RuntimeError(f"Expected {TRACK_COUNT} track_embeddings, found {embeddings}")
        if models != [EMBEDDING_MODEL]:
            raise RuntimeError(f"Expected model_used={EMBEDDING_MODEL}, found {models}")
        if settings != (1, OLLAMA_URL, 1, EMBEDDING_MODEL, 0):
            raise RuntimeError(f"Unexpected semantic settings: {settings}")

        return {
            "database": str(database_path),
            "database_sha256": sha256_file(database_path),
            "schema_versions": versions,
            "tracks": tracks,
            "track_embeddings": embeddings,
            "model_used": models[0],
            "settings": {
                "ollama_enabled": bool(settings[0]),
                "ollama_url": settings[1],
                "semantic_search_enabled": bool(settings[2]),
                "embedding_model": settings[3],
                "auto_download": bool(settings[4]),
            },
            "begin_immediate_rollback": "PASS",
        }
    finally:
        connection.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--evidence-root", type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check-only", action="store_true")
    mode.add_argument("--verify-final", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.check_only:
            result = check_unlock(args.data_dir)
        elif args.verify_final:
            result = verify_final(args.data_dir)
        else:
            if args.evidence_root is None:
                raise RuntimeError("--evidence-root is required when seeding")
            result = seed_fixture(args.data_dir, args.evidence_root)
        print(json.dumps(result, indent=2))
        return 0
    except Exception as error:
        print(f"SEMANTIC_FIXTURE_ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
