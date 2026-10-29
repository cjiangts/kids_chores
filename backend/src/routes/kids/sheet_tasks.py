from flask import jsonify, request

from src.routes.kids import kids_bp
from src.db.shared_deck_db import get_shared_decks_connection
from src.services.family_auth import get_kid_for_family, get_kid_connection_for
from src.services import sheet_tasks
from src.services.shared_deck_normalize import normalize_shared_deck_tag


def _run(kid_id, operation):
    kid = get_kid_for_family(kid_id)
    if not kid:
        return jsonify({'error': 'Kid not found'}), 404
    try:
        with sheet_tasks.SHEET_TASK_LOCK:
            conn = get_kid_connection_for(kid)
            try:
                return jsonify(operation(conn, kid))
            finally:
                conn.close()
    except LookupError as exc:
        return jsonify({'error': str(exc)}), 404
    except (ValueError, TypeError) as exc:
        return jsonify({'error': str(exc)}), 400


@kids_bp.route('/kids/<kid_id>/sheet-tasks', methods=['GET'])
def sheet_task_current(kid_id):
    category = normalize_shared_deck_tag(request.args.get('categoryKey'))
    def operation(conn, kid):
        if not category:
            raise ValueError('categoryKey is required')
        return sheet_tasks.sheet_summary(conn, kid, category)
    return _run(kid_id, operation)


@kids_bp.route('/kids/<kid_id>/sheet-tasks/mode', methods=['PUT'])
def sheet_task_mode(kid_id):
    payload = request.get_json(silent=True) or {}
    category = normalize_shared_deck_tag(payload.get('categoryKey'))
    def operation(conn, kid):
        sheet_tasks.set_delivery_mode(conn, kid, category, payload.get('mode'))
        return sheet_tasks.sheet_summary(conn, kid, category)
    return _run(kid_id, operation)


@kids_bp.route('/kids/<kid_id>/sheet-tasks/<int:session_id>', methods=['GET'])
def sheet_task_detail(kid_id, session_id):
    return _run(kid_id, lambda conn, kid: sheet_tasks.get_sheet_task(conn, session_id))


@kids_bp.route('/kids/<kid_id>/sheet-tasks/preview', methods=['GET'])
def sheet_task_preview(kid_id):
    category = normalize_shared_deck_tag(request.args.get('categoryKey'))
    return _run(kid_id, lambda conn, kid: sheet_tasks.preview_sheet_task(conn, kid, category))


@kids_bp.route('/kids/<kid_id>/sheet-tasks/submit', methods=['POST'])
def sheet_task_submit(kid_id):
    payload = request.get_json(silent=True) or {}
    category = normalize_shared_deck_tag(payload.get('categoryKey'))
    return _run(kid_id, lambda conn, kid: sheet_tasks.submit_sheet_task(conn, kid, category, payload.get('items')))


@kids_bp.route('/kids/<kid_id>/sheet-tasks/<int:session_id>/undo', methods=['POST'])
def sheet_task_undo(kid_id, session_id):
    return _run(kid_id, lambda conn, kid: sheet_tasks.undo_sheet_task(conn, kid, session_id))


@kids_bp.route('/kids/<kid_id>/sheet-tasks/<int:session_id>/review', methods=['PUT'])
def sheet_task_review(kid_id, session_id):
    payload = request.get_json(silent=True) or {}
    def operation(conn, kid):
        shared_conn = get_shared_decks_connection(read_only=True)
        try:
            return sheet_tasks.review_sheet_task(conn, shared_conn, kid, session_id, payload.get('grades'))
        finally:
            shared_conn.close()
    return _run(kid_id, operation)
