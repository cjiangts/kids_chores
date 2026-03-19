"""Startup data cleanups for existing local kid DBs."""
from pathlib import Path

from src.db import kid_db

LEGACY_MATH_PRACTICE_SHEETS_TABLE = 'math_practice_sheets'


def _iter_kid_db_paths():
    """Yield all kid DB files currently present on disk."""
    families_root = Path(kid_db.DATA_DIR) / 'families'
    if not families_root.exists():
        return
    yield from sorted(families_root.glob('family_*/kid_*.db'))


def _table_exists(conn, table_name):
    """Return whether a table exists in the main schema."""
    row = conn.execute(
        """
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'main' AND table_name = ?
        LIMIT 1
        """,
        [str(table_name or '').strip()],
    ).fetchone()
    return bool(row)


def drop_legacy_math_practice_sheets_tables(logger):
    """Drop the legacy math_practice_sheets table from all kid DBs at startup."""
    dropped_paths = []
    errors = []

    for db_path in _iter_kid_db_paths() or []:
        conn = None
        try:
            conn = kid_db.duckdb.connect(str(db_path))
            if not _table_exists(conn, LEGACY_MATH_PRACTICE_SHEETS_TABLE):
                continue
            conn.execute(f"DROP TABLE IF EXISTS {LEGACY_MATH_PRACTICE_SHEETS_TABLE}")
            dropped_paths.append(str(db_path))
        except Exception as exc:
            errors.append(f'{db_path}: {exc}')
        finally:
            if conn is not None:
                conn.close()

    if dropped_paths:
        logger.info(
            'Dropped legacy %s table from %s kid DB(s): %s',
            LEGACY_MATH_PRACTICE_SHEETS_TABLE,
            len(dropped_paths),
            ', '.join(dropped_paths),
        )
    else:
        logger.info(
            'Legacy %s table not found in any kid DB at startup.',
            LEGACY_MATH_PRACTICE_SHEETS_TABLE,
        )

    if errors:
        logger.error(
            'Errors while dropping legacy %s table: %s',
            LEGACY_MATH_PRACTICE_SHEETS_TABLE,
            '; '.join(errors),
        )
