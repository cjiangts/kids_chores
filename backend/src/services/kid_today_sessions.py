"""Today-scoped session helpers + per-session card/answer/timing helpers.

Pure helpers that:
  - Resolve a kid's `today` window in their family timezone.
  - Find the latest unfinished or non-perfect session for today.
  - Read distinct card ids already practiced inside one session.
  - Filter client-submitted answers to planned/pending slots.
  - Cap logged response-time by session behavior type.

DB helpers take an open per-kid `conn`. No module state.

Layout:
  1. Today UTC bounds + latest retry-source session lookup
  2. Latest unfinished session + practiced card ids
  3. Submitted-answer filtering + response-time cap
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from src.db import metadata
from src.routes.kids_constants import (
    DECK_CATEGORY_BEHAVIOR_TYPE_III,
    MAX_LOGGED_RESPONSE_TIME_MS_BY_BEHAVIOR_TYPE,
    SESSION_RESULT_PARTIAL,
)
from src.services.practice_mode import is_drill_session_practice_mode
from src.services.shared_deck_category import get_session_behavior_type
from src.services.shared_deck_normalize import (
    normalize_shared_deck_category_behavior,
    normalize_shared_deck_tag,
)


# =====================================================================
# === 1. Today UTC bounds + latest retry-source session lookup
# =====================================================================

def get_kid_today_bounds_utc(kid):
    """Return today's [start, end) UTC bounds for one kid's family timezone."""
    family_id = str(kid.get('familyId') or '')
    family_timezone = metadata.get_family_timezone(family_id)
    tzinfo = ZoneInfo(family_timezone)
    day_start_local = datetime.now(tzinfo).replace(hour=0, minute=0, second=0, microsecond=0)
    day_end_local = day_start_local + timedelta(days=1)
    day_start_utc = day_start_local.astimezone(timezone.utc).replace(tzinfo=None)
    day_end_utc = day_end_local.astimezone(timezone.utc).replace(tzinfo=None)
    return day_start_utc, day_end_utc


def get_latest_retry_source_session_for_today(conn, kid, session_type):
    """Return latest non-perfect session for today (type-I/type-II only), else None."""
    session_key = normalize_shared_deck_tag(session_type)
    if not session_key:
        return None
    behavior_type = get_session_behavior_type(session_key)
    if behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_III:
        return None

    day_start_utc, day_end_utc = get_kid_today_bounds_utc(kid)
    row = conn.execute(
        """
        SELECT
            s.id,
            COALESCE(s.planned_count, 0) AS planned_count,
            COUNT(sr.id) AS answer_count,
            COALESCE(SUM(CASE WHEN sr.correct = 1 THEN 1 ELSE 0 END), 0) AS right_count,
            COALESCE(SUM(CASE WHEN sr.correct < 0 OR sr.correct = ? THEN 1 ELSE 0 END), 0) AS wrong_count,
            COALESCE(s.retry_best_rety_correct_count, 0) AS retry_best_rety_correct_count
        FROM sessions s
        LEFT JOIN session_results sr ON sr.session_id = s.id
        WHERE s.type = ?
          AND s.completed_at IS NOT NULL
          AND s.completed_at >= ?
          AND s.completed_at < ?
        GROUP BY s.id, s.planned_count, s.retry_best_rety_correct_count, s.completed_at, s.started_at
        ORDER BY COALESCE(s.completed_at, s.started_at) DESC, s.id DESC
        LIMIT 1
        """,
        [SESSION_RESULT_PARTIAL, session_key, day_start_utc, day_end_utc],
    ).fetchone()
    if not row:
        return None

    session_id = int(row[0] or 0)
    planned_count = int(row[1] or 0)
    answer_count = int(row[2] or 0)
    right_count = int(row[3] or 0)
    wrong_count = int(row[4] or 0)
    retry_best_rety_correct_count = max(0, int(row[5] or 0))
    target_answer_count = max(answer_count, right_count + wrong_count)
    if session_id <= 0 or target_answer_count <= 0 or wrong_count <= 0:
        return None

    effective_best_total_correct = right_count + retry_best_rety_correct_count
    if effective_best_total_correct >= target_answer_count:
        return None

    return {
        'session_id': session_id,
        'planned_count': planned_count,
        'answer_count': target_answer_count,
        'right_count': right_count,
        'wrong_count': wrong_count,
    }


# =====================================================================
# === 2. Latest unfinished session + practiced card ids
# =====================================================================

def get_latest_unfinished_session_for_today(conn, kid, session_type):
    """Return latest unfinished session for today when planned_count > answer_count."""
    session_key = normalize_shared_deck_tag(session_type)
    if not session_key:
        return None

    day_start_utc, day_end_utc = get_kid_today_bounds_utc(kid)
    row = conn.execute(
        """
        SELECT
            s.id,
            COALESCE(s.planned_count, 0) AS planned_count,
            COUNT(sr.id) AS answer_count,
            COALESCE(SUM(CASE WHEN sr.correct = 1 THEN 1 ELSE 0 END), 0) AS right_count,
            COALESCE(SUM(CASE WHEN sr.correct < 0 OR sr.correct = 2 THEN 1 ELSE 0 END), 0) AS wrong_count
        FROM sessions s
        LEFT JOIN session_results sr ON sr.session_id = s.id
        WHERE s.type = ?
          AND COALESCE(s.planned_count, 0) > 0
          AND COALESCE(s.completed_at, s.started_at) >= ?
          AND COALESCE(s.completed_at, s.started_at) < ?
        GROUP BY s.id, s.planned_count, s.completed_at, s.started_at
        HAVING COUNT(sr.id) < COALESCE(s.planned_count, 0)
        ORDER BY COALESCE(s.completed_at, s.started_at) DESC, s.id DESC
        LIMIT 1
        """,
        [session_key, day_start_utc, day_end_utc],
    ).fetchone()
    if not row:
        return None

    session_id = int(row[0] or 0)
    planned_count = max(0, int(row[1] or 0))
    answer_count = max(0, int(row[2] or 0))
    right_count = max(0, int(row[3] or 0))
    wrong_count = max(0, int(row[4] or 0))
    if session_id <= 0 or planned_count <= 0 or answer_count >= planned_count:
        return None

    return {
        'session_id': session_id,
        'planned_count': planned_count,
        'answer_count': answer_count,
        'right_count': right_count,
        'wrong_count': wrong_count,
    }


def get_session_practiced_card_ids(conn, session_id):
    """Return ordered unique card ids already practiced in one session."""
    rows = conn.execute(
        """
        SELECT DISTINCT card_id
        FROM session_results
        WHERE session_id = ?
          AND card_id IS NOT NULL
        ORDER BY card_id ASC
        """,
        [int(session_id)],
    ).fetchall()
    card_ids = []
    for row in rows:
        try:
            card_id = int(row[0])
        except (TypeError, ValueError):
            continue
        if card_id > 0:
            card_ids.append(card_id)
    return card_ids


# =====================================================================
# === 3. Submitted-answer filtering + response-time cap
# =====================================================================

def filter_answers_to_pending_cards(answers, pending):
    """Keep answers that match planned slots; ignore extras/unplanned cards.

    Drill sessions allow unlimited attempts per card. Other sessions allow up
    to N answers per card where N is how many times that card appears in the
    planned cards list (retry can have duplicates when the source had multiple
    wrong rows for one card).
    """
    if not isinstance(answers, list):
        return []
    if not isinstance(pending, dict):
        return []

    planned_cards = pending.get('cards')
    if not isinstance(planned_cards, list) or len(planned_cards) == 0:
        return []

    planned_count_by_id = {}
    for item in planned_cards:
        if not isinstance(item, dict):
            continue
        try:
            card_id = int(item.get('id'))
        except (TypeError, ValueError):
            continue
        if card_id > 0:
            planned_count_by_id[card_id] = planned_count_by_id.get(card_id, 0) + 1
    if not planned_count_by_id:
        return []

    allow_unlimited = is_drill_session_practice_mode(pending.get('practice_mode'))

    filtered = []
    used_count_by_id = {}
    for answer in answers:
        if not isinstance(answer, dict):
            continue
        try:
            card_id = int(answer.get('cardId'))
        except (TypeError, ValueError):
            continue
        if card_id <= 0:
            continue
        if card_id not in planned_count_by_id:
            continue
        if not allow_unlimited:
            used = used_count_by_id.get(card_id, 0)
            if used >= planned_count_by_id[card_id]:
                continue
            used_count_by_id[card_id] = used + 1
        filtered.append({**answer, 'cardId': card_id})
    return filtered


def normalize_logged_response_time_ms(raw_response_time_ms, session_behavior_type=''):
    """Normalize and cap logged response time by session behavior type."""
    try:
        response_time_ms = int(raw_response_time_ms)
    except (TypeError, ValueError):
        response_time_ms = 0
    response_time_ms = max(0, response_time_ms)
    behavior_type = normalize_shared_deck_category_behavior(session_behavior_type)
    max_ms = MAX_LOGGED_RESPONSE_TIME_MS_BY_BEHAVIOR_TYPE.get(behavior_type)
    if max_ms is not None:
        return min(response_time_ms, int(max_ms))
    return response_time_ms
