"""Temporary one-time startup backfills for live data cleanup."""
import json
import os
import re
from datetime import datetime, timezone

from src.db import kid_db, metadata
from src.db.shared_deck_db import SHARED_DB_PATH, get_shared_decks_connection
from src.routes.kids import build_chinese_pinyin_text, extract_shared_deck_tags_and_labels

TEMP_POLYPHONE_PINYIN_BACKFILL_VERSION = 'v1'
TEMP_BACKFILL_DIR = os.path.join(kid_db.DATA_DIR, 'startup_backfills')
TEMP_POLYPHONE_PINYIN_SENTINEL = os.path.join(
    TEMP_BACKFILL_DIR,
    f'chinese_polyphone_pinyin_backfill_{TEMP_POLYPHONE_PINYIN_BACKFILL_VERSION}.json',
)
SINGLE_CHINESE_CHAR_RE = re.compile(r'^[\u3400-\u9FFF\uF900-\uFAFF]$')
TYPE_I_BEHAVIOR = 'type_i'


def build_legacy_chinese_pinyin_text(text):
    """Reproduce the old one-reading pinyin generator used before this backfill."""
    normalized = str(text or '').strip()
    if not normalized:
        return ''
    try:
        from pypinyin import lazy_pinyin, Style  # type: ignore
    except Exception as exc:
        raise RuntimeError(
            'pypinyin is not installed. Install it in backend env: pip install pypinyin'
        ) from exc

    syllables = lazy_pinyin(
        normalized,
        style=Style.TONE,
        neutral_tone_with_five=True,
        strict=False,
        errors='default',
    )
    parts = [str(item or '').strip() for item in list(syllables or [])]
    parts = [item for item in parts if item]
    return ' '.join(parts)


def _get_first_normalized_tag(raw_tags):
    """Return normalized first tag for one deck row."""
    tags, _ = extract_shared_deck_tags_and_labels(raw_tags)
    return str(tags[0] if tags else '').strip()


def _get_chinese_type_i_category_keys():
    """Return category keys that should use Chinese-character polyphone backfill."""
    conn = get_shared_decks_connection()
    try:
        rows = conn.execute(
            """
            SELECT category_key
            FROM deck_category
            WHERE behavior_type = ?
              AND has_chinese_specific_logic = TRUE
            """,
            [TYPE_I_BEHAVIOR],
        ).fetchall()
    finally:
        conn.close()
    return {
        str(row[0] or '').strip()
        for row in rows
        if str(row[0] or '').strip()
    }


def _collect_stale_card_candidates_from_conn(conn, deck_table_name, deck_id_col, chinese_category_keys):
    """Collect cards still holding the old auto-generated single-reading pinyin."""
    deck_rows = conn.execute(
        f"SELECT {deck_id_col}, tags FROM {deck_table_name}"
    ).fetchall()
    target_deck_ids = {
        int(row[0])
        for row in deck_rows
        if int(row[0]) > 0 and _get_first_normalized_tag(row[1]) in chinese_category_keys
    }
    if not target_deck_ids:
        return []

    placeholders = ','.join(['?'] * len(target_deck_ids))
    card_rows = conn.execute(
        f"""
        SELECT id, front, back
        FROM cards
        WHERE deck_id IN ({placeholders})
        ORDER BY id ASC
        """,
        sorted(target_deck_ids),
    ).fetchall()

    candidates = []
    for row in card_rows:
        card_id = int(row[0] or 0)
        front = str(row[1] or '').strip()
        back = str(row[2] or '').strip()
        if card_id <= 0 or not SINGLE_CHINESE_CHAR_RE.fullmatch(front):
            continue
        legacy_back = build_legacy_chinese_pinyin_text(front)
        if not legacy_back or back != legacy_back:
            continue
        candidates.append({
            'card_id': card_id,
            'front': front,
            'old_back': back,
        })
    return candidates


def _apply_backfill_updates(db_path, candidates):
    """Apply new pinyin to the stale candidates in one DB."""
    if not candidates:
        return 0
    conn = kid_db.duckdb.connect(db_path)
    try:
        update_rows = []
        for item in candidates:
            new_back = str(build_chinese_pinyin_text(item['front']) or '').strip()
            if not new_back or new_back == item['old_back']:
                continue
            update_rows.append([new_back, int(item['card_id'])])
        if update_rows:
            conn.executemany("UPDATE cards SET back = ? WHERE id = ?", update_rows)
        return len(update_rows)
    finally:
        conn.close()


def _collect_shared_db_candidates(chinese_category_keys):
    """Collect stale shared-deck cards that still use the old single-reading pinyin."""
    if not os.path.exists(SHARED_DB_PATH):
        return []
    conn = get_shared_decks_connection()
    try:
        return _collect_stale_card_candidates_from_conn(
            conn,
            deck_table_name='deck',
            deck_id_col='deck_id',
            chinese_category_keys=chinese_category_keys,
        )
    finally:
        conn.close()


def _collect_kid_db_candidates(db_path, chinese_category_keys):
    """Collect stale kid-local cards that still use the old single-reading pinyin."""
    if not db_path or not os.path.exists(db_path):
        return []
    conn = kid_db.duckdb.connect(db_path)
    try:
        return _collect_stale_card_candidates_from_conn(
            conn,
            deck_table_name='decks',
            deck_id_col='id',
            chinese_category_keys=chinese_category_keys,
        )
    finally:
        conn.close()


def _write_sentinel(summary):
    """Persist one backfill summary atomically so startup only runs once."""
    os.makedirs(TEMP_BACKFILL_DIR, exist_ok=True)
    temp_path = f'{TEMP_POLYPHONE_PINYIN_SENTINEL}.tmp'
    with open(temp_path, 'w', encoding='utf-8') as handle:
        json.dump(summary, handle, ensure_ascii=True, indent=2, sort_keys=True)
    os.replace(temp_path, TEMP_POLYPHONE_PINYIN_SENTINEL)


def run_temp_polyphone_pinyin_backfill(logger):
    """Run one-time pinyin backfill for existing Chinese character cards."""
    if os.path.exists(TEMP_POLYPHONE_PINYIN_SENTINEL):
        logger.info(
            'Skipping temp Chinese polyphone pinyin backfill; sentinel already exists: %s',
            TEMP_POLYPHONE_PINYIN_SENTINEL,
        )
        return

    chinese_category_keys = _get_chinese_type_i_category_keys()
    if not chinese_category_keys:
        summary = {
            'completed_at': datetime.now(timezone.utc).isoformat(),
            'reason': 'no_chinese_type_i_categories',
            'shared_updated_count': 0,
            'total_updated_count': 0,
            'version': TEMP_POLYPHONE_PINYIN_BACKFILL_VERSION,
        }
        _write_sentinel(summary)
        logger.info('Temp Chinese polyphone pinyin backfill skipped: no Chinese-specific type-I categories.')
        return

    errors = []
    shared_candidates = []
    kid_candidates_by_db = {}

    try:
        shared_candidates = _collect_shared_db_candidates(chinese_category_keys)
    except Exception as exc:
        errors.append(f'shared_db: {exc}')

    for kid in metadata.get_all_kids():
        db_file_path = str(kid.get('dbFilePath') or '').strip()
        if not db_file_path:
            continue
        try:
            db_path = kid_db.get_absolute_db_path(db_file_path)
            candidates = _collect_kid_db_candidates(db_path, chinese_category_keys)
            if candidates:
                kid_candidates_by_db[db_path] = {
                    'kid_id': str(kid.get('id') or ''),
                    'kid_name': str(kid.get('name') or ''),
                    'candidates': candidates,
                }
        except Exception as exc:
            errors.append(f'kid_{kid.get("id")}: {exc}')

    if errors:
        logger.error(
            'Temp Chinese polyphone pinyin backfill aborted during candidate scan: %s',
            '; '.join(errors),
        )
        return

    applied_errors = []
    shared_updated_count = 0
    if shared_candidates:
        try:
            shared_updated_count = _apply_backfill_updates(SHARED_DB_PATH, shared_candidates)
        except Exception as exc:
            applied_errors.append(f'shared_db: {exc}')

    kid_summaries = []
    total_updated_count = shared_updated_count
    for db_path, item in kid_candidates_by_db.items():
        try:
            updated_count = _apply_backfill_updates(db_path, item['candidates'])
            total_updated_count += updated_count
            kid_summaries.append({
                'db_path': db_path,
                'kid_id': item['kid_id'],
                'kid_name': item['kid_name'],
                'updated_count': updated_count,
            })
        except Exception as exc:
            applied_errors.append(f'kid_{item["kid_id"]}: {exc}')

    if applied_errors:
        logger.error(
            'Temp Chinese polyphone pinyin backfill finished with errors and will retry next startup: %s',
            '; '.join(applied_errors),
        )
        return

    summary = {
        'completed_at': datetime.now(timezone.utc).isoformat(),
        'shared_candidate_count': len(shared_candidates),
        'shared_updated_count': shared_updated_count,
        'kid_db_count_with_candidates': len(kid_candidates_by_db),
        'kid_updates': kid_summaries,
        'total_updated_count': total_updated_count,
        'version': TEMP_POLYPHONE_PINYIN_BACKFILL_VERSION,
    }
    _write_sentinel(summary)
    logger.info(
        'Temp Chinese polyphone pinyin backfill complete: shared=%s total=%s sentinel=%s',
        shared_updated_count,
        total_updated_count,
        TEMP_POLYPHONE_PINYIN_SENTINEL,
    )
