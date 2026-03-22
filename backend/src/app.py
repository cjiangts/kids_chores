"""Main Flask application"""
from urllib.parse import quote
from flask import Flask, send_from_directory, request, redirect, session, jsonify, g
from flask_cors import CORS
import os
import secrets
import shutil
import time

from src.routes.kids import (
    kids_bp,
)
from src.badges.admin import (
    build_family_badge_art_payload,
    build_super_family_badge_art_payload,
    build_reward_tracking_status,
    clear_family_kid_badge_awards,
    replace_badge_art_assignments,
)
from src.routes.badges import badges_bp
from src.routes.backup import backup_bp
from src.db import metadata, kid_db
from src.db.shared_deck_db import init_shared_decks_database, get_shared_decks_connection
from src.startup_backfills import ensure_kid_db_schema
from src.security_rate_limit import (
    LOGIN_RATE_LIMITER,
    CRITICAL_PASSWORD_RATE_LIMITER,
    build_login_limit_key,
    build_critical_password_limit_key,
)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))
DATA_DIR = os.path.join(BACKEND_DIR, 'data')
FAMILIES_ROOT = os.path.join(DATA_DIR, 'families')


def create_app():
    app = Flask(__name__)
    CORS(app, origins=os.environ.get('CORS_ORIGINS', 'http://localhost:5001').split(','))
    app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY') or secrets.token_hex(32)
    app.config['SESSION_COOKIE_HTTPONLY'] = True
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
    raw_secure_cookie = str(os.environ.get('SESSION_COOKIE_SECURE') or '').strip().lower()
    if raw_secure_cookie in {'1', 'true', 'yes', 'on'}:
        session_cookie_secure = True
    elif raw_secure_cookie in {'0', 'false', 'no', 'off'}:
        session_cookie_secure = False
    else:
        # Secure by default on Railway/prod; local HTTP dev stays usable.
        session_cookie_secure = bool(os.environ.get('RAILWAY_ENVIRONMENT')) or os.environ.get('FLASK_ENV') == 'production'
    app.config['SESSION_COOKIE_SECURE'] = session_cookie_secure
    app.config['SLOW_REQUEST_LOG_THRESHOLD_MS'] = float(
        os.environ.get('SLOW_REQUEST_LOG_THRESHOLD_MS') or 800
    )
    # Shared user-created decks live in a single DB shared by all families.
    shared_deck_db_path = init_shared_decks_database()
    app.logger.info('Shared deck DB initialized at startup: path=%s', shared_deck_db_path)
    ensure_kid_db_schema(app.logger)

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

        limit_key = build_critical_password_limit_key(request, family_id=family_id)
        allowed, retry_after_seconds = CRITICAL_PASSWORD_RATE_LIMITER.check(limit_key)
        if not allowed:
            return {
                'error': 'Too many password confirmation attempts. Try again later.',
                'retryAfterSeconds': int(retry_after_seconds),
            }, 429
        if not metadata.verify_family_password(family_id, password):
            return {'error': 'Invalid password'}, 403
        CRITICAL_PASSWORD_RATE_LIMITER.reset(limit_key)
        return None

    @app.before_request
    def enforce_family_auth():
        g.request_started_at = time.perf_counter()
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

    @app.after_request
    def log_slow_requests(response):
        started_at = getattr(g, 'request_started_at', None)
        if started_at is None:
            return response
        duration_ms = (time.perf_counter() - started_at) * 1000.0
        threshold_ms = float(app.config.get('SLOW_REQUEST_LOG_THRESHOLD_MS') or 800)
        should_log = (
            duration_ms >= threshold_ms
            or response.status_code >= 500
            or request.path.startswith('/api/')
        )
        if should_log:
            log_method = app.logger.warning if duration_ms >= threshold_ms or response.status_code >= 500 else app.logger.info
            log_method(
                'request completed: method=%s path=%s status=%s duration_ms=%.1f remote=%s',
                request.method,
                request.full_path.rstrip('?'),
                response.status_code,
                duration_ms,
                request.headers.get('X-Forwarded-For', request.remote_addr),
            )
        return response

    # Register blueprints
    app.register_blueprint(kids_bp, url_prefix='/api')
    app.register_blueprint(badges_bp, url_prefix='/api')
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
        limit_key = build_login_limit_key(request, username=username)
        allowed, retry_after_seconds = LOGIN_RATE_LIMITER.check(limit_key)
        if not allowed:
            return {
                'error': 'Too many login attempts. Try again later.',
                'retryAfterSeconds': int(retry_after_seconds),
            }, 429
        family = metadata.authenticate_family(username, password)
        if not family:
            return {'error': 'Invalid username or password'}, 401
        LOGIN_RATE_LIMITER.reset(limit_key)

        session['family_id'] = str(family['id'])
        session['family_username'] = family['username']
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

    @app.route('/api/parent-settings/rewards/status', methods=['GET'])
    def get_parent_rewards_status():
        auth_err = require_family_auth()
        if auth_err:
            return auth_err
        family_id = str(session.get('family_id') or '')
        return build_reward_tracking_status(family_id), 200

    @app.route('/api/parent-settings/rewards/start', methods=['POST'])
    def start_parent_rewards_tracking():
        auth_err = require_critical_password()
        if auth_err:
            return auth_err

        family_id = str(session.get('family_id') or '')
        existing_started_at = metadata.get_family_badge_tracking_started_at(family_id)
        if existing_started_at:
            status = build_reward_tracking_status(family_id)
            status['updated'] = False
            return status, 200

        started_at = metadata.set_family_badge_tracking_started_at(family_id)
        status = build_reward_tracking_status(family_id)
        status['started'] = bool(started_at)
        status['startedAt'] = started_at or None
        status['updated'] = True
        return status, 200

    @app.route('/api/parent-settings/rewards/reset', methods=['POST'])
    def reset_parent_rewards_tracking():
        auth_err = require_critical_password()
        if auth_err:
            return auth_err

        family_id = str(session.get('family_id') or '')
        reset_result = clear_family_kid_badge_awards(family_id)
        metadata.clear_family_badge_tracking_started_at(family_id)
        status = build_reward_tracking_status(family_id)
        status['reset'] = True
        status.update(reset_result)
        return status, 200

    @app.route('/api/parent-settings/rewards/badge-art', methods=['GET'])
    def get_parent_rewards_badge_art():
        auth_err = require_family_auth()
        if auth_err:
            return auth_err
        family_id = str(session.get('family_id') or '')
        is_super_family = metadata.is_super_family(family_id)
        shared_conn = get_shared_decks_connection(read_only=True)
        try:
            if is_super_family:
                return build_super_family_badge_art_payload(shared_conn), 200
            return build_family_badge_art_payload(shared_conn), 200
        finally:
            shared_conn.close()

    @app.route('/api/parent-settings/rewards/badge-art/bulk', methods=['PUT'])
    def save_parent_rewards_badge_art():
        auth_err = require_super_family_auth()
        if auth_err:
            return auth_err

        payload = request.get_json() or {}
        assignments = payload.get('assignments')
        if not isinstance(assignments, list):
            return {'error': 'assignments must be a list'}, 400

        shared_conn = get_shared_decks_connection()
        try:
            result = replace_badge_art_assignments(shared_conn, assignments)
            response_payload = build_super_family_badge_art_payload(shared_conn)
            response_payload.update(result)
            return response_payload, 200
        except ValueError as exc:
            return {'error': str(exc)}, 400
        finally:
            shared_conn.close()

    @app.route('/api/parent-settings/families', methods=['GET'])
    def list_family_accounts():
        auth_err = require_super_family_auth()
        if auth_err:
            return auth_err

        current_family_id = str(session.get('family_id') or '')
        audio_extensions = {'.aac', '.flac', '.m4a', '.mp3', '.ogg', '.oga', '.opus', '.wav', '.webm'}

        def _safe_getsize(path):
            try:
                return int(os.path.getsize(path))
            except Exception:
                return 0

        def _scan_audio_stats(root_dir):
            stats = {
                'audioFileCount': 0,
                'audioTotalBytes': 0,
                'lessonReadingAudioFileCount': 0,
                'lessonReadingAudioTotalBytes': 0,
            }
            if not os.path.isdir(root_dir):
                return stats

            for current_root, _, names in os.walk(root_dir):
                for name in names:
                    ext = os.path.splitext(name)[1].lower()
                    if ext not in audio_extensions:
                        continue
                    abs_path = os.path.join(current_root, name)
                    size_bytes = _safe_getsize(abs_path)
                    rel_path = os.path.relpath(abs_path, root_dir).replace('\\', '/')
                    parts = [part for part in rel_path.split('/') if part]

                    stats['audioFileCount'] += 1
                    stats['audioTotalBytes'] += size_bytes
                    if len(parts) >= 1 and parts[0] == 'lesson_reading_audio':
                        stats['lessonReadingAudioFileCount'] += 1
                        stats['lessonReadingAudioTotalBytes'] += size_bytes
            return stats

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

        shared_deck_db_stats_path = str(shared_deck_db_path)
        shared_deck_db_bytes = _safe_getsize(shared_deck_db_stats_path) if os.path.exists(shared_deck_db_stats_path) else 0
        shared_audio_root = os.path.join(os.path.dirname(shared_deck_db_stats_path), 'shared', 'writing_audio')
        shared_audio_stats = _scan_audio_stats(shared_audio_root)

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
            family_root = os.path.join(FAMILIES_ROOT, f'family_{family_id}')
            family_audio_stats = _scan_audio_stats(family_root)
            kid_db_total_bytes = int(kid_db_total_bytes_by_family_id.get(family_id, 0))
            audio_total_bytes = int(family_audio_stats.get('audioTotalBytes', 0))
            families.append({
                'id': family_id,
                'username': str(family.get('username') or ''),
                'createdAt': family.get('createdAt'),
                'superFamily': is_super,
                'kidCount': int(kid_count_by_family_id.get(family_id, 0)),
                'kidDbFileCount': int(kid_db_file_count_by_family_id.get(family_id, 0)),
                'kidDbTotalBytes': kid_db_total_bytes,
                'audioFileCount': int(family_audio_stats.get('audioFileCount', 0)),
                'audioTotalBytes': audio_total_bytes,
                'lessonReadingAudioFileCount': int(family_audio_stats.get('lessonReadingAudioFileCount', 0)),
                'lessonReadingAudioTotalBytes': int(family_audio_stats.get('lessonReadingAudioTotalBytes', 0)),
                'familyStorageTotalBytes': kid_db_total_bytes + audio_total_bytes,
                'isCurrent': is_current,
                'canDelete': (not is_current) and (not is_super),
            })

        return {
            'families': families,
            'sharedStorage': {
                'sharedDeckDbBytes': int(shared_deck_db_bytes),
                'sharedWritingAudioFileCount': int(shared_audio_stats.get('audioFileCount', 0)),
                'sharedWritingAudioTotalBytes': int(shared_audio_stats.get('audioTotalBytes', 0)),
            }
        }, 200

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
    frontend_dir = os.path.join(PROJECT_ROOT, 'frontend')

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
