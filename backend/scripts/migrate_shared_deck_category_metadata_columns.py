#!/usr/bin/env python3
"""One-time migration: add deck_category metadata columns to shared DB."""

import argparse
import os

import duckdb

DEFAULT_SHARED_DB_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), '..', 'data', 'shared_decks.duckdb')
)

def parse_args():
    parser = argparse.ArgumentParser(
        description='Add deck_category metadata columns for existing shared DB files.',
    )
    parser.add_argument(
        '--db-path',
        default=DEFAULT_SHARED_DB_PATH,
        help='Path to shared_decks.duckdb (default: backend shared DB path).',
    )
    return parser.parse_args()


def run_migration(db_path):
    abs_path = os.path.abspath(db_path)
    if not os.path.exists(abs_path):
        raise FileNotFoundError(f'Shared DB does not exist: {abs_path}')

    conn = duckdb.connect(abs_path)
    try:
        conn.execute(
            """
            ALTER TABLE deck_category
            ADD COLUMN IF NOT EXISTS has_chinese_specific_logic BOOLEAN DEFAULT FALSE
            """
        )
        conn.execute(
            """
            ALTER TABLE deck_category
            ADD COLUMN IF NOT EXISTS display_name VARCHAR
            """
        )
        conn.execute(
            """
            ALTER TABLE deck_category
            ADD COLUMN IF NOT EXISTS emoji VARCHAR
            """
        )
    finally:
        conn.close()
    return abs_path


def main():
    args = parse_args()
    migrated_path = run_migration(args.db_path)
    print(f'Migration completed for: {migrated_path}')


if __name__ == '__main__':
    main()
