"""DuckDB connection manager for individual kid databases"""
import duckdb
import os
from typing import Optional

DATA_DIR = os.path.join(os.path.dirname(__file__), '../../data')
SCHEMA_FILE = os.path.join(os.path.dirname(__file__), 'schema.sql')
BADGE_SCHEMA_FILE = os.path.join(os.path.dirname(__file__), 'schema_badges.sql')

_schema_sql_cache: Optional[str] = None

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


def _apply_schema_sql(conn: duckdb.DuckDBPyConnection) -> None:
    """Apply the current kid schema to an open connection."""
    conn.execute(_get_schema_sql())

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
    _apply_schema_sql(conn)
    conn.close()
    return db_path


def ensure_kid_database_schema_by_path(db_file_path: str) -> str:
    """Apply the current kid schema to an existing database file."""
    db_path = get_absolute_db_path(db_file_path)
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"Database not found at {db_file_path}")
    conn = duckdb.connect(db_path)
    _apply_schema_sql(conn)
    conn.close()
    return db_path


def get_kid_connection_by_path(db_file_path: str, read_only: bool = False) -> duckdb.DuckDBPyConnection:
    """Get connection using dbFilePath metadata.

    Note: read_only parameter is accepted but ignored. DuckDB does not allow
    mixing read-only and read-write connections to the same file, which causes
    'different configuration' errors under concurrent requests.
    """
    db_path = get_absolute_db_path(db_file_path)
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"Database not found at {db_file_path}")
    return duckdb.connect(db_path)


def delete_kid_database_by_path(db_file_path: str) -> bool:
    """Delete a kid database by dbFilePath."""
    db_path = get_absolute_db_path(db_file_path)
    if os.path.exists(db_path):
        os.remove(db_path)
        return True
    return False
