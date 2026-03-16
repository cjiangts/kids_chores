#!/usr/bin/env python3
"""One-time migration: drop kid cards.is_multichoice_only from a full backup zip."""

from __future__ import annotations

import argparse
import tempfile
from pathlib import Path
import zipfile

import duckdb


def is_kid_db_zip_member(name: str) -> bool:
    return (
        str(name or "").startswith("families/family_")
        and str(name or "").endswith(".db")
        and "/kid_" in str(name or "")
    )


def table_has_column(
    conn: duckdb.DuckDBPyConnection,
    table_name: str,
    column_name: str,
) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'main'
          AND table_name = ?
          AND column_name = ?
        LIMIT 1
        """,
        [str(table_name or "").strip(), str(column_name or "").strip()],
    ).fetchone()
    return bool(row)


def migrate_kid_db(db_path: Path) -> bool:
    conn = duckdb.connect(str(db_path))
    try:
        if not table_has_column(conn, "cards", "is_multichoice_only"):
            return False
        conn.execute("BEGIN TRANSACTION")
        try:
            conn.execute("ALTER TABLE cards DROP COLUMN is_multichoice_only")
            conn.execute("COMMIT")
            return True
        except Exception:
            conn.execute("ROLLBACK")
            raise
    finally:
        conn.close()


def migrate_full_backup_zip(input_zip: Path, output_zip: Path) -> bool:
    migrated = False
    with zipfile.ZipFile(input_zip, "r") as zin, zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            name = str(info.filename or "")
            data = zin.read(name)
            if not is_kid_db_zip_member(name):
                zout.writestr(info, data)
                continue

            with tempfile.TemporaryDirectory(prefix="drop_type4_multichoice_kid_col_") as tmp_dir:
                tmp_db = Path(tmp_dir) / Path(name).name
                tmp_db.write_bytes(data)
                migrated = migrate_kid_db(tmp_db) or migrated
                zout.writestr(info, tmp_db.read_bytes())
    return migrated


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Drop cards.is_multichoice_only from kid DBs inside a full-backup zip."
    )
    parser.add_argument(
        "--input-zip",
        required=True,
        help="Input full-backup zip path.",
    )
    parser.add_argument(
        "--output-zip",
        required=True,
        help="Output zip path for the migrated backup.",
    )
    args = parser.parse_args()

    input_zip = Path(str(args.input_zip or "").strip()).expanduser().resolve()
    output_zip = Path(str(args.output_zip or "").strip()).expanduser().resolve()
    if not input_zip.exists():
        raise SystemExit(f"Input zip not found: {input_zip}")
    output_zip.parent.mkdir(parents=True, exist_ok=True)
    migrated = migrate_full_backup_zip(input_zip, output_zip)
    print(f"Dropped kid cards.is_multichoice_only: {'yes' if migrated else 'already absent'}")
    print(f"Output: {output_zip}")


if __name__ == "__main__":
    main()
