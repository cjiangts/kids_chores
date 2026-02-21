"""Main Flask application"""
from urllib.parse import quote
from flask import Flask, send_from_directory, request, redirect, session, jsonify
from flask_cors import CORS
import os
import secrets
import shutil

from src.routes.kids import (
    kids_bp,
    seed_math_decks_for_all_kids,
    seed_lesson_reading_decks_for_all_kids,
    cleanup_incomplete_sessions_for_all_kids,
)
from src.routes.backup import backup_bp
from src.db import metadata, kid_db
from src.db.shared_deck_db import init_shared_decks_database, get_shared_decks_connection

BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
DATA_DIR = os.path.join(BACKEND_ROOT, 'data')
FAMILIES_ROOT = os.path.join(DATA_DIR, 'families')


def create_app():
    app = Flask(__name__)
    CORS(app, origins=os.environ.get('CORS_ORIGINS', 'http://localhost:5001').split(','))
    app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY') or secrets.token_hex(32)
    app.config['SESSION_COOKIE_HTTPONLY'] = True
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
    app.config['SESSION_COOKIE_SECURE'] = os.environ.get('FLASK_ENV') == 'production'
    MIN_HARD_PCT = 0
    MAX_HARD_PCT = 100
    # KEEP: Safe metadata cleanup and normalization on every startup.
    cleanup_result = metadata.cleanup_deprecated_metadata_config()
    app.logger.info(
        'Metadata cleanup at startup: updated=%s, removedTopLevelKeys=%s, removedFamilyKeys=%s, removedKidKeys=%s',
        cleanup_result.get('updated'),
        cleanup_result.get('removedTopLevelKeys', 0),
        cleanup_result.get('removedFamilyKeys', 0),
        cleanup_result.get('removedKidKeys', 0),
    )
    # Shared user-created decks live in a single DB shared by all families.
    shared_deck_db_path = init_shared_decks_database()
    app.logger.info('Shared deck DB initialized at startup: path=%s', shared_deck_db_path)
    # KEEP: Ensures fixed preset math decks exist for all kids.
    math_seed_result = seed_math_decks_for_all_kids()
    app.logger.info(
        'Math preset init at startup: seededKids=%s, failedKids=%s, insertedCards=%s',
        math_seed_result.get('seededKids', 0),
        math_seed_result.get('failedKids', 0),
        math_seed_result.get('insertedCards', 0),
    )
    # KEEP: Ensures fixed preset Chinese Reading decks exist for all kids.
    lesson_seed_result = seed_lesson_reading_decks_for_all_kids()
    app.logger.info(
        'Lesson-reading preset init at startup: seededKids=%s, failedKids=%s, insertedCards=%s',
        lesson_seed_result.get('seededKids', 0),
        lesson_seed_result.get('failedKids', 0),
        lesson_seed_result.get('insertedCards', 0),
    )
    # KEEP: Removes incomplete sessions that should never persist.
    incomplete_cleanup = cleanup_incomplete_sessions_for_all_kids()
    app.logger.info(
        'Incomplete session cleanup at startup: cleanedKids=%s, failedKids=%s, deletedSessions=%s, deletedResults=%s, deletedLessonReadingAudio=%s',
        incomplete_cleanup.get('cleanedKids', 0),
        incomplete_cleanup.get('failedKids', 0),
        incomplete_cleanup.get('deletedSessions', 0),
        incomplete_cleanup.get('deletedResults', 0),
        incomplete_cleanup.get('deletedLessonReadingAudio', 0),
    )

    def is_family_authenticated():
        return bool(session.get('family_id'))

    def require_family_auth():
        if not is_family_authenticated():
            return {'error': 'Family login required'}, 401
        return None

    def require_super_family_auth():
        auth_err = require_family_auth()
        if auth_err:
            return auth_err
        family_id = str(session.get('family_id') or '')
        if not metadata.is_super_family(family_id):
            return {'error': 'Super family access required'}, 403
        return None

    def require_critical_password():
        auth_err = require_family_auth()
        if auth_err:
            return auth_err
        family_id = str(session.get('family_id') or '')
        password = str(request.headers.get('X-Confirm-Password') or '')
        if not password:
            password = str(request.form.get('confirmPassword') or '')
        if not password:
            json_data = request.get_json(silent=True)
            if isinstance(json_data, dict):
                password = str(json_data.get('confirmPassword') or '')
        if not password:
            return {'error': 'Password confirmation required'}, 400
        if not metadata.verify_family_password(family_id, password):
            return {'error': 'Invalid password'}, 403
        return None

    @app.before_request
    def enforce_family_auth():
        path = request.path
        if path == '/health':
            return None

        if path.startswith('/api/family-auth/'):
            return None

        public_frontend_paths = {'/', '/index.html', '/family-login.html', '/family-register.html'}
        public_assets = (
            path.endswith('.css')
            or path.endswith('.js')
            or path.endswith('.png')
            or path.endswith('.jpg')
            or path.endswith('.jpeg')
            or path.endswith('.svg')
            or path.endswith('.ico')
            or path.startswith('/fonts/')
        )

        if not is_family_authenticated():
            if path.startswith('/api/'):
                return jsonify({'error': 'Family login required'}), 401
            if path in public_frontend_paths or public_assets:
                return None
            next_path = request.full_path if request.query_string else request.path
            if next_path.endswith('?'):
                next_path = next_path[:-1]
            return redirect(f"/family-login.html?next={quote(next_path)}")

        return None

    # Register blueprints
    app.register_blueprint(kids_bp, url_prefix='/api')
    app.register_blueprint(backup_bp, url_prefix='/api')

    @app.route('/api/family-auth/status', methods=['GET'])
    def family_auth_status():
        family_id = session.get('family_id')
        family_name = session.get('family_username')
        is_super_family = metadata.is_super_family(str(family_id)) if family_id else False
        return {
            'authenticated': bool(family_id),
            'familyId': family_id,
            'familyUsername': family_name,
            'isSuperFamily': bool(is_super_family),
        }, 200

    @app.route('/api/family-auth/register', methods=['POST'])
    def family_auth_register():
        payload = request.get_json() or {}
        username = str(payload.get('username') or '').strip()
        password = str(payload.get('password') or '')
        try:
            family = metadata.register_family(username, password)
        except ValueError as e:
            return {'error': str(e)}, 400

        session['family_id'] = str(family['id'])
        session['family_username'] = family['username']
        session.pop('parent_authenticated', None)
        return {
            'authenticated': True,
            'familyId': family['id'],
            'familyUsername': family['username'],
            'isSuperFamily': bool(family.get('superFamily')),
        }, 201

    @app.route('/api/family-auth/login', methods=['POST'])
    def family_auth_login():
        payload = request.get_json() or {}
        username = str(payload.get('username') or '').strip()
        password = str(payload.get('password') or '')
        family = metadata.authenticate_family(username, password)
        if not family:
            return {'error': 'Invalid username or password'}, 401

        session['family_id'] = str(family['id'])
        session['family_username'] = family['username']
        session.pop('parent_authenticated', None)
        return {
            'authenticated': True,
            'familyId': family['id'],
            'familyUsername': family['username'],
            'isSuperFamily': bool(family.get('superFamily')),
        }, 200

    @app.route('/api/family-auth/logout', methods=['POST'])
    def family_auth_logout():
        session.pop('family_id', None)
        session.pop('family_username', None)
        session.pop('parent_authenticated', None)
        return {'authenticated': False}, 200

    @app.route('/api/parent-auth/status', methods=['GET'])
    def parent_auth_status():
        if not is_family_authenticated():
            return {'authenticated': False}, 200
        return {'authenticated': True}, 200

    @app.route('/api/parent-auth/login', methods=['POST'])
    def parent_auth_login():
        if not is_family_authenticated():
            return {'error': 'Family login required'}, 401
        return {'authenticated': True}, 200

    @app.route('/api/parent-auth/logout', methods=['POST'])
    def parent_auth_logout():
        return {'authenticated': False}, 200

    @app.route('/api/parent-auth/change-password', methods=['POST'])
    def parent_auth_change_password():
        auth_err = require_family_auth()
        if auth_err:
            return auth_err

        payload = request.get_json() or {}
        current_password = str(payload.get('currentPassword') or '')
        new_password = str(payload.get('newPassword') or '')
        if not current_password or not new_password:
            return {'error': 'Current password and new password are required'}, 400

        family_id = str(session.get('family_id') or '')
        if not metadata.update_family_password(family_id, current_password, new_password):
            return {'error': 'Current password is incorrect'}, 400

        return {'success': True}, 200

    @app.route('/api/parent-settings/hard-card-percentage', methods=['GET'])
    def get_parent_hard_card_percentage():
        auth_err = require_family_auth()
        if auth_err:
            return auth_err
        family_id = str(session.get('family_id') or '')
        return {
            'hardCardPercentage': metadata.get_family_hard_card_percentage(family_id)
        }, 200

    @app.route('/api/parent-settings/hard-card-percentage', methods=['PUT'])
    def update_parent_hard_card_percentage():
        auth_err = require_family_auth()
        if auth_err:
            return auth_err

        payload = request.get_json() or {}
        try:
            hard_pct = int(payload.get('hardCardPercentage'))
        except (TypeError, ValueError):
            return {'error': 'hardCardPercentage must be an integer'}, 400

        if hard_pct < MIN_HARD_PCT or hard_pct > MAX_HARD_PCT:
            return {'error': f'hardCardPercentage must be between {MIN_HARD_PCT} and {MAX_HARD_PCT}'}, 400

        family_id = str(session.get('family_id') or '')
        if not metadata.update_family_hard_card_percentage(family_id, hard_pct):
            return {'error': 'Failed to update hard-card setting'}, 400

        return {'hardCardPercentage': hard_pct, 'updated': True}, 200

    @app.route('/api/parent-settings/timezone', methods=['GET'])
    def get_parent_timezone():
        auth_err = require_family_auth()
        if auth_err:
            return auth_err
        family_id = str(session.get('family_id') or '')
        return {
            'familyTimezone': metadata.get_family_timezone(family_id)
        }, 200

    @app.route('/api/parent-settings/timezone', methods=['PUT'])
    def update_parent_timezone():
        auth_err = require_family_auth()
        if auth_err:
            return auth_err

        payload = request.get_json() or {}
        timezone_name = str(payload.get('familyTimezone') or '').strip()
        if not timezone_name:
            return {'error': 'familyTimezone is required'}, 400

        family_id = str(session.get('family_id') or '')
        if not metadata.update_family_timezone(family_id, timezone_name):
            return {'error': 'Failed to update family timezone'}, 400

        return {
            'familyTimezone': metadata.get_family_timezone(family_id),
            'updated': True
        }, 200

    @app.route('/api/parent-settings/families', methods=['GET'])
    def list_family_accounts():
        auth_err = require_super_family_auth()
        if auth_err:
            return auth_err

        current_family_id = str(session.get('family_id') or '')
        kids = metadata.get_all_kids()
        kid_count_by_family_id = {}
        kid_db_file_count_by_family_id = {}
        kid_db_total_bytes_by_family_id = {}
        for kid in kids:
            family_id = str(kid.get('familyId') or '')
            if not family_id:
                continue
            kid_count_by_family_id[family_id] = int(kid_count_by_family_id.get(family_id, 0)) + 1
            db_file_path = str(kid.get('dbFilePath') or '').strip()
            if not db_file_path:
                continue
            try:
                db_abs_path = kid_db.get_absolute_db_path(db_file_path)
            except Exception:
                continue
            if not os.path.exists(db_abs_path):
                continue
            try:
                size_bytes = int(os.path.getsize(db_abs_path))
            except Exception:
                continue
            kid_db_file_count_by_family_id[family_id] = int(kid_db_file_count_by_family_id.get(family_id, 0)) + 1
            kid_db_total_bytes_by_family_id[family_id] = int(kid_db_total_bytes_by_family_id.get(family_id, 0)) + size_bytes

        def _sort_key(family):
            try:
                return int(family.get('id'))
            except (TypeError, ValueError):
                return 10**9

        families = []
        for family in sorted(metadata.get_all_families(), key=_sort_key):
            family_id = str(family.get('id') or '')
            is_super = bool(family.get('superFamily'))
            is_current = family_id == current_family_id
            families.append({
                'id': family_id,
                'username': str(family.get('username') or ''),
                'createdAt': family.get('createdAt'),
                'superFamily': is_super,
                'kidCount': int(kid_count_by_family_id.get(family_id, 0)),
                'kidDbFileCount': int(kid_db_file_count_by_family_id.get(family_id, 0)),
                'kidDbTotalBytes': int(kid_db_total_bytes_by_family_id.get(family_id, 0)),
                'kidDbTotalMb': round(int(kid_db_total_bytes_by_family_id.get(family_id, 0)) / (1024 * 1024), 2),
                'isCurrent': is_current,
                'canDelete': (not is_current) and (not is_super),
            })

        return {'families': families}, 200

    @app.route('/api/parent-settings/families/<family_id>', methods=['DELETE'])
    def delete_family_account(family_id):
        auth_err = require_super_family_auth()
        if auth_err:
            return auth_err

        target_family_id = str(family_id or '').strip()
        if not target_family_id:
            return {'error': 'family_id is required'}, 400

        current_family_id = str(session.get('family_id') or '')
        if target_family_id == current_family_id:
            return {'error': 'Cannot delete current logged-in family'}, 400

        target_family = metadata.get_family_by_id(target_family_id)
        if not target_family:
            return {'error': 'Family not found'}, 404
        if bool(target_family.get('superFamily')):
            return {'error': 'Cannot delete a super family account'}, 403

        password_err = require_critical_password()
        if password_err:
            return password_err

        deleted_shared_decks = 0
        try:
            target_family_id_int = int(target_family_id)
            shared_conn = get_shared_decks_connection()
            try:
                shared_rows = shared_conn.execute(
                    "SELECT deck_id FROM deck WHERE creator_family_id = ?",
                    [target_family_id_int]
                ).fetchall()
                shared_deck_ids = [int(row[0]) for row in shared_rows]
                if shared_deck_ids:
                    placeholders = ','.join(['?'] * len(shared_deck_ids))
                    shared_conn.execute(
                        f"DELETE FROM cards WHERE deck_id IN ({placeholders})",
                        shared_deck_ids
                    )
                    shared_conn.execute(
                        f"DELETE FROM deck WHERE deck_id IN ({placeholders})",
                        shared_deck_ids
                    )
                deleted_shared_decks = len(shared_deck_ids)
            finally:
                shared_conn.close()
        except ValueError:
            deleted_shared_decks = 0

        delete_result = metadata.delete_family(target_family_id)
        if not delete_result.get('deleted'):
            return {'error': 'Family not found'}, 404

        deleted_kids = list(delete_result.get('kids') or [])
        for kid in deleted_kids:
            db_path = str(kid.get('dbFilePath') or '').strip()
            if db_path:
                try:
                    kid_db.delete_kid_database_by_path(db_path)
                except Exception:
                    pass

        family_root = os.path.join(FAMILIES_ROOT, f'family_{target_family_id}')
        if os.path.exists(family_root):
            shutil.rmtree(family_root, ignore_errors=True)

        return {
            'deleted': True,
            'family_id': target_family_id,
            'deleted_kids': len(deleted_kids),
            'deleted_shared_decks': int(deleted_shared_decks),
        }, 200

    @app.route('/health', methods=['GET'])
    def health():
        return {'status': 'healthy'}, 200

    # Serve frontend files
    frontend_dir = os.path.join(BACKEND_ROOT, 'frontend')

    @app.route('/')
    def index():
        if is_family_authenticated():
            return send_from_directory(frontend_dir, 'family-home.html')
        return send_from_directory(frontend_dir, 'index.html')

    @app.route('/<path:path>')
    def serve_frontend(path):
        if os.path.exists(os.path.join(frontend_dir, path)):
            return send_from_directory(frontend_dir, path)
        return send_from_directory(frontend_dir, 'index.html')

    return app

if __name__ == '__main__':
    app = create_app()

    # Get port from environment variable (Railway sets PORT)
    port = int(os.environ.get('PORT', 5001))

    # Disable debug in production
    debug = os.environ.get('FLASK_ENV') != 'production'

    app.run(debug=debug, host='0.0.0.0', port=port)
