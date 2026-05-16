"""One-shot migration: backfill correct_time_ema columns on every kid DB.

The schema (backend/src/db/schema.sql) now adds the columns via ALTER TABLE IF NOT EXISTS,
so this script only needs to apply the schema and replay session_results to backfill.

Idempotent — safe to re-run (resets EMA before backfilling so values converge).

Usage:
    cd backend && source venv/bin/activate && python scripts/migrate_add_correct_time_ema.py
"""
import os
import sys
import glob

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import duckdb
from src.db.kid_db import _apply_schema_sql
from src.routes.kids_constants import PRACTICE_PRIORITY_CORRECT_TIME_EMA_ALPHA

ALPHA = float(PRACTICE_PRIORITY_CORRECT_TIME_EMA_ALPHA)


def migrate_one(db_path):
    conn = duckdb.connect(db_path)
    try:
        _apply_schema_sql(conn)

        # Reset before backfill so re-runs converge to the same value
        conn.execute("UPDATE cards SET correct_time_ema = NULL, correct_time_ema_count = 0")

        rows = conn.execute(
            """
            SELECT card_id, response_time_ms
            FROM session_results
            WHERE correct > 0
              AND response_time_ms IS NOT NULL
              AND response_time_ms > 0
            ORDER BY COALESCE(timestamp, CURRENT_TIMESTAMP) ASC, id ASC
            """
        ).fetchall()

        ema_by_card = {}
        count_by_card = {}
        for card_id, rt in rows:
            try:
                cid = int(card_id)
                x = float(rt)
            except (TypeError, ValueError):
                continue
            if cid <= 0 or x <= 0:
                continue
            prev = ema_by_card.get(cid)
            ema_by_card[cid] = x if prev is None else ALPHA * x + (1.0 - ALPHA) * prev
            count_by_card[cid] = count_by_card.get(cid, 0) + 1

        for cid, ema in ema_by_card.items():
            conn.execute(
                "UPDATE cards SET correct_time_ema = ?, correct_time_ema_count = ? WHERE id = ?",
                [float(ema), int(count_by_card[cid]), int(cid)],
            )

        return {
            'db_path': db_path,
            'cards_backfilled': len(ema_by_card),
            'attempts_replayed': len(rows),
        }
    finally:
        conn.close()


def main():
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    pattern = os.path.join(backend_dir, 'data', 'families', '*', 'kid_*.db')
    db_paths = sorted(glob.glob(pattern))
    if not db_paths:
        print('No kid databases found at', pattern)
        return
    print(f'Migrating {len(db_paths)} kid DB(s)...')
    for db_path in db_paths:
        report = migrate_one(db_path)
        rel = os.path.relpath(db_path, backend_dir)
        print(f"  {rel}: cards={report['cards_backfilled']} attempts={report['attempts_replayed']}")
    print('Done.')


if __name__ == '__main__':
    main()
