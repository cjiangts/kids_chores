"""One-shot migration: swap front<->back on every type_ii card.

The pre-flip convention was: for type_ii decks the "primary" value (the
word/character the kid practices writing) lives in the `back` column, with
`front` carrying an optional clue. The rest of the codebase has `front` as the
primary value, so type_ii special-cased every dedupe/CSV/audio path.

Post-flip: `front` is the primary value for type_ii too. This script applies
the swap to a backup zip:
  - shared_decks.duckdb: type_ii decks (categories whose deck_category.behavior_type == 'type_ii')
  - every kid_*.db under families/family_*/: decks whose tags[1] is a type_ii category key
  - each kid's type2_chinese_print_sheets.layout_json snapshot rows (front/back per row)
  - wipes shared/writing_audio/ so files regenerate under the new (front, back)-keyed names

Usage:
    python migrate_type2_flip_front_back.py <input_zip> <output_zip>
"""
import json
import os
import shutil
import sys
import tempfile
import zipfile

import duckdb


def collect_type_ii_keys(shared_db_path):
    conn = duckdb.connect(shared_db_path, read_only=True)
    try:
        keys = [
            row[0]
            for row in conn.execute(
                "SELECT category_key FROM deck_category WHERE behavior_type = 'type_ii'"
            ).fetchall()
        ]
    finally:
        conn.close()
    if not keys:
        raise RuntimeError('No type_ii categories found in shared_decks.duckdb')
    return keys


def swap_in_shared(shared_db_path, type_ii_keys):
    conn = duckdb.connect(shared_db_path)
    try:
        placeholders = ','.join(['?'] * len(type_ii_keys))
        deck_ids = [
            int(row[0])
            for row in conn.execute(
                f"SELECT deck_id FROM deck WHERE tags[1] IN ({placeholders})",
                list(type_ii_keys),
            ).fetchall()
        ]
        if not deck_ids:
            return 0, 0
        deck_placeholders = ','.join(['?'] * len(deck_ids))
        n_before_neq = conn.execute(
            f"SELECT COUNT(*) FROM cards WHERE deck_id IN ({deck_placeholders}) AND front <> back",
            deck_ids,
        ).fetchone()[0]
        conn.execute(
            f"UPDATE cards SET front = back, back = front WHERE deck_id IN ({deck_placeholders})",
            deck_ids,
        )
        return len(deck_ids), int(n_before_neq)
    finally:
        conn.close()


def swap_in_kid(kid_db_path, type_ii_keys):
    conn = duckdb.connect(kid_db_path)
    try:
        placeholders = ','.join(['?'] * len(type_ii_keys))
        deck_ids = [
            int(row[0])
            for row in conn.execute(
                f"SELECT id FROM decks WHERE tags[1] IN ({placeholders})",
                list(type_ii_keys),
            ).fetchall()
        ]
        sheet_rows_swapped = swap_chinese_print_sheet_layouts(conn)
        if not deck_ids:
            return 0, 0, sheet_rows_swapped
        deck_placeholders = ','.join(['?'] * len(deck_ids))
        n_before_neq = conn.execute(
            f"SELECT COUNT(*) FROM cards WHERE deck_id IN ({deck_placeholders}) AND front <> back",
            deck_ids,
        ).fetchone()[0]
        conn.execute(
            f"UPDATE cards SET front = back, back = front WHERE deck_id IN ({deck_placeholders})",
            deck_ids,
        )
        return len(deck_ids), int(n_before_neq), sheet_rows_swapped
    finally:
        conn.close()


def swap_chinese_print_sheet_layouts(conn):
    """Swap front<->back in each row of every chinese_print_sheets layout_json."""
    try:
        rows = conn.execute(
            "SELECT id, layout_json FROM type2_chinese_print_sheets"
        ).fetchall()
    except duckdb.CatalogException:
        return 0
    total_swapped = 0
    for sheet_id, layout_json in rows:
        if not layout_json:
            continue
        try:
            layout = json.loads(layout_json)
        except (TypeError, ValueError):
            continue
        layout_rows = layout.get('rows')
        if not isinstance(layout_rows, list):
            continue
        changed = False
        for lr in layout_rows:
            if not isinstance(lr, dict):
                continue
            front = lr.get('front')
            back = lr.get('back')
            if front == back:
                continue
            lr['front'] = back
            lr['back'] = front
            changed = True
            total_swapped += 1
        if changed:
            conn.execute(
                "UPDATE type2_chinese_print_sheets SET layout_json = ? WHERE id = ?",
                [json.dumps(layout, ensure_ascii=False, separators=(',', ':')), int(sheet_id)],
            )
    return total_swapped


def wipe_shared_writing_audio(unpacked_root):
    """Delete every file under shared/writing_audio/ so they regenerate."""
    audio_dir = os.path.join(unpacked_root, 'shared', 'writing_audio')
    if not os.path.isdir(audio_dir):
        return 0
    removed = 0
    for entry in os.listdir(audio_dir):
        full = os.path.join(audio_dir, entry)
        if os.path.isfile(full):
            os.remove(full)
            removed += 1
    return removed


def find_kid_dbs(root):
    out = []
    families_dir = os.path.join(root, 'families')
    if not os.path.isdir(families_dir):
        return out
    for family_name in sorted(os.listdir(families_dir)):
        family_dir = os.path.join(families_dir, family_name)
        if not os.path.isdir(family_dir):
            continue
        for entry in sorted(os.listdir(family_dir)):
            if entry.startswith('kid_') and entry.endswith('.db'):
                out.append(os.path.join(family_dir, entry))
    return out


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
    work_dir = tempfile.mkdtemp(prefix='migrate_type2_flip_')
    try:
        unpacked = os.path.join(work_dir, 'unpacked')
        os.makedirs(unpacked, exist_ok=True)
        print(f'Unpacking {input_zip} -> {unpacked}')
        with zipfile.ZipFile(input_zip, 'r') as zf:
            zf.extractall(unpacked)

        shared_db = os.path.join(unpacked, 'shared_decks.duckdb')
        if not os.path.isfile(shared_db):
            raise SystemExit('shared_decks.duckdb missing in zip')
        type_ii_keys = collect_type_ii_keys(shared_db)
        print(f'type_ii categories: {type_ii_keys}')

        shared_decks_touched, shared_rows_neq = swap_in_shared(shared_db, type_ii_keys)
        print(f'shared: swapped in {shared_decks_touched} decks ({shared_rows_neq} non-trivial rows)')

        total_kid_decks = 0
        total_kid_neq = 0
        total_kid_sheet_rows = 0
        kid_dbs = find_kid_dbs(unpacked)
        for kid_db in kid_dbs:
            decks_n, neq_n, sheet_rows_n = swap_in_kid(kid_db, type_ii_keys)
            if decks_n or sheet_rows_n:
                rel = os.path.relpath(kid_db, unpacked)
                print(
                    f'  {rel}: swapped {decks_n} decks ({neq_n} non-trivial rows), '
                    f'sheet layout rows swapped: {sheet_rows_n}'
                )
            total_kid_decks += decks_n
            total_kid_neq += neq_n
            total_kid_sheet_rows += sheet_rows_n
        print(
            f'kid total: {total_kid_decks} decks ({total_kid_neq} non-trivial rows), '
            f'sheet layout rows swapped: {total_kid_sheet_rows}'
        )

        wiped_audio = wipe_shared_writing_audio(unpacked)
        print(f'shared/writing_audio: wiped {wiped_audio} files (will regenerate on demand)')

        print(f'Repacking -> {output_zip}')
        repack(unpacked, output_zip)
        print('Done.')
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print('Usage: migrate_type2_flip_front_back.py <input_zip> <output_zip>', file=sys.stderr)
        raise SystemExit(2)
    run(sys.argv[1], sys.argv[2])
