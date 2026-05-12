"""Practice session selection, planning, and post-session helpers.

Pure helpers that:
  - Build candidate / ordered / planned card lists for a session start.
  - Build continuation card lists for resuming an unfinished session.
  - Build retry card lists from a source session's wrong rows.
  - Build the multiple-choice pool for type-I retry.
  - Compose continue/retry "ready" payloads for category dashboards.
  - Update card hardness scores after one session is committed.

DB helpers take an open per-kid `conn`. No module state.
"""
from src.routes.kids_constants import (
    DECK_CATEGORY_BEHAVIOR_TYPE_I,
    DECK_CATEGORY_BEHAVIOR_TYPE_II,
    DECK_CATEGORY_BEHAVIOR_TYPE_III,
    SESSION_RESULT_WRONG_UNRESOLVED,
)
from src.services.kid_category_config import get_category_session_card_count_for_kid
from src.services.kid_today_sessions import (
    get_latest_retry_source_session_for_today,
    get_latest_unfinished_session_for_today,
    get_session_practiced_card_ids,
)
from src.services.practice_mode import get_session_practice_mode
from src.services.practice_priority import build_practice_priority_preview_for_decks
from src.services.shared_deck_category import get_session_behavior_type
from src.services.shared_deck_normalize import extract_shared_deck_tags_and_labels


def get_practice_candidate_cards_for_decks(conn, deck_ids, excluded_card_ids=None):
    """Return active candidate cards across one or more decks."""
    normalized_deck_ids = []
    for raw_deck_id in list(deck_ids or []):
        try:
            deck_id = int(raw_deck_id)
        except (TypeError, ValueError):
            continue
        if deck_id <= 0 or deck_id in normalized_deck_ids:
            continue
        normalized_deck_ids.append(deck_id)
    if len(normalized_deck_ids) == 0:
        return {}, []

    excluded_set = set(excluded_card_ids or [])
    excluded_ids = sorted(excluded_set)
    exclude_clause = ""
    deck_placeholders = ','.join(['?'] * len(normalized_deck_ids))
    params = [*normalized_deck_ids]
    if len(excluded_ids) > 0:
        placeholders = ','.join(['?'] * len(excluded_ids))
        exclude_clause = f" AND c.id NOT IN ({placeholders})"
        params.extend(excluded_ids)

    rows = conn.execute(
        f"""
        SELECT
            c.id,
            c.deck_id,
            c.front,
            c.back,
            c.created_at
        FROM cards c
        WHERE c.deck_id IN ({deck_placeholders}) AND COALESCE(c.skip_practice, FALSE) = FALSE
        {exclude_clause}
        ORDER BY c.id ASC
        """,
        params
    ).fetchall()

    if len(rows) == 0:
        return {}, []

    cards_by_id = {
        row[0]: {
            'id': row[0],
            'deck_id': row[1],
            'front': row[2],
            'back': row[3],
            'created_at': row[4].isoformat() if row[4] else None
        }
        for row in rows
    }
    candidate_ids = [row[0] for row in rows]
    return cards_by_id, candidate_ids


def preview_deck_practice_order_for_decks(conn, kid, deck_ids, session_type, excluded_card_ids=None):
    """Preview merged queue order across multiple decks."""
    _, candidate_ids = get_practice_candidate_cards_for_decks(
        conn,
        deck_ids,
        excluded_card_ids=excluded_card_ids,
    )
    if len(candidate_ids) == 0:
        return []
    priority_preview = build_practice_priority_preview_for_decks(
        conn,
        deck_ids,
        session_type,
        get_session_behavior_type(session_type),
        excluded_card_ids=excluded_card_ids,
    )
    ordered_ids = [
        card_id
        for card_id, _ in sorted(
            priority_preview['order_by_card_id'].items(),
            key=lambda item: item[1],
        )
    ]
    seen = set(ordered_ids)
    for card_id in candidate_ids:
        if card_id not in seen:
            ordered_ids.append(card_id)
            seen.add(card_id)
    return ordered_ids


def plan_deck_practice_selection_for_decks(conn, kid, deck_ids, session_type, excluded_card_ids=None):
    """Build deterministic merged session selection across multiple decks."""
    cards_by_id, candidate_ids = get_practice_candidate_cards_for_decks(
        conn,
        deck_ids,
        excluded_card_ids=excluded_card_ids,
    )
    if len(candidate_ids) == 0:
        return cards_by_id, []
    ordered_ids = preview_deck_practice_order_for_decks(
        conn,
        kid,
        deck_ids,
        session_type,
        excluded_card_ids=excluded_card_ids,
    )
    target_count = min(
        get_category_session_card_count_for_kid(kid, session_type),
        len(candidate_ids),
    )
    selected_ids = ordered_ids[:target_count] if target_count > 0 else []
    return cards_by_id, selected_ids


def build_continue_selected_cards_for_decks(
    conn,
    kid,
    deck_ids,
    session_type,
    missing_count,
    *,
    excluded_card_ids=None,
):
    """Build continuation card selection for one unfinished session."""
    target_count = max(0, int(missing_count or 0))
    normalized_deck_ids = []
    seen_deck_ids = set()
    for raw_deck_id in list(deck_ids or []):
        try:
            deck_id = int(raw_deck_id)
        except (TypeError, ValueError):
            continue
        if deck_id <= 0 or deck_id in seen_deck_ids:
            continue
        normalized_deck_ids.append(deck_id)
        seen_deck_ids.add(deck_id)
    if target_count <= 0 or len(normalized_deck_ids) == 0:
        return []

    cards_by_id, candidate_ids = get_practice_candidate_cards_for_decks(
        conn,
        normalized_deck_ids,
        excluded_card_ids=excluded_card_ids,
    )
    if len(candidate_ids) == 0:
        return []

    ordered_ids = preview_deck_practice_order_for_decks(
        conn,
        kid,
        normalized_deck_ids,
        session_type,
        excluded_card_ids=excluded_card_ids,
    )

    selected_cards = []
    for card_id in ordered_ids:
        card = cards_by_id.get(card_id)
        if not card:
            continue
        selected_cards.append(card)
        if len(selected_cards) >= target_count:
            break
    return selected_cards


def get_retry_source_wrong_card_ids(conn, source_session_id):
    """Return one card_id per unresolved -1 row (duplicates allowed).

    Each wrong attempt is its own retry slot. The same card answered wrong
    twice yields two entries so retry asks twice, and each retry answer
    promotes one specific source row from -1 to -2.
    """
    rows = conn.execute(
        """
        SELECT card_id
        FROM session_results
        WHERE session_id = ?
          AND correct = ?
          AND card_id IS NOT NULL
        ORDER BY id ASC
        """,
        [int(source_session_id), SESSION_RESULT_WRONG_UNRESOLVED],
    ).fetchall()
    wrong_card_ids = []
    for row in rows:
        try:
            card_id = int(row[0])
        except (TypeError, ValueError):
            continue
        if card_id > 0:
            wrong_card_ids.append(card_id)
    return wrong_card_ids


def build_retry_selected_cards_for_sources(conn, source_by_deck_id, wrong_card_ids):
    """Build retry cards (same payload shape as normal start) from wrong-card ids.

    Duplicates in `wrong_card_ids` are preserved so the same card can appear
    multiple times when it had multiple unresolved wrong rows in the source.
    """
    ordered_ids = []
    for raw_card_id in list(wrong_card_ids or []):
        try:
            card_id = int(raw_card_id)
        except (TypeError, ValueError):
            continue
        if card_id <= 0:
            continue
        ordered_ids.append(card_id)
    if len(ordered_ids) == 0:
        return []

    unique_ids = list(dict.fromkeys(ordered_ids))
    placeholders = ', '.join(['?'] * len(unique_ids))
    rows = conn.execute(
        f"""
        SELECT id, deck_id, front, back, created_at
        FROM cards
        WHERE id IN ({placeholders})
          AND COALESCE(skip_practice, FALSE) = FALSE
        ORDER BY id ASC
        """,
        unique_ids,
    ).fetchall()
    row_by_card_id = {int(row[0]): row for row in rows}

    selected_cards = []
    for card_id in ordered_ids:
        row = row_by_card_id.get(card_id)
        if not row:
            continue
        local_deck_id = int(row[1] or 0)
        src = source_by_deck_id.get(local_deck_id)
        if not isinstance(src, dict):
            continue
        selected_cards.append({
            'id': int(row[0]),
            'deck_id': local_deck_id,
            'front': row[2],
            'back': row[3],
            'created_at': row[4].isoformat() if row[4] else None,
            'shared_deck_id': int(src['shared_deck_id']) if src.get('shared_deck_id') is not None else None,
            'deck_name': str(src.get('local_name') or ''),
            'source_tags': extract_shared_deck_tags_and_labels(src.get('tags') or [])[0],
            'source_is_orphan': bool(src.get('is_orphan')),
        })
    return selected_cards


def build_type_i_multiple_choice_pool_cards(conn, source_by_deck_id, card_ids):
    """Build ordered type-I multiple-choice pool cards from source session card ids."""
    normalized_ids = []
    seen = set()
    for raw_card_id in list(card_ids or []):
        try:
            card_id = int(raw_card_id)
        except (TypeError, ValueError):
            continue
        if card_id <= 0 or card_id in seen:
            continue
        normalized_ids.append(card_id)
        seen.add(card_id)
    if len(normalized_ids) == 0:
        return []

    placeholders = ', '.join(['?'] * len(normalized_ids))
    rows = conn.execute(
        f"""
        SELECT id, deck_id, front, back
        FROM cards
        WHERE id IN ({placeholders})
        """,
        normalized_ids,
    ).fetchall()
    row_by_card_id = {int(row[0]): row for row in rows}

    pool_cards = []
    for card_id in normalized_ids:
        row = row_by_card_id.get(card_id)
        if not row:
            continue
        local_deck_id = int(row[1] or 0)
        if local_deck_id <= 0 or local_deck_id not in source_by_deck_id:
            continue
        pool_cards.append({
            'id': int(row[0]),
            'front': row[2],
            'back': row[3],
        })
    return pool_cards


def build_retry_ready_payload(conn, kid, category_key, source_by_deck_id):
    """Build retry-ready metadata for one category and source deck set."""
    retry_source_session = get_latest_retry_source_session_for_today(conn, kid, category_key)
    if retry_source_session is None:
        return {
            'is_retry_session': False,
            'retry_source_session_id': None,
            'retry_card_count': 0,
        }

    retry_wrong_card_ids = get_retry_source_wrong_card_ids(
        conn,
        retry_source_session['session_id'],
    )
    retry_cards = build_retry_selected_cards_for_sources(
        conn,
        source_by_deck_id,
        retry_wrong_card_ids,
    )
    return {
        'is_retry_session': True,
        'retry_source_session_id': int(retry_source_session['session_id']),
        'retry_card_count': len(retry_cards),
    }


def build_special_session_ready_payload(
    conn,
    kid,
    category_key,
    *,
    source_by_deck_id,
    source_deck_ids,
    excluded_card_ids=None,
):
    """Build continuation/retry readiness metadata for one category."""
    continue_source_session = get_latest_unfinished_session_for_today(conn, kid, category_key)
    if continue_source_session is not None:
        practiced_card_ids = get_session_practiced_card_ids(
            conn,
            continue_source_session['session_id'],
        )
        excluded_set = set()
        for raw_card_id in list(excluded_card_ids or []):
            try:
                card_id = int(raw_card_id)
            except (TypeError, ValueError):
                continue
            if card_id > 0:
                excluded_set.add(card_id)
        for raw_card_id in practiced_card_ids:
            try:
                card_id = int(raw_card_id)
            except (TypeError, ValueError):
                continue
            if card_id > 0:
                excluded_set.add(card_id)
        missing_count = max(
            0,
            int(continue_source_session['planned_count']) - int(continue_source_session['answer_count']),
        )
        continue_cards = build_continue_selected_cards_for_decks(
            conn,
            kid,
            source_deck_ids,
            category_key,
            missing_count,
            excluded_card_ids=list(excluded_set),
        )
        source_practice_mode = get_session_practice_mode(conn, continue_source_session['session_id'])
        return {
            'is_continue_session': True,
            'continue_source_session_id': int(continue_source_session['session_id']),
            'continue_card_count': len(continue_cards),
            'is_retry_session': False,
            'retry_source_session_id': None,
            'retry_card_count': 0,
            'source_practice_mode': source_practice_mode,
        }

    retry_payload = build_retry_ready_payload(conn, kid, category_key, source_by_deck_id)
    result = {
        'is_continue_session': False,
        'continue_source_session_id': None,
        'continue_card_count': 0,
        **retry_payload,
    }
    if retry_payload.get('is_retry_session') and retry_payload.get('retry_source_session_id'):
        result['source_practice_mode'] = get_session_practice_mode(conn, retry_payload['retry_source_session_id'])
    return result


def update_card_hardness_after_session(
    conn,
    *,
    session_behavior_type,
    latest_response_by_card,
    touched_card_ids,
    session_type,
):
    """Update card hardness for one completed session."""
    if session_behavior_type in (DECK_CATEGORY_BEHAVIOR_TYPE_I, DECK_CATEGORY_BEHAVIOR_TYPE_III):
        for card_id, latest_ms in latest_response_by_card.items():
            conn.execute(
                "UPDATE cards SET hardness_score = ? WHERE id = ?",
                [float(latest_ms or 0), card_id]
            )
        return
    if session_behavior_type != DECK_CATEGORY_BEHAVIOR_TYPE_II or len(touched_card_ids) == 0:
        return
    placeholders = ','.join(['?'] * len(touched_card_ids))
    conn.execute(
        f"""
        UPDATE cards
        SET hardness_score = stats.hardness_score
        FROM (
            SELECT
                sr.card_id,
                COALESCE(100.0 - (100.0 * AVG(CASE WHEN sr.correct = 1 THEN 1.0 ELSE 0.0 END)), 0) AS hardness_score
            FROM session_results sr
            JOIN sessions s ON s.id = sr.session_id
            WHERE s.type = ?
              AND sr.card_id IN ({placeholders})
            GROUP BY sr.card_id
        ) AS stats
        WHERE cards.id = stats.card_id
        """,
        [session_type, *list(touched_card_ids)]
    )
