"""DuckDB file compaction — reclaim dead space DuckDB never frees on its own.

DuckDB does not shrink a file or reclaim row-groups left behind by UPDATE /
DELETE (VACUUM and CHECKPOINT are no-ops for space reclamation). The only way to
reclaim is to rebuild the file: COPY FROM DATABASE into a fresh file (which
preserves schema, sequences, indexes, and data) and atomically swap it in.
"""
import os
import uuid

import duckdb


def compact_duckdb_file(db_path: str) -> dict:
    """Compact one DuckDB file in place. Returns {old_bytes, new_bytes, reclaimed_bytes}.

    Writes a fresh compacted copy alongside the original, then atomically
    replaces it. Existing open handles keep the old inode until they close; new
    connections get the compacted file.
    """
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"Database not found at {db_path}")
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
    os.replace(tmp_path, db_path)
    return {
        'old_bytes': old_bytes,
        'new_bytes': new_bytes,
        'reclaimed_bytes': max(0, old_bytes - new_bytes),
    }
