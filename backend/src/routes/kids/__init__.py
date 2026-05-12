"""Kid management API routes"""
from flask import Blueprint, request, jsonify, send_from_directory, send_file, session
from datetime import datetime, timedelta, timezone
from collections import defaultdict
import hashlib
import math
import json
import os
import random
import shutil
import subprocess
import uuid
import time
import threading
import mimetypes
import re
from io import BytesIO
from urllib.parse import quote
from zoneinfo import ZoneInfo
from werkzeug.utils import secure_filename
from src.badges.session_sync import sync_badges_after_session_complete
from src.chinese_character_meanings import (
    get_bank_meaning,
    get_character_bank_pinyin,
    is_chinese_text,
    is_single_chinese_character,
)
from src.db import metadata, kid_db
from src.db.shared_deck_db import get_shared_decks_connection
from src.security_rate_limit import (
    CRITICAL_PASSWORD_RATE_LIMITER,
    build_critical_password_limit_key,
)
from src.type4_generator_preview import preview_type4_generator, run_type4_generator, test_type4_validate
from src.routes.kids_constants import *  # noqa: F401,F403

kids_bp = Blueprint('kids', __name__)

from src.services.pending_sessions import (
    _PENDING_SESSIONS,
    _PENDING_SESSIONS_LOCK,
    _cleanup_expired_pending_sessions,
    create_pending_session,
    get_pending_session,
    parse_client_started_at,
    pop_pending_session,
)
from src.services.practice_mode import (
    compose_session_practice_mode,
    get_session_practice_mode,
    get_session_practice_mode_base,
    is_drill_session_practice_mode,
    normalize_session_practice_mode,
    normalize_type_iv_practice_mode,
    parse_session_practice_mode,
)
from src.services.session_grading import (
    append_type1_result_submitted_answer,
    append_type4_result_submitted_answer,
    build_type1_result_item_payload,
    did_use_type_i_prompt_audio,
    encode_type1_submitted_grade,
    grade_type_iv_answer,
    insert_type1_result_item,
    insert_type4_result_item,
    normalize_type_i_distractor_answers,
    normalize_type_i_submitted_answer,
    normalize_type_iv_submitted_answer,
)
from src.services.card_stats import (
    delete_card_from_deck_internal,
    get_card_ids_practiced_for_category,
    get_cards_with_stats,
    get_cards_with_stats_for_card_ids,
    get_cards_with_stats_for_deck_ids,
    map_card_row,
)
from src.services.shared_deck_tag_paths import (
    find_shared_deck_tag_prefix_conflict,
    format_shared_deck_tag_path,
    get_all_shared_deck_tag_label_paths,
    get_all_shared_deck_tag_paths,
    normalize_shared_deck_tag_path,
)
from src.services.type4_session import (
    build_type_iv_choice_options,
    build_type_iv_continue_count_by_source_key,
    build_type_iv_initial_count_by_source_key,
    build_type_iv_pending_items_for_sources,
    distribute_type_iv_random_count_across_sources,
    get_type_iv_retry_source_result_rows,
    map_type_iv_pending_item_to_response_card,
)
from src.services.writing_candidates import (
    get_pending_writing_card_ids,
    get_writing_candidate_card_ids,
    get_writing_candidate_rows,
    remove_cards_from_type2_chinese_print_sheets,
)
from src.services.kid_today_sessions import (
    filter_answers_to_pending_cards,
    get_kid_today_bounds_utc,
    get_latest_retry_source_session_for_today,
    get_latest_unfinished_session_for_today,
    get_session_practiced_card_ids,
    normalize_logged_response_time_ms,
)
from src.services.practice_session import (
    build_continue_selected_cards_for_decks,
    build_retry_ready_payload,
    build_retry_selected_cards_for_sources,
    build_special_session_ready_payload,
    build_type_i_multiple_choice_pool_cards,
    get_practice_candidate_cards_for_decks,
    get_retry_source_wrong_card_ids,
    plan_deck_practice_selection_for_decks,
    preview_deck_practice_order_for_decks,
    update_card_hardness_after_session,
)
from src.services.shared_deck_queries import (
    find_shared_type_iv_representative_label_conflict,
    get_allowed_shared_deck_first_tags,
    get_kid_materialized_shared_decks_by_first_tag,
    get_kid_materialized_shared_type_ii_decks,
    get_shared_deck_behavior_type_from_raw_tags,
    get_shared_deck_cards,
    get_shared_deck_owned_by_family,
    get_shared_deck_rows_by_first_tag,
    get_shared_type_ii_deck_rows,
    get_shared_type_iv_deck_rows,
    is_shared_deck_chinese_type_i,
)

_SHARED_DECK_MUTATION_LOCK = threading.RLock()


def get_family_root(family_id):
    """Return filesystem root for one family."""
    return os.path.join(FAMILIES_ROOT, f'family_{family_id}')


def encode_retry_recovered_session_result(existing_retry_count):
    """Return the negative correct value for a card fixed in the next retry round."""
    retry_count = max(0, int(existing_retry_count or 0))
    return -(retry_count + 2)


from src.services.writing_audio import (
    build_shared_type1_prompt_audio_file_name,
    build_shared_writing_audio_file_name,
    build_type_i_chinese_audio_meta_for_front,
    build_type_i_chinese_prompt_audio_payload,
    build_writing_audio_meta_for_front,
    build_writing_front_tts_text,
    build_writing_prompt_audio_payload,
    cleanup_type3_pending_audio_files_by_payload,
    cleanup_uncommitted_type3_audio,
    ensure_shared_writing_audio_dir,
    ensure_type3_audio_dir,
    format_type2_bulk_card_text,
    get_kid_type3_audio_dir,
    get_shared_writing_audio_dir,
    get_writing_tts_language,
    normalize_writing_audio_text,
    synthesize_shared_writing_audio,
)
from src.services.family_auth import (
    can_family_access_deck_category,
    current_family_id,
    get_current_family_id_int,
    get_kid_connection_for,
    get_kid_for_family,
    is_super_family_id,
    require_critical_password,
    require_super_family,
)


from src.services.shared_deck_normalize import (
    build_shared_deck_tags,
    dedupe_shared_deck_cards_by_back,
    dedupe_shared_deck_cards_by_front,
    dedupe_shared_deck_cards_by_key,
    extract_shared_deck_tags_and_labels,
    format_shared_deck_tag_display_label,
    normalize_deck_category_keys,
    normalize_optional_bool,
    normalize_optional_display_name,
    normalize_shared_deck_cards,
    normalize_shared_deck_category_behavior,
    normalize_shared_deck_fronts,
    normalize_shared_deck_ids,
    normalize_shared_deck_tag,
    normalize_type_iv_daily_count,
    normalize_type_iv_daily_counts_payload,
    normalize_type_iv_display_label,
    normalize_type_iv_generator_code,
    normalize_type_iv_multichoice_only,
    parse_shared_deck_tag_with_comment,
    sanitize_deck_mix_payload,
)
from src.services.shared_deck_category import (
    get_session_behavior_type,
    get_shared_deck_categories,
    get_shared_deck_category_meta_by_key,
    invalidate_category_meta_cache,
    is_type_iii_session_type,
)
from src.services.type4_print_layout import (
    _safe_positive_int_or_none,
    build_shared_deck_print_cell_design,
    build_type_iv_print_sheet_display_number,
    build_type_iv_print_sheet_layout,
    build_type_iv_print_sheet_layout_payload,
    build_type_iv_print_sheet_row_seed,
    get_type_iv_print_sheet_paper_spec,
    get_type_iv_print_sheet_row_metrics,
    normalize_type_iv_print_cell_design,
    normalize_type_iv_print_sheet_inline_font_scale,
    normalize_type_iv_print_sheet_paper_size,
    normalize_type_iv_print_sheet_repeat_count,
    normalize_type_iv_print_sheet_row_scale,
    normalize_type_iv_print_sheet_rows,
)



from src.services.shared_deck_materialize import (
    build_materialized_shared_deck_name,
    build_materialized_shared_deck_tags,
    get_materialized_shared_deck_rows_by_shared_deck_id,
    parse_shared_deck_id_from_materialized_name,
    sync_materialized_shared_deck_metadata_for_all_kids,
    sync_materialized_shared_deck_metadata_for_kid,
)


from src.services.kid_category_config import (
    get_category_drill_speed_cutoff_ms_for_kid,
    get_category_include_orphan_for_kid,
    get_category_orphan_deck,
    get_category_orphan_deck_name,
    get_category_session_card_count_for_kid,
    get_or_create_category_orphan_deck,
    hydrate_kid_category_config_from_db,
    with_preview_session_count_for_category,
)


from src.services.deck_source_merge import (
    _build_orphan_source_deck_entry,
    _build_shared_source_deck_entry,
    get_card_count_summary_by_deck_ids,
    get_shared_merged_source_decks_for_kid,
    get_shared_type_i_merged_source_decks_for_kid,
    get_shared_type_ii_merged_source_decks_for_kid,
    get_shared_type_iv_merged_source_decks_for_kid,
    get_type_iv_bank_source_rows,
    get_type_iv_total_daily_target_for_category,
)

from src.services.practice_priority import build_practice_priority_preview_for_decks
from src.services.chinese_text import (
    CHINESE_BACK_CONTENTS,
    CHINESE_BACK_CONTENT_ENGLISH,
    CHINESE_BACK_CONTENT_PINYIN,
    build_chinese_auto_back_text,
    build_chinese_pinyin_text,
    get_category_chinese_back_content,
    get_shared_deck_chinese_back_content,
    normalize_chinese_back_content,
)
from src.services.type4_generator_definitions import (
    build_type_iv_card_generator_details_by_shared_id,
    build_type_iv_generator_detail_maps,
    build_type_iv_generator_details_by_representative_front,
    get_shared_deck_generator_definition,
    get_shared_deck_generator_definitions_by_deck_ids,
    parse_shared_deck_generator_definition_row,
    shared_deck_generator_definition_has_column,
    shared_deck_generator_definition_has_multichoice_only_column,
    shared_deck_generator_definition_has_print_cell_design_columns,
)
from src.services.type4_print_sheet import (
    build_type_iv_print_sheet_rendered_rows,
    get_type_iv_print_sheet_record,
    paginate_type_iv_print_sheet_rendered_rows,
)
from src.services.kid_card_queries import (
    get_kid_card_backs_for_deck_ids,
    get_kid_card_fronts_for_deck_ids,
    get_shared_deck_dedupe_key,
)
from src.services.kid_daily_progress import (
    build_kid_daily_progress_section,
    get_deck_category_display_name,
    get_kid_active_card_count_by_deck_category,
    get_kid_daily_completed_by_deck_category,
    get_kid_daily_percent_by_deck_category,
    get_kid_daily_star_tiers_by_deck_category,
    get_kid_dashboard_stats,
    get_kid_opted_in_deck_category_keys,
    get_kid_practice_target_by_deck_category,
    get_kid_scoped_db_relpath,
    get_kid_ungraded_type_iii_count,
    get_type_iii_category_keys,
)
from src.services.kid_category_resolve import (
    resolve_kid_category_with_mode,
    resolve_kid_deck_category_key_for_behavior,
    resolve_kid_type_i_category_key,
    resolve_kid_type_i_category_with_mode,
    resolve_kid_type_i_chinese_category_key,
    resolve_kid_type_ii_category_with_mode,
    resolve_kid_type_iii_category_with_mode,
    resolve_kid_type_iv_category_with_mode,
)


def get_orphan_deck(conn, orphan_deck_name):
    """Look up orphan deck id by name (read-only, no auto-create). Returns 0 if missing."""
    deck_name = str(orphan_deck_name or '').strip()
    if not deck_name:
        return 0
    result = conn.execute(
        "SELECT id FROM decks WHERE name = ?",
        [deck_name]
    ).fetchone()
    return int(result[0]) if result else 0


def get_or_create_orphan_deck(conn, orphan_deck_name, first_tag):
    """Get or create one reserved orphan deck by explicit name/tag."""
    deck_name = str(orphan_deck_name or '').strip()
    tag = normalize_shared_deck_tag(first_tag)
    if not deck_name or not tag:
        raise ValueError('orphan deck name and first tag are required')

    result = conn.execute(
        "SELECT id FROM decks WHERE name = ?",
        [deck_name]
    ).fetchone()
    if result:
        return int(result[0])

    row = conn.execute(
        """
        INSERT INTO decks (name, tags)
        VALUES (?, ?)
        RETURNING id
        """,
        [deck_name, [tag, 'orphan']]
    ).fetchone()
    return int(row[0])


def split_writing_bulk_text(raw_text):
    """Split bulk writing input by non-Chinese chars, preserving Chinese phrase chunks."""
    text = str(raw_text or '')
    # Match contiguous Chinese runs; separators are any non-Chinese chars.
    chunks = re.findall(r'[\u3400-\u9FFF\uF900-\uFAFF]+', text)
    deduped = []
    seen = set()
    for chunk in chunks:
        token = chunk.strip()
        if not token or token in seen:
            continue
        deduped.append(token)
        seen.add(token)
    return deduped


def split_type2_bulk_rows(raw_text, has_chinese_specific_logic):
    """Split bulk type-II input into (front, back) rows."""
    text = str(raw_text or '')
    if bool(has_chinese_specific_logic):
        text = text.replace('\uff0c', ',')
    non_empty_lines = [
        str(raw or '').strip()
        for raw in text.splitlines()
        if str(raw or '').strip()
    ]
    if not non_empty_lines:
        return []

    has_csv = any(',' in line for line in non_empty_lines)
    has_blob = any(',' not in line for line in non_empty_lines)
    if has_csv and has_blob:
        raise ValueError(
            'Mixed formats are not allowed. Use either "prompt, word" on every line '
            'or a word blob with no commas — not both.'
        )

    if bool(has_chinese_specific_logic):
        if has_csv:
            rows = []
            seen_back = set()
            for line in non_empty_lines:
                parts = line.split(',', 1)
                front = str(parts[0] or '').strip()
                back = str(parts[1] or '').strip()
                if not back:
                    back = front
                if not front or not back or back in seen_back:
                    continue
                seen_back.add(back)
                rows.append((front, back))
            return rows
        tokens = split_writing_bulk_text(raw_text)
        return [(token, token) for token in tokens]

    rows = []
    seen_front = set()
    for line in non_empty_lines:
        if has_csv:
            parts = line.split(',', 1)
            front = str(parts[0] or '').strip()
            back = str(parts[1] or '').strip()
            if not back:
                back = front
            if not front or front in seen_front:
                continue
            seen_front.add(front)
            rows.append((front, back))
        else:
            for token in line.split():
                tok = str(token or '').strip()
                if not tok or tok in seen_front:
                    continue
                seen_front.add(tok)
                rows.append((tok, tok))
    return rows


def build_type_i_shared_decks_payload(
    kid,
    category_key,
    *,
    session_card_count_override=None,
    include_orphan_in_queue_override=None,
    include_category_key=True,
):
    """Build shared-deck opt-in payload for one type-I category."""
    shared_conn = None
    kid_conn = None
    orphan_deck_payload = None
    local_by_shared_id = {}
    local_card_count_by_deck_id = {}
    try:
        shared_conn = get_shared_decks_connection(read_only=True)
        decks = get_shared_deck_rows_by_first_tag(shared_conn, category_key)

        kid_conn = get_kid_connection_for(kid, read_only=True)
        materialized_by_local_id = get_kid_materialized_shared_decks_by_first_tag(
            kid_conn,
            category_key,
        )
        for entry in materialized_by_local_id.values():
            shared_deck_id = int(entry['shared_deck_id'])
            existing = local_by_shared_id.get(shared_deck_id)
            if existing is None or int(entry['local_deck_id']) < int(existing['local_deck_id']):
                local_by_shared_id[shared_deck_id] = entry

        local_deck_ids = [int(deck_id) for deck_id in materialized_by_local_id.keys()]
        if local_deck_ids:
            placeholders = ','.join(['?'] * len(local_deck_ids))
            card_count_rows = kid_conn.execute(
                f"""
                SELECT deck_id, COUNT(*) AS card_count
                FROM cards
                WHERE deck_id IN ({placeholders})
                GROUP BY deck_id
                """,
                local_deck_ids
            ).fetchall()
            local_card_count_by_deck_id = {
                int(row[0]): int(row[1] or 0)
                for row in card_count_rows
            }

        orphan_deck_name = get_category_orphan_deck_name(category_key)
        orphan_deck_id = get_category_orphan_deck(kid_conn, category_key)
        orphan_row = kid_conn.execute(
            "SELECT id, name, tags FROM decks WHERE id = ? LIMIT 1",
            [orphan_deck_id]
        ).fetchone()
        orphan_name = str(orphan_row[1] or orphan_deck_name) if orphan_row else orphan_deck_name
        orphan_total = int(kid_conn.execute(
            "SELECT COUNT(*) FROM cards WHERE deck_id = ?",
            [orphan_deck_id]
        ).fetchone()[0] or 0)
        orphan_active = int(kid_conn.execute(
            "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = FALSE",
            [orphan_deck_id]
        ).fetchone()[0] or 0)
        orphan_skipped = int(kid_conn.execute(
            "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = TRUE",
            [orphan_deck_id]
        ).fetchone()[0] or 0)
        orphan_deck_payload = {
            'deck_id': orphan_deck_id,
            'name': orphan_name,
            'card_count': orphan_total,
            'active_card_count': orphan_active,
            'skipped_card_count': orphan_skipped,
        }
    finally:
        if kid_conn is not None:
            kid_conn.close()
        if shared_conn is not None:
            shared_conn.close()

    shared_deck_id_set = set()
    for deck in decks:
        shared_deck_id = int(deck['deck_id'])
        shared_deck_id_set.add(shared_deck_id)
        local_entry = local_by_shared_id.get(shared_deck_id)
        materialized_name = (
            str(local_entry['local_name'])
            if local_entry
            else build_materialized_shared_deck_name(deck['deck_id'], deck['name'])
        )
        materialized_deck_id = int(local_entry['local_deck_id']) if local_entry else None
        shared_card_count = int(deck.get('card_count') or 0)
        materialized_card_count = (
            int(local_card_count_by_deck_id.get(materialized_deck_id, 0))
            if materialized_deck_id is not None
            else None
        )
        deck['materialized_name'] = materialized_name
        deck['opted_in'] = local_entry is not None
        deck['materialized_deck_id'] = materialized_deck_id
        deck['shared_card_count'] = shared_card_count
        deck['materialized_card_count'] = materialized_card_count
        deck['has_update_warning'] = bool(
            local_entry is not None
            and materialized_card_count is not None
            and materialized_card_count != shared_card_count
        )
        deck['update_warning_reason'] = (
            'count_mismatch'
            if bool(deck['has_update_warning'])
            else ''
        )
        deck['mix_percent'] = 0
        deck['session_cards'] = 0

    # Keep kid-local materialized decks visible even if source shared deck was deleted.
    for shared_deck_id, local_entry in local_by_shared_id.items():
        if shared_deck_id in shared_deck_id_set:
            continue
        local_deck_id = int(local_entry['local_deck_id'])
        local_name = str(local_entry.get('local_name') or '')
        _, _, tail_name = local_name.partition('__')
        display_name = tail_name.strip() or local_name
        decks.append({
            'deck_id': int(shared_deck_id),
            'name': display_name,
            'tags': extract_shared_deck_tags_and_labels(local_entry.get('tags') or [])[0],
            'tag_labels': [str(tag) for tag in list(local_entry.get('tag_labels') or []) if str(tag or '').strip()],
            'creator_family_id': None,
            'created_at': None,
            'card_count': int(local_card_count_by_deck_id.get(local_deck_id, 0)),
            'materialized_name': local_name,
            'opted_in': True,
            'materialized_deck_id': local_deck_id,
            'shared_card_count': None,
            'materialized_card_count': int(local_card_count_by_deck_id.get(local_deck_id, 0)),
            'has_update_warning': True,
            'update_warning_reason': 'source_deleted',
            'mix_percent': 0,
            'session_cards': 0,
            'source_deleted': True,
        })

    session_card_count = (
        int(session_card_count_override)
        if session_card_count_override is not None
        else get_category_session_card_count_for_kid(kid, category_key)
    )
    include_orphan_in_queue = (
        bool(include_orphan_in_queue_override)
        if include_orphan_in_queue_override is not None
        else get_category_include_orphan_for_kid(kid, category_key)
    )
    for deck in decks:
        deck['session_cards'] = 0
    if orphan_deck_payload is not None:
        orphan_deck_payload['included_in_queue'] = bool(include_orphan_in_queue)

    payload = {
        'decks': decks,
        'deck_count': len(decks),
        'session_card_count': session_card_count,
        'include_orphan_in_queue': bool(include_orphan_in_queue),
        'orphan_deck': orphan_deck_payload,
    }
    if include_category_key:
        payload['category_key'] = category_key
    return payload


def build_type_iv_shared_decks_payload(
    kid,
    category_key,
    *,
    session_card_count_override=None,
    include_category_key=True,
    include_orphan_in_queue_override=None,
):
    """Build shared-deck opt-in payload for one type-IV category."""
    shared_conn = None
    kid_conn = None
    orphan_deck_payload = None
    local_by_shared_id = {}
    local_card_count_by_deck_id = {}
    local_representative_front_by_deck_id = {}
    local_daily_target_by_deck_id = {}
    try:
        shared_conn = get_shared_decks_connection(read_only=True)
        decks = get_shared_type_iv_deck_rows(shared_conn, category_key)

        kid_conn = get_kid_connection_for(kid, read_only=True)
        materialized_by_local_id = get_kid_materialized_shared_decks_by_first_tag(
            kid_conn,
            category_key,
        )
        for entry in materialized_by_local_id.values():
            shared_deck_id = int(entry['shared_deck_id'])
            existing = local_by_shared_id.get(shared_deck_id)
            if existing is None or int(entry['local_deck_id']) < int(existing['local_deck_id']):
                local_by_shared_id[shared_deck_id] = entry

        local_deck_ids = [int(deck_id) for deck_id in materialized_by_local_id.keys()]
        if local_deck_ids:
            placeholders = ','.join(['?'] * len(local_deck_ids))
            card_rows = kid_conn.execute(
                f"""
                SELECT
                    d.id AS deck_id,
                    COALESCE(d.daily_target_count, 0) AS daily_target_count,
                    COUNT(c.id) AS card_count,
                    ARG_MIN(c.front, c.id) AS representative_front
                FROM decks d
                LEFT JOIN cards c ON c.deck_id = d.id
                WHERE d.id IN ({placeholders})
                GROUP BY d.id, d.daily_target_count
                """,
                local_deck_ids
            ).fetchall()
            for row in card_rows:
                deck_id = int(row[0])
                local_daily_target_by_deck_id[deck_id] = int(row[1] or 0)
                local_card_count_by_deck_id[deck_id] = int(row[2] or 0)
                local_representative_front_by_deck_id[deck_id] = str(row[3] or '')

        orphan_deck_name = get_category_orphan_deck_name(category_key)
        orphan_row = kid_conn.execute(
            "SELECT id FROM decks WHERE name = ? LIMIT 1",
            [orphan_deck_name]
        ).fetchone()
        if orphan_row and int(orphan_row[0] or 0) > 0:
            candidate_payload = build_orphan_deck_payload(
                kid_conn,
                int(orphan_row[0]),
                orphan_deck_name,
            )
            if int(candidate_payload.get('card_count') or 0) > 0:
                orphan_deck_payload = candidate_payload
    finally:
        if kid_conn is not None:
            kid_conn.close()
        if shared_conn is not None:
            shared_conn.close()

    include_orphan_in_queue = (
        bool(include_orphan_in_queue_override)
        if include_orphan_in_queue_override is not None
        else get_category_include_orphan_for_kid(kid, category_key)
    )

    shared_deck_id_set = set()
    for deck in decks:
        shared_deck_id = int(deck['deck_id'])
        shared_deck_id_set.add(shared_deck_id)
        local_entry = local_by_shared_id.get(shared_deck_id)
        materialized_name = (
            str(local_entry['local_name'])
            if local_entry
            else build_materialized_shared_deck_name(deck['deck_id'], deck['name'])
        )
        materialized_deck_id = int(local_entry['local_deck_id']) if local_entry else None
        shared_card_count = int(deck.get('card_count') or 0)
        materialized_card_count = (
            int(local_card_count_by_deck_id.get(materialized_deck_id, 0))
            if materialized_deck_id is not None
            else None
        )
        deck['materialized_name'] = materialized_name
        deck['opted_in'] = local_entry is not None
        deck['materialized_deck_id'] = materialized_deck_id
        deck['shared_card_count'] = shared_card_count
        deck['materialized_card_count'] = materialized_card_count
        deck['has_update_warning'] = bool(
            local_entry is not None
            and materialized_card_count is not None
            and materialized_card_count != shared_card_count
        )
        deck['update_warning_reason'] = (
            'count_mismatch'
            if bool(deck['has_update_warning'])
            else ''
        )
        deck['mix_percent'] = 0
        deck['session_cards'] = 0
        deck['daily_target_count'] = (
            int(local_daily_target_by_deck_id.get(materialized_deck_id, 0))
            if materialized_deck_id is not None
            else 0
        )

    # Keep kid-local materialized decks visible even if source shared deck was deleted.
    for shared_deck_id, local_entry in local_by_shared_id.items():
        if shared_deck_id in shared_deck_id_set:
            continue
        local_deck_id = int(local_entry['local_deck_id'])
        local_name = str(local_entry.get('local_name') or '')
        _, _, tail_name = local_name.partition('__')
        display_name = tail_name.strip() or local_name
        decks.append({
            'deck_id': int(shared_deck_id),
            'name': display_name,
            'tags': extract_shared_deck_tags_and_labels(local_entry.get('tags') or [])[0],
            'tag_labels': [str(tag) for tag in list(local_entry.get('tag_labels') or []) if str(tag or '').strip()],
            'creator_family_id': None,
            'created_at': None,
            'card_count': int(local_card_count_by_deck_id.get(local_deck_id, 0)),
            'representative_front': str(local_representative_front_by_deck_id.get(local_deck_id) or ''),
            'materialized_name': local_name,
            'opted_in': True,
            'materialized_deck_id': local_deck_id,
            'shared_card_count': None,
            'materialized_card_count': int(local_card_count_by_deck_id.get(local_deck_id, 0)),
            'has_update_warning': True,
            'update_warning_reason': 'source_deleted',
            'mix_percent': 0,
            'session_cards': 0,
            'daily_target_count': int(local_daily_target_by_deck_id.get(local_deck_id, 0)),
            'source_deleted': True,
        })

    session_card_count = (
        int(session_card_count_override)
        if session_card_count_override is not None
        else (
            sum(int(deck.get('daily_target_count') or 0) for deck in decks if bool(deck.get('opted_in')))
            + (
                int(orphan_deck_payload.get('daily_target_count') or 0)
                if orphan_deck_payload is not None and include_orphan_in_queue
                else 0
            )
        )
    )
    if orphan_deck_payload is not None:
        orphan_deck_payload['included_in_queue'] = bool(include_orphan_in_queue)
    payload = {
        'decks': decks,
        'deck_count': len(decks),
        'session_card_count': session_card_count,
        'include_orphan_in_queue': bool(include_orphan_in_queue),
        'orphan_deck': orphan_deck_payload,
    }
    if include_category_key:
        payload['category_key'] = category_key
    return payload


def _fetch_shared_decks_by_ids(shared_conn, deck_ids):
    """Load shared deck metadata by ids and report missing ids."""
    normalized_ids = [int(deck_id) for deck_id in list(deck_ids or [])]
    if len(normalized_ids) == 0:
        return {}, []
    placeholders = ','.join(['?'] * len(normalized_ids))
    deck_rows = shared_conn.execute(
        f"""
        SELECT deck_id, name, tags
        FROM deck
        WHERE deck_id IN ({placeholders})
        """,
        normalized_ids
    ).fetchall()
    shared_by_id = {
        int(row[0]): {
            'deck_id': int(row[0]),
            'name': str(row[1]),
            'tags': extract_shared_deck_tags_and_labels(row[2])[0],
        }
        for row in deck_rows
    }
    missing_ids = [deck_id for deck_id in normalized_ids if deck_id not in shared_by_id]
    return shared_by_id, missing_ids


def opt_in_type_i_shared_decks(kid, category_key, deck_ids, has_chinese_specific_logic):
    """Materialize selected shared decks for one type-I category."""
    shared_conn = None
    kid_conn = None
    try:
        shared_conn = get_shared_decks_connection(read_only=True)
        shared_by_id, missing_ids = _fetch_shared_decks_by_ids(shared_conn, deck_ids)
        if missing_ids:
            return {
                'error': f'Shared deck(s) not found: {", ".join(str(v) for v in missing_ids)}'
            }, 404

        placeholders = ','.join(['?'] * len(deck_ids))
        invalid_tag_ids = [
            deck_id for deck_id in deck_ids
            if category_key not in shared_by_id[deck_id]['tags']
        ]
        if invalid_tag_ids:
            return {
                'error': (
                    f'Deck(s) are not {category_key}-tagged: '
                    f'{", ".join(str(v) for v in invalid_tag_ids)}'
                )
            }, 400

        card_rows = shared_conn.execute(
            f"""
            SELECT deck_id, front, back
            FROM cards
            WHERE deck_id IN ({placeholders})
            ORDER BY deck_id ASC, id ASC
            """,
            deck_ids
        ).fetchall()
        cards_by_deck_id = {}
        for row in card_rows:
            src_deck_id = int(row[0])
            cards_by_deck_id.setdefault(src_deck_id, []).append({
                'front': str(row[1]),
                'back': str(row[2]),
            })

        kid_conn = get_kid_connection_for(kid)
        existing_materialized = get_kid_materialized_shared_decks_by_first_tag(
            kid_conn,
            category_key,
        )
        occupied_fronts = get_kid_card_fronts_for_deck_ids(
            kid_conn,
            list(existing_materialized.keys())
        )
        created = []
        already_opted_in = []
        for src_deck_id in deck_ids:
            src_deck = shared_by_id[src_deck_id]
            materialized_name = build_materialized_shared_deck_name(src_deck_id, src_deck['name'])
            existing = kid_conn.execute(
                "SELECT id FROM decks WHERE name = ? LIMIT 1",
                [materialized_name]
            ).fetchone()
            if existing:
                already_opted_in.append({
                    'shared_deck_id': src_deck_id,
                    'shared_name': src_deck['name'],
                    'materialized_name': materialized_name,
                    'deck_id': int(existing[0]),
                })
                continue

            materialized_tags = build_materialized_shared_deck_tags(src_deck['tags'])
            inserted = kid_conn.execute(
                """
                INSERT INTO decks (name, tags)
                VALUES (?, ?)
                RETURNING id
                """,
                [materialized_name, materialized_tags]
            ).fetchone()
            local_deck_id = int(inserted[0])

            cards = cards_by_deck_id.get(src_deck_id, [])
            cards_added = 0
            cards_moved_from_orphan = 0
            cards_skipped_existing_front = 0
            if cards:
                orphan_deck_id = get_or_create_category_orphan_deck(kid_conn, category_key)
                source_fronts = []
                seen_fronts = set()
                for card in cards:
                    front = str(card.get('front') or '')
                    if front in seen_fronts:
                        continue
                    seen_fronts.add(front)
                    source_fronts.append(front)

                orphan_by_front = {}
                if source_fronts:
                    front_placeholders = ','.join(['?'] * len(source_fronts))
                    orphan_rows = kid_conn.execute(
                        f"""
                        SELECT id, front, back, skip_practice, hardness_score, created_at
                        FROM cards
                        WHERE deck_id = ?
                          AND front IN ({front_placeholders})
                        ORDER BY id ASC
                        """,
                        [orphan_deck_id, *source_fronts]
                    ).fetchall()
                    for row in orphan_rows:
                        row_front = str(row[1] or '')
                        if row_front in orphan_by_front:
                            continue
                        orphan_by_front[row_front] = row

                moved_rows = []
                insert_rows = []
                for card in cards:
                    front = str(card.get('front') or '')
                    if not front:
                        continue
                    if front in occupied_fronts:
                        cards_skipped_existing_front += 1
                        continue
                    orphan_row = orphan_by_front.pop(front, None)
                    if orphan_row is not None:
                        if has_chinese_specific_logic:
                            moved_rows.append((orphan_row, str(card.get('back') or '')))
                        else:
                            moved_rows.append(orphan_row)
                        occupied_fronts.add(front)
                        continue
                    insert_rows.append([local_deck_id, front, str(card.get('back') or '')])
                    occupied_fronts.add(front)

                if moved_rows:
                    moved_ids = [
                        int(row[0][0]) if has_chinese_specific_logic else int(row[0])
                        for row in moved_rows
                    ]
                    moved_placeholders = ','.join(['?'] * len(moved_ids))
                    # DuckDB can fail UPDATE on indexed columns; replace row with same id to "move" decks.
                    kid_conn.execute(
                        f"DELETE FROM cards WHERE id IN ({moved_placeholders})",
                        moved_ids
                    )
                    if has_chinese_specific_logic:
                        kid_conn.executemany(
                            """
                            INSERT INTO cards (id, deck_id, front, back, skip_practice, hardness_score, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                            """,
                            [
                                [
                                    int(orphan_row[0]),
                                    local_deck_id,
                                    str(orphan_row[1] or ''),
                                    shared_back,
                                    bool(orphan_row[3]),
                                    float(orphan_row[4] or 0.0),
                                    orphan_row[5],
                                ]
                                for orphan_row, shared_back in moved_rows
                            ]
                        )
                    else:
                        kid_conn.executemany(
                            """
                            INSERT INTO cards (id, deck_id, front, back, skip_practice, hardness_score, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                            """,
                            [
                                [
                                    int(row[0]),
                                    local_deck_id,
                                    str(row[1] or ''),
                                    str(row[2] or ''),
                                    bool(row[3]),
                                    float(row[4] or 0.0),
                                    row[5],
                                ]
                                for row in moved_rows
                            ]
                        )
                    cards_moved_from_orphan = len(moved_rows)

                if insert_rows:
                    kid_conn.executemany(
                        "INSERT INTO cards (deck_id, front, back) VALUES (?, ?, ?)",
                        insert_rows
                    )
                    cards_added = len(insert_rows)

            created.append({
                'shared_deck_id': src_deck_id,
                'shared_name': src_deck['name'],
                'materialized_name': materialized_name,
                'deck_id': local_deck_id,
                'cards_added': cards_added,
                'cards_moved_from_orphan': cards_moved_from_orphan,
                'cards_skipped_existing_front': cards_skipped_existing_front,
                'cards_total': len(cards),
            })
    finally:
        if kid_conn is not None:
            kid_conn.close()
        if shared_conn is not None:
            shared_conn.close()

    return {
        'requested_count': len(deck_ids),
        'created_count': len(created),
        'already_opted_in_count': len(already_opted_in),
        'created': created,
        'already_opted_in': already_opted_in,
    }, 200


def opt_out_type_i_shared_decks(kid, category_key, deck_ids):
    """Remove selected opted-in shared decks for one type-I category."""
    kid_conn = None
    try:
        kid_conn = get_kid_connection_for(kid)
        materialized_by_local_id = get_kid_materialized_shared_decks_by_first_tag(
            kid_conn,
            category_key,
        )
        local_by_shared_id = {
            int(entry['shared_deck_id']): {
                'local_deck_id': int(entry['local_deck_id']),
                'local_name': str(entry['local_name'] or ''),
            }
            for entry in materialized_by_local_id.values()
        }

        removed = []
        already_opted_out = []
        for shared_deck_id in deck_ids:
            local_entry = local_by_shared_id.get(shared_deck_id)
            if not local_entry:
                already_opted_out.append({
                    'shared_deck_id': int(shared_deck_id),
                })
                continue

            local_deck_id = int(local_entry['local_deck_id'])
            local_name = str(local_entry['local_name'])
            card_rows = kid_conn.execute(
                "SELECT id FROM cards WHERE deck_id = ?",
                [local_deck_id]
            ).fetchall()
            card_ids = [int(row[0]) for row in card_rows]
            card_count = len(card_ids)

            practiced_card_ids = []
            if card_ids:
                placeholders = ','.join(['?'] * len(card_ids))
                practiced_rows = kid_conn.execute(
                    f"""
                    SELECT DISTINCT card_id
                    FROM session_results
                    WHERE card_id IN ({placeholders})
                    """,
                    card_ids
                ).fetchall()
                practiced_card_ids = [int(row[0]) for row in practiced_rows]
            had_practice_sessions = len(practiced_card_ids) > 0

            if had_practice_sessions:
                orphan_deck_id = get_or_create_category_orphan_deck(kid_conn, category_key)
                practiced_placeholders = ','.join(['?'] * len(practiced_card_ids))
                practiced_cards = kid_conn.execute(
                    f"""
                    SELECT id, front, back, skip_practice, hardness_score, created_at
                    FROM cards
                    WHERE id IN ({practiced_placeholders})
                    """,
                    practiced_card_ids
                ).fetchall()
                if practiced_cards:
                    kid_conn.execute(
                        f"DELETE FROM cards WHERE id IN ({practiced_placeholders})",
                        practiced_card_ids
                    )
                    kid_conn.executemany(
                        """
                        INSERT INTO cards (id, deck_id, front, back, skip_practice, hardness_score, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        [
                            [
                                int(row[0]),
                                orphan_deck_id,
                                row[1],
                                row[2],
                                bool(row[3]),
                                float(row[4] or 0.0),
                                row[5],
                            ]
                            for row in practiced_cards
                        ]
                    )

                practiced_card_id_set = set(practiced_card_ids)
                unpracticed_ids = [
                    card_id for card_id in card_ids
                    if card_id not in practiced_card_id_set
                ]
                if unpracticed_ids:
                    unpracticed_placeholders = ','.join(['?'] * len(unpracticed_ids))
                    remove_cards_from_type2_chinese_print_sheets(kid_conn, unpracticed_ids)
                    kid_conn.execute(
                        f"""
                        DELETE FROM lesson_reading_audio
                        WHERE result_id IN (
                            SELECT id FROM session_results WHERE card_id IN ({unpracticed_placeholders})
                        )
                        """,
                        unpracticed_ids
                    )
                    kid_conn.execute(
                        f"DELETE FROM session_results WHERE card_id IN ({unpracticed_placeholders})",
                        unpracticed_ids
                    )
                    kid_conn.execute(
                        f"DELETE FROM cards WHERE id IN ({unpracticed_placeholders})",
                        unpracticed_ids
                    )
            else:
                # No practice yet: hard-delete cards and related rows.
                if card_ids:
                    placeholders = ','.join(['?'] * len(card_ids))
                    remove_cards_from_type2_chinese_print_sheets(kid_conn, card_ids)
                    # Safety no-op in clean state; prevents FK errors from stale rows.
                    kid_conn.execute(
                        f"DELETE FROM session_results WHERE card_id IN ({placeholders})",
                        card_ids
                    )
                kid_conn.execute("DELETE FROM cards WHERE deck_id = ?", [local_deck_id])

            kid_conn.execute("DELETE FROM decks WHERE id = ?", [local_deck_id])

            removed.append({
                'shared_deck_id': int(shared_deck_id),
                'deck_id': local_deck_id,
                'materialized_name': local_name,
                'had_practice_sessions': had_practice_sessions,
                'cards_removed': card_count - len(practiced_card_ids),
                'cards_detached': len(practiced_card_ids),
            })
    finally:
        if kid_conn is not None:
            kid_conn.close()

    return {
        'requested_count': len(deck_ids),
        'removed_count': len(removed),
        'already_opted_out_count': len(already_opted_out),
        'removed': removed,
        'already_opted_out': already_opted_out,
    }


def opt_in_type_iv_shared_decks(kid, category_key, deck_ids):
    """Materialize selected shared decks for one type-IV category."""
    shared_conn = None
    kid_conn = None
    try:
        shared_conn = get_shared_decks_connection(read_only=True)
        shared_by_id = {
            int(deck['deck_id']): deck
            for deck in get_shared_type_iv_deck_rows(shared_conn, category_key)
        }
        missing_ids = [deck_id for deck_id in deck_ids if deck_id not in shared_by_id]
        if missing_ids:
            return {
                'error': f'Shared deck(s) not found: {", ".join(str(v) for v in missing_ids)}'
            }, 404

        representative_rows = shared_conn.execute(
            f"""
            SELECT deck_id, front, back
            FROM cards
            WHERE deck_id IN ({','.join(['?'] * len(deck_ids))})
            ORDER BY deck_id ASC, id ASC
            """,
            deck_ids
        ).fetchall()
        representative_by_deck_id = {}
        for row in representative_rows:
            deck_id = int(row[0])
            if deck_id in representative_by_deck_id:
                continue
            representative_by_deck_id[deck_id] = {
                'front': str(row[1] or ''),
                'back': str(row[2] or ''),
            }

        invalid_definition_ids = []
        for deck_id in deck_ids:
            representative = representative_by_deck_id.get(deck_id)
            if not representative or not str(representative.get('front') or '').strip():
                invalid_definition_ids.append(deck_id)
        if invalid_definition_ids:
            return {
                'error': (
                    'Type-IV deck(s) are missing their representative card: '
                    f'{", ".join(str(v) for v in invalid_definition_ids)}'
                )
            }, 400

        kid_conn = get_kid_connection_for(kid)
        orphan_deck_id = None
        orphan_deck_row = kid_conn.execute(
            "SELECT id FROM decks WHERE name = ? LIMIT 1",
            [get_category_orphan_deck_name(category_key)]
        ).fetchone()
        if orphan_deck_row:
            orphan_deck_id = int(orphan_deck_row[0])
        representative_fronts = []
        seen_fronts = set()
        for deck_id in deck_ids:
            representative = representative_by_deck_id.get(deck_id) or {}
            front = str(representative.get('front') or '')
            if not front or front in seen_fronts:
                continue
            seen_fronts.add(front)
            representative_fronts.append(front)

        orphan_by_front = {}
        if orphan_deck_id is not None and representative_fronts:
            front_placeholders = ','.join(['?'] * len(representative_fronts))
            orphan_rows = kid_conn.execute(
                f"""
                SELECT id, front, back, skip_practice, hardness_score, created_at
                FROM cards
                WHERE deck_id = ?
                  AND front IN ({front_placeholders})
                ORDER BY id ASC
                """,
                [orphan_deck_id, *representative_fronts]
            ).fetchall()
            for row in orphan_rows:
                row_front = str(row[1] or '')
                if row_front in orphan_by_front:
                    continue
                orphan_by_front[row_front] = row

        created = []
        already_opted_in = []
        for src_deck_id in deck_ids:
            src_deck = shared_by_id[src_deck_id]
            materialized_name = build_materialized_shared_deck_name(src_deck_id, src_deck['name'])
            existing = kid_conn.execute(
                "SELECT id FROM decks WHERE name = ? LIMIT 1",
                [materialized_name]
            ).fetchone()
            if existing:
                already_opted_in.append({
                    'shared_deck_id': src_deck_id,
                    'shared_name': src_deck['name'],
                    'materialized_name': materialized_name,
                    'deck_id': int(existing[0]),
                })
                continue

            materialized_tags = build_materialized_shared_deck_tags(src_deck['tags'])
            inserted = kid_conn.execute(
                """
                INSERT INTO decks (name, tags, daily_target_count)
                VALUES (?, ?, ?)
                RETURNING id
                """,
                [
                    materialized_name,
                    materialized_tags,
                    DEFAULT_TYPE_IV_DAILY_TARGET_COUNT,
                ]
            ).fetchone()
            local_deck_id = int(inserted[0])

            representative = representative_by_deck_id[src_deck_id]
            representative_front = str(representative.get('front') or '')
            representative_back = str(representative.get('back') or '')
            orphan_row = orphan_by_front.pop(representative_front, None)
            cards_moved_from_orphan = 0
            if orphan_row is not None:
                moved_card_id = int(orphan_row[0])
                kid_conn.execute("DELETE FROM cards WHERE id = ?", [moved_card_id])
                kid_conn.execute(
                    """
                    INSERT INTO cards (id, deck_id, front, back, skip_practice, hardness_score, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        moved_card_id,
                        local_deck_id,
                        representative_front,
                        representative_back,
                        bool(orphan_row[3]),
                        float(orphan_row[4] or 0.0),
                        orphan_row[5],
                    ]
                )
                cards_moved_from_orphan = 1
            else:
                kid_conn.execute(
                    "INSERT INTO cards (deck_id, front, back) VALUES (?, ?, ?)",
                    [
                        local_deck_id,
                        representative_front,
                        representative_back,
                    ]
                )
            created.append({
                'shared_deck_id': src_deck_id,
                'shared_name': src_deck['name'],
                'materialized_name': materialized_name,
                'deck_id': local_deck_id,
                'cards_added': 1,
                'cards_moved_from_orphan': cards_moved_from_orphan,
                'cards_total': 1,
            })
    finally:
        if kid_conn is not None:
            kid_conn.close()
        if shared_conn is not None:
            shared_conn.close()

    return {
        'requested_count': len(deck_ids),
        'created_count': len(created),
        'already_opted_in_count': len(already_opted_in),
        'created': created,
        'already_opted_in': already_opted_in,
    }, 200


def opt_out_type_iv_shared_decks(kid, category_key, deck_ids):
    """Remove selected opted-in shared decks for one type-IV category."""
    kid_conn = None
    try:
        kid_conn = get_kid_connection_for(kid)
        materialized_by_local_id = get_kid_materialized_shared_decks_by_first_tag(
            kid_conn,
            category_key,
        )
        local_by_shared_id = {
            int(entry['shared_deck_id']): {
                'local_deck_id': int(entry['local_deck_id']),
                'local_name': str(entry['local_name'] or ''),
            }
            for entry in materialized_by_local_id.values()
        }

        removed = []
        already_opted_out = []
        for shared_deck_id in deck_ids:
            local_entry = local_by_shared_id.get(shared_deck_id)
            if not local_entry:
                already_opted_out.append({
                    'shared_deck_id': int(shared_deck_id),
                })
                continue

            local_deck_id = int(local_entry['local_deck_id'])
            local_name = str(local_entry['local_name'])
            card_rows = kid_conn.execute(
                "SELECT id FROM cards WHERE deck_id = ?",
                [local_deck_id]
            ).fetchall()
            card_ids = [int(row[0]) for row in card_rows]
            card_count = len(card_ids)

            practiced_card_ids = []
            if card_ids:
                placeholders = ','.join(['?'] * len(card_ids))
                practiced_rows = kid_conn.execute(
                    f"""
                    SELECT DISTINCT card_id
                    FROM session_results
                    WHERE card_id IN ({placeholders})
                    """,
                    card_ids
                ).fetchall()
                practiced_card_ids = [int(row[0]) for row in practiced_rows]
            had_practice_sessions = len(practiced_card_ids) > 0

            if had_practice_sessions:
                orphan_deck_id = get_or_create_category_orphan_deck(kid_conn, category_key)
                practiced_placeholders = ','.join(['?'] * len(practiced_card_ids))
                practiced_cards = kid_conn.execute(
                    f"""
                    SELECT id, front, back, skip_practice, hardness_score, created_at
                    FROM cards
                    WHERE id IN ({practiced_placeholders})
                    """,
                    practiced_card_ids
                ).fetchall()
                if practiced_cards:
                    kid_conn.execute(
                        f"DELETE FROM cards WHERE id IN ({practiced_placeholders})",
                        practiced_card_ids
                    )
                    kid_conn.executemany(
                        """
                        INSERT INTO cards (id, deck_id, front, back, skip_practice, hardness_score, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        [
                            [
                                int(row[0]),
                                orphan_deck_id,
                                row[1],
                                row[2],
                                bool(row[3]),
                                float(row[4] or 0.0),
                                row[5],
                            ]
                            for row in practiced_cards
                        ]
                    )

                practiced_card_id_set = set(practiced_card_ids)
                unpracticed_ids = [card_id for card_id in card_ids if card_id not in practiced_card_id_set]
                if unpracticed_ids:
                    delete_shared_deck_related_rows(
                        kid_conn,
                        unpracticed_ids,
                        delete_type3_audio=False,
                    )
                    unpracticed_placeholders = ','.join(['?'] * len(unpracticed_ids))
                    kid_conn.execute(
                        f"DELETE FROM cards WHERE id IN ({unpracticed_placeholders})",
                        unpracticed_ids
                    )
            else:
                if card_ids:
                    delete_shared_deck_related_rows(
                        kid_conn,
                        card_ids,
                        delete_type3_audio=False,
                    )
                    kid_conn.execute("DELETE FROM cards WHERE deck_id = ?", [local_deck_id])
            kid_conn.execute("DELETE FROM decks WHERE id = ?", [local_deck_id])
            removed.append({
                'shared_deck_id': int(shared_deck_id),
                'deck_id': local_deck_id,
                'materialized_name': local_name,
                'had_practice_sessions': had_practice_sessions,
                'cards_removed': card_count - len(practiced_card_ids),
                'cards_detached': len(practiced_card_ids),
            })
    finally:
        if kid_conn is not None:
            kid_conn.close()

    return {
        'requested_count': len(deck_ids),
        'removed_count': len(removed),
        'already_opted_out_count': len(already_opted_out),
        'removed': removed,
        'already_opted_out': already_opted_out,
    }, 200


def build_type_i_shared_cards_payload(
    kid,
    category_key,
    *,
    session_card_count_override=None,
    include_orphan_in_queue_override=None,
    include_practiced_from_other=False,
    conn=None,
):
    """Build merged cards payload for one type-I category."""
    category_meta_by_key = get_shared_deck_category_meta_by_key()
    category_display_name = get_deck_category_display_name(category_key, category_meta_by_key)

    owns_conn = conn is None
    if owns_conn:
        conn = get_kid_connection_for(kid, read_only=True)
    try:
        hydrate_kid_category_config_from_db(
            kid,
            category_meta_by_key=category_meta_by_key,
            conn=conn,
        )
        session_card_count = (
            int(session_card_count_override)
            if session_card_count_override is not None
            else get_category_session_card_count_for_kid(kid, category_key)
        )
        include_orphan_in_queue = (
            bool(include_orphan_in_queue_override)
            if include_orphan_in_queue_override is not None
            else get_category_include_orphan_for_kid(kid, category_key)
        )
        sources = get_shared_type_i_merged_source_decks_for_kid(
            conn,
            kid,
            category_key,
            include_orphan_in_queue_override=include_orphan_in_queue,
        )
        bank_sources = [
            src for src in sources
            if int(src.get('card_count') or 0) > 0 and bool(src.get('included_in_bank', True))
        ]
        practice_sources = [src for src in sources if bool(src.get('included_in_queue'))]
        practice_source_ids = [
            int(src['local_deck_id'])
            for src in practice_sources
            if int(src.get('active_card_count') or 0) > 0
        ]

        preview_order = {}
        practice_priority_preview_by_card_id = {}
        practice_priority_subject_baseline = {
            'p50_correct_time': None,
            'p90_correct_time': None,
            'correct_sample_count': 0,
        }
        if practice_source_ids:
            priority_preview = build_practice_priority_preview_for_decks(
                conn,
                practice_source_ids,
                category_key,
                get_session_behavior_type(category_key),
            )
            preview_order = priority_preview['order_by_card_id']
            practice_priority_preview_by_card_id = priority_preview['details_by_card_id']
            practice_priority_subject_baseline = priority_preview['subject_baseline']

        def _source_label(source):
            tags = extract_shared_deck_tags_and_labels(source.get('tags') or [])[0]
            tail = tags[1:] if len(tags) > 1 else []
            if tail:
                return ' / '.join(tail)
            local_name = str(source.get('local_name') or '')
            if bool(source.get('is_orphan')):
                return 'orphan'
            return local_name

        bank_deck_ids = [int(src['local_deck_id']) for src in bank_sources if int(src.get('local_deck_id') or 0) > 0]
        card_rows_by_deck_id = {}
        for row in get_cards_with_stats_for_deck_ids(conn, bank_deck_ids):
            deck_id = int(row[1] or 0)
            if deck_id > 0:
                card_rows_by_deck_id.setdefault(deck_id, []).append(row)

        merged_cards = []
        for src in bank_sources:
            local_deck_id = int(src['local_deck_id'])
            rows = card_rows_by_deck_id.get(local_deck_id) or []
            label = _source_label(src)
            is_orphan = bool(src.get('is_orphan'))
            for row in rows:
                mapped = map_card_row(row, preview_order, practice_priority_preview_by_card_id)
                mapped['source_deck_id'] = local_deck_id
                mapped['source_deck_label'] = label
                mapped['source_is_orphan'] = is_orphan
                merged_cards.append(mapped)

        if include_practiced_from_other:
            existing_ids = {
                int(card.get('id'))
                for card in merged_cards
                if int(card.get('id') or 0) > 0
            }
            practiced_ids = get_card_ids_practiced_for_category(conn, category_key)
            extra_ids = [cid for cid in practiced_ids if cid not in existing_ids]
            for row in get_cards_with_stats_for_card_ids(conn, extra_ids):
                mapped = map_card_row(row, preview_order, practice_priority_preview_by_card_id)
                mapped['source_deck_id'] = int(row[1] or 0)
                mapped['source_deck_label'] = ''
                mapped['source_is_orphan'] = False
                mapped['from_practice_history'] = True
                merged_cards.append(mapped)

        active_count = sum(int(src.get('active_card_count') or 0) for src in bank_sources)
        skipped_count = sum(int(src.get('skipped_card_count') or 0) for src in bank_sources)
        practice_active_count = sum(int(src.get('active_card_count') or 0) for src in practice_sources)
    finally:
        if owns_conn:
            conn.close()

    return {
        'is_merged_bank': True,
        'category_key': category_key,
        'deck_name': f'Merged {category_display_name} Bank',
        'include_orphan_in_queue': include_orphan_in_queue,
        'practice_source_count': len(practice_sources),
        'practice_active_card_count': int(practice_active_count),
        'active_card_count': active_count,
        'skipped_card_count': skipped_count,
        'practice_priority_subject_baseline': practice_priority_subject_baseline,
        'cards': merged_cards
    }


def build_type_iv_shared_cards_payload(
    kid,
    category_key,
    *,
    session_card_count_override=None,
):
    """Build merged cards payload for one type-IV category."""
    category_meta_by_key = get_shared_deck_category_meta_by_key()
    category_display_name = get_deck_category_display_name(category_key, category_meta_by_key)

    conn = get_kid_connection_for(kid, read_only=True)
    try:
        include_orphan_in_queue = get_category_include_orphan_for_kid(kid, category_key)
        generator_details_by_shared_id, generator_details_by_front = build_type_iv_generator_detail_maps(
            category_key,
            include_code=False,
        )
        practice_sources = get_type_iv_practice_source_rows(
            conn,
            kid,
            category_key,
            include_orphan_in_queue_override=include_orphan_in_queue,
            generator_details_by_shared_id=generator_details_by_shared_id,
            generator_details_by_front=generator_details_by_front,
            include_generator_code=False,
        )
        sources = get_type_iv_bank_source_rows(
            conn,
            kid,
            category_key,
            include_orphan_in_queue_override=include_orphan_in_queue,
        )
        session_card_count = (
            int(session_card_count_override)
            if session_card_count_override is not None
            else get_type_iv_total_daily_target_for_category(
                conn,
                kid,
                category_key,
                include_orphan_in_queue_override=include_orphan_in_queue,
            )
        )

        def _source_label(source):
            if bool(source.get('is_orphan')):
                return 'orphan'
            tags = extract_shared_deck_tags_and_labels(source.get('tags') or [])[0]
            tail = tags[1:] if len(tags) > 1 else []
            if tail:
                return ' / '.join(tail)
            return str(source.get('local_name') or '')

        merged_cards = []
        source_deck_ids = [int(src['local_deck_id']) for src in sources if int(src.get('local_deck_id') or 0) > 0]
        card_rows_by_deck_id = {}
        for row in get_cards_with_stats_for_deck_ids(conn, source_deck_ids):
            deck_id = int(row[1] or 0)
            if deck_id <= 0:
                continue
            card_rows_by_deck_id.setdefault(deck_id, []).append(row)
        for src in sources:
            local_deck_id = int(src['local_deck_id'])
            shared_deck_id = int(src.get('shared_deck_id') or 0)
            rows = card_rows_by_deck_id.get(local_deck_id) or []
            label = _source_label(src)
            is_orphan = bool(src.get('is_orphan'))
            shared_generator_details = generator_details_by_shared_id.get(shared_deck_id) or {}
            for row in rows:
                mapped = map_card_row(row, {})
                generator_details = shared_generator_details
                if not generator_details:
                    representative_front = str(mapped.get('front') or '').strip()
                    if representative_front:
                        generator_details = generator_details_by_front.get(representative_front) or {}
                resolved_shared_deck_id = int(generator_details.get('shared_deck_id') or shared_deck_id or 0)
                mapped['source_deck_id'] = local_deck_id
                mapped['source_deck_label'] = label
                mapped['source_is_orphan'] = is_orphan
                mapped['type4_shared_deck_id'] = resolved_shared_deck_id if resolved_shared_deck_id > 0 else None
                mapped['type4_is_multichoice_only'] = bool(generator_details.get('is_multichoice_only'))
                merged_cards.append(mapped)

        practice_active_count = sum(int(src.get('active_card_count') or 0) for src in practice_sources)
        active_count = sum(int(src.get('active_card_count') or 0) for src in sources)
        skipped_count = sum(int(src.get('skipped_card_count') or 0) for src in sources)
    finally:
        conn.close()

    return {
        'is_merged_bank': True,
        'category_key': category_key,
        'deck_name': f'Merged {category_display_name} Bank',
        'include_orphan_in_queue': bool(include_orphan_in_queue),
        'practice_source_count': len(practice_sources),
        'practice_active_card_count': int(practice_active_count),
        'active_card_count': active_count,
        'skipped_card_count': skipped_count,
        'session_card_count': session_card_count,
        'cards': merged_cards,
    }


DRILL_SESSION_CARD_POOL_SIZE = 40


def get_type_iv_practice_source_rows(
    conn,
    kid,
    category_key,
    *,
    include_orphan_in_queue_override=None,
    generator_details_by_shared_id=None,
    generator_details_by_front=None,
    include_generator_code=True,
):
    """Return opted-in generator sources ready for session generation."""
    sources = [
        source for source in list(get_shared_type_iv_merged_source_decks_for_kid(
            conn,
            kid,
            category_key,
            include_orphan_in_queue_override=include_orphan_in_queue_override,
        ))
        if bool(source.get('included_in_queue'))
    ]
    local_deck_ids = [int(src['local_deck_id']) for src in sources if int(src.get('local_deck_id') or 0) > 0]
    source_by_local_deck_id = {
        int(src.get('local_deck_id') or 0): src
        for src in sources
        if int(src.get('local_deck_id') or 0) > 0
    }
    if generator_details_by_shared_id is None or generator_details_by_front is None:
        generator_details_by_shared_id, generator_details_by_front = build_type_iv_generator_detail_maps(
            category_key,
            deck_ids=[src.get('shared_deck_id') for src in sources],
            include_code=include_generator_code,
        )

    practice_sources = []
    if local_deck_ids:
        placeholders = ','.join(['?'] * len(local_deck_ids))
        rows = conn.execute(
            f"""
            SELECT c.id, c.deck_id, c.front, d.daily_target_count
            FROM cards c
            JOIN decks d ON d.id = c.deck_id
            WHERE c.deck_id IN ({placeholders})
            ORDER BY c.deck_id ASC, c.id ASC
            """,
            local_deck_ids,
        ).fetchall()
        seen_non_orphan_deck_ids = set()
        for row in rows:
            representative_card_id = int(row[0] or 0)
            local_deck_id = int(row[1] or 0)
            source = source_by_local_deck_id.get(local_deck_id)
            if representative_card_id <= 0 or local_deck_id <= 0 or not source:
                continue
            is_orphan = bool(source.get('is_orphan'))
            if not is_orphan and local_deck_id in seen_non_orphan_deck_ids:
                continue
            if not is_orphan:
                seen_non_orphan_deck_ids.add(local_deck_id)

            raw_shared_deck_id = source.get('shared_deck_id')
            shared_deck_id = int(raw_shared_deck_id or 0) if raw_shared_deck_id is not None else 0
            representative_front = str(row[2] or '')
            generator_details = generator_details_by_shared_id.get(shared_deck_id) or {}
            if not generator_details and representative_front:
                generator_details = generator_details_by_front.get(representative_front) or {}
            resolved_shared_deck_id = int(generator_details.get('shared_deck_id') or shared_deck_id or 0)
            generator_code = str(generator_details.get('code') or '').strip()
            if include_generator_code and not generator_code:
                continue

            practice_sources.append({
                'source_key': int(representative_card_id),
                'local_deck_id': local_deck_id,
                'shared_deck_id': resolved_shared_deck_id if resolved_shared_deck_id > 0 else None,
                'local_name': str(source.get('local_name') or ''),
                'tags': extract_shared_deck_tags_and_labels(source.get('tags') or [])[0],
                'card_count': 1,
                'active_card_count': 1,
                'skipped_card_count': 0,
                'representative_card_id': representative_card_id,
                'representative_front': representative_front,
                'daily_target_count': max(0, int(row[3] or 0)),
                'generator_code': generator_code if include_generator_code else '',
                'is_multichoice_only': bool(generator_details.get('is_multichoice_only')),
                'is_orphan': is_orphan,
            })
    return practice_sources


def build_type_iv_special_session_ready_payload(conn, kid, category_key, practice_sources):
    """Build continue/retry readiness metadata for one generator category."""
    continue_source_session = get_latest_unfinished_session_for_today(conn, kid, category_key)
    if continue_source_session is not None:
        missing_count = max(
            0,
            int(continue_source_session['planned_count']) - int(continue_source_session['answer_count']),
        )
        continue_counts = build_type_iv_continue_count_by_source_key(practice_sources, missing_count)
        source_practice_mode = get_session_practice_mode(conn, continue_source_session['session_id'])
        return {
            'is_continue_session': True,
            'continue_source_session_id': int(continue_source_session['session_id']),
            'continue_card_count': sum(int(count or 0) for count in continue_counts.values()),
            'is_retry_session': False,
            'retry_source_session_id': None,
            'retry_card_count': 0,
            'source_practice_mode': source_practice_mode,
        }

    retry_source_session = get_latest_retry_source_session_for_today(conn, kid, category_key)
    if retry_source_session is None:
        return {
            'is_continue_session': False,
            'continue_source_session_id': None,
            'continue_card_count': 0,
            'is_retry_session': False,
            'retry_source_session_id': None,
            'retry_card_count': 0,
        }

    retry_rows = get_type_iv_retry_source_result_rows(
        conn,
        retry_source_session['session_id'],
        [source.get('representative_card_id') for source in list(practice_sources or [])],
    )
    source_practice_mode = get_session_practice_mode(conn, retry_source_session['session_id'])
    return {
        'is_continue_session': False,
        'continue_source_session_id': None,
        'continue_card_count': 0,
        'is_retry_session': True,
        'retry_source_session_id': int(retry_source_session['session_id']),
        'retry_card_count': len(retry_rows),
        'source_practice_mode': source_practice_mode,
    }


SHARED_DECK_SCOPE_TYPE1 = 'cards'
SHARED_DECK_SCOPE_TYPE3 = 'lesson-reading'
SHARED_DECK_SCOPE_TYPE2 = 'type2'
SHARED_DECK_SCOPE_TYPE4 = 'type4'

SHARED_DECK_OP_GET = 'shared_decks_get'
SHARED_DECK_OP_OPT_IN = 'shared_decks_opt_in'
SHARED_DECK_OP_OPT_OUT = 'shared_decks_opt_out'
SHARED_DECK_OP_GET_CARDS = 'shared_decks_get_cards'
SHARED_DECK_OP_SKIP_UPDATE = 'shared_decks_skip_update'
SHARED_DECK_OP_SKIP_UPDATE_BULK = 'shared_decks_skip_update_bulk'
SHARED_DECK_OP_GET_DECKS = 'decks_get'
SHARED_DECK_OP_CARD_SEARCH_INDEX = 'shared_decks_card_search_index'

CATEGORY_CONFIG = {}


def normalize_shared_deck_scope(raw_scope):
    """Normalize one shared-deck route scope segment."""
    return str(raw_scope or '').strip().lower().replace('_', '-')


def get_shared_deck_category_config(raw_scope):
    """Resolve one shared-deck scope to category config."""
    scope = normalize_shared_deck_scope(raw_scope)
    if not scope:
        return None
    return CATEGORY_CONFIG.get(scope)


def dispatch_shared_deck_scope_operation(scope, operation, kid_id, card_id=None):
    """Dispatch one shared-deck route operation by scope."""
    category = get_shared_deck_category_config(scope)
    if category is None:
        return jsonify({'error': 'Unknown shared-deck scope'}), 404
    return run_shared_deck_scope_operation(operation, kid_id, category, card_id=card_id)


def get_shared_type1_cards(kid_id):
    """Get merged cards across opted-in type-I decks and orphan deck."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        conn = get_kid_connection_for(kid, read_only=True)
        try:
            category_key, _ = resolve_kid_type_i_category_with_mode(
                kid,
                request.args.get('categoryKey'),
                conn=conn,
            )
            payload = build_type_i_shared_cards_payload(
                kid,
                category_key,
                include_practiced_from_other=parse_include_practiced_from_other_arg(),
                conn=conn,
            )
            payload.update(build_kid_daily_progress_section(kid, category_key, conn=conn))
        finally:
            conn.close()
        return jsonify(payload), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def parse_include_practiced_from_other_arg():
    """Return True when the request opts into including practiced-but-not-opted-in cards."""
    raw = str(request.args.get('includePracticedFromOther') or '').strip().lower()
    return raw in {'1', 'true', 'yes', 'on'}


def parse_shared_card_skip_update_request(card_id):
    """Parse shared-card skip update payload and return (card_id_int, skipped)."""
    try:
        card_id_int = int(card_id)
    except (TypeError, ValueError):
        raise ValueError('Invalid card id') from None

    payload = request.get_json() or {}
    if 'skipped' not in payload or not isinstance(payload.get('skipped'), bool):
        raise ValueError('skipped must be a boolean')
    skipped = bool(payload.get('skipped'))
    return card_id_int, skipped


def parse_shared_card_skip_bulk_update_request():
    """Parse shared-card bulk skip update payload and return (card_ids, skipped)."""
    payload = request.get_json() or {}
    raw_card_ids = payload.get('card_ids')
    if raw_card_ids is None:
        raw_card_ids = payload.get('cardIds')
    if not isinstance(raw_card_ids, list) or not raw_card_ids:
        raise ValueError('card_ids must be a non-empty list')
    if len(raw_card_ids) > 2000:
        raise ValueError('card_ids list is too large')
    card_ids = []
    seen = set()
    for raw_id in raw_card_ids:
        try:
            card_id_int = int(raw_id)
        except (TypeError, ValueError):
            raise ValueError('card_ids must contain integers') from None
        if card_id_int in seen:
            continue
        seen.add(card_id_int)
        card_ids.append(card_id_int)
    if not card_ids:
        raise ValueError('card_ids must contain at least one valid id')
    if 'skipped' not in payload or not isinstance(payload.get('skipped'), bool):
        raise ValueError('skipped must be a boolean')
    skipped = bool(payload.get('skipped'))
    return card_ids, skipped


def update_shared_card_skip_internal(kid, card_id_int, skipped, *, category_key, orphan_deck_name, deck_label):
    """Toggle skip status for one shared/materialized/orphan card for one category."""
    conn = get_kid_connection_for(kid)
    try:
        card_row = conn.execute(
            """
            SELECT c.id, c.deck_id, d.name, d.tags
            FROM cards c
            JOIN decks d ON d.id = c.deck_id
            WHERE c.id = ?
            LIMIT 1
            """,
            [card_id_int]
        ).fetchone()
        if not card_row:
            return {'error': 'Card not found'}, 404

        local_deck_name = str(card_row[2] or '')
        local_deck_tags = extract_shared_deck_tags_and_labels(card_row[3])[0]
        is_materialized_shared = parse_shared_deck_id_from_materialized_name(local_deck_name) is not None
        is_orphan = local_deck_name == str(orphan_deck_name or '')
        if is_materialized_shared and str(category_key or '') not in local_deck_tags:
            return {'error': f'Card does not belong to a shared {deck_label} deck'}, 400
        if not is_materialized_shared and not is_orphan:
            return {'error': f'Card does not belong to a shared {deck_label} or orphan deck'}, 400

        conn.execute(
            "UPDATE cards SET skip_practice = ? WHERE id = ?",
            [bool(skipped), card_id_int]
        )
    finally:
        conn.close()

    return {
        'id': card_id_int,
        'skip_practice': bool(skipped),
    }, 200


def update_shared_cards_skip_bulk_internal(kid, card_ids, skipped, *, category_key, orphan_deck_name, deck_label):
    """Toggle skip status for many shared/materialized/orphan cards for one category."""
    unique_card_ids = []
    seen = set()
    for raw_id in card_ids or []:
        card_id_int = int(raw_id)
        if card_id_int in seen:
            continue
        seen.add(card_id_int)
        unique_card_ids.append(card_id_int)
    if not unique_card_ids:
        return {'error': 'No card ids provided'}, 400

    conn = get_kid_connection_for(kid)
    try:
        placeholders = ','.join(['?'] * len(unique_card_ids))
        card_rows = conn.execute(
            f"""
            SELECT c.id, c.deck_id, d.name, d.tags
            FROM cards c
            JOIN decks d ON d.id = c.deck_id
            WHERE c.id IN ({placeholders})
            """,
            unique_card_ids
        ).fetchall()
        row_by_id = {int(row[0]): row for row in card_rows}
        missing_ids = [card_id for card_id in unique_card_ids if card_id not in row_by_id]
        if missing_ids:
            return {'error': f'Card not found: {missing_ids[0]}'}, 404

        for card_id in unique_card_ids:
            row = row_by_id[card_id]
            local_deck_name = str(row[2] or '')
            local_deck_tags = extract_shared_deck_tags_and_labels(row[3])[0]
            is_materialized_shared = parse_shared_deck_id_from_materialized_name(local_deck_name) is not None
            is_orphan = local_deck_name == str(orphan_deck_name or '')
            if is_materialized_shared and str(category_key or '') not in local_deck_tags:
                return {'error': f'Card does not belong to a shared {deck_label} deck'}, 400
            if not is_materialized_shared and not is_orphan:
                return {'error': f'Card does not belong to a shared {deck_label} or orphan deck'}, 400

        conn.execute(
            f"UPDATE cards SET skip_practice = ? WHERE id IN ({placeholders})",
            [bool(skipped), *unique_card_ids]
        )
    finally:
        conn.close()

    return {
        'updated_count': len(unique_card_ids),
        'skip_practice': bool(skipped),
    }, 200


def parse_shared_deck_ids_from_request_payload(payload):
    """Parse shared deck ids from either deck_ids or deckIds payload key."""
    data = payload if isinstance(payload, dict) else {}
    raw_ids = data.get('deck_ids')
    if raw_ids is None:
        raw_ids = data.get('deckIds')
    return normalize_shared_deck_ids(raw_ids)


def build_merged_source_decks_payload(sources, configured_count, include_orphan_in_queue):
    """Build merged-source readiness payload used by shared deck categories."""
    included_sources = [src for src in sources if bool(src.get('included_in_queue'))]
    total_active_cards = sum(int(src.get('active_card_count') or 0) for src in included_sources)
    total_session_count = min(int(configured_count), total_active_cards)
    decks = [{
        'key': ('orphan' if src.get('is_orphan') else f"shared_{src['shared_deck_id']}"),
        'label': str(src.get('local_name') or ''),
        'deck_id': int(src['local_deck_id']),
        'shared_deck_id': int(src['shared_deck_id']) if src.get('shared_deck_id') is not None else None,
        'total_cards': int(src.get('active_card_count') or 0),
        'session_count': int(total_session_count) if bool(src.get('included_in_queue')) and int(src.get('active_card_count') or 0) > 0 else 0,
        'included_in_queue': bool(src.get('included_in_queue')),
        'is_orphan': bool(src.get('is_orphan')),
    } for src in sources]
    return {
        'decks': decks,
        'total_session_count': total_session_count,
        'configured_session_count': int(configured_count),
        'total_active_cards': total_active_cards,
        'include_orphan_in_queue': bool(include_orphan_in_queue),
    }


def build_orphan_deck_payload(conn, orphan_deck_id, default_orphan_name):
    """Build one orphan deck summary payload."""
    orphan_row = conn.execute(
        "SELECT id, name, COALESCE(daily_target_count, 0) FROM decks WHERE id = ? LIMIT 1",
        [orphan_deck_id]
    ).fetchone()
    orphan_name = str(orphan_row[1] or default_orphan_name) if orphan_row else str(default_orphan_name)
    orphan_daily_target_count = int(orphan_row[2] or 0) if orphan_row and len(orphan_row) >= 3 else 0
    counts = get_card_count_summary_by_deck_ids(conn, [orphan_deck_id]).get(int(orphan_deck_id)) or {}
    return {
        'deck_id': orphan_deck_id,
        'name': orphan_name,
        'card_count': int(counts.get('card_count') or 0),
        'active_card_count': int(counts.get('active_card_count') or 0),
        'skipped_card_count': int(counts.get('skipped_card_count') or 0),
        'daily_target_count': orphan_daily_target_count,
    }


def build_shared_decks_listing_payload(
    kid,
    *,
    first_tag,
    orphan_deck_name,
    get_shared_decks_fn,
    get_materialized_decks_fn,
    session_card_count,
    include_orphan_in_queue,
):
    """Build shared deck listing payload for type-II/type-III categories."""
    shared_conn = None
    kid_conn = None
    orphan_deck_payload = None
    local_by_shared_id = {}
    local_card_count_by_deck_id = {}
    try:
        shared_conn = get_shared_decks_connection(read_only=True)
        decks = get_shared_decks_fn(shared_conn)

        kid_conn = get_kid_connection_for(kid, read_only=True)
        materialized_by_local_id = get_materialized_decks_fn(kid_conn)
        for entry in materialized_by_local_id.values():
            shared_deck_id = int(entry['shared_deck_id'])
            existing = local_by_shared_id.get(shared_deck_id)
            if existing is None or int(entry['local_deck_id']) < int(existing['local_deck_id']):
                local_by_shared_id[shared_deck_id] = entry

        local_deck_ids = [int(deck_id) for deck_id in materialized_by_local_id.keys()]
        if local_deck_ids:
            placeholders = ','.join(['?'] * len(local_deck_ids))
            card_count_rows = kid_conn.execute(
                f"""
                SELECT deck_id, COUNT(*) AS card_count
                FROM cards
                WHERE deck_id IN ({placeholders})
                GROUP BY deck_id
                """,
                local_deck_ids
            ).fetchall()
            local_card_count_by_deck_id = {
                int(row[0]): int(row[1] or 0)
                for row in card_count_rows
            }

        orphan_deck_id = get_orphan_deck(kid_conn, orphan_deck_name)
        orphan_deck_payload = build_orphan_deck_payload(kid_conn, orphan_deck_id, orphan_deck_name)
    finally:
        if kid_conn is not None:
            kid_conn.close()
        if shared_conn is not None:
            shared_conn.close()

    shared_deck_id_set = set()
    for deck in decks:
        shared_deck_id = int(deck['deck_id'])
        shared_deck_id_set.add(shared_deck_id)
        local_entry = local_by_shared_id.get(shared_deck_id)
        materialized_deck_id = int(local_entry['local_deck_id']) if local_entry else None
        shared_card_count = int(deck.get('card_count') or 0)
        materialized_card_count = (
            int(local_card_count_by_deck_id.get(materialized_deck_id, 0))
            if materialized_deck_id is not None
            else None
        )
        deck['materialized_name'] = (
            str(local_entry['local_name'])
            if local_entry
            else build_materialized_shared_deck_name(deck['deck_id'], deck['name'])
        )
        deck['opted_in'] = local_entry is not None
        deck['materialized_deck_id'] = materialized_deck_id
        deck['shared_card_count'] = shared_card_count
        deck['materialized_card_count'] = materialized_card_count
        deck['has_update_warning'] = bool(
            local_entry is not None
            and materialized_card_count is not None
            and materialized_card_count != shared_card_count
        )
        deck['update_warning_reason'] = (
            'count_mismatch'
            if bool(deck['has_update_warning'])
            else ''
        )
        deck['mix_percent'] = 0
        deck['session_cards'] = 0

    for shared_deck_id, local_entry in local_by_shared_id.items():
        if shared_deck_id in shared_deck_id_set:
            continue
        local_deck_id = int(local_entry['local_deck_id'])
        local_name = str(local_entry.get('local_name') or '')
        _, _, tail_name = local_name.partition('__')
        display_name = tail_name.strip() or local_name
        decks.append({
            'deck_id': int(shared_deck_id),
            'name': display_name,
            'tags': extract_shared_deck_tags_and_labels(local_entry.get('tags') or [])[0],
            'tag_labels': [str(tag) for tag in list(local_entry.get('tag_labels') or []) if str(tag or '').strip()],
            'creator_family_id': None,
            'created_at': None,
            'card_count': int(local_card_count_by_deck_id.get(local_deck_id, 0)),
            'materialized_name': local_name,
            'opted_in': True,
            'materialized_deck_id': local_deck_id,
            'shared_card_count': None,
            'materialized_card_count': int(local_card_count_by_deck_id.get(local_deck_id, 0)),
            'has_update_warning': True,
            'update_warning_reason': 'source_deleted',
            'mix_percent': 0,
            'session_cards': 0,
            'source_deleted': True,
        })

    if orphan_deck_payload is not None:
        orphan_deck_payload['included_in_queue'] = bool(include_orphan_in_queue)
    return {
        'decks': decks,
        'deck_count': len(decks),
        'session_card_count': int(session_card_count),
        'include_orphan_in_queue': bool(include_orphan_in_queue),
        'orphan_deck': orphan_deck_payload,
    }


def opt_in_shared_decks_internal(
    kid,
    deck_ids,
    *,
    first_tag,
    orphan_deck_name,
    get_materialized_decks_fn,
    unique_key_field,
):
    """Materialize shared decks into kid DB for type-II/type-III categories."""
    shared_conn = None
    kid_conn = None
    try:
        shared_conn = get_shared_decks_connection(read_only=True)
        shared_by_id, missing_ids = _fetch_shared_decks_by_ids(shared_conn, deck_ids)
        if missing_ids:
            return {
                'error': f'Shared deck(s) not found: {", ".join(str(v) for v in missing_ids)}'
            }, 404

        placeholders = ','.join(['?'] * len(deck_ids))
        invalid_tag_ids = [
            deck_id for deck_id in deck_ids
            if first_tag not in shared_by_id[deck_id]['tags']
        ]
        if invalid_tag_ids:
            return {
                'error': f'Deck(s) are not {first_tag}-tagged: {", ".join(str(v) for v in invalid_tag_ids)}'
            }, 400

        card_rows = shared_conn.execute(
            f"""
            SELECT deck_id, front, back
            FROM cards
            WHERE deck_id IN ({placeholders})
            ORDER BY deck_id ASC, id ASC
            """,
            deck_ids
        ).fetchall()
        cards_by_deck_id = {}
        for row in card_rows:
            src_deck_id = int(row[0])
            cards_by_deck_id.setdefault(src_deck_id, []).append({
                'front': str(row[1]),
                'back': str(row[2]),
            })

        kid_conn = get_kid_connection_for(kid)
        existing_materialized = get_materialized_decks_fn(kid_conn)
        occupied_deck_ids = list(existing_materialized.keys())
        occupied_values = (
            get_kid_card_fronts_for_deck_ids(kid_conn, occupied_deck_ids)
            if unique_key_field == 'front'
            else get_kid_card_backs_for_deck_ids(kid_conn, occupied_deck_ids)
        )
        orphan_deck_id = get_or_create_orphan_deck(
            kid_conn,
            orphan_deck_name,
            first_tag,
        )

        created = []
        already_opted_in = []
        skipped_existing_key = f'cards_skipped_existing_{unique_key_field}'
        for src_deck_id in deck_ids:
            src_deck = shared_by_id[src_deck_id]
            materialized_name = build_materialized_shared_deck_name(src_deck_id, src_deck['name'])
            existing = kid_conn.execute(
                "SELECT id FROM decks WHERE name = ? LIMIT 1",
                [materialized_name]
            ).fetchone()
            if existing:
                already_opted_in.append({
                    'shared_deck_id': src_deck_id,
                    'shared_name': src_deck['name'],
                    'materialized_name': materialized_name,
                    'deck_id': int(existing[0]),
                })
                continue

            materialized_tags = build_materialized_shared_deck_tags(src_deck['tags'])
            inserted = kid_conn.execute(
                """
                INSERT INTO decks (name, tags)
                VALUES (?, ?)
                RETURNING id
                """,
                [materialized_name, materialized_tags]
            ).fetchone()
            local_deck_id = int(inserted[0])

            cards = cards_by_deck_id.get(src_deck_id, [])
            cards_added = 0
            cards_moved_from_orphan = 0
            cards_skipped_existing = 0
            if cards:
                source_keys = []
                seen_keys = set()
                source_front_by_back = {}
                for card in cards:
                    front = str(card.get('front') or '')
                    back = str(card.get('back') or '')
                    key_value = front if unique_key_field == 'front' else back
                    if not key_value or key_value in seen_keys:
                        continue
                    seen_keys.add(key_value)
                    source_keys.append(key_value)
                    if unique_key_field == 'back':
                        source_front_by_back[key_value] = front

                orphan_by_key = {}
                if source_keys:
                    key_placeholders = ','.join(['?'] * len(source_keys))
                    orphan_rows = kid_conn.execute(
                        f"""
                        SELECT id, front, back, skip_practice, hardness_score, created_at
                        FROM cards
                        WHERE deck_id = ?
                          AND {unique_key_field} IN ({key_placeholders})
                        ORDER BY id ASC
                        """,
                        [orphan_deck_id, *source_keys]
                    ).fetchall()
                    for row in orphan_rows:
                        row_key = str(row[1] or '') if unique_key_field == 'front' else str(row[2] or '')
                        if row_key in orphan_by_key:
                            continue
                        orphan_by_key[row_key] = row

                moved_rows = []
                insert_rows = []
                for card in cards:
                    front = str(card.get('front') or '')
                    back = str(card.get('back') or '')
                    key_value = front if unique_key_field == 'front' else back
                    if not key_value:
                        continue
                    if key_value in occupied_values:
                        cards_skipped_existing += 1
                        continue

                    orphan_row = orphan_by_key.pop(key_value, None)
                    if orphan_row is not None:
                        if unique_key_field == 'back':
                            orphan_front = str(orphan_row[1] or '')
                            orphan_back = str(orphan_row[2] or '')
                            source_front = str(source_front_by_back.get(key_value) or '')
                            resolved_front = orphan_front if orphan_front != orphan_back else (source_front or orphan_back)
                            moved_rows.append(
                                (
                                    int(orphan_row[0]),
                                    resolved_front,
                                    orphan_back,
                                    bool(orphan_row[3]),
                                    float(orphan_row[4] or 0.0),
                                    orphan_row[5],
                                )
                            )
                        else:
                            moved_rows.append(orphan_row)
                        occupied_values.add(key_value)
                        continue

                    insert_rows.append([local_deck_id, front, back])
                    occupied_values.add(key_value)

                if moved_rows:
                    moved_ids = [int(row[0]) for row in moved_rows]
                    moved_placeholders = ','.join(['?'] * len(moved_ids))
                    kid_conn.execute(
                        f"DELETE FROM cards WHERE id IN ({moved_placeholders})",
                        moved_ids
                    )
                    kid_conn.executemany(
                        """
                        INSERT INTO cards (id, deck_id, front, back, skip_practice, hardness_score, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        [
                            [
                                int(row[0]),
                                local_deck_id,
                                str(row[1] or ''),
                                str(row[2] or ''),
                                bool(row[3]),
                                float(row[4] or 0.0),
                                row[5],
                            ]
                            for row in moved_rows
                        ]
                    )
                    cards_moved_from_orphan = len(moved_rows)

                if insert_rows:
                    kid_conn.executemany(
                        "INSERT INTO cards (deck_id, front, back) VALUES (?, ?, ?)",
                        insert_rows
                    )
                    cards_added = len(insert_rows)

            created_item = {
                'shared_deck_id': src_deck_id,
                'shared_name': src_deck['name'],
                'materialized_name': materialized_name,
                'deck_id': local_deck_id,
                'cards_added': cards_added,
                'cards_moved_from_orphan': cards_moved_from_orphan,
                'cards_total': len(cards),
            }
            created_item[skipped_existing_key] = cards_skipped_existing
            created.append(created_item)
    finally:
        if kid_conn is not None:
            kid_conn.close()
        if shared_conn is not None:
            shared_conn.close()

    return {
        'requested_count': len(deck_ids),
        'created_count': len(created),
        'already_opted_in_count': len(already_opted_in),
        'created': created,
        'already_opted_in': already_opted_in,
    }, 200


def delete_shared_deck_related_rows(conn, card_ids, *, delete_type3_audio):
    """Delete rows related to selected card ids when opt-out removes cards."""
    if not card_ids:
        return
    placeholders = ','.join(['?'] * len(card_ids))
    remove_cards_from_type2_chinese_print_sheets(conn, card_ids)
    if delete_type3_audio:
        conn.execute(
            f"""
            DELETE FROM lesson_reading_audio
            WHERE result_id IN (
                SELECT id FROM session_results WHERE card_id IN ({placeholders})
            )
            """,
            card_ids
        )
    conn.execute(
        f"DELETE FROM session_results WHERE card_id IN ({placeholders})",
        card_ids
    )


def opt_out_shared_decks_internal(
    kid,
    deck_ids,
    *,
    first_tag,
    orphan_deck_name,
    get_materialized_decks_fn,
    delete_type3_audio,
):
    """Opt out shared decks for type-II/type-III categories."""
    kid_conn = None
    try:
        kid_conn = get_kid_connection_for(kid)
        materialized_by_local_id = get_materialized_decks_fn(kid_conn)
        local_by_shared_id = {
            int(entry['shared_deck_id']): {
                'local_deck_id': int(entry['local_deck_id']),
                'local_name': str(entry['local_name'] or ''),
            }
            for entry in materialized_by_local_id.values()
        }

        removed = []
        already_opted_out = []
        for shared_deck_id in deck_ids:
            local_entry = local_by_shared_id.get(shared_deck_id)
            if not local_entry:
                already_opted_out.append({'shared_deck_id': int(shared_deck_id)})
                continue

            local_deck_id = int(local_entry['local_deck_id'])
            local_name = str(local_entry['local_name'])
            card_rows = kid_conn.execute(
                "SELECT id FROM cards WHERE deck_id = ?",
                [local_deck_id]
            ).fetchall()
            card_ids = [int(row[0]) for row in card_rows]
            card_count = len(card_ids)

            practiced_card_ids = []
            if card_ids:
                placeholders = ','.join(['?'] * len(card_ids))
                practiced_rows = kid_conn.execute(
                    f"SELECT DISTINCT card_id FROM session_results WHERE card_id IN ({placeholders})",
                    card_ids
                ).fetchall()
                practiced_card_ids = [int(row[0]) for row in practiced_rows]
            had_practice_sessions = len(practiced_card_ids) > 0

            if had_practice_sessions:
                orphan_deck_id = get_or_create_orphan_deck(
                    kid_conn,
                    orphan_deck_name,
                    first_tag,
                )
                practiced_placeholders = ','.join(['?'] * len(practiced_card_ids))
                practiced_cards = kid_conn.execute(
                    f"""
                    SELECT id, front, back, skip_practice, hardness_score, created_at
                    FROM cards
                    WHERE id IN ({practiced_placeholders})
                    """,
                    practiced_card_ids
                ).fetchall()
                if practiced_cards:
                    kid_conn.execute(
                        f"DELETE FROM cards WHERE id IN ({practiced_placeholders})",
                        practiced_card_ids
                    )
                    kid_conn.executemany(
                        """
                        INSERT INTO cards (id, deck_id, front, back, skip_practice, hardness_score, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        [
                            [
                                int(row[0]),
                                orphan_deck_id,
                                row[1],
                                row[2],
                                bool(row[3]),
                                float(row[4] or 0.0),
                                row[5],
                            ]
                            for row in practiced_cards
                        ]
                    )

                practiced_card_id_set = set(practiced_card_ids)
                unpracticed_ids = [card_id for card_id in card_ids if card_id not in practiced_card_id_set]
                if unpracticed_ids:
                    delete_shared_deck_related_rows(
                        kid_conn,
                        unpracticed_ids,
                        delete_type3_audio=delete_type3_audio,
                    )
                    unpracticed_placeholders = ','.join(['?'] * len(unpracticed_ids))
                    kid_conn.execute(
                        f"DELETE FROM cards WHERE id IN ({unpracticed_placeholders})",
                        unpracticed_ids
                    )
            else:
                delete_shared_deck_related_rows(
                    kid_conn,
                    card_ids,
                    delete_type3_audio=delete_type3_audio,
                )
                kid_conn.execute("DELETE FROM cards WHERE deck_id = ?", [local_deck_id])

            kid_conn.execute("DELETE FROM decks WHERE id = ?", [local_deck_id])
            removed.append({
                'shared_deck_id': int(shared_deck_id),
                'deck_id': local_deck_id,
                'materialized_name': local_name,
                'had_practice_sessions': had_practice_sessions,
                'cards_removed': card_count - len(practiced_card_ids),
                'cards_detached': len(practiced_card_ids),
            })
    finally:
        if kid_conn is not None:
            kid_conn.close()

    return {
        'requested_count': len(deck_ids),
        'removed_count': len(removed),
        'already_opted_out_count': len(already_opted_out),
        'removed': removed,
        'already_opted_out': already_opted_out,
    }, 200


def resolve_type2_scope_context(kid, raw_category_key):
    """Resolve per-request type-II scope settings for shared deck operations."""
    category_key, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
        kid,
        raw_category_key,
    )
    return {
        'category_key': category_key,
        'has_chinese_specific_logic': bool(has_chinese_specific_logic),
        'first_tag': category_key,
        'orphan_deck_name': get_category_orphan_deck_name(category_key),
        'unique_key_field': 'back',
        'include_orphan_in_queue': get_category_include_orphan_for_kid(kid, category_key),
    }


SHARED_SCOPE_MANAGEMENT_TYPE_I = 'type_i'
SHARED_SCOPE_MANAGEMENT_TYPE_II = 'type_ii'
SHARED_SCOPE_MANAGEMENT_TYPE_IV = 'type_iv'


def resolve_shared_scope_management_context(kid, category, raw_category_key):
    """Resolve one shared-scope request into normalized management context."""
    if str(category.get('kind') or '') == 'type4':
        category_key, has_chinese_specific_logic = resolve_kid_type_iv_category_with_mode(
            kid,
            raw_category_key,
        )
        return {
            'management_type': SHARED_SCOPE_MANAGEMENT_TYPE_IV,
            'category_key': category_key,
            'has_chinese_specific_logic': bool(has_chinese_specific_logic),
            'include_orphan_in_queue': get_category_include_orphan_for_kid(kid, category_key),
            'orphan_deck_name': get_category_orphan_deck_name(category_key),
        }
    if str(category.get('kind') or '') == 'type1':
        category_key, has_chinese_specific_logic = resolve_kid_type_i_category_with_mode(
            kid,
            raw_category_key,
        )
        return {
            'management_type': SHARED_SCOPE_MANAGEMENT_TYPE_I,
            'category_key': category_key,
            'has_chinese_specific_logic': bool(has_chinese_specific_logic),
            'chinese_back_content': get_category_chinese_back_content(category_key),
            'include_orphan_in_queue': get_category_include_orphan_for_kid(kid, category_key),
            'orphan_deck_name': get_category_orphan_deck_name(category_key),
        }
    if bool(category.get('use_type_i_card_management')):
        category_key, _ = resolve_kid_type_iii_category_with_mode(
            kid,
            raw_category_key,
        )
        return {
            'management_type': SHARED_SCOPE_MANAGEMENT_TYPE_I,
            'category_key': category_key,
            'has_chinese_specific_logic': False,
            'include_orphan_in_queue': get_category_include_orphan_for_kid(kid, category_key),
            'orphan_deck_name': get_category_orphan_deck_name(category_key),
        }
    if bool(category.get('use_type_ii_card_management')):
        return {
            'management_type': SHARED_SCOPE_MANAGEMENT_TYPE_II,
            **resolve_type2_scope_context(kid, raw_category_key),
        }
    raise ValueError('Unsupported shared-deck operation for scope')


def get_shared_decks_for_scope(kid_id, category):
    """Handle shared-decks listing by scope config."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        scope_context = resolve_shared_scope_management_context(
            kid,
            category,
            request.args.get('categoryKey'),
        )
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_I:
            payload = build_type_i_shared_decks_payload(
                kid,
                scope_context['category_key'],
                session_card_count_override=get_category_session_card_count_for_kid(
                    kid,
                    scope_context['category_key'],
                ),
                include_orphan_in_queue_override=scope_context['include_orphan_in_queue'],
                include_category_key=True,
            )
            return jsonify(payload), 200
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_IV:
            payload = build_type_iv_shared_decks_payload(
                kid,
                scope_context['category_key'],
                include_category_key=True,
                include_orphan_in_queue_override=scope_context['include_orphan_in_queue'],
            )
            return jsonify(payload), 200
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_II:
            payload = build_shared_decks_listing_payload(
                kid,
                first_tag=scope_context['first_tag'],
                orphan_deck_name=scope_context['orphan_deck_name'],
                get_shared_decks_fn=lambda conn: get_shared_type_ii_deck_rows(
                    conn,
                    scope_context['category_key'],
                ),
                get_materialized_decks_fn=lambda conn: get_kid_materialized_shared_type_ii_decks(
                    conn,
                    scope_context['category_key'],
                ),
                session_card_count=get_category_session_card_count_for_kid(
                    kid,
                    scope_context['category_key'],
                ),
                include_orphan_in_queue=scope_context['include_orphan_in_queue'],
            )
            payload['category_key'] = scope_context['category_key']
            payload['has_chinese_specific_logic'] = scope_context['has_chinese_specific_logic']
            return jsonify(payload), 200

        return jsonify({'error': 'Unsupported shared-deck operation for scope'}), 404
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def get_shared_decks_card_search_index_for_scope(kid_id, category):
    """Return lightweight card index ({deck_id, front, back}) for all shared decks in one scope."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        scope_context = resolve_shared_scope_management_context(
            kid,
            category,
            request.args.get('categoryKey'),
        )
        first_tag = scope_context.get('first_tag') or scope_context.get('category_key')
        management_type = scope_context['management_type']
        shared_conn = get_shared_decks_connection(read_only=True)
        try:
            decks = get_shared_deck_rows_by_first_tag(shared_conn, first_tag)
            deck_ids = [int(deck['deck_id']) for deck in decks]
            cards = []
            if deck_ids:
                placeholders = ','.join(['?'] * len(deck_ids))
                rows = shared_conn.execute(
                    f"""
                    SELECT deck_id, front, back
                    FROM cards
                    WHERE deck_id IN ({placeholders})
                    ORDER BY deck_id ASC, id ASC
                    """,
                    deck_ids
                ).fetchall()
                for row in rows:
                    cards.append({
                        'shared_deck_id': int(row[0]),
                        'is_orphan': False,
                        'front': str(row[1] or ''),
                        'back': str(row[2] or ''),
                    })
        finally:
            shared_conn.close()
        kid_conn = get_kid_connection_for(kid, read_only=True)
        try:
            orphan_deck_id = get_orphan_deck(
                kid_conn,
                get_category_orphan_deck_name(first_tag),
            )
            if orphan_deck_id > 0:
                orphan_rows = kid_conn.execute(
                    "SELECT front, back FROM cards WHERE deck_id = ? ORDER BY id ASC",
                    [orphan_deck_id],
                ).fetchall()
                for row in orphan_rows:
                    cards.append({
                        'shared_deck_id': None,
                        'is_orphan': True,
                        'front': str(row[0] or ''),
                        'back': str(row[1] or ''),
                    })
        finally:
            kid_conn.close()
        return jsonify({
            'cards': cards,
            'management_type': management_type,
            'category_key': scope_context.get('category_key'),
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def opt_in_shared_decks_for_scope(kid_id, category):
    """Handle shared-decks opt-in by scope config."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        req_payload = request.get_json() or {}
        scope_context = resolve_shared_scope_management_context(
            kid,
            category,
            req_payload.get('categoryKey') or request.args.get('categoryKey'),
        )
        deck_ids = parse_shared_deck_ids_from_request_payload(req_payload)
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_I:
            payload, status_code = opt_in_type_i_shared_decks(
                kid,
                scope_context['category_key'],
                deck_ids,
                scope_context['has_chinese_specific_logic'],
            )
            return jsonify(payload), status_code
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_IV:
            payload, status_code = opt_in_type_iv_shared_decks(
                kid,
                scope_context['category_key'],
                deck_ids,
            )
            return jsonify(payload), status_code
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_II:
            payload, status_code = opt_in_shared_decks_internal(
                kid,
                deck_ids,
                first_tag=scope_context['first_tag'],
                orphan_deck_name=scope_context['orphan_deck_name'],
                get_materialized_decks_fn=lambda conn: get_kid_materialized_shared_type_ii_decks(
                    conn,
                    scope_context['category_key'],
                ),
                unique_key_field=scope_context['unique_key_field'],
            )
            return jsonify(payload), status_code

        return jsonify({'error': 'Unsupported shared-deck operation for scope'}), 404
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def opt_out_shared_decks_for_scope(kid_id, category):
    """Handle shared-decks opt-out by scope config."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        req_payload = request.get_json() or {}
        scope_context = resolve_shared_scope_management_context(
            kid,
            category,
            req_payload.get('categoryKey') or request.args.get('categoryKey'),
        )
        deck_ids = parse_shared_deck_ids_from_request_payload(req_payload)
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_I:
            return jsonify(
                opt_out_type_i_shared_decks(
                    kid,
                    scope_context['category_key'],
                    deck_ids,
                )
            ), 200
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_IV:
            payload, status_code = opt_out_type_iv_shared_decks(
                kid,
                scope_context['category_key'],
                deck_ids,
            )
            return jsonify(payload), status_code
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_II:
            payload, status_code = opt_out_shared_decks_internal(
                kid,
                deck_ids,
                first_tag=scope_context['first_tag'],
                orphan_deck_name=scope_context['orphan_deck_name'],
                get_materialized_decks_fn=lambda conn: get_kid_materialized_shared_type_ii_decks(
                    conn,
                    scope_context['category_key'],
                ),
                delete_type3_audio=False,
            )
            return jsonify(payload), status_code

        return jsonify({'error': 'Unsupported shared-deck operation for scope'}), 404
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def get_shared_cards_for_scope(kid_id, category):
    """Handle shared-decks cards listing by scope config."""
    cards_handler = category.get('cards_handler')
    if not callable(cards_handler):
        return jsonify({'error': 'Unsupported shared-deck operation for scope'}), 404
    return cards_handler(kid_id)


def update_shared_card_skip_for_scope(kid_id, category, card_id):
    """Handle shared card skip updates by scope config."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        card_id_int, skipped = parse_shared_card_skip_update_request(card_id)
        scope_context = resolve_shared_scope_management_context(
            kid,
            category,
            request.args.get('categoryKey'),
        )
        category_key = scope_context['category_key']
        orphan_deck_name = scope_context['orphan_deck_name']
        deck_label = category_key

        payload, status_code = update_shared_card_skip_internal(
            kid,
            card_id_int,
            skipped,
            category_key=category_key,
            orphan_deck_name=orphan_deck_name,
            deck_label=deck_label,
        )
        return jsonify(payload), status_code
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def get_decks_for_scope(kid_id, category):
    """Handle merged deck readiness summaries by scope config."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        sources = []
        scope_context = resolve_shared_scope_management_context(
            kid,
            category,
            request.args.get('categoryKey'),
        )
        special_ready_payload = {
            'is_continue_session': False,
            'continue_source_session_id': None,
            'continue_card_count': 0,
            'is_retry_session': False,
            'retry_source_session_id': None,
            'retry_card_count': 0,
        }
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_I:
            conn = get_kid_connection_for(kid, read_only=True)
            try:
                sources = get_shared_type_i_merged_source_decks_for_kid(
                    conn,
                    kid,
                    scope_context['category_key'],
                    include_orphan_in_queue_override=scope_context['include_orphan_in_queue'],
                )
                included_sources = [
                    src for src in sources
                    if bool(src.get('included_in_queue')) and int(src.get('active_card_count') or 0) > 0
                ]
                source_deck_ids = [int(src['local_deck_id']) for src in included_sources]
                special_ready_payload = build_special_session_ready_payload(
                    conn,
                    kid,
                    scope_context['category_key'],
                    source_by_deck_id={int(src['local_deck_id']): src for src in included_sources},
                    source_deck_ids=source_deck_ids,
                )
                if not bool(scope_context.get('has_chinese_specific_logic')):
                    special_ready_payload['drill_speed_target_ms'] = (
                        get_category_drill_speed_cutoff_ms_for_kid(
                            conn,
                            scope_context['category_key'],
                        )
                    )
            finally:
                conn.close()
        elif scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_II:
            conn = get_kid_connection_for(kid, read_only=True)
            try:
                sources = get_shared_type_ii_merged_source_decks_for_kid(
                    conn,
                    kid,
                    scope_context['category_key'],
                )
                included_sources = [
                    src for src in sources
                    if bool(src.get('included_in_queue')) and int(src.get('active_card_count') or 0) > 0
                ]
                source_deck_ids = [int(src['local_deck_id']) for src in included_sources]
                pending_card_ids = (
                    get_pending_writing_card_ids(conn)
                    if bool(scope_context.get('has_chinese_specific_logic'))
                    else []
                )
                special_ready_payload = build_special_session_ready_payload(
                    conn,
                    kid,
                    scope_context['category_key'],
                    source_by_deck_id={int(src['local_deck_id']): src for src in included_sources},
                    source_deck_ids=source_deck_ids,
                    excluded_card_ids=pending_card_ids,
                )
            finally:
                conn.close()
        elif scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_IV:
            conn = get_kid_connection_for(kid, read_only=True)
            try:
                practice_sources = get_type_iv_practice_source_rows(
                    conn,
                    kid,
                    scope_context['category_key'],
                    include_orphan_in_queue_override=scope_context['include_orphan_in_queue'],
                )
                special_ready_payload = build_type_iv_special_session_ready_payload(
                    conn,
                    kid,
                    scope_context['category_key'],
                    practice_sources,
                )
            finally:
                conn.close()

            listing_payload = build_type_iv_shared_decks_payload(
                kid,
                scope_context['category_key'],
                include_category_key=True,
                include_orphan_in_queue_override=scope_context['include_orphan_in_queue'],
            )
            readiness_decks = []
            for deck in list(listing_payload.get('decks') or []):
                readiness_decks.append({
                    'key': f"shared_{int(deck.get('deck_id') or 0)}",
                    'label': str(deck.get('representative_front') or deck.get('name') or ''),
                    'deck_id': int(deck.get('materialized_deck_id') or 0),
                    'shared_deck_id': int(deck.get('deck_id') or 0),
                    'total_cards': int(deck.get('card_count') or 0),
                    'session_count': int(deck.get('daily_target_count') or 0) if bool(deck.get('opted_in')) else 0,
                    'included_in_queue': bool(deck.get('opted_in')) and int(deck.get('daily_target_count') or 0) > 0,
                    'is_orphan': False,
                    'opted_in': bool(deck.get('opted_in')),
                    'daily_target_count': int(deck.get('daily_target_count') or 0),
                })
            orphan_payload = listing_payload.get('orphan_deck') if isinstance(listing_payload, dict) else None
            if isinstance(orphan_payload, dict) and int(orphan_payload.get('card_count') or 0) > 0:
                orphan_active_card_count = int(orphan_payload.get('active_card_count') or 0)
                orphan_daily_target_count = int(orphan_payload.get('daily_target_count') or 0)
                orphan_included = bool(scope_context['include_orphan_in_queue'])
                readiness_decks.append({
                    'key': 'orphan',
                    'label': str(orphan_payload.get('name') or scope_context['orphan_deck_name'] or 'Personal Deck'),
                    'deck_id': int(orphan_payload.get('deck_id') or 0),
                    'shared_deck_id': None,
                    'total_cards': orphan_active_card_count,
                    'session_count': (
                        orphan_daily_target_count
                        if orphan_included and orphan_active_card_count > 0
                        else 0
                    ),
                    'included_in_queue': bool(
                        orphan_included and orphan_active_card_count > 0 and orphan_daily_target_count > 0
                    ),
                    'is_orphan': True,
                    'opted_in': bool(orphan_included),
                    'daily_target_count': orphan_daily_target_count,
                })
            total_session_count = int(listing_payload.get('session_card_count') or 0)
            return jsonify({
                'category_key': scope_context['category_key'],
                'decks': readiness_decks,
                'total_session_count': total_session_count,
                'configured_session_count': total_session_count,
                'total_active_cards': sum(int(deck.get('total_cards') or 0) for deck in readiness_decks if bool(deck.get('included_in_queue'))),
                'include_orphan_in_queue': bool(scope_context['include_orphan_in_queue']),
                'has_chinese_specific_logic': False,
                **special_ready_payload,
            }), 200
        else:
            return jsonify({'error': 'Unsupported shared-deck operation for scope'}), 404

        payload = build_merged_source_decks_payload(
            sources,
            get_category_session_card_count_for_kid(kid, scope_context['category_key']),
            scope_context['include_orphan_in_queue'],
        )
        return jsonify({
            'category_key': scope_context['category_key'],
            **payload,
            'has_chinese_specific_logic': bool(scope_context['has_chinese_specific_logic']),
            'chinese_back_content': scope_context.get('chinese_back_content') or '',
            **special_ready_payload,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def update_shared_card_skip_bulk_for_scope(kid_id, category):
    """Handle bulk shared card skip updates by scope config."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        card_ids, skipped = parse_shared_card_skip_bulk_update_request()
        scope_context = resolve_shared_scope_management_context(
            kid,
            category,
            request.args.get('categoryKey'),
        )
        category_key = scope_context['category_key']
        orphan_deck_name = scope_context['orphan_deck_name']
        deck_label = category_key

        payload, status_code = update_shared_cards_skip_bulk_internal(
            kid,
            card_ids,
            skipped,
            category_key=category_key,
            orphan_deck_name=orphan_deck_name,
            deck_label=deck_label,
        )
        return jsonify(payload), status_code
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


SHARED_DECK_OPERATION_HANDLERS = {
    SHARED_DECK_OP_GET: get_shared_decks_for_scope,
    SHARED_DECK_OP_OPT_IN: opt_in_shared_decks_for_scope,
    SHARED_DECK_OP_OPT_OUT: opt_out_shared_decks_for_scope,
    SHARED_DECK_OP_GET_CARDS: get_shared_cards_for_scope,
    SHARED_DECK_OP_SKIP_UPDATE: update_shared_card_skip_for_scope,
    SHARED_DECK_OP_SKIP_UPDATE_BULK: update_shared_card_skip_bulk_for_scope,
    SHARED_DECK_OP_GET_DECKS: get_decks_for_scope,
    SHARED_DECK_OP_CARD_SEARCH_INDEX: get_shared_decks_card_search_index_for_scope,
}


def run_shared_deck_scope_operation(operation, kid_id, category, *, card_id=None):
    """Run one shared deck operation via generic operation handlers."""
    handler = SHARED_DECK_OPERATION_HANDLERS.get(operation)
    if handler is None:
        return jsonify({'error': 'Unsupported shared-deck operation for scope'}), 404
    if operation == SHARED_DECK_OP_SKIP_UPDATE:
        return handler(kid_id, category, card_id)
    return handler(kid_id, category)


def get_shared_type3_cards(kid_id):
    """Get merged cards across opted-in type-III decks and orphan deck."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        category_key, _ = resolve_kid_type_iii_category_with_mode(
            kid,
            request.args.get('categoryKey'),
        )
        payload = build_type_i_shared_cards_payload(
            kid,
            category_key,
            include_practiced_from_other=parse_include_practiced_from_other_arg(),
        )
        payload.update(build_kid_daily_progress_section(kid, category_key))
        return jsonify(payload), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def get_shared_type4_cards(kid_id):
    """Get representative cards across opted-in type-IV decks."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        category_key, _ = resolve_kid_type_iv_category_with_mode(
            kid,
            request.args.get('categoryKey'),
        )
        payload = build_type_iv_shared_cards_payload(
            kid,
            category_key,
        )
        payload.update(build_kid_daily_progress_section(kid, category_key))
        return jsonify(payload), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def get_shared_type2_cards(kid_id):
    """Get merged cards across opted-in type-II decks and orphan deck."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        category_key, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            request.args.get('categoryKey'),
        )
        category_display_name = get_deck_category_display_name(
            category_key,
            get_shared_deck_category_meta_by_key(),
        )

        conn = get_kid_connection_for(kid, read_only=True)
        try:
            sources = get_shared_type_ii_merged_source_decks_for_kid(
                conn,
                kid,
                category_key,
            )
            bank_sources = [
                src for src in sources
                if int(src.get('card_count') or 0) > 0 and bool(src.get('included_in_bank', True))
            ]
            bank_deck_ids = [int(src['local_deck_id']) for src in bank_sources]
            practice_sources = [src for src in sources if bool(src.get('included_in_queue'))]
            practice_source_ids = [
                int(src['local_deck_id'])
                for src in practice_sources
                if int(src.get('active_card_count') or 0) > 0
            ]

            pending_card_ids = []
            pending_card_set = set()
            candidate_rows = []
            candidate_card_ids = []
            candidate_card_set = set()
            candidate_reason_by_card = {}
            preview_excluded_ids = []
            if has_chinese_specific_logic:
                pending_card_ids = get_pending_writing_card_ids(conn)
                pending_card_set = set(pending_card_ids)
                preview_excluded_ids = list(pending_card_set)
                candidate_rows = get_writing_candidate_rows(
                    conn,
                    bank_deck_ids,
                    category_key,
                    excluded_card_ids=pending_card_ids,
                )
                candidate_card_ids = [int(row[0]) for row in candidate_rows]
                candidate_card_set = set(candidate_card_ids)
                for row in candidate_rows:
                    card_id = int(row[0])
                    latest_correct = int(row[3]) if row[3] is not None else None
                    if latest_correct is None:
                        candidate_reason_by_card[card_id] = ('never_seen', 'Newly added')
                    else:
                        candidate_reason_by_card[card_id] = ('last_failed', 'Last failed')
            special_ready_payload = build_special_session_ready_payload(
                conn,
                kid,
                category_key,
                source_by_deck_id={
                    int(src['local_deck_id']): src
                    for src in practice_sources
                    if int(src.get('active_card_count') or 0) > 0
                },
                source_deck_ids=practice_source_ids,
                excluded_card_ids=pending_card_ids,
            )

            preview_order = {}
            practice_priority_preview_by_card_id = {}
            practice_priority_subject_baseline = {
                'p50_correct_time': None,
                'p90_correct_time': None,
                'correct_sample_count': 0,
            }
            if practice_source_ids:
                priority_preview = build_practice_priority_preview_for_decks(
                    conn,
                    practice_source_ids,
                    category_key,
                    get_session_behavior_type(category_key),
                    excluded_card_ids=preview_excluded_ids,
                )
                preview_order = priority_preview['order_by_card_id']
                practice_priority_preview_by_card_id = priority_preview['details_by_card_id']
                practice_priority_subject_baseline = priority_preview['subject_baseline']

            orphan_deck_name = get_category_orphan_deck_name(category_key)

            def _source_label(source):
                tags = extract_shared_deck_tags_and_labels(source.get('tags') or [])[0]
                tail = tags[1:] if len(tags) > 1 else []
                if tail:
                    return ' / '.join(tail)
                local_name = str(source.get('local_name') or '')
                if local_name == orphan_deck_name:
                    return 'orphan'
                return local_name

            bank_deck_ids = [int(src['local_deck_id']) for src in bank_sources if int(src.get('local_deck_id') or 0) > 0]
            card_rows_by_deck_id = {}
            for row in get_cards_with_stats_for_deck_ids(conn, bank_deck_ids):
                deck_id = int(row[1] or 0)
                if deck_id > 0:
                    card_rows_by_deck_id.setdefault(deck_id, []).append(row)

            merged_cards = []
            for src in bank_sources:
                local_deck_id = int(src['local_deck_id'])
                rows = card_rows_by_deck_id.get(local_deck_id) or []
                source_tags = extract_shared_deck_tags_and_labels(src.get('tags') or [])[0]
                label = _source_label(src)
                source_name = str(src.get('local_name') or '')
                is_orphan = bool(src.get('is_orphan'))
                for row in rows:
                    mapped = map_card_row(row, preview_order, practice_priority_preview_by_card_id)
                    if not mapped.get('front') and mapped.get('back'):
                        mapped['front'] = mapped.get('back')
                    card_id = int(row[0])
                    is_candidate = card_id in candidate_card_set
                    mapped['pending_sheet'] = card_id in pending_card_set
                    mapped['available_for_practice'] = (not mapped['pending_sheet'])
                    mapped['practicing_reason'] = None
                    mapped['practicing_reason_label'] = None
                    if mapped['pending_sheet']:
                        mapped['writing_state'] = 3
                        mapped['writing_state_label'] = 'In Practicing Sheet'
                    elif is_candidate:
                        mapped['writing_state'] = 2
                        mapped['writing_state_label'] = 'Ready for Practicing Sheet'
                        reason = candidate_reason_by_card.get(card_id)
                        if reason:
                            mapped['practicing_reason'] = reason[0]
                            mapped['practicing_reason_label'] = reason[1]
                    else:
                        mapped['writing_state'] = 1
                        mapped['writing_state_label'] = 'Default'
                    mapped['source_deck_id'] = local_deck_id
                    mapped['source_deck_name'] = source_name
                    mapped['source_deck_label'] = label
                    mapped['source_deck_tags'] = source_tags
                    mapped['source_is_orphan'] = is_orphan
                    audio_meta = build_writing_prompt_audio_payload(
                        kid_id,
                        mapped.get('front'),
                        category_key=category_key,
                        has_chinese_specific_logic=has_chinese_specific_logic,
                    )
                    mapped['audio_file_name'] = audio_meta['audio_file_name']
                    mapped['audio_mime_type'] = audio_meta['audio_mime_type']
                    mapped['audio_url'] = audio_meta['audio_url']
                    mapped['prompt_audio_url'] = audio_meta['prompt_audio_url']
                    merged_cards.append(mapped)

            if parse_include_practiced_from_other_arg():
                existing_ids = {
                    int(card.get('id'))
                    for card in merged_cards
                    if int(card.get('id') or 0) > 0
                }
                practiced_ids = get_card_ids_practiced_for_category(conn, category_key)
                extra_ids = [cid for cid in practiced_ids if cid not in existing_ids]
                for row in get_cards_with_stats_for_card_ids(conn, extra_ids):
                    mapped = map_card_row(row, preview_order, practice_priority_preview_by_card_id)
                    if not mapped.get('front') and mapped.get('back'):
                        mapped['front'] = mapped.get('back')
                    mapped['pending_sheet'] = False
                    mapped['available_for_practice'] = False
                    mapped['practicing_reason'] = None
                    mapped['practicing_reason_label'] = None
                    mapped['writing_state'] = 1
                    mapped['writing_state_label'] = 'Default'
                    mapped['source_deck_id'] = int(row[1] or 0)
                    mapped['source_deck_name'] = ''
                    mapped['source_deck_label'] = ''
                    mapped['source_deck_tags'] = []
                    mapped['source_is_orphan'] = False
                    mapped['from_practice_history'] = True
                    mapped['audio_file_name'] = None
                    mapped['audio_mime_type'] = None
                    mapped['audio_url'] = None
                    mapped['prompt_audio_url'] = None
                    merged_cards.append(mapped)

            merged_by_id = {
                int(card.get('id')): card
                for card in merged_cards
                if int(card.get('id') or 0) > 0
            }
            practicing_cards = []
            for card_id in candidate_card_ids:
                card = merged_by_id.get(int(card_id))
                if card is not None and int(card.get('writing_state') or 0) == 2:
                    practicing_cards.append(card)
            practicing_sheet_cards = [
                card for card in merged_cards
                if int(card.get('writing_state') or 0) == 3
            ]

            active_count = sum(int(src.get('active_card_count') or 0) for src in bank_sources)
            skipped_count = sum(int(src.get('skipped_card_count') or 0) for src in bank_sources)
            practice_active_count = sum(int(src.get('active_card_count') or 0) for src in practice_sources)
            orphan_deck_id = get_category_orphan_deck(conn, category_key)
        finally:
            conn.close()

        return jsonify({
            'category_key': category_key,
            'has_chinese_specific_logic': bool(has_chinese_specific_logic),
            'is_merged_bank': True,
            'deck_name': f'Merged {category_display_name} Bank',
            'deck_id': orphan_deck_id,
            'include_orphan_in_queue': get_category_include_orphan_for_kid(kid, category_key),
            'practice_source_count': len(practice_sources),
            'practice_active_card_count': int(practice_active_count),
            'active_card_count': active_count,
            'skipped_card_count': skipped_count,
            'practicing_card_count': len(practicing_cards),
            'practicing_cards': practicing_cards,
            'practicing_sheet_card_count': len(practicing_sheet_cards),
            'practicing_sheet_cards': practicing_sheet_cards,
            'practice_priority_subject_baseline': practice_priority_subject_baseline,
            'cards': merged_cards,
            **special_ready_payload,
            **build_kid_daily_progress_section(kid, category_key),
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


CATEGORY_CONFIG.update({
    SHARED_DECK_SCOPE_TYPE1: {
        'kind': 'type1',
        'cards_handler': get_shared_type1_cards,
    },
    SHARED_DECK_SCOPE_TYPE3: {
        'kind': 'type3',
        'use_type_i_card_management': True,
        'cards_handler': get_shared_type3_cards,
    },
    SHARED_DECK_SCOPE_TYPE2: {
        'kind': 'type2',
        'use_type_ii_card_management': True,
        'cards_handler': get_shared_type2_cards,
    },
    SHARED_DECK_SCOPE_TYPE4: {
        'kind': 'type4',
        'cards_handler': get_shared_type4_cards,
    },
})


def sanitize_download_filename_stem(raw_name, fallback='recording'):
    """Return safe user-facing filename stem while preserving Unicode text."""
    text = str(raw_name or '').strip()
    if not text:
        text = fallback
    text = re.sub(r'[\x00-\x1f\x7f]+', '', text)
    text = text.replace('/', '／').replace('\\', '＼')
    text = text.strip().strip('.')
    if not text:
        text = fallback
    # Keep names reasonable for browser download dialogs.
    return text[:120]


def resolve_ffmpeg_executable():
    """Resolve ffmpeg binary path for environments without system ffmpeg."""
    configured = str(os.environ.get('FFMPEG_BIN') or '').strip()
    if configured:
        return configured

    system_ffmpeg = shutil.which('ffmpeg')
    if system_ffmpeg:
        return system_ffmpeg

    try:
        import imageio_ffmpeg  # type: ignore
        bundled = str(imageio_ffmpeg.get_ffmpeg_exe() or '').strip()
        if bundled:
            return bundled
    except Exception:
        return ''

    return ''



# Re-export everything (including underscore-prefixed module state and helpers)
# so that route sub-modules can do `from src.routes.kids import *`.
__all__ = [
    _name for _name in dict(globals()).keys()
    if not _name.startswith('__') and _name != '_name'
]

# Register routes — must be the LAST imports so all helpers + __all__ are defined first.
from . import shared_decks  # noqa: E402,F401
from . import kids_core  # noqa: E402,F401
from . import kid_decks  # noqa: E402,F401
from . import type2  # noqa: E402,F401
from . import type4  # noqa: E402,F401
from . import lesson_reading  # noqa: E402,F401
from . import practice  # noqa: E402,F401
from . import chinese_bank  # noqa: E402,F401
