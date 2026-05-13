"""Practice-priority preview computation for one category's active cards.

`build_practice_priority_preview_for_decks` returns a per-card ordering used
by the card-manage page to show "what would practice pick next" — pure
preview, no DB mutations.

Inputs:
  - `conn` (kid DB)
  - `deck_ids` — caller-resolved practice source decks for the category
  - `session_type` — practiced under this session type (e.g. 'type_i')
  - `session_behavior_type` — DECK_CATEGORY_BEHAVIOR_TYPE_I/II/III/IV;
    decides which weights are zeroed (type-II/III drop SLOW; type-III drops
    MISSED).
  - `excluded_card_ids` — cards to omit (e.g. already-queued today)

The single SQL statement is one 9-stage CTE — read top-to-bottom:

  1. subject_cards            — non-skipped cards in the selected decks
  2. card_records             — session_results joined for `session_type`
  3. speed_baseline           — subject-wide p50/p90 of correct response_time_ms
  4. record_features          — per-record slow_value 0..1 from baseline
  5. record_features_with_exposure — add correct_response_time_ms column
  6. per_card                 — aggregate attempt/correct/wrong/last per card
  7. score_terms              — derive missed/slow/learning/due NEED values
  8. scored                   — combine NEEDs × weights into priority_score
  9. Final SELECT             — emit ordered rows + primary_reason label

The weights live in `kids_constants`:
  - PRACTICE_PRIORITY_MISSED_WEIGHT / SLOW_WEIGHT / LEARNING_WEIGHT / DUE_WEIGHT
  - PRACTICE_PRIORITY_LAST_FAILED_BOOST — pumps "missed" if last attempt failed
  - PRACTICE_PRIORITY_LEARNING_TARGET_ATTEMPTS — learning need = 1 - attempts/target
  - PRACTICE_PRIORITY_VERY_DUE_DAYS — due_need saturates at this many days
  - PRACTICE_PRIORITY_MIN_CORRECT_RECORDS_FOR_SPEED_BASELINE — gate before
    `slow_value` is non-zero; below threshold the baseline is unreliable so
    slow contribution collapses to 0.

The Python loop after the query just packs rows into two dicts (preview
order by card_id + per-card detail dict) plus the subject baseline.
"""

from src.routes.kids_constants import (
    DECK_CATEGORY_BEHAVIOR_TYPE_II,
    DECK_CATEGORY_BEHAVIOR_TYPE_III,
    PRACTICE_PRIORITY_DUE_WEIGHT,
    PRACTICE_PRIORITY_LAST_FAILED_BOOST,
    PRACTICE_PRIORITY_LEARNING_TARGET_ATTEMPTS,
    PRACTICE_PRIORITY_LEARNING_WEIGHT,
    PRACTICE_PRIORITY_MIN_CORRECT_RECORDS_FOR_SPEED_BASELINE,
    PRACTICE_PRIORITY_MISSED_WEIGHT,
    PRACTICE_PRIORITY_REASON_DUE,
    PRACTICE_PRIORITY_REASON_LEARNING,
    PRACTICE_PRIORITY_REASON_MISSED,
    PRACTICE_PRIORITY_REASON_SLOW,
    PRACTICE_PRIORITY_SLOW_WEIGHT,
    PRACTICE_PRIORITY_VERY_DUE_DAYS,
)
from src.services.normalize_inputs import normalize_positive_int_list


def build_practice_priority_preview_for_decks(
    conn,
    deck_ids,
    session_type,
    session_behavior_type,
    *,
    excluded_card_ids=None,
):
    """Compute preview-only priority ranking data for one category's active cards."""
    normalized_deck_ids = normalize_positive_int_list(deck_ids)
    if not normalized_deck_ids:
        return {
            'order_by_card_id': {},
            'details_by_card_id': {},
        }

    excluded_ids = normalize_positive_int_list(excluded_card_ids)

    deck_placeholders = ','.join(['?'] * len(normalized_deck_ids))
    exclude_clause = ''
    params = [*normalized_deck_ids]
    if excluded_ids:
        excluded_placeholders = ','.join(['?'] * len(excluded_ids))
        exclude_clause = f" AND c.id NOT IN ({excluded_placeholders})"
        params.extend(excluded_ids)
    params.append(session_type)

    slow_weight = (
        0.0
        if session_behavior_type in (
            DECK_CATEGORY_BEHAVIOR_TYPE_II,
            DECK_CATEGORY_BEHAVIOR_TYPE_III,
        )
        else PRACTICE_PRIORITY_SLOW_WEIGHT
    )
    missed_weight = (
        0.0
        if session_behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_III
        else PRACTICE_PRIORITY_MISSED_WEIGHT
    )

    rows = conn.execute(
        f"""
        WITH subject_cards AS (
            SELECT
                c.id AS card_id
            FROM cards c
            WHERE c.deck_id IN ({deck_placeholders})
              AND COALESCE(c.skip_practice, FALSE) = FALSE
              {exclude_clause}
        ),
        card_records AS (
            SELECT
                sr.card_id,
                sr.timestamp AS practiced_at,
                COALESCE(sr.response_time_ms, 0) AS response_time_ms,
                sr.correct
            FROM session_results sr
            JOIN sessions s ON s.id = sr.session_id
            JOIN subject_cards c ON c.card_id = sr.card_id
            WHERE s.type = ?
        ),
        speed_baseline AS (
            SELECT
                quantile_cont(response_time_ms, 0.50)
                    FILTER (WHERE correct > 0 AND response_time_ms > 0) AS p50_correct_time,
                quantile_cont(response_time_ms, 0.90)
                    FILTER (WHERE correct > 0 AND response_time_ms > 0) AS p90_correct_time,
                COUNT(*)
                    FILTER (WHERE correct > 0 AND response_time_ms > 0) AS correct_sample_count
            FROM card_records
        ),
        record_features AS (
            SELECT
                r.card_id,
                r.practiced_at,
                r.response_time_ms,
                r.correct,
                b.correct_sample_count,
                CASE
                    WHEN r.correct < 0 THEN 1.0
                    WHEN b.correct_sample_count < {PRACTICE_PRIORITY_MIN_CORRECT_RECORDS_FOR_SPEED_BASELINE}
                      OR b.p50_correct_time IS NULL
                      OR b.p90_correct_time IS NULL
                      OR b.p90_correct_time <= b.p50_correct_time
                      OR r.response_time_ms <= 0
                    THEN 0.0
                    ELSE LEAST(
                        GREATEST(
                            (r.response_time_ms - b.p50_correct_time)
                            / (b.p90_correct_time - b.p50_correct_time),
                            0.0
                        ),
                        1.0
                    )
                END AS slow_value
            FROM card_records r
            CROSS JOIN speed_baseline b
        ),
        record_features_with_exposure AS (
            SELECT
                *,
                CASE
                    WHEN correct > 0 AND response_time_ms > 0 THEN response_time_ms
                    ELSE NULL
                END AS correct_response_time_ms
            FROM record_features
        ),
        per_card AS (
            SELECT
                card_id,
                COUNT(card_id) AS attempt_count,
                COUNT(*) FILTER (WHERE correct > 0) AS correct_count,
                COUNT(*) FILTER (WHERE correct < 0) AS wrong_count,
                AVG(correct_response_time_ms) AS avg_correct_response_time,
                MAX(practiced_at) AS last_practiced_at,
                arg_max(correct, practiced_at) AS last_result_correct
            FROM record_features_with_exposure
            GROUP BY card_id
        ),
        score_terms AS (
            SELECT
                c.card_id,
                CASE
                    WHEN COALESCE(p.attempt_count, 0) <= 0 THEN 0.0
                    ELSE 1.0 - (
                        COALESCE(p.correct_count, 0)::DOUBLE
                        / NULLIF(COALESCE(p.attempt_count, 0), 0)::DOUBLE
                    )
                END AS wrong_rate,
                CASE
                    WHEN COALESCE(p.last_result_correct, 0) < 0 THEN 1.0
                    ELSE 0.0
                END AS last_wrong,
                CASE
                    WHEN b.correct_sample_count < {PRACTICE_PRIORITY_MIN_CORRECT_RECORDS_FOR_SPEED_BASELINE}
                      OR p.avg_correct_response_time IS NULL
                      OR b.p50_correct_time IS NULL
                      OR b.p90_correct_time IS NULL
                      OR b.p90_correct_time <= b.p50_correct_time
                    THEN 0.0
                    ELSE LEAST(
                        GREATEST(
                            (p.avg_correct_response_time - b.p50_correct_time)
                            / (b.p90_correct_time - b.p50_correct_time),
                            0.0
                        ),
                        1.0
                    )
                END AS slow_need,
                GREATEST(
                    0.0,
                    1.0 - (
                        COALESCE(p.attempt_count, 0)::DOUBLE
                        / {PRACTICE_PRIORITY_LEARNING_TARGET_ATTEMPTS:.6f}
                    )
                ) AS learning_need,
                CASE
                    WHEN COALESCE(p.attempt_count, 0) <= 0
                    THEN 1.0
                    ELSE LEAST(
                        GREATEST(
                            date_diff('day', p.last_practiced_at, current_date)::DOUBLE
                            / {PRACTICE_PRIORITY_VERY_DUE_DAYS:.6f},
                            0.0
                        ),
                        1.0
                    )
                END AS due_need,
                CASE
                    WHEN COALESCE(p.attempt_count, 0) <= 0 THEN NULL
                    ELSE 100.0 * (
                        COALESCE(p.correct_count, 0)::DOUBLE
                        / NULLIF(COALESCE(p.attempt_count, 0), 0)::DOUBLE
                    )
                END AS correct_rate,
                COALESCE(p.correct_count, 0) AS correct_count,
                COALESCE(p.wrong_count, 0) AS wrong_count,
                COALESCE(p.attempt_count, 0) AS attempt_count,
                p.avg_correct_response_time,
                b.p50_correct_time,
                b.p90_correct_time,
                COALESCE(b.correct_sample_count, 0) AS correct_sample_count,
                CASE
                    WHEN p.last_practiced_at IS NULL THEN NULL
                    ELSE GREATEST(date_diff('day', p.last_practiced_at, current_date), 0)
                END AS days_since_last_seen,
                p.last_practiced_at
            FROM subject_cards c
            LEFT JOIN per_card p ON p.card_id = c.card_id
            CROSS JOIN speed_baseline b
        ),
        scored AS (
            SELECT
                card_id,
                {missed_weight:.6f}
                    * GREATEST(wrong_rate, {PRACTICE_PRIORITY_LAST_FAILED_BOOST:.6f} * last_wrong) AS missed_points,
                {slow_weight:.6f} * slow_need AS slow_points,
                {PRACTICE_PRIORITY_LEARNING_WEIGHT:.6f} * learning_need AS learning_points,
                {PRACTICE_PRIORITY_DUE_WEIGHT:.6f} * COALESCE(due_need, 0.0) AS due_points,
                ({missed_weight:.6f}
                    * GREATEST(wrong_rate, {PRACTICE_PRIORITY_LAST_FAILED_BOOST:.6f} * last_wrong))
                + ({slow_weight:.6f} * slow_need)
                + ({PRACTICE_PRIORITY_LEARNING_WEIGHT:.6f} * learning_need)
                + ({PRACTICE_PRIORITY_DUE_WEIGHT:.6f} * COALESCE(due_need, 0.0)) AS priority_score,
                correct_rate,
                correct_count,
                wrong_count,
                attempt_count,
                avg_correct_response_time,
                p50_correct_time,
                p90_correct_time,
                correct_sample_count,
                days_since_last_seen,
                last_practiced_at
            FROM score_terms
        )
        SELECT
            card_id,
            priority_score,
            missed_points,
            slow_points,
            learning_points,
            due_points,
            correct_rate,
            correct_count,
            wrong_count,
            attempt_count,
            avg_correct_response_time,
            p50_correct_time,
            p90_correct_time,
            correct_sample_count,
            days_since_last_seen,
            last_practiced_at,
            CASE
                WHEN missed_points >= slow_points
                  AND missed_points >= learning_points
                  AND missed_points >= due_points
                THEN '{PRACTICE_PRIORITY_REASON_MISSED}'
                WHEN slow_points >= learning_points
                  AND slow_points >= due_points
                THEN '{PRACTICE_PRIORITY_REASON_SLOW}'
                WHEN learning_points >= due_points
                THEN '{PRACTICE_PRIORITY_REASON_LEARNING}'
                ELSE '{PRACTICE_PRIORITY_REASON_DUE}'
            END AS primary_reason
        FROM scored
        ORDER BY
            priority_score DESC,
            missed_points DESC,
            slow_points DESC,
            learning_points DESC,
            due_points DESC,
            CASE WHEN last_practiced_at IS NULL THEN 0 ELSE 1 END ASC,
            last_practiced_at ASC,
            attempt_count ASC,
            card_id ASC
        """,
        params,
    ).fetchall()

    order_by_card_id = {}
    details_by_card_id = {}
    subject_baseline = {
        'p50_correct_time': None,
        'p90_correct_time': None,
        'correct_sample_count': 0,
    }
    for index, row in enumerate(rows, start=1):
        card_id = int(row[0] or 0)
        if card_id <= 0:
            continue
        order_by_card_id[card_id] = index
        details_by_card_id[card_id] = {
            'order': index,
            'priority_score': float(row[1] or 0.0),
            'missed_points': float(row[2] or 0.0),
            'slow_points': float(row[3] or 0.0),
            'learning_points': float(row[4] or 0.0),
            'due_points': float(row[5] or 0.0),
            'correct_rate': float(row[6]) if row[6] is not None else None,
            'correct_count': int(row[7] or 0),
            'wrong_count': int(row[8] or 0),
            'attempt_count': int(row[9] or 0),
            'avg_correct_response_time': float(row[10]) if row[10] is not None else None,
            'days_since_last_seen': int(row[14]) if row[14] is not None else None,
            'last_practiced_at': row[15].isoformat() if row[15] else None,
            'primary_reason': str(row[16] or PRACTICE_PRIORITY_REASON_LEARNING),
        }
        if index == 1:
            subject_baseline = {
                'p50_correct_time': float(row[11]) if row[11] is not None else None,
                'p90_correct_time': float(row[12]) if row[12] is not None else None,
                'correct_sample_count': int(row[13] or 0),
            }

    return {
        'order_by_card_id': order_by_card_id,
        'details_by_card_id': details_by_card_id,
        'subject_baseline': subject_baseline,
    }
