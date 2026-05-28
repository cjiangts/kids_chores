"""Offline pack claims: one offline pack per kid at a time.

Backed by the `offlineClaim` field on each kid record in `kids.json` via
`src/db/metadata.py`. While a claim is active, mutating routes for that kid
are rejected; the claim auto-expires at the family-timezone midnight after
acquisition. Claims are cleaned up lazily on read.

Public API (consumed by `routes/kids/offline.py` and `routes/kids/kids_core.py`):
  - `acquire_lock(kid_id, family_id, device_label)` -> {lock|conflict|error}
  - `get_lock(kid_id)` -> snake_case lock dict or None
  - `get_locks_for_family(family_id)` -> list of lock dicts
  - `release_lock(kid_id, pack_id)` -> {released, reason, current}
  - `force_release_lock(kid_id)` -> {released, previous}
  - `update_pack_stats(kid_id, pack_id, bytes, files, audio)` -> updated dict or None
  - `assert_kid_online(kid_id)` -> None or (error_dict, 423) for middleware use
"""
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from src.db import metadata
from src.db.metadata import _mutate_metadata


_CLAIM_FIELD = 'offlineClaim'


def _utcnow_iso():
    return datetime.now(timezone.utc).replace(microsecond=0, tzinfo=None).isoformat()


def _parse_iso_utc(value):
    if not value:
        return None
    try:
        text = str(value).replace('Z', '+00:00')
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        return None


def _compute_expiry_utc(family_id):
    tz_name = metadata.get_family_timezone(str(family_id or ''))
    try:
        tzinfo = ZoneInfo(tz_name)
    except Exception:
        tzinfo = ZoneInfo('UTC')
    now_local = datetime.now(tzinfo)
    next_midnight = (now_local + timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0,
    )
    return next_midnight.astimezone(timezone.utc).replace(tzinfo=None)


def _public_lock_dict(kid, claim):
    """Project an in-memory kid claim into the snake_case shape callers expect."""
    return {
        'kid_id': str(kid.get('id') or ''),
        'family_id': str(kid.get('familyId') or ''),
        'pack_id': str(claim.get('packId') or ''),
        'device_label': str(claim.get('deviceLabel') or ''),
        'acquired_at_utc': claim.get('acquiredAtUtc') or '',
        'expires_at_utc': claim.get('expiresAtUtc') or '',
        'pack_total_bytes': int(claim.get('packTotalBytes') or 0),
        'pack_total_file_count': int(claim.get('packTotalFileCount') or 0),
        'pack_audio_file_count': int(claim.get('packAudioFileCount') or 0),
    }


def _find_kid(data, kid_key):
    for kid in data.get('kids', []):
        if str(kid.get('id')) == kid_key:
            return kid
    return None


def _pop_expired_claim(kid):
    """Drop expired/malformed claim in-place. Returns the active claim dict or None."""
    claim = kid.get(_CLAIM_FIELD)
    if not isinstance(claim, dict):
        kid.pop(_CLAIM_FIELD, None)
        return None
    exp = _parse_iso_utc(claim.get('expiresAtUtc'))
    if exp is None or exp <= datetime.now(timezone.utc).replace(tzinfo=None):
        kid.pop(_CLAIM_FIELD, None)
        return None
    return claim


def get_lock(kid_id):
    kid_key = str(kid_id or '').strip()
    if not kid_key:
        return None

    def _op(data):
        kid = _find_kid(data, kid_key)
        if kid is None:
            return None
        claim = _pop_expired_claim(kid)
        return _public_lock_dict(kid, claim) if claim else None

    return _mutate_metadata(_op)


def get_locks_for_family(family_id):
    fid = str(family_id or '')
    if not fid:
        return []

    def _op(data):
        out = []
        for kid in data.get('kids', []):
            if str(kid.get('familyId') or '') != fid:
                continue
            claim = _pop_expired_claim(kid)
            if claim:
                out.append(_public_lock_dict(kid, claim))
        return out

    return _mutate_metadata(_op)


def acquire_lock(kid_id, family_id, device_label):
    kid_key = str(kid_id or '').strip()
    fid = str(family_id or '')
    if not kid_key:
        return {'error': 'kid_id required'}
    if not fid:
        return {'error': 'family_id required'}
    label = str(device_label or '').strip()[:64] or 'Unknown device'
    expires_iso = _compute_expiry_utc(fid).isoformat()
    pack_id = uuid.uuid4().hex

    def _op(data):
        kid = _find_kid(data, kid_key)
        if kid is None:
            return {'error': 'kid not found'}
        claim = _pop_expired_claim(kid)
        if claim:
            return {'conflict': _public_lock_dict(kid, claim)}
        new_claim = {
            'packId': pack_id,
            'deviceLabel': label,
            'acquiredAtUtc': _utcnow_iso(),
            'expiresAtUtc': expires_iso,
        }
        kid[_CLAIM_FIELD] = new_claim
        return {'lock': _public_lock_dict(kid, new_claim)}

    return _mutate_metadata(_op)


def update_pack_stats(kid_id, pack_id, total_bytes, total_file_count, audio_file_count):
    kid_key = str(kid_id or '').strip()
    if not kid_key:
        return None

    def _nonneg_int(value):
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            return 0

    bytes_int = _nonneg_int(total_bytes)
    files_int = _nonneg_int(total_file_count)
    audio_int = _nonneg_int(audio_file_count)

    def _op(data):
        kid = _find_kid(data, kid_key)
        if kid is None:
            return None
        claim = _pop_expired_claim(kid)
        if not claim or str(claim.get('packId')) != str(pack_id):
            return None
        claim['packTotalBytes'] = bytes_int
        claim['packTotalFileCount'] = files_int
        claim['packAudioFileCount'] = audio_int
        return _public_lock_dict(kid, claim)

    return _mutate_metadata(_op)


def release_lock(kid_id, pack_id):
    kid_key = str(kid_id or '').strip()
    missing = {'released': False, 'reason': 'expired_or_missing', 'current': None}
    if not kid_key:
        return missing

    def _op(data):
        kid = _find_kid(data, kid_key)
        if kid is None:
            return missing
        claim = _pop_expired_claim(kid)
        if not claim:
            return missing
        if str(claim.get('packId')) != str(pack_id):
            return {
                'released': False,
                'reason': 'taken_by_other',
                'current': _public_lock_dict(kid, claim),
            }
        kid.pop(_CLAIM_FIELD, None)
        return {'released': True, 'reason': 'released', 'current': None}

    return _mutate_metadata(_op)


def force_release_lock(kid_id):
    kid_key = str(kid_id or '').strip()
    if not kid_key:
        return {'released': False, 'previous': None}

    def _op(data):
        kid = _find_kid(data, kid_key)
        if kid is None:
            return {'released': False, 'previous': None}
        claim = kid.get(_CLAIM_FIELD)
        if not isinstance(claim, dict):
            kid.pop(_CLAIM_FIELD, None)
            return {'released': False, 'previous': None}
        previous = _public_lock_dict(kid, claim)
        kid.pop(_CLAIM_FIELD, None)
        return {'released': True, 'previous': previous}

    return _mutate_metadata(_op)


def assert_kid_online(kid_id):
    lock = get_lock(kid_id)
    if not lock:
        return None
    return ({
        'error': 'kid_offline',
        'message': 'This child is currently in offline mode on another device.',
        'lock': {
            'device_label': lock.get('device_label'),
            'acquired_at_utc': lock.get('acquired_at_utc'),
            'expires_at_utc': lock.get('expires_at_utc'),
        },
    }, 423)
