"""Parse and normalize the session.practice_mode string ("base[+drill]").

The stored value combines a judging-mode base (``self``/``parent``/``multi``/
``input``/``na``) with an optional ``+drill`` suffix. Drill is orthogonal to
the base judging mode, so callers read the two flags independently.
"""
from src.routes.kids_constants import (
    TYPE_IV_PRACTICE_MODE_INPUT,
    TYPE_IV_PRACTICE_MODE_MULTI,
)

SESSION_PRACTICE_MODE_NA = 'na'
SESSION_PRACTICE_MODE_BASE_VALID = {'self', 'parent', 'multi', 'input', 'na'}
SESSION_PRACTICE_MODE_DRILL_SUFFIX = '+drill'


def parse_session_practice_mode(raw_mode):
    """Parse a session practice mode string into base mode + drill flag.

    Composite encoding: ``<base>+drill`` (e.g. ``multi+drill``). Drill is
    orthogonal to the base judging mode, so callers should treat the two
    flags independently.
    """
    text = str(raw_mode or '').strip().lower()
    drill = False
    if text.endswith(SESSION_PRACTICE_MODE_DRILL_SUFFIX):
        drill = True
        text = text[:-len(SESSION_PRACTICE_MODE_DRILL_SUFFIX)]
    if text not in SESSION_PRACTICE_MODE_BASE_VALID:
        text = SESSION_PRACTICE_MODE_NA
    return {'base': text, 'drill': drill}


def compose_session_practice_mode(base, drill):
    """Compose a base mode + drill flag back into the stored string form."""
    text = str(base or '').strip().lower()
    if text not in SESSION_PRACTICE_MODE_BASE_VALID:
        text = SESSION_PRACTICE_MODE_NA
    return f"{text}{SESSION_PRACTICE_MODE_DRILL_SUFFIX}" if drill else text


def normalize_session_practice_mode(raw_mode):
    """Normalize a session practice mode string. Returns 'na' for unknown values."""
    parsed = parse_session_practice_mode(raw_mode)
    return compose_session_practice_mode(parsed['base'], parsed['drill'])


def is_drill_session_practice_mode(raw_mode):
    return parse_session_practice_mode(raw_mode)['drill']


def get_session_practice_mode_base(raw_mode):
    return parse_session_practice_mode(raw_mode)['base']


def get_session_practice_mode(conn, session_id):
    """Read practice_mode from an existing session row, defaulting to 'na'."""
    row = conn.execute(
        "SELECT practice_mode FROM sessions WHERE id = ? LIMIT 1",
        [int(session_id)],
    ).fetchone()
    if not row:
        return SESSION_PRACTICE_MODE_NA
    return normalize_session_practice_mode(row[0])


def normalize_type_iv_practice_mode(raw_mode):
    """Normalize generator practice mode to input or multi."""
    text = str(raw_mode or '').strip().lower()
    if text == TYPE_IV_PRACTICE_MODE_MULTI:
        return TYPE_IV_PRACTICE_MODE_MULTI
    return TYPE_IV_PRACTICE_MODE_INPUT
