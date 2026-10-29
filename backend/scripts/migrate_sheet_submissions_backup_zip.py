"""Usage: python migrate_sheet_submissions_backup_zip.py INPUT.zip OUTPUT.zip"""
import sys
import tempfile
import zipfile
from pathlib import Path

import duckdb


def migrate_database(path):
    """Remove unfinished sheet reservations created merely by opening practice."""
    conn = duckdb.connect(str(path))
    try:
        conn.execute('BEGIN TRANSACTION')
        rows = conn.execute("""
            SELECT s.id FROM sessions s
            WHERE s.delivery_mode = 'sheet' AND s.completed_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM session_results r WHERE r.session_id = s.id)
              AND NOT EXISTS (SELECT 1 FROM sheet_session_items i WHERE i.session_id = s.id AND i.result_id IS NOT NULL)
        """).fetchall()
        for (session_id,) in rows:
            conn.execute('DELETE FROM sheet_session_items WHERE session_id = ?', [session_id])
            conn.execute('DELETE FROM sessions WHERE id = ?', [session_id])
        conn.execute('COMMIT')
        return len(rows)
    except Exception:
        conn.execute('ROLLBACK')
        raise
    finally:
        conn.close()


def migrate_zip(source, destination):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if source == destination or destination.exists():
        raise ValueError('Output must be a new zip file')
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary).resolve()
        with zipfile.ZipFile(source) as archive:
            for info in archive.infolist():
                path = (root / info.filename).resolve()
                if not path.is_relative_to(root):
                    raise ValueError('Unsafe zip entry')
            archive.extractall(root)
        databases = list(root.rglob('kid_*.db'))
        for path in databases:
            migrate_database(path)
        with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for path in root.rglob('*'):
                if path.is_file():
                    archive.write(path, path.relative_to(root))
        return len(databases)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    print(f'Migrated {migrate_zip(sys.argv[1], sys.argv[2])} kid databases')
