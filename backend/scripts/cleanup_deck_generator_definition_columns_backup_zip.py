#!/usr/bin/env python3
"""One-time full-backup migration for legacy deck_generator_definition columns."""

from __future__ import annotations

import argparse
import json
import shutil
import tempfile
import zipfile
from pathlib import Path

import duckdb

FULL_BACKUP_MANIFEST = "full_manifest.json"
SHARED_DB_MEMBER = "shared_decks.duckdb"
TARGET_TABLE = "deck_generator_definition"
DROP_COLUMNS = (
    "vertical_answer_rows",
    "horizontal_capacity",
    "vertical_capacity",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Clean legacy deck_generator_definition columns from a full backup zip "
            "by rewriting shared_decks.duckdb."
        )
    )
    parser.add_argument(
        "--input-zip",
        required=True,
        help="Path to the source full backup zip.",
    )
    parser.add_argument(
        "--output-zip",
        help=(
            "Path for the migrated backup zip. Defaults to the input filename with "
            "'_deck_generator_definition_cleanup' appended."
        ),
    )
    return parser.parse_args()


def derive_output_zip_path(input_zip_path: Path) -> Path:
    suffix = input_zip_path.suffix or ".zip"
    stem = input_zip_path.stem if input_zip_path.suffix else input_zip_path.name
    return input_zip_path.with_name(
        f"{stem}_deck_generator_definition_cleanup{suffix}"
    )


def clone_zip_info(info: zipfile.ZipInfo) -> zipfile.ZipInfo:
    cloned = zipfile.ZipInfo(filename=info.filename, date_time=info.date_time)
    cloned.comment = info.comment
    cloned.extra = info.extra
    cloned.compress_type = info.compress_type
    cloned.create_system = info.create_system
    cloned.external_attr = info.external_attr
    cloned.internal_attr = info.internal_attr
    return cloned


def copy_zip_member(
    source_zip: zipfile.ZipFile,
    target_zip: zipfile.ZipFile,
    info: zipfile.ZipInfo,
) -> None:
    cloned = clone_zip_info(info)
    if info.is_dir():
        target_zip.writestr(cloned, b"")
        return
    with source_zip.open(info, "r") as src, target_zip.open(
        cloned, "w", force_zip64=True
    ) as dst:
        shutil.copyfileobj(src, dst, length=1024 * 1024)


def extract_shared_db(source_zip: zipfile.ZipFile, target_db_path: Path) -> None:
    if SHARED_DB_MEMBER not in source_zip.namelist():
        raise ValueError(f"Backup zip is missing {SHARED_DB_MEMBER}")
    with source_zip.open(SHARED_DB_MEMBER, "r") as src, open(target_db_path, "wb") as dst:
        shutil.copyfileobj(src, dst, length=1024 * 1024)


def read_and_validate_manifest(source_zip: zipfile.ZipFile) -> dict:
    if FULL_BACKUP_MANIFEST not in source_zip.namelist():
        raise ValueError(f"Backup zip is missing {FULL_BACKUP_MANIFEST}")
    manifest = json.loads(source_zip.read(FULL_BACKUP_MANIFEST).decode("utf-8"))
    if str(manifest.get("scope") or "") != "full_data":
        raise ValueError("Backup zip is not a full-data backup")
    return manifest


def get_table_columns(conn: duckdb.DuckDBPyConnection) -> list[str]:
    rows = conn.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = ?
        ORDER BY ordinal_position
        """,
        [TARGET_TABLE],
    ).fetchall()
    if not rows:
        raise ValueError(f"Table {TARGET_TABLE} not found in shared_decks.duckdb")
    return [str(row[0]) for row in rows]


def migrate_shared_db(db_path: Path) -> tuple[list[str], list[str], list[str]]:
    conn = duckdb.connect(str(db_path))
    try:
        before_columns = get_table_columns(conn)
        dropped_columns = []
        for column_name in DROP_COLUMNS:
            if column_name not in before_columns:
                continue
            conn.execute(f'ALTER TABLE {TARGET_TABLE} DROP COLUMN "{column_name}"')
            dropped_columns.append(column_name)
        after_columns = get_table_columns(conn)
        conn.execute("CHECKPOINT")
        return before_columns, dropped_columns, after_columns
    finally:
        conn.close()


def rebuild_backup_zip(
    input_zip_path: Path,
    output_zip_path: Path,
    migrated_db_path: Path,
) -> None:
    with zipfile.ZipFile(input_zip_path, "r") as source_zip, zipfile.ZipFile(
        output_zip_path, "w", allowZip64=True
    ) as target_zip:
        for info in source_zip.infolist():
            if info.filename != SHARED_DB_MEMBER:
                copy_zip_member(source_zip, target_zip, info)
                continue
            cloned = clone_zip_info(info)
            with open(migrated_db_path, "rb") as src, target_zip.open(
                cloned, "w", force_zip64=True
            ) as dst:
                shutil.copyfileobj(src, dst, length=1024 * 1024)


def verify_output_columns(output_zip_path: Path) -> list[str]:
    with tempfile.TemporaryDirectory(prefix="dgd_cleanup_verify_") as temp_dir:
        temp_db_path = Path(temp_dir) / SHARED_DB_MEMBER
        with zipfile.ZipFile(output_zip_path, "r") as source_zip:
            extract_shared_db(source_zip, temp_db_path)
        conn = duckdb.connect(str(temp_db_path), read_only=True)
        try:
            return get_table_columns(conn)
        finally:
            conn.close()


def main() -> int:
    args = parse_args()

    input_zip_path = Path(args.input_zip).expanduser().absolute()
    if not input_zip_path.is_file():
        raise FileNotFoundError(f"Input zip not found: {input_zip_path}")

    output_zip_path = (
        Path(args.output_zip).expanduser().absolute()
        if args.output_zip
        else derive_output_zip_path(input_zip_path)
    )
    if input_zip_path == output_zip_path:
        raise ValueError("Output zip path must differ from the input zip path")

    output_zip_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="dgd_cleanup_work_") as temp_dir:
        temp_db_path = Path(temp_dir) / SHARED_DB_MEMBER

        with zipfile.ZipFile(input_zip_path, "r") as source_zip:
            manifest = read_and_validate_manifest(source_zip)
            files = manifest.get("files") or []
            if SHARED_DB_MEMBER not in files:
                raise ValueError(
                    f"Backup manifest does not list {SHARED_DB_MEMBER} as a tracked file"
                )
            extract_shared_db(source_zip, temp_db_path)

        before_columns, dropped_columns, after_columns = migrate_shared_db(temp_db_path)

        if dropped_columns:
            rebuild_backup_zip(input_zip_path, output_zip_path, temp_db_path)
        else:
            shutil.copy2(input_zip_path, output_zip_path)

    verified_columns = verify_output_columns(output_zip_path)

    print(f"Input zip: {input_zip_path}")
    print(f"Output zip: {output_zip_path}")
    print(f"Removed columns: {json.dumps(dropped_columns)}")
    print(f"Before columns: {json.dumps(before_columns)}")
    print(f"After columns: {json.dumps(after_columns)}")
    print(f"Verified output columns: {json.dumps(verified_columns)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
