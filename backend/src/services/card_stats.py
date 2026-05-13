"""Card listing + stats helpers (deck-scoped or by card id) + the row-to-API mapper.

Pure DB helpers and a pure row mapper — no module-level state, all DB access
goes through an open kid `conn` arg.

Layout:
  1. Single-card delete
  2. Cards-with-stats readers (deck-scoped + card-id-scoped) + practiced-card ids
  3. Row-to-API mapper (with practice-priority preview merged in)
"""
from src.services.normalize_inputs import normalize_positive_int_list


# =====================================================================
# === 1. Single-card delete
# =====================================================================

def delete_card_from_deck_internal(conn, card_id):
    """Delete one card from a deck."""
    conn.execute("DELETE FROM cards WHERE id = ?", [card_id])


# =====================================================================
# === 2. Cards-with-stats readers (deck-scoped + card-id-scoped) + practiced-card ids
# =====================================================================

def get_cards_with_stats_for_deck_ids(conn, deck_ids):
    """Return cards with hardness / attempt / last-seen stats for many decks."""
    normalized_ids = normalize_positive_int_list(deck_ids)
    if not normalized_ids:
        return []

    placeholders = ','.join(['?'] * len(normalized_ids))
    return conn.execute(
        f"""
        SELECT
            c.id,
            c.deck_id,
            c.front,
            c.back,
            COALESCE(c.skip_practice, FALSE) AS skip_practice,
            c.hardness_score,
            c.created_at,
            COUNT(sr.id) AS lifetime_attempts,
            MAX(sr.timestamp) AS last_seen_at,
            MIN(sr.timestamp) AS first_practiced_at,
            100.0 * AVG(
                CASE
                    WHEN sr.id IS NULL THEN NULL
                    WHEN sr.correct = 1 THEN 0.0
                    ELSE 1.0
                END
            ) AS overall_wrong_rate,
            ARG_MAX(
                CASE
                    WHEN sr.id IS NULL THEN NULL
                    ELSE COALESCE(sr.response_time_ms, 0)
                END,
                sr.timestamp
            ) AS last_response_time_ms,
            ARG_MAX(
                CASE
                    WHEN sr.id IS NULL THEN NULL
                    ELSE sr.correct
                END,
                sr.timestamp
            ) AS last_result_correct,
            AVG(
                CASE
                    WHEN sr.id IS NULL THEN NULL
                    WHEN COALESCE(sr.response_time_ms, 0) > 0 THEN COALESCE(sr.response_time_ms, 0)
                    ELSE NULL
                END
            ) AS avg_response_time_ms
        FROM cards c
        LEFT JOIN session_results sr ON c.id = sr.card_id
        WHERE c.deck_id IN ({placeholders})
        GROUP BY c.id, c.deck_id, c.front, c.back, c.skip_practice, c.hardness_score, c.created_at
        ORDER BY c.deck_id ASC, c.id ASC
        """,
        normalized_ids,
    ).fetchall()


def get_cards_with_stats(conn, deck_id):
    """Return cards with hardness / attempt / last-seen stats."""
    return get_cards_with_stats_for_deck_ids(conn, [deck_id])


def get_cards_with_stats_for_card_ids(conn, card_ids):
    """Return cards with hardness / attempt / last-seen stats by explicit card ids."""
    normalized_ids = normalize_positive_int_list(card_ids)
    if not normalized_ids:
        return []

    placeholders = ','.join(['?'] * len(normalized_ids))
    return conn.execute(
        f"""
        SELECT
            c.id,
            c.deck_id,
            c.front,
            c.back,
            COALESCE(c.skip_practice, FALSE) AS skip_practice,
            c.hardness_score,
            c.created_at,
            COUNT(sr.id) AS lifetime_attempts,
            MAX(sr.timestamp) AS last_seen_at,
            MIN(sr.timestamp) AS first_practiced_at,
            100.0 * AVG(
                CASE
                    WHEN sr.id IS NULL THEN NULL
                    WHEN sr.correct = 1 THEN 0.0
                    ELSE 1.0
                END
            ) AS overall_wrong_rate,
            ARG_MAX(
                CASE
                    WHEN sr.id IS NULL THEN NULL
                    ELSE COALESCE(sr.response_time_ms, 0)
                END,
                sr.timestamp
            ) AS last_response_time_ms,
            ARG_MAX(
                CASE
                    WHEN sr.id IS NULL THEN NULL
                    ELSE sr.correct
                END,
                sr.timestamp
            ) AS last_result_correct,
            AVG(
                CASE
                    WHEN sr.id IS NULL THEN NULL
                    WHEN COALESCE(sr.response_time_ms, 0) > 0 THEN COALESCE(sr.response_time_ms, 0)
                    ELSE NULL
                END
            ) AS avg_response_time_ms
        FROM cards c
        LEFT JOIN session_results sr ON c.id = sr.card_id
        WHERE c.id IN ({placeholders})
        GROUP BY c.id, c.deck_id, c.front, c.back, c.skip_practice, c.hardness_score, c.created_at
        ORDER BY c.id ASC
        """,
        normalized_ids,
    ).fetchall()


def get_card_ids_practiced_for_category(conn, category_key):
    """Return distinct card ids that have any session_results in sessions of this category."""
    key = str(category_key or '').strip()
    if not key:
        return []
    rows = conn.execute(
        """
        SELECT DISTINCT sr.card_id
        FROM session_results sr
        JOIN sessions s ON sr.session_id = s.id
        WHERE s.type = ?
        """,
        [key],
    ).fetchall()
    return [int(r[0]) for r in rows if r and r[0] is not None]


# =====================================================================
# === 3. Row-to-API mapper (with practice-priority preview merged in)
# =====================================================================

def map_card_row(row, preview_order, practice_priority_preview_by_card_id=None):
    """Map raw card+stats row to API object."""
    last_result_correct = row[12]
    if last_result_correct is None:
        last_result = None
    elif int(last_result_correct) > 0:
        last_result = 'right'
    elif int(last_result_correct) == 0:
        last_result = 'ungraded'
    else:
        last_result = 'wrong'
    practice_priority_preview = (
        practice_priority_preview_by_card_id.get(row[0])
        if isinstance(practice_priority_preview_by_card_id, dict)
        else None
    ) or {}
    return {
        'id': row[0],
        'deck_id': row[1],
        'front': row[2],
        'back': row[3],
        'skip_practice': bool(row[4]),
        'hardness_score': float(row[5]) if row[5] is not None else 0,
        'created_at': row[6].isoformat() if row[6] else None,
        'next_session_order': preview_order.get(row[0]),
        'lifetime_attempts': int(row[7]) if row[7] is not None else 0,
        'last_seen_at': row[8].isoformat() if row[8] else None,
        'first_practiced_at': row[9].isoformat() if row[9] else None,
        'overall_wrong_rate': float(row[10]) if row[10] is not None else None,
        'last_response_time_ms': int(row[11]) if row[11] is not None else None,
        'last_result': last_result,
        'avg_response_time_ms': float(row[13]) if row[13] is not None else None,
        'practice_priority_order': practice_priority_preview.get('order'),
        'practice_priority_score': practice_priority_preview.get('priority_score'),
        'practice_priority_missed_points': practice_priority_preview.get('missed_points'),
        'practice_priority_slow_points': practice_priority_preview.get('slow_points'),
        'practice_priority_learning_points': practice_priority_preview.get('learning_points'),
        'practice_priority_due_points': practice_priority_preview.get('due_points'),
        'practice_priority_correct_rate': practice_priority_preview.get('correct_rate'),
        'practice_priority_correct_count': practice_priority_preview.get('correct_count'),
        'practice_priority_wrong_count': practice_priority_preview.get('wrong_count'),
        'practice_priority_attempt_count': practice_priority_preview.get('attempt_count'),
        'practice_priority_avg_correct_response_time': practice_priority_preview.get('avg_correct_response_time'),
        'practice_priority_days_since_last_seen': practice_priority_preview.get('days_since_last_seen'),
        'practice_priority_last_practiced_at': practice_priority_preview.get('last_practiced_at'),
        'practice_priority_primary_reason': practice_priority_preview.get('primary_reason'),
    }
