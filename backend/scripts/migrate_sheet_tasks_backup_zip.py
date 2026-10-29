"""Usage: python migrate_sheet_tasks_backup_zip.py INPUT.zip OUTPUT.zip"""
import sys
import tempfile
import zipfile
from pathlib import Path

import duckdb


def migrate_database(path):
    conn = duckdb.connect(str(path))
    try:
        conn.execute('BEGIN TRANSACTION')
        conn.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS delivery_mode VARCHAR DEFAULT 'online'")
        conn.execute("ALTER TABLE deck_category_opt_in ADD COLUMN IF NOT EXISTS task_delivery_mode VARCHAR DEFAULT 'online'")
        conn.execute("UPDATE sessions SET delivery_mode = 'online' WHERE delivery_mode IS NULL")
        conn.execute("UPDATE deck_category_opt_in SET task_delivery_mode = 'online' WHERE task_delivery_mode IS NULL")
        schema = (Path(__file__).resolve().parents[1] / 'src/db/schema.sql').read_text()
        start = schema.index('CREATE SEQUENCE IF NOT EXISTS sheet_session_items_id_seq;')
        end = schema.index('CREATE TABLE IF NOT EXISTS kid_off_app_chore', start)
        conn.execute(schema[start:end])
        conn.execute('COMMIT')
        return True
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
