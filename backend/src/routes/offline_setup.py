"""Family-scoped offline preparation and package lifecycle endpoints."""
import json
import re
from flask import Blueprint, jsonify, request
from src.services.offline import repository, lifecycle, reconcile, planning
from src.db import metadata
from src.services.family_auth import current_family_id, get_kid_for_family, require_critical_password
from src.services.offline_setup import MIN_DAYS, MAX_DAYS, save_setup
from src.services.kid_avatar import avatar_url_for_kid

offline_setup_bp = Blueprint('offline_setup', __name__)


@offline_setup_bp.get('/offline/setup')
def get_setup_options():
    family_id = current_family_id()
    if not family_id:
        return jsonify({'error': 'Family login required'}), 401
    kids = metadata.get_all_kids(family_id=family_id)
    options = [{'id': str(kid['id']), 'name': kid['name'], 'avatarUrl': avatar_url_for_kid(kid),
                 'offlineMode': repository.current(kid)} for kid in kids]
    return jsonify({'kids': options, 'defaultDays': 7, 'minDays': MIN_DAYS, 'maxDays': MAX_DAYS})


@offline_setup_bp.post('/offline/setup')
def create_setup():
    payload = request.get_json(silent=True) or {}
    kid = get_kid_for_family(payload.get('kidId'))
    if not kid:
        return jsonify({'error': 'Kid not found'}), 404
    try:
        device_id = payload.get('deviceId')
        # Reuse the existing verifier for local parent entry; preparation needs no password prompt.
        family = metadata.get_family_by_id(current_family_id())
        method, salt, digest = family['password'].split('$', 2)
        algorithm, hash_name, iterations = method.split(':')
        if algorithm != 'pbkdf2' or hash_name != 'sha256':
            raise ValueError('This family password format does not support offline parent entry')
        parent_auth = {'salt': salt.encode().hex(), 'iterations': int(iterations), 'hash': digest}
        with lifecycle.LOCK:
            for other in metadata.get_all_kids(family_id=current_family_id()):
                active = repository.current(other)
                if active and active['deviceId'] == device_id:
                    raise ValueError('This device already has a child in offline mode')
            setup = save_setup(kid, payload.get('days'), device_id)
            return jsonify(lifecycle.prepare(kid, setup['id'], device_id, parent_auth)), 200
    except ValueError as exc:
        return jsonify({'error': str(exc), 'blockers': getattr(exc, 'blockers', [])}), 400


def _package(operation):
    kid = get_kid_for_family(request.args.get('kidId') or (request.get_json(silent=True) or {}).get('kidId') or request.form.get('kidId'))
    if not kid:
        return jsonify({'error': 'Kid not found'}), 404
    try:
        return jsonify(operation(kid)), 200
    except LookupError as exc:
        return jsonify({'error': f"{kid['name']}’s offline package has been deleted from the server. It can no longer be uploaded. Local results have been kept on this device.",
                        'code': 'offline_package_deleted'}), 410
    except ValueError as exc:
        return jsonify({'error': str(exc), 'blockers': getattr(exc, 'blockers', [])}), 400


@offline_setup_bp.post('/offline/packages/<package_id>/activate')
def activate_package(package_id):
    return _package(lambda kid: lifecycle.activate(kid, package_id, request.headers.get('X-Offline-Device') or '',
                                                    (request.get_json(silent=True) or {}).get('handoff')))


@offline_setup_bp.get('/offline/packages/<package_id>')
def package_status(package_id):
    def operation(kid):
        from src.services.family_auth import get_kid_connection_for
        conn = get_kid_connection_for(kid)
        try:
            package = repository.load(conn, package_id, request.headers.get('X-Offline-Device') or '')
            return {'id': package['id'], 'status': package['status'], 'assets': lifecycle.assets(),
                    'practiceConfig': planning.practice_config(conn, kid)}
        finally:
            conn.close()
    return _package(operation)


@offline_setup_bp.post('/offline/packages/<package_id>/cancel')
def cancel_package(package_id):
    def operation(kid):
        from src.services.family_auth import get_kid_connection_for
        with lifecycle.LOCK:
            conn = get_kid_connection_for(kid)
            try:
                exists = conn.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_name='offline_packages'").fetchone()[0]
                if not exists or not conn.execute('SELECT id FROM offline_packages WHERE id=?', [package_id]).fetchone():
                    return {'cancelled': True}
                package = repository.load(conn, package_id, request.headers.get('X-Offline-Device') or '')
                if package['status'] != 'preparing':
                    raise ValueError('An active package must be uploaded and ended, not cancelled')
                conn.execute('DELETE FROM offline_packages WHERE id=?', [package_id])
                return {'cancelled': True}
            finally:
                conn.close()
    return _package(operation)


@offline_setup_bp.post('/offline/packages/<package_id>/upload')
def upload_package(package_id):
    error = require_critical_password()
    if error:
        return error
    def operation(kid):
        from src.services.family_auth import get_kid_connection_for
        from src.db.shared_deck_db import get_shared_decks_connection
        if 'manifest' not in request.form or 'records' not in request.form:
            raise ValueError(f"The server did not receive {kid['name']}’s task plan or results in the upload form. "
                             f"Upload format: {request.mimetype or 'missing'}; "
                             f"boundary: {'present' if request.mimetype_params.get('boundary') else 'missing'}; "
                             f"received fields: {', '.join(list(request.form.keys())[:5]) or 'none'}; "
                             f"received files: {len(request.files)}. "
                             "Local results have been kept.")
        manifest = json.loads(request.form['manifest'])
        records = json.loads(request.form['records'])
        conn = get_kid_connection_for(kid)
        shared = None
        try:
            shared = get_shared_decks_connection(read_only=True)
            with lifecycle.LOCK:
                return reconcile.upload(conn, shared, kid, package_id, request.headers.get('X-Offline-Device') or '',
                                        manifest, records, request.files)
        finally:
            try:
                if shared is not None:
                    shared.close()
            finally:
                conn.close()
    return _package(operation)


@offline_setup_bp.post('/offline/packages/<package_id>/delete')
def delete_package(package_id):
    error = require_critical_password()
    if error:
        return error
    def operation(kid):
        from src.services.family_auth import get_kid_connection_for
        with lifecycle.LOCK:
            conn = get_kid_connection_for(kid)
            try:
                row = conn.execute('SELECT id FROM offline_packages WHERE id=?', [package_id]).fetchone()
                if row:
                    repository.load(conn, package_id, request.headers.get('X-Offline-Device') or '')
                    conn.execute('DELETE FROM offline_packages WHERE id=?', [package_id])
                return {'deleted': True}
            finally:
                conn.close()
    return _package(operation)


@offline_setup_bp.post('/offline/packages/<package_id>/force-delete')
def force_delete_package(package_id):
    error = require_critical_password()
    if error:
        return error
    def operation(kid):
        from src.services.family_auth import get_kid_connection_for
        with lifecycle.LOCK:
            conn = get_kid_connection_for(kid)
            try:
                conn.execute('DELETE FROM offline_packages WHERE id=? AND completed_at IS NULL', [package_id])
                return {'deleted': True}
            finally:
                conn.close()
    return _package(operation)


@offline_setup_bp.before_app_request
def protect_offline_child():
    match = re.match(r'^/api/kids/([^/]+)(?:/|$)', request.path)
    if not match:
        return None
    if request.method == 'GET' and request.path == f'/api/kids/{match[1]}/avatar':
        return None
    kid = get_kid_for_family(match[1])
    if not kid:
        return None
    active = repository.current(kid)
    if not active:
        return None
    # Resource fetches during package installation are read-only and device-bound.
    if (request.method == 'GET' and request.headers.get('X-Offline-Package') == active['id']
            and request.headers.get('X-Offline-Device') == active['deviceId']):
        return None
    return jsonify({'error': f"{kid['name']} is using an offline package. Use the device prepared for {kid['name']}.",
                    'offlineMode': {'active': True, 'status': active['status']}}), 409
