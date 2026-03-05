#!/usr/bin/env python3
"""One-time migration: add retry star-tracking columns to kid sessions table."""

from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path
import zipfile
import duckdb


def migrate_one_db(db_path: Path) -> None:
    conn = duckdb.connect(str(db_path))
    try:
        conn.execute("BEGIN TRANSACTION")
        conn.execute(
            """
            ALTER TABLE sessions
            ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0
            """
        )
        conn.execute(
            """
            ALTER TABLE sessions
            ADD COLUMN IF NOT EXISTS retry_total_response_ms BIGINT DEFAULT 0
            """
        )
        conn.execute(
            """
            ALTER TABLE sessions
            ADD COLUMN IF NOT EXISTS retry_best_rety_correct_count INTEGER DEFAULT 0
            """
        )
        conn.execute(
            """
            UPDATE sessions
            SET
                retry_count = COALESCE(retry_count, 0),
                retry_total_response_ms = COALESCE(retry_total_response_ms, 0),
                retry_best_rety_correct_count = 0
            """
        )
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()


def find_kid_dbs(data_root: Path) -> list[Path]:
    families_root = data_root / "families"
    if not families_root.exists():
        return []
    dbs = sorted(families_root.glob("family_*/kid_*.db"))
    return [db for db in dbs if db.is_file()]


def strip_birthday_from_kids_metadata(raw_bytes: bytes) -> tuple[bytes, bool]:
    try:
        payload = json.loads(raw_bytes.decode("utf-8"))
    except Exception:
        return raw_bytes, False
    if not isinstance(payload, dict):
        return raw_bytes, False
    kids = payload.get("kids")
    if not isinstance(kids, list):
        return raw_bytes, False
    changed = False
    for kid in kids:
        if not isinstance(kid, dict):
            continue
        if "birthday" in kid:
            kid.pop("birthday", None)
            changed = True
    if not changed:
        return raw_bytes, False
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"), True


def migrate_kids_metadata_file(kids_json_path: Path) -> bool:
    if not kids_json_path.exists() or not kids_json_path.is_file():
        return False
    raw = kids_json_path.read_bytes()
    migrated, changed = strip_birthday_from_kids_metadata(raw)
    if changed:
        kids_json_path.write_bytes(migrated)
    return changed


def migrate_full_backup_zip(input_zip: Path, output_zip: Path) -> tuple[int, bool]:
    migrated_count = 0
    metadata_changed = False
    with zipfile.ZipFile(input_zip, "r") as zin, zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            name = str(info.filename or "")
            data = zin.read(name)
            if name == "kids.json":
                migrated_json, changed = strip_birthday_from_kids_metadata(data)
                zout.writestr(info, migrated_json)
                metadata_changed = metadata_changed or changed
                continue
            is_kid_db = (
                name.startswith("families/family_")
                and name.endswith(".db")
                and "/kid_" in name
            )
            if not is_kid_db:
                zout.writestr(info, data)
                continue

            with tempfile.TemporaryDirectory(prefix="retry_star_zip_mig_") as tmp_dir:
                tmp_db = Path(tmp_dir) / "kid.db"
                tmp_db.write_bytes(data)
                migrate_one_db(tmp_db)
                migrated_bytes = tmp_db.read_bytes()
            zout.writestr(info, migrated_bytes)
            migrated_count += 1
    return migrated_count, metadata_changed


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Add retry star columns to all kid DBs under backend/data/families."
    )
    parser.add_argument(
        "--data-root",
        default=str(Path(__file__).resolve().parents[1] / "data"),
        help="Path to backend data root (default: backend/data).",
    )
    parser.add_argument(
        "--input-zip",
        default="",
        help="Optional full-backup zip file to migrate in-place into a new output zip.",
    )
    parser.add_argument(
        "--output-zip",
        default="",
        help="Output zip path when --input-zip is provided.",
    )
    args = parser.parse_args()

    input_zip = Path(str(args.input_zip or "").strip()) if str(args.input_zip or "").strip() else None
    output_zip = Path(str(args.output_zip or "").strip()) if str(args.output_zip or "").strip() else None
    if input_zip is not None:
        if output_zip is None:
            raise SystemExit("--output-zip is required when --input-zip is provided")
        if not input_zip.exists():
            raise SystemExit(f"Input zip not found: {input_zip}")
        output_zip.parent.mkdir(parents=True, exist_ok=True)
        migrated, metadata_changed = migrate_full_backup_zip(input_zip.resolve(), output_zip.resolve())
        print(f"Migrated {migrated} kid DB file(s) in zip.")
        if metadata_changed:
            print("Removed legacy 'birthday' field from kids.json in zip.")
        print(f"Output: {output_zip.resolve()}")
        return

    data_root = Path(args.data_root).resolve()
    db_paths = find_kid_dbs(data_root)
    if not db_paths:
        print(f"No kid DB files found under: {data_root}")
        return

    migrated = 0
    for db_path in db_paths:
        migrate_one_db(db_path)
        migrated += 1
        print(f"Migrated: {db_path}")

    metadata_changed = migrate_kids_metadata_file(data_root / "kids.json")
    if metadata_changed:
        print(f"Removed legacy 'birthday' field from: {data_root / 'kids.json'}")

    print(f"Done. Migrated {migrated} kid DB file(s).")


if __name__ == "__main__":
    main()
