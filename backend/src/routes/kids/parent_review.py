from flask import jsonify, request

from src.routes.kids import kids_bp
from src.services.family_auth import get_kid_for_family, get_kid_connection_for
from src.services.kid_category_resolve import resolve_kid_type_ii_category_with_mode
from src.services.parent_review import PARENT_REVIEW_LOCK, get_review_setting, save_review_setting, save_session_review


def _run(kid_id, operation):
    kid = get_kid_for_family(kid_id)
    if not kid:
        return jsonify({'error': 'Kid not found'}), 404
    try:
        with PARENT_REVIEW_LOCK:
            conn = get_kid_connection_for(kid)
            try:
                return jsonify(operation(conn, kid))
            finally:
                conn.close()
    except LookupError as exc:
        return jsonify({'error': str(exc)}), 404
    except (TypeError, ValueError) as exc:
        return jsonify({'error': str(exc)}), 400


@kids_bp.route('/kids/<kid_id>/type2/review-mode', methods=['GET', 'PUT'])
def type2_review_mode(kid_id):
    payload = request.get_json(silent=True) or {}
    def operation(conn, kid):
        key, _ = resolve_kid_type_ii_category_with_mode(kid, payload.get('categoryKey') or request.args.get('categoryKey'), require_opt_in=False)
        if request.method == 'PUT':
            return save_review_setting(conn, key, payload.get('parent_review_required'))
        return get_review_setting(conn, key)
    return _run(kid_id, operation)


@kids_bp.route('/kids/<kid_id>/report/sessions/<int:session_id>/parent-review', methods=['PUT'])
def review_type2_session(kid_id, session_id):
    payload = request.get_json(silent=True) or {}
    def operation(conn, kid):
        reviewed = save_session_review(conn, session_id, payload.get('grades'))
        from src.routes.kids.practice import _auto_award_in_app_chore_points
        _auto_award_in_app_chore_points(kid, reviewed['category_key'], reviewed['completed_at'])
        return {'session_id': session_id, 'reviewed': True}
    return _run(kid_id, operation)
