"""One-time backfill for type-I IDK attempts that were silently dropped.

Earlier code dropped the "I don't know" tap from `type1_result_item` because
its `submittedAnswer` was empty. The session-level `session_results.correct`
still reflected the FIXED outcome, so the bug pattern is:

    session_results.correct <= -2  AND  len(type1_result_item.submitted_answers) == 1

That combination is only reachable via the dropped-IDK path (any other wrong
attempt carries a non-empty submitted_answer). The fix prepends ('', -9) to
restore the missing first attempt.

Idempotent: after running, matched rows have length 2 and stop matching.
Delete this file and its call site in `app.py` after one successful prod boot.

Logs go through `print(..., flush=True)` so they show up regardless of how the
Flask app logger is configured during startup (Flask does not attach the
default handler until `app.run()`/WSGI takes over, so `app.logger.info` calls
inside `create_app()` would be silently dropped).
"""
import os
from pathlib import Path

from src.db import kid_db


_LOG_PREFIX = '[type1-idk-backfill]'


def _is_werkzeug_reloader_parent():
    """Werkzeug's auto-reloader runs create_app() in both watcher and child.

    The child sets WERKZEUG_RUN_MAIN=true. Skipping the parent avoids running
    the migration (and printing its log line) twice per `start-local.sh` boot.
    Production (gunicorn/uwsgi) doesn't set either var, so we don't skip there.
    """
    return os.environ.get('FLASK_ENV') == 'development' and os.environ.get('WERKZEUG_RUN_MAIN') != 'true'


def _iter_kid_db_paths():
    families_root = Path(kid_db.DATA_DIR) / 'families'
    if not families_root.exists():
        return
    yield from sorted(families_root.glob('family_*/kid_*.db'))


def backfill_dropped_type1_idk_first_attempts():
    if _is_werkzeug_reloader_parent():
        return
    total_updated = 0
    per_db_counts = []
    errors = []

    for db_path in _iter_kid_db_paths() or []:
        try:
            conn = kid_db.get_kid_connection_by_path(str(db_path), read_only=False)
            try:
                victim_ids = [
                    int(row[0]) for row in conn.execute(
                        """
                        SELECT tri.result_id
                        FROM type1_result_item tri
                        JOIN session_results sr ON sr.id = tri.result_id
                        WHERE sr.correct <= -2
                          AND len(tri.submitted_answers) = 1
                        """
                    ).fetchall()
                ]
                if not victim_ids:
                    continue
                for result_id in victim_ids:
                    row = conn.execute(
                        """
                        SELECT submitted_answers, submitted_grades
                        FROM type1_result_item WHERE result_id = ?
                        """,
                        [result_id],
                    ).fetchone()
                    answers = [str(a or '') for a in list(row[0] or [])]
                    grades = [int(g) for g in list(row[1] or [])]
                    if len(answers) != 1 or len(grades) != 1:
                        continue
                    conn.execute(
                        """
                        UPDATE type1_result_item
                        SET submitted_answers = ?, submitted_grades = ?
                        WHERE result_id = ?
                        """,
                        [[''] + answers, [-9] + grades, result_id],
                    )
                conn.commit()
                per_db_counts.append((str(db_path), len(victim_ids)))
                total_updated += len(victim_ids)
            finally:
                conn.close()
        except Exception as exc:
            errors.append(f'{db_path}: {exc}')

    if total_updated:
        details = ', '.join(f'{path} ({n})' for path, n in per_db_counts)
        print(f'{_LOG_PREFIX} prepended dropped first attempt on {total_updated} row(s): {details}', flush=True)
    else:
        print(f'{_LOG_PREFIX} no rows matched the bug pattern.', flush=True)

    if errors:
        print(f'{_LOG_PREFIX} ERRORS: {"; ".join(errors)}', flush=True)
