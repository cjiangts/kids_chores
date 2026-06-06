"""Point rules, point events, and off-app chore routes."""
from flask import Blueprint, jsonify, request

from src.db import metadata
from src.db.shared_deck_db import get_shared_decks_connection
from src.services.family_auth import current_family_id, get_kid_connection_for, get_kid_for_family
from src.services.points import (
    apply_direct_rule_event,
    cancel_pending_off_app_chore,
    count_pending_off_app_chores,
    create_family_rule,
    deactivate_family_rule,
    delete_point_event,
    get_reward_bucket_totals,
    get_point_total,
    list_latest_point_events_today_by_rule,
    list_enabled_off_app_chores,
    list_family_rules,
    list_pending_off_app_chores,
    list_point_events,
    pull_in_app_chore_events_for_today,
    review_pending_off_app_chore,
    set_enabled_off_app_chores,
    submit_off_app_chore,
    update_family_rule,
    update_point_event,
)

points_bp = Blueprint('points', __name__)


def _family_id_or_response():
    family_id = current_family_id()
    if not family_id:
        return None, (jsonify({'error': 'Family login required'}), 401)
    return family_id, None


def _kid_or_response(kid_id):
    family_id, error = _family_id_or_response()
    if error:
        return None, None, error
    kid = get_kid_for_family(kid_id)
    if not kid:
        return None, family_id, (jsonify({'error': 'Kid not found'}), 404)
    return kid, family_id, None


@points_bp.route('/points/rules', methods=['GET'])
def get_point_rules():
    family_id, error = _family_id_or_response()
    if error:
        return error
    rule_kind = request.args.get('ruleKind')
    include_inactive = str(request.args.get('includeInactive', '1')).strip().lower() not in {'0', 'false', 'no'}
    conn = get_shared_decks_connection(read_only=True)
    try:
        rules = list_family_rules(
            conn,
            family_id,
            rule_kind=rule_kind,
            include_inactive=include_inactive,
        )
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    finally:
        conn.close()
    return jsonify({'rules': rules}), 200


@points_bp.route('/points/rules', methods=['POST'])
def post_point_rule():
    family_id, error = _family_id_or_response()
    if error:
        return error
    payload = request.get_json(silent=True) or {}
    conn = get_shared_decks_connection()
    try:
        rule = create_family_rule(conn, family_id, payload)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    finally:
        conn.close()
    return jsonify({'rule': rule}), 201


@points_bp.route('/points/rules/<int:rule_id>', methods=['PUT'])
def put_point_rule(rule_id):
    family_id, error = _family_id_or_response()
    if error:
        return error
    payload = request.get_json(silent=True) or {}
    conn = get_shared_decks_connection()
    try:
        rule = update_family_rule(conn, family_id, rule_id, payload)
    except KeyError:
        return jsonify({'error': 'Rule not found'}), 404
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    finally:
        conn.close()
    return jsonify({'rule': rule}), 200


@points_bp.route('/points/rules/<int:rule_id>', methods=['DELETE'])
def delete_point_rule(rule_id):
    family_id, error = _family_id_or_response()
    if error:
        return error
    conn = get_shared_decks_connection()
    try:
        rule = deactivate_family_rule(conn, family_id, rule_id)
    finally:
        conn.close()
    if not rule:
        return jsonify({'error': 'Rule not found'}), 404
    return jsonify({'rule': rule}), 200


@points_bp.route('/points/kid-totals', methods=['GET'])
def get_kid_point_totals():
    family_id, error = _family_id_or_response()
    if error:
        return error
    rows = []
    for kid in metadata.get_all_kids(family_id=family_id):
        kid_id = str(kid.get('id') or '')
        if not kid_id:
            continue
        kid_conn = None
        shared_conn = None
        try:
            kid_conn = get_kid_connection_for(kid, read_only=True)
            shared_conn = get_shared_decks_connection(read_only=True)
            total = get_point_total(kid_conn)
            reward_bucket_totals = get_reward_bucket_totals(kid_conn, shared_conn, family_id)
        except Exception:
            total = 0
            reward_bucket_totals = {}
        finally:
            if shared_conn is not None:
                shared_conn.close()
            if kid_conn is not None:
                kid_conn.close()
        rows.append({
            'kidId': kid_id,
            'totalPoints': total,
            'rewardBucketTotals': reward_bucket_totals,
        })
    return jsonify({'totals': rows}), 200


@points_bp.route('/kids/<kid_id>/points', methods=['GET'])
def get_kid_points(kid_id):
    kid, family_id, error = _kid_or_response(kid_id)
    if error:
        return error
    try:
        limit = int(request.args.get('limit') or 100)
    except (TypeError, ValueError):
        limit = 100
    kid_conn = get_kid_connection_for(kid, read_only=True)
    shared_conn = get_shared_decks_connection(read_only=True)
    try:
        total = get_point_total(kid_conn)
        reward_bucket_totals = get_reward_bucket_totals(kid_conn, shared_conn, family_id)
        events = list_point_events(kid_conn, shared_conn, family_id, limit=limit)
    finally:
        shared_conn.close()
        kid_conn.close()
    return jsonify({
        'kidId': str(kid.get('id') or ''),
        'totalPoints': total,
        'rewardBucketTotals': reward_bucket_totals,
        'events': events,
    }), 200


@points_bp.route('/kids/<kid_id>/points/events', methods=['POST'])
def post_kid_point_event(kid_id):
    kid, family_id, error = _kid_or_response(kid_id)
    if error:
        return error
    payload = request.get_json(silent=True) or {}
    kid_conn = get_kid_connection_for(kid)
    shared_conn = get_shared_decks_connection(read_only=True)
    try:
        event = apply_direct_rule_event(
            kid_conn,
            shared_conn,
            family_id,
            payload.get('ruleId'),
            points_delta=payload.get('pointsDelta'),
            note=payload.get('note'),
        )
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    finally:
        shared_conn.close()
        kid_conn.close()
    return jsonify({'event': event}), 201


@points_bp.route('/kids/<kid_id>/points/events/<int:event_id>', methods=['DELETE'])
def delete_kid_point_event(kid_id, event_id):
    kid, _family_id, error = _kid_or_response(kid_id)
    if error:
        return error
    kid_conn = get_kid_connection_for(kid)
    try:
        deleted = delete_point_event(kid_conn, event_id)
    finally:
        kid_conn.close()
    if not deleted:
        return jsonify({'error': 'Point event not found'}), 404
    return jsonify({'deleted': True, 'eventId': int(event_id)}), 200


@points_bp.route('/kids/<kid_id>/points/events/<int:event_id>', methods=['PATCH'])
def patch_kid_point_event(kid_id, event_id):
    kid, _family_id, error = _kid_or_response(kid_id)
    if error:
        return error
    payload = request.get_json(silent=True) or {}
    kid_conn = get_kid_connection_for(kid)
    try:
        event = update_point_event(
            kid_conn,
            event_id,
            points_delta=payload.get('pointsDelta'),
            note=payload.get('note'),
        )
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    finally:
        kid_conn.close()
    if not event:
        return jsonify({'error': 'Point event not found'}), 404
    return jsonify({'event': event}), 200


@points_bp.route('/kids/<kid_id>/points/pull-today-sessions', methods=['POST'])
def pull_kid_point_events_from_today_sessions(kid_id):
    kid, family_id, error = _kid_or_response(kid_id)
    if error:
        return error
    kid_conn = get_kid_connection_for(kid)
    shared_conn = get_shared_decks_connection(read_only=True)
    try:
        result = pull_in_app_chore_events_for_today(kid_conn, shared_conn, family_id)
    finally:
        shared_conn.close()
        kid_conn.close()
    return jsonify({
        'kidId': str(kid.get('id') or ''),
        **result,
    }), 200


@points_bp.route('/kids/off-app-chores/pending-summary', methods=['GET'])
def get_off_app_chore_pending_summary():
    family_id, error = _family_id_or_response()
    if error:
        return error

    rows = []
    total_pending_count = 0
    for kid in metadata.get_all_kids(family_id=family_id):
        kid_id = str(kid.get('id') or '').strip()
        if not kid_id:
            continue
        kid_conn = None
        try:
            kid_conn = get_kid_connection_for(kid, read_only=True)
            pending_count = count_pending_off_app_chores(kid_conn)
        except Exception:
            pending_count = 0
        finally:
            if kid_conn is not None:
                kid_conn.close()
        rows.append({
            'kidId': kid_id,
            'pendingCount': pending_count,
        })
        total_pending_count += pending_count

    return jsonify({
        'kids': rows,
        'totalPendingCount': total_pending_count,
    }), 200


@points_bp.route('/kids/<kid_id>/off-app-chores', methods=['GET'])
def get_kid_off_app_chores(kid_id):
    kid, family_id, error = _kid_or_response(kid_id)
    if error:
        return error
    kid_conn = get_kid_connection_for(kid, read_only=True)
    shared_conn = get_shared_decks_connection(read_only=True)
    try:
        chores = list_enabled_off_app_chores(kid_conn, shared_conn, family_id)
        pending = list_pending_off_app_chores(kid_conn, shared_conn, family_id)
        pending_by_rule_id = {
            int(item.get('ruleId') or 0): item
            for item in pending
            if int(item.get('ruleId') or 0) > 0
        }
        rule_ids = [int(chore.get('ruleId') or 0) for chore in chores]
        credited_events_by_rule = list_latest_point_events_today_by_rule(
            kid_conn,
            family_id,
            rule_ids,
        )
        credited_rule_ids = set(credited_events_by_rule.keys())
        chores = [
            {
                **chore,
                'pending': pending_by_rule_id.get(int(chore.get('ruleId') or 0)),
                'creditedToday': int(chore.get('ruleId') or 0) in credited_rule_ids,
                'creditedEvent': credited_events_by_rule.get(int(chore.get('ruleId') or 0)),
            }
            for chore in chores
        ]
    finally:
        shared_conn.close()
        kid_conn.close()
    return jsonify({
        'kidId': str(kid.get('id') or ''),
        'chores': chores,
        'pending': pending,
    }), 200


@points_bp.route('/kids/<kid_id>/off-app-chores', methods=['PUT'])
def put_kid_off_app_chores(kid_id):
    kid, family_id, error = _kid_or_response(kid_id)
    if error:
        return error
    payload = request.get_json(silent=True) or {}
    kid_conn = get_kid_connection_for(kid)
    shared_conn = get_shared_decks_connection(read_only=True)
    try:
        chores = set_enabled_off_app_chores(
            kid_conn,
            shared_conn,
            family_id,
            payload.get('ruleIds') or [],
        )
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    finally:
        shared_conn.close()
        kid_conn.close()
    return jsonify({'chores': chores}), 200


@points_bp.route('/kids/<kid_id>/off-app-chores/<int:rule_id>/submit', methods=['POST'])
def post_kid_off_app_chore_submit(kid_id, rule_id):
    kid, family_id, error = _kid_or_response(kid_id)
    if error:
        return error
    kid_conn = get_kid_connection_for(kid)
    shared_conn = get_shared_decks_connection(read_only=True)
    try:
        pending = submit_off_app_chore(kid_conn, shared_conn, family_id, rule_id)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    finally:
        shared_conn.close()
        kid_conn.close()
    return jsonify({'pending': pending}), 201


@points_bp.route('/kids/<kid_id>/off-app-chores/pending/<int:pending_id>', methods=['DELETE'])
def delete_kid_off_app_chore_pending(kid_id, pending_id):
    kid, family_id, error = _kid_or_response(kid_id)
    if error:
        return error
    kid_conn = get_kid_connection_for(kid)
    shared_conn = get_shared_decks_connection(read_only=True)
    try:
        pending = cancel_pending_off_app_chore(
            kid_conn,
            shared_conn,
            family_id,
            pending_id,
        )
    except KeyError:
        return jsonify({'error': 'Pending off-app chore not found'}), 404
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    finally:
        shared_conn.close()
        kid_conn.close()
    return jsonify({'deleted': True, 'pending': pending}), 200


@points_bp.route('/kids/<kid_id>/off-app-chores/pending/<int:pending_id>/review', methods=['POST'])
def post_kid_off_app_chore_review(kid_id, pending_id):
    kid, family_id, error = _kid_or_response(kid_id)
    if error:
        return error
    payload = request.get_json(silent=True) or {}
    kid_conn = get_kid_connection_for(kid)
    shared_conn = get_shared_decks_connection(read_only=True)
    try:
        event = review_pending_off_app_chore(
            kid_conn,
            shared_conn,
            family_id,
            pending_id,
            payload.get('rating'),
            points_delta=payload.get('pointsDelta'),
            note=payload.get('note'),
        )
    except KeyError:
        return jsonify({'error': 'Pending off-app chore not found'}), 404
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    finally:
        shared_conn.close()
        kid_conn.close()
    return jsonify({'event': event}), 201
