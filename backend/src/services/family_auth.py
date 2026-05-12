"""Session-scoped auth + per-family/per-kid access helpers.

Helpers that:
  - Read the authenticated family id off the Flask session.
  - Resolve super-family privilege and per-category access rules.
  - Open a per-kid SQLite connection scoped to the current family.
  - Gate destructive operations behind a re-entered critical password (rate-limited).

These helpers depend on Flask `session` / `request` and on `db.metadata`/`db.kid_db`,
so they are session-scoped but otherwise stateless.
"""
from flask import jsonify, request, session

from src.db import kid_db, metadata
from src.security_rate_limit import (
    CRITICAL_PASSWORD_RATE_LIMITER,
    build_critical_password_limit_key,
)


def current_family_id():
    """Return authenticated family id from session."""
    return str(session.get('family_id') or '')


def get_current_family_id_int():
    """Get current session family id as int, or None if invalid/missing."""
    family_id = current_family_id()
    if not family_id:
        return None
    try:
        return int(family_id)
    except (TypeError, ValueError):
        return None


def is_super_family_id(family_id):
    """Return whether one family id has super-family privileges."""
    normalized = str(family_id or '').strip()
    if not normalized:
        return False
    return bool(metadata.is_super_family(normalized))


def can_family_access_deck_category(category_meta, *, family_id=None, is_super=None):
    """Return whether one family can access one deck category."""
    if not isinstance(category_meta, dict):
        return False
    if is_super is None:
        is_super = is_super_family_id(family_id if family_id is not None else current_family_id())
    if is_super:
        return True
    return bool(category_meta.get('is_shared_with_non_super_family'))


def get_kid_for_family(kid_id):
    """Get kid scoped to currently logged-in family."""
    family_id = current_family_id()
    if not family_id:
        return None
    return metadata.get_kid_by_id(kid_id, family_id=family_id)


def get_kid_connection_for(kid, read_only: bool = False):
    """Open kid database connection by scoped dbFilePath."""
    rel = kid.get('dbFilePath')
    return kid_db.get_kid_connection_by_path(rel, read_only=read_only)


def require_super_family():
    """Require authenticated super family for privileged operations."""
    family_id = current_family_id()
    if not family_id:
        return jsonify({'error': 'Family login required'}), 401
    if not metadata.is_super_family(family_id):
        return jsonify({'error': 'Super family access required'}), 403
    return None


def require_critical_password():
    """Require current family password for destructive/critical operations."""
    family_id = current_family_id()
    if not family_id:
        return jsonify({'error': 'Family login required'}), 401

    password = str(request.headers.get('X-Confirm-Password') or '')
    if not password:
        json_data = request.get_json(silent=True)
        if isinstance(json_data, dict):
            password = str(json_data.get('confirmPassword') or '')
    if not password:
        password = str(request.form.get('confirmPassword') or '')
    if not password:
        return jsonify({'error': 'Password confirmation required'}), 400

    limit_key = build_critical_password_limit_key(request, family_id=family_id)
    allowed, retry_after_seconds = CRITICAL_PASSWORD_RATE_LIMITER.check(limit_key)
    if not allowed:
        return jsonify({
            'error': 'Too many password confirmation attempts. Try again later.',
            'retryAfterSeconds': int(retry_after_seconds),
        }), 429
    if not metadata.verify_family_password(family_id, password):
        return jsonify({'error': 'Invalid password'}), 403
    CRITICAL_PASSWORD_RATE_LIMITER.reset(limit_key)
    return None
