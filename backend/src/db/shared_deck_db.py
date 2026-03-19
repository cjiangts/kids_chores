"""DuckDB connection manager for shared, family-created decks."""
import os
from typing import Optional

import duckdb

DATA_DIR = os.path.join(os.path.dirname(__file__), '../../data')
SHARED_DB_FILE_NAME = 'shared_decks.duckdb'
SHARED_DB_PATH = os.path.abspath(os.path.join(DATA_DIR, SHARED_DB_FILE_NAME))
FRONTEND_BADGES_NOTO_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), '../../../frontend/assets/badges-noto')
)
SCHEMA_FILE = os.path.join(os.path.dirname(__file__), 'shared_deck_schema.sql')
BADGE_ART_SCHEMA_FILE = os.path.join(os.path.dirname(__file__), 'shared_deck_badge_art.sql')
ACHIEVEMENT_BADGE_MAP_SCHEMA_FILE = os.path.join(
    os.path.dirname(__file__),
    'shared_deck_achievement_badge_map.sql',
)

_schema_sql_cache: Optional[str] = None


def _get_schema_sql() -> str:
    """Read and cache shared schema SQL."""
    global _schema_sql_cache
    if _schema_sql_cache is None:
        parts = []
        for file_path in (
            SCHEMA_FILE,
            BADGE_ART_SCHEMA_FILE,
            ACHIEVEMENT_BADGE_MAP_SCHEMA_FILE,
        ):
            if not os.path.exists(file_path):
                continue
            with open(file_path, 'r', encoding='utf-8') as f:
                parts.append(f.read().strip())
        _schema_sql_cache = '\n\n'.join(part for part in parts if part)
    return _schema_sql_cache


def _sync_noto_badge_bank(conn: duckdb.DuckDBPyConnection):
    """Register all locally-downloaded Noto badge assets as generic selectable art."""
    if not os.path.isdir(FRONTEND_BADGES_NOTO_DIR):
        return

    entries = []
    try:
        file_names = sorted(os.listdir(FRONTEND_BADGES_NOTO_DIR))
    except Exception:
        return

    for file_name in file_names:
        normalized = str(file_name or '').strip()
        if not normalized.startswith('noto-') or not normalized.endswith('.png'):
            continue
        image_path = f"assets/badges-noto/{normalized}"
        entries.append((
            'generic',
            image_path,
            'https://github.com/googlefonts/noto-emoji',
            'Apache-2.0',
            True,
        ))

    if not entries:
        return

    conn.executemany(
        """
        INSERT OR IGNORE INTO badge_art (
            theme_key,
            image_path,
            source_url,
            license,
            is_active
        )
        VALUES (?, ?, ?, ?, ?)
        """,
        entries,
    )
    conn.execute(
        """
        UPDATE badge_art
        SET
            theme_key = 'generic',
            source_url = 'https://github.com/googlefonts/noto-emoji',
            license = 'Apache-2.0',
            is_active = TRUE
        WHERE image_path LIKE 'assets/badges-noto/noto-%.png'
        """
    )

def init_shared_decks_database() -> str:
    """Initialize shared decks database file and schema."""
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = duckdb.connect(SHARED_DB_PATH)
    conn.execute(_get_schema_sql())
    _sync_noto_badge_bank(conn)
    conn.close()
    return SHARED_DB_PATH


def get_shared_decks_connection(read_only: bool = False) -> duckdb.DuckDBPyConnection:
    """Get connection to shared decks database."""
    if not os.path.exists(SHARED_DB_PATH):
        init_shared_decks_database()
    return duckdb.connect(SHARED_DB_PATH, read_only=read_only)
