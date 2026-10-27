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

The single SQL statement is one 8-stage CTE — read top-to-bottom:

  1. subject_cards   — non-skipped cards in the selected decks
  2. card_records    — session_results joined for `session_type`
  3. recent_correct  — most recent 10 timed fully-correct attempts per card
  4. queue_speed     — queue-only response time; once there are at least 5
                       recent correct attempts, discard the slowest 20% before
                       averaging so an isolated distraction does not linger.
  5. per_card        — aggregate attempt/correct/wrong/last per card
  6. speed_baseline  — subject-wide p50/p95 of per-card queue response time.
  7. score_terms     — derive missed/slow/learning/due priority values.
                       slow_need = clamp((queue time − p50) / (p95 − p50), 0, 1)
                       compares the card's queue response time against the subject's
                       per-card queue-time p50/p95 band.
  8. scored          — combine NEEDs × weights into priority_score
  Final SELECT       — emit ordered rows + primary_reason label

The weights live in `kids_constants`:
  - PRACTICE_PRIORITY_MISSED_WEIGHT / SLOW_WEIGHT / LEARNING_WEIGHT / DUE_WEIGHT
  - PRACTICE_PRIORITY_LAST_FAILED_BOOST — pumps "missed" if last attempt failed
  - PRACTICE_PRIORITY_LEARNING_TARGET_ATTEMPTS — learning need = 1 - attempts/target
  - PRACTICE_PRIORITY_DUE_RAMP_DAYS — normal due score reaches its ceiling
  - PRACTICE_PRIORITY_DUE_GRACE_DAYS — age after which anti-starvation starts
  - PRACTICE_PRIORITY_DUE_ACCELERATION_DENOMINATOR — controls the late-age curve
  - PRACTICE_PRIORITY_MIN_CORRECT_RECORDS_FOR_SPEED_BASELINE — min number
    of cards with a non-null queue response time required before the
    per-card p50/p95 band is considered trustworthy; below that
    slow_need collapses to 0 for every card.

The Python loop after the query just packs rows into two dicts (preview
order by card_id + per-card detail dict) plus the subject baseline.
"""

from src.routes.kids_constants import (
    DECK_CATEGORY_BEHAVIOR_TYPE_II,
    DECK_CATEGORY_BEHAVIOR_TYPE_III,
    PRACTICE_PRIORITY_DUE_WEIGHT,
    PRACTICE_PRIORITY_DUE_ACCELERATION_DENOMINATOR,
    PRACTICE_PRIORITY_DUE_GRACE_DAYS,
    PRACTICE_PRIORITY_DUE_RAMP_DAYS,
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
)
from src.services.normalize_inputs import normalize_positive_int_list

PRACTICE_PRIORITY_QUEUE_RECENT_CORRECT_LIMIT = 10
PRACTICE_PRIORITY_QUEUE_SLOW_TRIM_FRACTION = 0.20


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
                sr.id AS result_id,
                sr.card_id,
                sr.timestamp AS practiced_at,
                COALESCE(sr.response_time_ms, 0) AS response_time_ms,
                sr.correct
            FROM session_results sr
            JOIN sessions s ON s.id = sr.session_id
            JOIN subject_cards c ON c.card_id = sr.card_id
            WHERE s.type = ?
        ),
        recent_correct_ranked AS (
            SELECT
                card_id,
                response_time_ms,
                practiced_at,
                result_id,
                ROW_NUMBER() OVER (
                    PARTITION BY card_id
                    ORDER BY practiced_at DESC, result_id DESC
                ) AS recent_rank
            FROM card_records
            WHERE correct = 1
              AND response_time_ms > 0
        ),
        recent_correct AS (
            SELECT
                card_id,
                result_id,
                response_time_ms,
                ROW_NUMBER() OVER (
                    PARTITION BY card_id
                    ORDER BY response_time_ms DESC, practiced_at DESC, result_id DESC
                ) AS slow_rank,
                COUNT(*) OVER (PARTITION BY card_id) AS recent_correct_count
            FROM recent_correct_ranked
            WHERE recent_rank <= {PRACTICE_PRIORITY_QUEUE_RECENT_CORRECT_LIMIT}
        ),
        queue_speed AS (
            SELECT
                card_id,
                AVG(response_time_ms) FILTER (
                    WHERE recent_correct_count < 5
                       OR slow_rank > FLOOR(recent_correct_count * {PRACTICE_PRIORITY_QUEUE_SLOW_TRIM_FRACTION:.2f})
                ) AS queue_correct_response_time,
                LIST(result_id) FILTER (
                    WHERE recent_correct_count < 5
                       OR slow_rank > FLOOR(recent_correct_count * {PRACTICE_PRIORITY_QUEUE_SLOW_TRIM_FRACTION:.2f})
                ) AS queue_included_result_ids,
                LIST(result_id) FILTER (
                    WHERE recent_correct_count >= 5
                      AND slow_rank <= FLOOR(recent_correct_count * {PRACTICE_PRIORITY_QUEUE_SLOW_TRIM_FRACTION:.2f})
                ) AS queue_excluded_result_ids
            FROM recent_correct
            GROUP BY card_id
        ),
        per_card AS (
            SELECT
                card_id,
                COUNT(card_id) AS attempt_count,
                COUNT(*) FILTER (WHERE correct > 0) AS correct_count,
                COUNT(*) FILTER (WHERE correct < 0) AS wrong_count,
                MIN(CASE
                    WHEN correct > 0 AND response_time_ms > 0
                    THEN response_time_ms
                END) AS fastest_correct_response_time,
                MAX(practiced_at) AS last_practiced_at,
                arg_max(correct, practiced_at) AS last_result_correct
            FROM card_records
            GROUP BY card_id
        ),
        card_speed AS (
            SELECT
                p.*,
                q.queue_correct_response_time,
                q.queue_included_result_ids,
                q.queue_excluded_result_ids
            FROM per_card p
            LEFT JOIN queue_speed q ON q.card_id = p.card_id
        ),
        speed_baseline AS (
            SELECT
                quantile_cont(queue_correct_response_time, 0.50) AS p50_correct_time,
                quantile_cont(queue_correct_response_time, 0.95) AS p95_correct_time,
                COUNT(*)
                    FILTER (WHERE queue_correct_response_time IS NOT NULL) AS correct_sample_count
            FROM card_speed
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
                      OR p.queue_correct_response_time IS NULL
                      OR b.p50_correct_time IS NULL
                      OR b.p95_correct_time IS NULL
                      OR b.p95_correct_time <= b.p50_correct_time
                    THEN 0.0
                    ELSE LEAST(
                        GREATEST(
                            (p.queue_correct_response_time - b.p50_correct_time)
                            / (b.p95_correct_time - b.p50_correct_time),
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
                    THEN {PRACTICE_PRIORITY_DUE_WEIGHT:.6f}
                    WHEN date_diff('day', p.last_practiced_at, current_date)
                         <= {PRACTICE_PRIORITY_DUE_RAMP_DAYS:.6f}
                    THEN {PRACTICE_PRIORITY_DUE_WEIGHT:.6f} * GREATEST(
                        date_diff('day', p.last_practiced_at, current_date)::DOUBLE
                        / {PRACTICE_PRIORITY_DUE_RAMP_DAYS:.6f},
                        0.0
                    )
                    WHEN date_diff('day', p.last_practiced_at, current_date)
                         <= {PRACTICE_PRIORITY_DUE_GRACE_DAYS:.6f}
                    THEN {PRACTICE_PRIORITY_DUE_WEIGHT:.6f}
                    ELSE {PRACTICE_PRIORITY_DUE_WEIGHT:.6f}
                        + POWER(
                            date_diff('day', p.last_practiced_at, current_date)::DOUBLE
                            - {PRACTICE_PRIORITY_DUE_GRACE_DAYS:.6f},
                            2
                        ) / {PRACTICE_PRIORITY_DUE_ACCELERATION_DENOMINATOR:.6f}
                END AS due_points,
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
                p.queue_correct_response_time,
                p.fastest_correct_response_time,
                b.p50_correct_time,
                b.p95_correct_time,
                COALESCE(b.correct_sample_count, 0) AS correct_sample_count,
                CASE
                    WHEN p.last_practiced_at IS NULL THEN NULL
                    ELSE GREATEST(date_diff('day', p.last_practiced_at, current_date), 0)
                END AS days_since_last_seen,
                p.last_practiced_at
                , p.queue_included_result_ids
                , p.queue_excluded_result_ids
            FROM subject_cards c
            LEFT JOIN card_speed p ON p.card_id = c.card_id
            CROSS JOIN speed_baseline b
        ),
        scored AS (
            SELECT
                card_id,
                {missed_weight:.6f}
                    * GREATEST(wrong_rate, {PRACTICE_PRIORITY_LAST_FAILED_BOOST:.6f} * last_wrong) AS missed_points,
                {slow_weight:.6f} * slow_need AS slow_points,
                {PRACTICE_PRIORITY_LEARNING_WEIGHT:.6f} * learning_need AS learning_points,
                COALESCE(due_points, 0.0) AS due_points,
                ({missed_weight:.6f}
                    * GREATEST(wrong_rate, {PRACTICE_PRIORITY_LAST_FAILED_BOOST:.6f} * last_wrong))
                + ({slow_weight:.6f} * slow_need)
                + ({PRACTICE_PRIORITY_LEARNING_WEIGHT:.6f} * learning_need)
                + COALESCE(due_points, 0.0) AS priority_score,
                correct_rate,
                correct_count,
                wrong_count,
                attempt_count,
                queue_correct_response_time,
                fastest_correct_response_time,
                p50_correct_time,
                p95_correct_time,
                correct_sample_count,
                days_since_last_seen,
                last_practiced_at
                , queue_included_result_ids
                , queue_excluded_result_ids
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
            queue_correct_response_time,
            p50_correct_time,
            p95_correct_time,
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
            END AS primary_reason,
            fastest_correct_response_time,
            queue_included_result_ids,
            queue_excluded_result_ids
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
        'p95_correct_time': None,
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
            'queue_correct_response_time': float(row[10]) if row[10] is not None else None,
            'days_since_last_seen': int(row[14]) if row[14] is not None else None,
            'last_practiced_at': row[15].isoformat() if row[15] else None,
            'primary_reason': str(row[16] or PRACTICE_PRIORITY_REASON_LEARNING),
            'fastest_correct_response_time': float(row[17]) if row[17] is not None else None,
            'queue_included_result_ids': [int(result_id) for result_id in (row[18] or [])],
            'queue_excluded_result_ids': [int(result_id) for result_id in (row[19] or [])],
        }
        if index == 1:
            subject_baseline = {
                'p50_correct_time': float(row[11]) if row[11] is not None else None,
                'p95_correct_time': float(row[12]) if row[12] is not None else None,
                'correct_sample_count': int(row[13] or 0),
            }

    return {
        'order_by_card_id': order_by_card_id,
        'details_by_card_id': details_by_card_id,
        'subject_baseline': subject_baseline,
    }
