"""Type-II writing candidate selection + Chinese print-sheet layout helpers.

Pure DB helpers that take an open kid `conn`. The Chinese print-sheet helpers
are tightly coupled to writing-candidate selection because pending print sheets
block their cards from re-entering the candidate pool.

Layout:
  1. Writing-candidate row + id readers (newly-added or latest-failed)
  2. Chinese print-sheet layout parse + per-row card-id accessor
  3. Pending-sheet card ids + bulk card removal from in-progress sheets
"""
import json

from src.services.normalize_inputs import (
    normalize_lowercase_string_list,
    normalize_positive_int_list,
)


# =====================================================================
# === 1. Writing-candidate row + id readers (newly-added or latest-failed)
# =====================================================================

def get_writing_candidate_rows(conn, deck_ids, session_type, excluded_card_ids=None, limit=None):
    """Return ordered candidate cards for writing sheets: newly-added (never-seen) or latest-failed."""
    normalized_deck_ids = normalize_positive_int_list(deck_ids)
    if not normalized_deck_ids:
        return []

    excluded = normalize_positive_int_list(excluded_card_ids)

    safe_limit = None
    if limit is not None:
        try:
            parsed_limit = int(limit)
        except (TypeError, ValueError):
            parsed_limit = 0
        if parsed_limit > 0:
            safe_limit = parsed_limit

    deck_placeholders = ','.join(['?'] * len(normalized_deck_ids))
    params = [*normalized_deck_ids]
    exclude_clause = ''
    if excluded:
        excluded_placeholders = ','.join(['?'] * len(excluded))
        exclude_clause = f"AND c.id NOT IN ({excluded_placeholders})"
        params.extend(excluded)

    limit_clause = ''
    if safe_limit is not None:
        limit_clause = 'LIMIT ?'
        params.append(safe_limit)

    return conn.execute(
        f"""
        WITH latest AS (
            SELECT
                sr.card_id,
                sr.correct,
                COALESCE(s.completed_at, s.started_at, sr.timestamp) AS latest_seen_at,
                ROW_NUMBER() OVER (
                    PARTITION BY sr.card_id
                    ORDER BY COALESCE(s.completed_at, s.started_at, sr.timestamp) DESC, sr.id DESC
                ) AS rn
            FROM session_results sr
            JOIN sessions s ON s.id = sr.session_id
            WHERE s.type = ?
        )
        SELECT
            c.id,
            c.front,
            c.back,
            l.correct,
            l.latest_seen_at
        FROM cards c
        LEFT JOIN latest l ON l.card_id = c.id AND l.rn = 1
        WHERE c.deck_id IN ({deck_placeholders})
          AND COALESCE(c.skip_practice, FALSE) = FALSE
          AND (l.card_id IS NULL OR l.correct < 0)
          {exclude_clause}
        ORDER BY
          CASE WHEN l.card_id IS NULL THEN 1 ELSE 0 END DESC,
          COALESCE(l.latest_seen_at, c.created_at) DESC,
          c.id DESC
        {limit_clause}
        """,
        [str(session_type), *params]
    ).fetchall()


def get_writing_candidate_card_ids(conn, deck_ids, session_type, excluded_card_ids=None, limit=None):
    """Return candidate card ids for writing sheets in priority order."""
    rows = get_writing_candidate_rows(
        conn,
        deck_ids,
        session_type,
        excluded_card_ids=excluded_card_ids,
        limit=limit,
    )
    return [int(row[0]) for row in rows]


# =====================================================================
# === 2. Chinese print-sheet layout parse + per-row card-id accessor
# =====================================================================

def _load_type2_chinese_print_sheet_layout(layout_json):
    """Parse one saved Chinese print-sheet layout payload."""
    try:
        layout = json.loads(layout_json) if layout_json else {}
    except (json.JSONDecodeError, TypeError):
        return {}, []
    rows = layout.get('rows')
    if not isinstance(rows, list):
        return layout, []
    return layout, rows


def _get_type2_chinese_print_sheet_row_card_id(row):
    """Return the normalized card id stored in one Chinese print-sheet row."""
    if not isinstance(row, dict):
        return None
    raw_card_id = row.get('card_id')
    if raw_card_id is None:
        raw_card_id = row.get('cardId')
    try:
        card_id = int(raw_card_id)
    except (TypeError, ValueError):
        return None
    return card_id if card_id > 0 else None


# =====================================================================
# === 3. Pending-sheet card ids + bulk card removal from in-progress sheets
# =====================================================================

def get_pending_writing_card_ids(conn):
    """Return card ids currently blocked by pending Chinese print sheets."""
    rows = conn.execute(
        """
        SELECT layout_json
        FROM type2_chinese_print_sheets
        WHERE status = 'pending'
        """
    ).fetchall()
    pending_card_ids = []
    seen = set()
    for row in rows:
        _, layout_rows = _load_type2_chinese_print_sheet_layout(row[0])
        for layout_row in layout_rows:
            card_id = _get_type2_chinese_print_sheet_row_card_id(layout_row)
            if card_id is None or card_id in seen:
                continue
            seen.add(card_id)
            pending_card_ids.append(card_id)
    return pending_card_ids


def remove_cards_from_type2_chinese_print_sheets(conn, card_ids, *, statuses=('preview', 'pending')):
    """Remove selected cards from saved in-progress Chinese print sheets."""
    normalized_card_ids = normalize_positive_int_list(card_ids)
    normalized_statuses = normalize_lowercase_string_list(statuses)

    if not normalized_card_ids or not normalized_statuses:
        return

    status_placeholders = ','.join(['?'] * len(normalized_statuses))
    rows = conn.execute(
        f"""
        SELECT id, layout_json
        FROM type2_chinese_print_sheets
        WHERE status IN ({status_placeholders})
        """,
        normalized_statuses,
    ).fetchall()

    blocked_card_set = set(normalized_card_ids)
    for row in rows:
        sheet_id = int(row[0] or 0)
        if sheet_id <= 0:
            continue
        layout, layout_rows = _load_type2_chinese_print_sheet_layout(row[1])
        if not layout_rows:
            continue

        kept_rows = []
        removed_any = False
        for layout_row in layout_rows:
            card_id = _get_type2_chinese_print_sheet_row_card_id(layout_row)
            if card_id is not None and card_id in blocked_card_set:
                removed_any = True
                continue
            kept_rows.append(layout_row)

        if not removed_any:
            continue
        if len(kept_rows) == 0:
            conn.execute("DELETE FROM type2_chinese_print_sheets WHERE id = ?", [sheet_id])
            continue

        layout['rows'] = kept_rows
        conn.execute(
            "UPDATE type2_chinese_print_sheets SET layout_json = ? WHERE id = ?",
            [json.dumps(layout, ensure_ascii=False, separators=(',', ':')), sheet_id],
        )
