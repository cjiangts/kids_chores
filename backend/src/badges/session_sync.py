"""Write-path badge sync helpers for completed sessions."""

from src.badges.service import sync_kid_badges_awards
from src.db import kid_db, metadata
from src.db.shared_deck_db import get_shared_decks_connection


def sync_badges_after_session_complete(kid, *, raise_errors: bool = False):
    """Best-effort badge award sync after a session write commits."""
    try:
        family_id = str(kid.get('familyId') or '').strip()
        db_path = str(kid.get('dbFilePath') or '').strip()
        if not family_id or not db_path:
            return {'synced': False, 'reason': 'missing-kid-metadata'}

        tracking_started_at = metadata.get_family_badge_tracking_started_at(family_id)
        if not tracking_started_at:
            return {'synced': False, 'reason': 'tracking-not-started'}

        family_timezone = metadata.get_family_timezone(family_id)
        kid_conn = kid_db.get_kid_connection_by_path(db_path)
        shared_conn = get_shared_decks_connection()
        try:
            result = sync_kid_badges_awards(
                kid_conn,
                shared_conn,
                family_timezone=family_timezone,
                tracking_started_at=tracking_started_at,
            )
        finally:
            shared_conn.close()
            kid_conn.close()
        return {'synced': True, **result}
    except Exception as exc:
        if raise_errors:
            raise
        return {'synced': False, 'reason': str(exc)}

