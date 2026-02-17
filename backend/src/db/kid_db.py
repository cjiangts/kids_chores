"""DuckDB connection manager for individual kid databases"""
import duckdb
import os
from typing import Optional

DATA_DIR = os.path.join(os.path.dirname(__file__), '../../data')
SCHEMA_FILE = os.path.join(os.path.dirname(__file__), 'schema.sql')

_schema_sql_cache: Optional[str] = None
_initialized_dbs: set = set()

def _get_schema_sql() -> str:
    """Read and cache schema.sql contents."""
    global _schema_sql_cache
    if _schema_sql_cache is None:
        with open(SCHEMA_FILE, 'r') as f:
            _schema_sql_cache = f.read()
    return _schema_sql_cache

def _apply_migrations(conn: duckdb.DuckDBPyConnection):
    """Apply safe schema migrations for existing kid databases."""
    migration_sql = [
        "ALTER TABLE sessions ADD COLUMN planned_count INTEGER",
        "ALTER TABLE session_results ADD COLUMN response_time_ms INTEGER",
        "ALTER TABLE cards ADD COLUMN hardness_score DOUBLE DEFAULT 0",
        "ALTER TABLE cards ADD COLUMN skip_practice BOOLEAN DEFAULT FALSE",
        "ALTER TABLE writing_sheets ADD COLUMN practice_rows INTEGER DEFAULT 1",
    ]

    for stmt in migration_sql:
        try:
            conn.execute(stmt)
        except Exception as e:
            # Ignore "already exists" style migration errors.
            if 'already exists' not in str(e).lower():
                raise

def ensure_schema(conn: duckdb.DuckDBPyConnection, db_path: str = ''):
    """Ensure base schema and migrations are applied. Skips if already done for this db_path."""
    if db_path and db_path in _initialized_dbs:
        return
    conn.execute(_get_schema_sql())
    _apply_migrations(conn)
    if db_path:
        _initialized_dbs.add(db_path)

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
        _initialized_dbs.discard(db_path)
        return True
    return False
