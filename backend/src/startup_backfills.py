"""Startup data cleanups for existing local kid DBs."""
from pathlib import Path

from src.db import kid_db

LEGACY_MATH_PRACTICE_SHEETS_TABLE = 'math_practice_sheets'
STARTUP_CLEANUP_SQL_FILE = Path(__file__).resolve().parent / 'db' / 'startup_cleanup.sql'


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


def _read_startup_cleanup_sql():
    """Return SQL statements to run against existing kid DBs at startup."""
    if not STARTUP_CLEANUP_SQL_FILE.exists():
        return ''
    return STARTUP_CLEANUP_SQL_FILE.read_text(encoding='utf-8').strip()


def ensure_kid_db_schema(logger):
    """Apply the current kid DB schema to every existing kid DB at startup."""
    updated_paths = []
    errors = []

    for db_path in _iter_kid_db_paths() or []:
        try:
            kid_db.ensure_kid_database_schema_by_path(str(db_path))
            updated_paths.append(str(db_path))
        except Exception as exc:
            errors.append(f'{db_path}: {exc}')

    if updated_paths:
        logger.info(
            'Applied current kid DB schema to %s DB(s): %s',
            len(updated_paths),
            ', '.join(updated_paths),
        )
    else:
        logger.info('No kid DB files found for startup schema sync.')

    if errors:
        logger.error(
            'Errors while applying current kid DB schema at startup: %s',
            '; '.join(errors),
        )


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


def run_kid_db_startup_cleanup_sql(logger):
    """Execute startup cleanup SQL against every existing kid DB."""
    cleanup_sql = _read_startup_cleanup_sql()
    if not cleanup_sql:
        logger.info('No kid DB startup cleanup SQL found.')
        return

    cleaned_paths = []
    errors = []

    for db_path in _iter_kid_db_paths() or []:
        conn = None
        try:
            conn = kid_db.duckdb.connect(str(db_path))
            conn.execute(cleanup_sql)
            cleaned_paths.append(str(db_path))
        except Exception as exc:
            errors.append(f'{db_path}: {exc}')
        finally:
            if conn is not None:
                conn.close()

    if cleaned_paths:
        logger.info(
            'Executed kid DB startup cleanup SQL for %s DB(s): %s',
            len(cleaned_paths),
            ', '.join(cleaned_paths),
        )
    else:
        logger.info('No kid DB files found for startup cleanup SQL.')

    if errors:
        logger.error(
            'Errors while executing kid DB startup cleanup SQL: %s',
            '; '.join(errors),
        )
