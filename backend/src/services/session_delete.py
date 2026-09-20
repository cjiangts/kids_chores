"""Delete one session and its dependent records, including type-III audio."""
import os


# =====================================================================
# === 1. Top-level delete entrypoint
# =====================================================================

def delete_session_with_recompute(conn, session_id, *, kid_audio_dir=None):
    """Delete one session row + dependent rows.

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

    _delete_audio_files(kid_audio_dir, audio_file_names)
    return removed_count
# =====================================================================
# === 2. On-disk audio file cleanup
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
