"""Offline-mode lock registry.

A single JSON file under DATA_DIR records which kids have been pulled into a
browser's offline practice pack. The lock binds (kid_id, family_id) to a
specific (pack_id, device_label) pair and auto-expires at family-timezone
midnight.

While a kid is locked, all online write paths for that kid must be rejected.
Lock release happens on explicit sync or lazily after expiry.

The file lives inside DATA_DIR so it is automatically included in backup zips
and restored alongside the rest of family data.
"""
import json
import os
import threading
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from src.db import metadata
from src.routes.kids_constants import DATA_DIR

OFFLINE_LOCKS_FILE = os.path.join(DATA_DIR, 'offline_locks.json')
_OFFLINE_LOCKS_LOCK = threading.Lock()


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
    """Return the next family-timezone midnight as a naive UTC datetime."""
    tz_name = metadata.get_family_timezone(str(family_id or ''))
    try:
        tzinfo = ZoneInfo(tz_name)
    except Exception:
        tzinfo = ZoneInfo('UTC')
    now_local = datetime.now(tzinfo)
    next_midnight_local = (now_local + timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0,
    )
    return next_midnight_local.astimezone(timezone.utc).replace(tzinfo=None)


def _load_raw():
    if not os.path.exists(OFFLINE_LOCKS_FILE):
        return {'locks': {}}
    try:
        with open(OFFLINE_LOCKS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception:
        return {'locks': {}}
    if not isinstance(data, dict):
        return {'locks': {}}
    locks = data.get('locks')
    if not isinstance(locks, dict):
        locks = {}
    return {'locks': locks}


def _save_raw(data):
    os.makedirs(os.path.dirname(OFFLINE_LOCKS_FILE), exist_ok=True)
    tmp_path = OFFLINE_LOCKS_FILE + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, OFFLINE_LOCKS_FILE)


def _drop_expired_in_place(data):
    """Mutate data, removing expired locks. Return (data, removed_count)."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    locks = data.get('locks') or {}
    removed = 0
    for kid_id in list(locks.keys()):
        entry = locks.get(kid_id) or {}
        exp = _parse_iso_utc(entry.get('expires_at_utc'))
        if exp is None or exp <= now:
            del locks[kid_id]
            removed += 1
    data['locks'] = locks
    return data, removed


def _normalize_kid_id(kid_id):
    return str(kid_id).strip() if kid_id is not None else ''


def cleanup_expired():
    """Drop expired entries; persist if anything changed."""
    with _OFFLINE_LOCKS_LOCK:
        data = _load_raw()
        data, removed = _drop_expired_in_place(data)
        if removed > 0:
            _save_raw(data)


def get_lock(kid_id):
    """Return the active lock for one kid, or None."""
    kid_key = _normalize_kid_id(kid_id)
    if not kid_key:
        return None
    with _OFFLINE_LOCKS_LOCK:
        data = _load_raw()
        data, removed = _drop_expired_in_place(data)
        if removed > 0:
            _save_raw(data)
        entry = data['locks'].get(kid_key)
        return dict(entry) if isinstance(entry, dict) else None


def is_kid_locked(kid_id):
    return get_lock(kid_id) is not None


def get_locks_for_family(family_id):
    """Return all active locks belonging to one family."""
    fid = str(family_id or '')
    if not fid:
        return []
    with _OFFLINE_LOCKS_LOCK:
        data = _load_raw()
        data, removed = _drop_expired_in_place(data)
        if removed > 0:
            _save_raw(data)
        return [
            {**entry, 'kid_id': kid_id}
            for kid_id, entry in data['locks'].items()
            if isinstance(entry, dict) and str(entry.get('family_id') or '') == fid
        ]


def acquire_lock(kid_id, family_id, device_label):
    """Try to acquire an offline lock for one kid.

    Returns the new lock dict on success, or {'conflict': existing_lock}
    when the kid is already locked by someone else.
    """
    kid_key = _normalize_kid_id(kid_id)
    if not kid_key:
        return {'error': 'kid_id required'}
    fid = str(family_id or '')
    if not fid:
        return {'error': 'family_id required'}
    label = str(device_label or '').strip()[:64] or 'Unknown device'
    with _OFFLINE_LOCKS_LOCK:
        data = _load_raw()
        data, removed = _drop_expired_in_place(data)
        existing = data['locks'].get(kid_key)
        if isinstance(existing, dict):
            return {'conflict': dict(existing)}
        pack_id = uuid.uuid4().hex
        entry = {
            'family_id': fid,
            'pack_id': pack_id,
            'device_label': label,
            'acquired_at_utc': _utcnow_iso(),
            'expires_at_utc': _compute_expiry_utc(fid).isoformat(),
        }
        data['locks'][kid_key] = entry
        _save_raw(data)
        return {'lock': {**entry, 'kid_id': kid_key}}


def update_pack_stats(kid_id, pack_id, total_bytes, total_file_count, audio_file_count):
    """Record download stats on the lock entry. Returns updated lock dict or None."""
    kid_key = _normalize_kid_id(kid_id)
    if not kid_key:
        return None
    def _to_nonneg_int(value):
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            return 0
    total_int = _to_nonneg_int(total_bytes)
    total_files_int = _to_nonneg_int(total_file_count)
    audio_count_int = _to_nonneg_int(audio_file_count)
    with _OFFLINE_LOCKS_LOCK:
        data = _load_raw()
        data, removed = _drop_expired_in_place(data)
        entry = data['locks'].get(kid_key)
        if not isinstance(entry, dict):
            if removed > 0:
                _save_raw(data)
            return None
        if str(entry.get('pack_id')) != str(pack_id):
            if removed > 0:
                _save_raw(data)
            return None
        entry['pack_total_bytes'] = total_int
        entry['pack_total_file_count'] = total_files_int
        entry['pack_audio_file_count'] = audio_count_int
        data['locks'][kid_key] = entry
        _save_raw(data)
        return dict(entry)


def release_lock(kid_id, pack_id):
    """Release the offline lock if the pack_id matches.

    Returns dict with keys:
      - 'released' (bool): True if this call deleted the lock.
      - 'reason' (str): 'released' | 'expired_or_missing' | 'taken_by_other'
      - 'current' (dict|None): current lock state if mismatch.
    """
    kid_key = _normalize_kid_id(kid_id)
    if not kid_key:
        return {'released': False, 'reason': 'expired_or_missing', 'current': None}
    with _OFFLINE_LOCKS_LOCK:
        data = _load_raw()
        data, removed = _drop_expired_in_place(data)
        existing = data['locks'].get(kid_key)
        if not isinstance(existing, dict):
            if removed > 0:
                _save_raw(data)
            return {'released': False, 'reason': 'expired_or_missing', 'current': None}
        if str(existing.get('pack_id')) != str(pack_id):
            if removed > 0:
                _save_raw(data)
            return {
                'released': False,
                'reason': 'taken_by_other',
                'current': dict(existing),
            }
        del data['locks'][kid_key]
        _save_raw(data)
        return {'released': True, 'reason': 'released', 'current': None}


def force_release_lock(kid_id):
    """Drop any active lock for one kid regardless of pack_id.

    Used by the family-home escape hatch when the offline device is lost.
    The owner device's later sync attempt is rejected by the sync route
    because its pack_id no longer matches what's on the server.

    Returns dict with:
      - 'released' (bool): True if a lock was actually removed.
      - 'previous' (dict|None): the lock entry that was dropped, if any.
    """
    kid_key = _normalize_kid_id(kid_id)
    if not kid_key:
        return {'released': False, 'previous': None}
    with _OFFLINE_LOCKS_LOCK:
        data = _load_raw()
        data, _removed = _drop_expired_in_place(data)
        existing = data['locks'].get(kid_key)
        if not isinstance(existing, dict):
            _save_raw(data)
            return {'released': False, 'previous': None}
        del data['locks'][kid_key]
        _save_raw(data)
        return {'released': True, 'previous': dict(existing)}


def assert_kid_online(kid_id):
    """Return None when the kid is online, or (response_dict, status) when locked.

    Routes that mutate kid state should call this and return early on lock.
    """
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
