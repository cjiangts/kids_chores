"""Pure payload builders for shared-deck routes.

Helpers that:
  - Build per-category type-I / type-IV opt-in payloads (deck lists with
    materialized state, orphan deck summary, session card counts).
  - Build merged "bank" card payloads for type-I / type-IV categories.
  - Build orphan-deck and merged-source readiness payloads used by routes.
  - Build the type-II / type-III shared-deck listing payload (generic
    over per-category shared-deck and materialized-deck query callbacks).
  - Resolve type-IV practice source rows and continue/retry readiness.

Pure functions: take an open `conn` (or none) plus a kid dict, return
plain Python data structures. No module state.

Layout (search for `# === N. ` banner markers to jump between sections):

    1. Deck/source summary helpers — orphan deck row + merged source rollup
    2. Type-I shared-deck listing — per-deck payload + Chinese-aware back-dedupe
    3. Type-IV shared-deck listing — per-deck representative + generator detail
    4. Shared-card payloads — merged type-I + type-IV card listings
    5. Type-IV practice readiness — source rows + special-session readiness
    6. Generic shared-decks listing — type-II / type-III via parametrized
       per-category shared-deck + materialized-deck callbacks
"""
from src.db.shared_deck_db import get_shared_decks_connection
from src.services.card_stats import (
    get_card_ids_practiced_for_category,
    get_cards_with_stats_for_card_ids,
    get_cards_with_stats_for_deck_ids,
    map_card_row,
)
from src.services.deck_source_merge import (
    get_card_count_summary_by_deck_ids,
    get_shared_merged_source_decks_for_kid,
    get_type_iv_bank_source_rows,
    get_type_iv_total_daily_target_for_category,
)
from src.services.family_auth import get_kid_connection_for
from src.services.kid_category_config import (
    get_category_include_orphan_for_kid,
    get_category_orphan_deck,
    get_category_orphan_deck_name,
    get_category_session_card_count_for_kid,
    get_orphan_deck,
    hydrate_kid_category_config_from_db,
)
from src.services.kid_daily_progress import get_deck_category_display_name
from src.services.kid_today_sessions import (
    get_latest_retry_source_session_for_today,
    get_latest_unfinished_session_for_today,
)
from src.services.practice_mode import get_session_practice_mode
from src.services.practice_priority import build_practice_priority_preview_for_decks
from src.services.shared_deck_category import (
    get_session_behavior_type,
    get_shared_deck_category_meta_by_key,
)
from src.services.shared_deck_materialize import build_materialized_shared_deck_name
from src.services.shared_deck_normalize import extract_shared_deck_tags_and_labels
from src.services.shared_deck_queries import (
    get_kid_materialized_shared_decks_by_first_tag,
    get_shared_deck_rows_by_first_tag,
    get_shared_type_iv_deck_rows,
)
from src.services.type4_generator_definitions import build_type_iv_generator_detail_maps
from src.services.type4_session import (
    build_type_iv_continue_count_by_source_key,
    get_type_iv_retry_source_result_rows,
)


# =====================================================================
# === 1. Deck/source summary helpers
# =====================================================================
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


# =====================================================================
# === 2. Type-I shared-deck listing
# =====================================================================
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


# =====================================================================
# === 3. Type-IV shared-deck listing
# =====================================================================
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


# =====================================================================
# === 4. Shared-card payloads (type-I + type-IV merged listings)
# =====================================================================
def build_type_i_shared_cards_payload(
    kid,
    category_key,
    *,
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
        include_orphan_in_queue = (
            bool(include_orphan_in_queue_override)
            if include_orphan_in_queue_override is not None
            else get_category_include_orphan_for_kid(kid, category_key)
        )
        sources = get_shared_merged_source_decks_for_kid(
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
        practice_priority_subject_baseline_ema = {
            'p50_correct_time_ema': None,
            'p90_correct_time_ema': None,
            'ema_card_count': 0,
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
            practice_priority_subject_baseline_ema = priority_preview['subject_baseline_ema']

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
        'practice_priority_subject_baseline_ema': practice_priority_subject_baseline_ema,
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


# =====================================================================
# === 5. Type-IV practice readiness
# =====================================================================
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
        source for source in list(get_shared_merged_source_decks_for_kid(
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


# =====================================================================
# === 6. Generic shared-decks listing (type-II / type-III)
# =====================================================================
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
