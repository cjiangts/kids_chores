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
        "ALTER TABLE practice_queue ADD COLUMN deck_id VARCHAR",
    ]

    for stmt in migration_sql:
        try:
            conn.execute(stmt)
        except Exception as e:
            # Ignore "already exists" style migration errors.
            if 'already exists' not in str(e).lower():
                raise

    # Backfill deck_id for existing queue rows.
    try:
        conn.execute("""
            UPDATE practice_queue q
            SET deck_id = c.deck_id
            FROM cards c
            WHERE q.card_id = c.id
              AND q.deck_id IS NULL
        """)
    except Exception:
        # Ignore if either table is not ready yet; schema execution handles creation.
        pass

    # Ensure deck-scoped cursor state table exists.
    conn.execute("""
        CREATE TABLE IF NOT EXISTS practice_state_by_deck (
            deck_id VARCHAR PRIMARY KEY,
            queue_cursor INTEGER NOT NULL DEFAULT 0
        )
    """)

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
