"""Delete one session and recompute per-card EMA for affected cards.

A session delete is a rare parent-only operation (kids cannot wipe progress
mid-practice). Because correct_time_ema is an incremental EMA built up over
time, removing past attempts requires a full replay of the remaining
correct + positive-response-time attempts in chronological order.

Layout:
  1. Top-level delete entrypoint
  2. Per-card EMA recompute (replay of remaining session_results)
  3. On-disk audio file cleanup (type-III recordings)
"""
import os

from src.routes.kids_constants import PRACTICE_PRIORITY_CORRECT_TIME_EMA_ALPHA


# =====================================================================
# === 1. Top-level delete entrypoint
# =====================================================================

def delete_session_with_recompute(conn, session_id, *, kid_audio_dir=None):
    """Delete one session row + dependent rows; recompute EMA for affected cards.

    `kid_audio_dir` is the type-III recording directory for the kid. When the
    deleted session is a type-III session, audio files belonging to the
    removed result rows are unlinked from disk (best effort, after DB commit).

    Returns the number of removed session_results rows.
    """
    session_id_int = int(session_id)

    type_row = conn.execute(
        "SELECT type FROM sessions WHERE id = ?",
        [session_id_int],
    ).fetchone()
    if type_row is None:
        return 0

    card_rows = conn.execute(
        """
        SELECT DISTINCT card_id
        FROM session_results
        WHERE session_id = ? AND card_id IS NOT NULL
        """,
        [session_id_int],
    ).fetchall()
    affected_card_ids = [int(row[0]) for row in card_rows if row[0] is not None]

    audio_file_names = []
    if kid_audio_dir:
        audio_rows = conn.execute(
            """
            SELECT lra.file_name
            FROM lesson_reading_audio lra
            JOIN session_results sr ON sr.id = lra.result_id
            WHERE sr.session_id = ?
            """,
            [session_id_int],
        ).fetchall()
        for row in audio_rows:
            name = str(row[0] or '').strip()
            if name and name == os.path.basename(name):
                audio_file_names.append(name)

    result_id_rows = conn.execute(
        "SELECT id FROM session_results WHERE session_id = ?",
        [session_id_int],
    ).fetchall()
    removed_count = len(result_id_rows)

    conn.execute(
        """
        DELETE FROM type1_result_item
        WHERE result_id IN (
            SELECT id FROM session_results WHERE session_id = ?
        )
        """,
        [session_id_int],
    )
    conn.execute(
        """
        DELETE FROM type4_result_item
        WHERE result_id IN (
            SELECT id FROM session_results WHERE session_id = ?
        )
        """,
        [session_id_int],
    )
    conn.execute(
        """
        DELETE FROM lesson_reading_audio
        WHERE result_id IN (
            SELECT id FROM session_results WHERE session_id = ?
        )
        """,
        [session_id_int],
    )
    conn.execute(
        "DELETE FROM session_results WHERE session_id = ?",
        [session_id_int],
    )
    conn.execute(
        "DELETE FROM sessions WHERE id = ?",
        [session_id_int],
    )

    if affected_card_ids:
        _recompute_correct_time_ema_for_cards(conn, affected_card_ids)

    _delete_audio_files(kid_audio_dir, audio_file_names)
    return removed_count


# =====================================================================
# === 2. Per-card EMA recompute (replay remaining session_results)
# =====================================================================

def _recompute_correct_time_ema_for_cards(conn, card_ids):
    """Reset and replay correct_time_ema for one or more cards from remaining rows."""
    if not card_ids:
        return
    placeholders = ','.join(['?'] * len(card_ids))
    conn.execute(
        f"""
        UPDATE cards
        SET correct_time_ema = NULL,
            correct_time_ema_count = 0
        WHERE id IN ({placeholders})
        """,
        list(card_ids),
    )

    alpha = float(PRACTICE_PRIORITY_CORRECT_TIME_EMA_ALPHA)
    rows = conn.execute(
        f"""
        SELECT card_id, COALESCE(response_time_ms, 0) AS rt
        FROM session_results
        WHERE card_id IN ({placeholders})
          AND (correct = 1 OR correct <= -2)
          AND COALESCE(response_time_ms, 0) > 0
        ORDER BY COALESCE(timestamp, CURRENT_TIMESTAMP) ASC, id ASC
        """,
        list(card_ids),
    ).fetchall()

    ema_by_card = {}
    count_by_card = {}
    for row in rows:
        card_id = int(row[0])
        rt_ms = int(row[1] or 0)
        if rt_ms <= 0:
            continue
        prior = ema_by_card.get(card_id, 0.0)
        ema_by_card[card_id] = alpha * float(rt_ms) + (1.0 - alpha) * prior
        count_by_card[card_id] = count_by_card.get(card_id, 0) + 1

    for card_id in card_ids:
        ema_value = ema_by_card.get(card_id)
        count_value = count_by_card.get(card_id, 0)
        if ema_value is None or count_value <= 0:
            continue
        conn.execute(
            """
            UPDATE cards
            SET correct_time_ema = ?,
                correct_time_ema_count = ?
            WHERE id = ?
            """,
            [float(ema_value), int(count_value), int(card_id)],
        )


# =====================================================================
# === 3. On-disk audio file cleanup
# =====================================================================

def _delete_audio_files(audio_dir, file_names):
    """Best-effort unlink for type-III recording files (and any mp3 sibling)."""
    if not audio_dir or not file_names:
        return
    for name in file_names:
        primary_path = os.path.join(audio_dir, name)
        try:
            if os.path.exists(primary_path):
                os.remove(primary_path)
        except OSError:
            pass
        stem, _ext = os.path.splitext(name)
        if not stem:
            continue
        sibling = os.path.join(audio_dir, f'{stem}.mp3')
        if sibling == primary_path:
            continue
        try:
            if os.path.exists(sibling):
                os.remove(sibling)
        except OSError:
            pass
