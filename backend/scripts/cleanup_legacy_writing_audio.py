#!/usr/bin/env python3
"""One-time cleanup for legacy writing-audio artifacts."""

from __future__ import annotations

import argparse
import glob
import os
import shutil
from dataclasses import dataclass, asdict

import duckdb


@dataclass
class DeckMigrationStats:
    old_name: str
    target_name: str
    target_created: int = 0
    target_reused_from_old: int = 0
    cards_moved: int = 0
    old_rows_renamed: int = 0


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Cleanup legacy writing-audio data/layout.")
    parser.add_argument(
        "--data-dir",
        default=os.path.join(os.path.dirname(__file__), "..", "data"),
        help="Backend data directory (default: backend/data).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned operations without mutating data.",
    )
    return parser.parse_args()


def _iter_kid_db_paths(data_dir: str) -> list[str]:
    pattern = os.path.join(os.path.abspath(data_dir), "families", "family_*", "kid_*.db")
    return sorted(glob.glob(pattern))


def _count_cards_for_deck(conn: duckdb.DuckDBPyConnection, deck_id: int) -> int:
    return int(conn.execute("SELECT COUNT(*) FROM cards WHERE deck_id = ?", [deck_id]).fetchone()[0] or 0)


def _get_deck_ids_by_name(conn: duckdb.DuckDBPyConnection, name: str) -> list[int]:
    rows = conn.execute("SELECT id FROM decks WHERE name = ? ORDER BY id ASC", [name]).fetchall()
    return [int(row[0]) for row in rows]


def _set_deck_meta(
    conn: duckdb.DuckDBPyConnection,
    deck_id: int,
    deck_name: str,
    description: str,
    tags: list[str],
    dry_run: bool,
) -> None:
    if dry_run:
        return
    conn.execute(
        """
        UPDATE decks
        SET name = ?, description = ?, tags = ?
        WHERE id = ?
        """,
        [deck_name, description, tags, deck_id],
    )


def _rename_legacy_deck_rows(
    conn: duckdb.DuckDBPyConnection,
    old_name: str,
    target_name: str,
    target_description: str,
    target_tags: list[str],
    dry_run: bool,
) -> DeckMigrationStats:
    stats = DeckMigrationStats(old_name=old_name, target_name=target_name)
    old_ids = _get_deck_ids_by_name(conn, old_name)
    target_ids = _get_deck_ids_by_name(conn, target_name)

    target_id: int | None = target_ids[0] if target_ids else None
    remaining_old_ids = list(old_ids)

    if target_id is None and old_ids:
        target_id = old_ids[0]
        remaining_old_ids = old_ids[1:]
        stats.target_reused_from_old = 1
        _set_deck_meta(conn, target_id, target_name, target_description, target_tags, dry_run)
    elif target_id is None:
        if dry_run:
            stats.target_created = 1
        else:
            row = conn.execute(
                """
                INSERT INTO decks (name, description, tags)
                VALUES (?, ?, ?)
                RETURNING id
                """,
                [target_name, target_description, target_tags],
            ).fetchone()
            target_id = int(row[0])
            stats.target_created = 1
    else:
        _set_deck_meta(conn, target_id, target_name, target_description, target_tags, dry_run)

    if target_id is None:
        return stats

    for old_id in remaining_old_ids:
        moved = _count_cards_for_deck(conn, old_id)
        stats.cards_moved += moved
        if not dry_run and moved > 0:
            conn.execute("UPDATE cards SET deck_id = ? WHERE deck_id = ?", [target_id, old_id])

        stats.old_rows_renamed += 1
        if not dry_run:
            conn.execute(
                "UPDATE decks SET name = ? WHERE id = ?",
                [f"__deprecated_{old_name.lower().replace(' ', '_')}_{old_id}", old_id],
            )

    return stats


def _drop_legacy_writing_audio_table(
    conn: duckdb.DuckDBPyConnection, dry_run: bool
) -> tuple[int, bool]:
    has_table = bool(
        conn.execute(
            """
            SELECT COUNT(*)
            FROM information_schema.tables
            WHERE table_schema = 'main'
              AND table_name = 'writing_audio'
            """
        ).fetchone()[0]
    )
    if not has_table:
        return 0, False

    row_count = int(conn.execute("SELECT COUNT(*) FROM writing_audio").fetchone()[0] or 0)
    if not dry_run:
        conn.execute("DROP TABLE IF EXISTS writing_audio")
    return row_count, True


def _cleanup_legacy_writing_audio_dirs(data_dir: str, dry_run: bool) -> tuple[int, int]:
    families_root = os.path.join(os.path.abspath(data_dir), "families")
    pattern = os.path.join(families_root, "family_*", "writing_audio")
    paths = [path for path in sorted(glob.glob(pattern)) if os.path.isdir(path)]

    removed_dir_count = 0
    removed_file_count = 0
    for path in paths:
        file_count = 0
        for _, _, file_names in os.walk(path):
            file_count += len(file_names)
        removed_file_count += file_count
        removed_dir_count += 1
        if not dry_run:
            shutil.rmtree(path, ignore_errors=True)
    return removed_dir_count, removed_file_count


def main() -> int:
    args = _parse_args()
    data_dir = os.path.abspath(args.data_dir)
    kid_db_paths = _iter_kid_db_paths(data_dir)

    summary = {
        "data_dir": data_dir,
        "dry_run": bool(args.dry_run),
        "kid_db_count": len(kid_db_paths),
        "kid_dbs": [],
        "legacy_writing_audio_dirs_removed": 0,
        "legacy_writing_audio_files_removed": 0,
    }

    for db_path in kid_db_paths:
        con = duckdb.connect(db_path, read_only=False)
        if not args.dry_run:
            con.execute("BEGIN TRANSACTION")
        try:
            dropped_rows, dropped_table = _drop_legacy_writing_audio_table(con, args.dry_run)
            cc_stats = _rename_legacy_deck_rows(
                conn=con,
                old_name="Chinese Characters",
                target_name="chinese_characters_orphan",
                target_description="Reserved deck for orphaned/manual Chinese character cards",
                target_tags=["chinese_characters", "orphan"],
                dry_run=args.dry_run,
            )
            writing_stats = _rename_legacy_deck_rows(
                conn=con,
                old_name="Chinese Character Writing",
                target_name="chinese_writing_orphan",
                target_description="Reserved deck for orphaned/manual chinese-writing cards",
                target_tags=["chinese_writing", "orphan"],
                dry_run=args.dry_run,
            )

            if not args.dry_run:
                con.execute("COMMIT")

            summary["kid_dbs"].append(
                {
                    "db_path": db_path,
                    "writing_audio_table_dropped": dropped_table,
                    "writing_audio_rows_removed": dropped_rows,
                    "deck_migrations": [asdict(cc_stats), asdict(writing_stats)],
                }
            )
        except Exception:
            if not args.dry_run:
                con.execute("ROLLBACK")
            raise
        finally:
            con.close()

    dir_count, file_count = _cleanup_legacy_writing_audio_dirs(data_dir, args.dry_run)
    summary["legacy_writing_audio_dirs_removed"] = dir_count
    summary["legacy_writing_audio_files_removed"] = file_count

    print("CLEANUP_SUMMARY")
    for key, value in summary.items():
        if key == "kid_dbs":
            continue
        print(f"{key}={value}")
    for item in summary["kid_dbs"]:
        print(f"DB={item['db_path']}")
        print(f"  writing_audio_table_dropped={item['writing_audio_table_dropped']}")
        print(f"  writing_audio_rows_removed={item['writing_audio_rows_removed']}")
        for deck_stats in item["deck_migrations"]:
            print(
                "  deck_migration="
                f"{deck_stats['old_name']}->{deck_stats['target_name']},"
                f"created={deck_stats['target_created']},"
                f"reused_old={deck_stats['target_reused_from_old']},"
                f"moved_cards={deck_stats['cards_moved']},"
                f"renamed_old_rows={deck_stats['old_rows_renamed']}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
