"""Chore-level entry checks, shared by preparation and activation."""
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from src.db import metadata
from src.db.shared_deck_db import get_shared_decks_connection
from src.services.kid_daily_progress import get_kid_opted_in_deck_category_keys, get_kid_today_session_status_by_deck_category
from src.services.pending_sessions import _PENDING_SESSIONS, _PENDING_SESSIONS_LOCK, _cleanup_expired_pending_sessions
from src.services.shared_deck_category import get_shared_deck_category_meta_by_key
from src.services.points import list_pending_off_app_chores


def inspect(conn, kid):
    tz = metadata.get_family_timezone(kid['familyId'])
    day_start = datetime.now(timezone.utc).astimezone(ZoneInfo(tz)).replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)
    start_utc = day_start.astimezone(timezone.utc).replace(tzinfo=None)
    end_utc = day_end.astimezone(timezone.utc).replace(tzinfo=None)
    meta = get_shared_deck_category_meta_by_key()
    keys = get_kid_opted_in_deck_category_keys(kid, conn=conn, category_meta_by_key=meta)
    statuses = get_kid_today_session_status_by_deck_category(kid, keys, conn=conn, category_meta_by_key=meta)
    blockers = []
    for key, state in statuses.items():
        if state.get('pendingReview') or state.get('status') == 'in_progress':
            blockers.append({'categoryKey': key, 'name': (meta.get(key) or {}).get('display_name') or key,
                             'reason': 'Waiting for parent review' if state.get('pendingReview') else 'Practice or corrections are unfinished'})
    # Only today's sessions participate in the handoff; historical reviews stay online.
    pending = conn.execute('''SELECT DISTINCT s.type FROM sessions s JOIN session_results r ON r.session_id=s.id
        WHERE r.correct=0 AND s.delivery_mode='online' AND (s.practice_mode='parent_review' OR s.type IN (
            SELECT category_key FROM deck_category_opt_in))
        AND ((s.started_at >= ? AND s.started_at < ?) OR (s.completed_at >= ? AND s.completed_at < ?))''',
        [start_utc, end_utc, start_utc, end_utc]).fetchall()
    for (key,) in pending:
        if key in keys and not any(b['categoryKey'] == key for b in blockers):
            blockers.append({'categoryKey': key, 'name': (meta.get(key) or {}).get('display_name') or key, 'reason': 'Unreviewed results remain'})
    shared = get_shared_decks_connection(read_only=True)
    try:
        offapp_pending = list_pending_off_app_chores(conn, shared, kid['familyId'])
    finally:
        shared.close()
    for chore in offapp_pending:
        submitted_at = datetime.fromisoformat(chore['submittedAt'].replace('Z', '+00:00'))
        if not day_start <= submitted_at < day_end:
            continue
        name = (chore.get('rule') or {}).get('name') or f"Off-app chore #{chore['ruleId']}"
        blockers.append({'categoryKey': '', 'ruleId': chore['ruleId'], 'name': name,
                         'reason': 'Waiting for parent review'})
    with _PENDING_SESSIONS_LOCK:
        _cleanup_expired_pending_sessions()
        for session in _PENDING_SESSIONS.values():
            if (str(session.get('kid_id')) == str(kid['id'])
                    and day_start.timestamp() <= float(session.get('created_at_ts', 0)) < day_end.timestamp()):
                key = session.get('session_type')
                if not any(b['categoryKey'] == key for b in blockers):
                    blockers.append({'categoryKey': key, 'name': (meta.get(key) or {}).get('display_name') or key, 'reason': 'An online practice session is still open'})
    today = day_start.date().isoformat()
    return {'date': today, 'timezone': tz, 'statuses': statuses, 'keys': keys, 'blockers': blockers}


class HandoffBlocked(ValueError):
    def __init__(self, blockers):
        self.blockers = blockers
        super().__init__('Finish or close these chores first')


def require_ready(report):
    if report['blockers']:
        raise HandoffBlocked(report['blockers'])
