"""DuckDB connection manager for shared, family-created math decks."""
import os
from typing import Optional

import duckdb

DATA_DIR = os.path.join(os.path.dirname(__file__), '../../data')
SHARED_DB_FILE_NAME = 'shared_math_decks.duckdb'
SHARED_DB_PATH = os.path.abspath(os.path.join(DATA_DIR, SHARED_DB_FILE_NAME))
SCHEMA_FILE = os.path.join(os.path.dirname(__file__), 'shared_math_deck_schema.sql')

_schema_sql_cache: Optional[str] = None
_initialized_dbs: set = set()


def _get_schema_sql() -> str:
    """Read and cache shared schema SQL."""
    global _schema_sql_cache
    if _schema_sql_cache is None:
        with open(SCHEMA_FILE, 'r', encoding='utf-8') as f:
            _schema_sql_cache = f.read()
    return _schema_sql_cache


def ensure_shared_math_schema(conn: duckdb.DuckDBPyConnection, db_path: str = ''):
    """Ensure shared deck schema exists for a connection."""
    if db_path and db_path in _initialized_dbs:
        return
    try:
        conn.execute("CREATE TYPE card_action AS ENUM ('ADD', 'DELETE')")
    except Exception as e:
        if 'already exists' not in str(e).lower():
            raise
    conn.execute(_get_schema_sql())
    if db_path:
        _initialized_dbs.add(db_path)


def init_shared_math_decks_database() -> str:
    """Initialize shared math decks database file and schema."""
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = duckdb.connect(SHARED_DB_PATH)
    ensure_shared_math_schema(conn, SHARED_DB_PATH)
    conn.close()
    return SHARED_DB_PATH
