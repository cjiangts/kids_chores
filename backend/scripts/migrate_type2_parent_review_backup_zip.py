"""Add the per-subject parent review setting, preserving existing self grading.

Usage: python migrate_type2_parent_review_backup_zip.py INPUT.zip OUTPUT.zip
"""
import sys
import tempfile
import zipfile
from pathlib import Path

import duckdb


def migrate_database(path):
    conn = duckdb.connect(str(path))
    try:
        conn.execute('ALTER TABLE deck_category_opt_in ADD COLUMN IF NOT EXISTS parent_review_required BOOLEAN DEFAULT FALSE')
        count = conn.execute("""
            SELECT COUNT(*) FROM session_results r JOIN sessions s ON s.id = r.session_id
            WHERE s.practice_mode = 'parent_review' AND s.delivery_mode = 'online' AND r.correct = -1
        """).fetchone()[0]
        conn.execute("""
            UPDATE session_results SET correct = -2
            WHERE correct = -1 AND session_id IN (
                SELECT id FROM sessions WHERE practice_mode = 'parent_review' AND delivery_mode = 'online'
            )
        """)
        return int(count)
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
