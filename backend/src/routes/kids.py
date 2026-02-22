"""Kid management API routes"""
from flask import Blueprint, request, jsonify, send_from_directory, session
from datetime import datetime, timedelta, timezone
import math
import json
import os
import shutil
import uuid
import time
import threading
import mimetypes
import re
from zoneinfo import ZoneInfo
from werkzeug.utils import secure_filename
from src.db import metadata, kid_db
from src.db.shared_deck_db import get_shared_decks_connection

kids_bp = Blueprint('kids', __name__)

DEFAULT_SESSION_CARD_COUNT = 10
MIN_SESSION_CARD_COUNT = 1
MAX_SESSION_CARD_COUNT = 200
DEFAULT_HARD_CARD_PERCENTAGE = 20
MIN_HARD_CARD_PERCENTAGE = 0
MAX_HARD_CARD_PERCENTAGE = 100
MAX_WRITING_SHEET_ROWS = 10
BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
DATA_DIR = os.path.join(BACKEND_ROOT, 'data')
FAMILIES_ROOT = os.path.join(DATA_DIR, 'families')
DEFAULT_SHARED_MATH_SESSION_CARD_COUNT = 10
DEFAULT_SHARED_LESSON_READING_SESSION_CARD_COUNT = 0
ALLOWED_SHARED_DECK_FIRST_TAGS = {'math', 'chinese_reading'}
MAX_SHARED_DECK_TAGS = 20
MAX_SHARED_DECK_CARDS = 10000
MAX_SHARED_TAG_LENGTH = 64
MAX_SHARED_DECK_OPTIN_BATCH = 200
MATERIALIZED_SHARED_DECK_NAME_PREFIX = 'shared_deck_'
MATH_ORPHAN_DECK_NAME = 'math_orphan'
LESSON_READING_ORPHAN_DECK_NAME = 'chinese_reading_orphan'
PENDING_SESSION_TTL_SECONDS = 60 * 60 * 6
_PENDING_SESSIONS = {}
_PENDING_SESSIONS_LOCK = threading.Lock()


def get_family_root(family_id):
    """Return filesystem root for one family."""
    return os.path.join(FAMILIES_ROOT, f'family_{family_id}')


def get_kid_scoped_db_relpath(kid):
    """Return family-scoped dbFilePath for a kid."""
    family_id = str(kid.get('familyId') or '')
    kid_id = kid.get('id')
    return f"data/families/family_{family_id}/kid_{kid_id}.db"


def get_kid_writing_audio_dir(kid):
    """Get filesystem directory for kid writing prompt audio files."""
    family_id = str(kid.get('familyId') or '')
    kid_id = kid.get('id')
    return os.path.join(get_family_root(family_id), 'writing_audio', f'kid_{kid_id}')


def ensure_writing_audio_dir(kid):
    """Ensure kid writing audio directory exists."""
    path = get_kid_writing_audio_dir(kid)
    os.makedirs(path, exist_ok=True)
    return path


def get_kid_lesson_reading_audio_dir(kid):
    """Get filesystem directory for kid lesson-reading recording files."""
    family_id = str(kid.get('familyId') or '')
    kid_id = kid.get('id')
    return os.path.join(get_family_root(family_id), 'lesson_reading_audio', f'kid_{kid_id}')


def ensure_lesson_reading_audio_dir(kid):
    """Ensure kid lesson-reading audio directory exists."""
    path = get_kid_lesson_reading_audio_dir(kid)
    os.makedirs(path, exist_ok=True)
    return path


def cleanup_lesson_reading_pending_audio_files_by_payload(pending_payload):
    """Delete uploaded lesson-reading files for one pending session payload."""
    if not pending_payload:
        return
    lesson_audio_by_card = pending_payload.get('lesson_audio_by_card')
    if not isinstance(lesson_audio_by_card, dict) or len(lesson_audio_by_card) == 0:
        return
    audio_dir = str(pending_payload.get('lesson_audio_dir') or '').strip()
    if not audio_dir:
        return
    for item in lesson_audio_by_card.values():
        if not isinstance(item, dict):
            continue
        file_name = str(item.get('file_name') or '').strip()
        if not file_name:
            continue
        audio_path = os.path.join(audio_dir, file_name)
        if os.path.exists(audio_path):
            try:
                os.remove(audio_path)
            except Exception:
                pass


def cleanup_lesson_reading_pending_audio_files(kid, pending_payload):
    """Backwards-compatible wrapper for pending lesson-reading cleanup."""
    if pending_payload and not pending_payload.get('lesson_audio_dir') and kid:
        pending_payload = {**pending_payload, 'lesson_audio_dir': get_kid_lesson_reading_audio_dir(kid)}
    cleanup_lesson_reading_pending_audio_files_by_payload(pending_payload)


def current_family_id():
    """Return authenticated family id from session."""
    return str(session.get('family_id') or '')


def require_super_family():
    """Require authenticated super family for privileged operations."""
    family_id = current_family_id()
    if not family_id:
        return jsonify({'error': 'Family login required'}), 401
    if not metadata.is_super_family(family_id):
        return jsonify({'error': 'Super family access required'}), 403
    return None


def get_kid_for_family(kid_id):
    """Get kid scoped to currently logged-in family."""
    family_id = current_family_id()
    if not family_id:
        return None
    return metadata.get_kid_by_id(kid_id, family_id=family_id)


def get_kid_connection_for(kid):
    """Open kid database connection by scoped dbFilePath."""
    rel = kid.get('dbFilePath')
    return kid_db.get_kid_connection_by_path(rel)


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
    if not metadata.verify_family_password(family_id, password):
        return jsonify({'error': 'Invalid password'}), 403
    return None


def normalize_shared_deck_tag(raw_tag):
    """Normalize one deck tag to a compact underscore format."""
    text = str(raw_tag or '').strip().lower()
    if not text:
        return ''
    text = re.sub(r'\s+', '_', text)
    text = re.sub(r'_+', '_', text).strip('_')
    return text


def build_shared_deck_tags(first_tag, extra_tags):
    """Build ordered unique tags list with first tag constrained by allowed values."""
    first = normalize_shared_deck_tag(first_tag)
    if first not in ALLOWED_SHARED_DECK_FIRST_TAGS:
        raise ValueError(f'firstTag must be one of: {", ".join(sorted(ALLOWED_SHARED_DECK_FIRST_TAGS))}')
    if len(first) > MAX_SHARED_TAG_LENGTH:
        raise ValueError(f'firstTag is too long (max {MAX_SHARED_TAG_LENGTH})')

    tags = [first]
    seen = {first}
    if extra_tags is None:
        return tags
    if not isinstance(extra_tags, list):
        raise ValueError('extraTags must be an array')

    for raw in extra_tags:
        tag = normalize_shared_deck_tag(raw)
        if not tag or tag in seen:
            continue
        if len(tag) > MAX_SHARED_TAG_LENGTH:
            raise ValueError(f'Tag "{tag}" is too long (max {MAX_SHARED_TAG_LENGTH})')
        tags.append(tag)
        seen.add(tag)
        if len(tags) > MAX_SHARED_DECK_TAGS:
            raise ValueError(f'Too many tags (max {MAX_SHARED_DECK_TAGS})')
    return tags


def normalize_shared_deck_cards(cards):
    """Validate and normalize incoming cards payload to front/back pairs."""
    if not isinstance(cards, list) or len(cards) == 0:
        raise ValueError('cards must be a non-empty array')
    if len(cards) > MAX_SHARED_DECK_CARDS:
        raise ValueError(f'cards exceeds max allowed ({MAX_SHARED_DECK_CARDS})')

    normalized = []
    for index, item in enumerate(cards):
        if not isinstance(item, dict):
            raise ValueError(f'cards[{index}] must be an object')
        front = str(item.get('front') or '').strip()
        back = str(item.get('back') or '').strip()
        if not front or not back:
            raise ValueError(f'cards[{index}] requires non-empty front and back')
        normalized.append({'front': front, 'back': back})
    return normalized


def dedupe_shared_deck_cards_by_front(cards):
    """Deduplicate cards by front text, preserving first-seen order."""
    deduped = []
    seen_fronts = set()
    for card in cards:
        front = card['front']
        if front in seen_fronts:
            continue
        seen_fronts.add(front)
        deduped.append(card)
    return deduped


def normalize_shared_deck_fronts(fronts):
    """Validate and normalize a front-text array for conflict checks."""
    if fronts is None:
        return []
    if not isinstance(fronts, list):
        raise ValueError('fronts must be an array')
    if len(fronts) > MAX_SHARED_DECK_CARDS:
        raise ValueError(f'fronts exceeds max allowed ({MAX_SHARED_DECK_CARDS})')

    normalized = []
    seen = set()
    for index, item in enumerate(fronts):
        front = str(item or '').strip()
        if not front:
            raise ValueError(f'fronts[{index}] must be a non-empty string')
        if front in seen:
            continue
        seen.add(front)
        normalized.append(front)
    return normalized


def normalize_shared_math_deck_mix(raw_mix):
    """Normalize stored/shared deck mix payload as {shared_deck_id(str): percent(int)}."""
    if not isinstance(raw_mix, dict):
        return {}
    normalized = {}
    for raw_key, raw_value in raw_mix.items():
        try:
            deck_id = int(str(raw_key or '').strip())
        except (TypeError, ValueError):
            continue
        if deck_id <= 0:
            continue
        try:
            percent = int(raw_value)
        except (TypeError, ValueError):
            continue
        percent = max(0, min(100, percent))
        normalized[str(deck_id)] = percent
        if len(normalized) >= MAX_SHARED_DECK_OPTIN_BATCH:
            break
    return normalized


def normalize_shared_deck_ids(deck_ids):
    """Validate and normalize shared deck id list for kid opt-in requests."""
    if not isinstance(deck_ids, list) or len(deck_ids) == 0:
        raise ValueError('deck_ids must be a non-empty array')
    if len(deck_ids) > MAX_SHARED_DECK_OPTIN_BATCH:
        raise ValueError(f'deck_ids exceeds max allowed ({MAX_SHARED_DECK_OPTIN_BATCH})')

    normalized = []
    seen = set()
    for index, item in enumerate(deck_ids):
        try:
            deck_id = int(item)
        except (TypeError, ValueError):
            raise ValueError(f'deck_ids[{index}] must be a positive integer') from None
        if deck_id <= 0:
            raise ValueError(f'deck_ids[{index}] must be a positive integer')
        if deck_id in seen:
            continue
        seen.add(deck_id)
        normalized.append(deck_id)
    return normalized


def build_materialized_shared_deck_name(shared_deck_id, shared_deck_name):
    """Build deterministic kid-local deck name for one shared deck."""
    shared_name = str(shared_deck_name or '').strip()
    return f"{MATERIALIZED_SHARED_DECK_NAME_PREFIX}{int(shared_deck_id)}__{shared_name}"


def parse_shared_deck_id_from_materialized_name(deck_name):
    """Parse shared deck id from kid-local materialized deck name."""
    text = str(deck_name or '').strip()
    prefix = MATERIALIZED_SHARED_DECK_NAME_PREFIX
    if not text.startswith(prefix):
        return None
    tail = text[len(prefix):]
    parts = tail.split('__', 1)
    if len(parts) != 2:
        return None
    try:
        deck_id = int(parts[0])
    except (TypeError, ValueError):
        return None
    if deck_id <= 0:
        return None
    return deck_id


def build_materialized_shared_deck_tags(shared_tags):
    """Build kid-local deck tags for materialized shared decks."""
    ordered = []
    seen = set()
    for raw in list(shared_tags or []):
        tag = str(raw or '').strip()
        if not tag or tag in seen:
            continue
        seen.add(tag)
        ordered.append(tag)
    return ordered


def get_shared_deck_rows_by_first_tag(conn, first_tag):
    """Return shared decks with card counts filtered by required first tag."""
    required_tag = str(first_tag or '').strip()
    if not required_tag:
        return []
    rows = conn.execute(
        """
        SELECT
            d.deck_id,
            d.name,
            d.tags,
            d.creator_family_id,
            d.created_at,
            COUNT(c.id) AS card_count
        FROM deck d
        LEFT JOIN cards c ON c.deck_id = d.deck_id
        GROUP BY d.deck_id, d.name, d.tags, d.creator_family_id, d.created_at
        ORDER BY d.created_at DESC, d.deck_id DESC
        """
    ).fetchall()
    decks = []
    for row in rows:
        tags = [str(tag) for tag in list(row[2] or []) if str(tag or '').strip()]
        if required_tag not in tags:
            continue
        decks.append({
            'deck_id': int(row[0]),
            'name': str(row[1]),
            'tags': tags,
            'creator_family_id': int(row[3]),
            'created_at': row[4].isoformat() if row[4] else None,
            'card_count': int(row[5] or 0),
        })
    return decks


def get_shared_math_deck_rows(conn):
    """Return all shared decks tagged as math with card counts."""
    return get_shared_deck_rows_by_first_tag(conn, 'math')


def get_shared_lesson_reading_deck_rows(conn):
    """Return all shared decks tagged as chinese_reading with card counts."""
    return get_shared_deck_rows_by_first_tag(conn, 'chinese_reading')


def _distribute_integer_total(total, weights):
    """Distribute integer total proportionally by weights, preserving sum exactly."""
    count = len(weights)
    if count == 0:
        return []
    total_int = int(max(0, total))
    if total_int == 0:
        return [0] * count

    normalized_weights = [max(0.0, float(weight or 0.0)) for weight in weights]
    weight_sum = float(sum(normalized_weights))
    if weight_sum <= 0:
        normalized_weights = [1.0] * count
        weight_sum = float(count)

    exact = [weight * total_int / weight_sum for weight in normalized_weights]
    floors = [int(math.floor(value)) for value in exact]
    remainder = total_int - sum(floors)
    if remainder > 0:
        ranked = sorted(
            range(count),
            key=lambda idx: (exact[idx] - floors[idx], -idx),
            reverse=True
        )
        for index in ranked[:remainder]:
            floors[index] += 1
    return floors


def build_shared_math_mix_for_opted_decks(opted_deck_ids, raw_mix):
    """Build normalized percent mix map for opted-in shared decks."""
    deck_ids = [int(deck_id) for deck_id in list(opted_deck_ids or [])]
    if len(deck_ids) == 0:
        return {}
    normalized_mix = normalize_shared_math_deck_mix(raw_mix)
    weights = [int(normalized_mix.get(str(deck_id), 0) or 0) for deck_id in deck_ids]
    percents = _distribute_integer_total(100, weights)
    return {str(deck_ids[index]): int(percents[index]) for index in range(len(deck_ids))}


def build_shared_math_counts_for_opted_decks(total_cards, mix_map, opted_deck_ids):
    """Build per-deck card counts from total cards and percent mix."""
    deck_ids = [int(deck_id) for deck_id in list(opted_deck_ids or [])]
    if len(deck_ids) == 0:
        return {}
    weights = [int(mix_map.get(str(deck_id), 0) or 0) for deck_id in deck_ids]
    counts = _distribute_integer_total(total_cards, weights)
    return {str(deck_ids[index]): int(counts[index]) for index in range(len(deck_ids))}


def build_shared_lesson_reading_mix_for_opted_decks(opted_deck_ids, raw_mix):
    """Build normalized percent mix map for opted-in shared chinese_reading decks."""
    return build_shared_math_mix_for_opted_decks(opted_deck_ids, raw_mix)


def build_shared_lesson_reading_counts_for_opted_decks(total_cards, mix_map, opted_deck_ids):
    """Build per-deck card counts from total cards and percent mix."""
    return build_shared_math_counts_for_opted_decks(total_cards, mix_map, opted_deck_ids)


def get_kid_materialized_shared_decks_by_first_tag(conn, first_tag):
    """Return kid-local materialized shared decks keyed by local deck id."""
    required_tag = str(first_tag or '').strip()
    if not required_tag:
        return {}
    rows = conn.execute(
        "SELECT id, name, tags FROM decks WHERE name LIKE ? ORDER BY id ASC",
        [f"{MATERIALIZED_SHARED_DECK_NAME_PREFIX}%"]
    ).fetchall()
    decks = {}
    for row in rows:
        local_deck_id = int(row[0])
        local_name = str(row[1] or '')
        shared_deck_id = parse_shared_deck_id_from_materialized_name(local_name)
        if shared_deck_id is None:
            continue
        tags = [str(tag) for tag in list(row[2] or []) if str(tag or '').strip()]
        if required_tag not in tags:
            continue
        decks[local_deck_id] = {
            'local_deck_id': local_deck_id,
            'local_name': local_name,
            'shared_deck_id': shared_deck_id,
            'tags': tags,
        }
    return decks


def get_kid_materialized_shared_math_decks(conn):
    """Return kid-local materialized shared math decks keyed by local deck id."""
    return get_kid_materialized_shared_decks_by_first_tag(conn, 'math')


def get_kid_materialized_shared_lesson_reading_decks(conn):
    """Return kid-local materialized shared chinese_reading decks keyed by local deck id."""
    return get_kid_materialized_shared_decks_by_first_tag(conn, 'chinese_reading')


def get_shared_math_runtime_decks_for_kid(conn, kid):
    """Return opted-in shared math decks with per-session planned counts."""
    materialized_by_local_id = get_kid_materialized_shared_math_decks(conn)
    if len(materialized_by_local_id) == 0:
        return []

    ordered_local_ids = sorted(materialized_by_local_id.keys())
    ordered = [materialized_by_local_id[deck_id] for deck_id in ordered_local_ids]
    shared_ids = [entry['shared_deck_id'] for entry in ordered]
    mix_percent_by_shared_id = build_shared_math_mix_for_opted_decks(
        shared_ids,
        kid.get('sharedMathDeckMix')
    )
    count_by_shared_id = build_shared_math_counts_for_opted_decks(
        normalize_shared_math_session_card_count(kid),
        mix_percent_by_shared_id,
        shared_ids
    )

    runtime_decks = []
    for entry in ordered:
        local_deck_id = int(entry['local_deck_id'])
        shared_deck_id = int(entry['shared_deck_id'])
        total_cards = int(conn.execute(
            "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = FALSE",
            [local_deck_id]
        ).fetchone()[0] or 0)
        runtime_decks.append({
            'local_deck_id': local_deck_id,
            'shared_deck_id': shared_deck_id,
            'name': str(entry.get('local_name') or ''),
            'total_cards': total_cards,
            'session_count': int(count_by_shared_id.get(str(shared_deck_id), 0)),
            'mix_percent': int(mix_percent_by_shared_id.get(str(shared_deck_id), 0)),
        })
    return runtime_decks


def get_shared_lesson_reading_runtime_decks_for_kid(conn, kid):
    """Return opted-in shared chinese_reading decks with per-session planned counts."""
    materialized_by_local_id = get_kid_materialized_shared_lesson_reading_decks(conn)
    if len(materialized_by_local_id) == 0:
        return []

    ordered_local_ids = sorted(materialized_by_local_id.keys())
    ordered = [materialized_by_local_id[deck_id] for deck_id in ordered_local_ids]
    shared_ids = [entry['shared_deck_id'] for entry in ordered]
    mix_percent_by_shared_id = build_shared_lesson_reading_mix_for_opted_decks(
        shared_ids,
        kid.get('sharedLessonReadingDeckMix')
    )
    count_by_shared_id = build_shared_lesson_reading_counts_for_opted_decks(
        normalize_shared_lesson_reading_session_card_count(kid),
        mix_percent_by_shared_id,
        shared_ids
    )

    runtime_decks = []
    for entry in ordered:
        local_deck_id = int(entry['local_deck_id'])
        shared_deck_id = int(entry['shared_deck_id'])
        total_cards = int(conn.execute(
            "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = FALSE",
            [local_deck_id]
        ).fetchone()[0] or 0)
        runtime_decks.append({
            'local_deck_id': local_deck_id,
            'shared_deck_id': shared_deck_id,
            'name': str(entry.get('local_name') or ''),
            'total_cards': total_cards,
            'session_count': int(count_by_shared_id.get(str(shared_deck_id), 0)),
            'mix_percent': int(mix_percent_by_shared_id.get(str(shared_deck_id), 0)),
        })
    return runtime_decks


def get_shared_deck_owned_by_family(conn, deck_id, family_id_int):
    """Fetch one shared deck row if it belongs to the given family."""
    return conn.execute(
        """
        SELECT deck_id, name, tags, creator_family_id, created_at
        FROM deck
        WHERE deck_id = ? AND creator_family_id = ?
        """,
        [deck_id, family_id_int]
    ).fetchone()


def get_shared_deck_cards(conn, deck_id):
    """Return immutable cards for one deck as id/front/back rows."""
    rows = conn.execute(
        """
        SELECT id, front, back
        FROM cards
        WHERE deck_id = ?
        ORDER BY id ASC
        """,
        [deck_id]
    ).fetchall()
    return [{
        'id': int(row[0]),
        'front': str(row[1]),
        'back': str(row[2]),
    } for row in rows]


def get_shared_front_conflicts(conn, fronts):
    """Return mapping: front -> list of conflicting decks containing that front."""
    if not fronts:
        return {}
    placeholders = ','.join(['?'] * len(fronts))
    rows = conn.execute(
        f"""
        SELECT c.front, d.deck_id, d.name
        FROM cards c
        JOIN deck d ON d.deck_id = c.deck_id
        WHERE c.front IN ({placeholders})
        ORDER BY c.front, d.name, d.deck_id
        """,
        fronts
    ).fetchall()

    conflicts = {}
    seen_pairs = set()
    for row in rows:
        front = str(row[0])
        deck_id = int(row[1])
        deck_name = str(row[2])
        pair = (front, deck_id)
        if pair in seen_pairs:
            continue
        seen_pairs.add(pair)
        conflicts.setdefault(front, []).append({
            'deck_id': deck_id,
            'name': deck_name,
        })
    return conflicts


def get_current_family_id_int():
    """Get current session family id as int, or None if invalid/missing."""
    family_id = current_family_id()
    if not family_id:
        return None
    try:
        return int(family_id)
    except (TypeError, ValueError):
        return None


def get_all_shared_deck_tags(conn):
    """Return globally unique shared-deck tags."""
    rows = conn.execute("SELECT tags FROM deck").fetchall()
    tags = set()
    for row in rows:
        for tag in list(row[0] or []):
            value = str(tag or '').strip()
            if value:
                tags.add(value)
    return sorted(tags)


@kids_bp.route('/shared-decks/name-availability', methods=['GET'])
def shared_deck_name_availability():
    """Check whether a shared deck name is globally available."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err
        deck_name = str(request.args.get('name') or '').strip()
        if not deck_name:
            return jsonify({'error': 'name is required'}), 400

        conn = get_shared_decks_connection()
        try:
            row = conn.execute(
                "SELECT deck_id FROM deck WHERE name = ? LIMIT 1",
                [deck_name]
            ).fetchone()
        finally:
            conn.close()

        return jsonify({
            'name': deck_name,
            'available': row is None,
            'existing_deck_id': int(row[0]) if row else None,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/front-conflicts', methods=['POST'])
def shared_deck_front_conflicts():
    """Return existing decks that already contain each requested front."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err
        payload = request.get_json() or {}
        fronts = normalize_shared_deck_fronts(payload.get('fronts'))
        conn = get_shared_decks_connection()
        try:
            conflicts = get_shared_front_conflicts(conn, fronts)
        finally:
            conn.close()
        return jsonify({
            'checked_front_count': len(fronts),
            'conflict_count': len(conflicts),
            'conflicts': conflicts,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/tags', methods=['GET'])
def shared_deck_tags():
    """Return all existing shared deck tags for autocomplete."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err

        conn = get_shared_decks_connection()
        try:
            tags = get_all_shared_deck_tags(conn)
        finally:
            conn.close()

        return jsonify({'tags': tags}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/mine', methods=['GET'])
def list_my_shared_decks():
    """List shared decks created by the currently authenticated family."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err
        family_id = current_family_id()
        try:
            family_id_int = int(family_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid family id in session'}), 400

        conn = get_shared_decks_connection()
        try:
            rows = conn.execute(
                """
                SELECT
                    d.deck_id,
                    d.name,
                    d.tags,
                    d.creator_family_id,
                    d.created_at,
                    CAST(COALESCE(COUNT(c.id), 0) AS INTEGER) AS card_count
                FROM deck d
                LEFT JOIN cards c ON c.deck_id = d.deck_id
                WHERE d.creator_family_id = ?
                GROUP BY d.deck_id, d.name, d.tags, d.creator_family_id, d.created_at
                ORDER BY d.created_at DESC, d.deck_id DESC
                """,
                [family_id_int]
            ).fetchall()
        finally:
            conn.close()

        decks = [{
            'deck_id': int(row[0]),
            'name': str(row[1]),
            'tags': list(row[2] or []),
            'creator_family_id': int(row[3]),
            'created_at': row[4].isoformat() if row[4] else None,
            'card_count': int(row[5] or 0),
        } for row in rows]

        return jsonify({'decks': decks}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/<int:deck_id>', methods=['GET'])
def get_shared_deck_details(deck_id):
    """Return one owned shared deck and cards for read-only view UI."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err
        family_id_int = get_current_family_id_int()
        if family_id_int is None:
            if not current_family_id():
                return jsonify({'error': 'Family login required'}), 401
            return jsonify({'error': 'Invalid family id in session'}), 400

        conn = get_shared_decks_connection()
        try:
            deck_row = get_shared_deck_owned_by_family(conn, deck_id, family_id_int)
            if not deck_row:
                return jsonify({'error': 'Deck not found'}), 404
            cards = get_shared_deck_cards(conn, deck_id)
        finally:
            conn.close()

        return jsonify({
            'deck': {
                'deck_id': int(deck_row[0]),
                'name': str(deck_row[1]),
                'tags': list(deck_row[2] or []),
                'creator_family_id': int(deck_row[3]),
                'created_at': deck_row[4].isoformat() if deck_row[4] else None,
            },
            'card_count': len(cards),
            'cards': cards,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/<int:deck_id>', methods=['DELETE'])
def delete_shared_deck(deck_id):
    """Delete one owned shared deck and all of its cards."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err
        family_id_int = get_current_family_id_int()
        if family_id_int is None:
            if not current_family_id():
                return jsonify({'error': 'Family login required'}), 401
            return jsonify({'error': 'Invalid family id in session'}), 400

        conn = None
        try:
            conn = get_shared_decks_connection()
            deck_row = get_shared_deck_owned_by_family(conn, deck_id, family_id_int)
            if not deck_row:
                return jsonify({'error': 'Deck not found'}), 404
            # DuckDB currently raises a FK error for child->parent delete
            # inside an explicit transaction even after child rows are removed.
            # Run in autocommit mode: delete cards first, then deck.
            conn.execute("DELETE FROM cards WHERE deck_id = ?", [deck_id])
            conn.execute("DELETE FROM deck WHERE deck_id = ? AND creator_family_id = ?", [deck_id, family_id_int])
        finally:
            if conn is not None:
                conn.close()

        return jsonify({
            'deleted': True,
            'deck_id': int(deck_id),
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks', methods=['POST'])
def create_shared_deck():
    """Create one shared deck and immutable cards for each provided pair."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err
        family_id = current_family_id()
        payload = request.get_json() or {}
        tags = build_shared_deck_tags(payload.get('firstTag'), payload.get('extraTags'))
        cards = dedupe_shared_deck_cards_by_front(normalize_shared_deck_cards(payload.get('cards')))
        deck_name = '_'.join(tags)

        try:
            family_id_int = int(family_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid family id in session'}), 400

        conn = None
        try:
            conn = get_shared_decks_connection()
            fronts = [card['front'] for card in cards]
            conflicts = get_shared_front_conflicts(conn, fronts)
            if conflicts:
                return jsonify({
                    'error': 'Some card fronts already exist in other decks.',
                    'front_conflicts': conflicts,
                }), 409

            conn.execute("BEGIN TRANSACTION")
            deck_row = conn.execute(
                """
                INSERT INTO deck (name, tags, creator_family_id)
                VALUES (?, ?, ?)
                RETURNING deck_id, created_at
                """,
                [deck_name, tags, family_id_int]
            ).fetchone()
            deck_id = int(deck_row[0])
            created_at = deck_row[1].isoformat() if deck_row and deck_row[1] else None

            conn.executemany(
                """
                INSERT INTO cards (deck_id, front, back)
                VALUES (?, ?, ?)
                """,
                [[deck_id, card['front'], card['back']] for card in cards]
            )
            conn.execute("COMMIT")
        except Exception:
            if conn is not None:
                try:
                    conn.execute("ROLLBACK")
                except Exception:
                    pass
            raise
        finally:
            if conn is not None:
                conn.close()

        return jsonify({
            'created': True,
            'deck': {
                'deck_id': deck_id,
                'name': deck_name,
                'tags': tags,
                'creator_family_id': family_id_int,
                'created_at': created_at,
            },
            'cards_added': len(cards),
        }), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        err = str(e).lower()
        if 'unique' in err and 'name' in err:
            return jsonify({'error': 'Deck name already exists. Please choose different tags.'}), 409
        if 'unique' in err and 'front' in err:
            return jsonify({'error': 'Some card fronts already exist in other decks.'}), 409
        return jsonify({'error': str(e)}), 500


def normalize_session_card_count(kid):
    """Get validated session card count for a kid."""
    value = kid.get('sessionCardCount', DEFAULT_SESSION_CARD_COUNT)
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return DEFAULT_SESSION_CARD_COUNT

    if parsed == 0:
        return 0
    if parsed < MIN_SESSION_CARD_COUNT:
        return MIN_SESSION_CARD_COUNT
    if parsed > MAX_SESSION_CARD_COUNT:
        return MAX_SESSION_CARD_COUNT
    return parsed


def normalize_writing_session_card_count(kid):
    """Get validated writing session card count for a kid."""
    value = kid.get('writingSessionCardCount', 0)
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 0

    if parsed < 0:
        return 0
    if parsed > MAX_SESSION_CARD_COUNT:
        return MAX_SESSION_CARD_COUNT
    return parsed


def normalize_hard_card_percentage(kid):
    """Get validated hard-card percentage from family global setting."""
    family_id = str(kid.get('familyId') or '')
    if family_id:
        try:
            return metadata.get_family_hard_card_percentage(family_id)
        except Exception:
            pass

    # Legacy fallback for old metadata rows.
    value = kid.get('hardCardPercentage', DEFAULT_HARD_CARD_PERCENTAGE)
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return DEFAULT_HARD_CARD_PERCENTAGE

    if parsed < MIN_HARD_CARD_PERCENTAGE:
        return MIN_HARD_CARD_PERCENTAGE
    if parsed > MAX_HARD_CARD_PERCENTAGE:
        return MAX_HARD_CARD_PERCENTAGE
    return parsed


def normalize_shared_math_session_card_count(kid):
    """Get validated total math cards per session for shared (opted-in) decks."""
    raw = kid.get('sharedMathSessionCardCount')
    if raw is None:
        raw = DEFAULT_SHARED_MATH_SESSION_CARD_COUNT
    try:
        parsed = int(raw)
    except (TypeError, ValueError):
        parsed = DEFAULT_SHARED_MATH_SESSION_CARD_COUNT

    if parsed < 0:
        return 0
    if parsed > MAX_SESSION_CARD_COUNT:
        return MAX_SESSION_CARD_COUNT
    return parsed


def normalize_shared_lesson_reading_session_card_count(kid):
    """Get validated total chinese-reading cards per session for shared decks."""
    raw = kid.get('sharedLessonReadingSessionCardCount')
    if raw is None:
        raw = DEFAULT_SHARED_LESSON_READING_SESSION_CARD_COUNT
    try:
        parsed = int(raw)
    except (TypeError, ValueError):
        parsed = DEFAULT_SHARED_LESSON_READING_SESSION_CARD_COUNT
    if parsed < 0:
        return 0
    if parsed > MAX_SESSION_CARD_COUNT:
        return MAX_SESSION_CARD_COUNT
    return parsed


def normalize_shared_lesson_reading_deck_mix(raw_mix):
    """Normalize stored lesson-reading shared deck mix payload."""
    return normalize_shared_math_deck_mix(raw_mix)


def get_kid_dashboard_stats(kid):
    """Get today's completed session counts and ungraded Chinese Reading flag in one connection."""
    default_counts = {'total': 0, 'chinese': 0, 'math': 0, 'writing': 0, 'lesson_reading': 0}
    try:
        conn = get_kid_connection_for(kid)
    except Exception:
        return default_counts, False

    try:
        family_id = str(kid.get('familyId') or '')
        family_timezone = metadata.get_family_timezone(family_id)
        tzinfo = ZoneInfo(family_timezone)
        day_start_local = datetime.now(tzinfo).replace(hour=0, minute=0, second=0, microsecond=0)
        day_end_local = day_start_local + timedelta(days=1)
        day_start_utc = day_start_local.astimezone(timezone.utc).replace(tzinfo=None)
        day_end_utc = day_end_local.astimezone(timezone.utc).replace(tzinfo=None)

        rows = conn.execute(
            """
            SELECT type, COUNT(*)
            FROM sessions
            WHERE completed_at IS NOT NULL
              AND completed_at >= ?
              AND completed_at < ?
              AND type IN ('flashcard', 'math', 'writing', 'lesson_reading')
            GROUP BY type
            """,
            [day_start_utc, day_end_utc]
        ).fetchall()

        chinese = 0
        math = 0
        writing = 0
        lesson_reading = 0
        for row in rows:
            session_type = row[0]
            count = int(row[1] or 0)
            if session_type == 'flashcard':
                chinese = count
            elif session_type == 'math':
                math = count
            elif session_type == 'writing':
                writing = count
            elif session_type == 'lesson_reading':
                lesson_reading = count

        today_counts = {
            'total': chinese + math + writing + lesson_reading,
            'chinese': chinese,
            'math': math,
            'writing': writing,
            'lesson_reading': lesson_reading,
        }

        ungraded_row = conn.execute(
            """
            SELECT 1
            FROM sessions s
            JOIN session_results sr ON sr.session_id = s.id
            WHERE s.type = 'lesson_reading'
              AND s.completed_at IS NOT NULL
              AND sr.correct = 0
            LIMIT 1
            """,
        ).fetchone()
        has_ungraded = bool(ungraded_row)

        return today_counts, has_ungraded
    except Exception:
        return default_counts, False
    finally:
        conn.close()


def with_practice_count_fallbacks(kid):
    """Return kid object with safe count fields for count-based practice visibility."""
    safe_kid = {**kid}

    try:
        reading_count = int(safe_kid.get('sessionCardCount', DEFAULT_SESSION_CARD_COUNT))
    except (TypeError, ValueError):
        reading_count = DEFAULT_SESSION_CARD_COUNT
    reading_count = max(0, min(MAX_SESSION_CARD_COUNT, reading_count))
    safe_kid['sessionCardCount'] = reading_count

    writing_raw = safe_kid.get('writingSessionCardCount')
    if writing_raw is None:
        writing_count = 0
    else:
        try:
            writing_count = int(writing_raw)
        except (TypeError, ValueError):
            writing_count = 0
    safe_kid['writingSessionCardCount'] = max(0, min(MAX_SESSION_CARD_COUNT, writing_count))

    safe_kid['sharedMathSessionCardCount'] = normalize_shared_math_session_card_count(safe_kid)
    safe_kid['sharedMathDeckMix'] = normalize_shared_math_deck_mix(safe_kid.get('sharedMathDeckMix'))
    safe_kid['sharedLessonReadingSessionCardCount'] = normalize_shared_lesson_reading_session_card_count(safe_kid)
    safe_kid['sharedLessonReadingDeckMix'] = normalize_shared_lesson_reading_deck_mix(safe_kid.get('sharedLessonReadingDeckMix'))

    return safe_kid


@kids_bp.route('/kids', methods=['GET'])
def get_kids():
    """Get all kids"""
    try:
        family_id = current_family_id()
        if not family_id:
            return jsonify({'error': 'Family login required'}), 401
        kids = metadata.get_all_kids(family_id=family_id)

        kids_with_progress = []
        for kid in kids:
            normalized_kid = with_practice_count_fallbacks(kid)
            today_counts, has_ungraded = get_kid_dashboard_stats(kid)
            kid_with_progress = {
                **normalized_kid,
                'dailyCompletedCountToday': today_counts['total'],
                'dailyCompletedChineseCountToday': today_counts['chinese'],
                'dailyCompletedMathCountToday': today_counts['math'],
                'dailyCompletedWritingCountToday': today_counts['writing'],
                'dailyCompletedLessonReadingCountToday': today_counts.get('lesson_reading', 0),
                'hasChineseReadingToReview': has_ungraded,
            }
            kids_with_progress.append(kid_with_progress)

        return jsonify(kids_with_progress), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids', methods=['POST'])
def create_kid():
    """Create a new kid"""
    try:
        data = request.get_json()

        # Validate required fields
        if not data.get('name'):
            return jsonify({'error': 'Name is required'}), 400

        if not data.get('birthday'):
            return jsonify({'error': 'Birthday is required'}), 400

        family_id = current_family_id()
        if not family_id:
            return jsonify({'error': 'Family login required'}), 401

        # Save to metadata (ID assigned atomically inside the lock)
        kid = metadata.add_kid({
            'familyId': family_id,
            'name': data['name'],
            'birthday': data['birthday'],
            'sessionCardCount': 0,
            'writingSessionCardCount': 0,
            'hardCardPercentage': DEFAULT_HARD_CARD_PERCENTAGE,
            'sharedMathSessionCardCount': DEFAULT_SHARED_MATH_SESSION_CARD_COUNT,
            'sharedMathDeckMix': {},
            'sharedLessonReadingSessionCardCount': DEFAULT_SHARED_LESSON_READING_SESSION_CARD_COUNT,
            'sharedLessonReadingDeckMix': {},
            'createdAt': datetime.now().isoformat()
        })
        kid_id = kid['id']
        db_relpath = f"data/families/family_{family_id}/kid_{kid_id}.db"
        metadata.update_kid(kid_id, {'dbFilePath': db_relpath}, family_id)

        # Initialize kid's database
        kid_db.init_kid_database_by_path(db_relpath)

        return jsonify(kid), 201

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>', methods=['GET'])
def get_kid(kid_id):
    """Get a specific kid"""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        normalized_kid = with_practice_count_fallbacks(kid)
        today_counts, has_ungraded = get_kid_dashboard_stats(kid)
        kid_with_progress = {
            **normalized_kid,
            'dailyCompletedCountToday': today_counts['total'],
            'dailyCompletedChineseCountToday': today_counts['chinese'],
            'dailyCompletedMathCountToday': today_counts['math'],
            'dailyCompletedWritingCountToday': today_counts['writing'],
            'dailyCompletedLessonReadingCountToday': today_counts.get('lesson_reading', 0),
            'hasChineseReadingToReview': has_ungraded,
        }

        return jsonify(kid_with_progress), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/report', methods=['GET'])
def get_kid_report(kid_id):
    """Get one kid's practice history report for parent view."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        rows = conn.execute(
            """
            SELECT
                s.id,
                s.type,
                s.started_at,
                s.completed_at,
                COALESCE(s.planned_count, 0) AS planned_count,
                COUNT(sr.id) AS answer_count,
                COALESCE(SUM(CASE WHEN sr.correct > 0 THEN 1 ELSE 0 END), 0) AS right_count,
                COALESCE(SUM(CASE WHEN sr.correct < 0 THEN 1 ELSE 0 END), 0) AS wrong_count,
                COALESCE(SUM(CASE WHEN sr.response_time_ms IS NULL THEN 0 ELSE sr.response_time_ms END), 0) AS total_response_ms,
                COALESCE(AVG(sr.response_time_ms), 0) AS avg_response_ms
            FROM sessions s
            LEFT JOIN session_results sr ON sr.session_id = s.id
            GROUP BY s.id, s.type, s.started_at, s.completed_at, s.planned_count
            ORDER BY COALESCE(s.completed_at, s.started_at) DESC, s.id DESC
            """
        ).fetchall()
        conn.close()

        sessions = []
        for row in rows:
            sessions.append({
                'id': int(row[0]),
                'type': row[1],
                'started_at': row[2].isoformat() if row[2] else None,
                'completed_at': row[3].isoformat() if row[3] else None,
                'planned_count': int(row[4] or 0),
                'answer_count': int(row[5] or 0),
                'right_count': int(row[6] or 0),
                'wrong_count': int(row[7] or 0),
                'total_response_ms': int(row[8] or 0),
                'avg_response_ms': float(row[9] or 0),
            })

        return jsonify({
            'kid': {
                'id': kid.get('id'),
                'name': kid.get('name'),
            },
            'sessions': sessions
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/report/sessions/<session_id>', methods=['GET'])
def get_kid_report_session_detail(kid_id, session_id):
    """Get detailed card-level results for one session in parent report view."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        try:
            session_id_int = int(session_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid session id'}), 400

        conn = get_kid_connection_for(kid)
        session_row = conn.execute(
            """
            SELECT id, type, started_at, completed_at, COALESCE(planned_count, 0)
            FROM sessions
            WHERE id = ?
            """,
            [session_id_int]
        ).fetchone()
        if not session_row:
            conn.close()
            return jsonify({'error': 'Session not found'}), 404

        result_rows = conn.execute(
            """
            SELECT
                sr.id,
                sr.card_id,
                sr.correct,
                COALESCE(sr.response_time_ms, 0) AS response_time_ms,
                sr.timestamp,
                c.front,
                c.back,
                lra.file_name,
                lra.mime_type
            FROM session_results sr
            LEFT JOIN cards c ON c.id = sr.card_id
            LEFT JOIN lesson_reading_audio lra ON lra.result_id = sr.id
            WHERE sr.session_id = ?
            ORDER BY sr.id ASC
            """,
            [session_id_int]
        ).fetchall()
        conn.close()

        answers = []
        right_cards = []
        wrong_cards = []
        for row in result_rows:
            item = {
                'result_id': int(row[0]),
                'card_id': int(row[1]) if row[1] is not None else None,
                'correct_score': int(row[2] or 0),
                'correct': int(row[2] or 0) > 0,
                'response_time_ms': int(row[3] or 0),
                'timestamp': row[4].isoformat() if row[4] else None,
                'front': row[5] or '',
                'back': row[6] or '',
                'grade_status': ('pass' if int(row[2] or 0) > 0 else ('fail' if int(row[2] or 0) < 0 else 'unknown')),
                'audio_file_name': row[7] or None,
                'audio_mime_type': row[8] or None,
                'audio_url': f"/api/kids/{kid_id}/lesson-reading/audio/{row[7]}" if row[7] else None,
            }
            answers.append(item)
            if item['correct_score'] > 0:
                right_cards.append(item)
            elif item['correct_score'] < 0:
                wrong_cards.append(item)

        return jsonify({
            'kid': {
                'id': kid.get('id'),
                'name': kid.get('name'),
            },
            'session': {
                'id': int(session_row[0]),
                'type': session_row[1],
                'started_at': session_row[2].isoformat() if session_row[2] else None,
                'completed_at': session_row[3].isoformat() if session_row[3] else None,
                'planned_count': int(session_row[4] or 0),
                'answer_count': len(answers),
                'right_count': len(right_cards),
                'wrong_count': len(wrong_cards),
            },
            'right_cards': right_cards,
            'wrong_cards': wrong_cards,
            'answers': answers,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/report/lesson-reading/next-to-grade', methods=['GET'])
def get_kid_lesson_reading_next_to_grade(kid_id):
    """Return the latest Chinese Reading session that still has ungraded cards."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)

        ungraded_row = conn.execute(
            """
            SELECT s.id
            FROM sessions s
            JOIN session_results sr ON sr.session_id = s.id
            WHERE s.type = 'lesson_reading'
              AND s.completed_at IS NOT NULL
              AND sr.correct = 0
            GROUP BY s.id, s.completed_at
            ORDER BY s.completed_at DESC, s.id DESC
            LIMIT 1
            """
        ).fetchone()

        latest_row = conn.execute(
            """
            SELECT s.id
            FROM sessions s
            WHERE s.type = 'lesson_reading'
              AND s.completed_at IS NOT NULL
            ORDER BY s.completed_at DESC, s.id DESC
            LIMIT 1
            """
        ).fetchone()
        conn.close()

        return jsonify({
            'session_id': int(ungraded_row[0]) if ungraded_row else None,
            'latest_session_id': int(latest_row[0]) if latest_row else None,
            'has_ungraded': bool(ungraded_row),
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/report/cards/<card_id>', methods=['GET'])
def get_kid_report_card_detail(kid_id, card_id):
    """Get full practice history for one card in parent report view."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        try:
            card_id_int = int(card_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid card id'}), 400

        conn = get_kid_connection_for(kid)
        card_row = conn.execute(
            """
            SELECT
                c.id,
                c.front,
                c.back,
                c.created_at,
                COALESCE(c.hardness_score, 0) AS hardness_score,
                d.id,
                d.name
            FROM cards c
            JOIN decks d ON d.id = c.deck_id
            WHERE c.id = ?
            """,
            [card_id_int]
        ).fetchone()
        if not card_row:
            conn.close()
            return jsonify({'error': 'Card not found'}), 404

        attempts_rows = conn.execute(
            """
            SELECT
                sr.id,
                sr.correct,
                COALESCE(sr.response_time_ms, 0) AS response_time_ms,
                sr.timestamp,
                s.id AS session_id,
                s.type AS session_type,
                s.started_at,
                s.completed_at,
                lra.file_name,
                lra.mime_type
            FROM session_results sr
            JOIN sessions s ON s.id = sr.session_id
            LEFT JOIN lesson_reading_audio lra ON lra.result_id = sr.id
            WHERE sr.card_id = ?
            ORDER BY COALESCE(s.completed_at, s.started_at, sr.timestamp) ASC, sr.id ASC
            """,
            [card_id_int]
        ).fetchall()
        conn.close()

        attempts = []
        right_count = 0
        wrong_count = 0
        response_sum_ms = 0
        for row in attempts_rows:
            is_correct = int(row[1] or 0) > 0
            response_ms = int(row[2] or 0)
            attempts.append({
                'result_id': int(row[0]),
                'correct': is_correct,
                'response_time_ms': response_ms,
                'timestamp': row[3].isoformat() if row[3] else None,
                'session_id': int(row[4]) if row[4] is not None else None,
                'session_type': row[5],
                'session_started_at': row[6].isoformat() if row[6] else None,
                'session_completed_at': row[7].isoformat() if row[7] else None,
                'audio_file_name': row[8] or None,
                'audio_mime_type': row[9] or None,
                'audio_url': f"/api/kids/{kid_id}/lesson-reading/audio/{row[8]}" if row[8] else None,
            })
            response_sum_ms += response_ms
            if is_correct:
                right_count += 1
            else:
                wrong_count += 1

        attempts_count = len(attempts)
        avg_response_ms = (response_sum_ms / attempts_count) if attempts_count > 0 else 0
        accuracy_pct = ((right_count * 100.0) / attempts_count) if attempts_count > 0 else 0

        return jsonify({
            'kid': {
                'id': kid.get('id'),
                'name': kid.get('name'),
            },
            'card': {
                'id': int(card_row[0]),
                'front': card_row[1] or '',
                'back': card_row[2] or '',
                'created_at': card_row[3].isoformat() if card_row[3] else None,
                'hardness_score': float(card_row[4] or 0),
                'deck_id': int(card_row[5]) if card_row[5] is not None else None,
                'deck_name': card_row[6] or '',
            },
            'summary': {
                'attempt_count': attempts_count,
                'right_count': right_count,
                'wrong_count': wrong_count,
                'accuracy_pct': accuracy_pct,
                'avg_response_ms': avg_response_ms,
            },
            'attempts': attempts,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/report/sessions/<session_id>/results/<result_id>/grade', methods=['PUT'])
def grade_kid_report_session_result(kid_id, session_id, result_id):
    """Persist parent pass/fail grade for one session result row."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        try:
            session_id_int = int(session_id)
            result_id_int = int(result_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid session id or result id'}), 400

        data = request.get_json() or {}
        review_grade_raw = str(data.get('reviewGrade') or '').strip().lower()
        if review_grade_raw not in ('pass', 'fail'):
            return jsonify({'error': 'reviewGrade must be "pass" or "fail"'}), 400

        conn = get_kid_connection_for(kid)
        target = conn.execute(
            """
            SELECT sr.id, sr.correct
            FROM session_results sr
            JOIN sessions s ON s.id = sr.session_id
            WHERE sr.id = ? AND sr.session_id = ?
              AND s.type = 'lesson_reading'
            LIMIT 1
            """,
            [result_id_int, session_id_int]
        ).fetchone()
        if not target:
            conn.close()
            return jsonify({'error': 'Session result not found'}), 404

        current_correct = int(target[1] or 0)
        if current_correct != 0:
            status = 'pass' if current_correct > 0 else 'fail'
            conn.close()
            return jsonify({
                'error': 'This card has already been graded and cannot be changed.',
                'result_id': result_id_int,
                'grade_status': status,
            }), 409

        mapped_correct = 1 if review_grade_raw == 'pass' else -1
        conn.execute(
            "UPDATE session_results SET correct = ? WHERE id = ?",
            [mapped_correct, result_id_int]
        )
        conn.close()

        return jsonify({
            'result_id': result_id_int,
            'correct_score': mapped_correct,
            'grade_status': review_grade_raw,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>', methods=['PUT'])
def update_kid(kid_id):
    """Update a specific kid's metadata"""
    try:
        family_id = current_family_id()
        if not family_id:
            return jsonify({'error': 'Family login required'}), 401
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        data = request.get_json() or {}
        updates = {}

        if 'sessionCardCount' in data:
            try:
                session_card_count = int(data['sessionCardCount'])
            except (TypeError, ValueError):
                return jsonify({'error': 'sessionCardCount must be an integer'}), 400

            if session_card_count < 0 or session_card_count > MAX_SESSION_CARD_COUNT:
                return jsonify({'error': f'sessionCardCount must be between 0 and {MAX_SESSION_CARD_COUNT}'}), 400

            updates['sessionCardCount'] = session_card_count

        if 'writingSessionCardCount' in data:
            try:
                writing_session_card_count = int(data['writingSessionCardCount'])
            except (TypeError, ValueError):
                return jsonify({'error': 'writingSessionCardCount must be an integer'}), 400

            if writing_session_card_count < 0 or writing_session_card_count > MAX_SESSION_CARD_COUNT:
                return jsonify({'error': f'writingSessionCardCount must be between 0 and {MAX_SESSION_CARD_COUNT}'}), 400

            updates['writingSessionCardCount'] = writing_session_card_count

        if 'hardCardPercentage' in data:
            try:
                hard_pct = int(data['hardCardPercentage'])
            except (TypeError, ValueError):
                return jsonify({'error': 'hardCardPercentage must be an integer'}), 400

            if hard_pct < MIN_HARD_CARD_PERCENTAGE or hard_pct > MAX_HARD_CARD_PERCENTAGE:
                return jsonify({'error': f'hardCardPercentage must be between {MIN_HARD_CARD_PERCENTAGE} and {MAX_HARD_CARD_PERCENTAGE}'}), 400

            updates['hardCardPercentage'] = hard_pct

        if 'sharedMathSessionCardCount' in data:
            try:
                shared_math_session_count = int(data['sharedMathSessionCardCount'])
            except (TypeError, ValueError):
                return jsonify({'error': 'sharedMathSessionCardCount must be an integer'}), 400

            if shared_math_session_count < 0 or shared_math_session_count > MAX_SESSION_CARD_COUNT:
                return jsonify({'error': f'sharedMathSessionCardCount must be between 0 and {MAX_SESSION_CARD_COUNT}'}), 400

            updates['sharedMathSessionCardCount'] = shared_math_session_count

        if 'sharedMathDeckMix' in data:
            if not isinstance(data['sharedMathDeckMix'], dict):
                return jsonify({'error': 'sharedMathDeckMix must be an object'}), 400
            updates['sharedMathDeckMix'] = normalize_shared_math_deck_mix(data['sharedMathDeckMix'])

        if 'sharedLessonReadingSessionCardCount' in data:
            try:
                shared_lesson_reading_session_count = int(data['sharedLessonReadingSessionCardCount'])
            except (TypeError, ValueError):
                return jsonify({'error': 'sharedLessonReadingSessionCardCount must be an integer'}), 400

            if shared_lesson_reading_session_count < 0 or shared_lesson_reading_session_count > MAX_SESSION_CARD_COUNT:
                return jsonify({'error': f'sharedLessonReadingSessionCardCount must be between 0 and {MAX_SESSION_CARD_COUNT}'}), 400

            updates['sharedLessonReadingSessionCardCount'] = shared_lesson_reading_session_count

        if 'sharedLessonReadingDeckMix' in data:
            if not isinstance(data['sharedLessonReadingDeckMix'], dict):
                return jsonify({'error': 'sharedLessonReadingDeckMix must be an object'}), 400
            updates['sharedLessonReadingDeckMix'] = normalize_shared_lesson_reading_deck_mix(data['sharedLessonReadingDeckMix'])

        if not updates:
            return jsonify({'error': 'No supported fields to update'}), 400

        updated_kid = metadata.update_kid(kid_id, updates, family_id=family_id)
        if not updated_kid:
            return jsonify({'error': 'Kid not found'}), 404

        return jsonify(updated_kid), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>', methods=['DELETE'])
def delete_kid(kid_id):
    """Delete a kid and their database"""
    try:
        auth_err = require_critical_password()
        if auth_err:
            return auth_err
        family_id = current_family_id()
        if not family_id:
            return jsonify({'error': 'Family login required'}), 401
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        # Delete database file
        kid_db.delete_kid_database_by_path(kid.get('dbFilePath') or get_kid_scoped_db_relpath(kid))
        audio_dir = get_kid_writing_audio_dir(kid)
        if os.path.exists(audio_dir):
            shutil.rmtree(audio_dir, ignore_errors=True)
        lesson_audio_dir = get_kid_lesson_reading_audio_dir(kid)
        if os.path.exists(lesson_audio_dir):
            shutil.rmtree(lesson_audio_dir, ignore_errors=True)

        # Delete from metadata
        metadata.delete_kid(kid_id, family_id=family_id)

        return jsonify({'message': 'Kid deleted successfully'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# Card routes

def get_or_create_default_deck(conn):
    """Get or create the default deck for a kid"""
    result = conn.execute("SELECT id FROM decks WHERE name = 'Chinese Characters'").fetchone()

    if result:
        return result[0]

    row = conn.execute(
        """
        INSERT INTO decks (name, description, tags)
        VALUES (?, ?, ?)
        RETURNING id
        """,
        ['Chinese Characters', 'Default deck for Chinese characters', []]
    ).fetchone()

    return row[0]


def get_or_create_math_orphan_deck(conn):
    """Get or create the reserved orphan deck for detached math cards."""
    result = conn.execute(
        "SELECT id FROM decks WHERE name = ?",
        [MATH_ORPHAN_DECK_NAME]
    ).fetchone()
    if result:
        return int(result[0])

    row = conn.execute(
        """
        INSERT INTO decks (name, description, tags)
        VALUES (?, ?, ?)
        RETURNING id
        """,
        [MATH_ORPHAN_DECK_NAME, 'Reserved deck for orphaned math cards', ['math', 'orphan']]
    ).fetchone()
    return int(row[0])


def get_or_create_writing_deck(conn):
    """Get or create the default writing deck for a kid."""
    result = conn.execute("SELECT id FROM decks WHERE name = 'Chinese Character Writing'").fetchone()
    if result:
        return result[0]

    row = conn.execute(
        """
        INSERT INTO decks (name, description, tags)
        VALUES (?, ?, ?)
        RETURNING id
        """,
        ['Chinese Character Writing', 'Default deck for Chinese character writing', ['writing']]
    ).fetchone()
    return row[0]


def get_or_create_lesson_reading_orphan_deck(conn):
    """Get or create the reserved orphan deck for detached chinese-reading cards."""
    result = conn.execute(
        "SELECT id FROM decks WHERE name = ?",
        [LESSON_READING_ORPHAN_DECK_NAME]
    ).fetchone()
    if result:
        return int(result[0])

    row = conn.execute(
        """
        INSERT INTO decks (name, description, tags)
        VALUES (?, ?, ?)
        RETURNING id
        """,
        [LESSON_READING_ORPHAN_DECK_NAME, 'Reserved deck for orphaned chinese-reading cards', ['chinese_reading', 'orphan']]
    ).fetchone()
    return int(row[0])


def split_writing_bulk_text(raw_text):
    """Split bulk writing input by non-Chinese chars, preserving Chinese phrase chunks."""
    text = str(raw_text or '')
    # Match contiguous Chinese runs; separators are any non-Chinese chars.
    chunks = re.findall(r'[\u3400-\u9FFF\uF900-\uFAFF]+', text)
    deduped = []
    seen = set()
    for chunk in chunks:
        token = chunk.strip()
        if not token or token in seen:
            continue
        deduped.append(token)
        seen.add(token)
    return deduped


def cleanup_incomplete_sessions_for_all_kids():
    """Delete incomplete sessions (completed_at IS NULL) across all kid DBs at startup."""
    cleaned_kids = 0
    failed_kids = 0
    deleted_sessions = 0
    deleted_results = 0
    deleted_lesson_audio = 0

    for kid in metadata.get_all_kids():
        conn = None
        try:
            conn = get_kid_connection_for(kid)
            incomplete_ids = [
                int(row[0]) for row in conn.execute(
                    "SELECT id FROM sessions WHERE completed_at IS NULL"
                ).fetchall()
            ]
            if len(incomplete_ids) == 0:
                cleaned_kids += 1
                conn.close()
                conn = None
                continue

            placeholders = ','.join(['?'] * len(incomplete_ids))
            removed_lesson_audio = conn.execute(
                f"""
                DELETE FROM lesson_reading_audio
                WHERE result_id IN (
                    SELECT id FROM session_results WHERE session_id IN ({placeholders})
                )
                RETURNING result_id
                """,
                incomplete_ids
            ).fetchall()
            removed_results = conn.execute(
                f"DELETE FROM session_results WHERE session_id IN ({placeholders}) RETURNING id",
                incomplete_ids
            ).fetchall()
            removed_sessions = conn.execute(
                f"DELETE FROM sessions WHERE id IN ({placeholders}) RETURNING id",
                incomplete_ids
            ).fetchall()

            deleted_lesson_audio += len(removed_lesson_audio)
            deleted_results += len(removed_results)
            deleted_sessions += len(removed_sessions)
            cleaned_kids += 1
            conn.close()
            conn = None
        except Exception:
            failed_kids += 1
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

    return {
        'cleanedKids': cleaned_kids,
        'failedKids': failed_kids,
        'deletedSessions': deleted_sessions,
        'deletedResults': deleted_results,
        'deletedLessonReadingAudio': deleted_lesson_audio,
    }


def _cleanup_expired_pending_sessions():
    now = time.time()
    expired_keys = [
        key for key, payload in _PENDING_SESSIONS.items()
        if now - float(payload.get('created_at_ts', 0)) > PENDING_SESSION_TTL_SECONDS
    ]
    for key in expired_keys:
        payload = _PENDING_SESSIONS.pop(key, None)
        if not payload:
            continue
        if str(payload.get('session_type')) != 'lesson_reading':
            continue
        cleanup_lesson_reading_pending_audio_files_by_payload(payload)


def create_pending_session(kid_id, session_type, payload):
    """Store one in-memory pending session and return its token."""
    token = uuid.uuid4().hex
    record = {
        **(payload or {}),
        'kid_id': str(kid_id),
        'session_type': str(session_type),
        'created_at_ts': time.time(),
    }
    with _PENDING_SESSIONS_LOCK:
        _cleanup_expired_pending_sessions()
        _PENDING_SESSIONS[token] = record
    return token


def pop_pending_session(token, kid_id, session_type):
    """Pop one pending session token if it matches kid/type."""
    if not token:
        return None
    with _PENDING_SESSIONS_LOCK:
        _cleanup_expired_pending_sessions()
        payload = _PENDING_SESSIONS.pop(str(token), None)
    if not payload:
        return None
    if str(payload.get('kid_id')) != str(kid_id):
        if str(payload.get('session_type')) == 'lesson_reading':
            cleanup_lesson_reading_pending_audio_files_by_payload(payload)
        return None
    if str(payload.get('session_type')) != str(session_type):
        if str(payload.get('session_type')) == 'lesson_reading':
            cleanup_lesson_reading_pending_audio_files_by_payload(payload)
        return None
    return payload


def get_pending_session(token, kid_id, session_type):
    """Get one pending session token without removing it."""
    if not token:
        return None
    with _PENDING_SESSIONS_LOCK:
        _cleanup_expired_pending_sessions()
        payload = _PENDING_SESSIONS.get(str(token))
        if not payload:
            return None
        if str(payload.get('kid_id')) != str(kid_id):
            return None
        if str(payload.get('session_type')) != str(session_type):
            return None
        return payload


def parse_client_started_at(raw_started_at, pending=None):
    """Parse client-provided session start time into naive UTC datetime."""
    dt = None

    if isinstance(raw_started_at, (int, float)):
        try:
            dt = datetime.fromtimestamp(float(raw_started_at) / 1000.0, tz=timezone.utc)
        except Exception:
            dt = None
    elif isinstance(raw_started_at, str):
        text = raw_started_at.strip()
        if text:
            try:
                if re.fullmatch(r'\d+(\.\d+)?', text):
                    dt = datetime.fromtimestamp(float(text) / 1000.0, tz=timezone.utc)
                else:
                    normalized = text.replace('Z', '+00:00')
                    parsed = datetime.fromisoformat(normalized)
                    if parsed.tzinfo is None:
                        dt = parsed.replace(tzinfo=timezone.utc)
                    else:
                        dt = parsed.astimezone(timezone.utc)
            except Exception:
                dt = None

    if dt is None and isinstance(pending, dict):
        created_at_ts = pending.get('created_at_ts')
        try:
            if created_at_ts is not None:
                dt = datetime.fromtimestamp(float(created_at_ts), tz=timezone.utc)
        except Exception:
            dt = None

    if dt is None:
        dt = datetime.now(timezone.utc)

    return dt.replace(tzinfo=None)


def filter_answers_to_pending_cards(answers, pending):
    """Keep only one answer per planned pending card; ignore extras/unplanned cards."""
    if not isinstance(answers, list):
        return []
    if not isinstance(pending, dict):
        return []

    planned_cards = pending.get('cards')
    if not isinstance(planned_cards, list) or len(planned_cards) == 0:
        return []

    allowed_ids = set()
    for item in planned_cards:
        if not isinstance(item, dict):
            continue
        try:
            card_id = int(item.get('id'))
        except (TypeError, ValueError):
            continue
        if card_id > 0:
            allowed_ids.add(card_id)
    if len(allowed_ids) == 0:
        return []

    filtered = []
    seen = set()
    for answer in answers:
        if not isinstance(answer, dict):
            continue
        try:
            card_id = int(answer.get('cardId'))
        except (TypeError, ValueError):
            continue
        if card_id <= 0 or card_id in seen:
            continue
        if card_id not in allowed_ids:
            continue
        filtered.append({**answer, 'cardId': card_id})
        seen.add(card_id)
    return filtered


def plan_deck_pending_session(conn, kid, kid_id, deck_id, session_type, excluded_card_ids=None):
    """Plan one pending deck session without mutating DB state."""
    cards_by_id, selected_ids = plan_deck_practice_selection(
        conn,
        kid,
        deck_id,
        session_type,
        excluded_card_ids=excluded_card_ids,
    )
    if len(selected_ids) == 0:
        return None, []

    pending_token = create_pending_session(
        kid_id,
        session_type,
        {
            'kind': 'deck',
            'deck_id': int(deck_id),
            'planned_count': len(selected_ids),
            'cards': [{'id': int(card_id)} for card_id in selected_ids],
        }
    )
    selected_cards = [cards_by_id[card_id] for card_id in selected_ids]
    return pending_token, selected_cards


def _get_deck_practice_rankings(conn, deck_id, session_type, excluded_card_ids=None):
    """Return candidate ids and deterministic ranking inputs for one deck."""
    excluded_set = set(excluded_card_ids or [])
    excluded_ids = sorted(excluded_set)
    exclude_clause = ""
    params = [session_type, deck_id]
    if len(excluded_ids) > 0:
        placeholders = ','.join(['?'] * len(excluded_ids))
        exclude_clause = f" AND c.id NOT IN ({placeholders})"
        params.extend(excluded_ids)

    rows = conn.execute(
        f"""
        WITH last_session AS (
            SELECT id
            FROM sessions
            WHERE type = ? AND completed_at IS NOT NULL
            ORDER BY completed_at DESC
            LIMIT 1
        ),
        attempts AS (
            SELECT sr.card_id, COUNT(sr.id) AS lifetime_attempts
            FROM session_results sr
            GROUP BY sr.card_id
        ),
        red AS (
            SELECT sr.card_id, MIN(sr.timestamp) AS first_red_at
            FROM session_results sr
            JOIN last_session ls ON ls.id = sr.session_id
            WHERE sr.correct < 0 AND sr.card_id IS NOT NULL
            GROUP BY sr.card_id
        )
        SELECT
            c.id,
            c.front,
            c.back,
            c.created_at,
            c.hardness_score,
            COALESCE(a.lifetime_attempts, 0) AS lifetime_attempts,
            r.first_red_at
        FROM cards c
        LEFT JOIN attempts a ON a.card_id = c.id
        LEFT JOIN red r ON r.card_id = c.id
        WHERE c.deck_id = ? AND COALESCE(c.skip_practice, FALSE) = FALSE
        {exclude_clause}
        ORDER BY c.id ASC
        """,
        params
    ).fetchall()

    if len(rows) == 0:
        return {}, [], [], [], []

    cards_by_id = {
        row[0]: {
            'id': row[0],
            'front': row[1],
            'back': row[2],
            'created_at': row[3].isoformat() if row[3] else None
        }
        for row in rows
    }
    candidate_ids = [row[0] for row in rows]

    red_rows = [row for row in rows if row[6] is not None]
    red_rows.sort(key=lambda row: (row[6], row[0]))
    red_card_ids = [row[0] for row in red_rows]

    hard_ranked_ids = [
        row[0]
        for row in sorted(
            rows,
            key=lambda row: (-float(row[4] if row[4] is not None else 0), row[0])
        )
    ]
    attempt_ranked_ids = [
        row[0]
        for row in sorted(
            rows,
            key=lambda row: (int(row[5] if row[5] is not None else 0), row[0])
        )
    ]

    return cards_by_id, candidate_ids, red_card_ids, hard_ranked_ids, attempt_ranked_ids


def _select_session_card_ids(kid, candidate_ids, red_card_ids, hard_ranked_ids, attempt_ranked_ids):
    """Select one session-sized card list from ranking inputs."""
    base_target_count = min(normalize_session_card_count(kid), len(candidate_ids))
    if base_target_count <= 0:
        return []

    selected_ids = []
    selected_set = set()

    for card_id in red_card_ids:
        if card_id not in selected_set:
            selected_ids.append(card_id)
            selected_set.add(card_id)

    target_count = base_target_count
    if len(selected_ids) > target_count:
        selected_ids = selected_ids[:target_count]
        selected_set = set(selected_ids)

    remaining_slots = max(0, target_count - len(selected_ids))
    hard_pct = normalize_hard_card_percentage(kid)
    if hard_pct <= 0 or remaining_slots <= 0:
        hard_target = 0
    else:
        hard_target = min(remaining_slots, int(math.ceil((remaining_slots * hard_pct) / 100.0)))

    if hard_target > 0:
        for card_id in hard_ranked_ids:
            if len(selected_ids) >= target_count:
                break
            if hard_target <= 0:
                break
            if card_id in selected_set:
                continue
            selected_ids.append(card_id)
            selected_set.add(card_id)
            hard_target -= 1

    if len(selected_ids) < target_count:
        for card_id in attempt_ranked_ids:
            if len(selected_ids) >= target_count:
                break
            if card_id in selected_set:
                continue
            selected_ids.append(card_id)
            selected_set.add(card_id)
    return selected_ids


def preview_deck_practice_order(conn, kid, deck_id, session_type, excluded_card_ids=None):
    """Preview full deck order for next-session priority (not just first session size)."""
    _, candidate_ids, red_card_ids, hard_ranked_ids, attempt_ranked_ids = _get_deck_practice_rankings(
        conn,
        deck_id,
        session_type,
        excluded_card_ids=excluded_card_ids,
    )
    if len(candidate_ids) == 0:
        return []

    first_session_ids = _select_session_card_ids(
        kid,
        candidate_ids,
        red_card_ids,
        hard_ranked_ids,
        attempt_ranked_ids,
    )
    ordered_ids = []
    seen = set()
    for card_id in first_session_ids:
        if card_id not in seen:
            ordered_ids.append(card_id)
            seen.add(card_id)
    for card_id in attempt_ranked_ids:
        if card_id not in seen:
            ordered_ids.append(card_id)
            seen.add(card_id)
    for card_id in candidate_ids:
        if card_id not in seen:
            ordered_ids.append(card_id)
            seen.add(card_id)
    return ordered_ids


def plan_deck_practice_selection(conn, kid, deck_id, session_type, excluded_card_ids=None):
    """Build deterministic session card selection: red -> hard -> least lifetime attempts."""
    cards_by_id, candidate_ids, red_card_ids, hard_ranked_ids, attempt_ranked_ids = _get_deck_practice_rankings(
        conn,
        deck_id,
        session_type,
        excluded_card_ids=excluded_card_ids,
    )
    if len(candidate_ids) == 0:
        return cards_by_id, []
    selected_ids = _select_session_card_ids(
        kid,
        candidate_ids,
        red_card_ids,
        hard_ranked_ids,
        attempt_ranked_ids,
    )
    return cards_by_id, selected_ids


def complete_session_internal(kid, kid_id, session_type, data):
    """Complete a session by saving all answers in one batch."""
    pending_session_id = data.get('pendingSessionId')
    if not pending_session_id:
        return {'error': 'pendingSessionId is required'}, 400
    answers = data.get('answers')
    if not isinstance(answers, list) or len(answers) == 0:
        return {'error': 'answers must be a non-empty list'}, 400

    pending = pop_pending_session(pending_session_id, kid_id, session_type)
    if not pending:
        return {'error': 'Pending session not found or expired'}, 404
    answers = filter_answers_to_pending_cards(answers, pending)
    if len(answers) == 0:
        return {'error': 'answers do not match this pending session'}, 400
    started_at_utc = parse_client_started_at(data.get('startedAt'), pending)
    completed_at_utc = datetime.now(timezone.utc).replace(tzinfo=None)

    conn = get_kid_connection_for(kid)
    deck_id = pending.get('deck_id') if pending.get('kind') == 'deck' else None
    planned_count = int(pending.get('planned_count') or 0)
    uploaded_lesson_audio = data.get('_uploaded_lesson_audio_by_card') if session_type == 'lesson_reading' else {}
    if not isinstance(uploaded_lesson_audio, dict):
        uploaded_lesson_audio = {}
    pending_lesson_audio = pending.get('lesson_audio_by_card') if session_type == 'lesson_reading' else {}
    if not isinstance(pending_lesson_audio, dict):
        pending_lesson_audio = {}
    written_lesson_audio_paths = []

    # Validate answers before starting transaction
    for answer in answers:
        card_id = answer.get('cardId')
        known = answer.get('known')
        if not card_id or not isinstance(known, bool):
            conn.close()
            if session_type == 'lesson_reading':
                cleanup_lesson_reading_pending_audio_files(kid, pending)
            return {'error': 'Each answer needs cardId (int) and known (bool)'}, 400

    try:
        conn.execute("BEGIN TRANSACTION")

        session_id = conn.execute(
            """
            INSERT INTO sessions (type, deck_id, planned_count, started_at, completed_at)
            VALUES (?, ?, ?, ?, ?)
            RETURNING id
            """,
            [session_type, deck_id, planned_count, started_at_utc, completed_at_utc]
        ).fetchone()[0]

        latest_response_by_card = {}
        touched_card_ids = set()
        consumed_lesson_audio_files = set()
        for answer in answers:
            card_id = answer.get('cardId')
            known = answer.get('known')
            try:
                response_time_ms = int(answer.get('responseTimeMs'))
            except (TypeError, ValueError):
                response_time_ms = 0
            if session_type == 'lesson_reading':
                correct_value = 0
            else:
                correct_value = 1 if bool(known) else -1

            result_row = conn.execute(
                """
                INSERT INTO session_results (session_id, card_id, correct, response_time_ms)
                VALUES (?, ?, ?, ?)
                RETURNING id
                """,
                [session_id, card_id, correct_value, response_time_ms]
            ).fetchone()
            result_id = int(result_row[0])
            latest_response_by_card[card_id] = response_time_ms
            touched_card_ids.add(card_id)

            if session_type == 'lesson_reading':
                uploaded_audio = uploaded_lesson_audio.get(card_id)
                if uploaded_audio is None:
                    uploaded_audio = uploaded_lesson_audio.get(str(card_id))
                if isinstance(uploaded_audio, dict):
                    audio_bytes = uploaded_audio.get('bytes')
                    if not isinstance(audio_bytes, (bytes, bytearray)) or len(audio_bytes) == 0:
                        raise ValueError(f'Uploaded audio for card {card_id} is empty')
                    mime_type = str(uploaded_audio.get('mime_type') or 'application/octet-stream').strip()
                    original_filename = str(uploaded_audio.get('filename') or '').strip()
                    safe_name = secure_filename(original_filename)
                    ext = os.path.splitext(safe_name)[1].lower()
                    if not ext:
                        guessed_ext = mimetypes.guess_extension(mime_type) or ''
                        ext = guessed_ext.lower() if guessed_ext else '.webm'
                    audio_dir = ensure_lesson_reading_audio_dir(kid)
                    file_name = f"lr_{pending_session_id}_{card_id}_{uuid.uuid4().hex}{ext}"
                    file_path = os.path.join(audio_dir, file_name)
                    with open(file_path, 'wb') as f:
                        f.write(bytes(audio_bytes))
                    written_lesson_audio_paths.append(file_path)
                    conn.execute(
                        """
                        INSERT INTO lesson_reading_audio (result_id, file_name, mime_type)
                        VALUES (?, ?, ?)
                        """,
                        [result_id, file_name, mime_type]
                    )
                    consumed_lesson_audio_files.add(file_name)
                else:
                    audio_meta = pending_lesson_audio.get(str(card_id))
                    if isinstance(audio_meta, dict):
                        file_name = str(audio_meta.get('file_name') or '').strip()
                        mime_type = str(audio_meta.get('mime_type') or 'application/octet-stream').strip()
                        if file_name:
                            conn.execute(
                                """
                                INSERT INTO lesson_reading_audio (result_id, file_name, mime_type)
                                VALUES (?, ?, ?)
                                """,
                                [result_id, file_name, mime_type]
                            )
                            consumed_lesson_audio_files.add(file_name)

        if session_type in ('flashcard', 'math', 'lesson_reading'):
            for card_id, latest_ms in latest_response_by_card.items():
                conn.execute(
                    "UPDATE cards SET hardness_score = ? WHERE id = ?",
                    [float(latest_ms or 0), card_id]
                )
        elif session_type == 'writing' and len(touched_card_ids) > 0:
            placeholders = ','.join(['?'] * len(touched_card_ids))
            conn.execute(
                f"""
                UPDATE cards
                SET hardness_score = stats.hardness_score
                FROM (
                    SELECT
                        sr.card_id,
                        COALESCE(100.0 - (100.0 * AVG(CASE WHEN sr.correct > 0 THEN 1.0 ELSE 0.0 END)), 0) AS hardness_score
                    FROM session_results sr
                    JOIN sessions s ON s.id = sr.session_id
                    WHERE s.type = 'writing'
                      AND sr.card_id IN ({placeholders})
                    GROUP BY sr.card_id
                ) AS stats
                WHERE cards.id = stats.card_id
                """,
                list(touched_card_ids)
            )

        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        conn.close()
        for file_path in written_lesson_audio_paths:
            try:
                if os.path.exists(file_path):
                    os.remove(file_path)
            except Exception:
                pass
        if session_type == 'lesson_reading':
            cleanup_lesson_reading_pending_audio_files(kid, pending)
        raise

    conn.close()
    if session_type == 'lesson_reading' and isinstance(pending_lesson_audio, dict):
        leftovers = {}
        for item in pending_lesson_audio.values():
            if not isinstance(item, dict):
                continue
            file_name = str(item.get('file_name') or '').strip()
            if file_name and file_name not in consumed_lesson_audio_files:
                leftovers[file_name] = item
        if len(leftovers) > 0:
            cleanup_lesson_reading_pending_audio_files(
                kid,
                {
                    'lesson_audio_dir': pending.get('lesson_audio_dir'),
                    'lesson_audio_by_card': {name: meta for name, meta in leftovers.items()},
                }
            )
    return {
        'session_id': session_id,
        'answer_count': len(answers),
        'planned_count': planned_count,
        'completed': True
    }, 200


def delete_card_from_deck_internal(conn, card_id):
    """Delete one card from a deck."""
    conn.execute("DELETE FROM cards WHERE id = ?", [card_id])


def get_cards_with_stats(conn, deck_id):
    """Return cards with hardness / attempt / last-seen stats."""
    return conn.execute(
        """
        SELECT
            c.id,
            c.deck_id,
            c.front,
            c.back,
            COALESCE(c.skip_practice, FALSE) AS skip_practice,
            c.hardness_score,
            c.created_at,
            COUNT(sr.id) AS lifetime_attempts,
            MAX(sr.timestamp) AS last_seen_at
        FROM cards c
        LEFT JOIN session_results sr ON c.id = sr.card_id
        WHERE c.deck_id = ?
        GROUP BY c.id, c.deck_id, c.front, c.back, c.skip_practice, c.hardness_score, c.created_at
        ORDER BY c.id ASC
        """,
        [deck_id]
    ).fetchall()


def map_card_row(row, preview_order):
    """Map raw card+stats row to API object."""
    return {
        'id': row[0],
        'deck_id': row[1],
        'front': row[2],
        'back': row[3],
        'skip_practice': bool(row[4]),
        'hardness_score': float(row[5]) if row[5] is not None else 0,
        'created_at': row[6].isoformat() if row[6] else None,
        'next_session_order': preview_order.get(row[0]),
        'lifetime_attempts': int(row[7]) if row[7] is not None else 0,
        'last_seen_at': row[8].isoformat() if row[8] else None
    }


def get_pending_writing_card_ids(conn):
    """Return card ids currently blocked by pending writing sheets."""
    rows = conn.execute(
        """
        SELECT DISTINCT wsc.card_id
        FROM writing_sheet_cards wsc
        JOIN writing_sheets ws ON ws.id = wsc.sheet_id
        WHERE ws.status = 'pending'
        """
    ).fetchall()
    return [int(row[0]) for row in rows]


@kids_bp.route('/kids/<kid_id>/cards', methods=['GET'])
def get_cards(kid_id):
    """Get all cards for a kid, with timing stats and next-session preview order."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_default_deck(conn)
        preview_ids = preview_deck_practice_order(conn, kid, deck_id, 'flashcard')
        preview_order = {card_id: i + 1 for i, card_id in enumerate(preview_ids)}

        cards = get_cards_with_stats(conn, deck_id)

        conn.close()

        card_list = [map_card_row(card, preview_order) for card in cards]

        return jsonify({'deck_id': deck_id, 'cards': card_list}), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/cards', methods=['POST'])
def add_card(kid_id):
    """Add a new card for a kid"""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        data = request.get_json()

        if not data.get('front'):
            return jsonify({'error': 'Front text is required'}), 400

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_default_deck(conn)

        card_id = conn.execute(
            """
            INSERT INTO cards (deck_id, front, back)
            VALUES (?, ?, ?)
            RETURNING id
            """,
            [
                deck_id,
                data['front'],
                data.get('back', '')
            ]
        ).fetchone()[0]

        card = conn.execute(
            """
            SELECT id, deck_id, front, back, created_at
            FROM cards
            WHERE id = ?
            """,
            [card_id]
        ).fetchone()

        conn.close()

        card_obj = {
            'id': card[0],
            'deck_id': card[1],
            'front': card[2],
            'back': card[3],
            'created_at': card[4].isoformat() if card[4] else None
        }

        return jsonify(card_obj), 201

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/cards/bulk', methods=['POST'])
def add_cards_bulk(kid_id):
    """Add multiple cards at once"""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        data = request.get_json()
        items = data.get('cards', [])

        if not items:
            return jsonify({'error': 'No cards provided'}), 400

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_default_deck(conn)

        created = []
        for item in items:
            front = (item.get('front') or '').strip()
            if not front:
                continue
            card_id = conn.execute(
                "INSERT INTO cards (deck_id, front, back) VALUES (?, ?, ?) RETURNING id",
                [deck_id, front, item.get('back', '')]
            ).fetchone()[0]
            created.append({'id': card_id, 'front': front})

        conn.close()

        return jsonify({'created': len(created), 'cards': created}), 201

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/cards/<card_id>', methods=['DELETE'])
def delete_card(kid_id, card_id):
    """Delete a card"""
    try:
        auth_err = require_critical_password()
        if auth_err:
            return auth_err
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)

        card = conn.execute("SELECT id FROM cards WHERE id = ?", [card_id]).fetchone()
        if not card:
            conn.close()
            return jsonify({'error': 'Card not found'}), 404
        delete_card_from_deck_internal(conn, card_id)

        conn.close()

        return jsonify({'message': 'Card deleted successfully'}), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/practice/start', methods=['POST'])
def start_practice_session(kid_id):
    """Start a practice session using red-first + hard + least-attempt selection."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_default_deck(conn)
        pending_session_id, selected_cards = plan_deck_pending_session(
            conn, kid, kid_id, deck_id, 'flashcard'
        )

        conn.close()
        if not pending_session_id:
            return jsonify({'pending_session_id': None, 'cards': [], 'planned_count': 0}), 200

        return jsonify({
            'pending_session_id': pending_session_id,
            'cards': selected_cards,
            'planned_count': len(selected_cards)
        }), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/math/shared-decks', methods=['GET'])
def get_kid_math_shared_decks(kid_id):
    """List global shared math decks and whether this kid already opted into each."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        shared_conn = None
        kid_conn = None
        orphan_deck_payload = None
        local_by_shared_id = {}
        local_card_count_by_deck_id = {}
        try:
            shared_conn = get_shared_decks_connection()
            decks = get_shared_math_deck_rows(shared_conn)

            kid_conn = get_kid_connection_for(kid)
            materialized_by_local_id = get_kid_materialized_shared_math_decks(kid_conn)
            for entry in materialized_by_local_id.values():
                shared_deck_id = int(entry['shared_deck_id'])
                existing = local_by_shared_id.get(shared_deck_id)
                if existing is None or int(entry['local_deck_id']) < int(existing['local_deck_id']):
                    local_by_shared_id[shared_deck_id] = entry

            local_deck_ids = [int(deck_id) for deck_id in materialized_by_local_id.keys()]
            if local_deck_ids:
                placeholders = ','.join(['?'] * len(local_deck_ids))
                card_count_rows = kid_conn.execute(
                    f"""
                    SELECT deck_id, COUNT(*) AS card_count
                    FROM cards
                    WHERE deck_id IN ({placeholders})
                    GROUP BY deck_id
                    """,
                    local_deck_ids
                ).fetchall()
                local_card_count_by_deck_id = {
                    int(row[0]): int(row[1] or 0)
                    for row in card_count_rows
                }

            orphan_row = kid_conn.execute(
                "SELECT id, name FROM decks WHERE name = ? LIMIT 1",
                [MATH_ORPHAN_DECK_NAME]
            ).fetchone()
            if orphan_row:
                orphan_deck_id = int(orphan_row[0])
                orphan_name = str(orphan_row[1] or MATH_ORPHAN_DECK_NAME)
                orphan_total = int(kid_conn.execute(
                    "SELECT COUNT(*) FROM cards WHERE deck_id = ?",
                    [orphan_deck_id]
                ).fetchone()[0] or 0)
                if orphan_total > 0:
                    orphan_active = int(kid_conn.execute(
                        "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = FALSE",
                        [orphan_deck_id]
                    ).fetchone()[0] or 0)
                    orphan_skipped = int(kid_conn.execute(
                        "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = TRUE",
                        [orphan_deck_id]
                    ).fetchone()[0] or 0)
                    orphan_deck_payload = {
                        'deck_id': orphan_deck_id,
                        'name': orphan_name,
                        'card_count': orphan_total,
                        'active_card_count': orphan_active,
                        'skipped_card_count': orphan_skipped,
                    }
        finally:
            if kid_conn is not None:
                kid_conn.close()
            if shared_conn is not None:
                shared_conn.close()

        shared_deck_id_set = set()
        for deck in decks:
            shared_deck_id = int(deck['deck_id'])
            shared_deck_id_set.add(shared_deck_id)
            local_entry = local_by_shared_id.get(shared_deck_id)
            materialized_name = (
                str(local_entry['local_name'])
                if local_entry
                else build_materialized_shared_deck_name(deck['deck_id'], deck['name'])
            )
            materialized_deck_id = int(local_entry['local_deck_id']) if local_entry else None
            deck['materialized_name'] = materialized_name
            deck['opted_in'] = local_entry is not None
            deck['materialized_deck_id'] = materialized_deck_id
            deck['mix_percent'] = 0
            deck['session_cards'] = 0

        # Keep kid-local materialized decks visible even if source shared deck was deleted.
        for shared_deck_id, local_entry in local_by_shared_id.items():
            if shared_deck_id in shared_deck_id_set:
                continue
            local_deck_id = int(local_entry['local_deck_id'])
            local_name = str(local_entry.get('local_name') or '')
            _, _, tail_name = local_name.partition('__')
            display_name = tail_name.strip() or local_name
            decks.append({
                'deck_id': int(shared_deck_id),
                'name': display_name,
                'tags': [str(tag) for tag in list(local_entry.get('tags') or []) if str(tag or '').strip()],
                'creator_family_id': None,
                'created_at': None,
                'card_count': int(local_card_count_by_deck_id.get(local_deck_id, 0)),
                'materialized_name': local_name,
                'opted_in': True,
                'materialized_deck_id': local_deck_id,
                'mix_percent': 0,
                'session_cards': 0,
                'source_deleted': True,
            })

        session_card_count = normalize_shared_math_session_card_count(kid)
        opted_deck_ids = [int(deck['deck_id']) for deck in decks if deck['opted_in']]
        mix_percent_by_deck_id = build_shared_math_mix_for_opted_decks(
            opted_deck_ids,
            kid.get('sharedMathDeckMix')
        )
        count_by_deck_id = build_shared_math_counts_for_opted_decks(
            session_card_count,
            mix_percent_by_deck_id,
            opted_deck_ids
        )
        for deck in decks:
            deck_id_key = str(int(deck['deck_id']))
            deck['mix_percent'] = int(mix_percent_by_deck_id.get(deck_id_key, 0))
            deck['session_cards'] = int(count_by_deck_id.get(deck_id_key, 0))

        return jsonify({
            'decks': decks,
            'deck_count': len(decks),
            'session_card_count': session_card_count,
            'shared_math_deck_mix': mix_percent_by_deck_id,
            'orphan_deck': orphan_deck_payload,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/math/shared-decks/opt-in', methods=['POST'])
def opt_in_kid_math_shared_decks(kid_id):
    """Materialize selected shared math decks into this kid's local deck DB."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload = request.get_json() or {}
        raw_ids = payload.get('deck_ids')
        if raw_ids is None:
            raw_ids = payload.get('deckIds')
        deck_ids = normalize_shared_deck_ids(raw_ids)

        shared_conn = None
        kid_conn = None
        try:
            shared_conn = get_shared_decks_connection()
            placeholders = ','.join(['?'] * len(deck_ids))
            deck_rows = shared_conn.execute(
                f"""
                SELECT deck_id, name, tags
                FROM deck
                WHERE deck_id IN ({placeholders})
                """,
                deck_ids
            ).fetchall()
            shared_by_id = {
                int(row[0]): {
                    'deck_id': int(row[0]),
                    'name': str(row[1]),
                    'tags': [str(tag) for tag in list(row[2] or []) if str(tag or '').strip()],
                }
                for row in deck_rows
            }

            missing_ids = [deck_id for deck_id in deck_ids if deck_id not in shared_by_id]
            if missing_ids:
                return jsonify({
                    'error': f'Shared deck(s) not found: {", ".join(str(v) for v in missing_ids)}'
                }), 404

            invalid_tag_ids = [
                deck_id for deck_id in deck_ids
                if 'math' not in shared_by_id[deck_id]['tags']
            ]
            if invalid_tag_ids:
                return jsonify({
                    'error': f'Deck(s) are not math-tagged: {", ".join(str(v) for v in invalid_tag_ids)}'
                }), 400

            card_rows = shared_conn.execute(
                f"""
                SELECT deck_id, front, back
                FROM cards
                WHERE deck_id IN ({placeholders})
                ORDER BY deck_id ASC, id ASC
                """,
                deck_ids
            ).fetchall()
            cards_by_deck_id = {}
            for row in card_rows:
                src_deck_id = int(row[0])
                cards_by_deck_id.setdefault(src_deck_id, []).append({
                    'front': str(row[1]),
                    'back': str(row[2]),
                })

            kid_conn = get_kid_connection_for(kid)
            created = []
            already_opted_in = []
            for src_deck_id in deck_ids:
                src_deck = shared_by_id[src_deck_id]
                materialized_name = build_materialized_shared_deck_name(src_deck_id, src_deck['name'])
                existing = kid_conn.execute(
                    "SELECT id FROM decks WHERE name = ? LIMIT 1",
                    [materialized_name]
                ).fetchone()
                if existing:
                    already_opted_in.append({
                        'shared_deck_id': src_deck_id,
                        'shared_name': src_deck['name'],
                        'materialized_name': materialized_name,
                        'deck_id': int(existing[0]),
                    })
                    continue

                materialized_tags = build_materialized_shared_deck_tags(src_deck['tags'])
                description = f"Materialized from shared deck #{src_deck_id}: {src_deck['name']}"
                inserted = kid_conn.execute(
                    """
                    INSERT INTO decks (name, description, tags)
                    VALUES (?, ?, ?)
                    RETURNING id
                    """,
                    [materialized_name, description, materialized_tags]
                ).fetchone()
                local_deck_id = int(inserted[0])

                cards = cards_by_deck_id.get(src_deck_id, [])
                cards_added = 0
                cards_moved_from_orphan = 0
                if cards:
                    orphan_deck_id = get_or_create_math_orphan_deck(kid_conn)
                    source_fronts = []
                    seen_fronts = set()
                    for card in cards:
                        front = str(card.get('front') or '')
                        if front in seen_fronts:
                            continue
                        seen_fronts.add(front)
                        source_fronts.append(front)

                    orphan_by_front = {}
                    if source_fronts:
                        front_placeholders = ','.join(['?'] * len(source_fronts))
                        orphan_rows = kid_conn.execute(
                            f"""
                            SELECT id, front, back, skip_practice, hardness_score, created_at
                            FROM cards
                            WHERE deck_id = ?
                              AND front IN ({front_placeholders})
                            ORDER BY id ASC
                            """,
                            [orphan_deck_id, *source_fronts]
                        ).fetchall()
                        for row in orphan_rows:
                            row_front = str(row[1] or '')
                            if row_front in orphan_by_front:
                                continue
                            orphan_by_front[row_front] = row

                    moved_rows = []
                    insert_rows = []
                    for card in cards:
                        front = str(card.get('front') or '')
                        orphan_row = orphan_by_front.pop(front, None)
                        if orphan_row is not None:
                            moved_rows.append(orphan_row)
                            continue
                        insert_rows.append([local_deck_id, front, str(card.get('back') or '')])

                    if moved_rows:
                        moved_ids = [int(row[0]) for row in moved_rows]
                        moved_placeholders = ','.join(['?'] * len(moved_ids))
                        # DuckDB can fail UPDATE on indexed columns; replace row with same id to "move" decks.
                        kid_conn.execute(
                            f"DELETE FROM cards WHERE id IN ({moved_placeholders})",
                            moved_ids
                        )
                        kid_conn.executemany(
                            """
                            INSERT INTO cards (id, deck_id, front, back, skip_practice, hardness_score, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                            """,
                            [
                                [
                                    int(row[0]),
                                    local_deck_id,
                                    str(row[1] or ''),
                                    str(row[2] or ''),
                                    bool(row[3]),
                                    float(row[4] or 0.0),
                                    row[5],
                                ]
                                for row in moved_rows
                            ]
                        )
                        cards_moved_from_orphan = len(moved_rows)

                    if insert_rows:
                        kid_conn.executemany(
                            "INSERT INTO cards (deck_id, front, back) VALUES (?, ?, ?)",
                            insert_rows
                        )
                        cards_added = len(insert_rows)

                created.append({
                    'shared_deck_id': src_deck_id,
                    'shared_name': src_deck['name'],
                    'materialized_name': materialized_name,
                    'deck_id': local_deck_id,
                    'cards_added': cards_added,
                    'cards_moved_from_orphan': cards_moved_from_orphan,
                    'cards_total': len(cards),
                })
        finally:
            if kid_conn is not None:
                kid_conn.close()
            if shared_conn is not None:
                shared_conn.close()

        return jsonify({
            'requested_count': len(deck_ids),
            'created_count': len(created),
            'already_opted_in_count': len(already_opted_in),
            'created': created,
            'already_opted_in': already_opted_in,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/math/shared-decks/opt-out', methods=['POST'])
def opt_out_kid_math_shared_decks(kid_id):
    """Remove selected opted-in shared math decks from this kid's local DB."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload = request.get_json() or {}
        raw_ids = payload.get('deck_ids')
        if raw_ids is None:
            raw_ids = payload.get('deckIds')
        deck_ids = normalize_shared_deck_ids(raw_ids)

        kid_conn = None
        try:
            kid_conn = get_kid_connection_for(kid)
            materialized_by_local_id = get_kid_materialized_shared_math_decks(kid_conn)
            local_by_shared_id = {
                int(entry['shared_deck_id']): {
                    'local_deck_id': int(entry['local_deck_id']),
                    'local_name': str(entry['local_name'] or ''),
                }
                for entry in materialized_by_local_id.values()
            }

            removed = []
            already_opted_out = []
            for shared_deck_id in deck_ids:
                local_entry = local_by_shared_id.get(shared_deck_id)
                if not local_entry:
                    already_opted_out.append({
                        'shared_deck_id': int(shared_deck_id),
                    })
                    continue

                local_deck_id = int(local_entry['local_deck_id'])
                local_name = str(local_entry['local_name'])
                card_rows = kid_conn.execute(
                    "SELECT id FROM cards WHERE deck_id = ?",
                    [local_deck_id]
                ).fetchall()
                card_ids = [int(row[0]) for row in card_rows]
                card_count = len(card_ids)

                practiced_card_ids = []
                if card_ids:
                    placeholders = ','.join(['?'] * len(card_ids))
                    practiced_rows = kid_conn.execute(
                        f"""
                        SELECT DISTINCT card_id
                        FROM session_results
                        WHERE card_id IN ({placeholders})
                        """,
                        card_ids
                    ).fetchall()
                    practiced_card_ids = [int(row[0]) for row in practiced_rows]
                had_practice_sessions = len(practiced_card_ids) > 0

                # Remove deck FK from past sessions so we can delete the deck row.
                kid_conn.execute(
                    "UPDATE sessions SET deck_id = NULL WHERE deck_id = ?",
                    [local_deck_id]
                )

                if had_practice_sessions:
                    orphan_deck_id = get_or_create_math_orphan_deck(kid_conn)
                    practiced_placeholders = ','.join(['?'] * len(practiced_card_ids))
                    practiced_cards = kid_conn.execute(
                        f"""
                        SELECT id, front, back, skip_practice, hardness_score, created_at
                        FROM cards
                        WHERE id IN ({practiced_placeholders})
                        """,
                        practiced_card_ids
                    ).fetchall()
                    if practiced_cards:
                        kid_conn.execute(
                            f"DELETE FROM cards WHERE id IN ({practiced_placeholders})",
                            practiced_card_ids
                        )
                        kid_conn.executemany(
                            """
                            INSERT INTO cards (id, deck_id, front, back, skip_practice, hardness_score, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                            """,
                            [
                                [
                                    int(row[0]),
                                    orphan_deck_id,
                                    row[1],
                                    row[2],
                                    bool(row[3]),
                                    float(row[4] or 0.0),
                                    row[5],
                                ]
                                for row in practiced_cards
                            ]
                        )

                    practiced_card_id_set = set(practiced_card_ids)
                    unpracticed_ids = [
                        card_id for card_id in card_ids
                        if card_id not in practiced_card_id_set
                    ]
                    if unpracticed_ids:
                        unpracticed_placeholders = ','.join(['?'] * len(unpracticed_ids))
                        kid_conn.execute(
                            f"DELETE FROM writing_audio WHERE card_id IN ({unpracticed_placeholders})",
                            unpracticed_ids
                        )
                        kid_conn.execute(
                            f"DELETE FROM writing_sheet_cards WHERE card_id IN ({unpracticed_placeholders})",
                            unpracticed_ids
                        )
                        kid_conn.execute(
                            f"""
                            DELETE FROM lesson_reading_audio
                            WHERE result_id IN (
                                SELECT id FROM session_results WHERE card_id IN ({unpracticed_placeholders})
                            )
                            """,
                            unpracticed_ids
                        )
                        kid_conn.execute(
                            f"DELETE FROM session_results WHERE card_id IN ({unpracticed_placeholders})",
                            unpracticed_ids
                        )
                        kid_conn.execute(
                            f"DELETE FROM cards WHERE id IN ({unpracticed_placeholders})",
                            unpracticed_ids
                        )
                else:
                    # No practice yet: hard-delete cards and related rows.
                    if card_ids:
                        placeholders = ','.join(['?'] * len(card_ids))
                        kid_conn.execute(
                            f"DELETE FROM writing_audio WHERE card_id IN ({placeholders})",
                            card_ids
                        )
                        kid_conn.execute(
                            f"DELETE FROM writing_sheet_cards WHERE card_id IN ({placeholders})",
                            card_ids
                        )
                        # Safety no-op in clean state; prevents FK errors from stale rows.
                        kid_conn.execute(
                            f"DELETE FROM session_results WHERE card_id IN ({placeholders})",
                            card_ids
                        )
                    kid_conn.execute("DELETE FROM cards WHERE deck_id = ?", [local_deck_id])

                kid_conn.execute("DELETE FROM decks WHERE id = ?", [local_deck_id])

                removed.append({
                    'shared_deck_id': int(shared_deck_id),
                    'deck_id': local_deck_id,
                    'materialized_name': local_name,
                    'had_practice_sessions': had_practice_sessions,
                    'cards_removed': card_count - len(practiced_card_ids),
                    'cards_detached': len(practiced_card_ids),
                })
        finally:
            if kid_conn is not None:
                kid_conn.close()

        return jsonify({
            'requested_count': len(deck_ids),
            'removed_count': len(removed),
            'already_opted_out_count': len(already_opted_out),
            'removed': removed,
            'already_opted_out': already_opted_out,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/math/shared-decks/cards', methods=['GET'])
def get_shared_math_cards(kid_id):
    """Get cards for one opted-in shared math deck or math_orphan deck in a kid DB."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        try:
            local_deck_id = int(request.args.get('deck_id'))
        except (TypeError, ValueError):
            return jsonify({'error': 'deck_id is required and must be an integer'}), 400
        if local_deck_id <= 0:
            return jsonify({'error': 'deck_id must be a positive integer'}), 400

        conn = get_kid_connection_for(kid)
        try:
            materialized_by_local_id = get_kid_materialized_shared_math_decks(conn)
            selected = materialized_by_local_id.get(local_deck_id)
            is_orphan_deck = False
            if not selected:
                orphan_row = conn.execute(
                    "SELECT id, name FROM decks WHERE id = ? AND name = ? LIMIT 1",
                    [local_deck_id, MATH_ORPHAN_DECK_NAME]
                ).fetchone()
                if orphan_row:
                    is_orphan_deck = True
                    selected = {
                        'local_deck_id': int(orphan_row[0]),
                        'local_name': str(orphan_row[1] or MATH_ORPHAN_DECK_NAME),
                        'shared_deck_id': None,
                    }
                else:
                    return jsonify({'error': 'Shared math deck not found for this kid'}), 404

            requested_count = 0
            preview_order = {}
            if not is_orphan_deck:
                opted_shared_ids = [entry['shared_deck_id'] for entry in materialized_by_local_id.values()]
                mix_percent_by_deck_id = build_shared_math_mix_for_opted_decks(
                    opted_shared_ids,
                    kid.get('sharedMathDeckMix')
                )
                count_by_deck_id = build_shared_math_counts_for_opted_decks(
                    normalize_shared_math_session_card_count(kid),
                    mix_percent_by_deck_id,
                    opted_shared_ids
                )

                requested_count = int(count_by_deck_id.get(str(selected['shared_deck_id']), 0))
                preview_kid = {**kid, 'sessionCardCount': requested_count}
                preview_ids = preview_deck_practice_order(
                    conn,
                    preview_kid,
                    local_deck_id,
                    'math'
                )
                preview_order = {card_id: i + 1 for i, card_id in enumerate(preview_ids)}

            cards = get_cards_with_stats(conn, local_deck_id)
            active_count = int(conn.execute(
                "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = FALSE",
                [local_deck_id]
            ).fetchone()[0] or 0)
            skipped_count = int(conn.execute(
                "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = TRUE",
                [local_deck_id]
            ).fetchone()[0] or 0)
        finally:
            conn.close()

        return jsonify({
            'shared_deck_id': int(selected['shared_deck_id']) if selected.get('shared_deck_id') is not None else None,
            'deck_id': int(local_deck_id),
            'deck_name': selected['local_name'],
            'is_orphan_deck': bool(is_orphan_deck),
            'session_count': requested_count,
            'active_card_count': active_count,
            'skipped_card_count': skipped_count,
            'cards': [map_card_row(row, preview_order) for row in cards]
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/math/shared-decks/cards/<card_id>/skip', methods=['PUT'])
def update_shared_math_card_skip(kid_id, card_id):
    """Toggle skip status for one card in an opted-in shared math deck or math_orphan."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        try:
            card_id_int = int(card_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid card id'}), 400

        payload = request.get_json() or {}
        if 'skipped' not in payload or not isinstance(payload.get('skipped'), bool):
            return jsonify({'error': 'skipped must be a boolean'}), 400
        skipped = bool(payload.get('skipped'))

        conn = get_kid_connection_for(kid)
        try:
            card_row = conn.execute(
                """
                SELECT c.id, c.deck_id, d.name, d.tags
                FROM cards c
                JOIN decks d ON d.id = c.deck_id
                WHERE c.id = ?
                LIMIT 1
                """,
                [card_id_int]
            ).fetchone()
            if not card_row:
                return jsonify({'error': 'Card not found'}), 404

            local_deck_name = str(card_row[2] or '')
            local_deck_tags = [str(tag) for tag in list(card_row[3] or []) if str(tag or '').strip()]
            is_materialized_shared = parse_shared_deck_id_from_materialized_name(local_deck_name) is not None
            is_orphan = local_deck_name == MATH_ORPHAN_DECK_NAME
            if is_materialized_shared and 'math' not in local_deck_tags:
                return jsonify({'error': 'Card does not belong to a shared math deck'}), 400
            if not is_materialized_shared and not is_orphan:
                return jsonify({'error': 'Card does not belong to a shared math or orphan deck'}), 400

            conn.execute(
                "UPDATE cards SET skip_practice = ? WHERE id = ?",
                [skipped, card_id_int]
            )
        finally:
            conn.close()

        return jsonify({
            'id': card_id_int,
            'skip_practice': skipped,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/math/decks', methods=['GET'])
def get_math_decks(kid_id):
    """Get opted-in shared math deck metadata and configured per-session counts."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        runtime_decks = get_shared_math_runtime_decks_for_kid(conn, kid)
        decks = [{
            'key': f"shared_{deck['shared_deck_id']}",
            'label': deck['name'],
            'deck_id': deck['local_deck_id'],
            'shared_deck_id': deck['shared_deck_id'],
            'mix_percent': deck['mix_percent'],
            'total_cards': deck['total_cards'],
            'session_count': deck['session_count'],
        } for deck in runtime_decks]
        total_session_count = sum(int(deck['session_count']) for deck in runtime_decks)

        conn.close()
        return jsonify({
            'decks': decks,
            'total_session_count': total_session_count
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/shared-decks', methods=['GET'])
def get_kid_lesson_reading_shared_decks(kid_id):
    """List global shared chinese-reading decks and whether this kid opted into each."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        shared_conn = None
        kid_conn = None
        orphan_deck_payload = None
        local_by_shared_id = {}
        local_card_count_by_deck_id = {}
        try:
            shared_conn = get_shared_decks_connection()
            decks = get_shared_lesson_reading_deck_rows(shared_conn)

            kid_conn = get_kid_connection_for(kid)
            materialized_by_local_id = get_kid_materialized_shared_lesson_reading_decks(kid_conn)
            for entry in materialized_by_local_id.values():
                shared_deck_id = int(entry['shared_deck_id'])
                existing = local_by_shared_id.get(shared_deck_id)
                if existing is None or int(entry['local_deck_id']) < int(existing['local_deck_id']):
                    local_by_shared_id[shared_deck_id] = entry

            local_deck_ids = [int(deck_id) for deck_id in materialized_by_local_id.keys()]
            if local_deck_ids:
                placeholders = ','.join(['?'] * len(local_deck_ids))
                card_count_rows = kid_conn.execute(
                    f"""
                    SELECT deck_id, COUNT(*) AS card_count
                    FROM cards
                    WHERE deck_id IN ({placeholders})
                    GROUP BY deck_id
                    """,
                    local_deck_ids
                ).fetchall()
                local_card_count_by_deck_id = {
                    int(row[0]): int(row[1] or 0)
                    for row in card_count_rows
                }

            orphan_row = kid_conn.execute(
                "SELECT id, name FROM decks WHERE name = ? LIMIT 1",
                [LESSON_READING_ORPHAN_DECK_NAME]
            ).fetchone()
            if orphan_row:
                orphan_deck_id = int(orphan_row[0])
                orphan_name = str(orphan_row[1] or LESSON_READING_ORPHAN_DECK_NAME)
                orphan_total = int(kid_conn.execute(
                    "SELECT COUNT(*) FROM cards WHERE deck_id = ?",
                    [orphan_deck_id]
                ).fetchone()[0] or 0)
                if orphan_total > 0:
                    orphan_active = int(kid_conn.execute(
                        "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = FALSE",
                        [orphan_deck_id]
                    ).fetchone()[0] or 0)
                    orphan_skipped = int(kid_conn.execute(
                        "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = TRUE",
                        [orphan_deck_id]
                    ).fetchone()[0] or 0)
                    orphan_deck_payload = {
                        'deck_id': orphan_deck_id,
                        'name': orphan_name,
                        'card_count': orphan_total,
                        'active_card_count': orphan_active,
                        'skipped_card_count': orphan_skipped,
                    }
        finally:
            if kid_conn is not None:
                kid_conn.close()
            if shared_conn is not None:
                shared_conn.close()

        shared_deck_id_set = set()
        for deck in decks:
            shared_deck_id = int(deck['deck_id'])
            shared_deck_id_set.add(shared_deck_id)
            local_entry = local_by_shared_id.get(shared_deck_id)
            materialized_name = (
                str(local_entry['local_name'])
                if local_entry
                else build_materialized_shared_deck_name(deck['deck_id'], deck['name'])
            )
            materialized_deck_id = int(local_entry['local_deck_id']) if local_entry else None
            deck['materialized_name'] = materialized_name
            deck['opted_in'] = local_entry is not None
            deck['materialized_deck_id'] = materialized_deck_id
            deck['mix_percent'] = 0
            deck['session_cards'] = 0

        for shared_deck_id, local_entry in local_by_shared_id.items():
            if shared_deck_id in shared_deck_id_set:
                continue
            local_deck_id = int(local_entry['local_deck_id'])
            local_name = str(local_entry.get('local_name') or '')
            _, _, tail_name = local_name.partition('__')
            display_name = tail_name.strip() or local_name
            decks.append({
                'deck_id': int(shared_deck_id),
                'name': display_name,
                'tags': [str(tag) for tag in list(local_entry.get('tags') or []) if str(tag or '').strip()],
                'creator_family_id': None,
                'created_at': None,
                'card_count': int(local_card_count_by_deck_id.get(local_deck_id, 0)),
                'materialized_name': local_name,
                'opted_in': True,
                'materialized_deck_id': local_deck_id,
                'mix_percent': 0,
                'session_cards': 0,
                'source_deleted': True,
            })

        session_card_count = normalize_shared_lesson_reading_session_card_count(kid)
        opted_deck_ids = [int(deck['deck_id']) for deck in decks if deck['opted_in']]
        mix_percent_by_deck_id = build_shared_lesson_reading_mix_for_opted_decks(
            opted_deck_ids,
            kid.get('sharedLessonReadingDeckMix')
        )
        count_by_deck_id = build_shared_lesson_reading_counts_for_opted_decks(
            session_card_count,
            mix_percent_by_deck_id,
            opted_deck_ids
        )
        for deck in decks:
            deck_id_key = str(int(deck['deck_id']))
            deck['mix_percent'] = int(mix_percent_by_deck_id.get(deck_id_key, 0))
            deck['session_cards'] = int(count_by_deck_id.get(deck_id_key, 0))

        return jsonify({
            'decks': decks,
            'deck_count': len(decks),
            'session_card_count': session_card_count,
            'shared_lesson_reading_deck_mix': mix_percent_by_deck_id,
            'orphan_deck': orphan_deck_payload,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/shared-decks/opt-in', methods=['POST'])
def opt_in_kid_lesson_reading_shared_decks(kid_id):
    """Materialize selected shared chinese-reading decks into this kid's local DB."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload = request.get_json() or {}
        raw_ids = payload.get('deck_ids')
        if raw_ids is None:
            raw_ids = payload.get('deckIds')
        deck_ids = normalize_shared_deck_ids(raw_ids)

        shared_conn = None
        kid_conn = None
        try:
            shared_conn = get_shared_decks_connection()
            placeholders = ','.join(['?'] * len(deck_ids))
            deck_rows = shared_conn.execute(
                f"""
                SELECT deck_id, name, tags
                FROM deck
                WHERE deck_id IN ({placeholders})
                """,
                deck_ids
            ).fetchall()
            shared_by_id = {
                int(row[0]): {
                    'deck_id': int(row[0]),
                    'name': str(row[1]),
                    'tags': [str(tag) for tag in list(row[2] or []) if str(tag or '').strip()],
                }
                for row in deck_rows
            }

            missing_ids = [deck_id for deck_id in deck_ids if deck_id not in shared_by_id]
            if missing_ids:
                return jsonify({
                    'error': f'Shared deck(s) not found: {", ".join(str(v) for v in missing_ids)}'
                }), 404

            invalid_tag_ids = [
                deck_id for deck_id in deck_ids
                if 'chinese_reading' not in shared_by_id[deck_id]['tags']
            ]
            if invalid_tag_ids:
                return jsonify({
                    'error': f'Deck(s) are not chinese_reading-tagged: {", ".join(str(v) for v in invalid_tag_ids)}'
                }), 400

            card_rows = shared_conn.execute(
                f"""
                SELECT deck_id, front, back
                FROM cards
                WHERE deck_id IN ({placeholders})
                ORDER BY deck_id ASC, id ASC
                """,
                deck_ids
            ).fetchall()
            cards_by_deck_id = {}
            for row in card_rows:
                src_deck_id = int(row[0])
                cards_by_deck_id.setdefault(src_deck_id, []).append({
                    'front': str(row[1]),
                    'back': str(row[2]),
                })

            kid_conn = get_kid_connection_for(kid)
            created = []
            already_opted_in = []
            for src_deck_id in deck_ids:
                src_deck = shared_by_id[src_deck_id]
                materialized_name = build_materialized_shared_deck_name(src_deck_id, src_deck['name'])
                existing = kid_conn.execute(
                    "SELECT id FROM decks WHERE name = ? LIMIT 1",
                    [materialized_name]
                ).fetchone()
                if existing:
                    already_opted_in.append({
                        'shared_deck_id': src_deck_id,
                        'shared_name': src_deck['name'],
                        'materialized_name': materialized_name,
                        'deck_id': int(existing[0]),
                    })
                    continue

                materialized_tags = build_materialized_shared_deck_tags(src_deck['tags'])
                description = f"Materialized from shared deck #{src_deck_id}: {src_deck['name']}"
                inserted = kid_conn.execute(
                    """
                    INSERT INTO decks (name, description, tags)
                    VALUES (?, ?, ?)
                    RETURNING id
                    """,
                    [materialized_name, description, materialized_tags]
                ).fetchone()
                local_deck_id = int(inserted[0])

                cards = cards_by_deck_id.get(src_deck_id, [])
                cards_added = 0
                cards_moved_from_orphan = 0
                if cards:
                    orphan_deck_id = get_or_create_lesson_reading_orphan_deck(kid_conn)
                    source_fronts = []
                    seen_fronts = set()
                    for card in cards:
                        front = str(card.get('front') or '')
                        if front in seen_fronts:
                            continue
                        seen_fronts.add(front)
                        source_fronts.append(front)

                    orphan_by_front = {}
                    if source_fronts:
                        front_placeholders = ','.join(['?'] * len(source_fronts))
                        orphan_rows = kid_conn.execute(
                            f"""
                            SELECT id, front, back, skip_practice, hardness_score, created_at
                            FROM cards
                            WHERE deck_id = ?
                              AND front IN ({front_placeholders})
                            ORDER BY id ASC
                            """,
                            [orphan_deck_id, *source_fronts]
                        ).fetchall()
                        for row in orphan_rows:
                            row_front = str(row[1] or '')
                            if row_front in orphan_by_front:
                                continue
                            orphan_by_front[row_front] = row

                    moved_rows = []
                    insert_rows = []
                    for card in cards:
                        front = str(card.get('front') or '')
                        orphan_row = orphan_by_front.pop(front, None)
                        if orphan_row is not None:
                            moved_rows.append(orphan_row)
                            continue
                        insert_rows.append([local_deck_id, front, str(card.get('back') or '')])

                    if moved_rows:
                        moved_ids = [int(row[0]) for row in moved_rows]
                        moved_placeholders = ','.join(['?'] * len(moved_ids))
                        kid_conn.execute(
                            f"DELETE FROM cards WHERE id IN ({moved_placeholders})",
                            moved_ids
                        )
                        kid_conn.executemany(
                            """
                            INSERT INTO cards (id, deck_id, front, back, skip_practice, hardness_score, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                            """,
                            [
                                [
                                    int(row[0]),
                                    local_deck_id,
                                    str(row[1] or ''),
                                    str(row[2] or ''),
                                    bool(row[3]),
                                    float(row[4] or 0.0),
                                    row[5],
                                ]
                                for row in moved_rows
                            ]
                        )
                        cards_moved_from_orphan = len(moved_rows)

                    if insert_rows:
                        kid_conn.executemany(
                            "INSERT INTO cards (deck_id, front, back) VALUES (?, ?, ?)",
                            insert_rows
                        )
                        cards_added = len(insert_rows)

                created.append({
                    'shared_deck_id': src_deck_id,
                    'shared_name': src_deck['name'],
                    'materialized_name': materialized_name,
                    'deck_id': local_deck_id,
                    'cards_added': cards_added,
                    'cards_moved_from_orphan': cards_moved_from_orphan,
                    'cards_total': len(cards),
                })
        finally:
            if kid_conn is not None:
                kid_conn.close()
            if shared_conn is not None:
                shared_conn.close()

        return jsonify({
            'requested_count': len(deck_ids),
            'created_count': len(created),
            'already_opted_in_count': len(already_opted_in),
            'created': created,
            'already_opted_in': already_opted_in,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/shared-decks/opt-out', methods=['POST'])
def opt_out_kid_lesson_reading_shared_decks(kid_id):
    """Remove selected opted-in shared chinese-reading decks from this kid's local DB."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload = request.get_json() or {}
        raw_ids = payload.get('deck_ids')
        if raw_ids is None:
            raw_ids = payload.get('deckIds')
        deck_ids = normalize_shared_deck_ids(raw_ids)

        kid_conn = None
        try:
            kid_conn = get_kid_connection_for(kid)
            materialized_by_local_id = get_kid_materialized_shared_lesson_reading_decks(kid_conn)
            local_by_shared_id = {
                int(entry['shared_deck_id']): {
                    'local_deck_id': int(entry['local_deck_id']),
                    'local_name': str(entry['local_name'] or ''),
                }
                for entry in materialized_by_local_id.values()
            }

            removed = []
            already_opted_out = []
            for shared_deck_id in deck_ids:
                local_entry = local_by_shared_id.get(shared_deck_id)
                if not local_entry:
                    already_opted_out.append({
                        'shared_deck_id': int(shared_deck_id),
                    })
                    continue

                local_deck_id = int(local_entry['local_deck_id'])
                local_name = str(local_entry['local_name'])
                card_rows = kid_conn.execute(
                    "SELECT id FROM cards WHERE deck_id = ?",
                    [local_deck_id]
                ).fetchall()
                card_ids = [int(row[0]) for row in card_rows]
                card_count = len(card_ids)

                practiced_card_ids = []
                if card_ids:
                    placeholders = ','.join(['?'] * len(card_ids))
                    practiced_rows = kid_conn.execute(
                        f"""
                        SELECT DISTINCT card_id
                        FROM session_results
                        WHERE card_id IN ({placeholders})
                        """,
                        card_ids
                    ).fetchall()
                    practiced_card_ids = [int(row[0]) for row in practiced_rows]
                had_practice_sessions = len(practiced_card_ids) > 0

                kid_conn.execute(
                    "UPDATE sessions SET deck_id = NULL WHERE deck_id = ?",
                    [local_deck_id]
                )

                if had_practice_sessions:
                    orphan_deck_id = get_or_create_lesson_reading_orphan_deck(kid_conn)
                    practiced_placeholders = ','.join(['?'] * len(practiced_card_ids))
                    practiced_cards = kid_conn.execute(
                        f"""
                        SELECT id, front, back, skip_practice, hardness_score, created_at
                        FROM cards
                        WHERE id IN ({practiced_placeholders})
                        """,
                        practiced_card_ids
                    ).fetchall()
                    if practiced_cards:
                        kid_conn.execute(
                            f"DELETE FROM cards WHERE id IN ({practiced_placeholders})",
                            practiced_card_ids
                        )
                        kid_conn.executemany(
                            """
                            INSERT INTO cards (id, deck_id, front, back, skip_practice, hardness_score, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                            """,
                            [
                                [
                                    int(row[0]),
                                    orphan_deck_id,
                                    row[1],
                                    row[2],
                                    bool(row[3]),
                                    float(row[4] or 0.0),
                                    row[5],
                                ]
                                for row in practiced_cards
                            ]
                        )

                    practiced_card_id_set = set(practiced_card_ids)
                    unpracticed_ids = [
                        card_id for card_id in card_ids
                        if card_id not in practiced_card_id_set
                    ]
                    if unpracticed_ids:
                        unpracticed_placeholders = ','.join(['?'] * len(unpracticed_ids))
                        kid_conn.execute(
                            f"DELETE FROM writing_audio WHERE card_id IN ({unpracticed_placeholders})",
                            unpracticed_ids
                        )
                        kid_conn.execute(
                            f"DELETE FROM writing_sheet_cards WHERE card_id IN ({unpracticed_placeholders})",
                            unpracticed_ids
                        )
                        kid_conn.execute(
                            f"""
                            DELETE FROM lesson_reading_audio
                            WHERE result_id IN (
                                SELECT id FROM session_results WHERE card_id IN ({unpracticed_placeholders})
                            )
                            """,
                            unpracticed_ids
                        )
                        kid_conn.execute(
                            f"DELETE FROM session_results WHERE card_id IN ({unpracticed_placeholders})",
                            unpracticed_ids
                        )
                        kid_conn.execute(
                            f"DELETE FROM cards WHERE id IN ({unpracticed_placeholders})",
                            unpracticed_ids
                        )
                else:
                    if card_ids:
                        placeholders = ','.join(['?'] * len(card_ids))
                        kid_conn.execute(
                            f"DELETE FROM writing_audio WHERE card_id IN ({placeholders})",
                            card_ids
                        )
                        kid_conn.execute(
                            f"DELETE FROM writing_sheet_cards WHERE card_id IN ({placeholders})",
                            card_ids
                        )
                        kid_conn.execute(
                            f"""
                            DELETE FROM lesson_reading_audio
                            WHERE result_id IN (
                                SELECT id FROM session_results WHERE card_id IN ({placeholders})
                            )
                            """,
                            card_ids
                        )
                        kid_conn.execute(
                            f"DELETE FROM session_results WHERE card_id IN ({placeholders})",
                            card_ids
                        )
                    kid_conn.execute("DELETE FROM cards WHERE deck_id = ?", [local_deck_id])

                kid_conn.execute("DELETE FROM decks WHERE id = ?", [local_deck_id])

                removed.append({
                    'shared_deck_id': int(shared_deck_id),
                    'deck_id': local_deck_id,
                    'materialized_name': local_name,
                    'had_practice_sessions': had_practice_sessions,
                    'cards_removed': card_count - len(practiced_card_ids),
                    'cards_detached': len(practiced_card_ids),
                })
        finally:
            if kid_conn is not None:
                kid_conn.close()

        return jsonify({
            'requested_count': len(deck_ids),
            'removed_count': len(removed),
            'already_opted_out_count': len(already_opted_out),
            'removed': removed,
            'already_opted_out': already_opted_out,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/shared-decks/cards', methods=['GET'])
def get_shared_lesson_reading_cards(kid_id):
    """Get cards for one opted-in chinese-reading shared deck or chinese_reading_orphan."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        try:
            local_deck_id = int(request.args.get('deck_id'))
        except (TypeError, ValueError):
            return jsonify({'error': 'deck_id is required and must be an integer'}), 400
        if local_deck_id <= 0:
            return jsonify({'error': 'deck_id must be a positive integer'}), 400

        conn = get_kid_connection_for(kid)
        try:
            materialized_by_local_id = get_kid_materialized_shared_lesson_reading_decks(conn)
            selected = materialized_by_local_id.get(local_deck_id)
            is_orphan_deck = False
            if not selected:
                orphan_row = conn.execute(
                    "SELECT id, name FROM decks WHERE id = ? AND name = ? LIMIT 1",
                    [local_deck_id, LESSON_READING_ORPHAN_DECK_NAME]
                ).fetchone()
                if orphan_row:
                    is_orphan_deck = True
                    selected = {
                        'local_deck_id': int(orphan_row[0]),
                        'local_name': str(orphan_row[1] or LESSON_READING_ORPHAN_DECK_NAME),
                        'shared_deck_id': None,
                    }
                else:
                    return jsonify({'error': 'Shared chinese-reading deck not found for this kid'}), 404

            requested_count = 0
            preview_order = {}
            if not is_orphan_deck:
                opted_shared_ids = [entry['shared_deck_id'] for entry in materialized_by_local_id.values()]
                mix_percent_by_deck_id = build_shared_lesson_reading_mix_for_opted_decks(
                    opted_shared_ids,
                    kid.get('sharedLessonReadingDeckMix')
                )
                count_by_deck_id = build_shared_lesson_reading_counts_for_opted_decks(
                    normalize_shared_lesson_reading_session_card_count(kid),
                    mix_percent_by_deck_id,
                    opted_shared_ids
                )

                requested_count = int(count_by_deck_id.get(str(selected['shared_deck_id']), 0))
                preview_kid = {**kid, 'sessionCardCount': requested_count}
                preview_ids = preview_deck_practice_order(
                    conn,
                    preview_kid,
                    local_deck_id,
                    'lesson_reading'
                )
                preview_order = {card_id: i + 1 for i, card_id in enumerate(preview_ids)}

            cards = get_cards_with_stats(conn, local_deck_id)
            active_count = int(conn.execute(
                "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = FALSE",
                [local_deck_id]
            ).fetchone()[0] or 0)
            skipped_count = int(conn.execute(
                "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = TRUE",
                [local_deck_id]
            ).fetchone()[0] or 0)
        finally:
            conn.close()

        return jsonify({
            'shared_deck_id': int(selected['shared_deck_id']) if selected.get('shared_deck_id') is not None else None,
            'deck_id': int(local_deck_id),
            'deck_name': selected['local_name'],
            'is_orphan_deck': bool(is_orphan_deck),
            'session_count': requested_count,
            'active_card_count': active_count,
            'skipped_card_count': skipped_count,
            'cards': [map_card_row(row, preview_order) for row in cards]
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/shared-decks/cards/<card_id>/skip', methods=['PUT'])
def update_shared_lesson_reading_card_skip(kid_id, card_id):
    """Toggle skip status for one card in an opted-in chinese-reading deck or orphan."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        try:
            card_id_int = int(card_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid card id'}), 400

        payload = request.get_json() or {}
        if 'skipped' not in payload or not isinstance(payload.get('skipped'), bool):
            return jsonify({'error': 'skipped must be a boolean'}), 400
        skipped = bool(payload.get('skipped'))

        conn = get_kid_connection_for(kid)
        try:
            card_row = conn.execute(
                """
                SELECT c.id, c.deck_id, d.name, d.tags
                FROM cards c
                JOIN decks d ON d.id = c.deck_id
                WHERE c.id = ?
                LIMIT 1
                """,
                [card_id_int]
            ).fetchone()
            if not card_row:
                return jsonify({'error': 'Card not found'}), 404

            local_deck_name = str(card_row[2] or '')
            local_deck_tags = [str(tag) for tag in list(card_row[3] or []) if str(tag or '').strip()]
            is_materialized_shared = parse_shared_deck_id_from_materialized_name(local_deck_name) is not None
            is_orphan = local_deck_name == LESSON_READING_ORPHAN_DECK_NAME
            if is_materialized_shared and 'chinese_reading' not in local_deck_tags:
                return jsonify({'error': 'Card does not belong to a shared chinese-reading deck'}), 400
            if not is_materialized_shared and not is_orphan:
                return jsonify({'error': 'Card does not belong to a shared chinese-reading or orphan deck'}), 400

            conn.execute(
                "UPDATE cards SET skip_practice = ? WHERE id = ?",
                [skipped, card_id_int]
            )
        finally:
            conn.close()

        return jsonify({
            'id': card_id_int,
            'skip_practice': skipped,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/decks', methods=['GET'])
def get_lesson_reading_decks(kid_id):
    """Get opted-in shared chinese-reading deck metadata and configured counts."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        runtime_decks = get_shared_lesson_reading_runtime_decks_for_kid(conn, kid)
        decks = [{
            'key': f"shared_{deck['shared_deck_id']}",
            'label': deck['name'],
            'deck_id': deck['local_deck_id'],
            'shared_deck_id': deck['shared_deck_id'],
            'mix_percent': deck['mix_percent'],
            'total_cards': deck['total_cards'],
            'session_count': deck['session_count'],
        } for deck in runtime_decks]
        total_session_count = sum(int(deck['session_count']) for deck in runtime_decks)

        conn.close()
        return jsonify({
            'decks': decks,
            'total_session_count': total_session_count
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/cards', methods=['GET'])
def get_writing_cards(kid_id):
    """Get all writing cards for a kid."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_writing_deck(conn)
        pending_card_ids = get_pending_writing_card_ids(conn)
        missing_audio_rows = conn.execute(
            """
            SELECT c.id
            FROM cards c
            LEFT JOIN writing_audio wa ON wa.card_id = c.id
            WHERE c.deck_id = ?
              AND wa.card_id IS NULL
            """,
            [deck_id]
        ).fetchall()
        missing_audio_card_ids = [int(row[0]) for row in missing_audio_rows]
        missing_audio_set = set(missing_audio_card_ids)
        pending_card_set = set(pending_card_ids)
        preview_excluded_ids = list(set(pending_card_ids + missing_audio_card_ids))
        writing_session_count = normalize_writing_session_card_count(kid)
        preview_kid = {**kid, 'sessionCardCount': writing_session_count}
        preview_ids = preview_deck_practice_order(
            conn,
            preview_kid,
            deck_id,
            'writing',
            excluded_card_ids=preview_excluded_ids
        )
        preview_order = {card_id: i + 1 for i, card_id in enumerate(preview_ids)}

        rows = conn.execute(
            """
            SELECT
                c.id,
                c.deck_id,
                c.front,
                c.back,
                COALESCE(c.skip_practice, FALSE) AS skip_practice,
                c.hardness_score,
                c.created_at,
                COUNT(sr.id) AS lifetime_attempts,
                MAX(sr.timestamp) AS last_seen_at,
                wa.file_name,
                wa.mime_type
            FROM cards c
            LEFT JOIN session_results sr ON c.id = sr.card_id
            LEFT JOIN writing_audio wa ON c.id = wa.card_id
            WHERE c.deck_id = ?
            GROUP BY c.id, c.deck_id, c.front, c.back, c.skip_practice, c.hardness_score, c.created_at, wa.file_name, wa.mime_type
            ORDER BY c.id ASC
            """,
            [deck_id]
        ).fetchall()
        conn.close()

        cards = []
        for row in rows:
            card = map_card_row(row, preview_order)
            if not card.get('front') and card.get('back'):
                card['front'] = card['back']
            card['pending_sheet'] = int(row[0]) in pending_card_set
            has_audio = row[9] is not None
            card['available_for_practice'] = (not card['pending_sheet']) and has_audio
            card['audio_file_name'] = row[9]
            card['audio_mime_type'] = row[10]
            card['audio_url'] = f"/api/kids/{kid_id}/writing/audio/{row[9]}" if row[9] else None
            card['missing_audio'] = int(row[0]) in missing_audio_set
            cards.append(card)

        return jsonify({'deck_id': deck_id, 'cards': cards}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/cards', methods=['POST'])
def add_writing_cards(kid_id):
    """Add one writing card from a voice prompt and raw answer text."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        answer_text = (request.form.get('characters') or '').strip()
        if len(answer_text) == 0:
            return jsonify({'error': 'Please provide answer text'}), 400

        if 'audio' not in request.files:
            return jsonify({'error': 'Audio recording is required'}), 400

        audio_file = request.files['audio']
        if not audio_file or audio_file.filename == '':
            return jsonify({'error': 'Audio recording is required'}), 400

        audio_bytes = audio_file.read()
        if not audio_bytes:
            return jsonify({'error': 'Uploaded audio is empty'}), 400

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_writing_deck(conn)

        existing = conn.execute(
            """
            SELECT id
            FROM cards
            WHERE deck_id = ? AND back = ?
            LIMIT 1
            """,
            [deck_id, answer_text]
        ).fetchone()
        if existing:
            conn.close()
            return jsonify({'error': 'This Chinese writing answer already exists in the card bank'}), 400

        safe_name = secure_filename(audio_file.filename or '')
        _, original_ext = os.path.splitext(safe_name)
        mime_type = audio_file.mimetype or 'application/octet-stream'
        guessed_ext = mimetypes.guess_extension(mime_type) or ''
        ext = original_ext if original_ext else guessed_ext
        if not ext:
            ext = '.webm'

        audio_dir = ensure_writing_audio_dir(kid)
        card_id = conn.execute(
            """
            INSERT INTO cards (deck_id, front, back)
            VALUES (?, ?, ?)
            RETURNING id
            """,
            [deck_id, answer_text, answer_text]
        ).fetchone()[0]

        file_name = f"{uuid.uuid4().hex}{ext}"
        file_path = os.path.join(audio_dir, file_name)
        with open(file_path, 'wb') as f:
            f.write(audio_bytes)

        conn.execute(
            """
            INSERT INTO writing_audio (card_id, file_name, mime_type)
            VALUES (?, ?, ?)
            """,
            [card_id, file_name, mime_type]
        )

        row = conn.execute(
            """
            SELECT id, deck_id, front, back, created_at
            FROM cards
            WHERE id = ?
            """,
            [card_id]
        ).fetchone()

        conn.close()
        return jsonify({
            'deck_id': deck_id,
            'inserted_count': 1,
            'cards': [{
                'id': row[0],
                'deck_id': row[1],
                'front': row[2],
                'back': row[3],
                'created_at': row[4].isoformat() if row[4] else None,
                'audio_file_name': file_name,
                'audio_mime_type': mime_type,
                'audio_url': f"/api/kids/{kid_id}/writing/audio/{file_name}"
            }]
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/cards/bulk', methods=['POST'])
def add_writing_cards_bulk(kid_id):
    """Bulk-add writing cards without audio by splitting text on non-Chinese separators."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload = request.get_json() or {}
        raw_text = payload.get('text', '')
        tokens = split_writing_bulk_text(raw_text)
        if len(tokens) == 0:
            return jsonify({'error': 'Please paste at least one Chinese word/phrase'}), 400

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_writing_deck(conn)

        existing_rows = conn.execute(
            "SELECT back FROM cards WHERE deck_id = ?",
            [deck_id]
        ).fetchall()
        existing_set = {str(row[0]) for row in existing_rows}

        created = []
        skipped_existing = 0
        for token in tokens:
            if token in existing_set:
                skipped_existing += 1
                continue

            row = conn.execute(
                """
                INSERT INTO cards (deck_id, front, back)
                VALUES (?, ?, ?)
                RETURNING id, deck_id, front, back, created_at
                """,
                [deck_id, token, token]
            ).fetchone()
            existing_set.add(token)
            created.append({
                'id': int(row[0]),
                'deck_id': int(row[1]),
                'front': row[2],
                'back': row[3],
                'created_at': row[4].isoformat() if row[4] else None,
                'audio_file_name': None,
                'audio_mime_type': None,
                'audio_url': None,
            })

        conn.close()
        return jsonify({
            'deck_id': deck_id,
            'input_token_count': len(tokens),
            'inserted_count': len(created),
            'skipped_existing_count': skipped_existing,
            'cards': created
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/cards/<card_id>/audio', methods=['POST'])
def upsert_writing_card_audio(kid_id, card_id):
    """Attach or replace audio for an existing writing card."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        if 'audio' not in request.files:
            return jsonify({'error': 'Audio recording is required'}), 400
        audio_file = request.files['audio']
        if not audio_file or audio_file.filename == '':
            return jsonify({'error': 'Audio recording is required'}), 400
        audio_bytes = audio_file.read()
        if not audio_bytes:
            return jsonify({'error': 'Uploaded audio is empty'}), 400

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_writing_deck(conn)
        card_row = conn.execute(
            "SELECT id, back FROM cards WHERE id = ? AND deck_id = ?",
            [card_id, deck_id]
        ).fetchone()
        if not card_row:
            conn.close()
            return jsonify({'error': 'Writing card not found'}), 404

        existing_audio_row = conn.execute(
            "SELECT file_name FROM writing_audio WHERE card_id = ?",
            [card_id]
        ).fetchone()
        old_file_name = existing_audio_row[0] if existing_audio_row else None

        safe_name = secure_filename(audio_file.filename or '')
        _, original_ext = os.path.splitext(safe_name)
        mime_type = audio_file.mimetype or 'application/octet-stream'
        guessed_ext = mimetypes.guess_extension(mime_type) or ''
        ext = original_ext if original_ext else guessed_ext
        if not ext:
            ext = '.webm'

        audio_dir = ensure_writing_audio_dir(kid)
        file_name = f"{uuid.uuid4().hex}{ext}"
        file_path = os.path.join(audio_dir, file_name)
        with open(file_path, 'wb') as f:
            f.write(audio_bytes)

        conn.execute(
            """
            INSERT INTO writing_audio (card_id, file_name, mime_type)
            VALUES (?, ?, ?)
            ON CONFLICT (card_id) DO UPDATE
            SET file_name = EXCLUDED.file_name, mime_type = EXCLUDED.mime_type
            """,
            [card_id, file_name, mime_type]
        )
        conn.close()

        if old_file_name:
            old_path = os.path.join(audio_dir, old_file_name)
            if old_file_name != file_name and os.path.exists(old_path):
                try:
                    os.remove(old_path)
                except OSError:
                    pass

        return jsonify({
            'card_id': int(card_row[0]),
            'back': card_row[1],
            'audio_file_name': file_name,
            'audio_mime_type': mime_type,
            'audio_url': f"/api/kids/{kid_id}/writing/audio/{file_name}"
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/audio/<path:file_name>', methods=['GET'])
def get_writing_audio(kid_id, file_name):
    """Serve writing prompt audio file for a kid."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        if file_name != os.path.basename(file_name):
            return jsonify({'error': 'Invalid file name'}), 400

        audio_dir = get_kid_writing_audio_dir(kid)
        audio_path = os.path.join(audio_dir, file_name)
        if not os.path.exists(audio_path):
            return jsonify({'error': 'Audio file not found'}), 404

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_writing_deck(conn)
        row = conn.execute(
            """
            SELECT wa.mime_type
            FROM writing_audio wa
            JOIN cards c ON c.id = wa.card_id
            WHERE wa.file_name = ? AND c.deck_id = ?
            LIMIT 1
            """,
            [file_name, deck_id]
        ).fetchone()
        conn.close()

        mime_type = row[0] if row and row[0] else None
        return send_from_directory(audio_dir, file_name, as_attachment=False, mimetype=mime_type)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/audio/<path:file_name>', methods=['GET'])
def get_lesson_reading_audio(kid_id, file_name):
    """Serve lesson-reading recording audio file for one kid."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        if file_name != os.path.basename(file_name):
            return jsonify({'error': 'Invalid file name'}), 400

        audio_dir = get_kid_lesson_reading_audio_dir(kid)
        audio_path = os.path.join(audio_dir, file_name)
        if not os.path.exists(audio_path):
            return jsonify({'error': 'Audio file not found'}), 404

        conn = get_kid_connection_for(kid)
        row = conn.execute(
            """
            SELECT lra.mime_type
            FROM lesson_reading_audio lra
            JOIN session_results sr ON sr.id = lra.result_id
            JOIN sessions s ON s.id = sr.session_id
            WHERE lra.file_name = ?
              AND s.type = 'lesson_reading'
            LIMIT 1
            """,
            [file_name]
        ).fetchone()
        conn.close()

        if not row:
            return jsonify({'error': 'Audio file not found'}), 404

        mime_type = row[0] if row and row[0] else None
        return send_from_directory(audio_dir, file_name, as_attachment=False, mimetype=mime_type)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/cards/<card_id>/audio', methods=['DELETE'])
def delete_writing_card_audio(kid_id, card_id):
    """Delete audio for an existing writing card."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_writing_deck(conn)
        card_row = conn.execute(
            "SELECT id FROM cards WHERE id = ? AND deck_id = ?",
            [card_id, deck_id]
        ).fetchone()
        if not card_row:
            conn.close()
            return jsonify({'error': 'Writing card not found'}), 404

        audio_row = conn.execute(
            "SELECT file_name FROM writing_audio WHERE card_id = ?",
            [card_id]
        ).fetchone()
        if not audio_row:
            conn.close()
            return jsonify({'error': 'No audio found for this writing card'}), 404

        file_name = audio_row[0]
        conn.execute(
            "DELETE FROM writing_audio WHERE card_id = ?",
            [card_id]
        )
        conn.close()

        if file_name:
            audio_path = os.path.join(get_kid_writing_audio_dir(kid), file_name)
            if os.path.exists(audio_path):
                try:
                    os.remove(audio_path)
                except OSError:
                    pass

        return jsonify({'deleted': True, 'card_id': int(card_row[0])}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/cards/<card_id>', methods=['DELETE'])
def delete_writing_card(kid_id, card_id):
    """Delete a writing card and its associated audio file."""
    try:
        auth_err = require_critical_password()
        if auth_err:
            return auth_err
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_writing_deck(conn)

        row = conn.execute(
            """
            SELECT c.id, wa.file_name
            FROM cards c
            LEFT JOIN writing_audio wa ON wa.card_id = c.id
            WHERE c.id = ? AND c.deck_id = ?
            """,
            [card_id, deck_id]
        ).fetchone()
        if not row:
            conn.close()
            return jsonify({'error': 'Writing card not found'}), 404

        file_name = row[1]
        if file_name:
            audio_path = os.path.join(get_kid_writing_audio_dir(kid), file_name)
            if os.path.exists(audio_path):
                os.remove(audio_path)

        conn.execute("DELETE FROM writing_audio WHERE card_id = ?", [card_id])
        conn.execute("DELETE FROM writing_sheet_cards WHERE card_id = ?", [card_id])
        delete_card_from_deck_internal(conn, card_id)
        conn.close()
        return jsonify({'message': 'Writing card deleted successfully'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def select_writing_sheet_candidates(conn, deck_id, requested_count, excluded_card_ids=None):
    """Select candidate writing cards for sheet generation."""
    excluded = excluded_card_ids or []
    placeholders = ','.join(['?'] * len(excluded)) if excluded else ''
    exclude_clause = ''
    params = [deck_id]
    if excluded:
        exclude_clause = f"AND c.id NOT IN ({placeholders})"
        params.extend(excluded)

    return conn.execute(
        f"""
        WITH latest AS (
            SELECT
                sr.card_id,
                sr.correct,
                ROW_NUMBER() OVER (PARTITION BY sr.card_id ORDER BY sr.timestamp DESC, sr.id DESC) AS rn
            FROM session_results sr
            JOIN sessions s ON s.id = sr.session_id
            WHERE s.type = 'writing'
        ),
        available AS (
            SELECT
                c.id,
                c.front,
                c.back,
                l.correct,
                CASE
                    WHEN l.card_id IS NULL OR l.correct < 0 THEN 0
                    ELSE 1
                END AS priority
            FROM cards c
            LEFT JOIN latest l ON l.card_id = c.id AND l.rn = 1
            WHERE c.deck_id = ?
              {exclude_clause}
        )
        SELECT id, front, back, correct
        FROM available
        ORDER BY
          priority ASC,
          id ASC
        LIMIT ?
        """,
        [*params, requested_count]
    ).fetchall()


@kids_bp.route('/kids/<kid_id>/writing/sheets/preview', methods=['POST'])
def preview_writing_sheet(kid_id):
    """Preview writing sheet cards without persisting a sheet record."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        data = request.get_json() or {}
        try:
            requested_count = int(data.get('count', normalize_writing_session_card_count(kid)))
        except (TypeError, ValueError):
            return jsonify({'error': 'count must be an integer'}), 400
        try:
            requested_rows = int(data.get('rows_per_character', 1))
        except (TypeError, ValueError):
            return jsonify({'error': 'rows_per_character must be an integer'}), 400

        if requested_count < MIN_SESSION_CARD_COUNT or requested_count > MAX_SESSION_CARD_COUNT:
            return jsonify({'error': f'count must be between {MIN_SESSION_CARD_COUNT} and {MAX_SESSION_CARD_COUNT}'}), 400
        if requested_rows < 1 or requested_rows > 10:
            return jsonify({'error': 'rows_per_character must be between 1 and 10'}), 400
        if requested_count * requested_rows > MAX_WRITING_SHEET_ROWS:
            max_cards = max(1, MAX_WRITING_SHEET_ROWS // requested_rows)
            return jsonify({
                'error': (
                    f'Sheet exceeds one-page limit ({MAX_WRITING_SHEET_ROWS} rows). '
                    f'With {requested_rows} row(s) per card, max cards is {max_cards}.'
                )
            }), 400

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_writing_deck(conn)
        pending_card_ids = get_pending_writing_card_ids(conn)
        candidates = select_writing_sheet_candidates(conn, deck_id, requested_count, pending_card_ids)
        conn.close()

        if len(candidates) == 0:
            return jsonify({
                'preview': False,
                'cards': [],
                'message': 'No cards available to print right now. All writing cards may already be practicing.'
            }), 200

        return jsonify({
            'preview': True,
            'rows_per_character': requested_rows,
            'cards': [{
                'id': int(row[0]),
                'front': row[1],
                'back': row[2]
            } for row in candidates]
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/sheets/finalize', methods=['POST'])
def finalize_writing_sheet(kid_id):
    """Persist a previously previewed writing sheet once parent confirms print."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        data = request.get_json() or {}
        raw_ids = data.get('card_ids') or []
        try:
            requested_rows = int(data.get('rows_per_character', 1))
        except (TypeError, ValueError):
            return jsonify({'error': 'rows_per_character must be an integer'}), 400

        if not isinstance(raw_ids, list) or len(raw_ids) == 0:
            return jsonify({'error': 'card_ids must be a non-empty list'}), 400
        if requested_rows < 1 or requested_rows > 10:
            return jsonify({'error': 'rows_per_character must be between 1 and 10'}), 400

        normalized_ids = []
        for cid in raw_ids:
            try:
                normalized_ids.append(int(cid))
            except (TypeError, ValueError):
                return jsonify({'error': 'card_ids must contain integers'}), 400
        normalized_ids = list(dict.fromkeys(normalized_ids))

        if len(normalized_ids) * requested_rows > MAX_WRITING_SHEET_ROWS:
            max_cards = max(1, MAX_WRITING_SHEET_ROWS // requested_rows)
            return jsonify({
                'error': (
                    f'Sheet exceeds one-page limit ({MAX_WRITING_SHEET_ROWS} rows). '
                    f'With {requested_rows} row(s) per card, max cards is {max_cards}.'
                )
            }), 400

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_writing_deck(conn)

        pending_set = set(get_pending_writing_card_ids(conn))
        if any(card_id in pending_set for card_id in normalized_ids):
            conn.close()
            return jsonify({'error': 'Some selected cards are already practicing in another sheet'}), 409

        placeholders = ','.join(['?'] * len(normalized_ids))
        rows = conn.execute(
            f"""
            SELECT id, front, back
            FROM cards
            WHERE deck_id = ?
              AND id IN ({placeholders})
            """,
            [deck_id, *normalized_ids]
        ).fetchall()
        rows_by_id = {int(row[0]): row for row in rows}
        if len(rows_by_id) != len(normalized_ids):
            conn.close()
            return jsonify({'error': 'Some selected cards are no longer available'}), 409

        sheet_id = conn.execute(
            "INSERT INTO writing_sheets (status, practice_rows) VALUES ('pending', ?) RETURNING id",
            [requested_rows]
        ).fetchone()[0]

        for card_id in normalized_ids:
            conn.execute(
                """
                INSERT INTO writing_sheet_cards (sheet_id, card_id)
                VALUES (?, ?)
                """,
                [sheet_id, card_id]
            )

        conn.close()
        return jsonify({
            'created': True,
            'sheet_id': int(sheet_id),
            'rows_per_character': requested_rows,
            'cards': [{
                'id': card_id,
                'front': rows_by_id[card_id][1],
                'back': rows_by_id[card_id][2]
            } for card_id in normalized_ids]
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/sheets', methods=['POST'])
def create_writing_sheet(kid_id):
    """Create a printable writing sheet from never-seen or latest-wrong cards."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        data = request.get_json() or {}
        try:
            requested_count = int(data.get('count', normalize_writing_session_card_count(kid)))
        except (TypeError, ValueError):
            return jsonify({'error': 'count must be an integer'}), 400
        try:
            requested_rows = int(data.get('rows_per_character', 1))
        except (TypeError, ValueError):
            return jsonify({'error': 'rows_per_character must be an integer'}), 400

        if requested_count < MIN_SESSION_CARD_COUNT or requested_count > MAX_SESSION_CARD_COUNT:
            return jsonify({'error': f'count must be between {MIN_SESSION_CARD_COUNT} and {MAX_SESSION_CARD_COUNT}'}), 400
        if requested_rows < 1 or requested_rows > 10:
            return jsonify({'error': 'rows_per_character must be between 1 and 10'}), 400
        total_rows_requested = requested_count * requested_rows
        if total_rows_requested > MAX_WRITING_SHEET_ROWS:
            max_cards = max(1, MAX_WRITING_SHEET_ROWS // requested_rows)
            return jsonify({
                'error': (
                    f'Sheet exceeds one-page limit ({MAX_WRITING_SHEET_ROWS} rows). '
                    f'With {requested_rows} row(s) per card, max cards is {max_cards}.'
                )
            }), 400

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_writing_deck(conn)
        pending_card_ids = get_pending_writing_card_ids(conn)

        candidates = select_writing_sheet_candidates(conn, deck_id, requested_count, pending_card_ids)

        if len(candidates) == 0:
            conn.close()
            return jsonify({
                'sheet_id': None,
                'cards': [],
                'created': False,
                'message': 'No cards available to print right now. All writing cards may already be practicing.'
            }), 200

        sheet_id = conn.execute(
            "INSERT INTO writing_sheets (status, practice_rows) VALUES ('pending', ?) RETURNING id",
            [requested_rows]
        ).fetchone()[0]

        for row in candidates:
            conn.execute(
                """
                INSERT INTO writing_sheet_cards (sheet_id, card_id)
                VALUES (?, ?)
                """,
                [sheet_id, row[0]]
            )

        conn.close()
        return jsonify({
            'created': True,
            'sheet_id': int(sheet_id),
            'rows_per_character': requested_rows,
            'cards': [{
                'id': int(row[0]),
                'front': row[1],
                'back': row[2]
            } for row in candidates]
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/sheets', methods=['GET'])
def get_writing_sheets(kid_id):
    """List all writing sheets with cards."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        rows = conn.execute(
            """
            SELECT
                ws.id,
                ws.status,
                ws.practice_rows,
                ws.created_at,
                ws.completed_at,
                c.id,
                c.front,
                c.back
            FROM writing_sheets ws
            LEFT JOIN writing_sheet_cards wsc ON wsc.sheet_id = ws.id
            LEFT JOIN cards c ON c.id = wsc.card_id
            ORDER BY ws.created_at DESC, c.id ASC
            """
        ).fetchall()
        conn.close()

        sheets_by_id = {}
        ordered_ids = []
        for row in rows:
            sheet_id = int(row[0])
            if sheet_id not in sheets_by_id:
                sheets_by_id[sheet_id] = {
                    'id': sheet_id,
                    'status': row[1],
                    'practice_rows': int(row[2] or 1),
                    'created_at': row[3].isoformat() if row[3] else None,
                    'completed_at': row[4].isoformat() if row[4] else None,
                    'cards': []
                }
                ordered_ids.append(sheet_id)

            if row[5] is not None:
                sheets_by_id[sheet_id]['cards'].append({
                    'id': int(row[5]),
                    'front': row[6],
                    'back': row[7]
                })

        return jsonify({'sheets': [sheets_by_id[sid] for sid in ordered_ids]}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/sheets/<sheet_id>', methods=['GET'])
def get_writing_sheet_detail(kid_id, sheet_id):
    """Get one writing sheet with cards."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        rows = conn.execute(
            """
            SELECT
                ws.id,
                ws.status,
                ws.practice_rows,
                ws.created_at,
                ws.completed_at,
                c.id,
                c.front,
                c.back
            FROM writing_sheets ws
            LEFT JOIN writing_sheet_cards wsc ON wsc.sheet_id = ws.id
            LEFT JOIN cards c ON c.id = wsc.card_id
            WHERE ws.id = ?
            ORDER BY c.id ASC
            """,
            [sheet_id]
        ).fetchall()
        conn.close()

        if len(rows) == 0:
            return jsonify({'error': 'Sheet not found'}), 404

        sheet = {
            'id': int(rows[0][0]),
            'status': rows[0][1],
            'practice_rows': int(rows[0][2] or 1),
            'created_at': rows[0][3].isoformat() if rows[0][3] else None,
            'completed_at': rows[0][4].isoformat() if rows[0][4] else None,
            'cards': []
        }
        for row in rows:
            if row[5] is None:
                continue
            sheet['cards'].append({
                'id': int(row[5]),
                'front': row[6],
                'back': row[7]
            })

        return jsonify(sheet), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/sheets/<sheet_id>/complete', methods=['POST'])
def complete_writing_sheet(kid_id, sheet_id):
    """Mark a writing sheet as done."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        row = conn.execute(
            "SELECT id, status FROM writing_sheets WHERE id = ?",
            [sheet_id]
        ).fetchone()
        if not row:
            conn.close()
            return jsonify({'error': 'Sheet not found'}), 404

        if row[1] != 'done':
            conn.execute(
                """
                UPDATE writing_sheets
                SET status = 'done', completed_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                [sheet_id]
            )
        conn.close()
        return jsonify({'sheet_id': int(sheet_id), 'status': 'done'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/sheets/<sheet_id>/withdraw', methods=['POST'])
def withdraw_writing_sheet(kid_id, sheet_id):
    """Withdraw a pending writing sheet by deleting it."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        row = conn.execute(
            "SELECT id, status FROM writing_sheets WHERE id = ?",
            [sheet_id]
        ).fetchone()
        if not row:
            conn.close()
            return jsonify({'error': 'Sheet not found'}), 404

        status = row[1]
        if status != 'pending':
            conn.close()
            return jsonify({'error': 'Only practicing sheets can be withdrawn'}), 400

        conn.execute(
            "DELETE FROM writing_sheet_cards WHERE sheet_id = ?",
            [sheet_id]
        )
        conn.execute(
            """
            DELETE FROM writing_sheets
            WHERE id = ?
            """,
            [sheet_id]
        )

        conn.close()
        return jsonify({'sheet_id': int(sheet_id), 'deleted': True}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/practice/start', methods=['POST'])
def start_writing_practice_session(kid_id):
    """Start a writing practice session."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_writing_deck(conn)
        pending_card_ids = get_pending_writing_card_ids(conn)
        missing_audio_rows = conn.execute(
            """
            SELECT c.id
            FROM cards c
            LEFT JOIN writing_audio wa ON wa.card_id = c.id
            WHERE c.deck_id = ?
              AND wa.card_id IS NULL
            """,
            [deck_id]
        ).fetchall()
        missing_audio_card_ids = [int(row[0]) for row in missing_audio_rows]
        excluded_card_ids = pending_card_ids + missing_audio_card_ids
        writing_session_count = normalize_writing_session_card_count(kid)
        if writing_session_count <= 0:
            conn.close()
            return jsonify({'pending_session_id': None, 'cards': [], 'planned_count': 0}), 200
        preview_kid = {**kid, 'sessionCardCount': writing_session_count}
        pending_session_id, selected_cards = plan_deck_pending_session(
            conn,
            preview_kid,
            kid_id,
            deck_id,
            'writing',
            excluded_card_ids=excluded_card_ids
        )
        if not pending_session_id:
            conn.close()
            return jsonify({'pending_session_id': None, 'cards': [], 'planned_count': 0}), 200

        card_ids = [card['id'] for card in selected_cards]
        if not card_ids:
            conn.close()
            return jsonify({'pending_session_id': None, 'cards': [], 'planned_count': 0}), 200
        placeholders = ','.join(['?'] * len(card_ids))
        audio_rows = conn.execute(
            f"""
            SELECT card_id, file_name, mime_type
            FROM writing_audio
            WHERE card_id IN ({placeholders})
            """,
            card_ids
        ).fetchall()
        conn.close()

        audio_by_card = {row[0]: {'file_name': row[1], 'mime_type': row[2]} for row in audio_rows}
        cards_with_audio = []
        for card in selected_cards:
            audio_meta = audio_by_card.get(card['id'])
            cards_with_audio.append({
                **card,
                'audio_file_name': audio_meta['file_name'] if audio_meta else None,
                'audio_mime_type': audio_meta['mime_type'] if audio_meta else None,
                'audio_url': f"/api/kids/{kid_id}/writing/audio/{audio_meta['file_name']}" if audio_meta else None
            })

        return jsonify({
            'pending_session_id': pending_session_id,
            'planned_count': len(cards_with_audio),
            'cards': cards_with_audio
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/math/practice/start', methods=['POST'])
def start_math_practice_session(kid_id):
    """Start a math session composed from opted-in shared decks."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        runtime_decks = get_shared_math_runtime_decks_for_kid(conn, kid)
        selected_cards = []
        for deck in runtime_decks:
            per_deck_count = int(deck['session_count'])
            if per_deck_count <= 0:
                continue

            preview_kid = {**kid, 'sessionCardCount': per_deck_count}
            cards_by_id, selected_ids = plan_deck_practice_selection(
                conn,
                preview_kid,
                int(deck['local_deck_id']),
                'math'
            )

            if len(selected_ids) == 0:
                continue

            for card_id in selected_ids:
                selected_cards.append({
                    **cards_by_id[card_id],
                    'shared_deck_id': int(deck['shared_deck_id']),
                    'deck_id': int(deck['local_deck_id']),
                    'deck_name': str(deck['name']),
                })

        if len(selected_cards) == 0:
            conn.close()
            return jsonify({'pending_session_id': None, 'cards': [], 'planned_count': 0}), 200

        pending_session_id = create_pending_session(
            kid_id,
            'math',
            {
                'kind': 'math',
                'planned_count': len(selected_cards),
                'cards': [{'id': int(card['id'])} for card in selected_cards],
            }
        )
        conn.close()

        return jsonify({
            'pending_session_id': pending_session_id,
            'planned_count': len(selected_cards),
            'cards': selected_cards
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/practice/start', methods=['POST'])
def start_lesson_reading_practice_session(kid_id):
    """Start a lesson-reading session composed from opted-in shared decks."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid)
        runtime_decks = get_shared_lesson_reading_runtime_decks_for_kid(conn, kid)

        selected_cards = []
        for deck in runtime_decks:
            per_deck_count = int(deck['session_count'])
            if per_deck_count <= 0:
                continue

            preview_kid = {**kid, 'sessionCardCount': per_deck_count}
            cards_by_id, selected_ids = plan_deck_practice_selection(
                conn,
                preview_kid,
                int(deck['local_deck_id']),
                'lesson_reading'
            )
            if len(selected_ids) == 0:
                continue

            for card_id in selected_ids:
                selected_cards.append({
                    **cards_by_id[card_id],
                    'shared_deck_id': int(deck['shared_deck_id']),
                    'deck_id': int(deck['local_deck_id']),
                    'deck_name': str(deck['name']),
                })

        if len(selected_cards) == 0:
            conn.close()
            return jsonify({'pending_session_id': None, 'cards': [], 'planned_count': 0}), 200

        pending_session_id = create_pending_session(
            kid_id,
            'lesson_reading',
            {
                'kind': 'lesson_reading',
                'planned_count': len(selected_cards),
                'cards': [{'id': int(card['id'])} for card in selected_cards],
                'lesson_audio_dir': ensure_lesson_reading_audio_dir(kid),
            }
        )
        conn.close()

        return jsonify({
            'pending_session_id': pending_session_id,
            'planned_count': len(selected_cards),
            'cards': selected_cards
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/practice/upload-audio', methods=['POST'])
def upload_lesson_reading_practice_audio(kid_id):
    """Upload one lesson-reading recording clip for an active pending session."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        pending_session_id = str(request.form.get('pendingSessionId') or '').strip()
        card_id_raw = request.form.get('cardId')
        if not pending_session_id:
            return jsonify({'error': 'pendingSessionId is required'}), 400
        try:
            card_id = int(card_id_raw)
        except (TypeError, ValueError):
            return jsonify({'error': 'cardId must be an integer'}), 400
        if 'audio' not in request.files:
            return jsonify({'error': 'Audio recording is required'}), 400

        pending = get_pending_session(pending_session_id, kid_id, 'lesson_reading')
        if not pending:
            return jsonify({'error': 'Pending session not found or expired'}), 404

        planned_ids = set()
        for card in pending.get('cards', []) if isinstance(pending.get('cards'), list) else []:
            try:
                planned_ids.add(int(card.get('id')))
            except Exception:
                continue
        if len(planned_ids) > 0 and card_id not in planned_ids:
            return jsonify({'error': 'cardId is not in this pending session'}), 400

        audio_file = request.files['audio']
        if not audio_file or audio_file.filename == '':
            return jsonify({'error': 'Audio recording is required'}), 400
        audio_bytes = audio_file.read()
        if not audio_bytes:
            return jsonify({'error': 'Uploaded audio is empty'}), 400

        safe_name = secure_filename(audio_file.filename or '')
        ext = os.path.splitext(safe_name)[1].lower()
        if not ext:
            ext = '.webm'
        mime_type = audio_file.mimetype or 'application/octet-stream'

        audio_dir = ensure_lesson_reading_audio_dir(kid)
        file_name = f"lr_{pending_session_id}_{card_id}_{uuid.uuid4().hex}{ext}"
        file_path = os.path.join(audio_dir, file_name)
        with open(file_path, 'wb') as f:
            f.write(audio_bytes)

        old_file_name = None
        with _PENDING_SESSIONS_LOCK:
            live = _PENDING_SESSIONS.get(pending_session_id)
            if (
                not live
                or str(live.get('kid_id')) != str(kid_id)
                or str(live.get('session_type')) != 'lesson_reading'
            ):
                try:
                    os.remove(file_path)
                except Exception:
                    pass
                return jsonify({'error': 'Pending session not found or expired'}), 404

            lesson_audio_by_card = live.get('lesson_audio_by_card')
            if not isinstance(lesson_audio_by_card, dict):
                lesson_audio_by_card = {}
                live['lesson_audio_by_card'] = lesson_audio_by_card
            if not str(live.get('lesson_audio_dir') or '').strip():
                live['lesson_audio_dir'] = audio_dir

            old_meta = lesson_audio_by_card.get(str(card_id))
            if isinstance(old_meta, dict):
                old_file_name = str(old_meta.get('file_name') or '').strip() or None

            lesson_audio_by_card[str(card_id)] = {
                'file_name': file_name,
                'mime_type': mime_type,
            }

        if old_file_name:
            old_path = os.path.join(audio_dir, old_file_name)
            if os.path.exists(old_path):
                try:
                    os.remove(old_path)
                except Exception:
                    pass

        return jsonify({
            'pending_session_id': pending_session_id,
            'card_id': card_id,
            'file_name': file_name,
            'mime_type': mime_type,
            'audio_url': f"/api/kids/{kid_id}/lesson-reading/audio/{file_name}",
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/math/practice/complete', methods=['POST'])
def complete_math_practice_session(kid_id):
    """Complete a math practice session with all answers."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload, status_code = complete_session_internal(
            kid,
            kid_id,
            'math',
            request.get_json() or {}
        )
        return jsonify(payload), status_code
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/practice/complete', methods=['POST'])
def complete_lesson_reading_practice_session(kid_id):
    """Complete a lesson-reading practice session with all answers."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload_data = None
        content_type = str(request.content_type or '')
        if content_type.startswith('multipart/form-data'):
            pending_session_id = str(request.form.get('pendingSessionId') or '').strip()
            answers_raw = request.form.get('answers')
            started_at = str(request.form.get('startedAt') or '').strip()
            if not pending_session_id:
                return jsonify({'error': 'pendingSessionId is required'}), 400
            if not answers_raw:
                return jsonify({'error': 'answers is required'}), 400
            try:
                answers = json.loads(answers_raw)
            except Exception:
                return jsonify({'error': 'answers must be valid JSON'}), 400

            uploaded_audio_by_card = {}
            for field_name, audio_file in request.files.items():
                if not str(field_name).startswith('audio_'):
                    continue
                card_id_raw = str(field_name).split('_', 1)[1]
                try:
                    card_id = int(card_id_raw)
                except (TypeError, ValueError):
                    continue
                audio_bytes = audio_file.read()
                if not audio_bytes:
                    return jsonify({'error': f'Uploaded audio for card {card_id} is empty'}), 400
                uploaded_audio_by_card[card_id] = {
                    'bytes': audio_bytes,
                    'mime_type': audio_file.mimetype or 'application/octet-stream',
                    'filename': audio_file.filename or '',
                }

            payload_data = {
                'pendingSessionId': pending_session_id,
                'answers': answers,
                'startedAt': started_at or None,
                '_uploaded_lesson_audio_by_card': uploaded_audio_by_card,
            }
        else:
            payload_data = request.get_json() or {}

        payload, status_code = complete_session_internal(
            kid,
            kid_id,
            'lesson_reading',
            payload_data
        )
        return jsonify(payload), status_code
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/writing/practice/complete', methods=['POST'])
def complete_writing_practice_session(kid_id):
    """Complete a writing practice session with all answers."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload, status_code = complete_session_internal(
            kid,
            kid_id,
            'writing',
            request.get_json() or {}
        )
        return jsonify(payload), status_code
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/practice/complete', methods=['POST'])
def complete_practice_session(kid_id):
    """Complete a Chinese practice session with all answers."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload, status_code = complete_session_internal(
            kid,
            kid_id,
            'flashcard',
            request.get_json() or {}
        )
        return jsonify(payload), status_code

    except Exception as e:
        return jsonify({'error': str(e)}), 500
