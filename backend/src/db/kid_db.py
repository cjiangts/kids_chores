"""DuckDB connection manager for individual kid databases"""
import duckdb
import os
import threading
from typing import Optional

DATA_DIR = os.path.join(os.path.dirname(__file__), '../../data')
SCHEMA_FILE = os.path.join(os.path.dirname(__file__), 'schema.sql')
BADGE_SCHEMA_FILE = os.path.join(os.path.dirname(__file__), 'schema_badges.sql')

_schema_sql_cache: Optional[str] = None
_initialized_dbs: set = set()
_schema_init_lock = threading.Lock()

def _get_schema_sql() -> str:
    """Read and cache schema.sql contents."""
    global _schema_sql_cache
    if _schema_sql_cache is None:
        parts = []
        for file_path in (SCHEMA_FILE, BADGE_SCHEMA_FILE):
            if not os.path.exists(file_path):
                continue
            with open(file_path, 'r', encoding='utf-8') as f:
                parts.append(f.read().strip())
        _schema_sql_cache = '\n\n'.join(part for part in parts if part)
    return _schema_sql_cache

def _migrate_kid_schema(conn: duckdb.DuckDBPyConnection):
    """Add columns that may be missing from older kid databases."""
    try:
        cols = {
            row[0].lower()
            for row in conn.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name = 'math_practice_sheets'"
            ).fetchall()
        }
        if not cols:
            return
        new_cols = {
            'incorrect_count': 'INTEGER DEFAULT NULL',
        }
        for col_name, col_def in new_cols.items():
            if col_name not in cols:
                conn.execute(f"ALTER TABLE math_practice_sheets ADD COLUMN {col_name} {col_def}")
    except Exception:
        pass


def ensure_schema(conn: duckdb.DuckDBPyConnection, db_path: str = ''):
    """Ensure base schema is applied. Skips if already done for this db_path."""
    if db_path:
        with _schema_init_lock:
            if db_path in _initialized_dbs:
                return
            conn.execute(_get_schema_sql())
            _migrate_kid_schema(conn)
            _initialized_dbs.add(db_path)
        return
    conn.execute(_get_schema_sql())
    _migrate_kid_schema(conn)

def get_absolute_db_path(db_file_path: str) -> str:
    """Resolve a metadata dbFilePath (relative to backend/data) to absolute path."""
    rel = str(db_file_path or '').strip()
    if not rel:
        raise ValueError('db_file_path is required')
    if os.path.isabs(rel):
        return rel
    rel = rel.lstrip('/\\')
    if rel.startswith('data/'):
        rel = rel[5:]
    return os.path.join(DATA_DIR, rel)


def init_kid_database_by_path(db_file_path: str) -> str:
    """Initialize a kid database at provided dbFilePath."""
    db_path = get_absolute_db_path(db_file_path)
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = duckdb.connect(db_path)
    ensure_schema(conn, db_path)
    conn.close()
    return db_path


def get_kid_connection_by_path(db_file_path: str) -> duckdb.DuckDBPyConnection:
    """Get connection using dbFilePath metadata."""
    db_path = get_absolute_db_path(db_file_path)
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"Database not found at {db_file_path}")
    conn = duckdb.connect(db_path)
    ensure_schema(conn, db_path)
    return conn


def delete_kid_database_by_path(db_file_path: str) -> bool:
    """Delete a kid database by dbFilePath."""
    db_path = get_absolute_db_path(db_file_path)
    if os.path.exists(db_path):
        os.remove(db_path)
        with _schema_init_lock:
            _initialized_dbs.discard(db_path)
        return True
    return False
