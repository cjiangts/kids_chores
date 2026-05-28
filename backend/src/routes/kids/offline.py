"""Offline-mode routes: acquire / sync / status / release.

Endpoint summary (all routes are POST/GET on the kids blueprint):

  POST /kids/<id>/offline/acquire
      - Take an offline lock on one kid for the calling device/browser.
      - Returns the pack envelope: pack_id, expiry, today's remaining
        category list (the client then calls each subject's
        existing practice/start to fetch session payloads).

  POST /kids/<id>/offline/sync
      - Receive completed session payloads (and optional in-progress
        snapshots) collected offline. Reinjects each into the in-memory
        pending-session dict and calls the shared complete pipeline.
        Each session is replayed independently — successes commit, the
        per-session results array tells the client what landed. If the
        lock has already expired or moved to another device, the stale
        local pack is discarded instead of being merged.

  GET  /kids/offline/status
      - Returns all active offline locks for the current family.

  POST /kids/<id>/offline/release
      - Force-release without uploading any data. Used by the user-facing
        "exit offline" path when there is no local data to flush.

Lock state lives in `services/offline_locks.py` as an `offlineClaim` field on
each kid record in `kids.json` (managed via `src/db/metadata.py`).
"""
import base64
from flask import jsonify, request

from src.routes.kids import kids_bp
from src.routes.kids_constants import (
    DECK_CATEGORY_BEHAVIOR_TYPE_I,
    DECK_CATEGORY_BEHAVIOR_TYPE_II,
    DECK_CATEGORY_BEHAVIOR_TYPE_III,
    DECK_CATEGORY_BEHAVIOR_TYPE_IV,
    PENDING_RETRY_SOURCE_SESSION_ID_KEY,
)
from src.services.shared_deck_category import get_session_behavior_type
from src.services.family_auth import (
    can_family_access_deck_category,
    current_family_id,
    get_kid_connection_for,
    get_kid_for_family,
    is_super_family_id,
    require_critical_password,
)
from src.services.kid_daily_progress import (
    get_deck_category_display_name,
    get_kid_daily_star_tiers_by_deck_category,
    get_kid_dashboard_stats,
    get_kid_opted_in_deck_category_keys,
    get_kid_practice_target_by_deck_category,
    get_type_iii_category_keys,
)
from src.services.offline_locks import (
    acquire_lock,
    assert_kid_online,
    get_lock,
    get_locks_for_family,
    release_lock,
    update_pack_stats,
)
from src.services.pending_sessions import (
    _PENDING_SESSIONS,
    _PENDING_SESSIONS_LOCK,
)
from src.services.shared_deck_category import (
    get_shared_deck_category_meta_by_key,
    is_type_iii_session_type,
)


_BEHAVIOR_TYPE_PRACTICE_PATHS = {
    DECK_CATEGORY_BEHAVIOR_TYPE_I: 'cards',
    DECK_CATEGORY_BEHAVIOR_TYPE_II: 'type2',
    DECK_CATEGORY_BEHAVIOR_TYPE_III: 'lesson-reading',
    DECK_CATEGORY_BEHAVIOR_TYPE_IV: 'type4',
}


def _list_inflight_pending_sessions_for_kid(kid_id):
    """Return non-empty list when this kid currently has uncommitted pending sessions.

    Sessions created by the offline-acquire flow itself are tagged with
    `offline_pack_id` and are not considered "inflight" — they belong to a
    pack lifecycle (sync/release/expire), not to a live browser practice run.
    """
    kid_key = str(kid_id)
    sessions = []
    with _PENDING_SESSIONS_LOCK:
        for token, payload in _PENDING_SESSIONS.items():
            if str(payload.get('kid_id')) != kid_key:
                continue
            if payload.get('offline_pack_id'):
                continue
            sessions.append({
                'pending_session_id': token,
                'session_type': str(payload.get('session_type') or ''),
                'planned_count': int(payload.get('planned_count') or 0),
            })
    return sessions


def _purge_offline_pack_pending_sessions_for_kid(kid_id):
    """Drop any pack-tagged pending sessions for this kid (stale offline pack carryover)."""
    kid_key = str(kid_id)
    with _PENDING_SESSIONS_LOCK:
        stale = [
            token for token, payload in _PENDING_SESSIONS.items()
            if str(payload.get('kid_id')) == kid_key and payload.get('offline_pack_id')
        ]
        for token in stale:
            _PENDING_SESSIONS.pop(token, None)


def _build_kid_today_pack_plan(kid, family_id, family_timezone):
    """Return [{category_key, behavior_type, practice_path, display_name, gold_reached}].

    `gold_reached` is True when the kid already earned gold tier today for the
    category. The caller still calls practice/start for those — if it surfaces
    continue/retry work (review/redo), the category is included; otherwise the
    UI greys it out.
    """
    is_super = is_super_family_id(family_id)
    all_meta = get_shared_deck_category_meta_by_key()
    category_meta_by_key = {
        key: meta
        for key, meta in all_meta.items()
        if can_family_access_deck_category(meta, family_id=family_id, is_super=is_super)
    }
    type_iii_keys = get_type_iii_category_keys(category_meta_by_key)
    try:
        conn = get_kid_connection_for(kid, read_only=True)
    except Exception:
        conn = None
    try:
        opted_in = get_kid_opted_in_deck_category_keys(
            kid,
            category_meta_by_key=category_meta_by_key,
            conn=conn,
        )
        practice_targets = get_kid_practice_target_by_deck_category(
            kid,
            opted_in,
            category_meta_by_key,
            conn=conn,
        )
        (
            _today_counts,
            today_star_tiers,
            _percent,
            _target_count,
            _tried_count,
            _right_count,
            _ungraded_count,
        ) = get_kid_dashboard_stats(
            kid,
            category_meta_by_key=category_meta_by_key,
            type_iii_category_keys=type_iii_keys,
            conn=conn,
            family_timezone=family_timezone,
        )
        daily_tiers = get_kid_daily_star_tiers_by_deck_category(
            opted_in,
            today_star_tiers=today_star_tiers,
        )
    finally:
        if conn is not None:
            conn.close()

    out = []
    for key in opted_in:
        target = practice_targets.get(key)
        try:
            target_int = int(target or 0)
        except (TypeError, ValueError):
            target_int = 0
        if target_int <= 0:
            continue
        meta = category_meta_by_key.get(key) or {}
        behavior_type = str(meta.get('behavior_type') or '').strip()
        if behavior_type not in _BEHAVIOR_TYPE_PRACTICE_PATHS:
            continue
        tiers = daily_tiers.get(key) or []
        tier_strings = [str(t or '').lower() for t in tiers] if isinstance(tiers, list) else []
        gold_reached = any(t == 'gold' for t in tier_strings)
        out.append({
            'category_key': key,
            'behavior_type': behavior_type,
            'practice_path': _BEHAVIOR_TYPE_PRACTICE_PATHS[behavior_type],
            'display_name': get_deck_category_display_name(meta, key),
            'gold_reached': gold_reached,
        })
    return out


def _parse_device_label(payload):
    raw = ''
    if isinstance(payload, dict):
        raw = str(payload.get('deviceLabel') or '').strip()
    if not raw:
        raw = str(request.headers.get('X-Device-Label') or '').strip()
    return raw[:64] or 'Unknown device'


# ============================================================================
# 1. Acquire — take a lock and list categories for the client to download
# ============================================================================

@kids_bp.route('/kids/<kid_id>/offline/acquire', methods=['POST'])
def offline_acquire(kid_id):
    """Acquire an offline lock for one kid and return the pack envelope.

    Behavior:
      - If the kid has unfinished in-memory pending sessions, return 409 with
        `inflight=[...]` unless the request includes `forceDiscardInflight=true`.
      - If another device already holds the lock, return 423.
      - Otherwise create the lock and return the category plan.
    """
    try:
        family_id = current_family_id()
        if not family_id:
            return jsonify({'error': 'Family login required'}), 401
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload = request.get_json(silent=True) or {}
        device_label = _parse_device_label(payload)
        force_discard = bool(payload.get('forceDiscardInflight'))

        inflight = _list_inflight_pending_sessions_for_kid(kid_id)
        if inflight and not force_discard:
            return jsonify({
                'error': 'inflight_sessions',
                'message': (
                    'This child has unfinished practice in progress. '
                    'Finish or discard before going offline.'
                ),
                'inflight': inflight,
            }), 409

        if force_discard and inflight:
            with _PENDING_SESSIONS_LOCK:
                for entry in inflight:
                    _PENDING_SESSIONS.pop(entry['pending_session_id'], None)

        result = acquire_lock(kid_id, family_id, device_label)
        if 'conflict' in result:
            return jsonify({
                'error': 'kid_offline_elsewhere',
                'message': 'This child is already in offline mode on another device.',
                'lock': result['conflict'],
            }), 423
        if 'error' in result:
            return jsonify({'error': result['error']}), 400

        _purge_offline_pack_pending_sessions_for_kid(kid_id)

        from src.db import metadata
        family_timezone = metadata.get_family_timezone(family_id)
        lock = result['lock']
        categories = _build_kid_today_pack_plan(kid, family_id, family_timezone)
        return jsonify({
            'kid_name': str(kid.get('name') or ''),
            'pack_id': lock['pack_id'],
            'device_label': lock['device_label'],
            'acquired_at_utc': lock['acquired_at_utc'],
            'expires_at_utc': lock['expires_at_utc'],
            'categories': categories,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================================================
# 2. Sync — accept completed sessions and release the lock
# ============================================================================

def _decode_type3_audio_uploads(session_entry):
    """Decode base64-encoded type-III audio payloads into the multipart-equivalent dict."""
    uploads_raw = session_entry.get('audioByCard')
    if not isinstance(uploads_raw, dict):
        return {}
    decoded = {}
    for card_id_raw, blob in uploads_raw.items():
        if not isinstance(blob, dict):
            continue
        try:
            card_id = int(card_id_raw)
        except (TypeError, ValueError):
            continue
        b64 = blob.get('dataBase64') or ''
        try:
            audio_bytes = base64.b64decode(b64) if b64 else b''
        except Exception:
            audio_bytes = b''
        if not audio_bytes:
            continue
        decoded[card_id] = {
            'bytes': audio_bytes,
            'mime_type': str(blob.get('mimeType') or 'audio/webm'),
            'filename': str(blob.get('filename') or f'card_{card_id}.webm'),
        }
    return decoded


def _capture_type_iv_item_id_map(kid, real_session_id, source_answers):
    """Build offline-item-id -> real session_results.id map for a synced type-IV source.

    Offline pending items are id'd 1..N at acquire time, but each source replay
    inserts brand-new `session_results` rows with auto-increment ids. Retries
    `append_type4_result_submitted_answer(conn, item_id, ...)` would 404 against
    the offline ids — pair the source's answers (preserved insert order) with
    the new rows ordered by id to recover the mapping.
    """
    conn = get_kid_connection_for(kid, read_only=True)
    try:
        rows = conn.execute(
            "SELECT id FROM session_results WHERE session_id = ? ORDER BY id ASC",
            [int(real_session_id)],
        ).fetchall()
    finally:
        conn.close()
    real_ids = [int(r[0]) for r in rows]
    # Continue sessions append rows; take the tail that matches the offline batch.
    n = len(source_answers)
    if n > 0 and len(real_ids) > n:
        real_ids = real_ids[-n:]
    id_map = {}
    for offline_answer, real_id in zip(source_answers, real_ids):
        try:
            offline_id = int(offline_answer.get('cardId'))
        except (TypeError, ValueError):
            continue
        id_map[offline_id] = int(real_id)
    return id_map


def _remap_type_iv_retry_offline_ids(pending_payload, answers, id_map):
    """Rewrite retry pending_payload.cards[*].id and answers[*].cardId using id_map."""
    new_cards = []
    for card in pending_payload.get('cards') or []:
        if not isinstance(card, dict):
            continue
        try:
            offline_id = int(card.get('id') or 0)
        except (TypeError, ValueError):
            return None, None, 'retry_item_invalid_id'
        real_id = id_map.get(offline_id)
        if real_id is None:
            return None, None, 'retry_source_item_not_mapped'
        new_card = dict(card)
        new_card['id'] = int(real_id)
        new_cards.append(new_card)
    new_pending = dict(pending_payload)
    new_pending['cards'] = new_cards

    new_answers = []
    for ans in answers:
        if not isinstance(ans, dict):
            continue
        try:
            offline_id = int(ans.get('cardId') or 0)
        except (TypeError, ValueError):
            return None, None, 'retry_answer_invalid_id'
        real_id = id_map.get(offline_id)
        if real_id is None:
            return None, None, 'retry_source_item_not_mapped'
        new_ans = dict(ans)
        new_ans['cardId'] = int(real_id)
        new_answers.append(new_ans)
    return new_pending, new_answers, None


def _replay_completed_session(
    kid, kid_id, session_entry, source_pid_to_session_id, source_pid_to_item_id_map,
):
    """Re-inject pending payload and run complete_session_internal for one session.

    `source_pid_to_session_id` maps each committed source pendingSessionId to
    the real DB `session_id`. Retry entries carry `retry_source_offline_pending_id`
    in their pending payload; we look up the source's real session_id here and
    inject it as `retry_source_session_id` so complete_session_internal hits
    the retry branch (UPDATE source.correct, append submitted_grades).
    Successful non-retry replays add their own mapping to the dict in-place.

    For type-IV sources we also capture `source_pid_to_item_id_map[source_pid]`
    = {offline_item_id -> real session_results.id} so each retry can remap its
    per-item ids before the append path looks them up.

    Returns (response_dict, status_code).
    """
    from src.routes.kids.practice import complete_session_internal  # avoid cycle

    pending_payload = session_entry.get('pendingPayload')
    answers = session_entry.get('answers')
    pending_session_id = session_entry.get('pendingSessionId')
    session_type = session_entry.get('sessionType')
    started_at = session_entry.get('startedAt')
    if not pending_payload or not isinstance(pending_payload, dict):
        return {'error': 'missing pendingPayload'}, 400
    if not pending_session_id or not session_type:
        return {'error': 'missing pendingSessionId or sessionType'}, 400
    if not isinstance(answers, list) or len(answers) == 0:
        return {'error': 'answers must be a non-empty list'}, 400

    is_type_iv = get_session_behavior_type(session_type) == DECK_CATEGORY_BEHAVIOR_TYPE_IV
    retry_source_offline_pid = str(pending_payload.get('retry_source_offline_pending_id') or '')
    if retry_source_offline_pid and is_type_iv:
        id_map = source_pid_to_item_id_map.get(retry_source_offline_pid)
        if not id_map:
            return {'error': 'retry_source_not_synced'}, 400
        remapped_pending, remapped_answers, err = _remap_type_iv_retry_offline_ids(
            pending_payload, answers, id_map,
        )
        if err is not None:
            return {'error': err}, 400
        pending_payload = remapped_pending
        answers = remapped_answers

    record = {
        **pending_payload,
        'kid_id': str(kid_id),
        'session_type': str(session_type),
        'created_at_ts': float(session_entry.get('createdAtTs') or 0.0),
    }
    if retry_source_offline_pid:
        real_source_id = source_pid_to_session_id.get(retry_source_offline_pid)
        if not real_source_id:
            return {'error': 'retry_source_not_synced'}, 400
        record[PENDING_RETRY_SOURCE_SESSION_ID_KEY] = int(real_source_id)
    with _PENDING_SESSIONS_LOCK:
        _PENDING_SESSIONS[str(pending_session_id)] = record

    complete_data = {
        'pendingSessionId': pending_session_id,
        'answers': answers,
        'categoryKey': session_type,
    }
    if started_at:
        complete_data['startedAt'] = started_at
    if is_type_iii_session_type(session_type):
        complete_data['_uploaded_type3_audio_by_card'] = _decode_type3_audio_uploads(session_entry)
    try:
        response_dict, status_code = complete_session_internal(kid, kid_id, session_type, complete_data)
    finally:
        with _PENDING_SESSIONS_LOCK:
            _PENDING_SESSIONS.pop(str(pending_session_id), None)
    if not retry_source_offline_pid and 200 <= int(status_code or 500) < 300:
        real_id = (response_dict or {}).get('session_id') if isinstance(response_dict, dict) else None
        if real_id:
            source_pid_to_session_id[str(pending_session_id)] = int(real_id)
            if is_type_iv:
                source_pid_to_item_id_map[str(pending_session_id)] = (
                    _capture_type_iv_item_id_map(kid, int(real_id), answers)
                )
    return response_dict, status_code


def _replay_thumb_down_events(kid, events):
    """Apply each offline-queued thumb-down to the kid DB. Returns commit count.

    Mirrors the per-request thumb-down route (kid_decks.thumb_down_card): one
    +1 increment to cards.thumb_down_count per event. Unknown card ids and
    malformed entries are skipped silently — the offline queue is best-effort
    feedback, not authoritative.
    """
    if not events:
        return 0
    conn = get_kid_connection_for(kid)
    committed = 0
    try:
        for event in events:
            if not isinstance(event, dict):
                continue
            try:
                card_id = int(event.get('cardId'))
            except (TypeError, ValueError):
                continue
            row = conn.execute(
                "SELECT id FROM cards WHERE id = ? LIMIT 1",
                [card_id],
            ).fetchone()
            if not row:
                continue
            conn.execute(
                "UPDATE cards SET thumb_down_count = COALESCE(thumb_down_count, 0) + 1 WHERE id = ?",
                [card_id],
            )
            committed += 1
    finally:
        conn.close()
    return committed


@kids_bp.route('/kids/<kid_id>/offline/sync', methods=['POST'])
def offline_sync(kid_id):
    """Upload completed offline sessions and release the lock."""
    try:
        family_id = current_family_id()
        if not family_id:
            return jsonify({'error': 'Family login required'}), 401
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload = request.get_json(silent=True) or {}
        pack_id = str(payload.get('packId') or '').strip()
        sessions = payload.get('sessions') or []
        thumb_down_events = payload.get('thumbDownEvents') or []
        if not pack_id:
            return jsonify({'error': 'packId is required'}), 400
        if not isinstance(sessions, list):
            return jsonify({'error': 'sessions must be a list'}), 400
        if not isinstance(thumb_down_events, list):
            return jsonify({'error': 'thumbDownEvents must be a list'}), 400

        current_lock = get_lock(kid_id)
        conflict_warning = None
        if current_lock is None:
            conflict_warning = 'lock_expired_or_released'
        elif str(current_lock.get('pack_id')) != pack_id:
            conflict_warning = 'lock_taken_by_other_device'

        results = []
        committed_count = 0
        discarded_answer_count = 0
        thumb_down_committed = 0
        release_info = None
        if conflict_warning is not None:
            # The lock is gone or has moved on. Refuse to replay — the kid may
            # have already practiced online since, and merging stale offline
            # results would corrupt their state. Discard everything, report
            # the count back so the client can show a clear message.
            for entry in sessions:
                if isinstance(entry, dict):
                    answers = entry.get('answers')
                    if isinstance(answers, list):
                        discarded_answer_count += len(answers)
        else:
            # Sort source sessions before retry sessions so each retry can map
            # its `retry_source_offline_pending_id` to the source's real
            # session_id committed earlier in this loop.
            def _is_retry_entry(entry):
                if not isinstance(entry, dict):
                    return False
                pp = entry.get('pendingPayload')
                if not isinstance(pp, dict):
                    return False
                return bool(pp.get('retry_source_offline_pending_id'))

            ordered_sessions = sorted(sessions, key=lambda e: 1 if _is_retry_entry(e) else 0)
            source_pid_to_session_id = {}
            source_pid_to_item_id_map = {}
            for entry in ordered_sessions:
                if not isinstance(entry, dict):
                    results.append({'ok': False, 'error': 'invalid session entry'})
                    continue
                # Catch per-session exceptions so the loop always reaches
                # release_lock below. Otherwise an unexpected raise (DB error,
                # type-IV id-map query failure, etc.) would propagate to the
                # outer except, skip release_lock, and leave the lock held —
                # the client's next sync retry would then re-commit every
                # session that already succeeded, producing duplicates.
                try:
                    response_dict, status_code = _replay_completed_session(
                        kid, kid_id, entry, source_pid_to_session_id, source_pid_to_item_id_map,
                    )
                except Exception as exc:
                    response_dict, status_code = {'error': f'replay_failed: {exc}'}, 500
                ok = 200 <= int(status_code or 500) < 300
                if ok:
                    committed_count += 1
                results.append({
                    'ok': ok,
                    'status': int(status_code or 500),
                    'pendingSessionId': entry.get('pendingSessionId'),
                    'sessionType': entry.get('sessionType'),
                    'response': response_dict,
                })
            try:
                thumb_down_committed = _replay_thumb_down_events(kid, thumb_down_events)
            except Exception:
                thumb_down_committed = 0
            release_info = release_lock(kid_id, pack_id)

        return jsonify({
            'kid_id': kid_id,
            'pack_id': pack_id,
            'committed_count': committed_count,
            'submitted_count': len(sessions),
            'discarded_session_count': len(sessions) if conflict_warning else 0,
            'discarded_answer_count': discarded_answer_count,
            'thumb_down_committed': thumb_down_committed,
            'thumb_down_submitted': len(thumb_down_events),
            'thumb_down_discarded': len(thumb_down_events) if conflict_warning else 0,
            'conflict_warning': conflict_warning,
            'release': release_info,
            'results': results,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================================================
# 3. Status — list current offline locks for the family
# ============================================================================

@kids_bp.route('/offline/status', methods=['GET'])
def offline_status():
    """Return current offline locks for the calling family."""
    family_id = current_family_id()
    if not family_id:
        return jsonify({'error': 'Family login required'}), 401
    locks = get_locks_for_family(family_id)
    return jsonify({'locks': locks}), 200


# ============================================================================
# 3a. Report pack stats — owner device tells server the downloaded pack size
# ============================================================================

@kids_bp.route('/kids/<kid_id>/offline/report-pack-stats', methods=['POST'])
def offline_report_pack_stats(kid_id):
    """Persist totalBytes + audioFileCount on the lock so any device can read them."""
    family_id = current_family_id()
    if not family_id:
        return jsonify({'error': 'Family login required'}), 401
    kid = get_kid_for_family(kid_id)
    if not kid:
        return jsonify({'error': 'Kid not found'}), 404
    payload = request.get_json(silent=True) or {}
    pack_id = str(payload.get('packId') or '').strip()
    if not pack_id:
        return jsonify({'error': 'packId is required'}), 400
    updated = update_pack_stats(
        kid_id,
        pack_id,
        payload.get('totalBytes'),
        payload.get('totalFileCount'),
        payload.get('audioFileCount'),
    )
    if not updated:
        return jsonify({'error': 'no_matching_lock'}), 409
    return jsonify({'ok': True, 'lock': updated}), 200


# ============================================================================
# 4. Write gate — reject mutating requests on kids that are offline-locked
# ============================================================================

# Mutating HTTP methods that the gate inspects. GET/HEAD/OPTIONS are always free.
_GATED_METHODS = {'POST', 'PUT', 'PATCH', 'DELETE'}


def _extract_kid_id_from_path(path):
    """Pull kid_id from `/kids/<id>/...` style URLs. Returns (kid_id, rest_path)."""
    parts = path.strip('/').split('/')
    if len(parts) < 2:
        return None, ''
    # Routes are mounted without /api/ prefix on the blueprint itself; some
    # deployments may proxy with /api/ — handle both.
    offset = 0
    if parts[0] == 'api':
        offset = 1
    if len(parts) <= offset + 1 or parts[offset] != 'kids':
        return None, ''
    kid_id = parts[offset + 1]
    rest = '/'.join(parts[offset + 2:])
    return kid_id, rest


@kids_bp.before_request
def _block_writes_for_offline_kids():
    """Reject write requests for kids that are offline-locked on another browser.

    Allowed exceptions while a lock is active:
      - any /kids/<id>/offline/* route (acquire / sync / release)
      - /kids/<id>/<scope>/practice/start when the request carries the
        matching `X-Offline-Pack-Id` header (so the owner device can build
        its pack right after acquiring the lock)
    """
    if request.method not in _GATED_METHODS:
        return None
    kid_id, rest = _extract_kid_id_from_path(request.path)
    if not kid_id:
        return None
    if rest.startswith('offline/'):
        return None
    lock = get_lock(kid_id)
    if lock is None:
        return None
    if rest.endswith('/practice/start'):
        pack_id_header = str(request.headers.get('X-Offline-Pack-Id') or '')
        if pack_id_header and pack_id_header == str(lock.get('pack_id') or ''):
            return None
    err = assert_kid_online(kid_id)
    if err:
        response, status = err
        return jsonify(response), status
    return None


# ============================================================================
# 5. Release — explicit no-data release (used when the local pack is empty)
# ============================================================================

@kids_bp.route('/kids/<kid_id>/offline/release', methods=['POST'])
def offline_release(kid_id):
    """Release one kid's offline lock without uploading any sessions."""
    family_id = current_family_id()
    if not family_id:
        return jsonify({'error': 'Family login required'}), 401
    kid = get_kid_for_family(kid_id)
    if not kid:
        return jsonify({'error': 'Kid not found'}), 404
    payload = request.get_json(silent=True) or {}
    pack_id = str(payload.get('packId') or '').strip()
    if not pack_id:
        return jsonify({'error': 'packId is required'}), 400
    info = release_lock(kid_id, pack_id)
    status_code = 200 if info.get('released') else 409
    return jsonify(info), status_code


# ============================================================================
# 6. Force-release — family-home escape hatch when the offline device is lost
# ============================================================================

@kids_bp.route('/kids/<kid_id>/offline/force-release', methods=['POST'])
def offline_force_release(kid_id):
    """Drop the lock regardless of pack_id, gated by the family password.

    The offline owner device's next sync attempt will hit the existing
    sync route and find no matching lock — the route already returns
    `conflict_warning: 'lock_expired_or_released'` in that case. The
    client surfaces a clearer message based on that flag.
    """
    family_id = current_family_id()
    if not family_id:
        return jsonify({'error': 'Family login required'}), 401
    kid = get_kid_for_family(kid_id)
    if not kid:
        return jsonify({'error': 'Kid not found'}), 404
    current = get_lock(kid_id)
    if not current:
        return jsonify({'released': False, 'reason': 'expired_or_missing'}), 404
    if str(current.get('family_id') or '') != str(family_id):
        return jsonify({'error': 'Lock belongs to another family'}), 403
    password_error = require_critical_password()
    if password_error is not None:
        return password_error
    info = release_lock(kid_id)
    return jsonify(info), 200
