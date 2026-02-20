"""Main Flask application"""
from urllib.parse import quote
from flask import Flask, send_from_directory, request, redirect, session, jsonify
from flask_cors import CORS
import os
import secrets

from src.routes.kids import (
    kids_bp,
    seed_math_decks_for_all_kids,
    seed_lesson_reading_decks_for_all_kids,
    cleanup_incomplete_sessions_for_all_kids,
)
from src.routes.backup import backup_bp
from src.db import metadata
from src.db.shared_math_deck_db import init_shared_math_decks_database

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
    # Shared user-created math decks live in a single DB shared by all families.
    shared_math_db_path = init_shared_math_decks_database()
    app.logger.info('Shared math deck DB initialized at startup: path=%s', shared_math_db_path)
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
        return {'authenticated': bool(family_id), 'familyId': family_id, 'familyUsername': family_name}, 200

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
        return {'authenticated': True, 'familyId': family['id'], 'familyUsername': family['username']}, 201

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
        return {'authenticated': True, 'familyId': family['id'], 'familyUsername': family['username']}, 200

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

    @app.route('/health', methods=['GET'])
    def health():
        return {'status': 'healthy'}, 200

    # Serve frontend files
    frontend_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'frontend')

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
