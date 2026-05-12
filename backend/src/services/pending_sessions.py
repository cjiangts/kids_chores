"""In-memory pending-session state for active practice runs.

Practice sessions are held in a process-local dict keyed by an opaque token
between the `practice/start` and `practice/complete` requests. Entries expire
after `PENDING_SESSION_TTL_SECONDS`; type-III payloads also own scratch audio
files that must be cleaned up when their token is dropped.
"""
import re
import threading
import time
import uuid
from datetime import datetime, timezone

from src.routes.kids_constants import PENDING_SESSION_TTL_SECONDS
from src.services.shared_deck_category import is_type_iii_session_type
from src.services.writing_audio import cleanup_type3_pending_audio_files_by_payload

_PENDING_SESSIONS = {}
_PENDING_SESSIONS_LOCK = threading.Lock()


def _cleanup_expired_pending_sessions():
    now = time.time()
    expired_keys = [
        key for key, payload in _PENDING_SESSIONS.items()
        if now - float(payload.get('created_at_ts', 0)) > PENDING_SESSION_TTL_SECONDS
    ]
    for key in expired_keys:
        payload = _PENDING_SESSIONS.pop(key, None)
        if not payload:
            continue
        if not is_type_iii_session_type(payload.get('session_type')):
            continue
        cleanup_type3_pending_audio_files_by_payload(payload)


def create_pending_session(kid_id, session_type, payload):
    """Store one in-memory pending session and return its token."""
    token = uuid.uuid4().hex
    record = {
        **(payload or {}),
        'kid_id': str(kid_id),
        'session_type': str(session_type),
        'created_at_ts': time.time(),
    }
    with _PENDING_SESSIONS_LOCK:
        _cleanup_expired_pending_sessions()
        _PENDING_SESSIONS[token] = record
    return token


def pop_pending_session(token, kid_id, session_type):
    """Pop one pending session token if it matches kid/type."""
    if not token:
        return None
    with _PENDING_SESSIONS_LOCK:
        _cleanup_expired_pending_sessions()
        payload = _PENDING_SESSIONS.pop(str(token), None)
    if not payload:
        return None
    if str(payload.get('kid_id')) != str(kid_id):
        if is_type_iii_session_type(payload.get('session_type')):
            cleanup_type3_pending_audio_files_by_payload(payload)
        return None
    if str(payload.get('session_type')) != str(session_type):
        if is_type_iii_session_type(payload.get('session_type')):
            cleanup_type3_pending_audio_files_by_payload(payload)
        return None
    return payload


def get_pending_session(token, kid_id, session_type):
    """Get one pending session token without removing it."""
    if not token:
        return None
    with _PENDING_SESSIONS_LOCK:
        _cleanup_expired_pending_sessions()
        payload = _PENDING_SESSIONS.get(str(token))
        if not payload:
            return None
        if str(payload.get('kid_id')) != str(kid_id):
            return None
        if str(payload.get('session_type')) != str(session_type):
            return None
        return payload


def parse_client_started_at(raw_started_at, pending=None):
    """Parse client-provided session start time into naive UTC datetime."""
    dt = None

    if isinstance(raw_started_at, (int, float)):
        try:
            dt = datetime.fromtimestamp(float(raw_started_at) / 1000.0, tz=timezone.utc)
        except Exception:
            dt = None
    elif isinstance(raw_started_at, str):
        text = raw_started_at.strip()
        if text:
            try:
                if re.fullmatch(r'\d+(\.\d+)?', text):
                    dt = datetime.fromtimestamp(float(text) / 1000.0, tz=timezone.utc)
                else:
                    normalized = text.replace('Z', '+00:00')
                    parsed = datetime.fromisoformat(normalized)
                    if parsed.tzinfo is None:
                        dt = parsed.replace(tzinfo=timezone.utc)
                    else:
                        dt = parsed.astimezone(timezone.utc)
            except Exception:
                dt = None

    if dt is None and isinstance(pending, dict):
        created_at_ts = pending.get('created_at_ts')
        try:
            if created_at_ts is not None:
                dt = datetime.fromtimestamp(float(created_at_ts), tz=timezone.utc)
        except Exception:
            dt = None

    if dt is None:
        dt = datetime.now(timezone.utc)

    return dt.replace(tzinfo=None)
