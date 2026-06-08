"""DuckDB connection manager for shared, family-created decks."""
import os
from typing import Optional

import duckdb

from src.db.duckdb_maintenance import compact_duckdb_file

DATA_DIR = os.path.join(os.path.dirname(__file__), '../../data')
SHARED_DB_FILE_NAME = 'shared_decks.duckdb'
SHARED_DB_PATH = os.path.abspath(os.path.join(DATA_DIR, SHARED_DB_FILE_NAME))
SCHEMA_FILE = os.path.join(os.path.dirname(__file__), 'shared_deck_schema.sql')
POINTS_SCHEMA_FILE = os.path.join(os.path.dirname(__file__), 'shared_deck_points.sql')

_schema_sql_cache: Optional[str] = None


def _get_schema_sql() -> str:
    """Read and cache shared schema SQL."""
    global _schema_sql_cache
    if _schema_sql_cache is None:
        parts = []
        for file_path in (
            SCHEMA_FILE,
            POINTS_SCHEMA_FILE,
        ):
            if not os.path.exists(file_path):
                continue
            with open(file_path, 'r', encoding='utf-8') as f:
                parts.append(f.read().strip())
        _schema_sql_cache = '\n\n'.join(part for part in parts if part)
    return _schema_sql_cache


def _connect_shared_db() -> duckdb.DuckDBPyConnection:
    """Open the shared DB with UTC as the only DB timestamp timezone."""
    conn = duckdb.connect(SHARED_DB_PATH)
    conn.execute("SET TimeZone='UTC'")
    return conn


def init_shared_decks_database() -> str:
    """Initialize shared decks database file and schema."""
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = _connect_shared_db()
    conn.execute(_get_schema_sql())
    conn.close()
    return SHARED_DB_PATH


def get_shared_decks_connection(read_only: bool = False) -> duckdb.DuckDBPyConnection:
    """Get connection to shared decks database.

    Note: read_only parameter is accepted but ignored. DuckDB does not allow
    mixing read-only and read-write connections to the same file, which causes
    'different configuration' errors under concurrent requests.
    """
    if not os.path.exists(SHARED_DB_PATH):
        init_shared_decks_database()
    return _connect_shared_db()


def rebuild_shared_decks_database() -> dict:
    """Compact the shared decks DuckDB file (reclaims dead space). See compact_duckdb_file."""
    return compact_duckdb_file(SHARED_DB_PATH)
