"""Patch a backup zip to the max_point point_rule schema.

Usage:
    python migrate_point_rules_max_point_backup_zip.py <input_zip> <output_zip>

This migration rewrites shared_decks.duckdb.point_rule so rules store a
positive nullable max_point instead of signed points_delta / rating columns.
Reward rules are normalized to rule_kind='redeemed_reward' and reward_type='small'
for all existing rows.
"""
import os
import shutil
import sys
import tempfile
import zipfile

import duckdb


LEGACY_REWARD_RULE_KINDS = {
    'redeemed_reward',
    'redeemed_reward_small',
    'redeemed_reward_mid',
    'redeemed_reward_big',
}


def table_exists(conn, table_name):
    row = conn.execute(
        """
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_name = ?
        """,
        [table_name],
    ).fetchone()
    return bool(row and int(row[0] or 0) > 0)


def table_columns(conn, table_name):
    rows = conn.execute(f"PRAGMA table_info('{table_name}')").fetchall()
    return [str(row[1]) for row in rows]


def value_for(row, columns, name):
    try:
        index = columns.index(name)
    except ValueError:
        return None
    return row[index]


def coerce_abs_positive(value):
    if value is None:
        return None
    try:
        number = abs(int(value))
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def max_point_from_legacy(row, columns):
    points_delta = coerce_abs_positive(value_for(row, columns, 'points_delta'))
    if points_delta is not None:
        return points_delta
    rating_values = [
        coerce_abs_positive(value_for(row, columns, 'rating_1_points')),
        coerce_abs_positive(value_for(row, columns, 'rating_2_points')),
        coerce_abs_positive(value_for(row, columns, 'rating_3_points')),
    ]
    rating_values = [value for value in rating_values if value is not None]
    return max(rating_values) if rating_values else coerce_abs_positive(value_for(row, columns, 'max_point'))


def patch_point_rules(shared_db_path):
    conn = duckdb.connect(shared_db_path)
    try:
        if not table_exists(conn, 'point_rule'):
            return 0
        columns = table_columns(conn, 'point_rule')
        select_columns = ', '.join(columns)
        rows = conn.execute(f'SELECT {select_columns} FROM point_rule ORDER BY rule_id ASC').fetchall()

        conn.execute('CREATE SEQUENCE IF NOT EXISTS point_rule_id_seq')
        conn.execute('DROP TABLE IF EXISTS point_rule_new')
        conn.execute(
            """
            CREATE TABLE point_rule_new (
              rule_id INTEGER PRIMARY KEY DEFAULT nextval('point_rule_id_seq'),
              family_id INTEGER NOT NULL,
              name VARCHAR NOT NULL,
              emoji VARCHAR,
              rule_kind VARCHAR NOT NULL,
              trigger_key VARCHAR,
              max_point INTEGER,
              reward_type VARCHAR,
              is_active BOOLEAN NOT NULL DEFAULT TRUE
            )
            """
        )
        for row in rows:
            raw_kind = str(value_for(row, columns, 'rule_kind') or '').strip().lower()
            is_reward = raw_kind in LEGACY_REWARD_RULE_KINDS
            rule_kind = 'redeemed_reward' if is_reward else raw_kind
            reward_type = 'small' if is_reward else None
            conn.execute(
                """
                INSERT INTO point_rule_new (
                  rule_id,
                  family_id,
                  name,
                  emoji,
                  rule_kind,
                  trigger_key,
                  max_point,
                  reward_type,
                  is_active
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    int(value_for(row, columns, 'rule_id') or 0),
                    int(value_for(row, columns, 'family_id') or 0),
                    str(value_for(row, columns, 'name') or ''),
                    value_for(row, columns, 'emoji'),
                    rule_kind,
                    value_for(row, columns, 'trigger_key'),
                    max_point_from_legacy(row, columns),
                    reward_type,
                    bool(value_for(row, columns, 'is_active')) if value_for(row, columns, 'is_active') is not None else True,
                ],
            )
        conn.execute('DROP TABLE point_rule')
        conn.execute('ALTER TABLE point_rule_new RENAME TO point_rule')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_point_rule_family_kind ON point_rule(family_id, rule_kind)')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_point_rule_family_trigger ON point_rule(family_id, rule_kind, trigger_key)')
        return len(rows)
    finally:
        conn.close()


def repack(unpacked_dir, output_zip_path):
    if os.path.exists(output_zip_path):
        os.remove(output_zip_path)
    with zipfile.ZipFile(output_zip_path, 'w', zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
        for dirpath, _dirnames, filenames in os.walk(unpacked_dir):
            for fname in filenames:
                full = os.path.join(dirpath, fname)
                rel = os.path.relpath(full, unpacked_dir)
                zf.write(full, rel)


def run(input_zip, output_zip):
    if not os.path.isfile(input_zip):
        raise SystemExit(f'Input zip not found: {input_zip}')
    work_dir = tempfile.mkdtemp(prefix='migrate_point_rules_max_point_')
    try:
        unpacked = os.path.join(work_dir, 'unpacked')
        os.makedirs(unpacked, exist_ok=True)
        print(f'Unpacking {input_zip} -> {unpacked}')
        with zipfile.ZipFile(input_zip, 'r') as zf:
            zf.extractall(unpacked)

        shared_db = os.path.join(unpacked, 'shared_decks.duckdb')
        if not os.path.isfile(shared_db):
            raise SystemExit('shared_decks.duckdb missing in zip')

        row_count = patch_point_rules(shared_db)
        print(f'point_rule rows migrated: {row_count}')

        print(f'Repacking -> {output_zip}')
        repack(unpacked, output_zip)
        print('Done.')
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: python migrate_point_rules_max_point_backup_zip.py <input_zip> <output_zip>')
    run(sys.argv[1], sys.argv[2])
