"""Main Flask application.

Single `create_app()` factory wires the auth helpers, request hooks, and
top-level routes that don't live in a blueprint. Routes that belong to a
specific domain live in their blueprint (kids_bp, backup_bp);
what stays here is family auth + parent settings + super-family admin.

Layout inside `create_app()` (search for `# === N. ` banner markers):

    1. App config + auth helper closures
    2. Request lifecycle hooks (before_request, after_request)
    3. Blueprint registration
    4. Family-auth routes (status/register/login/logout/confirm-password/trusted browsers)
    5. Parent-auth + parent-settings (password, timezone)
    6. Super-family admin (list/delete families)
    7. Health + static frontend serving
"""
from datetime import timedelta
from urllib.parse import quote, parse_qsl, urlencode, urlsplit, urlunsplit
from flask import Flask, send_from_directory, request, redirect, session, jsonify, g
from flask_cors import CORS
import hashlib
import json
import os
import re
import shutil
import time

from src.routes.kids import (
    kids_bp,
)
from src.routes.backup import backup_bp
from src.routes.points import points_bp
from src.db import metadata, kid_db
from src.db.shared_deck_db import init_shared_decks_database, get_shared_decks_connection, rebuild_shared_decks_database
from src.startup_backfills import ensure_kid_db_schema
from src.audio_cleanup import start_kid_audio_cleanup_scheduler
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
SESSION_AUTH_TOKEN_KEY = 'auth_token'
PERMANENT_SESSION_DAYS = 3650


def _require_secret_key():
    key = os.environ.get('FLASK_SECRET_KEY')
    if not key:
        raise RuntimeError(
            "FLASK_SECRET_KEY is not set. Locally, start-local.sh writes/loads "
            "backend/.env.local; on Railway, set it in the dashboard's Variables."
        )
    return key


def create_app():
    # =================================================================
    # === 1. App config + auth helper closures
    # =================================================================
    app = Flask(__name__)
    CORS(app, origins=os.environ.get('CORS_ORIGINS', 'http://localhost:5001').split(','))
    app.config['SECRET_KEY'] = _require_secret_key()
    app.config['SESSION_COOKIE_HTTPONLY'] = True
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
    app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=PERMANENT_SESSION_DAYS)
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
    start_kid_audio_cleanup_scheduler(app.logger)

    def is_family_authenticated():
        family_id = session.get('family_id')
        if not family_id:
            return False
        stored_token = session.get(SESSION_AUTH_TOKEN_KEY)
        current_token = metadata.get_family_password_token(str(family_id))
        if not current_token or stored_token != current_token:
            # Password changed (or family deleted / data restored from a backup
            # whose password hashes differ). Drop the stale session so the
            # client falls back to the login flow.
            session.pop('family_id', None)
            session.pop('family_username', None)
            session.pop(SESSION_AUTH_TOKEN_KEY, None)
            return False
        return True

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

    # =================================================================
    # === 2. Request lifecycle hooks
    # =================================================================
    @app.before_request
    def enforce_family_auth():
        g.request_started_at = time.perf_counter()
        path = request.path
        if path == '/health':
            return None

        if path.startswith('/api/family-auth/'):
            return None

        # Public static assets are served regardless of auth, so short-circuit
        # them before is_family_authenticated() — that call re-reads/parses the
        # whole metadata file under a process-wide lock, and a single page load
        # pulls in ~15 of these assets. Skipping it here is the bulk of the win.
        if (
            path.endswith('.css')
            or path.endswith('.js')
            or path.endswith('.png')
            or path.endswith('.jpg')
            or path.endswith('.jpeg')
            or path.endswith('.svg')
            or path.endswith('.ico')
            or path.endswith('.webmanifest')
            or path.startswith('/fonts/')
            or path == '/robots.txt'
        ):
            return None

        public_frontend_paths = {'/', '/index.html', '/family-login.html', '/family-register.html'}
        if not is_family_authenticated():
            if path.startswith('/api/'):
                return jsonify({'error': 'Family login required'}), 401
            if path in public_frontend_paths:
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

    @app.route('/api/diagnostics/client-network', methods=['POST'])
    def log_client_network_profile():
        """Log opt-in browser resource timings for a one-off performance check."""
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return {'error': 'JSON payload required'}, 400
        resources = payload.get('resources')
        if not isinstance(resources, list):
            return {'error': 'resources must be a list'}, 400

        sanitized = []
        for item in resources[:80]:
            if not isinstance(item, dict):
                continue
            path = str(item.get('path') or '')
            if not path.startswith('/api/') or len(path) > 300:
                continue
            try:
                sanitized.append({
                    'path': path,
                    'duration_ms': round(max(0.0, float(item.get('durationMs') or 0)), 1),
                    'ttfb_ms': round(max(0.0, float(item.get('ttfbMs') or 0)), 1),
                    'transfer_bytes': max(0, int(item.get('transferBytes') or 0)),
                    'decoded_body_bytes': max(0, int(item.get('decodedBodyBytes') or 0)),
                })
            except (TypeError, ValueError):
                continue
        timings = payload.get('timings') if isinstance(payload.get('timings'), dict) else {}
        sanitized_timings = {}
        for key in ('fetch_and_process_ms', 'render_to_paint_ms', 'total_page_ready_ms'):
            try:
                sanitized_timings[key] = round(max(0.0, float(timings.get(key) or 0)), 1)
            except (TypeError, ValueError):
                continue
        app.logger.warning(
            'client_network_profile page=%s timings=%s resources=%s',
            str(payload.get('page') or '')[:200],
            json.dumps(sanitized_timings, separators=(',', ':')),
            json.dumps(sanitized, separators=(',', ':')),
        )
        return {'ok': True}, 204

    # =================================================================
    # === 3. Blueprint registration
    # =================================================================
    app.register_blueprint(kids_bp, url_prefix='/api')
    app.register_blueprint(backup_bp, url_prefix='/api')
    app.register_blueprint(points_bp, url_prefix='/api')

    # =================================================================
    # === 4. Family-auth routes
    # =================================================================
    @app.route('/api/family-auth/status', methods=['GET'])
    def family_auth_status():
        if not is_family_authenticated():
            return {'authenticated': False, 'familyId': None, 'familyUsername': None, 'isSuperFamily': False}, 200
        family_id = session.get('family_id')
        return {
            'authenticated': True,
            'familyId': family_id,
            'familyUsername': session.get('family_username'),
            'isSuperFamily': bool(metadata.is_super_family(str(family_id))),
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

        session.permanent = True
        session['family_id'] = str(family['id'])
        session['family_username'] = family['username']
        session[SESSION_AUTH_TOKEN_KEY] = metadata.get_family_password_token(str(family['id']))
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

        session.permanent = True
        session['family_id'] = str(family['id'])
        session['family_username'] = family['username']
        session[SESSION_AUTH_TOKEN_KEY] = metadata.get_family_password_token(str(family['id']))
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
        session.pop(SESSION_AUTH_TOKEN_KEY, None)
        return {'authenticated': False}, 200

    @app.route('/api/family-auth/confirm-password', methods=['POST'])
    def family_auth_confirm_password():
        auth_err = require_critical_password()
        if auth_err:
            return auth_err
        payload = request.get_json(silent=True) or {}
        result = {'ok': True}
        if bool(payload.get('trustBrowser')):
            family_id = str(session.get('family_id') or '')
            label = str(payload.get('browserLabel') or '').strip()
            trusted = metadata.add_trusted_browser(family_id, label)
            if trusted:
                result['trustedBrowser'] = trusted
        return result, 200

    @app.route('/api/family-auth/trusted-browsers/verify', methods=['POST'])
    def family_auth_verify_trusted_browser():
        auth_err = require_family_auth()
        if auth_err:
            return auth_err
        payload = request.get_json(silent=True) or {}
        token = str(payload.get('trustedBrowserToken') or '')
        trusted = metadata.verify_trusted_browser(str(session.get('family_id') or ''), token)
        if not trusted:
            return {'ok': False, 'error': 'Trusted browser not recognized'}, 403
        return {'ok': True, 'trustedBrowser': trusted}, 200

    @app.route('/api/family-auth/trusted-browsers', methods=['GET'])
    def family_auth_list_trusted_browsers():
        auth_err = require_family_auth()
        if auth_err:
            return auth_err
        browsers = metadata.list_trusted_browsers(str(session.get('family_id') or ''))
        return {'trustedBrowsers': browsers}, 200

    @app.route('/api/family-auth/trusted-browsers/<browser_id>', methods=['DELETE'])
    def family_auth_delete_trusted_browser(browser_id):
        auth_err = require_family_auth()
        if auth_err:
            return auth_err
        deleted = metadata.delete_trusted_browser(str(session.get('family_id') or ''), browser_id)
        if not deleted:
            return {'error': 'Trusted browser not found'}, 404
        return {'deleted': True, 'browserId': str(browser_id or '')}, 200

    # =================================================================
    # === 5. Parent-auth + parent-settings routes
    # =================================================================
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

        # Refresh the auth token in *this* browser's session so the user who
        # just changed their password isn't kicked out by the very next
        # request. Every other device's session still holds the old token and
        # will be invalidated by is_family_authenticated().
        session[SESSION_AUTH_TOKEN_KEY] = metadata.get_family_password_token(family_id)
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
        try:
            updated = metadata.update_family_timezone(family_id, timezone_name)
        except ValueError as exc:
            return {'error': str(exc)}, 400
        if not updated:
            return {'error': 'Failed to update family timezone'}, 400

        return {
            'familyTimezone': metadata.get_family_timezone(family_id),
            'updated': True
        }, 200

    # =================================================================
    # === 6. Super-family admin routes
    # =================================================================
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

        def _latest_mtime(root_dir):
            """Return the most recent file mtime under root_dir as ISO string, or None."""
            if not os.path.isdir(root_dir):
                return None
            latest = 0
            for current_root, _, names in os.walk(root_dir):
                for name in names:
                    try:
                        mt = os.path.getmtime(os.path.join(current_root, name))
                        if mt > latest:
                            latest = mt
                    except Exception:
                        pass
            if latest <= 0:
                return None
            from datetime import datetime, timezone
            return datetime.fromtimestamp(latest, tz=timezone.utc).isoformat()

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
            last_active = _latest_mtime(family_root)
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
                'lastActive': last_active,
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

    @app.route('/api/parent-settings/rebuild-databases', methods=['POST'])
    def rebuild_kid_databases():
        auth_err = require_super_family_auth()
        if auth_err:
            return auth_err

        results = []
        total_old = 0
        total_new = 0
        for kid in metadata.get_all_kids():
            db_rel = str(kid.get('dbFilePath') or '').strip()
            entry = {
                'kidId': kid.get('id'),
                'kidName': kid.get('name'),
                'familyId': kid.get('familyId'),
            }
            if not db_rel:
                entry['error'] = 'missing dbFilePath'
                results.append(entry)
                continue
            try:
                stats = kid_db.rebuild_kid_database_by_path(db_rel)
                total_old += int(stats['old_bytes'])
                total_new += int(stats['new_bytes'])
                entry.update(stats)
            except Exception as exc:
                app.logger.warning('rebuild failed for kid %s: %s', kid.get('id'), exc)
                entry['error'] = str(exc)
            results.append(entry)

        shared = {}
        try:
            shared = rebuild_shared_decks_database()
            total_old += int(shared['old_bytes'])
            total_new += int(shared['new_bytes'])
        except Exception as exc:
            app.logger.warning('rebuild failed for shared decks DB: %s', exc)
            shared = {'error': str(exc)}

        return jsonify({
            'kids': results,
            'sharedDecks': shared,
            'totalOldBytes': total_old,
            'totalNewBytes': total_new,
            'totalReclaimedBytes': max(0, total_old - total_new),
        }), 200

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

    # =================================================================
    # === 7. Health + static frontend serving
    # =================================================================
    @app.route('/health', methods=['GET'])
    def health():
        return {'status': 'healthy'}, 200

    @app.route('/robots.txt', methods=['GET'])
    def robots_txt():
        # Private, login-gated family app — nothing to crawl or index.
        return app.response_class('User-agent: *\nDisallow: /\n', mimetype='text/plain')

    frontend_dir = os.path.join(PROJECT_ROOT, 'frontend')
    asset_version_cache = {}
    asset_reference_pattern = re.compile(
        r'(?P<prefix>\b(?:src|href)\s*=\s*["\'])(?P<url>[^"\']+\.(?:js|css)(?:\?[^"\']*)?)(?P<suffix>["\'])',
        re.IGNORECASE,
    )

    def asset_version(asset_path):
        """Return a content hash for a frontend asset, cached until it changes."""
        stat = os.stat(asset_path)
        cache_key = (stat.st_mtime_ns, stat.st_size)
        cached = asset_version_cache.get(asset_path)
        if cached and cached[0] == cache_key:
            return cached[1]
        digest = hashlib.sha256()
        with open(asset_path, 'rb') as asset_file:
            for chunk in iter(lambda: asset_file.read(1024 * 1024), b''):
                digest.update(chunk)
        version = digest.hexdigest()[:16]
        asset_version_cache[asset_path] = (cache_key, version)
        return version

    def version_frontend_asset_url(url):
        """Attach a content version to local JS/CSS URLs in frontend HTML."""
        parsed = urlsplit(url)
        if parsed.scheme or parsed.netloc or parsed.path.startswith('/'):
            return url
        candidate = os.path.abspath(os.path.join(frontend_dir, parsed.path))
        if not candidate.startswith(f'{frontend_dir}{os.sep}') or not os.path.isfile(candidate):
            return url
        query = [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True) if key != 'v']
        query.append(('v', asset_version(candidate)))
        return urlunsplit(('', '', parsed.path, urlencode(query), parsed.fragment))

    def frontend_html_response(filename):
        """Serve fresh HTML that points at immutable, content-versioned assets."""
        html_path = os.path.join(frontend_dir, filename)
        with open(html_path, 'r', encoding='utf-8') as html_file:
            html = html_file.read()

        def replace_asset_reference(match):
            return f"{match.group('prefix')}{version_frontend_asset_url(match.group('url'))}{match.group('suffix')}"

        response = app.response_class(
            asset_reference_pattern.sub(replace_asset_reference, html),
            mimetype='text/html',
        )
        # HTML is the release manifest. It must be checked on each navigation
        # so it can point at new content-versioned JS/CSS after a deployment.
        response.headers['Cache-Control'] = 'private, no-cache'
        return response

    @app.route('/')
    def index():
        if is_family_authenticated():
            return frontend_html_response('family-home.html')
        return frontend_html_response('index.html')

    @app.route('/<path:path>')
    def serve_frontend(path):
        if os.path.exists(os.path.join(frontend_dir, path)):
            if path.lower().endswith('.html'):
                return frontend_html_response(path)
            response = send_from_directory(frontend_dir, path)
            normalized_path = path.lower()
            # Fonts never change — cache them immutably so the browser stops
            # re-fetching (and even re-validating). If a font ever changes, ship
            # it under a new filename.
            if path.startswith('fonts/') or normalized_path.endswith(('.ttf', '.woff', '.woff2', '.otf')):
                response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
            # A legacy service worker checks this URL itself. It must never be
            # cached, otherwise an old worker cannot receive its retirement
            # update promptly.
            elif normalized_path == 'service-worker.js':
                response.headers['Cache-Control'] = 'no-cache'
            # Railway adds ~80ms of latency to each revalidation. The app has
            # many small JS/CSS modules, so retain deployable static assets for
            # a short window. HTML deliberately keeps Flask's no-cache policy
            # so every navigation can discover a new release promptly.
            elif request.args.get('v') == asset_version(os.path.join(frontend_dir, path)):
                # The HTML shell emits this hash from the asset's contents. A
                # changed file gets a new URL, so this exact response is safe
                # to retain forever without delaying future releases.
                response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
            elif normalized_path.endswith((
                '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.webp',
                '.svg', '.ico',
            )):
                response.headers['Cache-Control'] = 'public, max-age=300, must-revalidate'
            return response
        return frontend_html_response('index.html')

    return app

if __name__ == '__main__':
    app = create_app()

    # Get port from environment variable (Railway sets PORT)
    port = int(os.environ.get('PORT', 5001))

    # Disable debug in production
    debug = os.environ.get('FLASK_ENV') != 'production'

    app.run(debug=debug, host='0.0.0.0', port=port)
