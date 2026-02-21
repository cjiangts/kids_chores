#!/usr/bin/env python3
"""Validate local DB state with manual integrity checks (FK-like + duplicate rules)."""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import duckdb


SCRIPT_PATH = Path(__file__).resolve()
BACKEND_DIR = SCRIPT_PATH.parent.parent
PROJECT_DIR = BACKEND_DIR.parent
DEFAULT_KIDS_JSON = BACKEND_DIR / "data" / "kids.json"
DEFAULT_SHARED_DB = BACKEND_DIR / "data" / "shared_decks.duckdb"


@dataclass
class CheckFailure:
    db_path: Path
    check_name: str
    count: int
    sample: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate kid/shared DuckDB integrity without relying on FK constraints."
    )
    parser.add_argument(
        "--kid-db",
        action="append",
        default=[],
        help="Path to one kid DB file. May be repeated.",
    )
    parser.add_argument(
        "--all-kids",
        action="store_true",
        help="Include all kid DB paths from kids.json.",
    )
    parser.add_argument(
        "--kids-json",
        default=str(DEFAULT_KIDS_JSON),
        help=f"Path to kids metadata JSON (default: {DEFAULT_KIDS_JSON}).",
    )
    parser.add_argument(
        "--shared-db",
        default=str(DEFAULT_SHARED_DB),
        help=f"Path to shared deck DB (default: {DEFAULT_SHARED_DB}).",
    )
    parser.add_argument(
        "--skip-kids",
        action="store_true",
        help="Skip kid DB validation.",
    )
    parser.add_argument(
        "--skip-shared",
        action="store_true",
        help="Skip shared DB validation.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit JSON report.",
    )
    return parser.parse_args()


def resolve_metadata_db_path(raw_path: str) -> Path:
    text = str(raw_path or "").strip()
    if not text:
        raise ValueError("Empty dbFilePath")
    if os.path.isabs(text):
        return Path(text)
    rel = text.lstrip("/\\")
    if rel.startswith("data/"):
        rel = rel[5:]
    return BACKEND_DIR / "data" / rel


def load_kid_db_paths_from_kids_json(kids_json_path: Path) -> list[Path]:
    if not kids_json_path.exists():
        raise FileNotFoundError(f"kids.json not found: {kids_json_path}")
    payload = json.loads(kids_json_path.read_text(encoding="utf-8"))
    paths: list[Path] = []
    for kid in payload.get("kids", []):
        db_file_path = kid.get("dbFilePath")
        if not db_file_path:
            continue
        paths.append(resolve_metadata_db_path(str(db_file_path)))
    return paths


def normalize_input_paths(raw_paths: Iterable[str]) -> list[Path]:
    resolved: list[Path] = []
    for raw in raw_paths:
        text = str(raw or "").strip()
        if not text:
            continue
        p = Path(text)
        if not p.is_absolute():
            p = (PROJECT_DIR / p).resolve()
        resolved.append(p)
    return resolved


def dedupe_paths(paths: Iterable[Path]) -> list[Path]:
    seen = set()
    ordered: list[Path] = []
    for p in paths:
        key = str(p.resolve())
        if key in seen:
            continue
        seen.add(key)
        ordered.append(Path(key))
    return ordered


def fetch_count_and_sample(
    conn: duckdb.DuckDBPyConnection,
    count_sql: str,
    sample_sql: str,
) -> tuple[int, str]:
    count = int(conn.execute(count_sql).fetchone()[0] or 0)
    if count <= 0:
        return 0, ""
    sample_row = conn.execute(sample_sql).fetchone()
    if not sample_row:
        return count, ""
    return count, " | ".join(str(value) for value in sample_row)


def validate_kid_db(db_path: Path) -> tuple[list[CheckFailure], str | None]:
    if not db_path.exists():
        return [], f"missing file: {db_path}"
    failures: list[CheckFailure] = []
    conn = duckdb.connect(str(db_path), read_only=True)
    try:
        checks = [
            (
                "cards.deck_id references decks.id",
                """
                SELECT COUNT(*)
                FROM cards c
                LEFT JOIN decks d ON d.id = c.deck_id
                WHERE c.deck_id IS NOT NULL AND d.id IS NULL
                """,
                """
                SELECT c.id, c.deck_id
                FROM cards c
                LEFT JOIN decks d ON d.id = c.deck_id
                WHERE c.deck_id IS NOT NULL AND d.id IS NULL
                LIMIT 1
                """,
            ),
            (
                "sessions.deck_id references decks.id",
                """
                SELECT COUNT(*)
                FROM sessions s
                LEFT JOIN decks d ON d.id = s.deck_id
                WHERE s.deck_id IS NOT NULL AND d.id IS NULL
                """,
                """
                SELECT s.id, s.deck_id
                FROM sessions s
                LEFT JOIN decks d ON d.id = s.deck_id
                WHERE s.deck_id IS NOT NULL AND d.id IS NULL
                LIMIT 1
                """,
            ),
            (
                "session_results.session_id references sessions.id",
                """
                SELECT COUNT(*)
                FROM session_results sr
                LEFT JOIN sessions s ON s.id = sr.session_id
                WHERE s.id IS NULL
                """,
                """
                SELECT sr.id, sr.session_id
                FROM session_results sr
                LEFT JOIN sessions s ON s.id = sr.session_id
                WHERE s.id IS NULL
                LIMIT 1
                """,
            ),
            (
                "session_results.card_id references cards.id",
                """
                SELECT COUNT(*)
                FROM session_results sr
                LEFT JOIN cards c ON c.id = sr.card_id
                WHERE c.id IS NULL
                """,
                """
                SELECT sr.id, sr.card_id
                FROM session_results sr
                LEFT JOIN cards c ON c.id = sr.card_id
                WHERE c.id IS NULL
                LIMIT 1
                """,
            ),
            (
                "writing_audio.card_id references cards.id",
                """
                SELECT COUNT(*)
                FROM writing_audio wa
                LEFT JOIN cards c ON c.id = wa.card_id
                WHERE c.id IS NULL
                """,
                """
                SELECT wa.card_id, wa.file_name
                FROM writing_audio wa
                LEFT JOIN cards c ON c.id = wa.card_id
                WHERE c.id IS NULL
                LIMIT 1
                """,
            ),
            (
                "writing_sheet_cards.sheet_id references writing_sheets.id",
                """
                SELECT COUNT(*)
                FROM writing_sheet_cards wsc
                LEFT JOIN writing_sheets ws ON ws.id = wsc.sheet_id
                WHERE ws.id IS NULL
                """,
                """
                SELECT wsc.sheet_id, wsc.card_id
                FROM writing_sheet_cards wsc
                LEFT JOIN writing_sheets ws ON ws.id = wsc.sheet_id
                WHERE ws.id IS NULL
                LIMIT 1
                """,
            ),
            (
                "writing_sheet_cards.card_id references cards.id",
                """
                SELECT COUNT(*)
                FROM writing_sheet_cards wsc
                LEFT JOIN cards c ON c.id = wsc.card_id
                WHERE c.id IS NULL
                """,
                """
                SELECT wsc.sheet_id, wsc.card_id
                FROM writing_sheet_cards wsc
                LEFT JOIN cards c ON c.id = wsc.card_id
                WHERE c.id IS NULL
                LIMIT 1
                """,
            ),
            (
                "duplicate cards by (deck_id, front)",
                """
                SELECT COUNT(*)
                FROM (
                  SELECT deck_id, front
                  FROM cards
                  GROUP BY deck_id, front
                  HAVING COUNT(*) > 1
                ) t
                """,
                """
                SELECT deck_id, front, COUNT(*) AS cnt
                FROM cards
                GROUP BY deck_id, front
                HAVING COUNT(*) > 1
                ORDER BY cnt DESC, deck_id ASC
                LIMIT 1
                """,
            ),
            (
                "duplicate materialized shared deck names",
                """
                SELECT COUNT(*)
                FROM (
                  SELECT name
                  FROM decks
                  WHERE name LIKE 'shared_deck_%'
                  GROUP BY name
                  HAVING COUNT(*) > 1
                ) t
                """,
                """
                SELECT name, COUNT(*) AS cnt
                FROM decks
                WHERE name LIKE 'shared_deck_%'
                GROUP BY name
                HAVING COUNT(*) > 1
                ORDER BY cnt DESC, name ASC
                LIMIT 1
                """,
            ),
            (
                "more than one math_orphan deck",
                """
                SELECT CASE WHEN COUNT(*) > 1 THEN COUNT(*) ELSE 0 END
                FROM decks
                WHERE name = 'math_orphan'
                """,
                """
                SELECT COUNT(*)
                FROM decks
                WHERE name = 'math_orphan'
                """,
            ),
        ]

        for check_name, count_sql, sample_sql in checks:
            count, sample = fetch_count_and_sample(conn, count_sql, sample_sql)
            if count > 0:
                failures.append(
                    CheckFailure(
                        db_path=db_path,
                        check_name=check_name,
                        count=count,
                        sample=sample,
                    )
                )
    finally:
        conn.close()

    return failures, None


def validate_shared_db(db_path: Path) -> tuple[list[CheckFailure], str | None]:
    if not db_path.exists():
        return [], f"missing file: {db_path}"
    failures: list[CheckFailure] = []
    conn = duckdb.connect(str(db_path), read_only=True)
    try:
        checks = [
            (
                "cards.deck_id references deck.deck_id",
                """
                SELECT COUNT(*)
                FROM cards c
                LEFT JOIN deck d ON d.deck_id = c.deck_id
                WHERE d.deck_id IS NULL
                """,
                """
                SELECT c.id, c.deck_id, c.front
                FROM cards c
                LEFT JOIN deck d ON d.deck_id = c.deck_id
                WHERE d.deck_id IS NULL
                LIMIT 1
                """,
            ),
            (
                "duplicate deck names",
                """
                SELECT COUNT(*)
                FROM (
                  SELECT name
                  FROM deck
                  GROUP BY name
                  HAVING COUNT(*) > 1
                ) t
                """,
                """
                SELECT name, COUNT(*) AS cnt
                FROM deck
                GROUP BY name
                HAVING COUNT(*) > 1
                ORDER BY cnt DESC, name ASC
                LIMIT 1
                """,
            ),
            (
                "duplicate card fronts globally",
                """
                SELECT COUNT(*)
                FROM (
                  SELECT front
                  FROM cards
                  GROUP BY front
                  HAVING COUNT(*) > 1
                ) t
                """,
                """
                SELECT front, COUNT(*) AS cnt
                FROM cards
                GROUP BY front
                HAVING COUNT(*) > 1
                ORDER BY cnt DESC, front ASC
                LIMIT 1
                """,
            ),
            (
                "duplicate cards by (deck_id, front)",
                """
                SELECT COUNT(*)
                FROM (
                  SELECT deck_id, front
                  FROM cards
                  GROUP BY deck_id, front
                  HAVING COUNT(*) > 1
                ) t
                """,
                """
                SELECT deck_id, front, COUNT(*) AS cnt
                FROM cards
                GROUP BY deck_id, front
                HAVING COUNT(*) > 1
                ORDER BY cnt DESC, deck_id ASC
                LIMIT 1
                """,
            ),
        ]

        for check_name, count_sql, sample_sql in checks:
            count, sample = fetch_count_and_sample(conn, count_sql, sample_sql)
            if count > 0:
                failures.append(
                    CheckFailure(
                        db_path=db_path,
                        check_name=check_name,
                        count=count,
                        sample=sample,
                    )
                )
    finally:
        conn.close()

    return failures, None


def main() -> int:
    args = parse_args()
    if args.skip_kids and args.skip_shared:
        print("error: both --skip-kids and --skip-shared are set; nothing to validate", file=sys.stderr)
        return 2

    kid_paths = normalize_input_paths(args.kid_db)
    if args.all_kids:
        try:
            kid_paths.extend(load_kid_db_paths_from_kids_json(Path(args.kids_json).resolve()))
        except Exception as exc:
            print(f"error: failed to read kids metadata: {exc}", file=sys.stderr)
            return 1
    kid_paths = dedupe_paths(kid_paths)

    if not args.skip_kids and not kid_paths:
        # Default behavior: validate all kids if user didn't provide kid paths.
        try:
            kid_paths = dedupe_paths(load_kid_db_paths_from_kids_json(Path(args.kids_json).resolve()))
        except Exception as exc:
            print(f"error: failed to read kids metadata: {exc}", file=sys.stderr)
            return 1

    shared_path = Path(args.shared_db)
    if not shared_path.is_absolute():
        shared_path = (PROJECT_DIR / shared_path).resolve()

    missing: list[str] = []
    all_failures: list[CheckFailure] = []
    validated_targets: list[str] = []

    if not args.skip_kids:
        for kid_path in kid_paths:
            failures, missing_msg = validate_kid_db(kid_path)
            if missing_msg:
                missing.append(missing_msg)
                continue
            validated_targets.append(str(kid_path))
            all_failures.extend(failures)

    if not args.skip_shared:
        failures, missing_msg = validate_shared_db(shared_path)
        if missing_msg:
            missing.append(missing_msg)
        else:
            validated_targets.append(str(shared_path))
            all_failures.extend(failures)

    if args.json:
        payload = {
            "validated_targets": validated_targets,
            "missing": missing,
            "failure_count": len(all_failures),
            "failures": [
                {
                    "db_path": str(item.db_path),
                    "check_name": item.check_name,
                    "count": item.count,
                    "sample": item.sample,
                }
                for item in all_failures
            ],
            "ok": len(missing) == 0 and len(all_failures) == 0,
        }
        print(json.dumps(payload, indent=2, ensure_ascii=True))
    else:
        print("DB validation report")
        print(f"- validated targets: {len(validated_targets)}")
        for target in validated_targets:
            print(f"  - {target}")

        if missing:
            print(f"- missing targets: {len(missing)}")
            for item in missing:
                print(f"  - {item}")

        if all_failures:
            print(f"- failures: {len(all_failures)}")
            for item in all_failures:
                print(
                    f"  - [{item.db_path}] {item.check_name}: "
                    f"violations={item.count}; sample={item.sample}"
                )
        else:
            print("- failures: 0")
            print("All checks passed.")

    return 0 if len(missing) == 0 and len(all_failures) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())

