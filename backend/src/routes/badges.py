"""Badge API routes."""
from flask import Blueprint, jsonify, request, session

from src.badges.service import (
    build_kid_badge_payload,
    build_kid_badge_summary_payload,
    build_kid_pending_celebrations_payload,
    mark_celebrations_seen,
)
from src.db import kid_db, metadata
from src.db.shared_deck_db import get_shared_decks_connection

badges_bp = Blueprint('badges', __name__)


def _current_family_id() -> str:
    return str(session.get('family_id') or '').strip()


def _get_kid_for_current_family(kid_id):
    family_id = _current_family_id()
    if not family_id:
        return None, {'error': 'Family login required'}, 401
    kid = metadata.get_kid_by_id(kid_id, family_id=family_id)
    if not kid:
        return None, {'error': 'Kid not found'}, 404
    return kid, None, None


def _build_response_payload(kid):
    family_id = str(kid.get('familyId') or '').strip()
    db_path = str(kid.get('dbFilePath') or '').strip()
    if not db_path:
        raise ValueError('Kid database path is missing')

    tracking_started_at = metadata.get_family_badge_tracking_started_at(family_id)
    family_timezone = metadata.get_family_timezone(family_id)
    kid_conn = kid_db.get_kid_connection_by_path(db_path, read_only=True)
    shared_conn = get_shared_decks_connection(read_only=True)
    try:
        payload = build_kid_badge_payload(
            kid_conn,
            shared_conn,
            family_timezone=family_timezone,
            tracking_started_at=tracking_started_at,
        )
    finally:
        shared_conn.close()
        kid_conn.close()
    return {
        'kidId': str(kid.get('id') or ''),
        'kidName': str(kid.get('name') or '').strip(),
        'familyBadgeTrackingStartedAt': tracking_started_at or None,
        **payload,
    }


def _build_summary_payload(kid):
    family_id = str(kid.get('familyId') or '').strip()
    db_path = str(kid.get('dbFilePath') or '').strip()
    if not db_path:
        raise ValueError('Kid database path is missing')

    tracking_started_at = metadata.get_family_badge_tracking_started_at(family_id)
    kid_conn = kid_db.get_kid_connection_by_path(db_path, read_only=True)
    try:
        payload = build_kid_badge_summary_payload(
            kid_conn,
            tracking_started_at=tracking_started_at,
        )
    finally:
        kid_conn.close()
    return {
        'kidId': str(kid.get('id') or ''),
        'kidName': str(kid.get('name') or '').strip(),
        'familyBadgeTrackingStartedAt': tracking_started_at or None,
        **payload,
    }


def _build_pending_celebrations_payload(kid):
    family_id = str(kid.get('familyId') or '').strip()
    db_path = str(kid.get('dbFilePath') or '').strip()
    if not db_path:
        raise ValueError('Kid database path is missing')

    tracking_started_at = metadata.get_family_badge_tracking_started_at(family_id)
    kid_conn = kid_db.get_kid_connection_by_path(db_path, read_only=True)
    shared_conn = None
    try:
        summary_payload = build_kid_badge_summary_payload(
            kid_conn,
            tracking_started_at=tracking_started_at,
        )
        pending_count = int((summary_payload.get('summary') or {}).get('pendingCelebrationCount', 0))
        if pending_count > 0 and bool(summary_payload.get('trackingEnabled')):
            shared_conn = get_shared_decks_connection(read_only=True)
            payload = build_kid_pending_celebrations_payload(
                kid_conn,
                shared_conn,
                tracking_started_at=tracking_started_at,
                summary_payload=summary_payload,
            )
        else:
            payload = {
                **summary_payload,
                'pendingCelebrations': [],
            }
    finally:
        if shared_conn is not None:
            shared_conn.close()
        kid_conn.close()
    return {
        'kidId': str(kid.get('id') or ''),
        'kidName': str(kid.get('name') or '').strip(),
        'familyBadgeTrackingStartedAt': tracking_started_at or None,
        **payload,
    }


@badges_bp.route('/kids/<kid_id>/badges', methods=['GET'])
def get_kid_badges(kid_id):
    try:
        kid, error_payload, status_code = _get_kid_for_current_family(kid_id)
        if error_payload:
            return jsonify(error_payload), status_code
        return jsonify(_build_response_payload(kid)), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


@badges_bp.route('/kids/<kid_id>/badges/summary', methods=['GET'])
def get_kid_badges_summary(kid_id):
    try:
        kid, error_payload, status_code = _get_kid_for_current_family(kid_id)
        if error_payload:
            return jsonify(error_payload), status_code
        return jsonify(_build_summary_payload(kid)), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


@badges_bp.route('/kids/<kid_id>/badges/celebrations/pending', methods=['GET'])
def get_kid_badge_pending_celebrations(kid_id):
    try:
        kid, error_payload, status_code = _get_kid_for_current_family(kid_id)
        if error_payload:
            return jsonify(error_payload), status_code
        payload = _build_pending_celebrations_payload(kid)
        return jsonify({
            'kidId': payload.get('kidId'),
            'kidName': payload.get('kidName'),
            'trackingEnabled': bool(payload.get('trackingEnabled')),
            'trackingStartedAt': payload.get('trackingStartedAt'),
            'pendingCelebrations': payload.get('pendingCelebrations', []),
            'pendingCelebrationCount': int(payload.get('summary', {}).get('pendingCelebrationCount', 0)),
        }), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


@badges_bp.route('/kids/<kid_id>/badges/celebrations/seen', methods=['POST'])
def mark_kid_badge_celebrations_seen(kid_id):
    try:
        kid, error_payload, status_code = _get_kid_for_current_family(kid_id)
        if error_payload:
            return jsonify(error_payload), status_code

        data = request.get_json(silent=True) or {}
        raw_ids = data.get('awardIds')
        if raw_ids is None:
            raw_ids = data.get('award_ids')
        if raw_ids is None:
            award_ids = []
        elif isinstance(raw_ids, list):
            award_ids = raw_ids
        else:
            return jsonify({'error': 'awardIds must be a list'}), 400

        db_path = str(kid.get('dbFilePath') or '').strip()
        if not db_path:
            raise ValueError('Kid database path is missing')
        conn = kid_db.get_kid_connection_by_path(db_path)
        try:
            updated_count = mark_celebrations_seen(conn, award_ids=award_ids)
        finally:
            conn.close()

        return jsonify({
            'updatedCount': int(updated_count),
        }), 200
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500
