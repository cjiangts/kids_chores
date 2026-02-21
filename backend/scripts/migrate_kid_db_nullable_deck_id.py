#!/usr/bin/env python3
"""One-time local migration to rebuild kid DuckDB files without foreign keys.

This avoids unsupported in-place ALTER behavior in DuckDB by:
1) creating a fresh target DB from schema.sql,
2) copying data table-by-table,
3) resetting sequences,
4) backing up and atomically replacing the source DB.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import duckdb


SCRIPT_PATH = Path(__file__).resolve()
BACKEND_DIR = SCRIPT_PATH.parent.parent
PROJECT_DIR = BACKEND_DIR.parent
DEFAULT_KIDS_JSON = BACKEND_DIR / "data" / "kids.json"
SCHEMA_SQL_PATH = BACKEND_DIR / "src" / "db" / "schema.sql"
DEFAULT_MARKER_PATH = BACKEND_DIR / "data" / ".drop_fk_migration_done.json"
MATH_ORPHAN_DECK_NAME = "math_orphan"

# Stable copy order for predictable rebuilds.
TABLE_COPY_ORDER = [
    "decks",
    "cards",
    "sessions",
    "session_results",
    "lesson_reading_audio",
    "writing_sheets",
    "writing_audio",
    "writing_sheet_cards",
]

# Keep nextval() defaults aligned with imported IDs.
SEQUENCE_TARGETS = [
    ("decks_id_seq", "decks", "id"),
    ("cards_id_seq", "cards", "id"),
    ("sessions_id_seq", "sessions", "id"),
    ("session_results_id_seq", "session_results", "id"),
    ("writing_sheets_id_seq", "writing_sheets", "id"),
]


@dataclass
class MigrationResult:
    db_path: Path
    status: str
    detail: str
    backup_path: Path | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="One-time migration: rebuild kid DB(s) from schema.sql with all FKs dropped."
    )
    parser.add_argument(
        "--db",
        action="append",
        default=[],
        help="Path to one kid DB file. May be repeated.",
    )
    parser.add_argument(
        "--all-kids",
        action="store_true",
        help="Use all kid DB paths from kids.json metadata.",
    )
    parser.add_argument(
        "--kids-json",
        default=str(DEFAULT_KIDS_JSON),
        help=f"Path to kids metadata JSON (default: {DEFAULT_KIDS_JSON}).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print targets and planned actions without replacing files.",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Skip creating backup files before replacement.",
    )
    parser.add_argument(
        "--marker-path",
        default=str(DEFAULT_MARKER_PATH),
        help=f"Path for one-time completion marker (default: {DEFAULT_MARKER_PATH}).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Run even if the one-time marker file already exists.",
    )
    return parser.parse_args()


def read_schema_sql() -> str:
    if not SCHEMA_SQL_PATH.exists():
        raise FileNotFoundError(f"schema.sql not found: {SCHEMA_SQL_PATH}")
    sql = SCHEMA_SQL_PATH.read_text(encoding="utf-8")
    if "FOREIGN KEY" in sql.upper():
        raise RuntimeError(
            "schema.sql still contains FOREIGN KEY clauses; aborting FK-drop migration"
        )
    return sql


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


def load_db_paths_from_kids_json(kids_json_path: Path) -> list[Path]:
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


def sql_ident(name: str) -> str:
    escaped = name.replace('"', '""')
    return '"' + escaped + '"'


def table_names(conn: duckdb.DuckDBPyConnection) -> set[str]:
    rows = conn.execute(
        """
        SELECT table_name
        FROM duckdb_tables()
        WHERE schema_name = 'main'
          AND internal = FALSE
        """
    ).fetchall()
    return {str(row[0]) for row in rows}


def table_columns(conn: duckdb.DuckDBPyConnection, table_name: str) -> list[str]:
    rows = conn.execute(
        """
        SELECT column_name
        FROM duckdb_columns()
        WHERE schema_name = 'main'
          AND table_name = ?
          AND internal = FALSE
        ORDER BY column_index
        """,
        [table_name],
    ).fetchall()
    return [str(row[0]) for row in rows]


def table_count(conn: duckdb.DuckDBPyConnection, table_name: str) -> int:
    row = conn.execute(f"SELECT COUNT(*) FROM {sql_ident(table_name)}").fetchone()
    return int(row[0] or 0)


def reset_sequences(conn: duckdb.DuckDBPyConnection) -> None:
    for sequence_name, table_name, id_column in SEQUENCE_TARGETS:
        row = conn.execute(
            f"SELECT COALESCE(MAX({sql_ident(id_column)}), 0) FROM {sql_ident(table_name)}"
        ).fetchone()
        max_id = int(row[0] or 0)
        if max_id <= 0:
            continue
        # Advance existing sequence to at least max_id so next generated id is max_id + 1.
        conn.execute(
            f"SELECT MAX(nextval('{sequence_name}')) FROM range(?)",
            [max_id],
        )


def verify_deck_id_nullable(conn: duckdb.DuckDBPyConnection) -> None:
    row = conn.execute(
        """
        SELECT is_nullable
        FROM duckdb_columns()
        WHERE schema_name = 'main'
          AND table_name = 'cards'
          AND column_name = 'deck_id'
        LIMIT 1
        """
    ).fetchone()
    if not row:
        raise RuntimeError("cards.deck_id not found in migrated database")
    raw_value = row[0]
    if isinstance(raw_value, bool):
        nullable = raw_value
    else:
        nullable = str(raw_value).strip().lower() in {"yes", "true", "1"}
    if not nullable:
        raise RuntimeError("cards.deck_id is still NOT NULL in migrated database")


def verify_session_results_card_id_not_nullable(conn: duckdb.DuckDBPyConnection) -> None:
    row = conn.execute(
        """
        SELECT is_nullable
        FROM duckdb_columns()
        WHERE schema_name = 'main'
          AND table_name = 'session_results'
          AND column_name = 'card_id'
        LIMIT 1
        """
    ).fetchone()
    if not row:
        raise RuntimeError("session_results.card_id not found in migrated database")
    raw_value = row[0]
    if isinstance(raw_value, bool):
        nullable = raw_value
    else:
        nullable = str(raw_value).strip().lower() in {"yes", "true", "1"}
    if nullable:
        raise RuntimeError("session_results.card_id is still nullable in migrated database")


def verify_no_foreign_keys(conn: duckdb.DuckDBPyConnection) -> None:
    row = conn.execute(
        """
        SELECT COUNT(*)
        FROM duckdb_constraints()
        WHERE constraint_type = 'FOREIGN KEY'
        """
    ).fetchone()
    fk_count = int(row[0] or 0)
    if fk_count != 0:
        raise RuntimeError(f"migrated database still has {fk_count} foreign key constraint(s)")


def fill_math_session_deck_ids(conn: duckdb.DuckDBPyConnection) -> int:
    """Assign NULL math session deck_id values to the math_orphan deck."""
    orphan_row = conn.execute(
        "SELECT id FROM decks WHERE name = ? ORDER BY id ASC LIMIT 1",
        [MATH_ORPHAN_DECK_NAME],
    ).fetchone()
    if orphan_row:
        orphan_deck_id = int(orphan_row[0])
    else:
        orphan_deck_id = int(
            conn.execute(
                """
                INSERT INTO decks (name, description, tags)
                VALUES (?, ?, ?)
                RETURNING id
                """,
                [
                    MATH_ORPHAN_DECK_NAME,
                    "Reserved deck for orphaned math cards",
                    ["math", "orphan"],
                ],
            ).fetchone()[0]
        )

    pending_count = int(
        conn.execute(
            """
            SELECT COUNT(*)
            FROM sessions
            WHERE deck_id IS NULL
              AND LOWER(COALESCE(type, '')) = 'math'
            """
        ).fetchone()[0]
        or 0
    )
    if pending_count > 0:
        conn.execute(
            """
            UPDATE sessions
            SET deck_id = ?
            WHERE deck_id IS NULL
              AND LOWER(COALESCE(type, '')) = 'math'
            """,
            [orphan_deck_id],
        )

    remaining = int(
        conn.execute(
            """
            SELECT COUNT(*)
            FROM sessions
            WHERE deck_id IS NULL
              AND LOWER(COALESCE(type, '')) = 'math'
            """
        ).fetchone()[0]
        or 0
    )
    if remaining != 0:
        raise RuntimeError("failed to fill all NULL deck_id values for math sessions")
    return pending_count


def migrate_one_db(db_path: Path, schema_sql: str, dry_run: bool, no_backup: bool) -> MigrationResult:
    if not db_path.exists():
        return MigrationResult(db_path=db_path, status="missing", detail="file not found")

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    temp_path = db_path.with_name(f"{db_path.name}.migrate_tmp_{timestamp}")
    backup_path = db_path.with_name(f"{db_path.name}.bak_{timestamp}")

    if dry_run:
        return MigrationResult(
            db_path=db_path,
            status="dry-run",
            detail=f"would migrate via temp={temp_path.name} backup={backup_path.name}",
            backup_path=None if no_backup else backup_path,
        )

    if temp_path.exists():
        temp_path.unlink()

    source_conn = duckdb.connect(str(db_path))
    target_conn = duckdb.connect(str(temp_path))
    try:
        target_conn.execute(schema_sql)

        src_tables = table_names(source_conn)
        main_tables = table_names(target_conn)

        extra_source_tables = sorted(src_tables - main_tables)
        if extra_source_tables:
            raise RuntimeError(
                "source has tables not present in target schema: "
                + ", ".join(extra_source_tables)
            )

        source_card_ids: set[int] | None = None
        dropped_rows_by_table: dict[str, int] = {}

        for table_name in TABLE_COPY_ORDER:
            if table_name not in src_tables or table_name not in main_tables:
                continue
            src_cols = set(table_columns(source_conn, table_name))
            dst_cols = table_columns(target_conn, table_name)
            insert_cols = [col for col in dst_cols if col in src_cols]
            if not insert_cols:
                continue

            cols_sql = ", ".join(sql_ident(col) for col in insert_cols)
            placeholders = ", ".join(["?"] * len(insert_cols))
            rows = source_conn.execute(
                f"SELECT {cols_sql} FROM {sql_ident(table_name)}"
            ).fetchall()
            if len(rows) == 0:
                continue

            if table_name == "session_results" and "card_id" in insert_cols:
                if source_card_ids is None:
                    source_card_ids = {
                        int(row[0])
                        for row in source_conn.execute(
                            f"SELECT id FROM {sql_ident('cards')}"
                        ).fetchall()
                    }
                card_idx = insert_cols.index("card_id")
                dropped_count = 0
                fixed_rows = []
                for row in rows:
                    card_id = row[card_idx]
                    if card_id is None:
                        dropped_count += 1
                        continue
                    if int(card_id) not in source_card_ids:
                        dropped_count += 1
                        continue
                    fixed_rows.append(row)
                dropped_rows_by_table[table_name] = dropped_count
                rows = fixed_rows
                if len(rows) == 0:
                    continue

            target_conn.executemany(
                f"""
                INSERT INTO {sql_ident(table_name)} ({cols_sql})
                VALUES ({placeholders})
                """,
                rows,
            )

        # Basic row-count verification for known tables present in both DBs.
        for table_name in TABLE_COPY_ORDER:
            if table_name not in src_tables or table_name not in main_tables:
                continue
            source_count = table_count(source_conn, table_name)
            target_count = table_count(target_conn, table_name)
            dropped_count = int(dropped_rows_by_table.get(table_name, 0))
            expected_count = source_count - dropped_count
            if expected_count != target_count:
                raise RuntimeError(
                    (
                        f"row count mismatch for {table_name}: "
                        f"source={source_count}, dropped={dropped_count}, "
                        f"expected_target={expected_count}, actual_target={target_count}"
                    )
                )

        filled_math_sessions = fill_math_session_deck_ids(target_conn)
        reset_sequences(target_conn)
        verify_deck_id_nullable(target_conn)
        verify_session_results_card_id_not_nullable(target_conn)
        verify_no_foreign_keys(target_conn)
    finally:
        source_conn.close()
        target_conn.close()

    if not no_backup:
        shutil.copy2(db_path, backup_path)
    os.replace(temp_path, db_path)

    return MigrationResult(
        db_path=db_path,
        status="migrated",
        detail=f"migration completed; filled_math_session_deck_id={filled_math_sessions}",
        backup_path=None if no_backup else backup_path,
    )


def main() -> int:
    args = parse_args()

    if not args.db and not args.all_kids:
        args.all_kids = True

    marker_path = Path(args.marker_path).resolve()
    if marker_path.exists() and not args.force and not args.dry_run:
        print(
            f"error: one-time migration already completed ({marker_path}). "
            "Use --force to run again.",
            file=sys.stderr
        )
        return 2

    try:
        schema_sql = read_schema_sql()
    except Exception as exc:
        print(f"error: failed to read schema.sql: {exc}", file=sys.stderr)
        return 1

    paths = normalize_input_paths(args.db)
    if args.all_kids:
        try:
            paths.extend(load_db_paths_from_kids_json(Path(args.kids_json).resolve()))
        except Exception as exc:
            print(f"error: failed to read kids metadata: {exc}", file=sys.stderr)
            return 1
    targets = dedupe_paths(paths)

    if len(targets) == 0:
        print("No DB targets resolved.")
        return 0

    print(f"Resolved {len(targets)} DB target(s):")
    for path in targets:
        print(f"- {path}")

    results: list[MigrationResult] = []
    for path in targets:
        try:
            result = migrate_one_db(
                db_path=path,
                schema_sql=schema_sql,
                dry_run=bool(args.dry_run),
                no_backup=bool(args.no_backup),
            )
        except Exception as exc:
            result = MigrationResult(db_path=path, status="error", detail=str(exc))
        results.append(result)

    print("\nMigration summary:")
    exit_code = 0
    for result in results:
        line = f"- [{result.status}] {result.db_path}: {result.detail}"
        if result.backup_path:
            line += f" (backup: {result.backup_path})"
        print(line)
        if result.status == "error":
            exit_code = 1

    if exit_code == 0 and not args.dry_run:
        marker_path.parent.mkdir(parents=True, exist_ok=True)
        marker_payload = {
            "completed_at_utc": datetime.now(timezone.utc).isoformat(),
            "targets": [str(path) for path in targets],
            "script": str(SCRIPT_PATH),
        }
        marker_path.write_text(
            json.dumps(marker_payload, indent=2, ensure_ascii=True) + "\n",
            encoding="utf-8",
        )
        print(f"\nWrote one-time migration marker: {marker_path}")

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
