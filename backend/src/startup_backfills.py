"""Startup data cleanups for existing local kid DBs."""
import json
import os
import re
from pathlib import Path

from src.db import kid_db
from src.db.shared_deck_db import get_shared_decks_connection

LEGACY_MATH_PRACTICE_SHEETS_TABLE = 'math_practice_sheets'
STARTUP_CLEANUP_SQL_FILE = Path(__file__).resolve().parent / 'db' / 'startup_cleanup.sql'
CHINESE_MEANINGS_JSON = Path(__file__).resolve().parent / 'resources' / 'chinese_character_meanings.json'
SINGLE_CHINESE_CHAR_RE = re.compile(r'^[\u3400-\u9FFF\uF900-\uFAFF]$')


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


def _populate_chinese_character_bank(conn, logger):
    """Populate chinese_character_bank from JSON meanings + pypinyin."""
    try:
        with open(CHINESE_MEANINGS_JSON, 'r', encoding='utf-8') as f:
            meanings = json.load(f)
    except Exception as exc:
        logger.error('Failed to load chinese_character_meanings.json: %s', exc)
        return

    try:
        from pypinyin import pinyin, Style
        from pypinyin_dict.phrase_pinyin_data import cc_cedict
        from pypinyin_dict.pinyin_data import kxhc1983
        cc_cedict.load()
        kxhc1983.load()
    except Exception as exc:
        logger.error('pypinyin not available for character bank population: %s', exc)
        return

    rows = []
    for char, en in meanings.items():
        char = char.strip()
        en = en.strip()
        if not char or not en:
            continue
        readings = pinyin(
            char,
            style=Style.TONE,
            heteronym=True,
            neutral_tone_with_five=True,
            strict=False,
            errors='default',
        )
        first_group = readings[0] if readings else []
        seen = set()
        ordered = []
        for item in first_group:
            syllable = str(item or '').strip()
            if syllable and syllable not in seen:
                ordered.append(syllable)
                seen.add(syllable)
        pinyin_str = ' / '.join(ordered) if ordered else ''
        if not pinyin_str:
            continue
        rows.append((char, pinyin_str, en))

    conn.executemany(
        "INSERT INTO chinese_character_bank (character, pinyin, en) VALUES (?, ?, ?)",
        rows,
    )
    logger.info('Populated chinese_character_bank with %s characters from JSON + pypinyin.', len(rows))


def ensure_chinese_character_bank(logger):
    """Ensure chinese_character_bank table exists, populate if new, then update used column."""
    conn = get_shared_decks_connection()
    try:
        # Check if table exists
        exists = conn.execute("""
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'main' AND table_name = 'chinese_character_bank'
            LIMIT 1
        """).fetchone()

        if not exists:
            conn.execute("""
                CREATE TABLE chinese_character_bank (
                    character VARCHAR PRIMARY KEY,
                    pinyin VARCHAR NOT NULL,
                    en VARCHAR NOT NULL,
                    used BOOLEAN NOT NULL DEFAULT FALSE,
                    verified BOOLEAN NOT NULL DEFAULT FALSE,
                    last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)
            logger.info('Created chinese_character_bank table.')

        # Populate if table is empty (new or created empty by schema)
        count = conn.execute("SELECT COUNT(*) FROM chinese_character_bank").fetchone()[0]
        if count == 0:
            _populate_chinese_character_bank(conn, logger)

        # Collect all used Chinese characters from shared deck cards
        used_chars = set()
        shared_fronts = conn.execute("SELECT DISTINCT front FROM cards").fetchall()
        for row in shared_fronts:
            front = str(row[0] or '').strip()
            if SINGLE_CHINESE_CHAR_RE.fullmatch(front):
                used_chars.add(front)

        # Collect from all kid DBs
        for db_path in _iter_kid_db_paths() or []:
            kid_conn = None
            try:
                kid_conn = kid_db.duckdb.connect(str(db_path), read_only=True)
                kid_fronts = kid_conn.execute("SELECT DISTINCT front FROM cards").fetchall()
                for row in kid_fronts:
                    front = str(row[0] or '').strip()
                    if SINGLE_CHINESE_CHAR_RE.fullmatch(front):
                        used_chars.add(front)
            except Exception as exc:
                logger.warning('Failed to read cards from %s: %s', db_path, exc)
            finally:
                if kid_conn is not None:
                    kid_conn.close()

        # Reset all to unused, then mark used ones
        conn.execute("UPDATE chinese_character_bank SET used = FALSE")
        if used_chars:
            placeholders = ', '.join(['?'] * len(used_chars))
            conn.execute(
                f"UPDATE chinese_character_bank SET used = TRUE, last_updated = CURRENT_TIMESTAMP WHERE character IN ({placeholders})",
                list(used_chars),
            )

        total = conn.execute("SELECT COUNT(*) FROM chinese_character_bank").fetchone()[0]
        used_count = conn.execute("SELECT COUNT(*) FROM chinese_character_bank WHERE used = TRUE").fetchone()[0]
        logger.info(
            'Chinese character bank: %s total, %s used across shared and kid DBs.',
            total, used_count,
        )
    finally:
        conn.close()
