"""Type-II online review. Zero grades remain pending until an atomic submission."""
from threading import RLock

from src.routes.kids_constants import SESSION_RESULT_RETRY_FIXED_FIRST
from src.services.shared_deck_category import get_session_behavior_type

PARENT_REVIEW_LOCK = RLock()


def review_required(conn, category_key):
    row = conn.execute('SELECT parent_review_required FROM deck_category_opt_in WHERE category_key = ?', [category_key]).fetchone()
    return bool(row and row[0])


def get_review_setting(conn, category_key):
    return {'supported': get_session_behavior_type(category_key) == 'type_ii',
            'parent_review_required': review_required(conn, category_key)}


def save_review_setting(conn, category_key, enabled):
    if get_session_behavior_type(category_key) != 'type_ii':
        raise ValueError('Parent review is only supported for Type-II subjects')
    if not isinstance(enabled, bool):
        raise ValueError('parent_review_required must be a boolean')
    row = conn.execute('SELECT category_key FROM deck_category_opt_in WHERE category_key = ?', [category_key]).fetchone()
    if not row:
        raise ValueError('Subject settings not found')
    conn.execute('UPDATE deck_category_opt_in SET parent_review_required = ? WHERE category_key = ?', [enabled, category_key])
    return get_review_setting(conn, category_key)


def save_session_review(conn, session_id, grades):
    session = conn.execute('SELECT type, practice_mode, delivery_mode, completed_at FROM sessions WHERE id = ?', [session_id]).fetchone()
    if not session:
        raise LookupError('Session not found')
    if session[1] != 'parent_review' or session[2] != 'online' or get_session_behavior_type(session[0]) != 'type_ii':
        raise ValueError('This session does not support parent review')
    if not session[3]:
        raise ValueError('The child has not submitted this session')
    rows = conn.execute('SELECT id, correct FROM session_results WHERE session_id = ? ORDER BY id', [session_id]).fetchall()
    if not rows or not any(row[1] == 0 for row in rows):
        raise ValueError('This session has already been reviewed')
    if not isinstance(grades, list):
        raise ValueError('grades must be a list')
    mapped = {}
    for grade in grades:
        if not isinstance(grade, dict) or type(grade.get('correct')) is not int or grade['correct'] not in (-1, 1):
            raise ValueError('Mark every question correct or wrong before saving')
        result_id = int(grade.get('result_id') or 0)
        if result_id in mapped:
            raise ValueError('Duplicate question grade')
        mapped[result_id] = SESSION_RESULT_RETRY_FIXED_FIRST if grade['correct'] == -1 else 1
    if set(mapped) != {row[0] for row in rows}:
        raise ValueError('Grades must match exactly the submitted questions')
    conn.execute('BEGIN TRANSACTION')
    try:
        for result_id, correct in mapped.items():
            conn.execute('UPDATE session_results SET correct = ? WHERE id = ? AND session_id = ?', [correct, result_id, session_id])
        conn.execute('COMMIT')
    except Exception:
        conn.execute('ROLLBACK')
        raise
    return {'session_id': session_id, 'category_key': session[0], 'completed_at': session[3]}


def apply_parent_review_statuses(conn, statuses):
    rows = conn.execute("""
        SELECT s.id, s.type, COUNT(r.id) FROM sessions s
        JOIN session_results r ON r.session_id = s.id
        WHERE s.practice_mode = 'parent_review' AND s.delivery_mode = 'online'
          AND s.completed_at IS NOT NULL
        GROUP BY s.id, s.type
        HAVING COUNT(*) FILTER (WHERE r.correct = 0) > 0
        ORDER BY s.id ASC
    """).fetchall()
    seen = set()
    for session_id, key, count in rows:
        if key not in statuses or key in seen or statuses[key].get('pendingReview'):
            continue
        seen.add(key)
        statuses[key].update({'status': 'done', 'sessionId': session_id, 'pendingReview': True,
                              'deliveryMode': 'online', 'ungradedCount': count})
    return statuses
