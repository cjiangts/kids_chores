"""Add the parent-controlled Speed Drill setting, defaulting to disabled.

Usage: python migrate_speed_drill_enabled_backup_zip.py INPUT.zip OUTPUT.zip
"""
import sys
import tempfile
import zipfile
from pathlib import Path

import duckdb


def migrate_database(path):
    conn = duckdb.connect(str(path))
    try:
        conn.execute('ALTER TABLE deck_category_opt_in ADD COLUMN IF NOT EXISTS speed_drill_enabled BOOLEAN DEFAULT FALSE')
    finally:
        conn.close()


def migrate_zip(source, destination):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if source == destination or destination.exists():
        raise ValueError('Output must be a new ZIP file')
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary).resolve()
        with zipfile.ZipFile(source) as archive:
            for entry in archive.infolist():
                if not (root / entry.filename).resolve().is_relative_to(root):
                    raise ValueError('Unsafe ZIP entry')
            archive.extractall(root)
        databases = list(root.rglob('kid_*.db'))
        for path in databases:
            migrate_database(path)
        with zipfile.ZipFile(destination, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
            for path in root.rglob('*'):
                if path.is_file():
                    archive.write(path, path.relative_to(root))
    return len(databases)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    print(f'Migrated {migrate_zip(sys.argv[1], sys.argv[2])} kid databases')
