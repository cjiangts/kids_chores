"""DuckDB connection manager for individual kid databases"""
import duckdb
import os
from typing import Optional

DATA_DIR = os.path.join(os.path.dirname(__file__), '../../data')
SCHEMA_FILE = os.path.join(os.path.dirname(__file__), 'schema.sql')

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

def ensure_schema(conn: duckdb.DuckDBPyConnection):
    """Ensure base schema and migrations are applied."""
    with open(SCHEMA_FILE, 'r') as f:
        schema_sql = f.read()

    conn.execute(schema_sql)
    _apply_migrations(conn)

def get_kid_db_path(kid_id: str) -> str:
    """Get the file path for a kid's database"""
    os.makedirs(DATA_DIR, exist_ok=True)
    return os.path.join(DATA_DIR, f'kid_{kid_id}.db')


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
    ensure_schema(conn)
    conn.close()
    return db_path


def get_kid_connection_by_path(db_file_path: str) -> duckdb.DuckDBPyConnection:
    """Get connection using dbFilePath metadata."""
    db_path = get_absolute_db_path(db_file_path)
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"Database not found at {db_file_path}")
    conn = duckdb.connect(db_path)
    ensure_schema(conn)
    return conn


def delete_kid_database_by_path(db_file_path: str) -> bool:
    """Delete a kid database by dbFilePath."""
    db_path = get_absolute_db_path(db_file_path)
    if os.path.exists(db_path):
        os.remove(db_path)
        return True
    return False

def init_kid_database(kid_id: str) -> str:
    """Initialize a new database for a kid with schema"""
    db_path = get_kid_db_path(kid_id)

    # Connect and create schema
    conn = duckdb.connect(db_path)

    ensure_schema(conn)
    conn.close()

    return db_path

def get_kid_connection(kid_id: str) -> duckdb.DuckDBPyConnection:
    """Get a connection to a kid's database"""
    db_path = get_kid_db_path(kid_id)

    if not os.path.exists(db_path):
        raise FileNotFoundError(f"Database not found for kid {kid_id}")

    conn = duckdb.connect(db_path)
    ensure_schema(conn)
    return conn

def delete_kid_database(kid_id: str) -> bool:
    """Delete a kid's database file"""
    db_path = get_kid_db_path(kid_id)

    if os.path.exists(db_path):
        os.remove(db_path)
        return True
    return False
