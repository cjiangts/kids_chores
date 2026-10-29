"""Migrate per-card Type-IV targets into subject totals in a backup ZIP.

Usage: python scripts/migrate_type4_total_targets_backup_zip.py INPUT.zip OUTPUT.zip
The input is preserved. Reapplying to an already migrated database is a no-op.
"""
import sys
import tempfile
import zipfile
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.services.shared_deck_queries import get_kid_materialized_shared_decks_by_first_tag


def migrate_database(path, category_keys):
    conn = duckdb.connect(str(path))
    try:
        columns = {row[1] for row in conn.execute("PRAGMA table_info('decks')").fetchall()}
        if 'daily_target_count' not in columns:
            return False
        conn.execute('BEGIN TRANSACTION')
        for key in category_keys:
            config = conn.execute('SELECT include_orphan FROM deck_category_opt_in WHERE category_key = ?', [key]).fetchone()
            if config is None:
                continue
            deck_ids = list(get_kid_materialized_shared_decks_by_first_tag(conn, key))
            total = 0
            if deck_ids:
                placeholders = ','.join('?' for _ in deck_ids)
                total = int(conn.execute(f'SELECT COALESCE(SUM(daily_target_count), 0) FROM decks WHERE id IN ({placeholders})', deck_ids).fetchone()[0])
            if bool(config[0]):
                orphan = conn.execute('SELECT daily_target_count FROM decks WHERE name = ? LIMIT 1', [f'{key}_orphan']).fetchone()
                total += int(orphan[0] or 0) if orphan else 0
            conn.execute('UPDATE deck_category_opt_in SET session_card_count = ? WHERE category_key = ?', [max(0, total), key])
        conn.execute('ALTER TABLE decks DROP COLUMN daily_target_count')
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
                if not (root / info.filename).resolve().is_relative_to(root):
                    raise ValueError('Unsafe zip entry')
            archive.extractall(root)
        shared_path = next(root.rglob('shared_decks.duckdb'))
        shared = duckdb.connect(str(shared_path), read_only=True)
        try:
            keys = [row[0] for row in shared.execute("SELECT category_key FROM deck_category WHERE behavior_type = 'type_iv'").fetchall()]
        finally:
            shared.close()
        count = sum(migrate_database(path, keys) for path in root.rglob('kid_*.db'))
        with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for path in root.rglob('*'):
                if path.is_file():
                    archive.write(path, path.relative_to(root))
        return count


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    print(f'Migrated {migrate_zip(sys.argv[1], sys.argv[2])} kid databases')
