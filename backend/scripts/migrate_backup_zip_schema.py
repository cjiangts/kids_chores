"""One-time migration for backup zip: add missing columns & tables to match current schema."""
import argparse
import os
import tempfile
import zipfile
from pathlib import Path

import duckdb


def migrate_shared_db(db_path: Path) -> list[str]:
    """Add missing columns/tables to shared_decks.duckdb."""
    changes = []
    conn = duckdb.connect(str(db_path))
    try:
        # Add print_cell_design_json to deck_generator_definition if missing
        has = conn.execute(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema='main' AND table_name='deck_generator_definition' "
            "AND column_name='print_cell_design_json' LIMIT 1"
        ).fetchone()
        if not has:
            conn.execute(
                "ALTER TABLE deck_generator_definition ADD COLUMN print_cell_design_json VARCHAR DEFAULT NULL"
            )
            changes.append("shared: added deck_generator_definition.print_cell_design_json")
    finally:
        conn.close()
    return changes


def migrate_kid_db(db_path: Path) -> list[str]:
    """Add missing tables/sequences to a kid database."""
    changes = []
    conn = duckdb.connect(str(db_path))
    try:
        tables = {
            r[0]
            for r in conn.execute(
                "SELECT table_name FROM information_schema.tables WHERE table_schema='main'"
            ).fetchall()
        }

        if 'type4_print_sheets' not in tables:
            conn.execute("CREATE SEQUENCE IF NOT EXISTS type4_print_sheets_id_seq")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS type4_print_sheets (
                    id INTEGER PRIMARY KEY DEFAULT nextval('type4_print_sheets_id_seq'),
                    category_key VARCHAR NOT NULL,
                    layout_json VARCHAR NOT NULL,
                    seed_base BIGINT NOT NULL,
                    status VARCHAR NOT NULL DEFAULT 'preview',
                    incorrect_count INTEGER DEFAULT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMP
                )
            """)
            changes.append("kid: added type4_print_sheets table")
    finally:
        conn.close()
    return changes


def migrate_backup_zip(input_zip: Path, output_zip: Path) -> list[str]:
    """Migrate all DBs in a backup zip, writing result to output_zip."""
    all_changes = []

    with zipfile.ZipFile(input_zip, 'r') as zin, zipfile.ZipFile(output_zip, 'w') as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)

            if info.filename == 'shared_decks.duckdb':
                with tempfile.NamedTemporaryFile(suffix='.duckdb', delete=False) as f:
                    f.write(data)
                    tmp = f.name
                try:
                    changes = migrate_shared_db(Path(tmp))
                    all_changes.extend(changes)
                    data = Path(tmp).read_bytes()
                finally:
                    os.unlink(tmp)

            elif info.filename.endswith('.db'):
                with tempfile.NamedTemporaryFile(suffix='.duckdb', delete=False) as f:
                    f.write(data)
                    tmp = f.name
                try:
                    changes = migrate_kid_db(Path(tmp))
                    all_changes.extend(
                        f"{c} ({info.filename})" for c in changes
                    )
                    data = Path(tmp).read_bytes()
                finally:
                    os.unlink(tmp)

            zout.writestr(info, data)

    return all_changes


def main():
    parser = argparse.ArgumentParser(description="Migrate backup zip to current schema")
    parser.add_argument("input_zip", help="Path to input backup zip")
    parser.add_argument(
        "-o", "--output",
        help="Output zip path (default: overwrites input with _migrated suffix)",
    )
    args = parser.parse_args()

    input_zip = Path(args.input_zip).resolve()
    if not input_zip.exists():
        print(f"Error: {input_zip} not found")
        return

    if args.output:
        output_zip = Path(args.output).resolve()
    else:
        output_zip = input_zip.with_stem(input_zip.stem + '_migrated')

    print(f"Input:  {input_zip}")
    print(f"Output: {output_zip}")

    changes = migrate_backup_zip(input_zip, output_zip)
    if changes:
        print(f"\n{len(changes)} change(s) applied:")
        for c in changes:
            print(f"  - {c}")
    else:
        print("\nNo changes needed — schema already up to date.")


if __name__ == '__main__':
    main()
