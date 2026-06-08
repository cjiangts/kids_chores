"""DuckDB connection manager for individual kid databases"""
import duckdb
import os
import uuid
from typing import Optional

DATA_DIR = os.path.join(os.path.dirname(__file__), '../../data')
SCHEMA_FILE = os.path.join(os.path.dirname(__file__), 'schema.sql')

_schema_sql_cache: Optional[str] = None

def _get_schema_sql() -> str:
    """Read and cache schema.sql contents."""
    global _schema_sql_cache
    if _schema_sql_cache is None:
        parts = []
        for file_path in (SCHEMA_FILE,):
            if not os.path.exists(file_path):
                continue
            with open(file_path, 'r', encoding='utf-8') as f:
                parts.append(f.read().strip())
        _schema_sql_cache = '\n\n'.join(part for part in parts if part)
    return _schema_sql_cache


def _apply_schema_sql(conn: duckdb.DuckDBPyConnection) -> None:
    """Apply the current kid schema to an open connection."""
    conn.execute(_get_schema_sql())


def _connect_kid_db(db_path: str) -> duckdb.DuckDBPyConnection:
    """Open a kid DB connection with UTC as the only DB timestamp timezone."""
    conn = duckdb.connect(db_path)
    conn.execute("SET TimeZone='UTC'")
    return conn

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
    conn = _connect_kid_db(db_path)
    _apply_schema_sql(conn)
    conn.close()
    return db_path


def ensure_kid_database_schema_by_path(db_file_path: str) -> str:
    """Apply the current kid schema to an existing database file."""
    db_path = get_absolute_db_path(db_file_path)
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"Database not found at {db_file_path}")
    conn = _connect_kid_db(db_path)
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
    return _connect_kid_db(db_path)


def delete_kid_database_by_path(db_file_path: str) -> bool:
    """Delete a kid database by dbFilePath."""
    db_path = get_absolute_db_path(db_file_path)
    if os.path.exists(db_path):
        os.remove(db_path)
        return True
    return False


def rebuild_kid_database_by_path(db_file_path: str) -> dict:
    """Compact a kid DuckDB file by copying it into a fresh one, then swap it in.

    DuckDB never shrinks a file on its own — high-frequency UPDATE/DELETE (per
    answer EMA, retries, session deletes) leaves dead row-groups that VACUUM /
    CHECKPOINT do not reclaim. `COPY FROM DATABASE` rebuilds schema + sequences
    + indexes + data into a clean file; we then atomically replace the original.
    Returns {old_bytes, new_bytes, reclaimed_bytes}.
    """
    db_path = get_absolute_db_path(db_file_path)
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"Database not found at {db_file_path}")
    old_bytes = os.path.getsize(db_path)
    tmp_path = f"{db_path}.rebuild-{uuid.uuid4().hex}.tmp"

    def _q(path):
        return path.replace("'", "''")

    conn = duckdb.connect()
    try:
        conn.execute("SET TimeZone='UTC'")
        conn.execute(f"ATTACH '{_q(db_path)}' AS old_db (READ_ONLY)")
        conn.execute(f"ATTACH '{_q(tmp_path)}' AS new_db")
        conn.execute("COPY FROM DATABASE old_db TO new_db")
        conn.execute("CHECKPOINT new_db")
    except Exception:
        conn.close()
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise
    conn.close()

    new_bytes = os.path.getsize(tmp_path)
    # Atomic on the same filesystem; existing open handles keep the old inode
    # until they close, new connections get the compacted file.
    os.replace(tmp_path, db_path)
    return {
        'old_bytes': old_bytes,
        'new_bytes': new_bytes,
        'reclaimed_bytes': max(0, old_bytes - new_bytes),
    }
