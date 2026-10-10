"""Rebuild kid DBs in a full backup ZIP without obsolete card EMA columns.

Usage:
    python migrate_drop_legacy_card_ema_backup_zip.py <input_zip> <output_zip>

The source ZIP is never changed. Each kid DB is exported, its ``cards`` table
definition is rewritten without ``correct_time_ema`` and
``correct_time_ema_count``, then imported into a replacement DuckDB file. This
preserves dependent views, indexes, sequences, and all data while avoiding an
unsafe in-place ``ALTER TABLE ... DROP COLUMN``.
"""
import os
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

import duckdb


LEGACY_COLUMNS = {'correct_time_ema', 'correct_time_ema_count'}
KID_DB_NAME_RE = re.compile(r'^kid_\d+\.db$')


def _sql_path(path):
    return str(path).replace("'", "''")


def _column_name(definition):
    match = re.match(r'\s*"?([A-Za-z_][A-Za-z0-9_]*)"?', definition)
    return match.group(1).lower() if match else ''


def _split_top_level_columns(body):
    parts, start, depth = [], 0, 0
    for index, char in enumerate(body):
        if char == '(':
            depth += 1
        elif char == ')':
            depth -= 1
        elif char == ',' and depth == 0:
            parts.append(body[start:index])
            start = index + 1
    parts.append(body[start:])
    return parts


def _rewrite_cards_create_statement(schema_text):
    match = re.search(r'CREATE\s+TABLE\s+cards\s*\(', schema_text, re.IGNORECASE)
    if not match:
        raise ValueError('Exported schema has no cards table')
    body_start = match.end()
    depth = 1
    for index in range(body_start, len(schema_text)):
        char = schema_text[index]
        if char == '(':
            depth += 1
        elif char == ')':
            depth -= 1
            if depth == 0:
                body_end = index
                break
    else:
        raise ValueError('Could not parse exported cards table definition')

    columns = _split_top_level_columns(schema_text[body_start:body_end])
    retained = [column for column in columns if _column_name(column) not in LEGACY_COLUMNS]
    if len(retained) == len(columns):
        return schema_text, False
    if not retained:
        raise ValueError('Refusing to create an empty cards table')
    return schema_text[:body_start] + ','.join(retained) + schema_text[body_end:], True


def _cards_columns(db_path):
    conn = duckdb.connect(str(db_path), read_only=True)
    try:
        return {str(row[1]).lower() for row in conn.execute("PRAGMA table_info('cards')").fetchall()}
    finally:
        conn.close()


def _rewrite_cards_parquet(export_dir):
    """Remove legacy fields from the exported cards parquet to match schema."""
    cards_parquet = export_dir / 'cards.parquet'
    if not cards_parquet.is_file():
        raise ValueError('Exported cards.parquet is missing')
    conn = duckdb.connect()
    try:
        descriptions = conn.execute(
            'DESCRIBE SELECT * FROM read_parquet(?)', [str(cards_parquet)]
        ).fetchall()
        column_names = [str(row[0]) for row in descriptions]
        retained = [name for name in column_names if name.lower() not in LEGACY_COLUMNS]
        if len(retained) == len(column_names):
            raise ValueError('Exported cards parquet has no legacy EMA columns')
        quoted_columns = ', '.join('"' + name.replace('"', '""') + '"' for name in retained)
        replacement = cards_parquet.with_suffix('.replacement.parquet')
        conn.execute(
            f"COPY (SELECT {quoted_columns} FROM read_parquet('{_sql_path(cards_parquet)}')) "
            f"TO '{_sql_path(replacement)}' (FORMAT PARQUET)"
        )
        os.replace(replacement, cards_parquet)
    finally:
        conn.close()


def migrate_kid_db(db_path):
    if not (_cards_columns(db_path) & LEGACY_COLUMNS):
        return False

    work_dir = Path(tempfile.mkdtemp(prefix='drop_legacy_card_ema_'))
    rebuilt_path = db_path.with_suffix('.rebuilt.db')
    try:
        export_dir = work_dir / 'export'
        source = duckdb.connect(str(db_path), read_only=True)
        try:
            source.execute(f"EXPORT DATABASE '{_sql_path(export_dir)}' (FORMAT PARQUET)")
        finally:
            source.close()

        schema_path = export_dir / 'schema.sql'
        schema_text, changed = _rewrite_cards_create_statement(schema_path.read_text())
        if not changed:
            return False
        schema_path.write_text(schema_text)
        _rewrite_cards_parquet(export_dir)

        rebuilt = duckdb.connect(str(rebuilt_path))
        try:
            rebuilt.execute(f"IMPORT DATABASE '{_sql_path(export_dir)}'")
        finally:
            rebuilt.close()

        if _cards_columns(rebuilt_path) & LEGACY_COLUMNS:
            raise RuntimeError('Rebuilt DB still contains legacy EMA columns')
        os.replace(rebuilt_path, db_path)
        return True
    finally:
        if rebuilt_path.exists():
            rebuilt_path.unlink()
        shutil.rmtree(work_dir, ignore_errors=True)


def _safe_extract(zip_file, destination):
    destination_root = destination.resolve()
    for member in zip_file.infolist():
        target = (destination / member.filename).resolve()
        if target != destination_root and destination_root not in target.parents:
            raise ValueError(f'Unsafe ZIP path: {member.filename}')
    zip_file.extractall(destination)


def repack(source_dir, output_zip):
    with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
        for file_path in sorted(source_dir.rglob('*')):
            if file_path.is_file():
                archive.write(file_path, file_path.relative_to(source_dir).as_posix())


def run(input_zip, output_zip):
    input_path, output_path = Path(input_zip).resolve(), Path(output_zip).resolve()
    if not input_path.is_file():
        raise SystemExit(f'Input ZIP not found: {input_path}')
    if output_path.exists():
        raise SystemExit(f'Refusing to overwrite existing output ZIP: {output_path}')

    work_dir = Path(tempfile.mkdtemp(prefix='migrate_card_ema_backup_'))
    try:
        unpacked = work_dir / 'unpacked'
        unpacked.mkdir()
        with zipfile.ZipFile(input_path, 'r') as archive:
            _safe_extract(archive, unpacked)

        migrated = []
        for db_path in sorted(unpacked.rglob('kid_*.db')):
            if KID_DB_NAME_RE.match(db_path.name) and migrate_kid_db(db_path):
                migrated.append(db_path.relative_to(unpacked).as_posix())
        if not migrated:
            raise SystemExit('No kid DB contained the legacy EMA columns; no output ZIP created.')

        repack(unpacked, output_path)
        print(f'Migrated {len(migrated)} kid DB(s):')
        for path in migrated:
            print(f'  {path}')
        print(f'Wrote: {output_path}')
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: migrate_drop_legacy_card_ema_backup_zip.py <input_zip> <output_zip>')
    run(sys.argv[1], sys.argv[2])
