"""Kid management API routes"""
from flask import Blueprint, request, jsonify, send_from_directory, send_file, session
from datetime import datetime, timedelta, timezone
from collections import defaultdict
import hashlib
import math
import json
import os
import random
import shutil
import subprocess
import uuid
import time
import threading
import mimetypes
import re
from io import BytesIO
from urllib.parse import quote
from zoneinfo import ZoneInfo
from werkzeug.utils import secure_filename
from src.badges.session_sync import sync_badges_after_session_complete
from src.db import metadata, kid_db
from src.db.shared_deck_db import get_shared_decks_connection
from src.security_rate_limit import (
    CRITICAL_PASSWORD_RATE_LIMITER,
    build_critical_password_limit_key,
)
from src.type4_generator_preview import preview_type4_generator, run_type4_generator

kids_bp = Blueprint('kids', __name__)

MIN_SESSION_CARD_COUNT = 1
DEFAULT_HARD_CARD_PERCENTAGE = 0
MIN_HARD_CARD_PERCENTAGE = 0
MAX_HARD_CARD_PERCENTAGE = 100
DEFAULT_INCLUDE_ORPHAN_IN_QUEUE = True
TYPE_I_NON_CHINESE_DECK_MIX_FIELD = 'sharedMathDeckMix'
SESSION_CARD_COUNT_BY_CATEGORY_FIELD = 'sessionCardCountByCategory'
HARD_CARD_PERCENT_BY_CATEGORY_FIELD = 'hardCardPercentageByCategory'
INCLUDE_ORPHAN_BY_CATEGORY_FIELD = 'includeOrphanByCategory'
MAX_WRITING_SHEET_ROWS = 12
BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
DATA_DIR = os.path.join(BACKEND_ROOT, 'data')
FAMILIES_ROOT = os.path.join(DATA_DIR, 'families')
DECK_CATEGORY_BEHAVIOR_TYPE_I = 'type_i'
DECK_CATEGORY_BEHAVIOR_TYPE_II = 'type_ii'
DECK_CATEGORY_BEHAVIOR_TYPE_III = 'type_iii'
DECK_CATEGORY_BEHAVIOR_TYPE_IV = 'type_iv'
DECK_CATEGORY_BEHAVIOR_TYPES = {
    DECK_CATEGORY_BEHAVIOR_TYPE_I,
    DECK_CATEGORY_BEHAVIOR_TYPE_II,
    DECK_CATEGORY_BEHAVIOR_TYPE_III,
    DECK_CATEGORY_BEHAVIOR_TYPE_IV,
}
MAX_SHARED_DECK_TAGS = 20
MAX_SHARED_DECK_CARDS = 10000
MAX_SHARED_TAG_LENGTH = 64
MAX_SHARED_TAG_COMMENT_LENGTH = 120
MAX_TYPE_IV_DISPLAY_LABEL_LENGTH = 120
MAX_TYPE_IV_GENERATOR_CODE_LENGTH = 20000
DEFAULT_TYPE_IV_DAILY_TARGET_COUNT = 10
MAX_TYPE_IV_DAILY_TARGET_COUNT = 1000
TYPE_IV_PREVIEW_SAMPLE_COUNT = 3
TYPE_IV_DEFAULT_PRACTICE_MODE = 'input'
TYPE_IV_PRACTICE_MODE_INPUT = 'input'
TYPE_IV_PRACTICE_MODE_MULTI = 'multi'
TYPE_IV_MAX_LOGGED_RESPONSE_TIME_MS = 2 * 60 * 1000
MAX_SHARED_DECK_OPTIN_BATCH = 200
MATERIALIZED_SHARED_DECK_NAME_PREFIX = 'shared_deck_'
KID_DECK_CATEGORY_OPT_IN_TABLE = 'deck_category_opt_in'
KID_DECK_CATEGORY_OPT_IN_COL_IS_OPTED_IN = 'is_opted_in'
KID_DECK_CATEGORY_OPT_IN_COL_SESSION_CARD_COUNT = 'session_card_count'
KID_DECK_CATEGORY_OPT_IN_COL_HARD_CARD_PERCENTAGE = 'hard_card_percentage'
KID_DECK_CATEGORY_OPT_IN_COL_INCLUDE_ORPHAN = 'include_orphan'
WRITING_AUDIO_EXTENSION = '.mp3'
WRITING_AUDIO_FILE_NAME_MAX_BYTES = 220
WRITING_TTS_LANGUAGE_ZH = 'zh-CN'
WRITING_TTS_LANGUAGE_EN = 'en'
PENDING_SESSION_TTL_SECONDS = 60 * 60 * 6
TYPE_I_MAX_LOGGED_RESPONSE_TIME_MS = 20 * 1000
TYPE_II_MAX_LOGGED_RESPONSE_TIME_MS = 2 * 60 * 1000
SESSION_RESULT_CORRECT = 1
SESSION_RESULT_WRONG_UNRESOLVED = -1
# session_results.correct also carries retry-resolution metadata for type-I/type-II
# star chains. Values mean:
#   1   -> right on the initial session pass
#  -1   -> still wrong and still eligible for another retry session
#  -2   -> was wrong first, then fixed on retry round 1
#  -3   -> was wrong first, then fixed on retry round 2
#  -4   -> was wrong first, then fixed on retry round 3
# and so on. In other words, any value <= -2 means "recovered in retry", and
# abs(correct) - 1 tells us which retry round finally fixed the card.
SESSION_RESULT_RETRY_FIXED_FIRST = -2
MAX_LOGGED_RESPONSE_TIME_MS_BY_BEHAVIOR_TYPE = {
    DECK_CATEGORY_BEHAVIOR_TYPE_I: TYPE_I_MAX_LOGGED_RESPONSE_TIME_MS,
    DECK_CATEGORY_BEHAVIOR_TYPE_II: TYPE_II_MAX_LOGGED_RESPONSE_TIME_MS,
    DECK_CATEGORY_BEHAVIOR_TYPE_IV: TYPE_IV_MAX_LOGGED_RESPONSE_TIME_MS,
}
_PENDING_SESSIONS = {}
_PENDING_SESSIONS_LOCK = threading.Lock()
_SHARED_DECK_MUTATION_LOCK = threading.RLock()
PENDING_RETRY_SOURCE_SESSION_ID_KEY = 'retry_source_session_id'
PENDING_CONTINUE_SOURCE_SESSION_ID_KEY = 'continue_source_session_id'
_PYPINYIN_DICTS_LOADED = False


def get_family_root(family_id):
    """Return filesystem root for one family."""
    return os.path.join(FAMILIES_ROOT, f'family_{family_id}')


def encode_retry_recovered_session_result(existing_retry_count):
    """Return the negative correct value for a card fixed in the next retry round."""
    retry_count = max(0, int(existing_retry_count or 0))
    return -(retry_count + 2)


def get_kid_scoped_db_relpath(kid):
    """Return family-scoped dbFilePath for a kid."""
    family_id = str(kid.get('familyId') or '')
    kid_id = kid.get('id')
    return f"data/families/family_{family_id}/kid_{kid_id}.db"


def get_shared_writing_audio_dir():
    """Get global shared directory for auto-generated writing prompt audio."""
    return os.path.join(DATA_DIR, 'shared', 'writing_audio')


def ensure_shared_writing_audio_dir():
    """Ensure global shared writing-audio directory exists."""
    path = get_shared_writing_audio_dir()
    os.makedirs(path, exist_ok=True)
    return path


def normalize_writing_audio_text(front_text):
    """Normalize card front text used for deterministic TTS filenames."""
    text = re.sub(r'\s+', ' ', str(front_text or '').strip())
    return text


def get_writing_tts_language(has_chinese_specific_logic=True):
    """Choose type-II TTS language from category mode."""
    return WRITING_TTS_LANGUAGE_ZH if bool(has_chinese_specific_logic) else WRITING_TTS_LANGUAGE_EN


def build_writing_front_tts_text(front_text, back_text, has_chinese_specific_logic=True):
    """Build spoken text for front prompt clip."""
    front_norm = normalize_writing_audio_text(front_text)
    back_norm = normalize_writing_audio_text(back_text)
    if not front_norm:
        return ''
    _ = has_chinese_specific_logic  # keep arg for call-site compatibility
    if back_norm and back_norm != front_norm:
        return f"{back_norm}, {front_norm}"
    return front_norm


def format_type2_bulk_card_text(front_text, back_text, has_chinese_specific_logic):
    """Return one user-facing card label for type-II bulk-add status messages."""
    front = str(front_text or '').strip()
    back = str(back_text or '').strip()
    if bool(has_chinese_specific_logic) or not back or back == front:
        return front or back
    return f'{front} -> {back}'


def build_shared_writing_audio_file_name(front_text):
    """Build deterministic shared audio filename from writing card front text."""
    normalized = normalize_writing_audio_text(front_text)
    if not normalized:
        return ''

    safe = normalized.replace('/', '／').replace('\\', '＼').replace('\x00', '')
    safe = safe.strip().strip('.')
    if not safe:
        safe = 'tts'

    file_name = f"{safe}{WRITING_AUDIO_EXTENSION}"
    if len(file_name.encode('utf-8')) <= WRITING_AUDIO_FILE_NAME_MAX_BYTES:
        return file_name

    digest = hashlib.sha1(normalized.encode('utf-8')).hexdigest()[:12]
    prefix = safe[:40].strip() or 'tts'
    return f"{prefix}_{digest}{WRITING_AUDIO_EXTENSION}"


def build_writing_audio_meta_for_front(
    kid_id,
    front_text,
    *,
    category_key,
):
    """Build writing audio metadata payload for one front text."""
    file_name = build_shared_writing_audio_file_name(front_text)
    if not file_name:
        return {
            'audio_file_name': None,
            'audio_mime_type': None,
            'audio_url': None,
        }

    mime_type = mimetypes.guess_type(file_name)[0] or 'audio/mpeg'
    query = (
        f"?categoryKey={quote(str(category_key).strip(), safe='')}"
        if str(category_key or '').strip()
        else ''
    )
    encoded_file_name = quote(file_name, safe='')
    return {
        'audio_file_name': file_name,
        'audio_mime_type': mime_type,
        'audio_url': f"/api/kids/{kid_id}/type2/audio/{encoded_file_name}{query}",
    }


def build_writing_prompt_audio_payload(
    kid_id,
    front_text,
    *,
    category_key,
    has_chinese_specific_logic,
):
    """Build writing prompt audio payload using a single front-prompt clip."""
    front_meta = build_writing_audio_meta_for_front(
        kid_id,
        front_text,
        category_key=category_key,
    )

    return {
        'audio_file_name': front_meta.get('audio_file_name'),
        'audio_mime_type': front_meta.get('audio_mime_type'),
        'audio_url': front_meta.get('audio_url'),
        'prompt_audio_url': front_meta.get('audio_url'),
    }


def synthesize_shared_writing_audio(
    front_text,
    overwrite=False,
    spoken_text=None,
    *,
    has_chinese_specific_logic=True,
):
    """Generate shared TTS clip for writing text, returns (file_name, generated_now)."""
    normalized_front = normalize_writing_audio_text(front_text)
    if not normalized_front:
        raise ValueError('Card front is empty, cannot generate audio')

    tts_language = get_writing_tts_language(has_chinese_specific_logic)
    file_name = build_shared_writing_audio_file_name(normalized_front)
    if not file_name:
        raise ValueError('Unable to derive audio file name from card front')
    normalized_spoken = normalize_writing_audio_text(
        spoken_text if spoken_text is not None else normalized_front
    )
    if not normalized_spoken:
        raise ValueError('Card prompt text is empty, cannot generate audio')

    audio_dir = ensure_shared_writing_audio_dir()
    audio_path = os.path.join(audio_dir, file_name)
    if (not overwrite) and os.path.exists(audio_path):
        return file_name, False

    temp_path = f"{audio_path}.{uuid.uuid4().hex}.tmp"
    try:
        from gtts import gTTS
        tts = gTTS(text=normalized_spoken, lang=tts_language, slow=False)
        tts.save(temp_path)
        if (not os.path.exists(temp_path)) or os.path.getsize(temp_path) == 0:
            raise RuntimeError('gTTS produced an empty audio file')
        os.replace(temp_path, audio_path)
        return file_name, True
    except Exception as gtts_exc:
        raise RuntimeError(f'Auto TTS failed (gTTS): {gtts_exc}') from gtts_exc
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


def get_kid_type3_audio_dir(kid):
    """Get filesystem directory for kid type-III recording files."""
    family_id = str(kid.get('familyId') or '')
    kid_id = kid.get('id')
    return os.path.join(get_family_root(family_id), 'lesson_reading_audio', f'kid_{kid_id}')


def ensure_type3_audio_dir(kid):
    """Ensure kid type-III audio directory exists."""
    path = get_kid_type3_audio_dir(kid)
    os.makedirs(path, exist_ok=True)
    return path


def cleanup_type3_pending_audio_files_by_payload(pending_payload):
    """Delete uploaded type-III recording files for one pending session payload."""
    if not pending_payload:
        return
    type3_audio_by_card = pending_payload.get('type3_audio_by_card')
    if not isinstance(type3_audio_by_card, dict) or len(type3_audio_by_card) == 0:
        return
    audio_dir = str(pending_payload.get('type3_audio_dir') or '').strip()
    if not audio_dir:
        return
    for item in type3_audio_by_card.values():
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


def normalize_shared_deck_tag(raw_tag):
    """Normalize one deck tag to a compact underscore format."""
    text = str(raw_tag or '').strip().lower()
    if not text:
        return ''
    text = re.sub(r'\([^()]*\)\s*$', '', text).strip()
    if not text:
        return ''
    text = re.sub(r'\s+', '_', text)
    text = re.sub(r'_+', '_', text).strip('_')
    return text


def parse_shared_deck_tag_with_comment(raw_tag):
    """Parse one raw tag into canonical key + optional display comment."""
    # Keep this parser in sync with frontend parseDeckTagInput in deck-category-common.js.
    text = str(raw_tag or '').strip()
    if not text:
        return '', ''
    match = re.match(r'^(.*?)(?:\(([^()]*)\))?$', text)
    if not match:
        return normalize_shared_deck_tag(text), ''
    base = str(match.group(1) or '').strip()
    raw_comment = str(match.group(2) or '').strip()
    tag = normalize_shared_deck_tag(base)
    comment = re.sub(r'\s+', ' ', raw_comment).strip()
    return tag, comment


def format_shared_deck_tag_display_label(tag, comment):
    """Format one canonical tag key with optional comment for dropdown labels."""
    key = normalize_shared_deck_tag(tag)
    if not key:
        return ''
    text = re.sub(r'\s+', ' ', str(comment or '').strip()).strip()
    if not text:
        return key
    return f"{key}({text})"


def extract_shared_deck_tags_and_labels(raw_tags):
    """Build canonical + display tag arrays from stored raw tag tokens."""
    tags = []
    tag_labels = []
    seen = set()
    for raw in list(raw_tags or []):
        tag, comment = parse_shared_deck_tag_with_comment(raw)
        if not tag or tag in seen:
            continue
        seen.add(tag)
        tags.append(tag)
        tag_labels.append(format_shared_deck_tag_display_label(tag, comment))
    return tags, tag_labels


def normalize_shared_deck_category_behavior(raw_behavior):
    """Normalize behavior input to canonical type_i/type_ii/type_iii/type_iv."""
    text = str(raw_behavior or '').strip().lower()
    text = re.sub(r'[\s\-]+', '_', text)
    text = re.sub(r'_+', '_', text).strip('_')
    if text in DECK_CATEGORY_BEHAVIOR_TYPES:
        return text
    return ''


def normalize_optional_bool(value, field_name, default=False):
    """Normalize optional boolean payload field."""
    if value is None:
        return bool(default)
    if isinstance(value, bool):
        return value
    raise ValueError(f'{field_name} must be a boolean')


def normalize_type_iv_multichoice_only(value, default=False):
    """Normalize generator-deck multichoice-only flag."""
    return normalize_optional_bool(value, 'isMultichoiceOnly', default=default)


def normalize_optional_display_name(value):
    """Normalize optional deck-category display name."""
    if value is None:
        return ''
    text = str(value).strip()
    if not text:
        return ''
    if len(text) > 80:
        raise ValueError('displayName is too long (max 80)')
    return text


def normalize_optional_emoji(value):
    """Normalize optional deck-category emoji."""
    if value is None:
        return ''
    text = str(value).strip()
    if not text:
        return ''
    if len(text) > 16:
        raise ValueError('emoji is too long (max 16)')
    return text


def normalize_type_iv_display_label(value):
    """Normalize required representative label for one type-IV deck."""
    text = str(value or '').strip()
    if not text:
        raise ValueError('displayLabel is required for type_iv decks')
    if len(text) > MAX_TYPE_IV_DISPLAY_LABEL_LENGTH:
        raise ValueError(
            f'displayLabel is too long (max {MAX_TYPE_IV_DISPLAY_LABEL_LENGTH})'
        )
    return text


def normalize_type_iv_generator_code(value):
    """Normalize required Python generator snippet for one type-IV deck."""
    text = str(value or '').replace('\r\n', '\n').replace('\r', '\n').strip()
    if not text:
        raise ValueError('generatorCode is required for type_iv decks')
    if len(text) > MAX_TYPE_IV_GENERATOR_CODE_LENGTH:
        raise ValueError(
            f'generatorCode is too long (max {MAX_TYPE_IV_GENERATOR_CODE_LENGTH} chars)'
        )
    return text


def get_shared_deck_categories(conn):
    """Return all shared deck categories sorted by key."""
    rows = conn.execute(
        """
        SELECT
          category_key,
          behavior_type,
          has_chinese_specific_logic,
          is_shared_with_non_super_family,
          display_name,
          emoji
        FROM deck_category
        ORDER BY category_key ASC
        """
    ).fetchall()
    categories = []
    for row in rows:
        behavior_type = str(row[1] or '').strip().lower()
        if behavior_type not in DECK_CATEGORY_BEHAVIOR_TYPES:
            continue
        categories.append({
            'category_key': str(row[0] or ''),
            'behavior_type': behavior_type,
            'has_chinese_specific_logic': bool(row[2]),
            'is_shared_with_non_super_family': bool(row[3]),
            'display_name': str(row[4] or '').strip(),
            'emoji': str(row[5] or '').strip(),
        })
    return categories


def get_allowed_shared_deck_first_tags(conn):
    """Return allowed first tags from deck categories."""
    categories = get_shared_deck_categories(conn)
    return {
        normalize_shared_deck_tag(item.get('category_key'))
        for item in categories
        if normalize_shared_deck_tag(item.get('category_key'))
    }


def build_shared_deck_tags(first_tag, extra_tags, allowed_first_tags, *, include_comments=False):
    """Build ordered unique tags list with first tag constrained by allowed values."""
    allowed = {
        normalize_shared_deck_tag(item)
        for item in list(allowed_first_tags)
        if normalize_shared_deck_tag(item)
    }
    if not allowed:
        raise ValueError('No deck categories configured')

    first = normalize_shared_deck_tag(first_tag)
    if first not in allowed:
        raise ValueError(f'firstTag must be one of: {", ".join(sorted(allowed))}')
    if len(first) > MAX_SHARED_TAG_LENGTH:
        raise ValueError(f'firstTag is too long (max {MAX_SHARED_TAG_LENGTH})')

    tags = [first]
    comments_by_tag = {}
    seen = {first}
    if extra_tags is None:
        extra_tags = []
    if not isinstance(extra_tags, list):
        raise ValueError('extraTags must be an array')

    for raw in extra_tags:
        tag, comment = parse_shared_deck_tag_with_comment(raw)
        if not tag or tag in seen:
            continue
        if len(tag) > MAX_SHARED_TAG_LENGTH:
            raise ValueError(f'Tag "{tag}" is too long (max {MAX_SHARED_TAG_LENGTH})')
        if comment and len(comment) > MAX_SHARED_TAG_COMMENT_LENGTH:
            raise ValueError(
                f'Tag comment for "{tag}" is too long '
                f'(max {MAX_SHARED_TAG_COMMENT_LENGTH})'
            )
        tags.append(tag)
        comments_by_tag[tag] = comment
        seen.add(tag)
        if len(tags) > MAX_SHARED_DECK_TAGS:
            raise ValueError(f'Too many tags (max {MAX_SHARED_DECK_TAGS})')

    if len(tags) < 2:
        raise ValueError('At least one additional tag is required')
    if include_comments:
        return tags, comments_by_tag
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
    return dedupe_shared_deck_cards_by_key(cards, 'front')


def dedupe_shared_deck_cards_by_back(cards):
    """Deduplicate cards by back text, preserving first-seen order."""
    return dedupe_shared_deck_cards_by_key(cards, 'back')


def dedupe_shared_deck_cards_by_key(cards, key):
    """Deduplicate cards by one key field, preserving first-seen order."""
    key_name = str(key or '').strip()
    if key_name not in {'front', 'back'}:
        raise ValueError('key must be "front" or "back"')
    deduped = []
    seen_values = set()
    for card in cards:
        key_value = str(card.get(key_name) or '')
        if key_value in seen_values:
            continue
        seen_values.add(key_value)
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


def sanitize_deck_mix_payload(raw_mix):
    """Sanitize stored deck-mix payload values keyed by deck id."""
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


def normalize_type_iv_daily_count(value, *, label='daily_count'):
    """Normalize one type-IV per-deck daily count."""
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise ValueError(f'{label} must be an integer') from None
    if parsed < 0:
        raise ValueError(f'{label} must be 0 or more')
    if parsed > MAX_TYPE_IV_DAILY_TARGET_COUNT:
        raise ValueError(
            f'{label} must be {MAX_TYPE_IV_DAILY_TARGET_COUNT} or less'
        )
    return parsed


def normalize_type_iv_daily_counts_payload(raw_map):
    """Normalize shared-deck-id -> daily-count payload for type-IV settings."""
    if not isinstance(raw_map, dict):
        raise ValueError('dailyCountsByDeckId must be an object')

    normalized = {}
    for raw_key, raw_value in raw_map.items():
        try:
            shared_deck_id = int(str(raw_key or '').strip())
        except (TypeError, ValueError):
            raise ValueError('dailyCountsByDeckId keys must be shared deck ids') from None
        if shared_deck_id <= 0:
            raise ValueError('dailyCountsByDeckId keys must be shared deck ids')
        normalized[shared_deck_id] = normalize_type_iv_daily_count(
            raw_value,
            label=f'dailyCountsByDeckId[{shared_deck_id}]',
        )
        if len(normalized) > MAX_SHARED_DECK_OPTIN_BATCH:
            raise ValueError(
                f'dailyCountsByDeckId exceeds max allowed ({MAX_SHARED_DECK_OPTIN_BATCH})'
            )
    return normalized


def normalize_deck_category_keys(category_keys):
    """Validate and normalize deck-category keys for kid opt-in payloads."""
    if category_keys is None:
        return []
    if not isinstance(category_keys, list):
        raise ValueError('categoryKeys must be an array')
    if len(category_keys) > MAX_SHARED_DECK_OPTIN_BATCH:
        raise ValueError(f'categoryKeys exceeds max allowed ({MAX_SHARED_DECK_OPTIN_BATCH})')

    normalized = []
    seen = set()
    for index, item in enumerate(category_keys):
        key = normalize_shared_deck_tag(item)
        if not key:
            raise ValueError(f'categoryKeys[{index}] must be a non-empty string')
        if len(key) > MAX_SHARED_TAG_LENGTH:
            raise ValueError(f'categoryKeys[{index}] is too long (max {MAX_SHARED_TAG_LENGTH})')
        if key in seen:
            continue
        seen.add(key)
        normalized.append(key)
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
    tags, _ = extract_shared_deck_tags_and_labels(shared_tags)
    return tags


def get_materialized_shared_deck_rows_by_shared_deck_id(conn, shared_deck_id):
    """Return kid-local materialized deck rows for one shared deck id."""
    try:
        shared_id = int(shared_deck_id)
    except (TypeError, ValueError):
        return []
    if shared_id <= 0:
        return []
    rows = conn.execute(
        "SELECT id, name, tags FROM decks WHERE name LIKE ? ORDER BY id ASC",
        [f"{MATERIALIZED_SHARED_DECK_NAME_PREFIX}%"],
    ).fetchall()
    matched = []
    for row in rows:
        local_name = str(row[1] or '')
        parsed_shared_id = parse_shared_deck_id_from_materialized_name(local_name)
        if parsed_shared_id != shared_id:
            continue
        matched.append(row)
    return matched


def sync_materialized_shared_deck_metadata_for_kid(conn, shared_deck_id, shared_deck_name, shared_storage_tags):
    """Align one kid DB's materialized deck metadata with the shared deck source."""
    target_name = build_materialized_shared_deck_name(shared_deck_id, shared_deck_name)
    target_tags = build_materialized_shared_deck_tags(shared_storage_tags)
    rows = get_materialized_shared_deck_rows_by_shared_deck_id(conn, shared_deck_id)
    if not rows:
        return 0

    changed_rows = []
    for deck_id, name, tags in rows:
        current_name = str(name or '')
        current_tags = [str(item) for item in list(tags or [])]
        if current_name == target_name and current_tags == target_tags:
            continue
        changed_rows.append(int(deck_id))

    if not changed_rows:
        return 0

    conn.execute("BEGIN TRANSACTION")
    try:
        for deck_id in changed_rows:
            conn.execute(
                "UPDATE decks SET name = ?, tags = ? WHERE id = ?",
                [target_name, target_tags, deck_id],
            )
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return len(changed_rows)


def sync_materialized_shared_deck_metadata_for_all_kids(shared_deck_id, shared_deck_name, shared_storage_tags):
    """Propagate one shared deck's renamed metadata to every kid DB."""
    updated_kid_ids = []
    updated_deck_count = 0
    failures = []
    for kid in metadata.get_all_kids():
        conn = None
        try:
            conn = get_kid_connection_for(kid)
            changed_count = sync_materialized_shared_deck_metadata_for_kid(
                conn,
                shared_deck_id,
                shared_deck_name,
                shared_storage_tags,
            )
            if changed_count > 0:
                updated_kid_ids.append(str(kid.get('id') or ''))
                updated_deck_count += changed_count
        except Exception as e:
            failures.append({
                'kid_id': str(kid.get('id') or ''),
                'kid_name': str(kid.get('name') or ''),
                'error': str(e),
            })
        finally:
            if conn is not None:
                conn.close()
    return {
        'updated_kid_ids': updated_kid_ids,
        'updated_kid_count': len(updated_kid_ids),
        'updated_deck_count': int(updated_deck_count),
        'failures': failures,
    }


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
        tags, tag_labels = extract_shared_deck_tags_and_labels(row[2])
        if required_tag not in tags:
            continue
        decks.append({
            'deck_id': int(row[0]),
            'name': str(row[1]),
            'tags': tags,
            'tag_labels': tag_labels,
            'creator_family_id': int(row[3]),
            'created_at': row[4].isoformat() if row[4] else None,
            'card_count': int(row[5] or 0),
        })
    return decks


def get_shared_type_ii_deck_rows(conn, category_key):
    """Return all shared decks tagged by one type-II category key with card counts."""
    first_tag = normalize_shared_deck_tag(category_key)
    if not first_tag:
        return []
    return get_shared_deck_rows_by_first_tag(conn, first_tag)


def get_shared_type_iv_deck_rows(conn, category_key):
    """Return type-IV shared decks with their representative-card label."""
    first_tag = normalize_shared_deck_tag(category_key)
    if not first_tag:
        return []

    decks = get_shared_deck_rows_by_first_tag(conn, first_tag)
    deck_ids = [int(deck['deck_id']) for deck in decks]
    if not deck_ids:
        return decks

    placeholders = ','.join(['?'] * len(deck_ids))
    card_rows = conn.execute(
        f"""
        SELECT deck_id, front, back
        FROM cards
        WHERE deck_id IN ({placeholders})
        ORDER BY deck_id ASC, id ASC
        """,
        deck_ids
    ).fetchall()
    representative_by_deck_id = {}
    for row in card_rows:
        deck_id = int(row[0])
        if deck_id in representative_by_deck_id:
            continue
        representative_by_deck_id[deck_id] = {
            'representative_front': str(row[1] or ''),
            'representative_back': str(row[2] or ''),
        }

    for deck in decks:
        representative = representative_by_deck_id.get(int(deck['deck_id'])) or {}
        deck['representative_front'] = str(representative.get('representative_front') or '')
        deck['representative_back'] = str(representative.get('representative_back') or '')
    return decks


def find_shared_type_iv_representative_label_conflict(
    conn,
    category_key,
    representative_label,
    *,
    exclude_deck_id=None,
):
    """Find an existing type-IV deck in one category by representative label."""
    category = normalize_shared_deck_tag(category_key)
    label = normalize_type_iv_display_label(representative_label)
    excluded = None
    if exclude_deck_id is not None:
        try:
            excluded = int(exclude_deck_id)
        except (TypeError, ValueError):
            excluded = None

    for deck in get_shared_type_iv_deck_rows(conn, category):
        deck_id = int(deck.get('deck_id') or 0)
        if excluded is not None and deck_id == excluded:
            continue
        if str(deck.get('representative_front') or '').strip() != label:
            continue
        return {
            'deck_id': deck_id,
            'deck_name': str(deck.get('name') or '').strip(),
            'representative_label': label,
            'tags': list(deck.get('tags') or []),
            'tag_labels': list(deck.get('tag_labels') or []),
        }
    return None


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
        tags, tag_labels = extract_shared_deck_tags_and_labels(row[2])
        if required_tag not in tags:
            continue
        decks[local_deck_id] = {
            'local_deck_id': local_deck_id,
            'local_name': local_name,
            'shared_deck_id': shared_deck_id,
            'tags': tags,
            'tag_labels': tag_labels,
        }
    return decks


def get_kid_materialized_shared_type_ii_decks(conn, category_key):
    """Return kid-local materialized shared type-II decks keyed by local deck id."""
    first_tag = normalize_shared_deck_tag(category_key)
    if not first_tag:
        return {}
    return get_kid_materialized_shared_decks_by_first_tag(conn, first_tag)


def hydrate_kid_category_config_from_db(
    kid,
    *,
    category_meta_by_key=None,
    force_reload=False,
    conn=None,
):
    """Populate kid payload with per-category config maps sourced from kid DB."""
    if not force_reload:
        existing_session = kid.get(SESSION_CARD_COUNT_BY_CATEGORY_FIELD)
        existing_hard = kid.get(HARD_CARD_PERCENT_BY_CATEGORY_FIELD)
        existing_orphan = kid.get(INCLUDE_ORPHAN_BY_CATEGORY_FIELD)
        existing_opted = kid.get('optedInDeckCategoryKeys')
        if (
            isinstance(existing_session, dict)
            and isinstance(existing_hard, dict)
            and isinstance(existing_orphan, dict)
            and isinstance(existing_opted, list)
        ):
            return kid

    metadata = (
        category_meta_by_key
        if isinstance(category_meta_by_key, dict)
        else get_shared_deck_category_meta_by_key()
    )
    category_keys = sorted(
        {
            normalize_shared_deck_tag(raw_key)
            for raw_key in metadata.keys()
            if normalize_shared_deck_tag(raw_key)
        }
    )
    session_by_category = {key: 0 for key in category_keys}
    hard_pct_by_category = {key: DEFAULT_HARD_CARD_PERCENTAGE for key in category_keys}
    include_orphan_by_category = {key: DEFAULT_INCLUDE_ORPHAN_IN_QUEUE for key in category_keys}
    opted_in_set = set()

    local_conn = conn
    owns_conn = False
    if local_conn is None:
        local_conn = get_kid_connection_for(kid)
        owns_conn = True
    try:
        rows = local_conn.execute(
            f"""
            SELECT
              category_key,
              COALESCE({KID_DECK_CATEGORY_OPT_IN_COL_IS_OPTED_IN}, FALSE) AS is_opted_in,
              COALESCE({KID_DECK_CATEGORY_OPT_IN_COL_SESSION_CARD_COUNT}, 0) AS session_card_count,
              COALESCE({KID_DECK_CATEGORY_OPT_IN_COL_HARD_CARD_PERCENTAGE}, {DEFAULT_HARD_CARD_PERCENTAGE}) AS hard_card_percentage,
              COALESCE({KID_DECK_CATEGORY_OPT_IN_COL_INCLUDE_ORPHAN}, TRUE) AS include_orphan
            FROM {KID_DECK_CATEGORY_OPT_IN_TABLE}
            """
        ).fetchall()
    finally:
        if owns_conn and local_conn is not None:
            local_conn.close()

    for row in rows:
        key = normalize_shared_deck_tag(row[0])
        if not key:
            continue
        session_by_category[key] = max(
            0,
            int(row[2] or 0),
        )
        hard_pct_by_category[key] = _normalize_hard_card_percentage_value(row[3])
        include_orphan_by_category[key] = bool(row[4])
        if bool(row[1]):
            opted_in_set.add(key)

    opted_in_keys = [
        key for key in category_keys
        if key in opted_in_set
    ]
    for key in sorted(opted_in_set):
        if key not in category_keys:
            opted_in_keys.append(key)

    kid[SESSION_CARD_COUNT_BY_CATEGORY_FIELD] = session_by_category
    kid[HARD_CARD_PERCENT_BY_CATEGORY_FIELD] = hard_pct_by_category
    kid[INCLUDE_ORPHAN_BY_CATEGORY_FIELD] = include_orphan_by_category
    kid['optedInDeckCategoryKeys'] = opted_in_keys
    return kid


def get_category_session_card_count_for_kid(kid, category_key):
    """Return one category's configured cards-per-session value."""
    key = normalize_shared_deck_tag(category_key)
    if not key:
        return 0
    raw_map = kid.get(SESSION_CARD_COUNT_BY_CATEGORY_FIELD)
    if not isinstance(raw_map, dict):
        hydrate_kid_category_config_from_db(kid)
        raw_map = kid.get(SESSION_CARD_COUNT_BY_CATEGORY_FIELD)
    if not isinstance(raw_map, dict):
        return 0
    raw_value = raw_map.get(key, 0)
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        return 0
    return max(0, parsed)


def with_preview_session_count_for_category(kid, category_key, session_count):
    """Return kid-like payload overriding one category session count for planning."""
    key = normalize_shared_deck_tag(category_key)
    if not key:
        return {**kid}

    try:
        parsed = int(session_count)
    except (TypeError, ValueError):
        parsed = 0
    parsed = max(0, parsed)

    existing = kid.get(SESSION_CARD_COUNT_BY_CATEGORY_FIELD)
    merged = {}
    if isinstance(existing, dict):
        for raw_key, raw_value in existing.items():
            normalized = normalize_shared_deck_tag(raw_key)
            if normalized:
                merged[normalized] = raw_value
    merged[key] = parsed
    return {
        **kid,
        SESSION_CARD_COUNT_BY_CATEGORY_FIELD: merged,
    }


def get_category_hard_card_percentage_for_kid(kid, category_key):
    """Return one category's configured hard-card percentage."""
    key = normalize_shared_deck_tag(category_key)
    if not key:
        return DEFAULT_HARD_CARD_PERCENTAGE
    raw_map = kid.get(HARD_CARD_PERCENT_BY_CATEGORY_FIELD)
    if not isinstance(raw_map, dict):
        hydrate_kid_category_config_from_db(kid)
        raw_map = kid.get(HARD_CARD_PERCENT_BY_CATEGORY_FIELD)
    if not isinstance(raw_map, dict):
        return DEFAULT_HARD_CARD_PERCENTAGE
    return _normalize_hard_card_percentage_value(raw_map.get(key))


def get_category_include_orphan_for_kid(kid, category_key):
    """Return one category's include-orphan-in-queue setting."""
    key = normalize_shared_deck_tag(category_key)
    if not key:
        return DEFAULT_INCLUDE_ORPHAN_IN_QUEUE
    raw_map = kid.get(INCLUDE_ORPHAN_BY_CATEGORY_FIELD)
    if not isinstance(raw_map, dict):
        hydrate_kid_category_config_from_db(kid)
        raw_map = kid.get(INCLUDE_ORPHAN_BY_CATEGORY_FIELD)
    if not isinstance(raw_map, dict):
        return DEFAULT_INCLUDE_ORPHAN_IN_QUEUE
    value = raw_map.get(key)
    if isinstance(value, bool):
        return value
    return DEFAULT_INCLUDE_ORPHAN_IN_QUEUE


def get_category_orphan_deck_name(category_key):
    """Return orphan deck name for one category key."""
    key = normalize_shared_deck_tag(category_key)
    if not key:
        raise ValueError('categoryKey is required')
    return f'{key}_orphan'


def get_or_create_category_orphan_deck(conn, category_key):
    """Get/create orphan deck id for one category key."""
    key = normalize_shared_deck_tag(category_key)
    if not key:
        raise ValueError('categoryKey is required')
    return get_or_create_orphan_deck(
        conn,
        get_category_orphan_deck_name(key),
        key,
    )


def _build_shared_source_deck_entry(entry, total_cards, active_cards):
    """Build one non-orphan merged-source payload."""
    skipped_cards = max(0, total_cards - active_cards)
    tags, _ = extract_shared_deck_tags_and_labels(entry.get('tags') or [])
    return {
        'local_deck_id': int(entry['local_deck_id']),
        'shared_deck_id': int(entry['shared_deck_id']),
        'local_name': str(entry.get('local_name') or ''),
        'tags': tags,
        'is_orphan': False,
        'card_count': int(total_cards),
        'active_card_count': int(active_cards),
        'skipped_card_count': int(skipped_cards),
        'included_in_bank': True,
        'included_in_queue': True,
    }


def _build_orphan_source_deck_entry(orphan_row, orphan_deck_name, orphan_total, orphan_active, include_orphan_in_queue):
    """Build one orphan merged-source payload."""
    orphan_skipped = max(0, orphan_total - orphan_active)
    orphan_tags, _ = extract_shared_deck_tags_and_labels(orphan_row[2])
    return {
        'local_deck_id': int(orphan_row[0]),
        'shared_deck_id': None,
        'local_name': str(orphan_row[1] or orphan_deck_name),
        'tags': orphan_tags,
        'is_orphan': True,
        'card_count': int(orphan_total),
        'active_card_count': int(orphan_active),
        'skipped_card_count': int(orphan_skipped),
        'included_in_bank': bool(include_orphan_in_queue),
        'included_in_queue': bool(include_orphan_in_queue and orphan_active > 0),
    }


def get_shared_merged_source_decks_for_kid(
    conn,
    kid,
    category_key,
    *,
    get_materialized_func,
    include_orphan_in_queue_override=None,
):
    """Return merged source decks (normal + orphan) for one category."""
    first_tag = normalize_shared_deck_tag(category_key)
    if not first_tag:
        return []
    materialized_by_local_id = get_materialized_func(conn, first_tag)
    include_orphan_in_queue = (
        bool(include_orphan_in_queue_override)
        if include_orphan_in_queue_override is not None
        else get_category_include_orphan_for_kid(kid, first_tag)
    )

    sources = []
    for local_deck_id in sorted(materialized_by_local_id.keys()):
        entry = materialized_by_local_id[local_deck_id]
        local_id = int(entry['local_deck_id'])
        total_cards = int(conn.execute(
            "SELECT COUNT(*) FROM cards WHERE deck_id = ?",
            [local_id]
        ).fetchone()[0] or 0)
        active_cards = int(conn.execute(
            "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = FALSE",
            [local_id]
        ).fetchone()[0] or 0)
        sources.append(_build_shared_source_deck_entry(entry, total_cards, active_cards))

    orphan_deck_name = get_category_orphan_deck_name(first_tag)
    orphan_deck_id = get_or_create_category_orphan_deck(conn, first_tag)
    orphan_row = conn.execute(
        "SELECT id, name, tags FROM decks WHERE id = ? LIMIT 1",
        [orphan_deck_id]
    ).fetchone()
    if orphan_row:
        orphan_total = int(conn.execute(
            "SELECT COUNT(*) FROM cards WHERE deck_id = ?",
            [orphan_deck_id]
        ).fetchone()[0] or 0)
        orphan_active = int(conn.execute(
            "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = FALSE",
            [orphan_deck_id]
        ).fetchone()[0] or 0)
        sources.append(_build_orphan_source_deck_entry(
            orphan_row,
            orphan_deck_name,
            orphan_total,
            orphan_active,
            include_orphan_in_queue,
        ))

    return sources


def get_shared_type_i_merged_source_decks_for_kid(
    conn,
    kid,
    category_key,
    *,
    include_orphan_in_queue_override=None,
):
    """Return type-I source decks for merged bank and merged practice queue."""
    return get_shared_merged_source_decks_for_kid(
        conn,
        kid,
        category_key,
        get_materialized_func=get_kid_materialized_shared_decks_by_first_tag,
        include_orphan_in_queue_override=include_orphan_in_queue_override,
    )


def get_shared_type_ii_merged_source_decks_for_kid(conn, kid, category_key):
    """Return type-II source decks for merged bank and merged practice queue."""
    return get_shared_merged_source_decks_for_kid(
        conn,
        kid,
        category_key,
        get_materialized_func=get_kid_materialized_shared_type_ii_decks,
    )


def get_shared_type_iv_merged_source_decks_for_kid(
    conn,
    kid,
    category_key,
    *,
    include_orphan_in_queue_override=None,
):
    """Return type-IV source decks for merged bank and merged practice queue."""
    return get_shared_merged_source_decks_for_kid(
        conn,
        kid,
        category_key,
        get_materialized_func=get_kid_materialized_shared_decks_by_first_tag,
        include_orphan_in_queue_override=include_orphan_in_queue_override,
    )


def get_type_iv_bank_source_rows(
    conn,
    kid,
    category_key,
    *,
    include_orphan_in_queue_override=None,
):
    """Return type-IV bank sources currently included in the bank view."""
    sources = []
    for source in list(get_shared_type_iv_merged_source_decks_for_kid(
        conn,
        kid,
        category_key,
        include_orphan_in_queue_override=include_orphan_in_queue_override,
    )):
        if bool(source.get('is_orphan')):
            if int(source.get('card_count') or 0) <= 0 or not bool(source.get('included_in_bank')):
                continue
            source = dict(source)
            source['included_in_queue'] = bool(
                source.get('included_in_queue')
                and int(source.get('active_card_count') or 0) > 0
            )
        sources.append(source)
    return sources


def get_type_iv_total_daily_target_for_category(
    conn,
    kid,
    category_key,
    *,
    include_orphan_in_queue_override=None,
):
    """Return the sum of per-deck daily targets for one generator category."""
    first_tag = normalize_shared_deck_tag(category_key)
    if not first_tag:
        return 0
    materialized_by_local_id = get_kid_materialized_shared_decks_by_first_tag(conn, first_tag)
    local_deck_ids = [int(deck_id) for deck_id in materialized_by_local_id.keys()]
    total_count = 0
    if local_deck_ids:
        placeholders = ','.join(['?'] * len(local_deck_ids))
        total = conn.execute(
            f"""
            SELECT COALESCE(SUM(COALESCE(daily_target_count, 0)), 0)
            FROM decks
            WHERE id IN ({placeholders})
            """,
            local_deck_ids
        ).fetchone()
        total_count += int((total[0] if total else 0) or 0)

    include_orphan_in_queue = (
        bool(include_orphan_in_queue_override)
        if include_orphan_in_queue_override is not None
        else get_category_include_orphan_for_kid(kid, first_tag)
    )
    if not include_orphan_in_queue:
        return total_count

    orphan_row = conn.execute(
        "SELECT COALESCE(daily_target_count, 0) FROM decks WHERE name = ? LIMIT 1",
        [get_category_orphan_deck_name(first_tag)],
    ).fetchone()
    return total_count + int((orphan_row[0] if orphan_row else 0) or 0)


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


def get_shared_deck_behavior_type_from_raw_tags(conn, raw_tags):
    """Resolve behavior type for one shared deck row from its first tag."""
    tags = extract_shared_deck_tags_and_labels(raw_tags)[0]
    first_tag = normalize_shared_deck_tag(tags[0]) if tags else ''
    if not first_tag:
        return ''
    row = conn.execute(
        "SELECT behavior_type FROM deck_category WHERE category_key = ? LIMIT 1",
        [first_tag],
    ).fetchone()
    return normalize_shared_deck_category_behavior(row[0] if row else '')


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


def shared_deck_generator_definition_has_multichoice_only_column(conn):
    """Return whether shared generator definitions already include the multichoice-only flag."""
    row = conn.execute(
        """
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'main'
          AND table_name = 'deck_generator_definition'
          AND column_name = 'is_multichoice_only'
        LIMIT 1
        """
    ).fetchone()
    return bool(row)


def get_shared_deck_generator_definition(conn, deck_id):
    """Return immutable generator definition for one shared type-IV deck."""
    if shared_deck_generator_definition_has_multichoice_only_column(conn):
        row = conn.execute(
            """
            SELECT code, is_multichoice_only, created_at
            FROM deck_generator_definition
            WHERE deck_id = ?
            LIMIT 1
            """,
            [deck_id],
        ).fetchone()
    else:
        row = conn.execute(
            """
            SELECT code, created_at
            FROM deck_generator_definition
            WHERE deck_id = ?
            LIMIT 1
            """,
            [deck_id],
        ).fetchone()
    if row is None:
        return None
    if len(row) >= 3:
        code = str(row[0] or '')
        is_multichoice_only = bool(row[1]) if row[1] is not None else False
        created_at = row[2]
    else:
        code = str(row[0] or '') if len(row) >= 1 else ''
        is_multichoice_only = False
        created_at = row[1] if len(row) >= 2 else None
    return {
        'code': code,
        'is_multichoice_only': bool(is_multichoice_only),
        'created_at': created_at.isoformat() if created_at else None,
    }


def get_shared_deck_generator_definitions_by_deck_ids(conn, deck_ids):
    """Return immutable generator definitions by shared type-IV deck id."""
    normalized_ids = []
    seen = set()
    for raw_id in list(deck_ids or []):
        try:
            deck_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if deck_id <= 0 or deck_id in seen:
            continue
        seen.add(deck_id)
        normalized_ids.append(deck_id)
    if not normalized_ids:
        return {}

    placeholders = ','.join(['?'] * len(normalized_ids))
    if shared_deck_generator_definition_has_multichoice_only_column(conn):
        rows = conn.execute(
            f"""
            SELECT deck_id, code, is_multichoice_only, created_at
            FROM deck_generator_definition
            WHERE deck_id IN ({placeholders})
            """,
            normalized_ids,
        ).fetchall()
    else:
        rows = conn.execute(
            f"""
            SELECT deck_id, code, created_at
            FROM deck_generator_definition
            WHERE deck_id IN ({placeholders})
            """,
            normalized_ids,
        ).fetchall()
    definitions = {}
    for row in rows:
        deck_id = int(row[0] or 0) if row else 0
        if deck_id <= 0:
            continue
        if len(row) >= 4:
            code = str(row[1] or '')
            is_multichoice_only = bool(row[2]) if row[2] is not None else False
            created_at = row[3]
        else:
            code = str(row[1] or '') if len(row) >= 2 else ''
            is_multichoice_only = False
            created_at = row[2] if len(row) >= 3 else None
        definitions[deck_id] = {
            'code': code,
            'is_multichoice_only': bool(is_multichoice_only),
            'created_at': created_at.isoformat() if created_at else None,
        }
    return definitions


def build_type_iv_card_generator_details_by_shared_id(deck_ids):
    """Return generator code keyed by shared type-IV deck id."""
    shared_conn = None
    try:
        shared_conn = get_shared_decks_connection()
        definitions_by_id = get_shared_deck_generator_definitions_by_deck_ids(shared_conn, deck_ids)
    finally:
        if shared_conn is not None:
            shared_conn.close()

    details_by_id = {}
    for deck_id, definition in definitions_by_id.items():
        code = str(definition.get('code') or '')
        details_by_id[int(deck_id)] = {
            'code': code,
            'is_multichoice_only': bool(definition.get('is_multichoice_only')),
        }
    return details_by_id


def build_type_iv_generator_details_by_representative_front(category_key):
    """Return generator details keyed by representative front label."""
    shared_conn = None
    try:
        shared_conn = get_shared_decks_connection()
        decks = get_shared_type_iv_deck_rows(shared_conn, category_key)
        definitions_by_id = get_shared_deck_generator_definitions_by_deck_ids(
            shared_conn,
            [deck.get('deck_id') for deck in decks],
        )
    finally:
        if shared_conn is not None:
            shared_conn.close()

    details_by_front = {}
    for deck in decks:
        representative_front = str(deck.get('representative_front') or '').strip()
        if not representative_front or representative_front in details_by_front:
            continue
        shared_deck_id = int(deck.get('deck_id') or 0)
        definition = definitions_by_id.get(shared_deck_id) or {}
        code = str(definition.get('code') or '')
        if shared_deck_id <= 0 or not code:
            continue
        details_by_front[representative_front] = {
            'shared_deck_id': shared_deck_id,
            'code': code,
            'is_multichoice_only': bool(definition.get('is_multichoice_only')),
        }
    return details_by_front


def get_shared_deck_dedupe_key(conn, raw_tags):
    """Resolve dedupe key for one shared deck from its category behavior."""
    behavior_type = get_shared_deck_behavior_type_from_raw_tags(conn, raw_tags)
    if behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_II:
        return 'back'
    return 'front'


def get_kid_card_fronts_for_deck_ids(conn, deck_ids):
    """Return distinct card fronts across selected kid-local deck ids."""
    normalized = []
    for raw_id in list(deck_ids or []):
        try:
            deck_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if deck_id <= 0 or deck_id in normalized:
            continue
        normalized.append(deck_id)
    if not normalized:
        return set()
    placeholders = ','.join(['?'] * len(normalized))
    rows = conn.execute(
        f"SELECT DISTINCT front FROM cards WHERE deck_id IN ({placeholders})",
        normalized
    ).fetchall()
    return {str(row[0] or '') for row in rows if str(row[0] or '')}


def get_kid_card_backs_for_deck_ids(conn, deck_ids):
    """Return distinct card backs across selected kid-local deck ids."""
    normalized = []
    for raw_id in list(deck_ids or []):
        try:
            deck_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if deck_id <= 0 or deck_id in normalized:
            continue
        normalized.append(deck_id)
    if not normalized:
        return set()
    placeholders = ','.join(['?'] * len(normalized))
    rows = conn.execute(
        f"SELECT DISTINCT back FROM cards WHERE deck_id IN ({placeholders})",
        normalized
    ).fetchall()
    return {str(row[0] or '') for row in rows if str(row[0] or '')}


def get_current_family_id_int():
    """Get current session family id as int, or None if invalid/missing."""
    family_id = current_family_id()
    if not family_id:
        return None
    try:
        return int(family_id)
    except (TypeError, ValueError):
        return None


def get_all_shared_deck_tag_paths(conn):
    """Return globally unique ordered shared-deck tag paths."""
    rows = conn.execute("SELECT tags FROM deck").fetchall()
    seen_paths = set()
    ordered_paths = []
    for row in rows:
        path, _ = extract_shared_deck_tags_and_labels(row[0])
        if not path:
            continue
        key = tuple(path)
        if key in seen_paths:
            continue
        seen_paths.add(key)
        ordered_paths.append(path)
    ordered_paths.sort(key=lambda items: (items[0], len(items), items))
    return ordered_paths


def normalize_shared_deck_tag_path(tags):
    """Normalize one ordered deck-tag path."""
    normalized = []
    for raw in list(tags or []):
        tag = normalize_shared_deck_tag(raw)
        if not tag:
            continue
        normalized.append(tag)
    return normalized


def find_shared_deck_tag_prefix_conflict(conn, candidate_tags):
    """Return conflicting existing tag path when one path is a strict prefix of the other."""
    candidate = tuple(normalize_shared_deck_tag_path(candidate_tags))
    if not candidate:
        return None

    existing_paths = get_all_shared_deck_tag_paths(conn)
    for raw_path in existing_paths:
        existing = tuple(normalize_shared_deck_tag_path(raw_path))
        if not existing or existing == candidate:
            continue
        common_len = min(len(existing), len(candidate))
        if common_len <= 0:
            continue
        if existing[:common_len] == candidate[:common_len]:
            return list(existing)
    return None


def format_shared_deck_tag_path(tags):
    """Format one tag path for human-readable messages."""
    normalized = normalize_shared_deck_tag_path(tags)
    return '[' + ', '.join(normalized) + ']'


def build_chinese_pinyin_text(text):
    """Generate pinyin for Chinese text using pypinyin (lazy import).

    For single-character Chinese cards, include every distinct heteronym so
    bulk-add auto-generation preserves valid multi-pronunciation cases like 还.
    For longer text, keep the existing phrase-style single reading to avoid
    exploding the output for multi-character words and phrases.
    """
    normalized = str(text or '').strip()
    if not normalized:
        return ''
    try:
        from pypinyin import lazy_pinyin, pinyin, Style  # type: ignore
    except Exception as exc:
        raise RuntimeError(
            'pypinyin is not installed. Install it in backend env: pip install pypinyin'
        ) from exc

    ensure_pypinyin_dicts_loaded()

    if len(normalized) == 1:
        heteronyms = pinyin(
            normalized,
            style=Style.TONE,
            heteronym=True,
            neutral_tone_with_five=True,
            strict=False,
            errors='default',
        )
        first_group = heteronyms[0] if heteronyms else []
        ordered = []
        seen = set()
        for item in list(first_group or []):
            syllable = str(item or '').strip()
            if not syllable or syllable in seen:
                continue
            ordered.append(syllable)
            seen.add(syllable)
        return ' / '.join(ordered)

    syllables = lazy_pinyin(
        normalized,
        style=Style.TONE,
        neutral_tone_with_five=True,
        strict=False,
        errors='default',
    )
    parts = [str(item or '').strip() for item in list(syllables or [])]
    parts = [item for item in parts if item]
    return ' '.join(parts)


def ensure_pypinyin_dicts_loaded():
    """Load optional dictionary upgrades for pypinyin once per process."""
    global _PYPINYIN_DICTS_LOADED
    if _PYPINYIN_DICTS_LOADED:
        return
    try:
        from pypinyin_dict.phrase_pinyin_data import cc_cedict  # type: ignore
        from pypinyin_dict.pinyin_data import kxhc1983  # type: ignore
    except Exception as exc:
        raise RuntimeError(
            'pypinyin-dict is not installed. Install it in backend env: pip install pypinyin-dict'
        ) from exc
    cc_cedict.load()
    kxhc1983.load()
    _PYPINYIN_DICTS_LOADED = True


@kids_bp.route('/shared-decks/categories', methods=['GET'])
def list_shared_deck_categories():
    """Return all deck categories for shared deck creation."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err

        conn = get_shared_decks_connection()
        try:
            categories = get_shared_deck_categories(conn)
        finally:
            conn.close()

        return jsonify({'categories': categories}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/categories', methods=['POST'])
def create_shared_deck_category():
    """Create one shared deck category (super-family only)."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err

        payload = request.get_json() or {}
        category_key = normalize_shared_deck_tag(payload.get('categoryKey'))
        if not category_key:
            raise ValueError('categoryKey is required')
        if len(category_key) > MAX_SHARED_TAG_LENGTH:
            raise ValueError(f'categoryKey is too long (max {MAX_SHARED_TAG_LENGTH})')

        behavior_type = normalize_shared_deck_category_behavior(payload.get('behaviorType'))
        if behavior_type not in DECK_CATEGORY_BEHAVIOR_TYPES:
            raise ValueError('behaviorType must be one of: type_i, type_ii, type_iii, type_iv')
        has_chinese_specific_logic = normalize_optional_bool(
            payload.get('hasChineseSpecificLogic'),
            'hasChineseSpecificLogic',
            False,
        )
        if (
            behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_IV
            and has_chinese_specific_logic
        ):
            raise ValueError('type_iv categories do not support hasChineseSpecificLogic')
        display_name = normalize_optional_display_name(payload.get('displayName'))
        emoji = normalize_optional_emoji(payload.get('emoji'))

        conn = get_shared_decks_connection()
        try:
            row = conn.execute(
                """
                INSERT INTO deck_category (
                    category_key,
                    behavior_type,
                    has_chinese_specific_logic,
                    is_shared_with_non_super_family,
                    display_name,
                    emoji
                )
                VALUES (?, ?, ?, FALSE, ?, ?)
                RETURNING
                  category_key,
                  behavior_type,
                  has_chinese_specific_logic,
                  is_shared_with_non_super_family,
                  display_name,
                  emoji
                """,
                [category_key, behavior_type, has_chinese_specific_logic, display_name, emoji]
            ).fetchone()
        finally:
            conn.close()

        return jsonify({
            'created': True,
            'category': {
                'category_key': str(row[0] or ''),
                'behavior_type': str(row[1] or ''),
                'has_chinese_specific_logic': bool(row[2]),
                'is_shared_with_non_super_family': bool(row[3]),
                'display_name': str(row[4] or '').strip(),
                'emoji': str(row[5] or '').strip(),
            },
        }), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        err = str(e).lower()
        if 'unique' in err and 'category_key' in err:
            return jsonify({'error': 'categoryKey already exists'}), 409
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/categories/<category_key>/emoji', methods=['PUT'])
def update_shared_deck_category_emoji(category_key):
    """Update one shared deck category emoji (super-family only)."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err

        key = normalize_shared_deck_tag(category_key)
        if not key:
            return jsonify({'error': 'categoryKey is required'}), 400

        payload = request.get_json() or {}
        emoji = normalize_optional_emoji(payload.get('emoji'))

        conn = get_shared_decks_connection()
        try:
            row = conn.execute(
                """
                UPDATE deck_category
                SET emoji = ?
                WHERE category_key = ?
                RETURNING
                  category_key,
                  behavior_type,
                  has_chinese_specific_logic,
                  is_shared_with_non_super_family,
                  display_name,
                  emoji
                """,
                [emoji, key],
            ).fetchone()
        finally:
            conn.close()

        if row is None:
            return jsonify({'error': 'Category not found'}), 404

        return jsonify({
            'updated': True,
            'category': {
                'category_key': str(row[0] or ''),
                'behavior_type': str(row[1] or ''),
                'has_chinese_specific_logic': bool(row[2]),
                'is_shared_with_non_super_family': bool(row[3]),
                'display_name': str(row[4] or '').strip(),
                'emoji': str(row[5] or '').strip(),
            },
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/categories/<category_key>/share', methods=['POST'])
def share_deck_category_to_non_super(category_key):
    """One-way share: allow non-super families to access one deck category."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err

        key = normalize_shared_deck_tag(category_key)
        if not key:
            return jsonify({'error': 'categoryKey is required'}), 400

        conn = get_shared_decks_connection()
        try:
            row = conn.execute(
                """
                SELECT
                  category_key,
                  behavior_type,
                  has_chinese_specific_logic,
                  is_shared_with_non_super_family,
                  display_name,
                  emoji
                FROM deck_category
                WHERE category_key = ?
                LIMIT 1
                """,
                [key],
            ).fetchone()
            if row is None:
                return jsonify({'error': 'Category not found'}), 404

            already_shared = bool(row[3])
            if not already_shared:
                row = conn.execute(
                    """
                    UPDATE deck_category
                    SET is_shared_with_non_super_family = TRUE
                    WHERE category_key = ?
                    RETURNING
                      category_key,
                      behavior_type,
                      has_chinese_specific_logic,
                      is_shared_with_non_super_family,
                      display_name,
                      emoji
                    """,
                    [key],
                ).fetchone()
            else:
                row = conn.execute(
                    """
                    SELECT
                      category_key,
                      behavior_type,
                      has_chinese_specific_logic,
                      is_shared_with_non_super_family,
                      display_name,
                      emoji
                    FROM deck_category
                    WHERE category_key = ?
                    LIMIT 1
                    """,
                    [key],
                ).fetchone()
        finally:
            conn.close()

        return jsonify({
            'shared': True,
            'updated': not already_shared,
            'category': {
                'category_key': str(row[0] or ''),
                'behavior_type': str(row[1] or ''),
                'has_chinese_specific_logic': bool(row[2]),
                'is_shared_with_non_super_family': bool(row[3]),
                'display_name': str(row[4] or '').strip(),
                'emoji': str(row[5] or '').strip(),
            },
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/name-availability', methods=['GET'])
def shared_deck_name_availability():
    """Check whether a shared deck name is globally available."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err
        requested_name = str(request.args.get('name') or '').strip()
        exclude_deck_id_raw = str(request.args.get('excludeDeckId') or '').strip()
        exclude_deck_id = None
        if exclude_deck_id_raw:
            try:
                exclude_deck_id = int(exclude_deck_id_raw)
            except (TypeError, ValueError):
                return jsonify({'error': 'excludeDeckId must be an integer'}), 400

        conn = get_shared_decks_connection()
        try:
            tags = None
            first_tag_raw = request.args.get('firstTag')
            if first_tag_raw is not None:
                extra_tags_raw = request.args.getlist('extraTag')
                allowed_first_tags = get_allowed_shared_deck_first_tags(conn)
                tags = build_shared_deck_tags(
                    first_tag_raw,
                    extra_tags_raw,
                    allowed_first_tags=allowed_first_tags,
                )

            deck_name = '_'.join(tags) if tags else requested_name
            if not deck_name:
                return jsonify({'error': 'name is required'}), 400

            if exclude_deck_id is not None and exclude_deck_id > 0:
                row = conn.execute(
                    "SELECT deck_id FROM deck WHERE name = ? AND deck_id <> ? LIMIT 1",
                    [deck_name, exclude_deck_id]
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT deck_id FROM deck WHERE name = ? LIMIT 1",
                    [deck_name]
                ).fetchone()
            prefix_conflict_tags = (
                find_shared_deck_tag_prefix_conflict(conn, tags)
                if tags
                else None
            )
        finally:
            conn.close()

        if row is not None:
            conflict_type = 'exact_name'
        elif prefix_conflict_tags:
            conflict_type = 'tag_prefix_conflict'
        else:
            conflict_type = None
        return jsonify({
            'name': deck_name,
            'available': row is None and not prefix_conflict_tags,
            'existing_deck_id': int(row[0]) if row else None,
            'conflict_type': conflict_type,
            'conflict_tags': prefix_conflict_tags,
            'exclude_deck_id': exclude_deck_id,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/chinese-characters/pinyin', methods=['POST'])
def shared_deck_chinese_characters_pinyin():
    """Return pinyin mapping for requested Chinese character strings."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err

        payload = request.get_json() or {}
        texts = normalize_shared_deck_fronts(payload.get('texts'))
        pinyin_by_text = {}
        for text in texts:
            pinyin_by_text[str(text)] = build_chinese_pinyin_text(text)
        return jsonify({
            'count': len(texts),
            'pinyin_by_text': pinyin_by_text,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/type4/preview', methods=['POST'])
def preview_shared_type4_generator():
    """Run a Type IV generator snippet and return example outputs."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err

        payload = request.get_json() or {}
        generator_code = normalize_type_iv_generator_code(payload.get('generatorCode'))
        raw_seed_base = payload.get('seedBase')
        if raw_seed_base in (None, ''):
            seed_base = 1000
        else:
            seed_base = int(raw_seed_base)
        samples = preview_type4_generator(
            generator_code,
            sample_count=TYPE_IV_PREVIEW_SAMPLE_COUNT,
            seed_base=seed_base,
        )
        return jsonify({
            'sample_count': len(samples),
            'samples': samples,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/type4/representative-label-availability', methods=['POST'])
def shared_type4_representative_label_availability():
    """Check whether a type-IV representative label is available in one category."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err

        payload = request.get_json() or {}
        category_key = normalize_shared_deck_tag(payload.get('categoryKey'))
        if not category_key:
            raise ValueError('categoryKey is required')
        representative_label = normalize_type_iv_display_label(payload.get('displayLabel'))
        exclude_deck_id_raw = payload.get('excludeDeckId')
        exclude_deck_id = None
        if exclude_deck_id_raw not in (None, ''):
            try:
                exclude_deck_id = int(exclude_deck_id_raw)
            except (TypeError, ValueError):
                raise ValueError('excludeDeckId must be an integer')

        conn = get_shared_decks_connection()
        try:
            category_meta = None
            for item in get_shared_deck_categories(conn):
                key = normalize_shared_deck_tag(item.get('category_key'))
                if key == category_key:
                    category_meta = item
                    break
            if category_meta is None:
                raise ValueError(f'Unknown categoryKey: {category_key}')
            behavior_type = str(category_meta.get('behavior_type') or '').strip().lower()
            if behavior_type != DECK_CATEGORY_BEHAVIOR_TYPE_IV:
                raise ValueError('Representative-label availability is only for type_iv categories')

            conflict = find_shared_type_iv_representative_label_conflict(
                conn,
                category_key,
                representative_label,
                exclude_deck_id=exclude_deck_id,
            )
        finally:
            conn.close()

        return jsonify({
            'category_key': category_key,
            'display_label': representative_label,
            'available': conflict is None,
            'existing_deck_id': int(conflict['deck_id']) if conflict else None,
            'existing_deck_name': str(conflict['deck_name']) if conflict else '',
            'existing_tags': list(conflict['tags']) if conflict else [],
            'existing_tag_labels': list(conflict['tag_labels']) if conflict else [],
            'exclude_deck_id': exclude_deck_id,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/category-card-overlap', methods=['POST'])
def shared_deck_category_card_overlap():
    """Compare candidate cards with existing cards in one category."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err

        payload = request.get_json() or {}
        category_key = normalize_shared_deck_tag(payload.get('categoryKey'))
        if not category_key:
            raise ValueError('categoryKey is required')
        cards = normalize_shared_deck_cards(payload.get('cards'))

        conn = get_shared_decks_connection()
        try:
            category_meta = None
            for item in get_shared_deck_categories(conn):
                key = normalize_shared_deck_tag(item.get('category_key'))
                if key == category_key:
                    category_meta = item
                    break
            if category_meta is None:
                raise ValueError(f'Unknown categoryKey: {category_key}')

            behavior_type = str(category_meta.get('behavior_type') or '').strip().lower()
            if behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_IV:
                raise ValueError('type_iv categories use Python generators, not static cards')
            dedupe_key = 'back' if behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_II else 'front'
            other_key = 'front' if dedupe_key == 'back' else 'back'

            rows = conn.execute(
                """
                SELECT
                  c.front,
                  c.back,
                  d.deck_id,
                  d.name
                FROM cards c
                JOIN deck d ON d.deck_id = c.deck_id
                WHERE array_length(d.tags) >= 1
                  AND lower(d.tags[1]) = ?
                ORDER BY d.deck_id ASC, c.id ASC
                """,
                [category_key],
            ).fetchall()
        finally:
            conn.close()

        existing_by_dedupe = {}
        for row in rows:
            front = str(row[0] or '')
            back = str(row[1] or '')
            dedupe_value = back if dedupe_key == 'back' else front
            existing_by_dedupe.setdefault(dedupe_value, []).append({
                'front': front,
                'back': back,
                'deck_id': int(row[2]),
                'deck_name': str(row[3] or ''),
            })

        def unique_decks(entries):
            seen = set()
            out = []
            for entry in entries:
                key = int(entry.get('deck_id') or 0)
                if key <= 0 or key in seen:
                    continue
                seen.add(key)
                out.append({
                    'deck_id': key,
                    'deck_name': str(entry.get('deck_name') or '').strip(),
                })
            return out

        overlaps = []
        for idx, card in enumerate(cards):
            front = str(card.get('front') or '')
            back = str(card.get('back') or '')
            dedupe_value = back if dedupe_key == 'back' else front
            matches = list(existing_by_dedupe.get(dedupe_value) or [])
            if not matches:
                continue

            exact_matches = [entry for entry in matches if entry.get('front') == front and entry.get('back') == back]
            mismatch_matches = [entry for entry in matches if not (entry.get('front') == front and entry.get('back') == back)]
            overlaps.append({
                'index': idx,
                'front': front,
                'back': back,
                'dedupe_key': dedupe_key,
                'dedupe_value': dedupe_value,
                'other_key': other_key,
                'exact_match_decks': unique_decks(exact_matches),
                'mismatch_decks': unique_decks(mismatch_matches),
            })

        return jsonify({
            'category_key': category_key,
            'dedupe_key': dedupe_key,
            'other_key': other_key,
            'overlaps': overlaps,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/tags', methods=['GET'])
def shared_deck_tags():
    """Return shared-deck ordered tag paths for autocomplete."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err

        conn = get_shared_decks_connection()
        try:
            tag_paths = get_all_shared_deck_tag_paths(conn)
        finally:
            conn.close()

        return jsonify({'tag_paths': tag_paths}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
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
                    CAST(COALESCE(COUNT(c.id), 0) AS INTEGER) AS card_count,
                    CASE
                        WHEN COUNT(c.id) = 1 THEN MIN(c.front)
                        ELSE NULL
                    END AS single_card_front
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

        decks = []
        for row in rows:
            tags, tag_labels = extract_shared_deck_tags_and_labels(row[2])
            decks.append({
                'deck_id': int(row[0]),
                'name': str(row[1]),
                'tags': tags,
                'tag_labels': tag_labels,
                'creator_family_id': int(row[3]),
                'created_at': row[4].isoformat() if row[4] else None,
                'card_count': int(row[5] or 0),
                'single_card_front': str(row[6] or '').strip(),
            })

        return jsonify({'decks': decks}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/<int:deck_id>', methods=['GET'])
def get_shared_deck_details(deck_id):
    """Return one owned shared deck and cards for view/edit UI."""
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
            behavior_type = get_shared_deck_behavior_type_from_raw_tags(conn, deck_row[2])
            cards = get_shared_deck_cards(conn, deck_id)
            generator_definition = (
                get_shared_deck_generator_definition(conn, deck_id)
                if behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_IV
                else None
            )
        finally:
            conn.close()

        return jsonify({
            'deck': {
                'deck_id': int(deck_row[0]),
                'name': str(deck_row[1]),
                'tags': extract_shared_deck_tags_and_labels(deck_row[2])[0],
                'tag_labels': extract_shared_deck_tags_and_labels(deck_row[2])[1],
                'creator_family_id': int(deck_row[3]),
                'created_at': deck_row[4].isoformat() if deck_row[4] else None,
                'behavior_type': behavior_type,
            },
            'card_count': len(cards),
            'cards': cards,
            'generator_definition': generator_definition,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/<int:deck_id>/tags', methods=['PUT'])
def update_shared_deck_tags(deck_id):
    """Rename one owned shared deck's tag path while keeping its first tag fixed."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err
        family_id_int = get_current_family_id_int()
        if family_id_int is None:
            if not current_family_id():
                return jsonify({'error': 'Family login required'}), 401
            return jsonify({'error': 'Invalid family id in session'}), 400

        payload = request.get_json(silent=True) or {}
        extra_tags_payload = payload.get('extraTags')

        with _SHARED_DECK_MUTATION_LOCK:
            conn = None
            try:
                conn = get_shared_decks_connection()
                deck_row = get_shared_deck_owned_by_family(conn, deck_id, family_id_int)
                if not deck_row:
                    return jsonify({'error': 'Deck not found'}), 404

                current_name = str(deck_row[1] or '').strip()
                current_tags, _ = extract_shared_deck_tags_and_labels(deck_row[2])
                current_first_tag = normalize_shared_deck_tag(current_tags[0] if current_tags else '')
                if not current_first_tag:
                    return jsonify({'error': 'Deck is missing a valid first tag'}), 400

                allowed_first_tags = get_allowed_shared_deck_first_tags(conn)
                tags, comments_by_tag = build_shared_deck_tags(
                    current_first_tag,
                    extra_tags_payload,
                    allowed_first_tags=allowed_first_tags,
                    include_comments=True,
                )
                if tags[0] != current_first_tag:
                    return jsonify({'error': 'First tag cannot be changed here'}), 400

                if tags != current_tags:
                    prefix_conflict_tags = find_shared_deck_tag_prefix_conflict(conn, tags)
                    if prefix_conflict_tags:
                        raise ValueError(
                            'Tag path conflicts with existing deck path '
                            f'{format_shared_deck_tag_path(prefix_conflict_tags)}. '
                            'Nested tag paths are not allowed.'
                        )

                next_name = '_'.join(tags)
                storage_tags = [
                    format_shared_deck_tag_display_label(tag, comments_by_tag.get(tag))
                    for tag in tags
                ]

                existing_name_row = conn.execute(
                    "SELECT deck_id FROM deck WHERE name = ? AND deck_id <> ? LIMIT 1",
                    [next_name, deck_id],
                ).fetchone()
                if existing_name_row:
                    return jsonify({'error': 'Deck name already exists. Please choose different tags.'}), 409

                shared_updated = False
                if next_name != current_name or storage_tags != [str(item) for item in list(deck_row[2] or [])]:
                    conn.execute("BEGIN TRANSACTION")
                    try:
                        conn.execute(
                            """
                            UPDATE deck
                            SET name = ?, tags = ?
                            WHERE deck_id = ? AND creator_family_id = ?
                            """,
                            [next_name, storage_tags, deck_id, family_id_int],
                        )
                        conn.execute("COMMIT")
                        shared_updated = True
                    except Exception:
                        conn.execute("ROLLBACK")
                        raise
            finally:
                if conn is not None:
                    conn.close()

            sync_result = sync_materialized_shared_deck_metadata_for_all_kids(
                deck_id,
                next_name,
                storage_tags,
            )
            if sync_result['failures']:
                failed_labels = [
                    item['kid_name'] or f"kid {item['kid_id']}"
                    for item in sync_result['failures']
                ]
                return jsonify({
                    'error': (
                        'Shared deck tags were updated, but some kid DBs failed to sync: '
                        + ', '.join(failed_labels)
                        + '. Re-running the same rename will retry the kid sync.'
                    ),
                    'shared_updated': bool(shared_updated),
                    'deck_id': int(deck_id),
                    'deck': {
                        'deck_id': int(deck_id),
                        'name': next_name,
                        'tags': tags,
                        'tag_labels': storage_tags,
                    },
                    'updated_kid_count': int(sync_result['updated_kid_count']),
                    'updated_deck_count': int(sync_result['updated_deck_count']),
                    'kid_sync_failures': sync_result['failures'],
                }), 500

        return jsonify({
            'updated': True,
            'shared_updated': bool(shared_updated),
            'deck': {
                'deck_id': int(deck_id),
                'name': next_name,
                'tags': tags,
                'tag_labels': storage_tags,
            },
            'updated_kid_count': int(sync_result['updated_kid_count']),
            'updated_deck_count': int(sync_result['updated_deck_count']),
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/<int:deck_id>/generator-definition', methods=['PUT'])
def update_shared_deck_generator_definition(deck_id):
    """Update the stored Python generator code for one owned type-IV shared deck."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err
        family_id_int = get_current_family_id_int()
        if family_id_int is None:
            if not current_family_id():
                return jsonify({'error': 'Family login required'}), 401
            return jsonify({'error': 'Invalid family id in session'}), 400

        payload = request.get_json(silent=True) or {}
        generator_code = normalize_type_iv_generator_code(payload.get('generatorCode'))
        preview_type4_generator(generator_code, sample_count=1)

        with _SHARED_DECK_MUTATION_LOCK:
            conn = None
            try:
                conn = get_shared_decks_connection()
                deck_row = get_shared_deck_owned_by_family(conn, deck_id, family_id_int)
                if not deck_row:
                    return jsonify({'error': 'Deck not found'}), 404
                behavior_type = get_shared_deck_behavior_type_from_raw_tags(conn, deck_row[2])
                if behavior_type != DECK_CATEGORY_BEHAVIOR_TYPE_IV:
                    return jsonify({'error': 'Only type_iv decks support generator code updates'}), 400
                existing_definition = get_shared_deck_generator_definition(conn, deck_id)
                if not existing_definition:
                    return jsonify({'error': 'Generator definition not found for this deck'}), 404
                is_multichoice_only = normalize_type_iv_multichoice_only(
                    payload.get('isMultichoiceOnly'),
                    default=bool(existing_definition.get('is_multichoice_only')),
                )

                conn.execute(
                    """
                    UPDATE deck_generator_definition
                    SET code = ?, is_multichoice_only = ?
                    WHERE deck_id = ?
                    """,
                    [generator_code, bool(is_multichoice_only), deck_id],
                )
            finally:
                if conn is not None:
                    conn.close()

        return jsonify({
            'updated': True,
            'deck_id': int(deck_id),
            'generator_definition': {
                'code': generator_code,
                'is_multichoice_only': bool(is_multichoice_only),
            },
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/<int:deck_id>/cards', methods=['POST'])
def add_shared_deck_cards(deck_id):
    """Add cards to one owned shared deck with category-aware dedupe."""
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
            behavior_type = get_shared_deck_behavior_type_from_raw_tags(conn, deck_row[2])
            if behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_IV:
                return jsonify({'error': 'type_iv decks are immutable and do not support card edits'}), 400

            payload = request.get_json(silent=True) or {}
            if isinstance(payload.get('cards'), list):
                cards = normalize_shared_deck_cards(payload.get('cards'))
            else:
                front = str(payload.get('front') or '').strip()
                back = str(payload.get('back') or '').strip()
                if not front or not back:
                    return jsonify({'error': 'Provide cards[] or one front/back pair.'}), 400
                cards = [{'front': front, 'back': back}]

            dedupe_key = get_shared_deck_dedupe_key(conn, deck_row[2])
            cards = (
                dedupe_shared_deck_cards_by_back(cards)
                if dedupe_key == 'back'
                else dedupe_shared_deck_cards_by_front(cards)
            )

            existing_rows = conn.execute(
                "SELECT front, back FROM cards WHERE deck_id = ?",
                [deck_id]
            ).fetchall()
            existing_fronts = {str(row[0] or '') for row in existing_rows if str(row[0] or '')}
            existing_backs = {str(row[1] or '') for row in existing_rows if str(row[1] or '')}

            insert_rows = []
            skipped_existing_front = 0
            skipped_existing_back = 0
            for card in cards:
                front = str(card.get('front') or '')
                back = str(card.get('back') or '')
                if front in existing_fronts:
                    skipped_existing_front += 1
                    continue
                if dedupe_key == 'back' and back in existing_backs:
                    skipped_existing_back += 1
                    continue
                existing_fronts.add(front)
                existing_backs.add(back)
                insert_rows.append([deck_id, front, back])

            if insert_rows:
                conn.executemany(
                    """
                    INSERT INTO cards (deck_id, front, back)
                    VALUES (?, ?, ?)
                    """,
                    insert_rows
                )

            card_count = int(conn.execute(
                "SELECT COUNT(*) FROM cards WHERE deck_id = ?",
                [deck_id]
            ).fetchone()[0] or 0)
        finally:
            if conn is not None:
                conn.close()

        return jsonify({
            'deck_id': int(deck_id),
            'dedupe_key': dedupe_key,
            'input_count': len(cards),
            'inserted_count': len(insert_rows),
            'skipped_existing_front': skipped_existing_front,
            'skipped_existing_back': skipped_existing_back,
            'skipped_existing_count': int(skipped_existing_front + skipped_existing_back),
            'card_count': card_count,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        err = str(e).lower()
        if 'unique' in err and 'front' in err:
            return jsonify({'error': 'One or more cards already exist by front text in this deck.'}), 409
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/<int:deck_id>/cards/<int:card_id>', methods=['DELETE'])
def delete_shared_deck_card(deck_id, card_id):
    """Delete one card from one owned shared deck."""
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
            behavior_type = get_shared_deck_behavior_type_from_raw_tags(conn, deck_row[2])
            if behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_IV:
                return jsonify({'error': 'type_iv decks are immutable and do not support card edits'}), 400

            card_row = conn.execute(
                "SELECT id FROM cards WHERE id = ? AND deck_id = ? LIMIT 1",
                [card_id, deck_id]
            ).fetchone()
            if not card_row:
                return jsonify({'error': 'Card not found'}), 404

            conn.execute(
                "DELETE FROM cards WHERE id = ? AND deck_id = ?",
                [card_id, deck_id]
            )
            card_count = int(conn.execute(
                "SELECT COUNT(*) FROM cards WHERE deck_id = ?",
                [deck_id]
            ).fetchone()[0] or 0)
        finally:
            if conn is not None:
                conn.close()

        return jsonify({
            'deleted': True,
            'deck_id': int(deck_id),
            'card_id': int(card_id),
            'card_count': card_count,
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

        with _SHARED_DECK_MUTATION_LOCK:
            conn = None
            try:
                conn = get_shared_decks_connection()
                deck_row = get_shared_deck_owned_by_family(conn, deck_id, family_id_int)
                if not deck_row:
                    return jsonify({'error': 'Deck not found'}), 404
                # Keep delete simple in autocommit mode: remove dependent shared rows,
                # then delete the deck shell.
                conn.execute("DELETE FROM deck_generator_definition WHERE deck_id = ?", [deck_id])
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

        try:
            family_id_int = int(family_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid family id in session'}), 400

        with _SHARED_DECK_MUTATION_LOCK:
            conn = None
            try:
                conn = get_shared_decks_connection()
                allowed_first_tags = get_allowed_shared_deck_first_tags(conn)
                tags, comments_by_tag = build_shared_deck_tags(
                    payload.get('firstTag'),
                    payload.get('extraTags'),
                    allowed_first_tags=allowed_first_tags,
                    include_comments=True,
                )
                prefix_conflict_tags = find_shared_deck_tag_prefix_conflict(conn, tags)
                if prefix_conflict_tags:
                    raise ValueError(
                        'Tag path conflicts with existing deck path '
                        f'{format_shared_deck_tag_path(prefix_conflict_tags)}. '
                        'Nested tag paths are not allowed.'
                    )
                behavior_type = get_shared_deck_behavior_type_from_raw_tags(conn, tags)
                is_type_iv = behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_IV
                if is_type_iv:
                    display_label = normalize_type_iv_display_label(payload.get('displayLabel'))
                    generator_code = normalize_type_iv_generator_code(payload.get('generatorCode'))
                    is_multichoice_only = normalize_type_iv_multichoice_only(
                        payload.get('isMultichoiceOnly'),
                        default=False,
                    )
                    label_conflict = find_shared_type_iv_representative_label_conflict(
                        conn,
                        tags[0],
                        display_label,
                    )
                    if label_conflict:
                        return jsonify({
                            'error': (
                                'Representative label already exists in this category: '
                                f"{label_conflict['deck_name']}"
                            ),
                            'existing_deck_id': int(label_conflict['deck_id']),
                            'existing_deck_name': str(label_conflict['deck_name']),
                        }), 409
                    preview_type4_generator(generator_code, sample_count=1)
                    cards = [{'front': display_label, 'back': ''}]
                else:
                    dedupe_by_back = behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_II
                    cards = normalize_shared_deck_cards(payload.get('cards'))
                    cards = (
                        dedupe_shared_deck_cards_by_back(cards)
                        if dedupe_by_back
                        else dedupe_shared_deck_cards_by_front(cards)
                    )
                deck_name = '_'.join(tags)
                storage_tags = [
                    format_shared_deck_tag_display_label(tag, comments_by_tag.get(tag))
                    for tag in tags
                ]

                conn.execute("BEGIN TRANSACTION")
                deck_row = conn.execute(
                    """
                    INSERT INTO deck (name, tags, creator_family_id)
                    VALUES (?, ?, ?)
                    RETURNING deck_id, created_at
                    """,
                    [deck_name, storage_tags, family_id_int]
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
                if is_type_iv:
                    conn.execute(
                        """
                        INSERT INTO deck_generator_definition (deck_id, code, is_multichoice_only)
                        VALUES (?, ?, ?)
                        """,
                        [deck_id, generator_code, bool(is_multichoice_only)],
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
                'behavior_type': behavior_type,
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
            return jsonify({'error': 'Shared deck DB schema mismatch on card uniqueness. Expected UNIQUE(deck_id, front).'}), 409
        return jsonify({'error': str(e)}), 500


def _normalize_hard_card_percentage_value(value):
    """Normalize one hardness-percentage value to [0, 100]."""
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return DEFAULT_HARD_CARD_PERCENTAGE
    if parsed < MIN_HARD_CARD_PERCENTAGE:
        return MIN_HARD_CARD_PERCENTAGE
    if parsed > MAX_HARD_CARD_PERCENTAGE:
        return MAX_HARD_CARD_PERCENTAGE
    return parsed


def normalize_hard_card_percentage(kid, session_type=None):
    """Get validated hard-card percentage for one category key."""
    session_key = normalize_shared_deck_tag(session_type)
    if not session_key:
        return DEFAULT_HARD_CARD_PERCENTAGE
    return get_category_hard_card_percentage_for_kid(kid, session_key)


def parse_optional_hard_card_percentage_arg(arg_name='hard_card_percentage'):
    """Parse optional hard-card percentage from query args."""
    raw_value = request.args.get(arg_name)
    if raw_value is None:
        return None
    text = str(raw_value).strip()
    if not text:
        return None
    try:
        parsed = int(text)
    except (TypeError, ValueError):
        raise ValueError(f'{arg_name} must be an integer')
    if parsed < MIN_HARD_CARD_PERCENTAGE or parsed > MAX_HARD_CARD_PERCENTAGE:
        raise ValueError(
            f'{arg_name} must be between {MIN_HARD_CARD_PERCENTAGE} and {MAX_HARD_CARD_PERCENTAGE}'
        )
    return parsed


def get_kid_dashboard_stats(
    kid,
    *,
    category_meta_by_key=None,
    type_iii_category_keys=None,
    include_has_ungraded=True,
    conn=None,
    family_timezone=None,
):
    """Get today's dashboard counts + latest session progress by category in one connection."""
    default_counts = defaultdict(int)
    default_star_tiers = defaultdict(list)
    default_latest_percent = defaultdict(float)
    default_latest_target_count = defaultdict(int)
    default_latest_tried_count = defaultdict(int)
    default_latest_right_count = defaultdict(int)
    local_conn = conn
    owns_conn = False
    if local_conn is None:
        try:
            local_conn = get_kid_connection_for(kid)
            owns_conn = True
        except Exception:
            return (
                default_counts,
                default_star_tiers,
                default_latest_percent,
                default_latest_target_count,
                default_latest_tried_count,
                default_latest_right_count,
                False,
            )

    try:
        family_id = str(kid.get('familyId') or '')
        effective_family_timezone = (
            str(family_timezone).strip()
            if str(family_timezone or '').strip()
            else metadata.get_family_timezone(family_id)
        )
        is_super = is_super_family_id(family_id)
        tzinfo = ZoneInfo(effective_family_timezone)
        day_start_local = datetime.now(tzinfo).replace(hour=0, minute=0, second=0, microsecond=0)
        day_end_local = day_start_local + timedelta(days=1)
        day_start_utc = day_start_local.astimezone(timezone.utc).replace(tzinfo=None)
        day_end_utc = day_end_local.astimezone(timezone.utc).replace(tzinfo=None)
        effective_category_meta_by_key = (
            category_meta_by_key
            if isinstance(category_meta_by_key, dict)
            else {
                key: meta
                for key, meta in get_shared_deck_category_meta_by_key().items()
                if can_family_access_deck_category(meta, family_id=family_id, is_super=is_super)
            }
        )

        rows = local_conn.execute(
            """
            SELECT
                s.type,
                COALESCE(s.planned_count, 0) AS planned_count,
                COUNT(sr.id) AS answer_count,
                COALESCE(SUM(CASE WHEN sr.correct > 0 THEN 1 ELSE 0 END), 0) AS right_count,
                COALESCE(SUM(CASE WHEN sr.correct < 0 THEN 1 ELSE 0 END), 0) AS wrong_count,
                COALESCE(s.retry_best_rety_correct_count, 0) AS retry_best_rety_correct_count
            FROM sessions s
            LEFT JOIN session_results sr ON sr.session_id = s.id
            WHERE s.completed_at IS NOT NULL
              AND s.completed_at >= ?
              AND s.completed_at < ?
            GROUP BY
                s.id,
                s.type,
                s.planned_count,
                s.retry_best_rety_correct_count,
                s.completed_at
            ORDER BY s.completed_at ASC, s.id ASC
            """,
            [day_start_utc, day_end_utc]
        ).fetchall()

        today_counts = defaultdict(int)
        today_star_tiers = defaultdict(list)
        today_latest_percent = defaultdict(float)
        today_latest_target_count = defaultdict(int)
        today_latest_tried_count = defaultdict(int)
        today_latest_right_count = defaultdict(int)
        for row in rows:
            session_type = normalize_shared_deck_tag(row[0])
            if not session_type or session_type not in effective_category_meta_by_key:
                continue
            session_behavior_type = get_session_behavior_type(
                session_type,
                category_meta_by_key=effective_category_meta_by_key,
            )
            planned_count = max(0, int(row[1] or 0))
            answer_count = int(row[2] or 0)
            right_count = int(row[3] or 0)
            wrong_count = int(row[4] or 0)
            retry_best_rety = max(0, int(row[5] or 0))
            target_answer_count = max(planned_count, answer_count, right_count + wrong_count)
            if target_answer_count <= 0 and planned_count <= 0:
                continue
            is_incomplete = planned_count > 0 and answer_count < planned_count
            if is_incomplete:
                base_tier = 'half_silver'
            else:
                base_tier = 'gold'
            effective_best_total = right_count + retry_best_rety

            if is_incomplete:
                effective_percent = float(answer_count) * 100.0 / float(max(1, target_answer_count))
            elif session_behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_III and (right_count + wrong_count) <= 0:
                effective_percent = float(answer_count) * 100.0 / float(max(1, target_answer_count))
            else:
                effective_percent = float(effective_best_total) * 100.0 / float(max(1, target_answer_count))
            today_star_tiers[session_type].append(base_tier)
            today_counts[session_type] += 1
            today_counts['total'] += 1
            today_latest_percent[session_type] = max(0.0, min(100.0, effective_percent))
            today_latest_target_count[session_type] = int(target_answer_count)
            today_latest_tried_count[session_type] = max(0, int(answer_count))
            today_latest_right_count[session_type] = max(
                0,
                min(
                    int(target_answer_count),
                    int(effective_best_total),
                ),
            )

        has_ungraded = False
        if include_has_ungraded:
            effective_type_iii_category_keys = [
                normalize_shared_deck_tag(item)
                for item in list(
                    type_iii_category_keys
                    if isinstance(type_iii_category_keys, (list, tuple, set))
                    else get_type_iii_category_keys(effective_category_meta_by_key)
                )
            ]
            effective_type_iii_category_keys = [
                key for key in effective_type_iii_category_keys
                if key
            ]
            if effective_type_iii_category_keys:
                placeholders = ', '.join(['?'] * len(effective_type_iii_category_keys))
                ungraded_row = local_conn.execute(
                    f"""
                    SELECT 1
                    FROM sessions s
                    JOIN session_results sr ON sr.session_id = s.id
                    WHERE s.type IN ({placeholders})
                      AND s.completed_at IS NOT NULL
                      AND sr.correct = 0
                    LIMIT 1
                    """,
                    effective_type_iii_category_keys,
                ).fetchone()
                has_ungraded = bool(ungraded_row)

        return (
            today_counts,
            today_star_tiers,
            today_latest_percent,
            today_latest_target_count,
            today_latest_tried_count,
            today_latest_right_count,
            has_ungraded,
        )
    except Exception:
        return (
            default_counts,
            default_star_tiers,
            default_latest_percent,
            default_latest_target_count,
            default_latest_tried_count,
            default_latest_right_count,
            False,
        )
    finally:
        if owns_conn and local_conn is not None:
            local_conn.close()


def get_kid_opted_in_deck_category_keys(kid, *, category_meta_by_key=None, conn=None):
    """Return normalized deck-category keys opted in for one kid."""
    try:
        family_id = str(kid.get('familyId') or '').strip()
        is_super = is_super_family_id(family_id)
        effective_category_meta_by_key = (
            category_meta_by_key
            if isinstance(category_meta_by_key, dict)
            else {
                key: meta
                for key, meta in get_shared_deck_category_meta_by_key().items()
                if can_family_access_deck_category(meta, family_id=family_id, is_super=is_super)
            }
        )
        hydrate_kid_category_config_from_db(
            kid,
            category_meta_by_key=effective_category_meta_by_key,
            conn=conn,
        )
        raw_keys = kid.get('optedInDeckCategoryKeys')
        if not isinstance(raw_keys, list):
            return []
        keys = []
        seen = set()
        for raw_key in raw_keys:
            key = normalize_shared_deck_tag(raw_key)
            if not key or key in seen:
                continue
            category_meta = effective_category_meta_by_key.get(key)
            if not can_family_access_deck_category(
                category_meta,
                family_id=family_id,
                is_super=is_super,
            ):
                continue
            seen.add(key)
            keys.append(key)
        return keys
    except Exception:
        return []


def get_kid_has_ungraded_type_iii(kid, *, type_iii_category_keys=None, conn=None):
    """Return whether kid has any completed type-III session rows needing grading."""
    keys = [
        normalize_shared_deck_tag(item)
        for item in list(type_iii_category_keys or [])
    ]
    keys = [key for key in keys if key]
    if not keys:
        return False
    local_conn = conn
    owns_conn = False
    if local_conn is None:
        try:
            local_conn = get_kid_connection_for(kid)
            owns_conn = True
        except Exception:
            return False
    try:
        placeholders = ', '.join(['?'] * len(keys))
        row = local_conn.execute(
            f"""
            SELECT 1
            FROM sessions s
            JOIN session_results sr ON sr.session_id = s.id
            WHERE s.type IN ({placeholders})
              AND s.completed_at IS NOT NULL
              AND sr.correct = 0
            LIMIT 1
            """,
            keys,
        ).fetchone()
        return bool(row)
    except Exception:
        return False
    finally:
        if owns_conn and local_conn is not None:
            local_conn.close()


def get_shared_deck_category_meta_by_key():
    """Return deck_category metadata map keyed by normalized category key."""
    conn = get_shared_decks_connection()
    try:
        categories = get_shared_deck_categories(conn)
    finally:
        conn.close()
    metadata_by_key = {}
    for item in categories:
        key = normalize_shared_deck_tag(item.get('category_key'))
        if not key:
            continue
        metadata_by_key[key] = {
            'behavior_type': str(item.get('behavior_type') or '').strip().lower(),
            'has_chinese_specific_logic': bool(item.get('has_chinese_specific_logic')),
            'is_shared_with_non_super_family': bool(item.get('is_shared_with_non_super_family')),
            'display_name': str(item.get('display_name') or '').strip(),
            'emoji': str(item.get('emoji') or '').strip(),
        }
    return metadata_by_key


def get_type_iii_category_keys(category_meta_by_key=None):
    """Return normalized deck-category keys that use type-III behavior."""
    metadata = (
        category_meta_by_key
        if isinstance(category_meta_by_key, dict)
        else get_shared_deck_category_meta_by_key()
    )
    keys = []
    for raw_key, item in metadata.items():
        behavior_type = str((item or {}).get('behavior_type') or '').strip().lower()
        if behavior_type != DECK_CATEGORY_BEHAVIOR_TYPE_III:
            continue
        key = normalize_shared_deck_tag(raw_key)
        if key:
            keys.append(key)
    return sorted(set(keys))


def get_deck_category_display_name(category_key, category_meta_by_key=None):
    """Return one category display name from metadata."""
    key = normalize_shared_deck_tag(category_key)
    if not key:
        return ''
    metadata = (
        category_meta_by_key
        if isinstance(category_meta_by_key, dict)
        else get_shared_deck_category_meta_by_key()
    )
    return str((metadata.get(key) or {}).get('display_name') or '').strip()


def resolve_kid_deck_category_key_for_behavior(
    kid,
    raw_category_key,
    *,
    expected_behavior_type,
    expected_has_chinese_specific_logic,
):
    """Resolve and validate one requested category key for a behavior family."""
    key = normalize_shared_deck_tag(raw_category_key)
    if not key:
        raise ValueError('categoryKey is required')

    category_meta_by_key = get_shared_deck_category_meta_by_key()
    category_meta = category_meta_by_key.get(key)
    if not isinstance(category_meta, dict):
        raise ValueError(f'Unknown categoryKey: {key}')

    behavior_type = str(category_meta.get('behavior_type') or '').strip().lower()
    has_chinese_specific_logic = bool(category_meta.get('has_chinese_specific_logic'))
    if behavior_type != str(expected_behavior_type or '').strip().lower():
        raise ValueError(f'categoryKey "{key}" has unsupported behavior type')
    if has_chinese_specific_logic != bool(expected_has_chinese_specific_logic):
        raise ValueError(f'categoryKey "{key}" has unsupported Chinese logic mode')
    family_id = str(kid.get('familyId') or '').strip()
    if not can_family_access_deck_category(category_meta, family_id=family_id):
        raise ValueError(f'categoryKey "{key}" is not shared with this family')

    opted_in_keys = set(get_kid_opted_in_deck_category_keys(kid))
    if key not in opted_in_keys:
        raise ValueError(f'Kid is not opted-in to categoryKey: {key}')
    return key


def resolve_kid_type_i_chinese_category_key(kid, raw_category_key, *, allow_default=True):
    """Resolve category key for type-I Chinese-specific deck management."""
    return resolve_kid_type_i_category_key(
        kid,
        raw_category_key,
        has_chinese_specific_logic=True,
        allow_default=allow_default,
    )


def resolve_kid_type_i_category_key(
    kid,
    raw_category_key,
    *,
    has_chinese_specific_logic,
    allow_default,
):
    """Resolve category key for one type-I mode, optionally defaulting when unique."""
    key = normalize_shared_deck_tag(raw_category_key)
    if key:
        return resolve_kid_deck_category_key_for_behavior(
            kid,
            key,
            expected_behavior_type=DECK_CATEGORY_BEHAVIOR_TYPE_I,
            expected_has_chinese_specific_logic=has_chinese_specific_logic,
        )

    if not allow_default:
        raise ValueError('categoryKey is required')

    category_meta_by_key = get_shared_deck_category_meta_by_key()
    opted_in_keys = set(get_kid_opted_in_deck_category_keys(kid))
    matching_keys = []
    for candidate_key in sorted(opted_in_keys):
        category_meta = category_meta_by_key.get(candidate_key)
        if not isinstance(category_meta, dict):
            continue
        behavior_type = str(category_meta.get('behavior_type') or '').strip().lower()
        has_chinese_logic = bool(category_meta.get('has_chinese_specific_logic'))
        if (
            behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_I
            and has_chinese_logic == bool(has_chinese_specific_logic)
        ):
            matching_keys.append(candidate_key)

    if len(matching_keys) == 1:
        return matching_keys[0]
    if len(matching_keys) == 0:
        raise ValueError('Kid is not opted-in to a matching type-I category')
    raise ValueError('categoryKey is required when multiple matching type-I categories are opted-in')


def resolve_kid_category_with_mode(
    kid,
    raw_category_key,
    expected_behavior_types,
    *,
    allow_default=True,
    unknown_error='Unknown deck category',
    wrong_type_error='categoryKey has unsupported behavior type',
    no_match_error='Kid is not opted-in to a matching category',
    multiple_match_error='categoryKey is required when multiple matching categories are opted-in',
):
    """Resolve category key for one or more behavior types and return chinese-specific mode."""
    if isinstance(expected_behavior_types, str):
        behavior_type_set = {
            str(expected_behavior_types).strip().lower()
        }
    else:
        behavior_type_set = {
            str(item).strip().lower()
            for item in list(expected_behavior_types or [])
            if str(item).strip()
        }
    if not behavior_type_set:
        raise ValueError('expected_behavior_types is required')

    key = normalize_shared_deck_tag(raw_category_key)
    category_meta_by_key = get_shared_deck_category_meta_by_key()

    if key:
        category_meta = category_meta_by_key.get(key)
        if not isinstance(category_meta, dict):
            raise ValueError(str(unknown_error))
        behavior_type = str(category_meta.get('behavior_type') or '').strip().lower()
        if behavior_type not in behavior_type_set:
            raise ValueError(str(wrong_type_error))
        has_chinese_specific_logic = bool(category_meta.get('has_chinese_specific_logic'))
        resolved_category_key = resolve_kid_deck_category_key_for_behavior(
            kid,
            key,
            expected_behavior_type=behavior_type,
            expected_has_chinese_specific_logic=has_chinese_specific_logic,
        )
        return resolved_category_key, has_chinese_specific_logic

    if not allow_default:
        raise ValueError('categoryKey is required')

    opted_in_keys = set(get_kid_opted_in_deck_category_keys(kid))
    matching_keys = []
    for candidate_key in sorted(opted_in_keys):
        category_meta = category_meta_by_key.get(candidate_key)
        if not isinstance(category_meta, dict):
            continue
        behavior_type = str(category_meta.get('behavior_type') or '').strip().lower()
        if behavior_type not in behavior_type_set:
            continue
        matching_keys.append(candidate_key)

    if len(matching_keys) == 1:
        only_key = matching_keys[0]
        category_meta = category_meta_by_key.get(only_key) or {}
        return only_key, bool(category_meta.get('has_chinese_specific_logic'))
    if len(matching_keys) == 0:
        raise ValueError(str(no_match_error))
    raise ValueError(str(multiple_match_error))


def resolve_kid_type_i_category_with_mode(kid, raw_category_key):
    """Resolve explicit type-I/type-III category key and return its chinese-specific mode flag."""
    return resolve_kid_category_with_mode(
        kid,
        raw_category_key,
        {DECK_CATEGORY_BEHAVIOR_TYPE_I, DECK_CATEGORY_BEHAVIOR_TYPE_III},
        allow_default=False,
        wrong_type_error='categoryKey must be a type-I or type-III deck category',
    )


def resolve_kid_type_iii_category_with_mode(kid, raw_category_key, *, allow_default=True):
    """Resolve explicit type-III category key and return its chinese-specific mode flag."""
    return resolve_kid_category_with_mode(
        kid,
        raw_category_key,
        DECK_CATEGORY_BEHAVIOR_TYPE_III,
        allow_default=allow_default,
        wrong_type_error='categoryKey must be a type-III deck category',
        no_match_error='Kid is not opted-in to a type-III category',
        multiple_match_error='categoryKey is required when multiple type-III categories are opted-in',
    )


def resolve_kid_type_ii_category_with_mode(kid, raw_category_key, *, allow_default=True):
    """Resolve explicit type-II category key and return its chinese-specific mode flag."""
    return resolve_kid_category_with_mode(
        kid,
        raw_category_key,
        DECK_CATEGORY_BEHAVIOR_TYPE_II,
        allow_default=allow_default,
        wrong_type_error='categoryKey must be a type-II deck category',
        no_match_error='Kid is not opted-in to a type-II category',
        multiple_match_error='categoryKey is required when multiple type-II categories are opted-in',
    )


def resolve_kid_type_iv_category_with_mode(kid, raw_category_key, *, allow_default=False):
    """Resolve explicit type-IV category key and return its mode flag."""
    return resolve_kid_category_with_mode(
        kid,
        raw_category_key,
        DECK_CATEGORY_BEHAVIOR_TYPE_IV,
        allow_default=allow_default,
        wrong_type_error='categoryKey must be a type-IV deck category',
        no_match_error='Kid is not opted-in to a type-IV category',
        multiple_match_error='categoryKey is required when multiple type-IV categories are opted-in',
    )


def get_kid_daily_completed_by_deck_category(kid, opted_in_category_keys, today_counts=None):
    """Build per-category daily completed session counts using practiced card tags."""
    counts = {}
    keys = [normalize_shared_deck_tag(key) for key in list(opted_in_category_keys or [])]
    keys = [key for key in keys if key]
    keys = list(dict.fromkeys(keys))
    if not keys:
        return counts
    if isinstance(today_counts, dict):
        for key in keys:
            counts[key] = int(today_counts.get(key, 0) or 0)
        return counts

    counts = {key: 0 for key in keys}
    conn = None
    try:
        conn = get_kid_connection_for(kid)
        family_id = str(kid.get('familyId') or '')
        family_timezone = metadata.get_family_timezone(family_id)
        tzinfo = ZoneInfo(family_timezone)
        day_start_local = datetime.now(tzinfo).replace(hour=0, minute=0, second=0, microsecond=0)
        day_end_local = day_start_local + timedelta(days=1)
        day_start_utc = day_start_local.astimezone(timezone.utc).replace(tzinfo=None)
        day_end_utc = day_end_local.astimezone(timezone.utc).replace(tzinfo=None)

        placeholders = ', '.join(['?'] * len(keys))
        rows = conn.execute(
            f"""
            SELECT s.type, COUNT(*)
            FROM sessions s
            WHERE s.completed_at IS NOT NULL
              AND s.completed_at >= ?
              AND s.completed_at < ?
              AND s.type IN ({placeholders})
            GROUP BY s.type
            """,
            [day_start_utc, day_end_utc, *keys],
        ).fetchall()
        for row in rows:
            key = normalize_shared_deck_tag(row[0])
            if key in counts:
                counts[key] = int(row[1] or 0)
    except Exception:
        counts = {key: 0 for key in keys}
    finally:
        if conn is not None:
            conn.close()
    return counts


def get_kid_daily_star_tiers_by_deck_category(opted_in_category_keys, today_star_tiers=None):
    """Build per-category daily star tiers list (gold/silver) for one kid."""
    result = {}
    keys = [normalize_shared_deck_tag(key) for key in list(opted_in_category_keys or [])]
    keys = [key for key in keys if key]
    keys = list(dict.fromkeys(keys))
    for key in keys:
        raw_tiers = []
        if isinstance(today_star_tiers, dict):
            raw_tiers = list(today_star_tiers.get(key) or [])
        tiers = []
        for raw in raw_tiers:
            tier = str(raw or '').strip().lower()
            if tier in ('gold', 'silver', 'half_silver'):
                tiers.append(tier)
        result[key] = tiers
    return result


def get_kid_daily_percent_by_deck_category(opted_in_category_keys, today_latest_percent=None):
    """Build per-category latest daily completion percent for one kid."""
    result = {}
    keys = [normalize_shared_deck_tag(key) for key in list(opted_in_category_keys or [])]
    keys = [key for key in keys if key]
    keys = list(dict.fromkeys(keys))
    for key in keys:
        raw_percent = 0.0
        if isinstance(today_latest_percent, dict):
            raw_percent = today_latest_percent.get(key, 0.0)
        try:
            parsed = float(raw_percent)
        except (TypeError, ValueError):
            parsed = 0.0
        result[key] = max(0.0, min(100.0, parsed))
    return result


def get_kid_practice_target_by_deck_category(
    kid,
    opted_in_category_keys,
    category_meta_by_key,
    *,
    conn=None,
):
    """Build per-category daily target counts for one kid."""
    targets = {}
    keys = [normalize_shared_deck_tag(key) for key in list(opted_in_category_keys or [])]
    owned_conn = None
    for key in keys:
        if not key:
            continue
        category_meta = category_meta_by_key.get(key) if isinstance(category_meta_by_key, dict) else None
        behavior_type = str((category_meta or {}).get('behavior_type') or '').strip().lower()
        if behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_IV:
            target_conn = conn
            if target_conn is None:
                if owned_conn is None:
                    owned_conn = get_kid_connection_for(kid)
                target_conn = owned_conn
            targets[key] = int(get_type_iv_total_daily_target_for_category(target_conn, kid, key))
            continue
        if behavior_type in DECK_CATEGORY_BEHAVIOR_TYPES:
            targets[key] = int(get_category_session_card_count_for_kid(kid, key))
            continue
        targets[key] = 0
    if owned_conn is not None:
        owned_conn.close()
    return targets


@kids_bp.route('/kids', methods=['GET'])
def get_kids():
    """Get all kids"""
    try:
        family_id = current_family_id()
        if not family_id:
            return jsonify({'error': 'Family login required'}), 401
        view = str(request.args.get('view') or '').strip().lower()
        is_admin_view = (view == 'admin')
        kids = metadata.get_all_kids(family_id=family_id)
        family_timezone = metadata.get_family_timezone(family_id)
        is_super = is_super_family_id(family_id)
        all_category_meta_by_key = get_shared_deck_category_meta_by_key()
        category_meta_by_key = {
            key: meta
            for key, meta in all_category_meta_by_key.items()
            if can_family_access_deck_category(meta, family_id=family_id, is_super=is_super)
        }
        type_iii_category_keys = get_type_iii_category_keys(category_meta_by_key)

        kids_with_progress = []
        for kid in kids:
            conn = None
            try:
                conn = get_kid_connection_for(kid)
            except Exception:
                conn = None
            try:
                opted_in_category_keys = get_kid_opted_in_deck_category_keys(
                    kid,
                    category_meta_by_key=category_meta_by_key,
                    conn=conn,
                )
                practice_target_by_deck_category = get_kid_practice_target_by_deck_category(
                    kid,
                    opted_in_category_keys,
                    category_meta_by_key,
                    conn=conn,
                )
                if is_admin_view:
                    today_counts = defaultdict(int)
                    today_star_tiers = defaultdict(list)
                    today_latest_percent = defaultdict(float)
                    today_latest_target_count = defaultdict(int)
                    today_latest_tried_count = defaultdict(int)
                    today_latest_right_count = defaultdict(int)
                    has_ungraded = get_kid_has_ungraded_type_iii(
                        kid,
                        type_iii_category_keys=type_iii_category_keys,
                        conn=conn,
                    )
                    daily_completed_by_deck_category = {}
                    daily_star_tiers_by_deck_category = {}
                    daily_percent_by_deck_category = {}
                else:
                    (
                        today_counts,
                        today_star_tiers,
                        today_latest_percent,
                        today_latest_target_count,
                        today_latest_tried_count,
                        today_latest_right_count,
                        has_ungraded,
                    ) = get_kid_dashboard_stats(
                        kid,
                        category_meta_by_key=category_meta_by_key,
                        type_iii_category_keys=type_iii_category_keys,
                        conn=conn,
                        family_timezone=family_timezone,
                    )
                    daily_completed_by_deck_category = get_kid_daily_completed_by_deck_category(
                        kid,
                        opted_in_category_keys,
                        today_counts=today_counts,
                    )
                    daily_star_tiers_by_deck_category = get_kid_daily_star_tiers_by_deck_category(
                        opted_in_category_keys,
                        today_star_tiers=today_star_tiers,
                    )
                    daily_percent_by_deck_category = get_kid_daily_percent_by_deck_category(
                        opted_in_category_keys,
                        today_latest_percent=today_latest_percent,
                    )
                daily_target_by_deck_category = {
                    key: int(today_latest_target_count.get(key, 0) or 0)
                    for key in opted_in_category_keys
                }
                daily_tried_by_deck_category = {
                    key: int(today_latest_tried_count.get(key, 0) or 0)
                    for key in opted_in_category_keys
                }
                daily_right_by_deck_category = {
                    key: int(today_latest_right_count.get(key, 0) or 0)
                    for key in opted_in_category_keys
                }
                kid_with_progress = {
                    **kid,
                    'dailyCompletedCountToday': int(today_counts.get('total', 0) or 0),
                    'hasTypeIIIToReview': has_ungraded,
                    'optedInDeckCategoryKeys': opted_in_category_keys,
                    'dailyCompletedByDeckCategory': daily_completed_by_deck_category,
                    'dailyStarTiersByDeckCategory': daily_star_tiers_by_deck_category,
                    'dailyPercentByDeckCategory': daily_percent_by_deck_category,
                    'dailyTargetByDeckCategory': daily_target_by_deck_category,
                    'dailyTriedByDeckCategory': daily_tried_by_deck_category,
                    'dailyRightByDeckCategory': daily_right_by_deck_category,
                    'practiceTargetByDeckCategory': practice_target_by_deck_category,
                    'deckCategoryMetaByKey': category_meta_by_key,
                }
                kids_with_progress.append(kid_with_progress)
            finally:
                if conn is not None:
                    conn.close()

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

        family_id = current_family_id()
        if not family_id:
            return jsonify({'error': 'Family login required'}), 401

        # Save to metadata (ID assigned atomically inside the lock)
        kid = metadata.add_kid({
            'familyId': family_id,
            'name': data['name'],
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
        view = str(request.args.get('view') or '').strip().lower()
        include_dashboard_metrics = view != 'practice_session'
        include_has_ungraded = view not in {'practice_home', 'practice_session'}

        family_id = str(kid.get('familyId') or '').strip()
        family_timezone = metadata.get_family_timezone(family_id)
        is_super = is_super_family_id(family_id)
        all_category_meta_by_key = get_shared_deck_category_meta_by_key()
        category_meta_by_key = {
            key: meta
            for key, meta in all_category_meta_by_key.items()
            if can_family_access_deck_category(meta, family_id=family_id, is_super=is_super)
        }
        conn = None
        try:
            conn = get_kid_connection_for(kid)
        except Exception:
            conn = None
        try:
            if include_dashboard_metrics:
                (
                    today_counts,
                    today_star_tiers,
                    today_latest_percent,
                    today_latest_target_count,
                    today_latest_tried_count,
                    today_latest_right_count,
                    has_ungraded,
                ) = get_kid_dashboard_stats(
                    kid,
                    category_meta_by_key=category_meta_by_key,
                    type_iii_category_keys=get_type_iii_category_keys(category_meta_by_key),
                    include_has_ungraded=include_has_ungraded,
                    conn=conn,
                    family_timezone=family_timezone,
                )
            else:
                today_counts = defaultdict(int)
                today_star_tiers = defaultdict(list)
                today_latest_percent = defaultdict(float)
                today_latest_target_count = defaultdict(int)
                today_latest_tried_count = defaultdict(int)
                today_latest_right_count = defaultdict(int)
                has_ungraded = False
            opted_in_category_keys = get_kid_opted_in_deck_category_keys(
                kid,
                category_meta_by_key=category_meta_by_key,
                conn=conn,
            )
            practice_target_by_deck_category = get_kid_practice_target_by_deck_category(
                kid,
                opted_in_category_keys,
                category_meta_by_key,
                conn=conn,
            )
        finally:
            if conn is not None:
                conn.close()
        if include_dashboard_metrics:
            daily_completed_by_deck_category = get_kid_daily_completed_by_deck_category(
                kid,
                opted_in_category_keys,
                today_counts=today_counts,
            )
            daily_star_tiers_by_deck_category = get_kid_daily_star_tiers_by_deck_category(
                opted_in_category_keys,
                today_star_tiers=today_star_tiers,
            )
            daily_percent_by_deck_category = get_kid_daily_percent_by_deck_category(
                opted_in_category_keys,
                today_latest_percent=today_latest_percent,
            )
        else:
            daily_completed_by_deck_category = {}
            daily_star_tiers_by_deck_category = {}
            daily_percent_by_deck_category = {}
        daily_target_by_deck_category = {
            key: int(today_latest_target_count.get(key, 0) or 0)
            for key in opted_in_category_keys
        }
        daily_tried_by_deck_category = {
            key: int(today_latest_tried_count.get(key, 0) or 0)
            for key in opted_in_category_keys
        }
        daily_right_by_deck_category = {
            key: int(today_latest_right_count.get(key, 0) or 0)
            for key in opted_in_category_keys
        }
        kid_with_progress = {
            **kid,
            'dailyCompletedCountToday': int(today_counts.get('total', 0) or 0),
            'hasTypeIIIToReview': has_ungraded,
            'optedInDeckCategoryKeys': opted_in_category_keys,
            'dailyCompletedByDeckCategory': daily_completed_by_deck_category,
            'dailyStarTiersByDeckCategory': daily_star_tiers_by_deck_category,
            'dailyPercentByDeckCategory': daily_percent_by_deck_category,
            'dailyTargetByDeckCategory': daily_target_by_deck_category,
            'dailyTriedByDeckCategory': daily_tried_by_deck_category,
            'dailyRightByDeckCategory': daily_right_by_deck_category,
            'practiceTargetByDeckCategory': practice_target_by_deck_category,
            'deckCategoryMetaByKey': category_meta_by_key,
        }

        return jsonify(kid_with_progress), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/deck-categories', methods=['GET'])
def get_kid_deck_categories(kid_id):
    """Get available/opted-in deck categories for one kid."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        family_id = str(kid.get('familyId') or '').strip()
        is_super = is_super_family_id(family_id)

        shared_conn = get_shared_decks_connection()
        try:
            all_categories = get_shared_deck_categories(shared_conn)
        finally:
            shared_conn.close()
        categories = [
            item for item in all_categories
            if can_family_access_deck_category(
                item,
                family_id=family_id,
                is_super=is_super,
            )
        ]

        category_keys = [
            normalize_shared_deck_tag(item.get('category_key'))
            for item in categories
            if normalize_shared_deck_tag(item.get('category_key'))
        ]
        allowed_keys = set(category_keys)
        category_meta_by_key = {}
        for item in categories:
            key = normalize_shared_deck_tag(item.get('category_key'))
            if not key:
                continue
            category_meta_by_key[key] = {
                'display_name': str(item.get('display_name') or '').strip(),
                'emoji': str(item.get('emoji') or '').strip(),
                'behavior_type': str(item.get('behavior_type') or '').strip().lower(),
                'has_chinese_specific_logic': bool(item.get('has_chinese_specific_logic')),
                'is_shared_with_non_super_family': bool(item.get('is_shared_with_non_super_family')),
            }

        kid_conn = get_kid_connection_for(kid)
        try:
            rows = kid_conn.execute(
                f"""
                SELECT category_key
                FROM {KID_DECK_CATEGORY_OPT_IN_TABLE}
                WHERE {KID_DECK_CATEGORY_OPT_IN_COL_IS_OPTED_IN} = TRUE
                ORDER BY category_key ASC
                """
            ).fetchall()
        finally:
            kid_conn.close()

        opted_in_keys = []
        seen = set()
        for row in rows:
            key = normalize_shared_deck_tag(row[0])
            if not key or key not in allowed_keys or key in seen:
                continue
            seen.add(key)
            opted_in_keys.append(key)

        opted_in_key_set = set(opted_in_keys)
        available_keys = [key for key in category_keys if key not in opted_in_key_set]

        return jsonify({
            'kid_id': str(kid.get('id') or ''),
            'available_category_keys': available_keys,
            'opted_in_category_keys': opted_in_keys,
            'all_category_keys': category_keys,
            'category_meta_by_key': category_meta_by_key,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/deck-categories', methods=['PUT'])
def update_kid_deck_categories(kid_id):
    """Replace opted-in deck categories for one kid."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        family_id = str(kid.get('familyId') or '').strip()
        is_super = is_super_family_id(family_id)

        payload = request.get_json() or {}
        category_keys = normalize_deck_category_keys(payload.get('categoryKeys'))

        shared_conn = get_shared_decks_connection()
        try:
            allowed_keys = {
                normalize_shared_deck_tag(item.get('category_key'))
                for item in get_shared_deck_categories(shared_conn)
                if can_family_access_deck_category(
                    item,
                    family_id=family_id,
                    is_super=is_super,
                )
                if normalize_shared_deck_tag(item.get('category_key'))
            }
        finally:
            shared_conn.close()

        invalid = [key for key in category_keys if key not in allowed_keys]
        if invalid:
            return jsonify({'error': f'Unknown category key(s): {", ".join(invalid)}'}), 400

        kid_conn = get_kid_connection_for(kid)
        try:
            kid_conn.execute(
                f"UPDATE {KID_DECK_CATEGORY_OPT_IN_TABLE} SET {KID_DECK_CATEGORY_OPT_IN_COL_IS_OPTED_IN} = FALSE"
            )
            if category_keys:
                kid_conn.executemany(
                    f"""
                    INSERT INTO {KID_DECK_CATEGORY_OPT_IN_TABLE} (
                      category_key,
                      {KID_DECK_CATEGORY_OPT_IN_COL_IS_OPTED_IN}
                    )
                    VALUES (?, TRUE)
                    ON CONFLICT (category_key)
                    DO UPDATE SET {KID_DECK_CATEGORY_OPT_IN_COL_IS_OPTED_IN} = TRUE
                    """,
                    [[key] for key in category_keys],
                )
        finally:
            kid_conn.close()

        kid['optedInDeckCategoryKeys'] = list(category_keys)

        return jsonify({
            'updated': True,
            'kid_id': str(kid.get('id') or ''),
            'opted_in_category_keys': category_keys,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
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
        try:
            rows = conn.execute(
                """
                WITH session_results_agg AS (
                    SELECT
                        session_id,
                        COUNT(*) AS answer_count,
                        COALESCE(SUM(CASE WHEN correct > 0 THEN 1 ELSE 0 END), 0) AS right_count,
                        COALESCE(SUM(CASE WHEN correct < 0 THEN 1 ELSE 0 END), 0) AS wrong_count,
                        COALESCE(SUM(CASE WHEN response_time_ms IS NULL THEN 0 ELSE response_time_ms END), 0) AS total_response_ms
                    FROM session_results
                    GROUP BY session_id
                )
                SELECT
                    s.id,
                    s.type,
                    s.started_at,
                    s.completed_at,
                    COALESCE(s.planned_count, 0) AS planned_count,
                    COALESCE(s.retry_count, 0) AS retry_count,
                    COALESCE(s.retry_total_response_ms, 0) AS retry_total_response_ms,
                    COALESCE(s.retry_best_rety_correct_count, 0) AS retry_best_rety_correct_count,
                    COALESCE(a.answer_count, 0) AS answer_count,
                    COALESCE(a.right_count, 0) AS right_count,
                    COALESCE(a.wrong_count, 0) AS wrong_count,
                    COALESCE(a.total_response_ms, 0) AS total_response_ms
                FROM sessions s
                LEFT JOIN session_results_agg a ON a.session_id = s.id
                ORDER BY COALESCE(s.completed_at, s.started_at) DESC, s.id DESC
                """
            ).fetchall()
        finally:
            conn.close()

        category_meta_by_key = get_shared_deck_category_meta_by_key()
        family_id = str(kid.get('familyId') or '').strip()
        family_timezone = metadata.get_family_timezone(family_id)
        sessions = []
        for row in rows:
            session_type = normalize_shared_deck_tag(row[1])
            session_category_display_name = get_deck_category_display_name(session_type, category_meta_by_key)
            sessions.append({
                'id': int(row[0]),
                'type': row[1],
                'behavior_type': get_session_behavior_type(session_type, category_meta_by_key),
                'category_display_name': session_category_display_name,
                'started_at': row[2].isoformat() if row[2] else None,
                'completed_at': row[3].isoformat() if row[3] else None,
                'planned_count': int(row[4] or 0),
                'retry_count': int(row[5] or 0),
                'retry_total_response_ms': int(row[6] or 0),
                'retry_best_rety_correct_count': int(row[7] or 0),
                'answer_count': int(row[8] or 0),
                'right_count': int(row[9] or 0),
                'wrong_count': int(row[10] or 0),
                'total_response_ms': int(row[11] or 0),
            })

        return jsonify({
            'kid': {
                'id': kid.get('id'),
                'name': kid.get('name'),
            },
            'family_timezone': family_timezone,
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
            SELECT
                id,
                type,
                started_at,
                completed_at,
                COALESCE(planned_count, 0),
                COALESCE(retry_count, 0),
                COALESCE(retry_total_response_ms, 0),
                COALESCE(retry_best_rety_correct_count, 0)
            FROM sessions
            WHERE id = ?
            """,
            [session_id_int]
        ).fetchone()
        if not session_row:
            conn.close()
            return jsonify({'error': 'Session not found'}), 404

        def _session_source_deck_label(local_deck_name):
            local_name = str(local_deck_name or '').strip()
            if not local_name:
                return ''
            if local_name == get_category_orphan_deck_name(session_type):
                return 'Personal Deck'
            _, _, tail_name = local_name.partition('__')
            return tail_name.strip() or local_name

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
                d.name,
                lra.file_name,
                lra.mime_type,
                t4.prompt,
                t4.answer,
                t4.submitted_answers
            FROM session_results sr
            LEFT JOIN cards c ON c.id = sr.card_id
            LEFT JOIN decks d ON d.id = c.deck_id
            LEFT JOIN lesson_reading_audio lra ON lra.result_id = sr.id
            LEFT JOIN type4_result_item t4 ON t4.result_id = sr.id
            WHERE sr.session_id = ?
            ORDER BY sr.id ASC
            """,
            [session_id_int]
        ).fetchall()
        conn.close()
        session_type = normalize_shared_deck_tag(session_row[1])
        session_behavior_type = get_session_behavior_type(session_type)
        category_meta_by_key = get_shared_deck_category_meta_by_key()
        session_category_meta = category_meta_by_key.get(session_type) or {}
        session_category_display_name = get_deck_category_display_name(session_type, category_meta_by_key)

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
                'source_deck_name': str(row[7] or '').strip(),
                'source_deck_label': _session_source_deck_label(row[7]),
                'grade_status': ('pass' if int(row[2] or 0) > 0 else ('fail' if int(row[2] or 0) < 0 else 'unknown')),
                'audio_file_name': row[8] or None,
                'audio_mime_type': row[9] or None,
                'audio_url': f"/api/kids/{kid_id}/lesson-reading/audio/{row[8]}" if row[8] else None,
                'materialized_prompt': str(row[10] or '').strip(),
                'materialized_answer': str(row[11] or '').strip(),
                'submitted_answers': [
                    str(item).strip()
                    for item in list(row[12] or [])
                    if str(item or '').strip()
                ],
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
                'behavior_type': session_behavior_type,
                'has_chinese_specific_logic': bool(session_category_meta.get('has_chinese_specific_logic')),
                'category_display_name': session_category_display_name,
                'started_at': session_row[2].isoformat() if session_row[2] else None,
                'completed_at': session_row[3].isoformat() if session_row[3] else None,
                'planned_count': int(session_row[4] or 0),
                'retry_count': int(session_row[5] or 0),
                'retry_total_response_ms': int(session_row[6] or 0),
                'retry_best_rety_correct_count': int(session_row[7] or 0),
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


@kids_bp.route('/kids/<kid_id>/report/type-iii/next-to-grade', methods=['GET'])
def get_kid_type_iii_next_to_grade(kid_id):
    """Return the latest type-III session that still has ungraded cards."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        category_meta_by_key = get_shared_deck_category_meta_by_key()
        requested_category_key = normalize_shared_deck_tag(request.args.get('categoryKey'))
        if requested_category_key:
            category_meta = category_meta_by_key.get(requested_category_key)
            if not isinstance(category_meta, dict):
                return jsonify({'error': 'Unknown categoryKey'}), 400
            behavior_type = str(category_meta.get('behavior_type') or '').strip().lower()
            if behavior_type != DECK_CATEGORY_BEHAVIOR_TYPE_III:
                return jsonify({'error': 'categoryKey must be a type-III deck category'}), 400
            type_iii_category_keys = [requested_category_key]
        else:
            type_iii_category_keys = get_type_iii_category_keys(category_meta_by_key)

        if not type_iii_category_keys:
            return jsonify({
                'session_id': None,
                'latest_session_id': None,
                'has_ungraded': False,
            }), 200

        placeholders = ', '.join(['?'] * len(type_iii_category_keys))
        conn = get_kid_connection_for(kid)

        ungraded_row = conn.execute(
            f"""
            SELECT s.id
            FROM sessions s
            JOIN session_results sr ON sr.session_id = s.id
            WHERE s.type IN ({placeholders})
              AND s.completed_at IS NOT NULL
              AND sr.correct = 0
            GROUP BY s.id, s.completed_at
            ORDER BY s.completed_at DESC, s.id DESC
            LIMIT 1
            """,
            type_iii_category_keys,
        ).fetchone()

        latest_row = conn.execute(
            f"""
            SELECT s.id
            FROM sessions s
            WHERE s.type IN ({placeholders})
              AND s.completed_at IS NOT NULL
            ORDER BY s.completed_at DESC, s.id DESC
            LIMIT 1
            """,
            type_iii_category_keys,
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
                COALESCE(s.retry_total_response_ms, 0) AS retry_total_response_ms,
                lra.file_name,
                lra.mime_type,
                t4.prompt,
                t4.answer,
                t4.submitted_answers
            FROM session_results sr
            JOIN sessions s ON s.id = sr.session_id
            LEFT JOIN lesson_reading_audio lra ON lra.result_id = sr.id
            LEFT JOIN type4_result_item t4 ON t4.result_id = sr.id
            WHERE sr.card_id = ?
            ORDER BY COALESCE(s.completed_at, s.started_at, sr.timestamp) ASC, sr.id ASC
            """,
            [card_id_int]
        ).fetchall()
        conn.close()

        category_meta_by_key = get_shared_deck_category_meta_by_key()
        attempts = []
        right_count = 0
        wrong_count = 0
        ungraded_count = 0
        response_sum_ms = 0
        for row in attempts_rows:
            correct_score = int(row[1] or 0)
            is_correct = correct_score > 0
            response_ms = int(row[2] or 0)
            session_type = normalize_shared_deck_tag(row[5])
            session_behavior_type = get_session_behavior_type(session_type, category_meta_by_key)
            materialized_prompt = str(row[11] or '').strip()
            materialized_answer = str(row[12] or '').strip()
            submitted_answers = [
                str(item).strip()
                for item in list(row[13] or [])
                if str(item or '').strip()
            ]
            attempt_submission_count = max(1, len(submitted_answers)) if materialized_prompt else 1
            avg_response_ms = float(response_ms)
            if materialized_prompt and attempt_submission_count > 1:
                avg_response_ms = (
                    float(response_ms) + float(int(row[8] or 0))
                ) / float(attempt_submission_count)
            attempts.append({
                'result_id': int(row[0]),
                'correct': is_correct,
                'correct_score': correct_score,
                'grade_status': ('pass' if correct_score > 0 else ('fail' if correct_score < 0 else 'ungraded')),
                'response_time_ms': response_ms,
                'avg_response_ms': avg_response_ms,
                'timestamp': row[3].isoformat() if row[3] else None,
                'session_id': int(row[4]) if row[4] is not None else None,
                'session_type': row[5],
                'session_behavior_type': session_behavior_type,
                'session_category_display_name': get_deck_category_display_name(session_type, category_meta_by_key),
                'session_started_at': row[6].isoformat() if row[6] else None,
                'session_completed_at': row[7].isoformat() if row[7] else None,
                'retry_total_response_ms': int(row[8] or 0),
                'audio_file_name': row[9] or None,
                'audio_mime_type': row[10] or None,
                'audio_url': f"/api/kids/{kid_id}/lesson-reading/audio/{row[9]}" if row[9] else None,
                'materialized_prompt': materialized_prompt,
                'materialized_answer': materialized_answer,
                'submitted_answers': submitted_answers,
            })
            response_sum_ms += avg_response_ms
            if correct_score > 0 or correct_score <= SESSION_RESULT_RETRY_FIXED_FIRST:
                right_count += 1
            elif correct_score < 0:
                wrong_count += 1
            else:
                ungraded_count += 1

        attempts_count = len(attempts)
        avg_response_ms = (response_sum_ms / attempts_count) if attempts_count > 0 else 0
        graded_count = right_count + wrong_count
        accuracy_pct = ((right_count * 100.0) / graded_count) if graded_count > 0 else 0

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
                'ungraded_count': ungraded_count,
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
            SELECT sr.id, sr.correct, s.type
            FROM session_results sr
            JOIN sessions s ON s.id = sr.session_id
            WHERE sr.id = ? AND sr.session_id = ?
            LIMIT 1
            """,
            [result_id_int, session_id_int],
        ).fetchone()
        if not target:
            conn.close()
            return jsonify({'error': 'Session result not found'}), 404

        session_type = normalize_shared_deck_tag(target[2])
        if not is_type_iii_session_type(session_type):
            conn.close()
            return jsonify({'error': 'Only type-III session results support grading'}), 400

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


@kids_bp.route('/kids/<kid_id>/report/results/<result_id>/response-time', methods=['PUT'])
def backfill_kid_report_result_response_time(kid_id, result_id):
    """Backfill type-III response time from browser-observed audio duration."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        try:
            result_id_int = int(result_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid result id'}), 400
        if result_id_int <= 0:
            return jsonify({'error': 'Invalid result id'}), 400

        data = request.get_json() or {}
        try:
            response_time_ms = int(data.get('responseTimeMs'))
        except (TypeError, ValueError):
            return jsonify({'error': 'responseTimeMs must be an integer'}), 400
        if response_time_ms <= 0:
            return jsonify({'error': 'responseTimeMs must be > 0'}), 400

        conn = get_kid_connection_for(kid)
        try:
            row = conn.execute(
                """
                SELECT
                    sr.id,
                    sr.card_id,
                    COALESCE(sr.response_time_ms, 0) AS response_time_ms,
                    s.type
                FROM session_results sr
                JOIN sessions s ON s.id = sr.session_id
                WHERE sr.id = ?
                LIMIT 1
                """,
                [result_id_int]
            ).fetchone()
            if not row:
                return jsonify({'error': 'Session result not found'}), 404

            card_id = int(row[1]) if row[1] is not None else None
            current_ms = int(row[2] or 0)
            session_type = normalize_shared_deck_tag(row[3])
            if not is_type_iii_session_type(session_type):
                return jsonify({'error': 'Only type-III results support duration backfill'}), 400

            updated = False
            if current_ms <= 0:
                conn.execute(
                    "UPDATE session_results SET response_time_ms = ? WHERE id = ?",
                    [response_time_ms, result_id_int]
                )
                updated = True

                if card_id is not None:
                    latest_row = conn.execute(
                        """
                        SELECT sr.id
                        FROM session_results sr
                        JOIN sessions s ON s.id = sr.session_id
                        WHERE sr.card_id = ? AND s.type = ?
                        ORDER BY COALESCE(s.completed_at, s.started_at, sr.timestamp) DESC, sr.id DESC
                        LIMIT 1
                        """,
                        [card_id, session_type]
                    ).fetchone()
                    if latest_row and int(latest_row[0]) == result_id_int:
                        conn.execute(
                            "UPDATE cards SET hardness_score = ? WHERE id = ?",
                            [float(response_time_ms), card_id]
                        )

            return jsonify({
                'result_id': result_id_int,
                'updated': bool(updated),
                'response_time_ms': int(response_time_ms if updated else current_ms),
            }), 200
        finally:
            conn.close()
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
        metadata_updates = {}
        session_count_updates_by_key = {}
        hard_pct_updates_by_key = {}
        include_orphan_updates_by_key = {}
        category_meta_by_key = get_shared_deck_category_meta_by_key()
        all_category_keys = {
            normalize_shared_deck_tag(raw_key)
            for raw_key in category_meta_by_key.keys()
            if normalize_shared_deck_tag(raw_key)
        }

        if SESSION_CARD_COUNT_BY_CATEGORY_FIELD in data:
            raw_map = data.get(SESSION_CARD_COUNT_BY_CATEGORY_FIELD)
            if not isinstance(raw_map, dict):
                return jsonify({'error': f'{SESSION_CARD_COUNT_BY_CATEGORY_FIELD} must be an object'}), 400
            for raw_key, raw_value in raw_map.items():
                key = normalize_shared_deck_tag(raw_key)
                if key not in all_category_keys:
                    return jsonify({'error': f'Unknown category key in {SESSION_CARD_COUNT_BY_CATEGORY_FIELD}: {raw_key}'}), 400
                try:
                    parsed = int(raw_value)
                except (TypeError, ValueError):
                    return jsonify({'error': f'{SESSION_CARD_COUNT_BY_CATEGORY_FIELD}.{key} must be an integer'}), 400
                if parsed < 0:
                    return jsonify({'error': f'{SESSION_CARD_COUNT_BY_CATEGORY_FIELD}.{key} must be 0 or more'}), 400
                session_count_updates_by_key[key] = parsed

        if HARD_CARD_PERCENT_BY_CATEGORY_FIELD in data:
            raw_map = data.get(HARD_CARD_PERCENT_BY_CATEGORY_FIELD)
            if not isinstance(raw_map, dict):
                return jsonify({'error': f'{HARD_CARD_PERCENT_BY_CATEGORY_FIELD} must be an object'}), 400
            for raw_key, raw_value in raw_map.items():
                key = normalize_shared_deck_tag(raw_key)
                if key not in all_category_keys:
                    return jsonify({'error': f'Unknown category key in {HARD_CARD_PERCENT_BY_CATEGORY_FIELD}: {raw_key}'}), 400
                try:
                    parsed = int(raw_value)
                except (TypeError, ValueError):
                    return jsonify({'error': f'{HARD_CARD_PERCENT_BY_CATEGORY_FIELD}.{key} must be an integer'}), 400
                if parsed < MIN_HARD_CARD_PERCENTAGE or parsed > MAX_HARD_CARD_PERCENTAGE:
                    return jsonify({'error': f'{HARD_CARD_PERCENT_BY_CATEGORY_FIELD}.{key} must be between {MIN_HARD_CARD_PERCENTAGE} and {MAX_HARD_CARD_PERCENTAGE}'}), 400
                hard_pct_updates_by_key[key] = parsed

        if INCLUDE_ORPHAN_BY_CATEGORY_FIELD in data:
            raw_map = data.get(INCLUDE_ORPHAN_BY_CATEGORY_FIELD)
            if not isinstance(raw_map, dict):
                return jsonify({'error': f'{INCLUDE_ORPHAN_BY_CATEGORY_FIELD} must be an object'}), 400
            for raw_key, raw_value in raw_map.items():
                key = normalize_shared_deck_tag(raw_key)
                if key not in all_category_keys:
                    return jsonify({'error': f'Unknown category key in {INCLUDE_ORPHAN_BY_CATEGORY_FIELD}: {raw_key}'}), 400
                if not isinstance(raw_value, bool):
                    return jsonify({'error': f'{INCLUDE_ORPHAN_BY_CATEGORY_FIELD}.{key} must be a boolean'}), 400
                include_orphan_updates_by_key[key] = raw_value

        if TYPE_I_NON_CHINESE_DECK_MIX_FIELD in data:
            if not isinstance(data[TYPE_I_NON_CHINESE_DECK_MIX_FIELD], dict):
                return jsonify({'error': f'{TYPE_I_NON_CHINESE_DECK_MIX_FIELD} must be an object'}), 400
            metadata_updates[TYPE_I_NON_CHINESE_DECK_MIX_FIELD] = sanitize_deck_mix_payload(
                data[TYPE_I_NON_CHINESE_DECK_MIX_FIELD]
            )

        has_db_updates = bool(
            session_count_updates_by_key
            or hard_pct_updates_by_key
            or include_orphan_updates_by_key
        )
        if not has_db_updates and not metadata_updates:
            return jsonify({'error': 'No supported fields to update'}), 400

        if has_db_updates:
            kid_conn = get_kid_connection_for(kid)
            try:
                if session_count_updates_by_key:
                    kid_conn.executemany(
                        f"""
                        INSERT INTO {KID_DECK_CATEGORY_OPT_IN_TABLE} (
                          category_key,
                          {KID_DECK_CATEGORY_OPT_IN_COL_SESSION_CARD_COUNT}
                        )
                        VALUES (?, ?)
                        ON CONFLICT (category_key)
                        DO UPDATE SET {KID_DECK_CATEGORY_OPT_IN_COL_SESSION_CARD_COUNT} = EXCLUDED.{KID_DECK_CATEGORY_OPT_IN_COL_SESSION_CARD_COUNT}
                        """,
                        [
                            [key, int(value)]
                            for key, value in session_count_updates_by_key.items()
                        ],
                    )
                if hard_pct_updates_by_key:
                    kid_conn.executemany(
                        f"""
                        INSERT INTO {KID_DECK_CATEGORY_OPT_IN_TABLE} (
                          category_key,
                          {KID_DECK_CATEGORY_OPT_IN_COL_HARD_CARD_PERCENTAGE}
                        )
                        VALUES (?, ?)
                        ON CONFLICT (category_key)
                        DO UPDATE SET {KID_DECK_CATEGORY_OPT_IN_COL_HARD_CARD_PERCENTAGE} = EXCLUDED.{KID_DECK_CATEGORY_OPT_IN_COL_HARD_CARD_PERCENTAGE}
                        """,
                        [
                            [key, int(value)]
                            for key, value in hard_pct_updates_by_key.items()
                        ],
                    )
                if include_orphan_updates_by_key:
                    kid_conn.executemany(
                        f"""
                        INSERT INTO {KID_DECK_CATEGORY_OPT_IN_TABLE} (
                          category_key,
                          {KID_DECK_CATEGORY_OPT_IN_COL_INCLUDE_ORPHAN}
                        )
                        VALUES (?, ?)
                        ON CONFLICT (category_key)
                        DO UPDATE SET {KID_DECK_CATEGORY_OPT_IN_COL_INCLUDE_ORPHAN} = EXCLUDED.{KID_DECK_CATEGORY_OPT_IN_COL_INCLUDE_ORPHAN}
                        """,
                        [
                            [key, bool(value)]
                            for key, value in include_orphan_updates_by_key.items()
                        ],
                    )
            finally:
                kid_conn.close()

        if metadata_updates:
            updated_kid = metadata.update_kid(kid_id, metadata_updates, family_id=family_id)
        else:
            updated_kid = metadata.get_kid_by_id(kid_id, family_id=family_id)
        if not updated_kid:
            return jsonify({'error': 'Kid not found'}), 404
        hydrate_kid_category_config_from_db(
            updated_kid,
            category_meta_by_key=category_meta_by_key,
            force_reload=True,
        )

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
        type3_audio_dir = get_kid_type3_audio_dir(kid)
        if os.path.exists(type3_audio_dir):
            shutil.rmtree(type3_audio_dir, ignore_errors=True)

        # Delete from metadata
        metadata.delete_kid(kid_id, family_id=family_id)

        return jsonify({'message': 'Kid deleted successfully'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# Card routes

def get_or_create_orphan_deck(conn, orphan_deck_name, first_tag):
    """Get or create one reserved orphan deck by explicit name/tag."""
    deck_name = str(orphan_deck_name or '').strip()
    tag = normalize_shared_deck_tag(first_tag)
    if not deck_name or not tag:
        raise ValueError('orphan deck name and first tag are required')

    result = conn.execute(
        "SELECT id FROM decks WHERE name = ?",
        [deck_name]
    ).fetchone()
    if result:
        return int(result[0])

    row = conn.execute(
        """
        INSERT INTO decks (name, tags)
        VALUES (?, ?)
        RETURNING id
        """,
        [deck_name, [tag, 'orphan']]
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


def split_type2_bulk_rows(raw_text, has_chinese_specific_logic):
    """Split bulk type-II input into (front, back) rows."""
    if bool(has_chinese_specific_logic):
        tokens = split_writing_bulk_text(raw_text)
        return [(token, token) for token in tokens]

    rows = []
    seen_front = set()
    for raw_line in str(raw_text or '').splitlines():
        line = str(raw_line or '').strip()
        if not line:
            continue
        front = line
        back = line
        if ',' in line:
            parts = line.split(',', 1)
            front = str(parts[0] or '').strip()
            back = str(parts[1] or '').strip()
            if not back:
                back = front
        if not front:
            continue
        if front in seen_front:
            continue
        seen_front.add(front)
        rows.append((front, back))
    return rows


def get_session_behavior_type(session_type, category_meta_by_key=None):
    """Resolve one session/category key to behavior type (type_i/type_ii/type_iii)."""
    session_key = normalize_shared_deck_tag(session_type)
    if not session_key:
        return ''
    metadata = (
        category_meta_by_key
        if isinstance(category_meta_by_key, dict)
        else get_shared_deck_category_meta_by_key()
    )
    category_meta = metadata.get(session_key) if isinstance(metadata, dict) else None
    return normalize_shared_deck_category_behavior((category_meta or {}).get('behavior_type'))


def is_type_iii_session_type(session_type):
    """Return True when one session type key maps to a type-III deck category."""
    behavior_type = get_session_behavior_type(session_type)
    return behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_III


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
        if not is_type_iii_session_type(payload.get('session_type')):
            continue
        cleanup_type3_pending_audio_files_by_payload(payload)


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
        if is_type_iii_session_type(payload.get('session_type')):
            cleanup_type3_pending_audio_files_by_payload(payload)
        return None
    if str(payload.get('session_type')) != str(session_type):
        if is_type_iii_session_type(payload.get('session_type')):
            cleanup_type3_pending_audio_files_by_payload(payload)
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


def get_kid_today_bounds_utc(kid):
    """Return today's [start, end) UTC bounds for one kid's family timezone."""
    family_id = str(kid.get('familyId') or '')
    family_timezone = metadata.get_family_timezone(family_id)
    tzinfo = ZoneInfo(family_timezone)
    day_start_local = datetime.now(tzinfo).replace(hour=0, minute=0, second=0, microsecond=0)
    day_end_local = day_start_local + timedelta(days=1)
    day_start_utc = day_start_local.astimezone(timezone.utc).replace(tzinfo=None)
    day_end_utc = day_end_local.astimezone(timezone.utc).replace(tzinfo=None)
    return day_start_utc, day_end_utc


def get_latest_retry_source_session_for_today(conn, kid, session_type):
    """Return latest non-perfect session for today (type-I/type-II only), else None."""
    session_key = normalize_shared_deck_tag(session_type)
    if not session_key:
        return None
    behavior_type = get_session_behavior_type(session_key)
    if behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_III:
        return None

    day_start_utc, day_end_utc = get_kid_today_bounds_utc(kid)
    row = conn.execute(
        """
        SELECT
            s.id,
            COALESCE(s.planned_count, 0) AS planned_count,
            COUNT(sr.id) AS answer_count,
            COALESCE(SUM(CASE WHEN sr.correct > 0 THEN 1 ELSE 0 END), 0) AS right_count,
            COALESCE(SUM(CASE WHEN sr.correct < 0 THEN 1 ELSE 0 END), 0) AS wrong_count,
            COALESCE(s.retry_best_rety_correct_count, 0) AS retry_best_rety_correct_count
        FROM sessions s
        LEFT JOIN session_results sr ON sr.session_id = s.id
        WHERE s.type = ?
          AND s.completed_at IS NOT NULL
          AND s.completed_at >= ?
          AND s.completed_at < ?
        GROUP BY s.id, s.planned_count, s.retry_best_rety_correct_count, s.completed_at, s.started_at
        ORDER BY COALESCE(s.completed_at, s.started_at) DESC, s.id DESC
        LIMIT 1
        """,
        [session_key, day_start_utc, day_end_utc],
    ).fetchone()
    if not row:
        return None

    session_id = int(row[0] or 0)
    planned_count = int(row[1] or 0)
    answer_count = int(row[2] or 0)
    right_count = int(row[3] or 0)
    wrong_count = int(row[4] or 0)
    retry_best_rety_correct_count = max(0, int(row[5] or 0))
    target_answer_count = max(answer_count, right_count + wrong_count)
    if session_id <= 0 or target_answer_count <= 0 or wrong_count <= 0:
        return None

    effective_best_total_correct = right_count + retry_best_rety_correct_count
    if effective_best_total_correct >= target_answer_count:
        return None

    return {
        'session_id': session_id,
        'planned_count': planned_count,
        'answer_count': target_answer_count,
        'right_count': right_count,
        'wrong_count': wrong_count,
    }


def get_latest_unfinished_session_for_today(conn, kid, session_type):
    """Return latest unfinished session for today when planned_count > answer_count."""
    session_key = normalize_shared_deck_tag(session_type)
    if not session_key:
        return None

    day_start_utc, day_end_utc = get_kid_today_bounds_utc(kid)
    row = conn.execute(
        """
        SELECT
            s.id,
            COALESCE(s.planned_count, 0) AS planned_count,
            COUNT(sr.id) AS answer_count,
            COALESCE(SUM(CASE WHEN sr.correct > 0 THEN 1 ELSE 0 END), 0) AS right_count,
            COALESCE(SUM(CASE WHEN sr.correct < 0 THEN 1 ELSE 0 END), 0) AS wrong_count
        FROM sessions s
        LEFT JOIN session_results sr ON sr.session_id = s.id
        WHERE s.type = ?
          AND COALESCE(s.planned_count, 0) > 0
          AND COALESCE(s.completed_at, s.started_at) >= ?
          AND COALESCE(s.completed_at, s.started_at) < ?
        GROUP BY s.id, s.planned_count, s.completed_at, s.started_at
        HAVING COUNT(sr.id) < COALESCE(s.planned_count, 0)
        ORDER BY COALESCE(s.completed_at, s.started_at) DESC, s.id DESC
        LIMIT 1
        """,
        [session_key, day_start_utc, day_end_utc],
    ).fetchone()
    if not row:
        return None

    session_id = int(row[0] or 0)
    planned_count = max(0, int(row[1] or 0))
    answer_count = max(0, int(row[2] or 0))
    right_count = max(0, int(row[3] or 0))
    wrong_count = max(0, int(row[4] or 0))
    if session_id <= 0 or planned_count <= 0 or answer_count >= planned_count:
        return None

    return {
        'session_id': session_id,
        'planned_count': planned_count,
        'answer_count': answer_count,
        'right_count': right_count,
        'wrong_count': wrong_count,
    }


def get_session_practiced_card_ids(conn, session_id):
    """Return ordered unique card ids already practiced in one session."""
    rows = conn.execute(
        """
        SELECT DISTINCT card_id
        FROM session_results
        WHERE session_id = ?
          AND card_id IS NOT NULL
        ORDER BY card_id ASC
        """,
        [int(session_id)],
    ).fetchall()
    card_ids = []
    for row in rows:
        try:
            card_id = int(row[0])
        except (TypeError, ValueError):
            continue
        if card_id > 0:
            card_ids.append(card_id)
    return card_ids


def build_continue_selected_cards_for_decks(
    conn,
    kid,
    deck_ids,
    session_type,
    missing_count,
    *,
    excluded_card_ids=None,
):
    """Build continuation card selection for one unfinished session."""
    target_count = max(0, int(missing_count or 0))
    normalized_deck_ids = []
    seen_deck_ids = set()
    for raw_deck_id in list(deck_ids or []):
        try:
            deck_id = int(raw_deck_id)
        except (TypeError, ValueError):
            continue
        if deck_id <= 0 or deck_id in seen_deck_ids:
            continue
        normalized_deck_ids.append(deck_id)
        seen_deck_ids.add(deck_id)
    if target_count <= 0 or len(normalized_deck_ids) == 0:
        return []

    cards_by_id, candidate_ids, red_card_ids, hard_ranked_ids, attempt_ranked_ids = _get_practice_rankings_for_decks(
        conn,
        normalized_deck_ids,
        session_type,
        excluded_card_ids=excluded_card_ids,
    )
    if len(candidate_ids) == 0:
        return []

    ordered_ids = []
    seen = set()
    first_ids = _select_session_card_ids(
        kid,
        candidate_ids,
        red_card_ids,
        hard_ranked_ids,
        attempt_ranked_ids,
        session_type,
    )
    for card_id in first_ids:
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

    selected_cards = []
    for card_id in ordered_ids:
        card = cards_by_id.get(card_id)
        if not card:
            continue
        selected_cards.append(card)
        if len(selected_cards) >= target_count:
            break
    return selected_cards


def get_retry_source_wrong_card_ids(conn, source_session_id):
    """Return ordered unique unresolved retry card ids from one source session."""
    rows = conn.execute(
        """
        SELECT DISTINCT card_id
        FROM session_results
        WHERE session_id = ?
          AND correct = ?
          AND card_id IS NOT NULL
        ORDER BY card_id ASC
        """,
        [int(source_session_id), SESSION_RESULT_WRONG_UNRESOLVED],
    ).fetchall()
    wrong_card_ids = []
    for row in rows:
        try:
            card_id = int(row[0])
        except (TypeError, ValueError):
            continue
        if card_id > 0:
            wrong_card_ids.append(card_id)
    return wrong_card_ids


def build_retry_ready_payload(conn, kid, category_key, source_by_deck_id):
    """Build retry-ready metadata for one category and source deck set."""
    retry_source_session = get_latest_retry_source_session_for_today(conn, kid, category_key)
    if retry_source_session is None:
        return {
            'is_retry_session': False,
            'retry_source_session_id': None,
            'retry_card_count': 0,
        }

    retry_wrong_card_ids = get_retry_source_wrong_card_ids(
        conn,
        retry_source_session['session_id'],
    )
    retry_cards = build_retry_selected_cards_for_sources(
        conn,
        source_by_deck_id,
        retry_wrong_card_ids,
    )
    return {
        'is_retry_session': True,
        'retry_source_session_id': int(retry_source_session['session_id']),
        'retry_card_count': len(retry_cards),
    }


def build_special_session_ready_payload(
    conn,
    kid,
    category_key,
    *,
    source_by_deck_id,
    source_deck_ids,
    excluded_card_ids=None,
):
    """Build continuation/retry readiness metadata for one category."""
    continue_source_session = get_latest_unfinished_session_for_today(conn, kid, category_key)
    if continue_source_session is not None:
        practiced_card_ids = get_session_practiced_card_ids(
            conn,
            continue_source_session['session_id'],
        )
        excluded_set = set()
        for raw_card_id in list(excluded_card_ids or []):
            try:
                card_id = int(raw_card_id)
            except (TypeError, ValueError):
                continue
            if card_id > 0:
                excluded_set.add(card_id)
        for raw_card_id in practiced_card_ids:
            try:
                card_id = int(raw_card_id)
            except (TypeError, ValueError):
                continue
            if card_id > 0:
                excluded_set.add(card_id)
        missing_count = max(
            0,
            int(continue_source_session['planned_count']) - int(continue_source_session['answer_count']),
        )
        continue_cards = build_continue_selected_cards_for_decks(
            conn,
            kid,
            source_deck_ids,
            category_key,
            missing_count,
            excluded_card_ids=list(excluded_set),
        )
        return {
            'is_continue_session': True,
            'continue_source_session_id': int(continue_source_session['session_id']),
            'continue_card_count': len(continue_cards),
            'is_retry_session': False,
            'retry_source_session_id': None,
            'retry_card_count': 0,
        }

    retry_payload = build_retry_ready_payload(conn, kid, category_key, source_by_deck_id)
    return {
        'is_continue_session': False,
        'continue_source_session_id': None,
        'continue_card_count': 0,
        **retry_payload,
    }


def build_retry_selected_cards_for_sources(conn, source_by_deck_id, wrong_card_ids):
    """Build retry cards (same payload shape as normal start) from wrong-card ids."""
    normalized_ids = []
    seen = set()
    for raw_card_id in list(wrong_card_ids or []):
        try:
            card_id = int(raw_card_id)
        except (TypeError, ValueError):
            continue
        if card_id <= 0 or card_id in seen:
            continue
        normalized_ids.append(card_id)
        seen.add(card_id)
    if len(normalized_ids) == 0:
        return []

    placeholders = ', '.join(['?'] * len(normalized_ids))
    rows = conn.execute(
        f"""
        SELECT id, deck_id, front, back, created_at
        FROM cards
        WHERE id IN ({placeholders})
          AND COALESCE(skip_practice, FALSE) = FALSE
        ORDER BY id ASC
        """,
        normalized_ids,
    ).fetchall()
    row_by_card_id = {int(row[0]): row for row in rows}

    selected_cards = []
    for card_id in normalized_ids:
        row = row_by_card_id.get(card_id)
        if not row:
            continue
        local_deck_id = int(row[1] or 0)
        src = source_by_deck_id.get(local_deck_id)
        if not isinstance(src, dict):
            continue
        selected_cards.append({
            'id': int(row[0]),
            'deck_id': local_deck_id,
            'front': row[2],
            'back': row[3],
            'created_at': row[4].isoformat() if row[4] else None,
            'shared_deck_id': int(src['shared_deck_id']) if src.get('shared_deck_id') is not None else None,
            'deck_name': str(src.get('local_name') or ''),
            'source_tags': extract_shared_deck_tags_and_labels(src.get('tags') or [])[0],
            'source_is_orphan': bool(src.get('is_orphan')),
        })
    return selected_cards


def build_type_i_multiple_choice_pool_cards(conn, source_by_deck_id, card_ids):
    """Build ordered type-I multiple-choice pool cards from source session card ids."""
    normalized_ids = []
    seen = set()
    for raw_card_id in list(card_ids or []):
        try:
            card_id = int(raw_card_id)
        except (TypeError, ValueError):
            continue
        if card_id <= 0 or card_id in seen:
            continue
        normalized_ids.append(card_id)
        seen.add(card_id)
    if len(normalized_ids) == 0:
        return []

    placeholders = ', '.join(['?'] * len(normalized_ids))
    rows = conn.execute(
        f"""
        SELECT id, deck_id, front, back
        FROM cards
        WHERE id IN ({placeholders})
        """,
        normalized_ids,
    ).fetchall()
    row_by_card_id = {int(row[0]): row for row in rows}

    pool_cards = []
    for card_id in normalized_ids:
        row = row_by_card_id.get(card_id)
        if not row:
            continue
        local_deck_id = int(row[1] or 0)
        if local_deck_id <= 0 or local_deck_id not in source_by_deck_id:
            continue
        pool_cards.append({
            'id': int(row[0]),
            'front': row[2],
            'back': row[3],
        })
    return pool_cards


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


def normalize_logged_response_time_ms(raw_response_time_ms, session_behavior_type=''):
    """Normalize and cap logged response time by session behavior type."""
    try:
        response_time_ms = int(raw_response_time_ms)
    except (TypeError, ValueError):
        response_time_ms = 0
    response_time_ms = max(0, response_time_ms)
    behavior_type = normalize_shared_deck_category_behavior(session_behavior_type)
    max_ms = MAX_LOGGED_RESPONSE_TIME_MS_BY_BEHAVIOR_TYPE.get(behavior_type)
    if max_ms is not None:
        return min(response_time_ms, int(max_ms))
    return response_time_ms


def _get_practice_rankings_for_decks(conn, deck_ids, session_type, excluded_card_ids=None):
    """Return candidate ids and deterministic ranking inputs across one or more decks."""
    normalized_deck_ids = []
    for raw_deck_id in list(deck_ids or []):
        try:
            deck_id = int(raw_deck_id)
        except (TypeError, ValueError):
            continue
        if deck_id <= 0 or deck_id in normalized_deck_ids:
            continue
        normalized_deck_ids.append(deck_id)
    if len(normalized_deck_ids) == 0:
        return {}, [], [], [], []

    excluded_set = set(excluded_card_ids or [])
    excluded_ids = sorted(excluded_set)
    exclude_clause = ""
    deck_placeholders = ','.join(['?'] * len(normalized_deck_ids))
    params = [session_type, *normalized_deck_ids]
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
            c.deck_id,
            c.front,
            c.back,
            c.created_at,
            c.hardness_score,
            COALESCE(a.lifetime_attempts, 0) AS lifetime_attempts,
            r.first_red_at
        FROM cards c
        LEFT JOIN attempts a ON a.card_id = c.id
        LEFT JOIN red r ON r.card_id = c.id
        WHERE c.deck_id IN ({deck_placeholders}) AND COALESCE(c.skip_practice, FALSE) = FALSE
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
            'deck_id': row[1],
            'front': row[2],
            'back': row[3],
            'created_at': row[4].isoformat() if row[4] else None
        }
        for row in rows
    }
    candidate_ids = [row[0] for row in rows]

    red_rows = [row for row in rows if row[7] is not None]
    red_rows.sort(key=lambda row: (row[7], row[0]))
    red_card_ids = [row[0] for row in red_rows]

    def hard_rank_key(row):
        # Never-seen cards (0 lifetime attempts) are treated as hardest so 100%
        # hard-card mode still surfaces unseen cards instead of starving them.
        lifetime_attempts = int(row[6] if row[6] is not None else 0)
        hardness_score = float(row[5] if row[5] is not None else 0)
        unseen_priority = 0 if lifetime_attempts <= 0 else 1
        return (unseen_priority, -hardness_score, row[0])

    hard_ranked_ids = [
        row[0]
        for row in sorted(rows, key=hard_rank_key)
    ]
    attempt_ranked_ids = [
        row[0]
        for row in sorted(
            rows,
            key=lambda row: (int(row[6] if row[6] is not None else 0), row[0])
        )
    ]

    return cards_by_id, candidate_ids, red_card_ids, hard_ranked_ids, attempt_ranked_ids


def _select_session_card_ids(kid, candidate_ids, red_card_ids, hard_ranked_ids, attempt_ranked_ids, session_type):
    """Select one session-sized card list from ranking inputs."""
    base_target_count = min(
        get_category_session_card_count_for_kid(kid, session_type),
        len(candidate_ids),
    )
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
    hard_pct = normalize_hard_card_percentage(kid, session_type=session_type)
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


def preview_deck_practice_order_for_decks(conn, kid, deck_ids, session_type, excluded_card_ids=None):
    """Preview merged next-session queue order across multiple decks."""
    _, candidate_ids, red_card_ids, hard_ranked_ids, attempt_ranked_ids = _get_practice_rankings_for_decks(
        conn,
        deck_ids,
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
        session_type,
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


def plan_deck_practice_selection_for_decks(conn, kid, deck_ids, session_type, excluded_card_ids=None):
    """Build deterministic merged session selection across multiple decks."""
    cards_by_id, candidate_ids, red_card_ids, hard_ranked_ids, attempt_ranked_ids = _get_practice_rankings_for_decks(
        conn,
        deck_ids,
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
        session_type,
    )
    return cards_by_id, selected_ids


def _update_hardness_after_session(
    conn,
    *,
    session_behavior_type,
    latest_response_by_card,
    touched_card_ids,
    session_type,
):
    """Update card hardness for one completed session."""
    if session_behavior_type in (DECK_CATEGORY_BEHAVIOR_TYPE_I, DECK_CATEGORY_BEHAVIOR_TYPE_III):
        for card_id, latest_ms in latest_response_by_card.items():
            conn.execute(
                "UPDATE cards SET hardness_score = ? WHERE id = ?",
                [float(latest_ms or 0), card_id]
            )
        return
    if session_behavior_type != DECK_CATEGORY_BEHAVIOR_TYPE_II or len(touched_card_ids) == 0:
        return
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
            WHERE s.type = ?
              AND sr.card_id IN ({placeholders})
            GROUP BY sr.card_id
        ) AS stats
        WHERE cards.id = stats.card_id
        """,
        [session_type, *list(touched_card_ids)]
    )


def _cleanup_uncommitted_type3_audio(written_paths, pending_payload):
    """Cleanup audio files created/queued for an uncommitted type-III session."""
    for file_path in list(written_paths or []):
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except Exception:
            pass
    cleanup_type3_pending_audio_files_by_payload(pending_payload)


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
    planned_count = int(pending.get('planned_count') or 0)
    uses_type_iii_audio = is_type_iii_session_type(session_type)
    try:
        category_meta_by_key = get_shared_deck_category_meta_by_key()
    except Exception:
        category_meta_by_key = {}
    session_behavior_type = get_session_behavior_type(
        session_type,
        category_meta_by_key=category_meta_by_key,
    )
    try:
        retry_source_session_id = int(pending.get(PENDING_RETRY_SOURCE_SESSION_ID_KEY) or 0)
    except (TypeError, ValueError):
        retry_source_session_id = 0
    try:
        continue_source_session_id = int(pending.get(PENDING_CONTINUE_SOURCE_SESSION_ID_KEY) or 0)
    except (TypeError, ValueError):
        continue_source_session_id = 0
    is_retry_session = (
        retry_source_session_id > 0
        and session_behavior_type in (
            DECK_CATEGORY_BEHAVIOR_TYPE_I,
            DECK_CATEGORY_BEHAVIOR_TYPE_II,
            DECK_CATEGORY_BEHAVIOR_TYPE_IV,
        )
    )
    is_continue_session = (
        continue_source_session_id > 0
        and session_behavior_type in (
            DECK_CATEGORY_BEHAVIOR_TYPE_I,
            DECK_CATEGORY_BEHAVIOR_TYPE_II,
            DECK_CATEGORY_BEHAVIOR_TYPE_III,
            DECK_CATEGORY_BEHAVIOR_TYPE_IV,
        )
    )
    if is_continue_session:
        is_retry_session = False
    uploaded_type3_audio = data.get('_uploaded_type3_audio_by_card') if uses_type_iii_audio else {}
    if not isinstance(uploaded_type3_audio, dict):
        uploaded_type3_audio = {}
    pending_type3_audio = pending.get('type3_audio_by_card') if uses_type_iii_audio else {}
    if not isinstance(pending_type3_audio, dict):
        pending_type3_audio = {}
    written_type3_audio_paths = []

    if session_behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_IV:
        return complete_type_iv_session_internal(
            conn,
            kid,
            session_type,
            pending_session_id,
            pending,
            answers,
            planned_count,
            started_at_utc,
            completed_at_utc,
            is_retry_session,
            retry_source_session_id,
            is_continue_session,
            continue_source_session_id,
        )

    # Validate answers before starting transaction
    for answer in answers:
        card_id = answer.get('cardId')
        known = answer.get('known')
        if not card_id or not isinstance(known, bool):
            conn.close()
            if uses_type_iii_audio:
                cleanup_type3_pending_audio_files_by_payload(pending)
            return {'error': 'Each answer needs cardId (int) and known (bool)'}, 400

    try:
        conn.execute("BEGIN TRANSACTION")

        consumed_type3_audio_files = set()
        if is_retry_session:
            source_row = conn.execute(
                """
                SELECT
                    s.id,
                    COUNT(sr.id) AS answer_count,
                    COALESCE(SUM(CASE WHEN sr.correct > 0 THEN 1 ELSE 0 END), 0) AS right_count,
                    COALESCE(SUM(CASE WHEN sr.correct < 0 THEN 1 ELSE 0 END), 0) AS wrong_count,
                    COALESCE(s.retry_count, 0) AS retry_count,
                    COALESCE(s.retry_total_response_ms, 0) AS retry_total_response_ms,
                    COALESCE(s.retry_best_rety_correct_count, 0) AS retry_best_rety_correct_count
                FROM sessions s
                LEFT JOIN session_results sr ON sr.session_id = s.id
                WHERE s.id = ?
                  AND s.type = ?
                GROUP BY
                    s.id,
                    s.retry_count,
                    s.retry_total_response_ms,
                    s.retry_best_rety_correct_count
                """,
                [retry_source_session_id, session_type],
            ).fetchone()
            if not source_row:
                raise ValueError('Retry source session not found')

            source_answer_count = int(source_row[1] or 0)
            source_right_count = int(source_row[2] or 0)
            source_wrong_count = int(source_row[3] or 0)
            source_retry_count = int(source_row[4] or 0)
            source_target_answer_count = max(source_answer_count, source_right_count + source_wrong_count)
            if source_target_answer_count <= 0:
                raise ValueError('Retry source session has no graded answers')

            retry_right_count = 0
            retry_wrong_count = 0
            retry_total_response_ms = 0
            retry_success_card_ids = set()
            for answer in answers:
                try:
                    answer_card_id = int(answer.get('cardId'))
                except (TypeError, ValueError):
                    answer_card_id = 0
                known = bool(answer.get('known'))
                if known:
                    retry_right_count += 1
                    if answer_card_id > 0:
                        retry_success_card_ids.add(answer_card_id)
                else:
                    retry_wrong_count += 1
                response_time_ms = normalize_logged_response_time_ms(
                    answer.get('responseTimeMs'),
                    session_behavior_type=session_behavior_type,
                )
                retry_total_response_ms += int(response_time_ms or 0)

            if retry_success_card_ids:
                placeholders = ','.join(['?'] * len(retry_success_card_ids))
                recovered_correct_value = encode_retry_recovered_session_result(source_retry_count)
                conn.execute(
                    f"""
                    UPDATE session_results
                    SET correct = ?
                    WHERE session_id = ?
                      AND card_id IN ({placeholders})
                      AND correct = ?
                    """,
                    [
                        recovered_correct_value,
                        retry_source_session_id,
                        *sorted(retry_success_card_ids),
                        SESSION_RESULT_WRONG_UNRESOLVED,
                    ],
                )

            best_retry_row = conn.execute(
                """
                SELECT COUNT(DISTINCT card_id)
                FROM session_results
                WHERE session_id = ?
                  AND correct <= ?
                  AND card_id IS NOT NULL
                """,
                [retry_source_session_id, SESSION_RESULT_RETRY_FIXED_FIRST],
            ).fetchone()
            candidate_best_retry_correct = max(0, int(best_retry_row[0] or 0)) if best_retry_row else 0
            conn.execute(
                """
                UPDATE sessions
                SET
                    retry_count = COALESCE(retry_count, 0) + 1,
                    retry_total_response_ms = COALESCE(retry_total_response_ms, 0) + ?,
                    retry_best_rety_correct_count = GREATEST(
                        COALESCE(retry_best_rety_correct_count, 0),
                        ?
                    )
                WHERE id = ?
                """,
                [retry_total_response_ms, candidate_best_retry_correct, retry_source_session_id],
            )
            updated_retry_row = conn.execute(
                """
                SELECT
                    COALESCE(retry_count, 0),
                    COALESCE(retry_total_response_ms, 0),
                    COALESCE(retry_best_rety_correct_count, 0)
                FROM sessions
                WHERE id = ?
                """,
                [retry_source_session_id],
            ).fetchone()

            conn.execute("COMMIT")
            conn.close()
            sync_badges_after_session_complete(kid)
            updated_retry_count = int(updated_retry_row[0] or 0) if updated_retry_row else 0
            updated_retry_total_ms = int(updated_retry_row[1] or 0) if updated_retry_row else 0
            updated_best_retry_correct = int(updated_retry_row[2] or 0) if updated_retry_row else 0
            total_correct_percent = (
                float(source_right_count + updated_best_retry_correct) * 100.0 / float(source_target_answer_count)
                if source_target_answer_count > 0 else 0.0
            )
            achieved_gold_star = total_correct_percent >= 100.0
            attempt_count_today_for_chain = 1 + max(0, updated_retry_count)
            attempt_star_tiers = ['gold']
            return {
                'session_id': int(retry_source_session_id),
                'answer_count': len(answers),
                'planned_count': planned_count,
                'right_count': retry_right_count,
                'wrong_count': retry_wrong_count,
                'completed': True,
                'is_continue_session': False,
                'continue_source_session_id': None,
                'is_retry_session': True,
                'retry_source_session_id': int(retry_source_session_id),
                'retry_count': updated_retry_count,
                'retry_total_response_ms': updated_retry_total_ms,
                'retry_best_rety_correct_count': updated_best_retry_correct,
                'target_answer_count': int(source_target_answer_count),
                'attempt_count_today_for_chain': int(attempt_count_today_for_chain),
                'attempt_star_tiers': attempt_star_tiers,
                'total_correct_percentage': float(total_correct_percent),
                'achieved_gold_star': bool(achieved_gold_star),
                'star_tier': 'gold',
            }, 200

        if is_continue_session:
            source_row = conn.execute(
                """
                SELECT
                    s.id,
                    COALESCE(s.planned_count, 0) AS planned_count,
                    COUNT(sr.id) AS answer_count,
                    COALESCE(SUM(CASE WHEN sr.correct > 0 THEN 1 ELSE 0 END), 0) AS right_count,
                    COALESCE(SUM(CASE WHEN sr.correct < 0 THEN 1 ELSE 0 END), 0) AS wrong_count
                FROM sessions s
                LEFT JOIN session_results sr ON sr.session_id = s.id
                WHERE s.id = ?
                  AND s.type = ?
                GROUP BY s.id, s.planned_count
                """,
                [continue_source_session_id, session_type],
            ).fetchone()
            if not source_row:
                raise ValueError('Continue source session not found')

            source_planned_count = max(0, int(source_row[1] or 0))
            source_answer_count = max(0, int(source_row[2] or 0))
            source_right_count = max(0, int(source_row[3] or 0))
            source_wrong_count = max(0, int(source_row[4] or 0))
            if source_planned_count <= 0:
                raise ValueError('Continue source session has invalid planned count')

            right_count = 0
            wrong_count = 0
            latest_response_by_card = {}
            touched_card_ids = set()
            for answer in answers:
                card_id = answer.get('cardId')
                known = answer.get('known')
                response_time_ms = normalize_logged_response_time_ms(
                    answer.get('responseTimeMs'),
                    session_behavior_type=session_behavior_type,
                )
                if uses_type_iii_audio:
                    correct_value = 0
                else:
                    correct_value = SESSION_RESULT_CORRECT if bool(known) else SESSION_RESULT_WRONG_UNRESOLVED
                if correct_value > 0:
                    right_count += 1
                elif correct_value < 0:
                    wrong_count += 1
                result_row = conn.execute(
                    """
                    INSERT INTO session_results (session_id, card_id, correct, response_time_ms)
                    VALUES (?, ?, ?, ?)
                    RETURNING id
                    """,
                    [continue_source_session_id, card_id, correct_value, response_time_ms]
                ).fetchone()
                result_id = int(result_row[0])
                touched_card_ids.add(card_id)
                latest_response_by_card[card_id] = response_time_ms

                if uses_type_iii_audio:
                    uploaded_audio = uploaded_type3_audio.get(card_id)
                    if uploaded_audio is None:
                        uploaded_audio = uploaded_type3_audio.get(str(card_id))
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
                        audio_dir = ensure_type3_audio_dir(kid)
                        file_name = f"lr_{pending_session_id}_{card_id}_{uuid.uuid4().hex}{ext}"
                        file_path = os.path.join(audio_dir, file_name)
                        with open(file_path, 'wb') as f:
                            f.write(bytes(audio_bytes))
                        written_type3_audio_paths.append(file_path)
                        conn.execute(
                            """
                            INSERT INTO lesson_reading_audio (result_id, file_name, mime_type)
                            VALUES (?, ?, ?)
                            """,
                            [result_id, file_name, mime_type]
                        )
                        consumed_type3_audio_files.add(file_name)
                    else:
                        audio_meta = pending_type3_audio.get(str(card_id))
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
                                consumed_type3_audio_files.add(file_name)

            _update_hardness_after_session(
                conn,
                session_behavior_type=session_behavior_type,
                latest_response_by_card=latest_response_by_card,
                touched_card_ids=touched_card_ids,
                session_type=session_type,
            )

            conn.execute(
                """
                UPDATE sessions
                SET completed_at = ?
                WHERE id = ?
                """,
                [completed_at_utc, continue_source_session_id],
            )
            updated_row = conn.execute(
                """
                SELECT
                    COALESCE(planned_count, 0),
                    COUNT(sr.id) AS answer_count,
                    COALESCE(SUM(CASE WHEN sr.correct > 0 THEN 1 ELSE 0 END), 0) AS right_count,
                    COALESCE(SUM(CASE WHEN sr.correct < 0 THEN 1 ELSE 0 END), 0) AS wrong_count
                FROM sessions s
                LEFT JOIN session_results sr ON sr.session_id = s.id
                WHERE s.id = ?
                GROUP BY s.id, s.planned_count
                """,
                [continue_source_session_id],
            ).fetchone()
            updated_planned_count = max(0, int(updated_row[0] or 0)) if updated_row else source_planned_count
            updated_answer_count = max(0, int(updated_row[1] or 0)) if updated_row else (source_answer_count + len(answers))
            updated_right_count = max(0, int(updated_row[2] or 0)) if updated_row else (source_right_count + right_count)
            updated_wrong_count = max(0, int(updated_row[3] or 0)) if updated_row else (source_wrong_count + wrong_count)
            target_answer_count = max(updated_planned_count, updated_answer_count, updated_right_count + updated_wrong_count)
            is_incomplete = updated_planned_count > 0 and updated_answer_count < updated_planned_count
            if is_incomplete:
                total_correct_percentage = (
                    float(updated_answer_count) * 100.0 / float(max(1, target_answer_count))
                )
            elif uses_type_iii_audio and (updated_right_count + updated_wrong_count) <= 0:
                total_correct_percentage = (
                    float(updated_answer_count) * 100.0 / float(max(1, target_answer_count))
                )
            else:
                total_correct_percentage = (
                    float(updated_right_count) * 100.0 / float(max(1, target_answer_count))
                )
            if is_incomplete:
                attempt_star_tiers = ['half_silver']
                achieved_gold_star = False
                star_tier = 'half_silver'
            else:
                achieved_gold_star = total_correct_percentage >= 100.0
                star_tier = 'gold'
                attempt_star_tiers = ['gold']

            conn.execute("COMMIT")
            conn.close()
            sync_badges_after_session_complete(kid)
            if uses_type_iii_audio and isinstance(pending_type3_audio, dict):
                leftovers = {}
                for item in pending_type3_audio.values():
                    if not isinstance(item, dict):
                        continue
                    file_name = str(item.get('file_name') or '').strip()
                    if file_name and file_name not in consumed_type3_audio_files:
                        leftovers[file_name] = item
                if len(leftovers) > 0:
                    cleanup_type3_pending_audio_files_by_payload({
                        'type3_audio_dir': pending.get('type3_audio_dir'),
                        'type3_audio_by_card': {name: meta for name, meta in leftovers.items()},
                    })
            return {
                'session_id': int(continue_source_session_id),
                'answer_count': int(updated_answer_count),
                'planned_count': int(updated_planned_count),
                'right_count': int(updated_right_count),
                'wrong_count': int(updated_wrong_count),
                'completed': True,
                'is_continue_session': True,
                'continue_source_session_id': int(continue_source_session_id),
                'is_retry_session': False,
                'retry_source_session_id': None,
                'retry_count': 0,
                'retry_total_response_ms': 0,
                'retry_best_rety_correct_count': 0,
                'target_answer_count': int(target_answer_count),
                'attempt_count_today_for_chain': 1,
                'attempt_star_tiers': attempt_star_tiers,
                'total_correct_percentage': float(total_correct_percentage),
                'achieved_gold_star': bool(achieved_gold_star),
                'star_tier': star_tier,
            }, 200

        right_count = 0
        wrong_count = 0
        session_id = conn.execute(
            """
            INSERT INTO sessions (type, planned_count, retry_count, retry_total_response_ms, retry_best_rety_correct_count, started_at, completed_at)
            VALUES (?, ?, 0, 0, 0, ?, ?)
            RETURNING id
            """,
            [session_type, planned_count, started_at_utc, completed_at_utc]
        ).fetchone()[0]

        latest_response_by_card = {}
        touched_card_ids = set()
        for answer in answers:
            card_id = answer.get('cardId')
            known = answer.get('known')
            response_time_ms = normalize_logged_response_time_ms(
                answer.get('responseTimeMs'),
                session_behavior_type=session_behavior_type,
            )
            if uses_type_iii_audio:
                correct_value = 0
            else:
                correct_value = SESSION_RESULT_CORRECT if bool(known) else SESSION_RESULT_WRONG_UNRESOLVED
            if correct_value > 0:
                right_count += 1
            elif correct_value < 0:
                wrong_count += 1
            result_row = conn.execute(
                """
                INSERT INTO session_results (session_id, card_id, correct, response_time_ms)
                VALUES (?, ?, ?, ?)
                RETURNING id
                """,
                [session_id, card_id, correct_value, response_time_ms]
            ).fetchone()
            result_id = int(result_row[0])
            touched_card_ids.add(card_id)

            if uses_type_iii_audio:
                uploaded_audio = uploaded_type3_audio.get(card_id)
                if uploaded_audio is None:
                    uploaded_audio = uploaded_type3_audio.get(str(card_id))
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
                    audio_dir = ensure_type3_audio_dir(kid)
                    file_name = f"lr_{pending_session_id}_{card_id}_{uuid.uuid4().hex}{ext}"
                    file_path = os.path.join(audio_dir, file_name)
                    with open(file_path, 'wb') as f:
                        f.write(bytes(audio_bytes))
                    written_type3_audio_paths.append(file_path)
                    conn.execute(
                        """
                        INSERT INTO lesson_reading_audio (result_id, file_name, mime_type)
                        VALUES (?, ?, ?)
                        """,
                        [result_id, file_name, mime_type]
                    )
                    consumed_type3_audio_files.add(file_name)
                else:
                    audio_meta = pending_type3_audio.get(str(card_id))
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
                            consumed_type3_audio_files.add(file_name)
            latest_response_by_card[card_id] = response_time_ms

        _update_hardness_after_session(
            conn,
            session_behavior_type=session_behavior_type,
            latest_response_by_card=latest_response_by_card,
            touched_card_ids=touched_card_ids,
            session_type=session_type,
        )

        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        conn.close()
        if uses_type_iii_audio:
            _cleanup_uncommitted_type3_audio(written_type3_audio_paths, pending)
        raise

    conn.close()
    sync_badges_after_session_complete(kid)
    if uses_type_iii_audio and isinstance(pending_type3_audio, dict):
        leftovers = {}
        for item in pending_type3_audio.values():
            if not isinstance(item, dict):
                continue
            file_name = str(item.get('file_name') or '').strip()
            if file_name and file_name not in consumed_type3_audio_files:
                leftovers[file_name] = item
        if len(leftovers) > 0:
            cleanup_type3_pending_audio_files_by_payload({
                'type3_audio_dir': pending.get('type3_audio_dir'),
                'type3_audio_by_card': {name: meta for name, meta in leftovers.items()},
            })
    target_answer_count = int(max(planned_count, len(answers), right_count + wrong_count))
    is_incomplete = planned_count > 0 and len(answers) < planned_count
    if is_incomplete:
        total_correct_percentage = float(len(answers)) * 100.0 / float(max(1, target_answer_count))
    elif uses_type_iii_audio and (right_count + wrong_count) <= 0:
        total_correct_percentage = float(len(answers)) * 100.0 / float(max(1, target_answer_count))
    else:
        total_correct_percentage = float(right_count) * 100.0 / float(max(1, target_answer_count))
    if is_incomplete:
        attempt_star_tiers = ['half_silver']
        achieved_gold_star = False
        star_tier = 'half_silver'
    else:
        achieved_gold_star = total_correct_percentage >= 100.0
        star_tier = 'gold'
        attempt_star_tiers = ['gold']
    return {
        'session_id': session_id,
        'answer_count': len(answers),
        'planned_count': planned_count,
        'right_count': int(right_count),
        'wrong_count': int(wrong_count),
        'completed': True,
        'is_continue_session': False,
        'continue_source_session_id': None,
        'is_retry_session': False,
        'retry_source_session_id': None,
        'retry_count': 0,
        'retry_total_response_ms': 0,
        'retry_best_rety_correct_count': 0,
        'target_answer_count': target_answer_count,
        'attempt_count_today_for_chain': 1,
        'attempt_star_tiers': attempt_star_tiers,
        'total_correct_percentage': float(total_correct_percentage),
        'achieved_gold_star': achieved_gold_star,
        'star_tier': star_tier,
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
            MAX(sr.timestamp) AS last_seen_at,
            100.0 * AVG(
                CASE
                    WHEN sr.id IS NULL THEN NULL
                    WHEN sr.correct > 0 THEN 0.0
                    ELSE 1.0
                END
            ) AS overall_wrong_rate,
            ARG_MAX(
                CASE
                    WHEN sr.id IS NULL THEN NULL
                    ELSE COALESCE(sr.response_time_ms, 0)
                END,
                sr.timestamp
            ) AS last_response_time_ms,
            ARG_MAX(
                CASE
                    WHEN sr.id IS NULL THEN NULL
                    ELSE sr.correct
                END,
                sr.timestamp
            ) AS last_result_correct
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
    last_result_correct = row[11]
    if last_result_correct is None:
        last_result = None
    elif int(last_result_correct) > 0:
        last_result = 'right'
    elif int(last_result_correct) == 0:
        last_result = 'ungraded'
    else:
        last_result = 'wrong'
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
        'last_seen_at': row[8].isoformat() if row[8] else None,
        'overall_wrong_rate': float(row[9]) if row[9] is not None else None,
        'last_response_time_ms': int(row[10]) if row[10] is not None else None,
        'last_result': last_result,
    }


def get_writing_candidate_rows(conn, deck_ids, session_type, excluded_card_ids=None, limit=None):
    """Return ordered candidate cards for writing sheets: newly-added (never-seen) or latest-failed."""
    normalized_deck_ids = []
    for raw in list(deck_ids or []):
        try:
            deck_id = int(raw)
        except (TypeError, ValueError):
            continue
        if deck_id <= 0 or deck_id in normalized_deck_ids:
            continue
        normalized_deck_ids.append(deck_id)
    if len(normalized_deck_ids) == 0:
        return []

    excluded = []
    for raw in list(excluded_card_ids or []):
        try:
            card_id = int(raw)
        except (TypeError, ValueError):
            continue
        if card_id <= 0 or card_id in excluded:
            continue
        excluded.append(card_id)

    safe_limit = None
    if limit is not None:
        try:
            parsed_limit = int(limit)
        except (TypeError, ValueError):
            parsed_limit = 0
        if parsed_limit > 0:
            safe_limit = parsed_limit

    deck_placeholders = ','.join(['?'] * len(normalized_deck_ids))
    params = [*normalized_deck_ids]
    exclude_clause = ''
    if excluded:
        excluded_placeholders = ','.join(['?'] * len(excluded))
        exclude_clause = f"AND c.id NOT IN ({excluded_placeholders})"
        params.extend(excluded)

    limit_clause = ''
    if safe_limit is not None:
        limit_clause = 'LIMIT ?'
        params.append(safe_limit)

    return conn.execute(
        f"""
        WITH latest AS (
            SELECT
                sr.card_id,
                sr.correct,
                COALESCE(s.completed_at, s.started_at, sr.timestamp) AS latest_seen_at,
                ROW_NUMBER() OVER (
                    PARTITION BY sr.card_id
                    ORDER BY COALESCE(s.completed_at, s.started_at, sr.timestamp) DESC, sr.id DESC
                ) AS rn
            FROM session_results sr
            JOIN sessions s ON s.id = sr.session_id
            WHERE s.type = ?
        )
        SELECT
            c.id,
            c.front,
            c.back,
            l.correct,
            l.latest_seen_at
        FROM cards c
        LEFT JOIN latest l ON l.card_id = c.id AND l.rn = 1
        WHERE c.deck_id IN ({deck_placeholders})
          AND COALESCE(c.skip_practice, FALSE) = FALSE
          AND (l.card_id IS NULL OR l.correct < 0)
          {exclude_clause}
        ORDER BY
          CASE WHEN l.card_id IS NULL THEN 1 ELSE 0 END DESC,
          COALESCE(l.latest_seen_at, c.created_at) DESC,
          c.id DESC
        {limit_clause}
        """,
        [str(session_type), *params]
    ).fetchall()


def get_writing_candidate_card_ids(conn, deck_ids, session_type, excluded_card_ids=None, limit=None):
    """Return candidate card ids for writing sheets in priority order."""
    rows = get_writing_candidate_rows(
        conn,
        deck_ids,
        session_type,
        excluded_card_ids=excluded_card_ids,
        limit=limit,
    )
    return [int(row[0]) for row in rows]


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
    """Get all Chinese-character cards from the current merged practice source pool."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        category_key = resolve_kid_type_i_chinese_category_key(
            kid,
            request.args.get('categoryKey'),
            allow_default=True,
        )

        conn = get_kid_connection_for(kid)
        try:
            orphan_deck_id = get_or_create_category_orphan_deck(conn, category_key)
            sources = get_shared_type_i_merged_source_decks_for_kid(
                conn,
                kid,
                category_key,
            )
            deck_ids = [
                int(src['local_deck_id'])
                for src in sources
                if bool(src.get('included_in_queue'))
            ]

            cards = []
            for deck_id in deck_ids:
                cards.extend(get_cards_with_stats(conn, deck_id))
        finally:
            conn.close()

        card_list = [map_card_row(card, {}) for card in cards]

        return jsonify({'category_key': category_key, 'deck_id': orphan_deck_id, 'cards': card_list}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
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

        front = str(data.get('front') or '').strip()
        if not front:
            return jsonify({'error': 'Front text is required'}), 400

        category_key = resolve_kid_type_i_chinese_category_key(
            kid,
            data.get('categoryKey') or request.args.get('categoryKey'),
            allow_default=True,
        )

        back = str(data.get('back') or '').strip()
        if not back:
            generated = str(build_chinese_pinyin_text(front) or '').strip()
            back = generated or front

        conn = get_kid_connection_for(kid)
        try:
            deck_id = get_or_create_category_orphan_deck(conn, category_key)
            source_decks = get_shared_type_i_merged_source_decks_for_kid(
                conn,
                kid,
                category_key,
            )
            source_deck_ids = [int(src['local_deck_id']) for src in source_decks]
            existing_fronts = {
                str(value or '').strip()
                for value in get_kid_card_fronts_for_deck_ids(conn, source_deck_ids)
            }
            if front in existing_fronts:
                return jsonify({'error': 'This Chinese character already exists in the card bank'}), 400

            card_id = conn.execute(
                """
                INSERT INTO cards (deck_id, front, back)
                VALUES (?, ?, ?)
                RETURNING id
                """,
                [
                    deck_id,
                    front,
                    back
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
        finally:
            conn.close()

        card_obj = {
            'id': card[0],
            'deck_id': card[1],
            'front': card[2],
            'back': card[3],
            'created_at': card[4].isoformat() if card[4] else None,
            'category_key': category_key,
        }

        return jsonify(card_obj), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
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

        category_key = resolve_kid_type_i_chinese_category_key(
            kid,
            data.get('categoryKey') or request.args.get('categoryKey'),
            allow_default=True,
        )

        conn = get_kid_connection_for(kid)
        try:
            deck_id = get_or_create_category_orphan_deck(conn, category_key)
            source_decks = get_shared_type_i_merged_source_decks_for_kid(
                conn,
                kid,
                category_key,
            )
            source_deck_ids = [int(src['local_deck_id']) for src in source_decks]
            existing_fronts = {
                str(value or '').strip()
                for value in get_kid_card_fronts_for_deck_ids(conn, source_deck_ids)
            }

            created = []
            skipped_existing_count = 0
            skipped_existing_cards = []
            for item in items:
                front = (item.get('front') or '').strip()
                if not front:
                    continue
                if front in existing_fronts:
                    skipped_existing_count += 1
                    skipped_existing_cards.append(front)
                    continue
                existing_fronts.add(front)

                back = str(item.get('back') or '').strip()
                if not back:
                    generated = str(build_chinese_pinyin_text(front) or '').strip()
                    back = generated or front

                card_id = conn.execute(
                    "INSERT INTO cards (deck_id, front, back) VALUES (?, ?, ?) RETURNING id",
                    [deck_id, front, back]
                ).fetchone()[0]
                created.append({'id': card_id, 'front': front})
        finally:
            conn.close()

        return jsonify({
            'created': len(created),
            'skipped_existing_count': skipped_existing_count,
            'skipped_existing_cards': skipped_existing_cards,
            'cards': created,
            'category_key': category_key,
        }), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/cards/<card_id>', methods=['DELETE'])
def delete_card(kid_id, card_id):
    """Delete one type-I orphan card."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        category_key = resolve_kid_type_i_chinese_category_key(
            kid,
            request.args.get('categoryKey'),
            allow_default=True,
        )

        conn = get_kid_connection_for(kid)
        try:
            deck_id = get_or_create_category_orphan_deck(conn, category_key)
            row = conn.execute(
                """
                SELECT c.id
                FROM cards c
                WHERE c.id = ? AND c.deck_id = ?
                LIMIT 1
                """,
                [card_id, deck_id]
            ).fetchone()
            if not row:
                return jsonify({'error': 'Card not found'}), 404

            practiced_count = int(conn.execute(
                "SELECT COUNT(*) FROM session_results WHERE card_id = ?",
                [card_id]
            ).fetchone()[0] or 0)
            if practiced_count > 0:
                return jsonify({'error': 'Cards with practice history cannot be deleted'}), 400

            conn.execute("DELETE FROM writing_sheet_cards WHERE card_id = ?", [card_id])
            delete_card_from_deck_internal(conn, card_id)
        finally:
            conn.close()

        return jsonify({
            'category_key': category_key,
            'card_id': int(card_id),
            'deleted': True,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def build_type_i_shared_decks_payload(
    kid,
    category_key,
    *,
    session_card_count_override=None,
    include_orphan_in_queue_override=None,
    include_category_key=True,
):
    """Build shared-deck opt-in payload for one type-I category."""
    shared_conn = None
    kid_conn = None
    orphan_deck_payload = None
    local_by_shared_id = {}
    local_card_count_by_deck_id = {}
    try:
        shared_conn = get_shared_decks_connection()
        decks = get_shared_deck_rows_by_first_tag(shared_conn, category_key)

        kid_conn = get_kid_connection_for(kid)
        materialized_by_local_id = get_kid_materialized_shared_decks_by_first_tag(
            kid_conn,
            category_key,
        )
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

        orphan_deck_name = get_category_orphan_deck_name(category_key)
        orphan_deck_id = get_or_create_category_orphan_deck(kid_conn, category_key)
        orphan_row = kid_conn.execute(
            "SELECT id, name, tags FROM decks WHERE id = ? LIMIT 1",
            [orphan_deck_id]
        ).fetchone()
        orphan_name = str(orphan_row[1] or orphan_deck_name) if orphan_row else orphan_deck_name
        orphan_total = int(kid_conn.execute(
            "SELECT COUNT(*) FROM cards WHERE deck_id = ?",
            [orphan_deck_id]
        ).fetchone()[0] or 0)
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
        shared_card_count = int(deck.get('card_count') or 0)
        materialized_card_count = (
            int(local_card_count_by_deck_id.get(materialized_deck_id, 0))
            if materialized_deck_id is not None
            else None
        )
        deck['materialized_name'] = materialized_name
        deck['opted_in'] = local_entry is not None
        deck['materialized_deck_id'] = materialized_deck_id
        deck['shared_card_count'] = shared_card_count
        deck['materialized_card_count'] = materialized_card_count
        deck['has_update_warning'] = bool(
            local_entry is not None
            and materialized_card_count is not None
            and materialized_card_count != shared_card_count
        )
        deck['update_warning_reason'] = (
            'count_mismatch'
            if bool(deck['has_update_warning'])
            else ''
        )
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
            'tags': extract_shared_deck_tags_and_labels(local_entry.get('tags') or [])[0],
            'tag_labels': [str(tag) for tag in list(local_entry.get('tag_labels') or []) if str(tag or '').strip()],
            'creator_family_id': None,
            'created_at': None,
            'card_count': int(local_card_count_by_deck_id.get(local_deck_id, 0)),
            'materialized_name': local_name,
            'opted_in': True,
            'materialized_deck_id': local_deck_id,
            'shared_card_count': None,
            'materialized_card_count': int(local_card_count_by_deck_id.get(local_deck_id, 0)),
            'has_update_warning': True,
            'update_warning_reason': 'source_deleted',
            'mix_percent': 0,
            'session_cards': 0,
            'source_deleted': True,
        })

    session_card_count = (
        int(session_card_count_override)
        if session_card_count_override is not None
        else get_category_session_card_count_for_kid(kid, category_key)
    )
    include_orphan_in_queue = (
        bool(include_orphan_in_queue_override)
        if include_orphan_in_queue_override is not None
        else get_category_include_orphan_for_kid(kid, category_key)
    )
    for deck in decks:
        deck['session_cards'] = 0
    if orphan_deck_payload is not None:
        orphan_deck_payload['included_in_queue'] = bool(include_orphan_in_queue)

    payload = {
        'decks': decks,
        'deck_count': len(decks),
        'session_card_count': session_card_count,
        'include_orphan_in_queue': bool(include_orphan_in_queue),
        'orphan_deck': orphan_deck_payload,
    }
    if include_category_key:
        payload['category_key'] = category_key
    return payload


def build_type_iv_shared_decks_payload(
    kid,
    category_key,
    *,
    session_card_count_override=None,
    include_category_key=True,
    include_orphan_in_queue_override=None,
):
    """Build shared-deck opt-in payload for one type-IV category."""
    shared_conn = None
    kid_conn = None
    orphan_deck_payload = None
    local_by_shared_id = {}
    local_card_count_by_deck_id = {}
    local_representative_front_by_deck_id = {}
    local_daily_target_by_deck_id = {}
    try:
        shared_conn = get_shared_decks_connection()
        decks = get_shared_type_iv_deck_rows(shared_conn, category_key)

        kid_conn = get_kid_connection_for(kid)
        materialized_by_local_id = get_kid_materialized_shared_decks_by_first_tag(
            kid_conn,
            category_key,
        )
        for entry in materialized_by_local_id.values():
            shared_deck_id = int(entry['shared_deck_id'])
            existing = local_by_shared_id.get(shared_deck_id)
            if existing is None or int(entry['local_deck_id']) < int(existing['local_deck_id']):
                local_by_shared_id[shared_deck_id] = entry

        local_deck_ids = [int(deck_id) for deck_id in materialized_by_local_id.keys()]
        if local_deck_ids:
            placeholders = ','.join(['?'] * len(local_deck_ids))
            card_rows = kid_conn.execute(
                f"""
                SELECT
                    d.id AS deck_id,
                    COALESCE(d.daily_target_count, 0) AS daily_target_count,
                    COUNT(c.id) AS card_count,
                    ARG_MIN(c.front, c.id) AS representative_front
                FROM decks d
                LEFT JOIN cards c ON c.deck_id = d.id
                WHERE d.id IN ({placeholders})
                GROUP BY d.id, d.daily_target_count
                """,
                local_deck_ids
            ).fetchall()
            for row in card_rows:
                deck_id = int(row[0])
                local_daily_target_by_deck_id[deck_id] = int(row[1] or 0)
                local_card_count_by_deck_id[deck_id] = int(row[2] or 0)
                local_representative_front_by_deck_id[deck_id] = str(row[3] or '')

        orphan_deck_name = get_category_orphan_deck_name(category_key)
        orphan_row = kid_conn.execute(
            "SELECT id FROM decks WHERE name = ? LIMIT 1",
            [orphan_deck_name]
        ).fetchone()
        if orphan_row and int(orphan_row[0] or 0) > 0:
            candidate_payload = build_orphan_deck_payload(
                kid_conn,
                int(orphan_row[0]),
                orphan_deck_name,
            )
            if int(candidate_payload.get('card_count') or 0) > 0:
                orphan_deck_payload = candidate_payload
    finally:
        if kid_conn is not None:
            kid_conn.close()
        if shared_conn is not None:
            shared_conn.close()

    include_orphan_in_queue = (
        bool(include_orphan_in_queue_override)
        if include_orphan_in_queue_override is not None
        else get_category_include_orphan_for_kid(kid, category_key)
    )

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
        shared_card_count = int(deck.get('card_count') or 0)
        materialized_card_count = (
            int(local_card_count_by_deck_id.get(materialized_deck_id, 0))
            if materialized_deck_id is not None
            else None
        )
        deck['materialized_name'] = materialized_name
        deck['opted_in'] = local_entry is not None
        deck['materialized_deck_id'] = materialized_deck_id
        deck['shared_card_count'] = shared_card_count
        deck['materialized_card_count'] = materialized_card_count
        deck['has_update_warning'] = bool(
            local_entry is not None
            and materialized_card_count is not None
            and materialized_card_count != shared_card_count
        )
        deck['update_warning_reason'] = (
            'count_mismatch'
            if bool(deck['has_update_warning'])
            else ''
        )
        deck['mix_percent'] = 0
        deck['session_cards'] = 0
        deck['daily_target_count'] = (
            int(local_daily_target_by_deck_id.get(materialized_deck_id, 0))
            if materialized_deck_id is not None
            else 0
        )

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
            'tags': extract_shared_deck_tags_and_labels(local_entry.get('tags') or [])[0],
            'tag_labels': [str(tag) for tag in list(local_entry.get('tag_labels') or []) if str(tag or '').strip()],
            'creator_family_id': None,
            'created_at': None,
            'card_count': int(local_card_count_by_deck_id.get(local_deck_id, 0)),
            'representative_front': str(local_representative_front_by_deck_id.get(local_deck_id) or ''),
            'materialized_name': local_name,
            'opted_in': True,
            'materialized_deck_id': local_deck_id,
            'shared_card_count': None,
            'materialized_card_count': int(local_card_count_by_deck_id.get(local_deck_id, 0)),
            'has_update_warning': True,
            'update_warning_reason': 'source_deleted',
            'mix_percent': 0,
            'session_cards': 0,
            'daily_target_count': int(local_daily_target_by_deck_id.get(local_deck_id, 0)),
            'source_deleted': True,
        })

    session_card_count = (
        int(session_card_count_override)
        if session_card_count_override is not None
        else (
            sum(int(deck.get('daily_target_count') or 0) for deck in decks if bool(deck.get('opted_in')))
            + (
                int(orphan_deck_payload.get('daily_target_count') or 0)
                if orphan_deck_payload is not None and include_orphan_in_queue
                else 0
            )
        )
    )
    if orphan_deck_payload is not None:
        orphan_deck_payload['included_in_queue'] = bool(include_orphan_in_queue)
    payload = {
        'decks': decks,
        'deck_count': len(decks),
        'session_card_count': session_card_count,
        'include_orphan_in_queue': bool(include_orphan_in_queue),
        'orphan_deck': orphan_deck_payload,
    }
    if include_category_key:
        payload['category_key'] = category_key
    return payload


def _fetch_shared_decks_by_ids(shared_conn, deck_ids):
    """Load shared deck metadata by ids and report missing ids."""
    normalized_ids = [int(deck_id) for deck_id in list(deck_ids or [])]
    if len(normalized_ids) == 0:
        return {}, []
    placeholders = ','.join(['?'] * len(normalized_ids))
    deck_rows = shared_conn.execute(
        f"""
        SELECT deck_id, name, tags
        FROM deck
        WHERE deck_id IN ({placeholders})
        """,
        normalized_ids
    ).fetchall()
    shared_by_id = {
        int(row[0]): {
            'deck_id': int(row[0]),
            'name': str(row[1]),
            'tags': extract_shared_deck_tags_and_labels(row[2])[0],
        }
        for row in deck_rows
    }
    missing_ids = [deck_id for deck_id in normalized_ids if deck_id not in shared_by_id]
    return shared_by_id, missing_ids


def opt_in_type_i_shared_decks(kid, category_key, deck_ids, has_chinese_specific_logic):
    """Materialize selected shared decks for one type-I category."""
    shared_conn = None
    kid_conn = None
    try:
        shared_conn = get_shared_decks_connection()
        shared_by_id, missing_ids = _fetch_shared_decks_by_ids(shared_conn, deck_ids)
        if missing_ids:
            return {
                'error': f'Shared deck(s) not found: {", ".join(str(v) for v in missing_ids)}'
            }, 404

        placeholders = ','.join(['?'] * len(deck_ids))
        invalid_tag_ids = [
            deck_id for deck_id in deck_ids
            if category_key not in shared_by_id[deck_id]['tags']
        ]
        if invalid_tag_ids:
            return {
                'error': (
                    f'Deck(s) are not {category_key}-tagged: '
                    f'{", ".join(str(v) for v in invalid_tag_ids)}'
                )
            }, 400

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
        existing_materialized = get_kid_materialized_shared_decks_by_first_tag(
            kid_conn,
            category_key,
        )
        occupied_fronts = get_kid_card_fronts_for_deck_ids(
            kid_conn,
            list(existing_materialized.keys())
        )
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
            inserted = kid_conn.execute(
                """
                INSERT INTO decks (name, tags)
                VALUES (?, ?)
                RETURNING id
                """,
                [materialized_name, materialized_tags]
            ).fetchone()
            local_deck_id = int(inserted[0])

            cards = cards_by_deck_id.get(src_deck_id, [])
            cards_added = 0
            cards_moved_from_orphan = 0
            cards_skipped_existing_front = 0
            if cards:
                orphan_deck_id = get_or_create_category_orphan_deck(kid_conn, category_key)
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
                    if not front:
                        continue
                    if front in occupied_fronts:
                        cards_skipped_existing_front += 1
                        continue
                    orphan_row = orphan_by_front.pop(front, None)
                    if orphan_row is not None:
                        if has_chinese_specific_logic:
                            moved_rows.append((orphan_row, str(card.get('back') or '')))
                        else:
                            moved_rows.append(orphan_row)
                        occupied_fronts.add(front)
                        continue
                    insert_rows.append([local_deck_id, front, str(card.get('back') or '')])
                    occupied_fronts.add(front)

                if moved_rows:
                    moved_ids = [
                        int(row[0][0]) if has_chinese_specific_logic else int(row[0])
                        for row in moved_rows
                    ]
                    moved_placeholders = ','.join(['?'] * len(moved_ids))
                    # DuckDB can fail UPDATE on indexed columns; replace row with same id to "move" decks.
                    kid_conn.execute(
                        f"DELETE FROM cards WHERE id IN ({moved_placeholders})",
                        moved_ids
                    )
                    if has_chinese_specific_logic:
                        kid_conn.executemany(
                            """
                            INSERT INTO cards (id, deck_id, front, back, skip_practice, hardness_score, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                            """,
                            [
                                [
                                    int(orphan_row[0]),
                                    local_deck_id,
                                    str(orphan_row[1] or ''),
                                    shared_back,
                                    bool(orphan_row[3]),
                                    float(orphan_row[4] or 0.0),
                                    orphan_row[5],
                                ]
                                for orphan_row, shared_back in moved_rows
                            ]
                        )
                    else:
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
                'cards_skipped_existing_front': cards_skipped_existing_front,
                'cards_total': len(cards),
            })
    finally:
        if kid_conn is not None:
            kid_conn.close()
        if shared_conn is not None:
            shared_conn.close()

    return {
        'requested_count': len(deck_ids),
        'created_count': len(created),
        'already_opted_in_count': len(already_opted_in),
        'created': created,
        'already_opted_in': already_opted_in,
    }, 200


def opt_out_type_i_shared_decks(kid, category_key, deck_ids):
    """Remove selected opted-in shared decks for one type-I category."""
    kid_conn = None
    try:
        kid_conn = get_kid_connection_for(kid)
        materialized_by_local_id = get_kid_materialized_shared_decks_by_first_tag(
            kid_conn,
            category_key,
        )
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

            if had_practice_sessions:
                orphan_deck_id = get_or_create_category_orphan_deck(kid_conn, category_key)
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

    return {
        'requested_count': len(deck_ids),
        'removed_count': len(removed),
        'already_opted_out_count': len(already_opted_out),
        'removed': removed,
        'already_opted_out': already_opted_out,
    }


def opt_in_type_iv_shared_decks(kid, category_key, deck_ids):
    """Materialize selected shared decks for one type-IV category."""
    shared_conn = None
    kid_conn = None
    try:
        shared_conn = get_shared_decks_connection()
        shared_by_id = {
            int(deck['deck_id']): deck
            for deck in get_shared_type_iv_deck_rows(shared_conn, category_key)
        }
        missing_ids = [deck_id for deck_id in deck_ids if deck_id not in shared_by_id]
        if missing_ids:
            return {
                'error': f'Shared deck(s) not found: {", ".join(str(v) for v in missing_ids)}'
            }, 404

        representative_rows = shared_conn.execute(
            f"""
            SELECT deck_id, front, back
            FROM cards
            WHERE deck_id IN ({','.join(['?'] * len(deck_ids))})
            ORDER BY deck_id ASC, id ASC
            """,
            deck_ids
        ).fetchall()
        representative_by_deck_id = {}
        for row in representative_rows:
            deck_id = int(row[0])
            if deck_id in representative_by_deck_id:
                continue
            representative_by_deck_id[deck_id] = {
                'front': str(row[1] or ''),
                'back': str(row[2] or ''),
            }

        invalid_definition_ids = []
        for deck_id in deck_ids:
            representative = representative_by_deck_id.get(deck_id)
            if not representative or not str(representative.get('front') or '').strip():
                invalid_definition_ids.append(deck_id)
        if invalid_definition_ids:
            return {
                'error': (
                    'Type-IV deck(s) are missing their representative card: '
                    f'{", ".join(str(v) for v in invalid_definition_ids)}'
                )
            }, 400

        kid_conn = get_kid_connection_for(kid)
        orphan_deck_id = None
        orphan_deck_row = kid_conn.execute(
            "SELECT id FROM decks WHERE name = ? LIMIT 1",
            [get_category_orphan_deck_name(category_key)]
        ).fetchone()
        if orphan_deck_row:
            orphan_deck_id = int(orphan_deck_row[0])
        representative_fronts = []
        seen_fronts = set()
        for deck_id in deck_ids:
            representative = representative_by_deck_id.get(deck_id) or {}
            front = str(representative.get('front') or '')
            if not front or front in seen_fronts:
                continue
            seen_fronts.add(front)
            representative_fronts.append(front)

        orphan_by_front = {}
        if orphan_deck_id is not None and representative_fronts:
            front_placeholders = ','.join(['?'] * len(representative_fronts))
            orphan_rows = kid_conn.execute(
                f"""
                SELECT id, front, back, skip_practice, hardness_score, created_at
                FROM cards
                WHERE deck_id = ?
                  AND front IN ({front_placeholders})
                ORDER BY id ASC
                """,
                [orphan_deck_id, *representative_fronts]
            ).fetchall()
            for row in orphan_rows:
                row_front = str(row[1] or '')
                if row_front in orphan_by_front:
                    continue
                orphan_by_front[row_front] = row

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
            inserted = kid_conn.execute(
                """
                INSERT INTO decks (name, tags, daily_target_count)
                VALUES (?, ?, ?)
                RETURNING id
                """,
                [
                    materialized_name,
                    materialized_tags,
                    DEFAULT_TYPE_IV_DAILY_TARGET_COUNT,
                ]
            ).fetchone()
            local_deck_id = int(inserted[0])

            representative = representative_by_deck_id[src_deck_id]
            representative_front = str(representative.get('front') or '')
            representative_back = str(representative.get('back') or '')
            orphan_row = orphan_by_front.pop(representative_front, None)
            cards_moved_from_orphan = 0
            if orphan_row is not None:
                moved_card_id = int(orphan_row[0])
                kid_conn.execute("DELETE FROM cards WHERE id = ?", [moved_card_id])
                kid_conn.execute(
                    """
                    INSERT INTO cards (id, deck_id, front, back, skip_practice, hardness_score, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        moved_card_id,
                        local_deck_id,
                        representative_front,
                        representative_back,
                        bool(orphan_row[3]),
                        float(orphan_row[4] or 0.0),
                        orphan_row[5],
                    ]
                )
                cards_moved_from_orphan = 1
            else:
                kid_conn.execute(
                    "INSERT INTO cards (deck_id, front, back) VALUES (?, ?, ?)",
                    [
                        local_deck_id,
                        representative_front,
                        representative_back,
                    ]
                )
            created.append({
                'shared_deck_id': src_deck_id,
                'shared_name': src_deck['name'],
                'materialized_name': materialized_name,
                'deck_id': local_deck_id,
                'cards_added': 1,
                'cards_moved_from_orphan': cards_moved_from_orphan,
                'cards_total': 1,
            })
    finally:
        if kid_conn is not None:
            kid_conn.close()
        if shared_conn is not None:
            shared_conn.close()

    return {
        'requested_count': len(deck_ids),
        'created_count': len(created),
        'already_opted_in_count': len(already_opted_in),
        'created': created,
        'already_opted_in': already_opted_in,
    }, 200


def opt_out_type_iv_shared_decks(kid, category_key, deck_ids):
    """Remove selected opted-in shared decks for one type-IV category."""
    kid_conn = None
    try:
        kid_conn = get_kid_connection_for(kid)
        materialized_by_local_id = get_kid_materialized_shared_decks_by_first_tag(
            kid_conn,
            category_key,
        )
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

            if had_practice_sessions:
                orphan_deck_id = get_or_create_category_orphan_deck(kid_conn, category_key)
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
                unpracticed_ids = [card_id for card_id in card_ids if card_id not in practiced_card_id_set]
                if unpracticed_ids:
                    delete_shared_deck_related_rows(
                        kid_conn,
                        unpracticed_ids,
                        delete_type3_audio=False,
                    )
                    unpracticed_placeholders = ','.join(['?'] * len(unpracticed_ids))
                    kid_conn.execute(
                        f"DELETE FROM cards WHERE id IN ({unpracticed_placeholders})",
                        unpracticed_ids
                    )
            else:
                if card_ids:
                    delete_shared_deck_related_rows(
                        kid_conn,
                        card_ids,
                        delete_type3_audio=False,
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

    return {
        'requested_count': len(deck_ids),
        'removed_count': len(removed),
        'already_opted_out_count': len(already_opted_out),
        'removed': removed,
        'already_opted_out': already_opted_out,
    }, 200


def build_type_i_shared_cards_payload(
    kid,
    category_key,
    preview_hard_pct=None,
    *,
    session_card_count_override=None,
    include_orphan_in_queue_override=None,
    preview_hard_pct_field_override=None,
):
    """Build merged cards payload for one type-I category."""
    category_meta_by_key = get_shared_deck_category_meta_by_key()
    category_display_name = get_deck_category_display_name(category_key, category_meta_by_key)
    effective_hard_pct = (
        preview_hard_pct
        if preview_hard_pct is not None
        else normalize_hard_card_percentage(kid, session_type=category_key)
    )
    session_card_count = (
        int(session_card_count_override)
        if session_card_count_override is not None
        else get_category_session_card_count_for_kid(kid, category_key)
    )
    include_orphan_in_queue = (
        bool(include_orphan_in_queue_override)
        if include_orphan_in_queue_override is not None
        else get_category_include_orphan_for_kid(kid, category_key)
    )

    conn = get_kid_connection_for(kid)
    try:
        sources = get_shared_type_i_merged_source_decks_for_kid(
            conn,
            kid,
            category_key,
            include_orphan_in_queue_override=include_orphan_in_queue,
        )
        bank_sources = [
            src for src in sources
            if int(src.get('card_count') or 0) > 0 and bool(src.get('included_in_bank', True))
        ]
        practice_sources = [src for src in sources if bool(src.get('included_in_queue'))]
        practice_source_ids = [
            int(src['local_deck_id'])
            for src in practice_sources
            if int(src.get('active_card_count') or 0) > 0
        ]

        preview_order = {}
        if practice_source_ids:
            preview_kid = with_preview_session_count_for_category(
                kid,
                category_key,
                session_card_count,
            )
            if preview_hard_pct_field_override:
                preview_kid[preview_hard_pct_field_override] = int(effective_hard_pct)
            else:
                existing_hard_pct_by_category = kid.get(HARD_CARD_PERCENT_BY_CATEGORY_FIELD)
                existing_hard_pct_map = (
                    {
                        normalize_shared_deck_tag(raw_key): raw_value
                        for raw_key, raw_value in existing_hard_pct_by_category.items()
                        if normalize_shared_deck_tag(raw_key)
                    }
                    if isinstance(existing_hard_pct_by_category, dict)
                    else {}
                )
                preview_kid[HARD_CARD_PERCENT_BY_CATEGORY_FIELD] = {
                    **existing_hard_pct_map,
                    category_key: int(effective_hard_pct),
                }
            preview_ids = preview_deck_practice_order_for_decks(
                conn,
                preview_kid,
                practice_source_ids,
                category_key
            )
            preview_order = {card_id: i + 1 for i, card_id in enumerate(preview_ids)}

        def _source_label(source):
            tags = extract_shared_deck_tags_and_labels(source.get('tags') or [])[0]
            tail = tags[1:] if len(tags) > 1 else []
            if tail:
                return ' / '.join(tail)
            local_name = str(source.get('local_name') or '')
            if bool(source.get('is_orphan')):
                return 'orphan'
            return local_name

        merged_cards = []
        for src in bank_sources:
            local_deck_id = int(src['local_deck_id'])
            rows = get_cards_with_stats(conn, local_deck_id)
            for row in rows:
                mapped = map_card_row(row, preview_order)
                mapped['source_deck_id'] = local_deck_id
                mapped['source_deck_name'] = str(src.get('local_name') or '')
                mapped['source_deck_label'] = _source_label(src)
                mapped['source_deck_tags'] = extract_shared_deck_tags_and_labels(src.get('tags') or [])[0]
                mapped['source_is_orphan'] = bool(src.get('is_orphan'))
                merged_cards.append(mapped)

        active_count = sum(int(src.get('active_card_count') or 0) for src in bank_sources)
        skipped_count = sum(int(src.get('skipped_card_count') or 0) for src in bank_sources)
        practice_active_count = sum(int(src.get('active_card_count') or 0) for src in practice_sources)
    finally:
        conn.close()

    return {
        'is_merged_bank': True,
        'category_key': category_key,
        'deck_name': f'Merged {category_display_name} Bank',
        'hard_card_percentage': int(effective_hard_pct),
        'include_orphan_in_queue': include_orphan_in_queue,
        'practice_source_count': len(practice_sources),
        'practice_active_card_count': int(practice_active_count),
        'active_card_count': active_count,
        'skipped_card_count': skipped_count,
        'cards': merged_cards
    }


def build_type_iv_shared_cards_payload(
    kid,
    category_key,
    preview_hard_pct=None,
    *,
    session_card_count_override=None,
):
    """Build merged cards payload for one type-IV category."""
    category_meta_by_key = get_shared_deck_category_meta_by_key()
    category_display_name = get_deck_category_display_name(category_key, category_meta_by_key)
    effective_hard_pct = (
        preview_hard_pct
        if preview_hard_pct is not None
        else 0
    )

    conn = get_kid_connection_for(kid)
    try:
        include_orphan_in_queue = get_category_include_orphan_for_kid(kid, category_key)
        practice_sources = get_type_iv_practice_source_rows(
            conn,
            kid,
            category_key,
            include_orphan_in_queue_override=include_orphan_in_queue,
        )
        sources = get_type_iv_bank_source_rows(
            conn,
            kid,
            category_key,
            include_orphan_in_queue_override=include_orphan_in_queue,
        )
        generator_details_by_shared_id = build_type_iv_card_generator_details_by_shared_id(
            [src.get('shared_deck_id') for src in practice_sources if src.get('shared_deck_id') is not None],
        )
        generator_details_by_front = build_type_iv_generator_details_by_representative_front(category_key)
        session_card_count = (
            int(session_card_count_override)
            if session_card_count_override is not None
            else get_type_iv_total_daily_target_for_category(
                conn,
                kid,
                category_key,
                include_orphan_in_queue_override=include_orphan_in_queue,
            )
        )

        def _source_label(source):
            if bool(source.get('is_orphan')):
                return 'orphan'
            tags = extract_shared_deck_tags_and_labels(source.get('tags') or [])[0]
            tail = tags[1:] if len(tags) > 1 else []
            if tail:
                return ' / '.join(tail)
            return str(source.get('local_name') or '')

        merged_cards = []
        for src in sources:
            local_deck_id = int(src['local_deck_id'])
            shared_deck_id = int(src.get('shared_deck_id') or 0)
            rows = get_cards_with_stats(conn, local_deck_id)
            for row in rows:
                mapped = map_card_row(row, {})
                representative_front = str(mapped.get('front') or '').strip()
                generator_details = generator_details_by_shared_id.get(shared_deck_id) or {}
                if not generator_details and representative_front:
                    generator_details = generator_details_by_front.get(representative_front) or {}
                resolved_shared_deck_id = int(generator_details.get('shared_deck_id') or shared_deck_id or 0)
                mapped['source_deck_id'] = local_deck_id
                mapped['source_deck_name'] = str(src.get('local_name') or '')
                mapped['source_deck_label'] = _source_label(src)
                mapped['source_deck_tags'] = extract_shared_deck_tags_and_labels(src.get('tags') or [])[0]
                mapped['source_is_orphan'] = bool(src.get('is_orphan'))
                mapped['type4_shared_deck_id'] = resolved_shared_deck_id if resolved_shared_deck_id > 0 else None
                mapped['type4_generator_code'] = str(generator_details.get('code') or '')
                mapped['type4_is_multichoice_only'] = bool(generator_details.get('is_multichoice_only'))
                merged_cards.append(mapped)

        practice_active_count = sum(int(src.get('active_card_count') or 0) for src in practice_sources)
        active_count = sum(int(src.get('active_card_count') or 0) for src in sources)
        skipped_count = sum(int(src.get('skipped_card_count') or 0) for src in sources)
    finally:
        conn.close()

    return {
        'is_merged_bank': True,
        'category_key': category_key,
        'deck_name': f'Merged {category_display_name} Bank',
        'hard_card_percentage': int(effective_hard_pct),
        'include_orphan_in_queue': bool(include_orphan_in_queue),
        'practice_source_count': len(practice_sources),
        'practice_active_card_count': int(practice_active_count),
        'active_card_count': active_count,
        'skipped_card_count': skipped_count,
        'session_card_count': session_card_count,
        'cards': merged_cards,
    }


def normalize_type_iv_practice_mode(raw_mode):
    """Normalize generator practice mode to input or multi."""
    text = str(raw_mode or '').strip().lower()
    if text == TYPE_IV_PRACTICE_MODE_MULTI:
        return TYPE_IV_PRACTICE_MODE_MULTI
    return TYPE_IV_PRACTICE_MODE_INPUT


def normalize_type_iv_submitted_answer(raw_value):
    """Normalize one submitted generator answer for exact-string grading."""
    if raw_value is None:
        return ''
    return str(raw_value).strip()


def get_type_iv_practice_source_rows(
    conn,
    kid,
    category_key,
    *,
    include_orphan_in_queue_override=None,
):
    """Return opted-in generator sources ready for session generation."""
    sources = [
        source for source in list(get_shared_type_iv_merged_source_decks_for_kid(
            conn,
            kid,
            category_key,
            include_orphan_in_queue_override=include_orphan_in_queue_override,
        ))
        if bool(source.get('included_in_queue'))
    ]
    local_deck_ids = [int(src['local_deck_id']) for src in sources if int(src.get('local_deck_id') or 0) > 0]
    source_by_local_deck_id = {
        int(src.get('local_deck_id') or 0): src
        for src in sources
        if int(src.get('local_deck_id') or 0) > 0
    }
    generator_details_by_shared_id = build_type_iv_card_generator_details_by_shared_id(
        [src.get('shared_deck_id') for src in sources],
    )
    generator_details_by_front = build_type_iv_generator_details_by_representative_front(category_key)

    practice_sources = []
    if local_deck_ids:
        placeholders = ','.join(['?'] * len(local_deck_ids))
        rows = conn.execute(
            f"""
            SELECT c.id, c.deck_id, c.front, d.daily_target_count
            FROM cards c
            JOIN decks d ON d.id = c.deck_id
            WHERE c.deck_id IN ({placeholders})
            ORDER BY c.deck_id ASC, c.id ASC
            """,
            local_deck_ids,
        ).fetchall()
        seen_non_orphan_deck_ids = set()
        for row in rows:
            representative_card_id = int(row[0] or 0)
            local_deck_id = int(row[1] or 0)
            source = source_by_local_deck_id.get(local_deck_id)
            if representative_card_id <= 0 or local_deck_id <= 0 or not source:
                continue
            is_orphan = bool(source.get('is_orphan'))
            if not is_orphan and local_deck_id in seen_non_orphan_deck_ids:
                continue
            if not is_orphan:
                seen_non_orphan_deck_ids.add(local_deck_id)

            raw_shared_deck_id = source.get('shared_deck_id')
            shared_deck_id = int(raw_shared_deck_id or 0) if raw_shared_deck_id is not None else 0
            representative_front = str(row[2] or '')
            generator_details = generator_details_by_shared_id.get(shared_deck_id) or {}
            if not generator_details and representative_front:
                generator_details = generator_details_by_front.get(representative_front) or {}
            resolved_shared_deck_id = int(generator_details.get('shared_deck_id') or shared_deck_id or 0)
            generator_code = str(generator_details.get('code') or '').strip()
            if not generator_code:
                continue

            practice_sources.append({
                'source_key': int(representative_card_id),
                'local_deck_id': local_deck_id,
                'shared_deck_id': resolved_shared_deck_id if resolved_shared_deck_id > 0 else None,
                'local_name': str(source.get('local_name') or ''),
                'tags': extract_shared_deck_tags_and_labels(source.get('tags') or [])[0],
                'card_count': 1,
                'active_card_count': 1,
                'skipped_card_count': 0,
                'representative_card_id': representative_card_id,
                'representative_front': representative_front,
                'daily_target_count': max(0, int(row[3] or 0)),
                'generator_code': generator_code,
                'is_multichoice_only': bool(generator_details.get('is_multichoice_only')),
                'is_orphan': is_orphan,
            })
    return practice_sources


def build_type_iv_choice_options(answer, distractor_answers, seed):
    """Return one shuffled multiple-choice option list for a generator item."""
    correct_answer = normalize_type_iv_submitted_answer(answer)
    seen = set()
    options = []
    for text in [correct_answer, *list(distractor_answers or [])]:
        normalized = normalize_type_iv_submitted_answer(text)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        options.append(normalized)
    rng = random.Random(int(seed or 0))
    rng.shuffle(options)
    return options


def map_type_iv_pending_item_to_response_card(item, practice_mode):
    """Map one pending generator item to the kid-facing practice payload."""
    is_multichoice_only = bool(item.get('is_multichoice_only'))
    use_multi_choice = (
        is_multichoice_only
        or normalize_type_iv_practice_mode(practice_mode) == TYPE_IV_PRACTICE_MODE_MULTI
    )
    response_card = {
        'id': int(item.get('id') or 0),
        'front': str(item.get('prompt') or ''),
        'isMultichoiceOnly': bool(is_multichoice_only),
    }
    if use_multi_choice:
        response_card['choices'] = build_type_iv_choice_options(
            item.get('answer'),
            item.get('distractor_answers') or [],
            seed=int(item.get('id') or 0),
        )
    return response_card


def build_type_iv_pending_items_for_sources(
    practice_sources,
    count_by_source_key,
    practice_mode,
    *,
    pending_id_start=1,
    seed_base=None,
):
    """Generate pending in-memory practice items from configured generator decks."""
    pending_items = []
    response_cards = []
    next_pending_id = max(1, int(pending_id_start or 1))
    try:
        next_seed_base = int(seed_base)
    except (TypeError, ValueError):
        next_seed_base = int(time.time_ns() % 2_000_000_000)

    for source in list(practice_sources or []):
        local_deck_id = int(source.get('local_deck_id') or 0)
        source_key = int(source.get('source_key') or source.get('representative_card_id') or 0)
        sample_count = max(0, int((count_by_source_key or {}).get(source_key, 0) or 0))
        if local_deck_id <= 0 or sample_count <= 0:
            continue
        samples = run_type4_generator(
            source.get('generator_code'),
            sample_count=sample_count,
            seed_base=next_seed_base,
        )
        next_seed_base += sample_count + 97
        for sample in samples:
            pending_item = {
                'id': next_pending_id,
                'representative_card_id': int(source.get('representative_card_id') or 0),
                'deck_id': local_deck_id,
                'prompt': str(sample.get('prompt') or ''),
                'answer': str(sample.get('answer') or ''),
                'distractor_answers': [str(item) for item in list(sample.get('distractors') or [])],
                'is_multichoice_only': bool(source.get('is_multichoice_only')),
            }
            pending_items.append(pending_item)
            response_cards.append(
                map_type_iv_pending_item_to_response_card(pending_item, practice_mode)
            )
            next_pending_id += 1

    return pending_items, response_cards


def distribute_type_iv_random_count_across_sources(source_keys, total_count, rng):
    """Spread one generator count randomly across source keys with minimal repetition."""
    normalized_keys = []
    seen = set()
    for raw_key in list(source_keys or []):
        try:
            key = int(raw_key)
        except (TypeError, ValueError):
            continue
        if key <= 0 or key in seen:
            continue
        seen.add(key)
        normalized_keys.append(key)
    if total_count <= 0 or not normalized_keys:
        return {}

    allocations = {key: 0 for key in normalized_keys}
    shuffled_keys = list(normalized_keys)
    rng.shuffle(shuffled_keys)
    full_cycles, remainder = divmod(int(total_count), len(shuffled_keys))
    if full_cycles > 0:
        for key in shuffled_keys:
            allocations[key] += full_cycles
    if remainder > 0:
        rng.shuffle(shuffled_keys)
        for key in shuffled_keys[:remainder]:
            allocations[key] += 1
    return {
        int(key): int(count)
        for key, count in allocations.items()
        if int(count or 0) > 0
    }


def build_type_iv_initial_count_by_source_key(practice_sources):
    """Build one configured per-source count map for a fresh generator session."""
    allocations = {}
    orphan_source_keys_by_deck_id = {}
    orphan_daily_target_by_deck_id = {}

    for source in list(practice_sources or []):
        local_deck_id = int(source.get('local_deck_id') or 0)
        source_key = int(source.get('source_key') or source.get('representative_card_id') or 0)
        daily_target_count = max(0, int(source.get('daily_target_count') or 0))
        if local_deck_id <= 0 or source_key <= 0 or daily_target_count <= 0:
            continue
        if bool(source.get('is_orphan')):
            orphan_source_keys_by_deck_id.setdefault(local_deck_id, []).append(source_key)
            orphan_daily_target_by_deck_id[local_deck_id] = daily_target_count
            continue
        allocations[source_key] = daily_target_count

    rng = random.Random(int(time.time_ns() % 2_000_000_000))
    for local_deck_id, source_keys in orphan_source_keys_by_deck_id.items():
        orphan_allocations = distribute_type_iv_random_count_across_sources(
            source_keys,
            int(orphan_daily_target_by_deck_id.get(local_deck_id) or 0),
            rng,
        )
        for source_key, count in orphan_allocations.items():
            allocations[int(source_key)] = int(count)

    return allocations


def build_type_iv_continue_count_by_source_key(practice_sources, target_count):
    """Redistribute unfinished generator questions across current generator sources."""
    remaining_count = max(0, int(target_count or 0))
    if remaining_count <= 0:
        return {}

    grouped_entries_by_key = {}
    for source in list(practice_sources or []):
        local_deck_id = int(source.get('local_deck_id') or 0)
        source_key = int(source.get('source_key') or source.get('representative_card_id') or 0)
        if local_deck_id <= 0 or source_key <= 0:
            continue
        is_orphan = bool(source.get('is_orphan'))
        group_key = f"orphan_{local_deck_id}" if is_orphan else f"source_{source_key}"
        entry = grouped_entries_by_key.get(group_key)
        if entry is None:
            entry = {
                'group_key': group_key,
                'weight': max(0, int(source.get('daily_target_count') or 0)),
                'source_keys': [],
                'is_orphan': is_orphan,
            }
            grouped_entries_by_key[group_key] = entry
        entry['weight'] = max(entry['weight'], max(0, int(source.get('daily_target_count') or 0)))
        entry['source_keys'].append(source_key)

    all_entries = [
        entry for entry in grouped_entries_by_key.values()
        if list(entry.get('source_keys') or [])
    ]
    if not all_entries:
        return {}

    weighted_entries = [
        entry for entry in all_entries
        if int(entry.get('weight') or 0) > 0
    ]
    if not weighted_entries:
        weighted_entries = list(all_entries)

    source_entries = [{
        'group_key': str(entry.get('group_key') or ''),
        'weight': max(1, int(entry.get('weight') or 0)),
        'source_keys': [int(key) for key in list(entry.get('source_keys') or []) if int(key) > 0],
        'is_orphan': bool(entry.get('is_orphan')),
    } for entry in weighted_entries]
    if not source_entries:
        return {}

    total_weight = sum(entry['weight'] for entry in source_entries)
    allocations = {entry['group_key']: 0 for entry in source_entries}
    fractional_entries = []
    allocated_count = 0
    for entry in source_entries:
        exact_share = (remaining_count * entry['weight']) / float(max(1, total_weight))
        base_share = int(math.floor(exact_share))
        allocations[entry['group_key']] = base_share
        allocated_count += base_share
        fractional_entries.append({
            'group_key': entry['group_key'],
            'weight': entry['weight'],
            'fractional': exact_share - float(base_share),
        })

    remainder = max(0, remaining_count - allocated_count)
    fractional_entries.sort(
        key=lambda entry: (-entry['fractional'], -entry['weight'], entry['group_key'])
    )
    while remainder > 0 and fractional_entries:
        for entry in fractional_entries:
            allocations[entry['group_key']] += 1
            remainder -= 1
            if remainder <= 0:
                break

    rng = random.Random(int(time.time_ns() % 2_000_000_000))
    expanded_allocations = {}
    for entry in source_entries:
        allocated = int(allocations.get(entry['group_key']) or 0)
        if allocated <= 0:
            continue
        if bool(entry.get('is_orphan')):
            orphan_allocations = distribute_type_iv_random_count_across_sources(
                entry.get('source_keys') or [],
                allocated,
                rng,
            )
            for source_key, count in orphan_allocations.items():
                expanded_allocations[int(source_key)] = int(count)
            continue
        first_source_key = int((entry.get('source_keys') or [0])[0] or 0)
        if first_source_key > 0:
            expanded_allocations[first_source_key] = allocated

    return expanded_allocations


def get_type_iv_retry_source_result_rows(conn, source_session_id, allowed_representative_card_ids):
    """Return unresolved generator retry rows for one source session."""
    normalized_card_ids = []
    seen = set()
    for raw_card_id in list(allowed_representative_card_ids or []):
        try:
            card_id = int(raw_card_id)
        except (TypeError, ValueError):
            continue
        if card_id <= 0 or card_id in seen:
            continue
        seen.add(card_id)
        normalized_card_ids.append(card_id)
    if not normalized_card_ids:
        return []

    placeholders = ','.join(['?'] * len(normalized_card_ids))
    rows = conn.execute(
        f"""
        SELECT
            sr.id,
            sr.card_id,
            t4.prompt,
            t4.answer,
            t4.distractor_answers,
            t4.submitted_answers
        FROM session_results sr
        JOIN type4_result_item t4 ON t4.result_id = sr.id
        WHERE sr.session_id = ?
          AND sr.correct = ?
          AND sr.card_id IN ({placeholders})
        ORDER BY sr.timestamp ASC, sr.id ASC
        """,
        [int(source_session_id), SESSION_RESULT_WRONG_UNRESOLVED, *normalized_card_ids],
    ).fetchall()

    result_rows = []
    for row in rows:
        result_id = int(row[0] or 0)
        representative_card_id = int(row[1] or 0)
        prompt = str(row[2] or '').strip()
        answer = str(row[3] or '').strip()
        if result_id <= 0 or representative_card_id <= 0 or not prompt or not answer:
            continue
        result_rows.append({
            'result_id': result_id,
            'representative_card_id': representative_card_id,
            'prompt': prompt,
            'answer': answer,
            'distractor_answers': [str(item) for item in list(row[4] or []) if str(item or '').strip()],
            'submitted_answers': [str(item) for item in list(row[5] or [])],
        })
    return result_rows


def build_type_iv_special_session_ready_payload(conn, kid, category_key, practice_sources):
    """Build continue/retry readiness metadata for one generator category."""
    continue_source_session = get_latest_unfinished_session_for_today(conn, kid, category_key)
    if continue_source_session is not None:
        missing_count = max(
            0,
            int(continue_source_session['planned_count']) - int(continue_source_session['answer_count']),
        )
        continue_counts = build_type_iv_continue_count_by_source_key(practice_sources, missing_count)
        return {
            'is_continue_session': True,
            'continue_source_session_id': int(continue_source_session['session_id']),
            'continue_card_count': sum(int(count or 0) for count in continue_counts.values()),
            'is_retry_session': False,
            'retry_source_session_id': None,
            'retry_card_count': 0,
        }

    retry_source_session = get_latest_retry_source_session_for_today(conn, kid, category_key)
    if retry_source_session is None:
        return {
            'is_continue_session': False,
            'continue_source_session_id': None,
            'continue_card_count': 0,
            'is_retry_session': False,
            'retry_source_session_id': None,
            'retry_card_count': 0,
        }

    retry_rows = get_type_iv_retry_source_result_rows(
        conn,
        retry_source_session['session_id'],
        [source.get('representative_card_id') for source in list(practice_sources or [])],
    )
    return {
        'is_continue_session': False,
        'continue_source_session_id': None,
        'continue_card_count': 0,
        'is_retry_session': True,
        'retry_source_session_id': int(retry_source_session['session_id']),
        'retry_card_count': len(retry_rows),
    }


def insert_type4_result_item(conn, result_id, pending_item, submitted_answer):
    """Insert one generator sidecar row for a saved session result."""
    conn.execute(
        """
        INSERT INTO type4_result_item (result_id, prompt, answer, distractor_answers, submitted_answers)
        VALUES (?, ?, ?, ?, ?)
        """,
        [
            int(result_id),
            str(pending_item.get('prompt') or ''),
            str(pending_item.get('answer') or ''),
            [str(item) for item in list(pending_item.get('distractor_answers') or [])],
            [normalize_type_iv_submitted_answer(submitted_answer)],
        ],
    )


def append_type4_result_submitted_answer(conn, result_id, submitted_answer):
    """Append one submitted answer to an existing generator result sidecar row."""
    row = conn.execute(
        """
        SELECT submitted_answers
        FROM type4_result_item
        WHERE result_id = ?
        LIMIT 1
        """,
        [int(result_id)],
    ).fetchone()
    if row is None:
        raise ValueError('Generator result details not found')

    submitted_answers = [str(item) for item in list(row[0] or [])]
    submitted_answers.append(normalize_type_iv_submitted_answer(submitted_answer))
    conn.execute(
        """
        UPDATE type4_result_item
        SET submitted_answers = ?
        WHERE result_id = ?
        """,
        [submitted_answers, int(result_id)],
    )


def complete_type_iv_session_internal(
    conn,
    kid,
    session_type,
    pending_session_id,
    pending,
    answers,
    planned_count,
    started_at_utc,
    completed_at_utc,
    is_retry_session,
    retry_source_session_id,
    is_continue_session,
    continue_source_session_id,
):
    """Complete one generator practice session using server-side grading."""
    pending_cards = pending.get('cards')
    if not isinstance(pending_cards, list) or len(pending_cards) == 0:
        conn.close()
        return {'error': 'Pending session is missing generated questions'}, 400

    pending_by_id = {}
    for item in pending_cards:
        if not isinstance(item, dict):
            continue
        try:
            item_id = int(item.get('id'))
        except (TypeError, ValueError):
            continue
        if item_id <= 0:
            continue
        pending_by_id[item_id] = item
    if len(pending_by_id) == 0:
        conn.close()
        return {'error': 'Pending session is missing generated questions'}, 400

    normalized_answers = []
    for answer in answers:
        try:
            item_id = int(answer.get('cardId'))
        except (TypeError, ValueError):
            conn.close()
            return {'error': 'Each answer needs cardId (int)'}, 400
        pending_item = pending_by_id.get(item_id)
        if not pending_item:
            conn.close()
            return {'error': 'answers do not match this pending session'}, 400
        response_time_ms = normalize_logged_response_time_ms(
            answer.get('responseTimeMs'),
            session_behavior_type=DECK_CATEGORY_BEHAVIOR_TYPE_IV,
        )
        normalized_answers.append({
            'item_id': item_id,
            'pending_item': pending_item,
            'submitted_answer': normalize_type_iv_submitted_answer(answer.get('submittedAnswer')),
            'response_time_ms': response_time_ms,
        })

    try:
        conn.execute("BEGIN TRANSACTION")

        if is_retry_session:
            source_row = conn.execute(
                """
                SELECT
                    s.id,
                    COUNT(sr.id) AS answer_count,
                    COALESCE(SUM(CASE WHEN sr.correct > 0 THEN 1 ELSE 0 END), 0) AS right_count,
                    COALESCE(SUM(CASE WHEN sr.correct < 0 THEN 1 ELSE 0 END), 0) AS wrong_count,
                    COALESCE(s.retry_count, 0) AS retry_count,
                    COALESCE(s.retry_total_response_ms, 0) AS retry_total_response_ms,
                    COALESCE(s.retry_best_rety_correct_count, 0) AS retry_best_rety_correct_count
                FROM sessions s
                LEFT JOIN session_results sr ON sr.session_id = s.id
                WHERE s.id = ?
                  AND s.type = ?
                GROUP BY
                    s.id,
                    s.retry_count,
                    s.retry_total_response_ms,
                    s.retry_best_rety_correct_count
                """,
                [retry_source_session_id, session_type],
            ).fetchone()
            if not source_row:
                raise ValueError('Retry source session not found')

            source_answer_count = int(source_row[1] or 0)
            source_right_count = int(source_row[2] or 0)
            source_wrong_count = int(source_row[3] or 0)
            source_retry_count = int(source_row[4] or 0)
            source_target_answer_count = max(source_answer_count, source_right_count + source_wrong_count)
            if source_target_answer_count <= 0:
                raise ValueError('Retry source session has no graded answers')

            retry_right_count = 0
            retry_wrong_count = 0
            retry_total_response_ms = 0
            retry_success_result_ids = []
            for answer in normalized_answers:
                submitted_answer = answer['submitted_answer']
                pending_item = answer['pending_item']
                expected_answer = normalize_type_iv_submitted_answer(pending_item.get('answer'))
                is_correct = submitted_answer == expected_answer
                if is_correct:
                    retry_right_count += 1
                    retry_success_result_ids.append(int(answer['item_id']))
                else:
                    retry_wrong_count += 1
                retry_total_response_ms += int(answer['response_time_ms'] or 0)
                append_type4_result_submitted_answer(
                    conn,
                    answer['item_id'],
                    submitted_answer,
                )

            if retry_success_result_ids:
                placeholders = ','.join(['?'] * len(retry_success_result_ids))
                recovered_correct_value = encode_retry_recovered_session_result(source_retry_count)
                conn.execute(
                    f"""
                    UPDATE session_results
                    SET correct = ?
                    WHERE id IN ({placeholders})
                      AND session_id = ?
                      AND correct = ?
                    """,
                    [
                        recovered_correct_value,
                        *sorted(retry_success_result_ids),
                        int(retry_source_session_id),
                        SESSION_RESULT_WRONG_UNRESOLVED,
                    ],
                )

            best_retry_row = conn.execute(
                """
                SELECT COUNT(*)
                FROM session_results
                WHERE session_id = ?
                  AND correct <= ?
                """,
                [retry_source_session_id, SESSION_RESULT_RETRY_FIXED_FIRST],
            ).fetchone()
            candidate_best_retry_correct = max(0, int(best_retry_row[0] or 0)) if best_retry_row else 0
            conn.execute(
                """
                UPDATE sessions
                SET
                    retry_count = COALESCE(retry_count, 0) + 1,
                    retry_total_response_ms = COALESCE(retry_total_response_ms, 0) + ?,
                    retry_best_rety_correct_count = GREATEST(
                        COALESCE(retry_best_rety_correct_count, 0),
                        ?
                    )
                WHERE id = ?
                """,
                [retry_total_response_ms, candidate_best_retry_correct, retry_source_session_id],
            )
            updated_retry_row = conn.execute(
                """
                SELECT
                    COALESCE(retry_count, 0),
                    COALESCE(retry_total_response_ms, 0),
                    COALESCE(retry_best_rety_correct_count, 0)
                FROM sessions
                WHERE id = ?
                """,
                [retry_source_session_id],
            ).fetchone()

            conn.execute("COMMIT")
            conn.close()
            sync_badges_after_session_complete(kid)
            updated_retry_count = int(updated_retry_row[0] or 0) if updated_retry_row else 0
            updated_retry_total_ms = int(updated_retry_row[1] or 0) if updated_retry_row else 0
            updated_best_retry_correct = int(updated_retry_row[2] or 0) if updated_retry_row else 0
            total_correct_percent = (
                float(source_right_count + updated_best_retry_correct) * 100.0 / float(source_target_answer_count)
                if source_target_answer_count > 0 else 0.0
            )
            achieved_gold_star = total_correct_percent >= 100.0
            attempt_count_today_for_chain = 1 + max(0, updated_retry_count)
            return {
                'session_id': int(retry_source_session_id),
                'answer_count': len(normalized_answers),
                'planned_count': planned_count,
                'right_count': retry_right_count,
                'wrong_count': retry_wrong_count,
                'completed': True,
                'is_continue_session': False,
                'continue_source_session_id': None,
                'is_retry_session': True,
                'retry_source_session_id': int(retry_source_session_id),
                'retry_count': updated_retry_count,
                'retry_total_response_ms': updated_retry_total_ms,
                'retry_best_rety_correct_count': updated_best_retry_correct,
                'target_answer_count': int(source_target_answer_count),
                'attempt_count_today_for_chain': int(attempt_count_today_for_chain),
                'attempt_star_tiers': ['gold'],
                'total_correct_percentage': float(total_correct_percent),
                'achieved_gold_star': bool(achieved_gold_star),
                'star_tier': 'gold',
            }, 200

        if is_continue_session:
            source_row = conn.execute(
                """
                SELECT
                    s.id,
                    COALESCE(s.planned_count, 0) AS planned_count,
                    COUNT(sr.id) AS answer_count,
                    COALESCE(SUM(CASE WHEN sr.correct > 0 THEN 1 ELSE 0 END), 0) AS right_count,
                    COALESCE(SUM(CASE WHEN sr.correct < 0 THEN 1 ELSE 0 END), 0) AS wrong_count
                FROM sessions s
                LEFT JOIN session_results sr ON sr.session_id = s.id
                WHERE s.id = ?
                  AND s.type = ?
                GROUP BY s.id, s.planned_count
                """,
                [continue_source_session_id, session_type],
            ).fetchone()
            if not source_row:
                raise ValueError('Continue source session not found')

            source_planned_count = max(0, int(source_row[1] or 0))
            source_answer_count = max(0, int(source_row[2] or 0))
            source_right_count = max(0, int(source_row[3] or 0))
            source_wrong_count = max(0, int(source_row[4] or 0))
            if source_planned_count <= 0:
                raise ValueError('Continue source session has invalid planned count')

            right_count = 0
            wrong_count = 0
            for answer in normalized_answers:
                pending_item = answer['pending_item']
                representative_card_id = int(pending_item.get('representative_card_id') or 0)
                if representative_card_id <= 0:
                    raise ValueError('Pending generator item is missing representative card')
                submitted_answer = answer['submitted_answer']
                expected_answer = normalize_type_iv_submitted_answer(pending_item.get('answer'))
                correct_value = (
                    SESSION_RESULT_CORRECT
                    if submitted_answer == expected_answer
                    else SESSION_RESULT_WRONG_UNRESOLVED
                )
                if correct_value > 0:
                    right_count += 1
                else:
                    wrong_count += 1
                result_row = conn.execute(
                    """
                    INSERT INTO session_results (session_id, card_id, correct, response_time_ms)
                    VALUES (?, ?, ?, ?)
                    RETURNING id
                    """,
                    [
                        continue_source_session_id,
                        representative_card_id,
                        correct_value,
                        int(answer['response_time_ms'] or 0),
                    ],
                ).fetchone()
                insert_type4_result_item(
                    conn,
                    int(result_row[0]),
                    pending_item,
                    submitted_answer,
                )

            conn.execute(
                """
                UPDATE sessions
                SET completed_at = ?
                WHERE id = ?
                """,
                [completed_at_utc, continue_source_session_id],
            )
            updated_row = conn.execute(
                """
                SELECT
                    COALESCE(planned_count, 0),
                    COUNT(sr.id) AS answer_count,
                    COALESCE(SUM(CASE WHEN sr.correct > 0 THEN 1 ELSE 0 END), 0) AS right_count,
                    COALESCE(SUM(CASE WHEN sr.correct < 0 THEN 1 ELSE 0 END), 0) AS wrong_count
                FROM sessions s
                LEFT JOIN session_results sr ON sr.session_id = s.id
                WHERE s.id = ?
                GROUP BY s.id, s.planned_count
                """,
                [continue_source_session_id],
            ).fetchone()
            updated_planned_count = max(0, int(updated_row[0] or 0)) if updated_row else source_planned_count
            updated_answer_count = max(0, int(updated_row[1] or 0)) if updated_row else (source_answer_count + len(normalized_answers))
            updated_right_count = max(0, int(updated_row[2] or 0)) if updated_row else (source_right_count + right_count)
            updated_wrong_count = max(0, int(updated_row[3] or 0)) if updated_row else (source_wrong_count + wrong_count)
            target_answer_count = max(updated_planned_count, updated_answer_count, updated_right_count + updated_wrong_count)
            is_incomplete = updated_planned_count > 0 and updated_answer_count < updated_planned_count
            total_correct_percentage = (
                float(updated_answer_count) * 100.0 / float(max(1, target_answer_count))
                if is_incomplete
                else float(updated_right_count) * 100.0 / float(max(1, target_answer_count))
            )
            achieved_gold_star = (not is_incomplete) and total_correct_percentage >= 100.0
            star_tier = 'half_silver' if is_incomplete else 'gold'
            attempt_star_tiers = ['half_silver'] if is_incomplete else ['gold']

            conn.execute("COMMIT")
            conn.close()
            sync_badges_after_session_complete(kid)
            return {
                'session_id': int(continue_source_session_id),
                'answer_count': int(updated_answer_count),
                'planned_count': int(updated_planned_count),
                'right_count': int(updated_right_count),
                'wrong_count': int(updated_wrong_count),
                'completed': True,
                'is_continue_session': True,
                'continue_source_session_id': int(continue_source_session_id),
                'is_retry_session': False,
                'retry_source_session_id': None,
                'retry_count': 0,
                'retry_total_response_ms': 0,
                'retry_best_rety_correct_count': 0,
                'target_answer_count': int(target_answer_count),
                'attempt_count_today_for_chain': 1,
                'attempt_star_tiers': attempt_star_tiers,
                'total_correct_percentage': float(total_correct_percentage),
                'achieved_gold_star': bool(achieved_gold_star),
                'star_tier': star_tier,
            }, 200

        right_count = 0
        wrong_count = 0
        session_id = conn.execute(
            """
            INSERT INTO sessions (type, planned_count, retry_count, retry_total_response_ms, retry_best_rety_correct_count, started_at, completed_at)
            VALUES (?, ?, 0, 0, 0, ?, ?)
            RETURNING id
            """,
            [session_type, planned_count, started_at_utc, completed_at_utc]
        ).fetchone()[0]

        for answer in normalized_answers:
            pending_item = answer['pending_item']
            representative_card_id = int(pending_item.get('representative_card_id') or 0)
            if representative_card_id <= 0:
                raise ValueError('Pending generator item is missing representative card')
            submitted_answer = answer['submitted_answer']
            expected_answer = normalize_type_iv_submitted_answer(pending_item.get('answer'))
            correct_value = (
                SESSION_RESULT_CORRECT
                if submitted_answer == expected_answer
                else SESSION_RESULT_WRONG_UNRESOLVED
            )
            if correct_value > 0:
                right_count += 1
            else:
                wrong_count += 1
            result_row = conn.execute(
                """
                INSERT INTO session_results (session_id, card_id, correct, response_time_ms)
                VALUES (?, ?, ?, ?)
                RETURNING id
                """,
                [
                    session_id,
                    representative_card_id,
                    correct_value,
                    int(answer['response_time_ms'] or 0),
                ],
            ).fetchone()
            insert_type4_result_item(
                conn,
                int(result_row[0]),
                pending_item,
                submitted_answer,
            )

        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        conn.close()
        raise

    conn.close()
    sync_badges_after_session_complete(kid)
    target_answer_count = int(max(planned_count, len(normalized_answers), right_count + wrong_count))
    is_incomplete = planned_count > 0 and len(normalized_answers) < planned_count
    total_correct_percentage = (
        float(len(normalized_answers)) * 100.0 / float(max(1, target_answer_count))
        if is_incomplete
        else float(right_count) * 100.0 / float(max(1, target_answer_count))
    )
    achieved_gold_star = (not is_incomplete) and total_correct_percentage >= 100.0
    star_tier = 'half_silver' if is_incomplete else 'gold'
    attempt_star_tiers = ['half_silver'] if is_incomplete else ['gold']
    return {
        'session_id': session_id,
        'answer_count': len(normalized_answers),
        'planned_count': planned_count,
        'right_count': int(right_count),
        'wrong_count': int(wrong_count),
        'completed': True,
        'is_continue_session': False,
        'continue_source_session_id': None,
        'is_retry_session': False,
        'retry_source_session_id': None,
        'retry_count': 0,
        'retry_total_response_ms': 0,
        'retry_best_rety_correct_count': 0,
        'target_answer_count': target_answer_count,
        'attempt_count_today_for_chain': 1,
        'attempt_star_tiers': attempt_star_tiers,
        'total_correct_percentage': float(total_correct_percentage),
        'achieved_gold_star': bool(achieved_gold_star),
        'star_tier': star_tier,
    }, 200


def start_type_i_practice_session_internal(
    kid_id,
    kid,
    category_key,
    *,
    session_card_count_override=None,
    include_orphan_in_queue_override=None,
    pending_session_payload_extras=None,
    include_category_key_in_response=True,
    include_multiple_choice_pool_cards=False,
):
    """Start one merged type-I practice session with optional per-category overrides."""
    conn = get_kid_connection_for(kid)
    try:
        source_decks = get_shared_type_i_merged_source_decks_for_kid(
            conn,
            kid,
            category_key,
            include_orphan_in_queue_override=include_orphan_in_queue_override,
        )
        included_sources = [src for src in source_decks if bool(src.get('included_in_queue'))]
        source_deck_ids = [
            int(src['local_deck_id'])
            for src in included_sources
            if int(src.get('active_card_count') or 0) > 0
        ]
        source_by_deck_id = {int(src['local_deck_id']): src for src in included_sources}
        continue_source_session = get_latest_unfinished_session_for_today(conn, kid, category_key)
        continue_practiced_card_ids = []
        is_continue_session = continue_source_session is not None
        retry_source_session = None
        is_retry_session = False
        if is_continue_session:
            continue_practiced_card_ids = get_session_practiced_card_ids(
                conn,
                continue_source_session['session_id'],
            )
            missing_count = max(
                0,
                int(continue_source_session['planned_count']) - int(continue_source_session['answer_count']),
            )
            continue_cards = build_continue_selected_cards_for_decks(
                conn,
                kid,
                source_deck_ids,
                category_key,
                missing_count,
                excluded_card_ids=continue_practiced_card_ids,
            )
            selected_cards = []
            for card in continue_cards:
                local_deck_id = int(card.get('deck_id') or 0)
                src = source_by_deck_id.get(local_deck_id) or {}
                selected_cards.append({
                    **card,
                    'shared_deck_id': int(src['shared_deck_id']) if src.get('shared_deck_id') is not None else None,
                    'deck_id': local_deck_id,
                    'deck_name': str(src.get('local_name') or ''),
                    'source_tags': extract_shared_deck_tags_and_labels(src.get('tags') or [])[0],
                    'source_is_orphan': bool(src.get('is_orphan')),
                })
        else:
            retry_source_session = get_latest_retry_source_session_for_today(conn, kid, category_key)
            is_retry_session = retry_source_session is not None
        if is_continue_session:
            pass
        elif is_retry_session:
            retry_wrong_card_ids = get_retry_source_wrong_card_ids(
                conn,
                retry_source_session['session_id'],
            )
            selected_cards = build_retry_selected_cards_for_sources(
                conn,
                source_by_deck_id,
                retry_wrong_card_ids,
            )
        else:
            preview_kid = with_preview_session_count_for_category(
                kid,
                category_key,
                (
                    int(session_card_count_override)
                    if session_card_count_override is not None
                    else get_category_session_card_count_for_kid(kid, category_key)
                ),
            )
            cards_by_id, selected_ids = plan_deck_practice_selection_for_decks(
                conn,
                preview_kid,
                source_deck_ids,
                category_key
            )
            selected_cards = []
            for card_id in selected_ids:
                card = cards_by_id.get(card_id) or {}
                local_deck_id = int(card.get('deck_id') or 0)
                src = source_by_deck_id.get(local_deck_id) or {}
                selected_cards.append({
                    **card,
                    'shared_deck_id': int(src['shared_deck_id']) if src.get('shared_deck_id') is not None else None,
                    'deck_id': local_deck_id,
                    'deck_name': str(src.get('local_name') or ''),
                    'source_tags': extract_shared_deck_tags_and_labels(src.get('tags') or [])[0],
                    'source_is_orphan': bool(src.get('is_orphan')),
                })

        if len(selected_cards) == 0:
            payload = {'pending_session_id': None, 'cards': [], 'planned_count': 0}
            if include_category_key_in_response:
                payload['category_key'] = category_key
            payload['is_continue_session'] = bool(is_continue_session)
            payload['continue_source_session_id'] = (
                int(continue_source_session['session_id'])
                if is_continue_session and continue_source_session is not None
                else None
            )
            payload['is_retry_session'] = bool(is_retry_session)
            payload['retry_source_session_id'] = (
                int(retry_source_session['session_id'])
                if is_retry_session and retry_source_session is not None
                else None
            )
            return payload, 200

        multiple_choice_pool_cards = []
        if include_multiple_choice_pool_cards and (is_continue_session or is_retry_session):
            source_session_card_ids = []
            if is_continue_session and continue_source_session is not None:
                selected_card_ids = [int(card.get('id') or 0) for card in selected_cards]
                source_session_card_ids = [
                    card_id
                    for card_id in [*continue_practiced_card_ids, *selected_card_ids]
                    if int(card_id or 0) > 0
                ]
            elif is_retry_session and retry_source_session is not None:
                source_session_card_ids = get_session_practiced_card_ids(
                    conn,
                    retry_source_session['session_id'],
                )
            multiple_choice_pool_cards = build_type_i_multiple_choice_pool_cards(
                conn,
                source_by_deck_id,
                source_session_card_ids,
            )

        pending_session_payload = {
            'kind': category_key,
            'planned_count': len(selected_cards),
            'cards': [{'id': int(card['id'])} for card in selected_cards],
        }
        if is_continue_session and continue_source_session is not None:
            pending_session_payload[PENDING_CONTINUE_SOURCE_SESSION_ID_KEY] = int(continue_source_session['session_id'])
        if is_retry_session and retry_source_session is not None:
            pending_session_payload[PENDING_RETRY_SOURCE_SESSION_ID_KEY] = int(retry_source_session['session_id'])
        if isinstance(pending_session_payload_extras, dict):
            pending_session_payload.update(pending_session_payload_extras)

        pending_session_id = create_pending_session(
            kid_id,
            category_key,
            pending_session_payload
        )
    finally:
        conn.close()

    payload = {
        'pending_session_id': pending_session_id,
        'planned_count': len(selected_cards),
        'cards': selected_cards,
        'is_continue_session': bool(is_continue_session),
        'continue_source_session_id': (
            int(continue_source_session['session_id'])
            if is_continue_session and continue_source_session is not None
            else None
        ),
        'is_retry_session': bool(is_retry_session),
        'retry_source_session_id': (
            int(retry_source_session['session_id'])
            if is_retry_session and retry_source_session is not None
            else None
        ),
    }
    if include_multiple_choice_pool_cards:
        payload['multiple_choice_pool_cards'] = multiple_choice_pool_cards
    if include_category_key_in_response:
        payload['category_key'] = category_key
    return payload, 200


SHARED_DECK_SCOPE_TYPE1 = 'cards'
SHARED_DECK_SCOPE_TYPE3 = 'lesson-reading'
SHARED_DECK_SCOPE_TYPE2 = 'type2'
SHARED_DECK_SCOPE_TYPE4 = 'type4'

SHARED_DECK_OP_GET = 'shared_decks_get'
SHARED_DECK_OP_OPT_IN = 'shared_decks_opt_in'
SHARED_DECK_OP_OPT_OUT = 'shared_decks_opt_out'
SHARED_DECK_OP_GET_CARDS = 'shared_decks_get_cards'
SHARED_DECK_OP_SKIP_UPDATE = 'shared_decks_skip_update'
SHARED_DECK_OP_SKIP_UPDATE_BULK = 'shared_decks_skip_update_bulk'
SHARED_DECK_OP_GET_DECKS = 'decks_get'

CATEGORY_CONFIG = {}


def normalize_shared_deck_scope(raw_scope):
    """Normalize one shared-deck route scope segment."""
    return str(raw_scope or '').strip().lower().replace('_', '-')


def get_shared_deck_category_config(raw_scope):
    """Resolve one shared-deck scope to category config."""
    scope = normalize_shared_deck_scope(raw_scope)
    if not scope:
        return None
    return CATEGORY_CONFIG.get(scope)


def dispatch_shared_deck_scope_operation(scope, operation, kid_id, card_id=None):
    """Dispatch one shared-deck route operation by scope."""
    category = get_shared_deck_category_config(scope)
    if category is None:
        return jsonify({'error': 'Unknown shared-deck scope'}), 404
    return run_shared_deck_scope_operation(operation, kid_id, category, card_id=card_id)


@kids_bp.route('/kids/<kid_id>/<scope>/shared-decks', methods=['GET'])
def get_kid_shared_decks_by_scope(kid_id, scope):
    """Get shared decks for one category scope."""
    return dispatch_shared_deck_scope_operation(scope, SHARED_DECK_OP_GET, kid_id)


@kids_bp.route('/kids/<kid_id>/<scope>/shared-decks/opt-in', methods=['POST'])
def opt_in_kid_shared_decks_by_scope(kid_id, scope):
    """Opt-in shared decks for one category scope."""
    return dispatch_shared_deck_scope_operation(scope, SHARED_DECK_OP_OPT_IN, kid_id)


@kids_bp.route('/kids/<kid_id>/<scope>/shared-decks/opt-out', methods=['POST'])
def opt_out_kid_shared_decks_by_scope(kid_id, scope):
    """Opt-out shared decks for one category scope."""
    return dispatch_shared_deck_scope_operation(scope, SHARED_DECK_OP_OPT_OUT, kid_id)


@kids_bp.route('/kids/<kid_id>/<scope>/shared-decks/cards', methods=['GET'])
def get_kid_shared_deck_cards_by_scope(kid_id, scope):
    """Get merged shared deck cards for one category scope."""
    return dispatch_shared_deck_scope_operation(scope, SHARED_DECK_OP_GET_CARDS, kid_id)


@kids_bp.route('/kids/<kid_id>/<scope>/shared-decks/cards/<card_id>/skip', methods=['PUT'])
def update_kid_shared_deck_card_skip_by_scope(kid_id, scope, card_id):
    """Update shared-deck card skip status for one category scope."""
    return dispatch_shared_deck_scope_operation(scope, SHARED_DECK_OP_SKIP_UPDATE, kid_id, card_id=card_id)


@kids_bp.route('/kids/<kid_id>/<scope>/shared-decks/cards/skip-bulk', methods=['PUT'])
def update_kid_shared_deck_card_skip_bulk_by_scope(kid_id, scope):
    """Bulk update shared-deck card skip status for one category scope."""
    return dispatch_shared_deck_scope_operation(scope, SHARED_DECK_OP_SKIP_UPDATE_BULK, kid_id)


@kids_bp.route('/kids/<kid_id>/<scope>/decks', methods=['GET'])
def get_kid_decks_by_scope(kid_id, scope):
    """Get practice readiness deck summary for one category scope."""
    return dispatch_shared_deck_scope_operation(scope, SHARED_DECK_OP_GET_DECKS, kid_id)


def get_shared_type1_cards(kid_id):
    """Get merged cards across opted-in type-I decks and orphan deck."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        category_key, _ = resolve_kid_type_i_category_with_mode(
            kid,
            request.args.get('categoryKey'),
        )
        preview_hard_pct = parse_optional_hard_card_percentage_arg()
        return jsonify(
            build_type_i_shared_cards_payload(
                kid,
                category_key,
                preview_hard_pct,
            )
        ), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def parse_shared_card_skip_update_request(card_id):
    """Parse shared-card skip update payload and return (card_id_int, skipped)."""
    try:
        card_id_int = int(card_id)
    except (TypeError, ValueError):
        raise ValueError('Invalid card id') from None

    payload = request.get_json() or {}
    if 'skipped' not in payload or not isinstance(payload.get('skipped'), bool):
        raise ValueError('skipped must be a boolean')
    skipped = bool(payload.get('skipped'))
    return card_id_int, skipped


def parse_shared_card_skip_bulk_update_request():
    """Parse shared-card bulk skip update payload and return (card_ids, skipped)."""
    payload = request.get_json() or {}
    raw_card_ids = payload.get('card_ids')
    if raw_card_ids is None:
        raw_card_ids = payload.get('cardIds')
    if not isinstance(raw_card_ids, list) or not raw_card_ids:
        raise ValueError('card_ids must be a non-empty list')
    if len(raw_card_ids) > 2000:
        raise ValueError('card_ids list is too large')
    card_ids = []
    seen = set()
    for raw_id in raw_card_ids:
        try:
            card_id_int = int(raw_id)
        except (TypeError, ValueError):
            raise ValueError('card_ids must contain integers') from None
        if card_id_int in seen:
            continue
        seen.add(card_id_int)
        card_ids.append(card_id_int)
    if not card_ids:
        raise ValueError('card_ids must contain at least one valid id')
    if 'skipped' not in payload or not isinstance(payload.get('skipped'), bool):
        raise ValueError('skipped must be a boolean')
    skipped = bool(payload.get('skipped'))
    return card_ids, skipped


def update_shared_card_skip_internal(kid, card_id_int, skipped, *, category_key, orphan_deck_name, deck_label):
    """Toggle skip status for one shared/materialized/orphan card for one category."""
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
            return {'error': 'Card not found'}, 404

        local_deck_name = str(card_row[2] or '')
        local_deck_tags = extract_shared_deck_tags_and_labels(card_row[3])[0]
        is_materialized_shared = parse_shared_deck_id_from_materialized_name(local_deck_name) is not None
        is_orphan = local_deck_name == str(orphan_deck_name or '')
        if is_materialized_shared and str(category_key or '') not in local_deck_tags:
            return {'error': f'Card does not belong to a shared {deck_label} deck'}, 400
        if not is_materialized_shared and not is_orphan:
            return {'error': f'Card does not belong to a shared {deck_label} or orphan deck'}, 400

        conn.execute(
            "UPDATE cards SET skip_practice = ? WHERE id = ?",
            [bool(skipped), card_id_int]
        )
    finally:
        conn.close()

    return {
        'id': card_id_int,
        'skip_practice': bool(skipped),
    }, 200


def update_shared_cards_skip_bulk_internal(kid, card_ids, skipped, *, category_key, orphan_deck_name, deck_label):
    """Toggle skip status for many shared/materialized/orphan cards for one category."""
    unique_card_ids = []
    seen = set()
    for raw_id in card_ids or []:
        card_id_int = int(raw_id)
        if card_id_int in seen:
            continue
        seen.add(card_id_int)
        unique_card_ids.append(card_id_int)
    if not unique_card_ids:
        return {'error': 'No card ids provided'}, 400

    conn = get_kid_connection_for(kid)
    try:
        placeholders = ','.join(['?'] * len(unique_card_ids))
        card_rows = conn.execute(
            f"""
            SELECT c.id, c.deck_id, d.name, d.tags
            FROM cards c
            JOIN decks d ON d.id = c.deck_id
            WHERE c.id IN ({placeholders})
            """,
            unique_card_ids
        ).fetchall()
        row_by_id = {int(row[0]): row for row in card_rows}
        missing_ids = [card_id for card_id in unique_card_ids if card_id not in row_by_id]
        if missing_ids:
            return {'error': f'Card not found: {missing_ids[0]}'}, 404

        for card_id in unique_card_ids:
            row = row_by_id[card_id]
            local_deck_name = str(row[2] or '')
            local_deck_tags = extract_shared_deck_tags_and_labels(row[3])[0]
            is_materialized_shared = parse_shared_deck_id_from_materialized_name(local_deck_name) is not None
            is_orphan = local_deck_name == str(orphan_deck_name or '')
            if is_materialized_shared and str(category_key or '') not in local_deck_tags:
                return {'error': f'Card does not belong to a shared {deck_label} deck'}, 400
            if not is_materialized_shared and not is_orphan:
                return {'error': f'Card does not belong to a shared {deck_label} or orphan deck'}, 400

        conn.execute(
            f"UPDATE cards SET skip_practice = ? WHERE id IN ({placeholders})",
            [bool(skipped), *unique_card_ids]
        )
    finally:
        conn.close()

    return {
        'updated_count': len(unique_card_ids),
        'skip_practice': bool(skipped),
    }, 200


def parse_shared_deck_ids_from_request_payload(payload):
    """Parse shared deck ids from either deck_ids or deckIds payload key."""
    data = payload if isinstance(payload, dict) else {}
    raw_ids = data.get('deck_ids')
    if raw_ids is None:
        raw_ids = data.get('deckIds')
    return normalize_shared_deck_ids(raw_ids)


def build_merged_source_decks_payload(sources, configured_count, include_orphan_in_queue):
    """Build merged-source readiness payload used by shared deck categories."""
    included_sources = [src for src in sources if bool(src.get('included_in_queue'))]
    total_active_cards = sum(int(src.get('active_card_count') or 0) for src in included_sources)
    total_session_count = min(int(configured_count), total_active_cards)
    decks = [{
        'key': ('orphan' if src.get('is_orphan') else f"shared_{src['shared_deck_id']}"),
        'label': str(src.get('local_name') or ''),
        'deck_id': int(src['local_deck_id']),
        'shared_deck_id': int(src['shared_deck_id']) if src.get('shared_deck_id') is not None else None,
        'total_cards': int(src.get('active_card_count') or 0),
        'session_count': int(total_session_count) if bool(src.get('included_in_queue')) and int(src.get('active_card_count') or 0) > 0 else 0,
        'included_in_queue': bool(src.get('included_in_queue')),
        'is_orphan': bool(src.get('is_orphan')),
    } for src in sources]
    return {
        'decks': decks,
        'total_session_count': total_session_count,
        'configured_session_count': int(configured_count),
        'total_active_cards': total_active_cards,
        'include_orphan_in_queue': bool(include_orphan_in_queue),
    }


def build_orphan_deck_payload(conn, orphan_deck_id, default_orphan_name):
    """Build one orphan deck summary payload."""
    orphan_row = conn.execute(
        "SELECT id, name, COALESCE(daily_target_count, 0) FROM decks WHERE id = ? LIMIT 1",
        [orphan_deck_id]
    ).fetchone()
    orphan_name = str(orphan_row[1] or default_orphan_name) if orphan_row else str(default_orphan_name)
    orphan_daily_target_count = int(orphan_row[2] or 0) if orphan_row and len(orphan_row) >= 3 else 0
    orphan_total = int(conn.execute(
        "SELECT COUNT(*) FROM cards WHERE deck_id = ?",
        [orphan_deck_id]
    ).fetchone()[0] or 0)
    orphan_active = int(conn.execute(
        "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = FALSE",
        [orphan_deck_id]
    ).fetchone()[0] or 0)
    orphan_skipped = int(conn.execute(
        "SELECT COUNT(*) FROM cards WHERE deck_id = ? AND COALESCE(skip_practice, FALSE) = TRUE",
        [orphan_deck_id]
    ).fetchone()[0] or 0)
    return {
        'deck_id': orphan_deck_id,
        'name': orphan_name,
        'card_count': orphan_total,
        'active_card_count': orphan_active,
        'skipped_card_count': orphan_skipped,
        'daily_target_count': orphan_daily_target_count,
    }


def build_shared_decks_listing_payload(
    kid,
    *,
    first_tag,
    orphan_deck_name,
    get_shared_decks_fn,
    get_materialized_decks_fn,
    session_card_count,
    include_orphan_in_queue,
):
    """Build shared deck listing payload for type-II/type-III categories."""
    shared_conn = None
    kid_conn = None
    orphan_deck_payload = None
    local_by_shared_id = {}
    local_card_count_by_deck_id = {}
    try:
        shared_conn = get_shared_decks_connection()
        decks = get_shared_decks_fn(shared_conn)

        kid_conn = get_kid_connection_for(kid)
        materialized_by_local_id = get_materialized_decks_fn(kid_conn)
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

        orphan_deck_id = get_or_create_orphan_deck(
            kid_conn,
            orphan_deck_name,
            first_tag,
        )
        orphan_deck_payload = build_orphan_deck_payload(kid_conn, orphan_deck_id, orphan_deck_name)
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
        materialized_deck_id = int(local_entry['local_deck_id']) if local_entry else None
        shared_card_count = int(deck.get('card_count') or 0)
        materialized_card_count = (
            int(local_card_count_by_deck_id.get(materialized_deck_id, 0))
            if materialized_deck_id is not None
            else None
        )
        deck['materialized_name'] = (
            str(local_entry['local_name'])
            if local_entry
            else build_materialized_shared_deck_name(deck['deck_id'], deck['name'])
        )
        deck['opted_in'] = local_entry is not None
        deck['materialized_deck_id'] = materialized_deck_id
        deck['shared_card_count'] = shared_card_count
        deck['materialized_card_count'] = materialized_card_count
        deck['has_update_warning'] = bool(
            local_entry is not None
            and materialized_card_count is not None
            and materialized_card_count != shared_card_count
        )
        deck['update_warning_reason'] = (
            'count_mismatch'
            if bool(deck['has_update_warning'])
            else ''
        )
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
            'tags': extract_shared_deck_tags_and_labels(local_entry.get('tags') or [])[0],
            'tag_labels': [str(tag) for tag in list(local_entry.get('tag_labels') or []) if str(tag or '').strip()],
            'creator_family_id': None,
            'created_at': None,
            'card_count': int(local_card_count_by_deck_id.get(local_deck_id, 0)),
            'materialized_name': local_name,
            'opted_in': True,
            'materialized_deck_id': local_deck_id,
            'shared_card_count': None,
            'materialized_card_count': int(local_card_count_by_deck_id.get(local_deck_id, 0)),
            'has_update_warning': True,
            'update_warning_reason': 'source_deleted',
            'mix_percent': 0,
            'session_cards': 0,
            'source_deleted': True,
        })

    if orphan_deck_payload is not None:
        orphan_deck_payload['included_in_queue'] = bool(include_orphan_in_queue)
    return {
        'decks': decks,
        'deck_count': len(decks),
        'session_card_count': int(session_card_count),
        'include_orphan_in_queue': bool(include_orphan_in_queue),
        'orphan_deck': orphan_deck_payload,
    }


def opt_in_shared_decks_internal(
    kid,
    deck_ids,
    *,
    first_tag,
    orphan_deck_name,
    get_materialized_decks_fn,
    unique_key_field,
):
    """Materialize shared decks into kid DB for type-II/type-III categories."""
    shared_conn = None
    kid_conn = None
    try:
        shared_conn = get_shared_decks_connection()
        shared_by_id, missing_ids = _fetch_shared_decks_by_ids(shared_conn, deck_ids)
        if missing_ids:
            return {
                'error': f'Shared deck(s) not found: {", ".join(str(v) for v in missing_ids)}'
            }, 404

        placeholders = ','.join(['?'] * len(deck_ids))
        invalid_tag_ids = [
            deck_id for deck_id in deck_ids
            if first_tag not in shared_by_id[deck_id]['tags']
        ]
        if invalid_tag_ids:
            return {
                'error': f'Deck(s) are not {first_tag}-tagged: {", ".join(str(v) for v in invalid_tag_ids)}'
            }, 400

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
        existing_materialized = get_materialized_decks_fn(kid_conn)
        occupied_deck_ids = list(existing_materialized.keys())
        occupied_values = (
            get_kid_card_fronts_for_deck_ids(kid_conn, occupied_deck_ids)
            if unique_key_field == 'front'
            else get_kid_card_backs_for_deck_ids(kid_conn, occupied_deck_ids)
        )
        orphan_deck_id = get_or_create_orphan_deck(
            kid_conn,
            orphan_deck_name,
            first_tag,
        )

        created = []
        already_opted_in = []
        skipped_existing_key = f'cards_skipped_existing_{unique_key_field}'
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
            inserted = kid_conn.execute(
                """
                INSERT INTO decks (name, tags)
                VALUES (?, ?)
                RETURNING id
                """,
                [materialized_name, materialized_tags]
            ).fetchone()
            local_deck_id = int(inserted[0])

            cards = cards_by_deck_id.get(src_deck_id, [])
            cards_added = 0
            cards_moved_from_orphan = 0
            cards_skipped_existing = 0
            if cards:
                source_keys = []
                seen_keys = set()
                source_front_by_back = {}
                for card in cards:
                    front = str(card.get('front') or '')
                    back = str(card.get('back') or '')
                    key_value = front if unique_key_field == 'front' else back
                    if not key_value or key_value in seen_keys:
                        continue
                    seen_keys.add(key_value)
                    source_keys.append(key_value)
                    if unique_key_field == 'back':
                        source_front_by_back[key_value] = front

                orphan_by_key = {}
                if source_keys:
                    key_placeholders = ','.join(['?'] * len(source_keys))
                    orphan_rows = kid_conn.execute(
                        f"""
                        SELECT id, front, back, skip_practice, hardness_score, created_at
                        FROM cards
                        WHERE deck_id = ?
                          AND {unique_key_field} IN ({key_placeholders})
                        ORDER BY id ASC
                        """,
                        [orphan_deck_id, *source_keys]
                    ).fetchall()
                    for row in orphan_rows:
                        row_key = str(row[1] or '') if unique_key_field == 'front' else str(row[2] or '')
                        if row_key in orphan_by_key:
                            continue
                        orphan_by_key[row_key] = row

                moved_rows = []
                insert_rows = []
                for card in cards:
                    front = str(card.get('front') or '')
                    back = str(card.get('back') or '')
                    key_value = front if unique_key_field == 'front' else back
                    if not key_value:
                        continue
                    if key_value in occupied_values:
                        cards_skipped_existing += 1
                        continue

                    orphan_row = orphan_by_key.pop(key_value, None)
                    if orphan_row is not None:
                        if unique_key_field == 'back':
                            orphan_front = str(orphan_row[1] or '')
                            orphan_back = str(orphan_row[2] or '')
                            source_front = str(source_front_by_back.get(key_value) or '')
                            resolved_front = orphan_front if orphan_front != orphan_back else (source_front or orphan_back)
                            moved_rows.append(
                                (
                                    int(orphan_row[0]),
                                    resolved_front,
                                    orphan_back,
                                    bool(orphan_row[3]),
                                    float(orphan_row[4] or 0.0),
                                    orphan_row[5],
                                )
                            )
                        else:
                            moved_rows.append(orphan_row)
                        occupied_values.add(key_value)
                        continue

                    insert_rows.append([local_deck_id, front, back])
                    occupied_values.add(key_value)

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

            created_item = {
                'shared_deck_id': src_deck_id,
                'shared_name': src_deck['name'],
                'materialized_name': materialized_name,
                'deck_id': local_deck_id,
                'cards_added': cards_added,
                'cards_moved_from_orphan': cards_moved_from_orphan,
                'cards_total': len(cards),
            }
            created_item[skipped_existing_key] = cards_skipped_existing
            created.append(created_item)
    finally:
        if kid_conn is not None:
            kid_conn.close()
        if shared_conn is not None:
            shared_conn.close()

    return {
        'requested_count': len(deck_ids),
        'created_count': len(created),
        'already_opted_in_count': len(already_opted_in),
        'created': created,
        'already_opted_in': already_opted_in,
    }, 200


def delete_shared_deck_related_rows(conn, card_ids, *, delete_type3_audio):
    """Delete rows related to selected card ids when opt-out removes cards."""
    if not card_ids:
        return
    placeholders = ','.join(['?'] * len(card_ids))
    conn.execute(
        f"DELETE FROM writing_sheet_cards WHERE card_id IN ({placeholders})",
        card_ids
    )
    if delete_type3_audio:
        conn.execute(
            f"""
            DELETE FROM lesson_reading_audio
            WHERE result_id IN (
                SELECT id FROM session_results WHERE card_id IN ({placeholders})
            )
            """,
            card_ids
        )
    conn.execute(
        f"DELETE FROM session_results WHERE card_id IN ({placeholders})",
        card_ids
    )


def opt_out_shared_decks_internal(
    kid,
    deck_ids,
    *,
    first_tag,
    orphan_deck_name,
    get_materialized_decks_fn,
    delete_type3_audio,
):
    """Opt out shared decks for type-II/type-III categories."""
    kid_conn = None
    try:
        kid_conn = get_kid_connection_for(kid)
        materialized_by_local_id = get_materialized_decks_fn(kid_conn)
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
                already_opted_out.append({'shared_deck_id': int(shared_deck_id)})
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
                    f"SELECT DISTINCT card_id FROM session_results WHERE card_id IN ({placeholders})",
                    card_ids
                ).fetchall()
                practiced_card_ids = [int(row[0]) for row in practiced_rows]
            had_practice_sessions = len(practiced_card_ids) > 0

            if had_practice_sessions:
                orphan_deck_id = get_or_create_orphan_deck(
                    kid_conn,
                    orphan_deck_name,
                    first_tag,
                )
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
                unpracticed_ids = [card_id for card_id in card_ids if card_id not in practiced_card_id_set]
                if unpracticed_ids:
                    delete_shared_deck_related_rows(
                        kid_conn,
                        unpracticed_ids,
                        delete_type3_audio=delete_type3_audio,
                    )
                    unpracticed_placeholders = ','.join(['?'] * len(unpracticed_ids))
                    kid_conn.execute(
                        f"DELETE FROM cards WHERE id IN ({unpracticed_placeholders})",
                        unpracticed_ids
                    )
            else:
                delete_shared_deck_related_rows(
                    kid_conn,
                    card_ids,
                    delete_type3_audio=delete_type3_audio,
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

    return {
        'requested_count': len(deck_ids),
        'removed_count': len(removed),
        'already_opted_out_count': len(already_opted_out),
        'removed': removed,
        'already_opted_out': already_opted_out,
    }, 200


def resolve_type2_scope_context(kid, raw_category_key):
    """Resolve per-request type-II scope settings for shared deck operations."""
    category_key, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
        kid,
        raw_category_key,
    )
    return {
        'category_key': category_key,
        'has_chinese_specific_logic': bool(has_chinese_specific_logic),
        'first_tag': category_key,
        'orphan_deck_name': get_category_orphan_deck_name(category_key),
        'unique_key_field': 'back' if has_chinese_specific_logic else 'front',
        'include_orphan_in_queue': get_category_include_orphan_for_kid(kid, category_key),
    }


SHARED_SCOPE_MANAGEMENT_TYPE_I = 'type_i'
SHARED_SCOPE_MANAGEMENT_TYPE_II = 'type_ii'
SHARED_SCOPE_MANAGEMENT_TYPE_IV = 'type_iv'


def resolve_shared_scope_management_context(kid, category, raw_category_key):
    """Resolve one shared-scope request into normalized management context."""
    if str(category.get('kind') or '') == 'type4':
        category_key, has_chinese_specific_logic = resolve_kid_type_iv_category_with_mode(
            kid,
            raw_category_key,
        )
        return {
            'management_type': SHARED_SCOPE_MANAGEMENT_TYPE_IV,
            'category_key': category_key,
            'has_chinese_specific_logic': bool(has_chinese_specific_logic),
            'include_orphan_in_queue': get_category_include_orphan_for_kid(kid, category_key),
            'orphan_deck_name': get_category_orphan_deck_name(category_key),
        }
    if str(category.get('kind') or '') == 'type1':
        category_key, has_chinese_specific_logic = resolve_kid_type_i_category_with_mode(
            kid,
            raw_category_key,
        )
        return {
            'management_type': SHARED_SCOPE_MANAGEMENT_TYPE_I,
            'category_key': category_key,
            'has_chinese_specific_logic': bool(has_chinese_specific_logic),
            'include_orphan_in_queue': get_category_include_orphan_for_kid(kid, category_key),
            'orphan_deck_name': get_category_orphan_deck_name(category_key),
        }
    if bool(category.get('use_type_i_card_management')):
        category_key, _ = resolve_kid_type_iii_category_with_mode(
            kid,
            raw_category_key,
        )
        return {
            'management_type': SHARED_SCOPE_MANAGEMENT_TYPE_I,
            'category_key': category_key,
            'has_chinese_specific_logic': False,
            'include_orphan_in_queue': get_category_include_orphan_for_kid(kid, category_key),
            'orphan_deck_name': get_category_orphan_deck_name(category_key),
        }
    if bool(category.get('use_type_ii_card_management')):
        return {
            'management_type': SHARED_SCOPE_MANAGEMENT_TYPE_II,
            **resolve_type2_scope_context(kid, raw_category_key),
        }
    raise ValueError('Unsupported shared-deck operation for scope')


def get_shared_decks_for_scope(kid_id, category):
    """Handle shared-decks listing by scope config."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        scope_context = resolve_shared_scope_management_context(
            kid,
            category,
            request.args.get('categoryKey'),
        )
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_I:
            payload = build_type_i_shared_decks_payload(
                kid,
                scope_context['category_key'],
                session_card_count_override=get_category_session_card_count_for_kid(
                    kid,
                    scope_context['category_key'],
                ),
                include_orphan_in_queue_override=scope_context['include_orphan_in_queue'],
                include_category_key=True,
            )
            return jsonify(payload), 200
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_IV:
            payload = build_type_iv_shared_decks_payload(
                kid,
                scope_context['category_key'],
                include_category_key=True,
                include_orphan_in_queue_override=scope_context['include_orphan_in_queue'],
            )
            return jsonify(payload), 200
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_II:
            payload = build_shared_decks_listing_payload(
                kid,
                first_tag=scope_context['first_tag'],
                orphan_deck_name=scope_context['orphan_deck_name'],
                get_shared_decks_fn=lambda conn: get_shared_type_ii_deck_rows(
                    conn,
                    scope_context['category_key'],
                ),
                get_materialized_decks_fn=lambda conn: get_kid_materialized_shared_type_ii_decks(
                    conn,
                    scope_context['category_key'],
                ),
                session_card_count=get_category_session_card_count_for_kid(
                    kid,
                    scope_context['category_key'],
                ),
                include_orphan_in_queue=scope_context['include_orphan_in_queue'],
            )
            payload['category_key'] = scope_context['category_key']
            payload['has_chinese_specific_logic'] = scope_context['has_chinese_specific_logic']
            return jsonify(payload), 200

        return jsonify({'error': 'Unsupported shared-deck operation for scope'}), 404
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def opt_in_shared_decks_for_scope(kid_id, category):
    """Handle shared-decks opt-in by scope config."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        req_payload = request.get_json() or {}
        scope_context = resolve_shared_scope_management_context(
            kid,
            category,
            req_payload.get('categoryKey') or request.args.get('categoryKey'),
        )
        deck_ids = parse_shared_deck_ids_from_request_payload(req_payload)
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_I:
            payload, status_code = opt_in_type_i_shared_decks(
                kid,
                scope_context['category_key'],
                deck_ids,
                scope_context['has_chinese_specific_logic'],
            )
            return jsonify(payload), status_code
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_IV:
            payload, status_code = opt_in_type_iv_shared_decks(
                kid,
                scope_context['category_key'],
                deck_ids,
            )
            return jsonify(payload), status_code
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_II:
            payload, status_code = opt_in_shared_decks_internal(
                kid,
                deck_ids,
                first_tag=scope_context['first_tag'],
                orphan_deck_name=scope_context['orphan_deck_name'],
                get_materialized_decks_fn=lambda conn: get_kid_materialized_shared_type_ii_decks(
                    conn,
                    scope_context['category_key'],
                ),
                unique_key_field=scope_context['unique_key_field'],
            )
            return jsonify(payload), status_code

        return jsonify({'error': 'Unsupported shared-deck operation for scope'}), 404
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def opt_out_shared_decks_for_scope(kid_id, category):
    """Handle shared-decks opt-out by scope config."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        req_payload = request.get_json() or {}
        scope_context = resolve_shared_scope_management_context(
            kid,
            category,
            req_payload.get('categoryKey') or request.args.get('categoryKey'),
        )
        deck_ids = parse_shared_deck_ids_from_request_payload(req_payload)
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_I:
            return jsonify(
                opt_out_type_i_shared_decks(
                    kid,
                    scope_context['category_key'],
                    deck_ids,
                )
            ), 200
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_IV:
            payload, status_code = opt_out_type_iv_shared_decks(
                kid,
                scope_context['category_key'],
                deck_ids,
            )
            return jsonify(payload), status_code
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_II:
            payload, status_code = opt_out_shared_decks_internal(
                kid,
                deck_ids,
                first_tag=scope_context['first_tag'],
                orphan_deck_name=scope_context['orphan_deck_name'],
                get_materialized_decks_fn=lambda conn: get_kid_materialized_shared_type_ii_decks(
                    conn,
                    scope_context['category_key'],
                ),
                delete_type3_audio=False,
            )
            return jsonify(payload), status_code

        return jsonify({'error': 'Unsupported shared-deck operation for scope'}), 404
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def get_shared_cards_for_scope(kid_id, category):
    """Handle shared-decks cards listing by scope config."""
    cards_handler = category.get('cards_handler')
    if not callable(cards_handler):
        return jsonify({'error': 'Unsupported shared-deck operation for scope'}), 404
    return cards_handler(kid_id)


def update_shared_card_skip_for_scope(kid_id, category, card_id):
    """Handle shared card skip updates by scope config."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        card_id_int, skipped = parse_shared_card_skip_update_request(card_id)
        scope_context = resolve_shared_scope_management_context(
            kid,
            category,
            request.args.get('categoryKey'),
        )
        category_key = scope_context['category_key']
        orphan_deck_name = scope_context['orphan_deck_name']
        deck_label = category_key

        payload, status_code = update_shared_card_skip_internal(
            kid,
            card_id_int,
            skipped,
            category_key=category_key,
            orphan_deck_name=orphan_deck_name,
            deck_label=deck_label,
        )
        return jsonify(payload), status_code
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def get_decks_for_scope(kid_id, category):
    """Handle merged deck readiness summaries by scope config."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        sources = []
        scope_context = resolve_shared_scope_management_context(
            kid,
            category,
            request.args.get('categoryKey'),
        )
        special_ready_payload = {
            'is_continue_session': False,
            'continue_source_session_id': None,
            'continue_card_count': 0,
            'is_retry_session': False,
            'retry_source_session_id': None,
            'retry_card_count': 0,
        }
        if scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_I:
            conn = get_kid_connection_for(kid)
            try:
                sources = get_shared_type_i_merged_source_decks_for_kid(
                    conn,
                    kid,
                    scope_context['category_key'],
                    include_orphan_in_queue_override=scope_context['include_orphan_in_queue'],
                )
                included_sources = [
                    src for src in sources
                    if bool(src.get('included_in_queue')) and int(src.get('active_card_count') or 0) > 0
                ]
                source_deck_ids = [int(src['local_deck_id']) for src in included_sources]
                special_ready_payload = build_special_session_ready_payload(
                    conn,
                    kid,
                    scope_context['category_key'],
                    source_by_deck_id={int(src['local_deck_id']): src for src in included_sources},
                    source_deck_ids=source_deck_ids,
                )
            finally:
                conn.close()
        elif scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_II:
            conn = get_kid_connection_for(kid)
            try:
                sources = get_shared_type_ii_merged_source_decks_for_kid(
                    conn,
                    kid,
                    scope_context['category_key'],
                )
                included_sources = [
                    src for src in sources
                    if bool(src.get('included_in_queue')) and int(src.get('active_card_count') or 0) > 0
                ]
                source_deck_ids = [int(src['local_deck_id']) for src in included_sources]
                pending_card_ids = (
                    get_pending_writing_card_ids(conn)
                    if bool(scope_context.get('has_chinese_specific_logic'))
                    else []
                )
                special_ready_payload = build_special_session_ready_payload(
                    conn,
                    kid,
                    scope_context['category_key'],
                    source_by_deck_id={int(src['local_deck_id']): src for src in included_sources},
                    source_deck_ids=source_deck_ids,
                    excluded_card_ids=pending_card_ids,
                )
            finally:
                conn.close()
        elif scope_context['management_type'] == SHARED_SCOPE_MANAGEMENT_TYPE_IV:
            conn = get_kid_connection_for(kid)
            try:
                practice_sources = get_type_iv_practice_source_rows(
                    conn,
                    kid,
                    scope_context['category_key'],
                    include_orphan_in_queue_override=scope_context['include_orphan_in_queue'],
                )
                special_ready_payload = build_type_iv_special_session_ready_payload(
                    conn,
                    kid,
                    scope_context['category_key'],
                    practice_sources,
                )
            finally:
                conn.close()

            listing_payload = build_type_iv_shared_decks_payload(
                kid,
                scope_context['category_key'],
                include_category_key=True,
                include_orphan_in_queue_override=scope_context['include_orphan_in_queue'],
            )
            readiness_decks = []
            for deck in list(listing_payload.get('decks') or []):
                readiness_decks.append({
                    'key': f"shared_{int(deck.get('deck_id') or 0)}",
                    'label': str(deck.get('representative_front') or deck.get('name') or ''),
                    'deck_id': int(deck.get('materialized_deck_id') or 0),
                    'shared_deck_id': int(deck.get('deck_id') or 0),
                    'total_cards': int(deck.get('card_count') or 0),
                    'session_count': int(deck.get('daily_target_count') or 0) if bool(deck.get('opted_in')) else 0,
                    'included_in_queue': bool(deck.get('opted_in')) and int(deck.get('daily_target_count') or 0) > 0,
                    'is_orphan': False,
                    'opted_in': bool(deck.get('opted_in')),
                    'daily_target_count': int(deck.get('daily_target_count') or 0),
                })
            orphan_payload = listing_payload.get('orphan_deck') if isinstance(listing_payload, dict) else None
            if isinstance(orphan_payload, dict) and int(orphan_payload.get('card_count') or 0) > 0:
                orphan_active_card_count = int(orphan_payload.get('active_card_count') or 0)
                orphan_daily_target_count = int(orphan_payload.get('daily_target_count') or 0)
                orphan_included = bool(scope_context['include_orphan_in_queue'])
                readiness_decks.append({
                    'key': 'orphan',
                    'label': str(orphan_payload.get('name') or scope_context['orphan_deck_name'] or 'Personal Deck'),
                    'deck_id': int(orphan_payload.get('deck_id') or 0),
                    'shared_deck_id': None,
                    'total_cards': orphan_active_card_count,
                    'session_count': (
                        orphan_daily_target_count
                        if orphan_included and orphan_active_card_count > 0
                        else 0
                    ),
                    'included_in_queue': bool(
                        orphan_included and orphan_active_card_count > 0 and orphan_daily_target_count > 0
                    ),
                    'is_orphan': True,
                    'opted_in': bool(orphan_included),
                    'daily_target_count': orphan_daily_target_count,
                })
            total_session_count = int(listing_payload.get('session_card_count') or 0)
            return jsonify({
                'category_key': scope_context['category_key'],
                'decks': readiness_decks,
                'total_session_count': total_session_count,
                'configured_session_count': total_session_count,
                'total_active_cards': sum(int(deck.get('total_cards') or 0) for deck in readiness_decks if bool(deck.get('included_in_queue'))),
                'include_orphan_in_queue': bool(scope_context['include_orphan_in_queue']),
                'has_chinese_specific_logic': False,
                **special_ready_payload,
            }), 200
        else:
            return jsonify({'error': 'Unsupported shared-deck operation for scope'}), 404

        payload = build_merged_source_decks_payload(
            sources,
            get_category_session_card_count_for_kid(kid, scope_context['category_key']),
            scope_context['include_orphan_in_queue'],
        )
        return jsonify({
            'category_key': scope_context['category_key'],
            **payload,
            'has_chinese_specific_logic': bool(scope_context['has_chinese_specific_logic']),
            **special_ready_payload,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def update_shared_card_skip_bulk_for_scope(kid_id, category):
    """Handle bulk shared card skip updates by scope config."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        card_ids, skipped = parse_shared_card_skip_bulk_update_request()
        scope_context = resolve_shared_scope_management_context(
            kid,
            category,
            request.args.get('categoryKey'),
        )
        category_key = scope_context['category_key']
        orphan_deck_name = scope_context['orphan_deck_name']
        deck_label = category_key

        payload, status_code = update_shared_cards_skip_bulk_internal(
            kid,
            card_ids,
            skipped,
            category_key=category_key,
            orphan_deck_name=orphan_deck_name,
            deck_label=deck_label,
        )
        return jsonify(payload), status_code
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


SHARED_DECK_OPERATION_HANDLERS = {
    SHARED_DECK_OP_GET: get_shared_decks_for_scope,
    SHARED_DECK_OP_OPT_IN: opt_in_shared_decks_for_scope,
    SHARED_DECK_OP_OPT_OUT: opt_out_shared_decks_for_scope,
    SHARED_DECK_OP_GET_CARDS: get_shared_cards_for_scope,
    SHARED_DECK_OP_SKIP_UPDATE: update_shared_card_skip_for_scope,
    SHARED_DECK_OP_SKIP_UPDATE_BULK: update_shared_card_skip_bulk_for_scope,
    SHARED_DECK_OP_GET_DECKS: get_decks_for_scope,
}


def run_shared_deck_scope_operation(operation, kid_id, category, *, card_id=None):
    """Run one shared deck operation via generic operation handlers."""
    handler = SHARED_DECK_OPERATION_HANDLERS.get(operation)
    if handler is None:
        return jsonify({'error': 'Unsupported shared-deck operation for scope'}), 404
    if operation == SHARED_DECK_OP_SKIP_UPDATE:
        return handler(kid_id, category, card_id)
    return handler(kid_id, category)


def get_shared_type3_cards(kid_id):
    """Get merged cards across opted-in type-III decks and orphan deck."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        category_key, _ = resolve_kid_type_iii_category_with_mode(
            kid,
            request.args.get('categoryKey'),
        )
        preview_hard_pct = parse_optional_hard_card_percentage_arg()
        return jsonify(
            build_type_i_shared_cards_payload(
                kid,
                category_key,
                preview_hard_pct,
            )
        ), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def get_shared_type4_cards(kid_id):
    """Get representative cards across opted-in type-IV decks."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        category_key, _ = resolve_kid_type_iv_category_with_mode(
            kid,
            request.args.get('categoryKey'),
        )
        preview_hard_pct = parse_optional_hard_card_percentage_arg()
        return jsonify(
            build_type_iv_shared_cards_payload(
                kid,
                category_key,
                preview_hard_pct,
            )
        ), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type4/shared-decks/cards/<card_id>/generator-preview', methods=['POST'])
def preview_type4_generator_for_card(kid_id, card_id):
    """Run one opted-in type-IV deck generator and return fresh example rows."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        category_key, _ = resolve_kid_type_iv_category_with_mode(
            kid,
            (request.get_json(silent=True) or {}).get('categoryKey') or request.args.get('categoryKey'),
        )
        try:
            card_id_int = int(card_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid card id'}), 400
        if card_id_int <= 0:
            return jsonify({'error': 'Invalid card id'}), 400

        conn = get_kid_connection_for(kid)
        try:
            card_row = conn.execute(
                """
                SELECT c.id, c.front, c.deck_id
                FROM cards c
                WHERE c.id = ?
                LIMIT 1
                """,
                [card_id_int],
            ).fetchone()
            if not card_row:
                return jsonify({'error': 'Card not found'}), 404

            local_deck_id = int(card_row[2] or 0)
            materialized_by_local_id = get_kid_materialized_shared_decks_by_first_tag(
                conn,
                category_key,
            )
            source_entry = materialized_by_local_id.get(local_deck_id)
            shared_deck_id = int(source_entry.get('shared_deck_id') or 0) if source_entry else 0
        finally:
            conn.close()

        if shared_deck_id <= 0:
            representative_front = str(card_row[1] or '').strip()
            if representative_front:
                generator_details_by_front = build_type_iv_generator_details_by_representative_front(category_key)
                shared_deck_id = int(
                    (generator_details_by_front.get(representative_front) or {}).get('shared_deck_id') or 0
                )

        if shared_deck_id <= 0:
            return jsonify({'error': 'Shared generator deck not found for this card'}), 404

        shared_conn = get_shared_decks_connection()
        try:
            generator_definition = get_shared_deck_generator_definition(shared_conn, shared_deck_id)
        finally:
            shared_conn.close()
        if not generator_definition or not str(generator_definition.get('code') or '').strip():
            return jsonify({'error': 'Generator definition not found for this deck'}), 404

        seed_base = int(time.time_ns() % 2_000_000_000)
        samples = preview_type4_generator(
            generator_definition.get('code'),
            sample_count=1,
            seed_base=seed_base,
        )
        return jsonify({
            'card_id': card_id_int,
            'shared_deck_id': shared_deck_id,
            'representative_label': str(card_row[1] or ''),
            'code': str(generator_definition.get('code') or ''),
            'samples': samples,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type4/shared-decks/daily-targets', methods=['PUT'])
def update_type4_shared_deck_daily_targets(kid_id):
    """Update per-deck daily target counts for one opted-in type-IV category."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload = request.get_json() or {}
        category_key, _ = resolve_kid_type_iv_category_with_mode(
            kid,
            payload.get('categoryKey') or request.args.get('categoryKey'),
        )
        raw_counts = payload.get('dailyCountsByDeckId')
        if raw_counts is None:
            raw_counts = payload.get('daily_counts_by_deck_id')
        daily_counts_by_shared_deck_id = normalize_type_iv_daily_counts_payload(raw_counts)
        raw_orphan_daily_target_count = payload.get('orphanDailyTargetCount')
        if raw_orphan_daily_target_count is None and 'orphan_daily_target_count' in payload:
            raw_orphan_daily_target_count = payload.get('orphan_daily_target_count')
        orphan_daily_target_count = None
        if raw_orphan_daily_target_count is not None:
            try:
                orphan_daily_target_count = max(0, min(1000, int(raw_orphan_daily_target_count)))
            except (TypeError, ValueError):
                return jsonify({'error': 'orphanDailyTargetCount must be an integer between 0 and 1000'}), 400

        conn = get_kid_connection_for(kid)
        try:
            materialized_by_local_id = get_kid_materialized_shared_decks_by_first_tag(
                conn,
                category_key,
            )
            local_by_shared_id = {
                int(entry['shared_deck_id']): int(entry['local_deck_id'])
                for entry in materialized_by_local_id.values()
            }
            invalid_shared_ids = [
                int(shared_deck_id)
                for shared_deck_id in daily_counts_by_shared_deck_id.keys()
                if shared_deck_id not in local_by_shared_id
            ]
            if invalid_shared_ids:
                return jsonify({
                    'error': (
                        'dailyCountsByDeckId includes deck(s) that are not currently opted in: '
                        f'{", ".join(str(v) for v in invalid_shared_ids)}'
                    )
                }), 400

            updated = []
            for shared_deck_id, local_deck_id in local_by_shared_id.items():
                next_daily_count = int(daily_counts_by_shared_deck_id.get(shared_deck_id, 0))
                conn.execute(
                    "UPDATE decks SET daily_target_count = ? WHERE id = ?",
                    [next_daily_count, local_deck_id]
                )
                updated.append({
                    'shared_deck_id': int(shared_deck_id),
                    'deck_id': int(local_deck_id),
                    'daily_target_count': int(next_daily_count),
                })
            orphan_daily_target_saved = None
            orphan_deck_name = get_category_orphan_deck_name(category_key)
            orphan_row = conn.execute(
                "SELECT id, COALESCE(daily_target_count, 0) FROM decks WHERE name = ? LIMIT 1",
                [orphan_deck_name],
            ).fetchone()
            if orphan_row and int(orphan_row[0] or 0) > 0:
                orphan_deck_id = int(orphan_row[0] or 0)
                if orphan_daily_target_count is not None:
                    conn.execute(
                        "UPDATE decks SET daily_target_count = ? WHERE id = ?",
                        [int(orphan_daily_target_count), orphan_deck_id],
                    )
                    orphan_daily_target_saved = int(orphan_daily_target_count)
                else:
                    orphan_daily_target_saved = int(orphan_row[1] or 0)
            include_orphan_in_queue = get_category_include_orphan_for_kid(kid, category_key)
            session_card_count = int(sum(item['daily_target_count'] for item in updated))
            if include_orphan_in_queue and orphan_daily_target_saved is not None:
                session_card_count += int(orphan_daily_target_saved)
        finally:
            conn.close()

        return jsonify({
            'updated': True,
            'category_key': category_key,
            'updated_count': len(updated),
            'session_card_count': session_card_count,
            'daily_counts_by_deck_id': {
                str(item['shared_deck_id']): int(item['daily_target_count'])
                for item in updated
            },
            'orphan_daily_target_count': orphan_daily_target_saved,
            'decks': updated,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def get_shared_type2_cards(kid_id):
    """Get merged cards across opted-in type-II decks and orphan deck."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        category_key, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            request.args.get('categoryKey'),
        )
        preview_hard_pct = parse_optional_hard_card_percentage_arg()
        effective_hard_pct = (
            preview_hard_pct
            if preview_hard_pct is not None
            else normalize_hard_card_percentage(kid, session_type=category_key)
        )
        category_display_name = get_deck_category_display_name(
            category_key,
            get_shared_deck_category_meta_by_key(),
        )

        conn = get_kid_connection_for(kid)
        try:
            sources = get_shared_type_ii_merged_source_decks_for_kid(
                conn,
                kid,
                category_key,
            )
            bank_sources = [
                src for src in sources
                if int(src.get('card_count') or 0) > 0 and bool(src.get('included_in_bank', True))
            ]
            bank_deck_ids = [int(src['local_deck_id']) for src in bank_sources]
            practice_sources = [src for src in sources if bool(src.get('included_in_queue'))]
            practice_source_ids = [
                int(src['local_deck_id'])
                for src in practice_sources
                if int(src.get('active_card_count') or 0) > 0
            ]

            pending_card_ids = []
            pending_card_set = set()
            candidate_rows = []
            candidate_card_ids = []
            candidate_card_set = set()
            candidate_reason_by_card = {}
            preview_excluded_ids = []
            if has_chinese_specific_logic:
                pending_card_ids = get_pending_writing_card_ids(conn)
                pending_card_set = set(pending_card_ids)
                preview_excluded_ids = list(pending_card_set)
                candidate_rows = get_writing_candidate_rows(
                    conn,
                    bank_deck_ids,
                    category_key,
                    excluded_card_ids=pending_card_ids,
                )
                candidate_card_ids = [int(row[0]) for row in candidate_rows]
                candidate_card_set = set(candidate_card_ids)
                for row in candidate_rows:
                    card_id = int(row[0])
                    latest_correct = int(row[3]) if row[3] is not None else None
                    if latest_correct is None:
                        candidate_reason_by_card[card_id] = ('never_seen', 'Newly added')
                    else:
                        candidate_reason_by_card[card_id] = ('last_failed', 'Last failed')
            special_ready_payload = build_special_session_ready_payload(
                conn,
                kid,
                category_key,
                source_by_deck_id={
                    int(src['local_deck_id']): src
                    for src in practice_sources
                    if int(src.get('active_card_count') or 0) > 0
                },
                source_deck_ids=practice_source_ids,
                excluded_card_ids=pending_card_ids,
            )

            preview_order = {}
            if practice_source_ids:
                existing_hard_pct_by_category = kid.get(HARD_CARD_PERCENT_BY_CATEGORY_FIELD)
                preview_hard_pct_by_category = {
                    normalize_shared_deck_tag(raw_key): raw_value
                    for raw_key, raw_value in (
                        existing_hard_pct_by_category.items()
                        if isinstance(existing_hard_pct_by_category, dict)
                        else []
                    )
                    if normalize_shared_deck_tag(raw_key)
                }
                preview_hard_pct_by_category[category_key] = int(effective_hard_pct)
                preview_kid = {
                    **with_preview_session_count_for_category(
                        kid,
                        category_key,
                        get_category_session_card_count_for_kid(kid, category_key),
                    ),
                    HARD_CARD_PERCENT_BY_CATEGORY_FIELD: preview_hard_pct_by_category,
                }
                preview_ids = preview_deck_practice_order_for_decks(
                    conn,
                    preview_kid,
                    practice_source_ids,
                    category_key,
                    excluded_card_ids=preview_excluded_ids,
                )
                preview_order = {card_id: i + 1 for i, card_id in enumerate(preview_ids)}

            orphan_deck_name = get_category_orphan_deck_name(category_key)

            def _source_label(source):
                tags = extract_shared_deck_tags_and_labels(source.get('tags') or [])[0]
                tail = tags[1:] if len(tags) > 1 else []
                if tail:
                    return ' / '.join(tail)
                local_name = str(source.get('local_name') or '')
                if local_name == orphan_deck_name:
                    return 'orphan'
                return local_name

            merged_cards = []
            for src in bank_sources:
                local_deck_id = int(src['local_deck_id'])
                rows = get_cards_with_stats(conn, local_deck_id)
                for row in rows:
                    mapped = map_card_row(row, preview_order)
                    if not mapped.get('front') and mapped.get('back'):
                        mapped['front'] = mapped.get('back')
                    card_id = int(row[0])
                    is_candidate = card_id in candidate_card_set
                    mapped['pending_sheet'] = card_id in pending_card_set
                    mapped['available_for_practice'] = (not mapped['pending_sheet'])
                    mapped['practicing_reason'] = None
                    mapped['practicing_reason_label'] = None
                    if mapped['pending_sheet']:
                        mapped['writing_state'] = 3
                        mapped['writing_state_label'] = 'In Practicing Sheet'
                    elif is_candidate:
                        mapped['writing_state'] = 2
                        mapped['writing_state_label'] = 'Ready for Practicing Sheet'
                        reason = candidate_reason_by_card.get(card_id)
                        if reason:
                            mapped['practicing_reason'] = reason[0]
                            mapped['practicing_reason_label'] = reason[1]
                    else:
                        mapped['writing_state'] = 1
                        mapped['writing_state_label'] = 'Default'
                    mapped['source_deck_id'] = local_deck_id
                    mapped['source_deck_name'] = str(src.get('local_name') or '')
                    mapped['source_deck_label'] = _source_label(src)
                    mapped['source_deck_tags'] = extract_shared_deck_tags_and_labels(src.get('tags') or [])[0]
                    mapped['source_is_orphan'] = bool(src.get('is_orphan'))
                    audio_meta = build_writing_prompt_audio_payload(
                        kid_id,
                        mapped.get('front'),
                        category_key=category_key,
                        has_chinese_specific_logic=has_chinese_specific_logic,
                    )
                    mapped['audio_file_name'] = audio_meta['audio_file_name']
                    mapped['audio_mime_type'] = audio_meta['audio_mime_type']
                    mapped['audio_url'] = audio_meta['audio_url']
                    mapped['prompt_audio_url'] = audio_meta['prompt_audio_url']
                    merged_cards.append(mapped)

            merged_by_id = {
                int(card.get('id')): card
                for card in merged_cards
                if int(card.get('id') or 0) > 0
            }
            practicing_cards = []
            for card_id in candidate_card_ids:
                card = merged_by_id.get(int(card_id))
                if card is not None and int(card.get('writing_state') or 0) == 2:
                    practicing_cards.append(card)
            practicing_sheet_cards = [
                card for card in merged_cards
                if int(card.get('writing_state') or 0) == 3
            ]

            active_count = sum(int(src.get('active_card_count') or 0) for src in bank_sources)
            skipped_count = sum(int(src.get('skipped_card_count') or 0) for src in bank_sources)
            practice_active_count = sum(int(src.get('active_card_count') or 0) for src in practice_sources)
            orphan_deck_id = get_or_create_category_orphan_deck(conn, category_key)
        finally:
            conn.close()

        return jsonify({
            'category_key': category_key,
            'has_chinese_specific_logic': bool(has_chinese_specific_logic),
            'is_merged_bank': True,
            'deck_name': f'Merged {category_display_name} Bank',
            'deck_id': orphan_deck_id,
            'hard_card_percentage': int(effective_hard_pct),
            'include_orphan_in_queue': get_category_include_orphan_for_kid(kid, category_key),
            'practice_source_count': len(practice_sources),
            'practice_active_card_count': int(practice_active_count),
            'active_card_count': active_count,
            'skipped_card_count': skipped_count,
            'practicing_card_count': len(practicing_cards),
            'practicing_cards': practicing_cards,
            'practicing_sheet_card_count': len(practicing_sheet_cards),
            'practicing_sheet_cards': practicing_sheet_cards,
            'cards': merged_cards,
            **special_ready_payload,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


CATEGORY_CONFIG.update({
    SHARED_DECK_SCOPE_TYPE1: {
        'kind': 'type1',
        'cards_handler': get_shared_type1_cards,
    },
    SHARED_DECK_SCOPE_TYPE3: {
        'kind': 'type3',
        'use_type_i_card_management': True,
        'cards_handler': get_shared_type3_cards,
    },
    SHARED_DECK_SCOPE_TYPE2: {
        'kind': 'type2',
        'use_type_ii_card_management': True,
        'cards_handler': get_shared_type2_cards,
    },
    SHARED_DECK_SCOPE_TYPE4: {
        'kind': 'type4',
        'cards_handler': get_shared_type4_cards,
    },
})


@kids_bp.route('/kids/<kid_id>/type2/cards', methods=['GET'])
def get_writing_cards(kid_id):
    """Get merged type-II cards across opted-in shared decks (+ optional orphan queue)."""
    return get_shared_type2_cards(kid_id)


@kids_bp.route('/kids/<kid_id>/type2/cards', methods=['POST'])
def add_writing_cards(kid_id):
    """Add one type-II orphan card from provided prompt/answer text."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload = request.get_json(silent=True) or {}
        category_key, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            payload.get('categoryKey') or request.args.get('categoryKey'),
        )
        if has_chinese_specific_logic:
            answer_text = (
                payload.get('characters')
                or payload.get('text')
                or request.form.get('characters')
                or request.form.get('text')
                or ''
            )
            answer_text = str(answer_text).strip()
            if len(answer_text) == 0:
                return jsonify({'error': 'Please provide answer text'}), 400
            card_front = answer_text
            card_back = answer_text
        else:
            front_text = (
                payload.get('front')
                or payload.get('text')
                or request.form.get('front')
                or request.form.get('text')
                or ''
            )
            back_text = (
                payload.get('back')
                or request.form.get('back')
                or ''
            )
            front_text = str(front_text).strip()
            back_text = str(back_text).strip() or front_text
            if len(front_text) == 0:
                return jsonify({'error': 'Please provide card front text'}), 400
            card_front = front_text
            card_back = back_text

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_category_orphan_deck(conn, category_key)

        source_decks = get_shared_type_ii_merged_source_decks_for_kid(
            conn,
            kid,
            category_key,
        )
        source_deck_ids = [int(src['local_deck_id']) for src in source_decks]
        existing_values = {
            str(value or '').strip()
            for value in (
                get_kid_card_backs_for_deck_ids(conn, source_deck_ids)
                if has_chinese_specific_logic
                else get_kid_card_fronts_for_deck_ids(conn, source_deck_ids)
            )
        }
        dedupe_value = (
            str(card_back or '').strip()
            if has_chinese_specific_logic
            else str(card_front or '').strip()
        )
        if dedupe_value in existing_values:
            conn.close()
            return jsonify({
                'error': (
                    'This Chinese writing answer already exists in the card bank'
                    if has_chinese_specific_logic
                    else 'This type-II prompt already exists in the card bank'
                )
            }), 400

        row = conn.execute(
            """
            INSERT INTO cards (deck_id, front, back)
            VALUES (?, ?, ?)
            RETURNING id, deck_id, front, back, created_at
            """,
            [deck_id, card_front, card_back]
        ).fetchone()

        conn.close()
        audio_meta = build_writing_prompt_audio_payload(
            kid_id,
            row[2],
            category_key=category_key,
            has_chinese_specific_logic=has_chinese_specific_logic,
        )
        return jsonify({
            'category_key': category_key,
            'deck_id': deck_id,
            'inserted_count': 1,
            'cards': [{
                'id': row[0],
                'deck_id': row[1],
                'front': row[2],
                'back': row[3],
                'created_at': row[4].isoformat() if row[4] else None,
                'audio_file_name': audio_meta['audio_file_name'],
                'audio_mime_type': audio_meta['audio_mime_type'],
                'audio_url': audio_meta['audio_url'],
                'prompt_audio_url': audio_meta['prompt_audio_url'],
            }]
        }), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type2/cards/<card_id>', methods=['PUT'])
def update_writing_card(kid_id, card_id):
    """Update one type-II card front text (voice prompt source)."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        data = request.get_json(silent=True) or {}
        category_key, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            data.get('categoryKey') or request.args.get('categoryKey'),
        )
        next_front = str(data.get('front') or '').strip()
        if not next_front:
            return jsonify({'error': 'front is required'}), 400

        conn = get_kid_connection_for(kid)
        source_decks = get_shared_type_ii_merged_source_decks_for_kid(
            conn,
            kid,
            category_key,
        )
        source_deck_ids = [int(src['local_deck_id']) for src in source_decks]
        if len(source_deck_ids) == 0:
            conn.close()
            return jsonify({'error': 'Writing card not found'}), 404
        placeholders = ','.join(['?'] * len(source_deck_ids))
        row = conn.execute(
            f"""
            SELECT id, deck_id, front, back, COALESCE(skip_practice, FALSE), hardness_score, created_at
            FROM cards
            WHERE id = ? AND deck_id IN ({placeholders})
            LIMIT 1
            """,
            [card_id, *source_deck_ids]
        ).fetchone()
        if not row:
            conn.close()
            return jsonify({'error': 'Writing card not found'}), 404

        old_front = str(row[2] or '')
        card_back = str(row[3] or '')
        if old_front != next_front:
            conn.execute(
                "UPDATE cards SET front = ? WHERE id = ?",
                [next_front, row[0]]
            )
        conn.close()

        old_file_name = build_shared_writing_audio_file_name(old_front)
        new_audio_meta = build_writing_prompt_audio_payload(
            kid_id,
            next_front,
            category_key=category_key,
            has_chinese_specific_logic=has_chinese_specific_logic,
        )
        kept_file_names = {
            build_shared_writing_audio_file_name(next_front),
            build_shared_writing_audio_file_name(card_back),
        }
        kept_file_names.discard('')
        if old_file_name and old_file_name not in kept_file_names:
            old_audio_path = os.path.join(get_shared_writing_audio_dir(), old_file_name)
            if os.path.exists(old_audio_path):
                try:
                    os.remove(old_audio_path)
                except OSError:
                    pass

        return jsonify({
            'category_key': category_key,
            'id': int(row[0]),
            'deck_id': int(row[1]),
            'front': next_front,
            'back': card_back,
            'skip_practice': bool(row[4]),
            'hardness_score': float(row[5] if row[5] is not None else 0),
            'created_at': row[6].isoformat() if row[6] else None,
            'audio_file_name': new_audio_meta.get('audio_file_name'),
            'audio_mime_type': new_audio_meta.get('audio_mime_type'),
            'audio_url': new_audio_meta.get('audio_url'),
            'prompt_audio_url': new_audio_meta.get('prompt_audio_url'),
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type2/cards/bulk', methods=['POST'])
def add_writing_cards_bulk(kid_id):
    """Bulk-add type-II orphan cards."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload = request.get_json() or {}
        category_key, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            payload.get('categoryKey') or request.args.get('categoryKey'),
        )
        raw_text = payload.get('text', '')
        rows_to_insert = split_type2_bulk_rows(raw_text, has_chinese_specific_logic)
        if len(rows_to_insert) == 0:
            return jsonify({
                'error': (
                    'Please paste at least one Chinese word/phrase'
                    if has_chinese_specific_logic
                    else 'Please paste at least one non-empty line'
                )
            }), 400

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_category_orphan_deck(conn, category_key)
        source_decks = get_shared_type_ii_merged_source_decks_for_kid(
            conn,
            kid,
            category_key,
        )
        source_deck_ids = [int(src['local_deck_id']) for src in source_decks]
        existing_set = {
            str(value or '').strip()
            for value in (
                get_kid_card_backs_for_deck_ids(conn, source_deck_ids)
                if has_chinese_specific_logic
                else get_kid_card_fronts_for_deck_ids(conn, source_deck_ids)
            )
        }

        created = []
        skipped_existing = 0
        skipped_existing_cards = []
        for front_text, back_text in rows_to_insert:
            dedupe_value = (
                str(back_text or '').strip()
                if has_chinese_specific_logic
                else str(front_text or '').strip()
            )
            if not dedupe_value:
                continue
            if dedupe_value in existing_set:
                skipped_existing += 1
                skipped_existing_cards.append(
                    format_type2_bulk_card_text(front_text, back_text, has_chinese_specific_logic)
                )
                continue

            row = conn.execute(
                """
                INSERT INTO cards (deck_id, front, back)
                VALUES (?, ?, ?)
                RETURNING id, deck_id, front, back, created_at
                """,
                [deck_id, front_text, back_text]
            ).fetchone()
            existing_set.add(dedupe_value)
            audio_meta = build_writing_prompt_audio_payload(
                kid_id,
                front_text,
                category_key=category_key,
                has_chinese_specific_logic=has_chinese_specific_logic,
            )
            created.append({
                'id': int(row[0]),
                'deck_id': int(row[1]),
                'front': row[2],
                'back': row[3],
                'created_at': row[4].isoformat() if row[4] else None,
                'audio_file_name': audio_meta['audio_file_name'],
                'audio_mime_type': audio_meta['audio_mime_type'],
                'audio_url': audio_meta['audio_url'],
                'prompt_audio_url': audio_meta['prompt_audio_url'],
            })

        conn.close()
        return jsonify({
            'category_key': category_key,
            'deck_id': deck_id,
            'input_token_count': len(rows_to_insert),
            'inserted_count': len(created),
            'skipped_existing_count': skipped_existing,
            'skipped_existing_cards': skipped_existing_cards,
            'cards': created
        }), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type2/audio/<path:file_name>', methods=['GET'])
def get_writing_audio(kid_id, file_name):
    """Serve type-II prompt audio file for a kid."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        category_key, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            request.args.get('categoryKey'),
        )
        if file_name != os.path.basename(file_name):
            return jsonify({'error': 'Invalid file name'}), 400

        conn = get_kid_connection_for(kid)
        try:
            # Keep this endpoint read-only. Do not create orphan decks while serving audio.
            materialized_by_local_id = get_kid_materialized_shared_type_ii_decks(conn, category_key)
            source_deck_ids = [
                int(entry['local_deck_id'])
                for entry in materialized_by_local_id.values()
                if int(entry.get('local_deck_id') or 0) > 0
            ]
            include_orphan = get_category_include_orphan_for_kid(kid, category_key)
            if include_orphan:
                orphan_deck_name = get_category_orphan_deck_name(category_key)
                orphan_row = conn.execute(
                    "SELECT id FROM decks WHERE name = ? LIMIT 1",
                    [orphan_deck_name],
                ).fetchone()
                if orphan_row and int(orphan_row[0] or 0) > 0:
                    source_deck_ids.append(int(orphan_row[0]))

            source_deck_ids = sorted(set(source_deck_ids))
            if not source_deck_ids:
                return jsonify({'error': 'Audio file not found'}), 404
            placeholders = ','.join(['?'] * len(source_deck_ids))
            rows = conn.execute(
                f"SELECT front, back FROM cards WHERE deck_id IN ({placeholders})",
                source_deck_ids
            ).fetchall()
        finally:
            conn.close()

        synth_args_by_file_name = {}
        for row in rows:
            front_text = normalize_writing_audio_text(row[0])
            back_text = normalize_writing_audio_text(row[1])
            front_file = build_shared_writing_audio_file_name(front_text)
            if front_file and front_file not in synth_args_by_file_name:
                synth_args_by_file_name[front_file] = {
                    'file_key_text': front_text,
                    'spoken_text': build_writing_front_tts_text(
                        front_text,
                        back_text,
                        has_chinese_specific_logic=has_chinese_specific_logic,
                    ),
                }

        synth_args = synth_args_by_file_name.get(file_name)
        if not synth_args:
            return jsonify({'error': 'Audio file not found'}), 404

        audio_dir = get_shared_writing_audio_dir()
        audio_path = os.path.join(audio_dir, file_name)
        if not os.path.exists(audio_path):
            synthesize_shared_writing_audio(
                synth_args.get('file_key_text'),
                overwrite=False,
                spoken_text=synth_args.get('spoken_text'),
                has_chinese_specific_logic=has_chinese_specific_logic,
            )
            if not os.path.exists(audio_path):
                return jsonify({'error': 'Audio file not found'}), 404

        mime_type = mimetypes.guess_type(file_name)[0] or 'audio/mpeg'
        return send_from_directory(audio_dir, file_name, as_attachment=False, mimetype=mime_type)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/audio/<path:file_name>', methods=['GET'])
def get_type3_audio(kid_id, file_name):
    """Serve type-III recording audio file for one kid."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        if file_name != os.path.basename(file_name):
            return jsonify({'error': 'Invalid file name'}), 400

        audio_dir = get_kid_type3_audio_dir(kid)
        audio_path = os.path.join(audio_dir, file_name)
        if not os.path.exists(audio_path):
            return jsonify({'error': 'Audio file not found'}), 404

        conn = get_kid_connection_for(kid)
        row = conn.execute(
            """
            SELECT lra.mime_type, s.type
            FROM lesson_reading_audio lra
            JOIN session_results sr ON sr.id = lra.result_id
            JOIN sessions s ON s.id = sr.session_id
            WHERE lra.file_name = ?
            LIMIT 1
            """,
            [file_name]
        ).fetchone()
        conn.close()

        if not row or not is_type_iii_session_type(row[1]):
            return jsonify({'error': 'Audio file not found'}), 404

        mime_type = row[0] if row and row[0] else None
        return send_from_directory(audio_dir, file_name, as_attachment=False, mimetype=mime_type)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def sanitize_download_filename_stem(raw_name, fallback='recording'):
    """Return safe user-facing filename stem while preserving Unicode text."""
    text = str(raw_name or '').strip()
    if not text:
        text = fallback
    text = re.sub(r'[\x00-\x1f\x7f]+', '', text)
    text = text.replace('/', '／').replace('\\', '＼')
    text = text.strip().strip('.')
    if not text:
        text = fallback
    # Keep names reasonable for browser download dialogs.
    return text[:120]


def resolve_ffmpeg_executable():
    """Resolve ffmpeg binary path for environments without system ffmpeg."""
    configured = str(os.environ.get('FFMPEG_BIN') or '').strip()
    if configured:
        return configured

    system_ffmpeg = shutil.which('ffmpeg')
    if system_ffmpeg:
        return system_ffmpeg

    try:
        import imageio_ffmpeg  # type: ignore
        bundled = str(imageio_ffmpeg.get_ffmpeg_exe() or '').strip()
        if bundled:
            return bundled
    except Exception:
        return ''

    return ''


@kids_bp.route('/kids/<kid_id>/lesson-reading/audio/<path:file_name>/download-m4a', methods=['GET'])
def download_type3_audio_as_m4a(kid_id, file_name):
    """Download one type-III recording as M4A/AAC (transcoded on demand)."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        if file_name != os.path.basename(file_name):
            return jsonify({'error': 'Invalid file name'}), 400

        audio_dir = get_kid_type3_audio_dir(kid)
        audio_path = os.path.join(audio_dir, file_name)
        if not os.path.exists(audio_path):
            return jsonify({'error': 'Audio file not found'}), 404

        conn = get_kid_connection_for(kid)
        row = conn.execute(
            """
            SELECT lra.mime_type, s.type
            FROM lesson_reading_audio lra
            JOIN session_results sr ON sr.id = lra.result_id
            JOIN sessions s ON s.id = sr.session_id
            WHERE lra.file_name = ?
            LIMIT 1
            """,
            [file_name]
        ).fetchone()
        conn.close()

        if not row or not is_type_iii_session_type(row[1]):
            return jsonify({'error': 'Audio file not found'}), 404
        stored_mime_type = str(row[0] or '').strip().lower()

        requested_name = request.args.get('downloadName')
        base_stem = sanitize_download_filename_stem(
            requested_name or os.path.splitext(file_name)[0],
            fallback='recording'
        )
        output_name = f'{base_stem}.m4a'
        passthrough_ext = os.path.splitext(file_name)[1] or '.webm'
        passthrough_name = f'{base_stem}{passthrough_ext}'
        passthrough_mime = mimetypes.guess_type(file_name)[0] or 'application/octet-stream'
        source_ext = os.path.splitext(file_name)[1].lower()
        source_is_m4a_compatible = (
            source_ext in {'.m4a', '.mp4'}
            or stored_mime_type in {'audio/mp4', 'audio/x-m4a'}
        )

        if source_is_m4a_compatible:
            return send_file(
                audio_path,
                mimetype='audio/mp4',
                as_attachment=True,
                download_name=output_name,
            )

        ffmpeg_exe = resolve_ffmpeg_executable()
        if not ffmpeg_exe:
            return send_file(
                audio_path,
                mimetype=passthrough_mime,
                as_attachment=True,
                download_name=passthrough_name,
            )

        ffmpeg_cmd = [
            ffmpeg_exe,
            '-v', 'error',
            '-i', audio_path,
            '-vn',
            '-c:a', 'aac',
            '-b:a', '160k',
            '-movflags', '+frag_keyframe+empty_moov',
            '-f', 'mp4',
            'pipe:1',
        ]
        process = subprocess.run(
            ffmpeg_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if process.returncode != 0 or not process.stdout:
            return send_file(
                audio_path,
                mimetype=passthrough_mime,
                as_attachment=True,
                download_name=passthrough_name,
            )

        return send_file(
            BytesIO(process.stdout),
            mimetype='audio/mp4',
            as_attachment=True,
            download_name=output_name,
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type2/cards/<card_id>', methods=['DELETE'])
def delete_writing_card(kid_id, card_id):
    """Delete a type-II orphan card and remove its shared generated clip."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        category_key, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            request.args.get('categoryKey'),
        )
        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_category_orphan_deck(conn, category_key)

        row = conn.execute(
            """
            SELECT c.id, c.front, c.back
            FROM cards c
            WHERE c.id = ? AND c.deck_id = ?
            """,
            [card_id, deck_id]
        ).fetchone()
        if not row:
            conn.close()
            return jsonify({'error': 'Writing card not found'}), 404

        practiced_count = int(conn.execute(
            "SELECT COUNT(*) FROM session_results WHERE card_id = ?",
            [card_id]
        ).fetchone()[0] or 0)
        if practiced_count > 0:
            conn.close()
            return jsonify({'error': 'Cards with practice history cannot be deleted'}), 400

        conn.execute("DELETE FROM writing_sheet_cards WHERE card_id = ?", [card_id])
        delete_card_from_deck_internal(conn, card_id)
        conn.close()

        clip_names = {
            build_shared_writing_audio_file_name(row[1]),
            build_shared_writing_audio_file_name(row[2]),
        }
        clip_names.discard('')
        for file_name in clip_names:
            audio_path = os.path.join(get_shared_writing_audio_dir(), file_name)
            if os.path.exists(audio_path):
                try:
                    os.remove(audio_path)
                except OSError:
                    pass

        return jsonify({'message': 'Writing card deleted successfully'}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def select_writing_sheet_candidates(conn, deck_ids, session_type, requested_count, excluded_card_ids=None):
    """Select candidate writing cards (newly added or latest failed) for sheet generation."""
    return get_writing_candidate_rows(
        conn,
        deck_ids,
        session_type,
        excluded_card_ids=excluded_card_ids,
        limit=requested_count
    )


@kids_bp.route('/kids/<kid_id>/type2/sheets/preview', methods=['POST'])
def preview_writing_sheet(kid_id):
    """Preview writing sheet cards without persisting a sheet record."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        data = request.get_json() or {}
        category_key, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            data.get('categoryKey') or request.args.get('categoryKey'),
        )
        if not has_chinese_specific_logic:
            return jsonify({'error': 'Practice sheets are only available for Chinese-specific type-II categories'}), 400
        try:
            requested_count = int(data.get('count', get_category_session_card_count_for_kid(kid, category_key)))
        except (TypeError, ValueError):
            return jsonify({'error': 'count must be an integer'}), 400
        try:
            requested_rows = int(data.get('rows_per_character', 1))
        except (TypeError, ValueError):
            return jsonify({'error': 'rows_per_character must be an integer'}), 400

        if requested_count < MIN_SESSION_CARD_COUNT:
            return jsonify({'error': f'count must be at least {MIN_SESSION_CARD_COUNT}'}), 400
        if requested_rows < 1 or requested_rows > MAX_WRITING_SHEET_ROWS:
            return jsonify({'error': f'rows_per_character must be between 1 and {MAX_WRITING_SHEET_ROWS}'}), 400
        if requested_count * requested_rows > MAX_WRITING_SHEET_ROWS:
            max_cards = max(1, MAX_WRITING_SHEET_ROWS // requested_rows)
            return jsonify({
                'error': (
                    f'Sheet exceeds one-page limit ({MAX_WRITING_SHEET_ROWS} rows). '
                    f'With {requested_rows} row(s) per card, max cards is {max_cards}.'
                )
            }), 400

        conn = get_kid_connection_for(kid)
        source_decks = get_shared_type_ii_merged_source_decks_for_kid(
            conn,
            kid,
            category_key,
        )
        bank_deck_ids = [
            int(src['local_deck_id'])
            for src in source_decks
            if int(src.get('card_count') or 0) > 0
        ]
        pending_card_ids = get_pending_writing_card_ids(conn)
        candidates = select_writing_sheet_candidates(
            conn,
            bank_deck_ids,
            category_key,
            requested_count,
            pending_card_ids,
        )
        conn.close()

        if len(candidates) == 0:
            return jsonify({
                'preview': False,
                'cards': [],
                'message': 'No suggested candidate cards are available to print right now.'
            }), 200

        return jsonify({
            'category_key': category_key,
            'preview': True,
            'rows_per_character': requested_rows,
            'cards': [{
                'id': int(row[0]),
                'front': row[1],
                'back': row[2]
            } for row in candidates]
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type2/sheets/finalize', methods=['POST'])
def finalize_writing_sheet(kid_id):
    """Persist a previously previewed writing sheet once parent confirms print."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        data = request.get_json() or {}
        category_key, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            data.get('categoryKey') or request.args.get('categoryKey'),
        )
        if not has_chinese_specific_logic:
            return jsonify({'error': 'Practice sheets are only available for Chinese-specific type-II categories'}), 400
        raw_ids = data.get('card_ids') or []
        try:
            requested_rows = int(data.get('rows_per_character', 1))
        except (TypeError, ValueError):
            return jsonify({'error': 'rows_per_character must be an integer'}), 400

        if not isinstance(raw_ids, list) or len(raw_ids) == 0:
            return jsonify({'error': 'card_ids must be a non-empty list'}), 400
        if requested_rows < 1 or requested_rows > MAX_WRITING_SHEET_ROWS:
            return jsonify({'error': f'rows_per_character must be between 1 and {MAX_WRITING_SHEET_ROWS}'}), 400

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
        source_decks = get_shared_type_ii_merged_source_decks_for_kid(
            conn,
            kid,
            category_key,
        )
        bank_deck_ids = [
            int(src['local_deck_id'])
            for src in source_decks
            if int(src.get('card_count') or 0) > 0
        ]

        pending_set = set(get_pending_writing_card_ids(conn))
        if any(card_id in pending_set for card_id in normalized_ids):
            conn.close()
            return jsonify({'error': 'Some selected cards are already practicing in another sheet'}), 409
        state2_set = set(get_writing_candidate_card_ids(
            conn,
            bank_deck_ids,
            category_key,
            excluded_card_ids=list(pending_set)
        ))
        if any(card_id not in state2_set for card_id in normalized_ids):
            conn.close()
            return jsonify({'error': 'Some selected cards are no longer in State 2 (ready for sheet)'}), 409

        placeholders = ','.join(['?'] * len(normalized_ids))
        deck_placeholders = ','.join(['?'] * len(bank_deck_ids))
        if not deck_placeholders:
            conn.close()
            return jsonify({'error': 'Some selected cards are no longer available'}), 409
        rows = conn.execute(
            f"""
            SELECT id, front, back
            FROM cards
            WHERE deck_id IN ({deck_placeholders})
              AND id IN ({placeholders})
            """,
            [*bank_deck_ids, *normalized_ids]
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
            'category_key': category_key,
            'created': True,
            'sheet_id': int(sheet_id),
            'rows_per_character': requested_rows,
            'cards': [{
                'id': card_id,
                'front': rows_by_id[card_id][1],
                'back': rows_by_id[card_id][2]
            } for card_id in normalized_ids]
        }), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type2/sheets', methods=['POST'])
def create_writing_sheet(kid_id):
    """Create a printable writing sheet from State-2 (ready) cards."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        data = request.get_json() or {}
        category_key, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            data.get('categoryKey') or request.args.get('categoryKey'),
        )
        if not has_chinese_specific_logic:
            return jsonify({'error': 'Practice sheets are only available for Chinese-specific type-II categories'}), 400
        try:
            requested_count = int(data.get('count', get_category_session_card_count_for_kid(kid, category_key)))
        except (TypeError, ValueError):
            return jsonify({'error': 'count must be an integer'}), 400
        try:
            requested_rows = int(data.get('rows_per_character', 1))
        except (TypeError, ValueError):
            return jsonify({'error': 'rows_per_character must be an integer'}), 400

        if requested_count < MIN_SESSION_CARD_COUNT:
            return jsonify({'error': f'count must be at least {MIN_SESSION_CARD_COUNT}'}), 400
        if requested_rows < 1 or requested_rows > MAX_WRITING_SHEET_ROWS:
            return jsonify({'error': f'rows_per_character must be between 1 and {MAX_WRITING_SHEET_ROWS}'}), 400
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
        source_decks = get_shared_type_ii_merged_source_decks_for_kid(
            conn,
            kid,
            category_key,
        )
        bank_deck_ids = [
            int(src['local_deck_id'])
            for src in source_decks
            if int(src.get('card_count') or 0) > 0
        ]
        pending_card_ids = get_pending_writing_card_ids(conn)

        candidates = select_writing_sheet_candidates(
            conn,
            bank_deck_ids,
            category_key,
            requested_count,
            pending_card_ids,
        )

        if len(candidates) == 0:
            conn.close()
            return jsonify({
                'sheet_id': None,
                'cards': [],
                'created': False,
                'message': 'No suggested candidate cards are available to print right now.'
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
            'category_key': category_key,
            'created': True,
            'sheet_id': int(sheet_id),
            'rows_per_character': requested_rows,
            'cards': [{
                'id': int(row[0]),
                'front': row[1],
                'back': row[2]
            } for row in candidates]
        }), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type2/sheets', methods=['GET'])
def get_writing_sheets(kid_id):
    """List all writing sheets with cards."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        _, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            request.args.get('categoryKey'),
        )
        if not has_chinese_specific_logic:
            return jsonify({'error': 'Practice sheets are only available for Chinese-specific type-II categories'}), 400

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
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type2/sheets/<sheet_id>', methods=['GET'])
def get_writing_sheet_detail(kid_id, sheet_id):
    """Get one writing sheet with cards."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        _, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            request.args.get('categoryKey'),
        )
        if not has_chinese_specific_logic:
            return jsonify({'error': 'Practice sheets are only available for Chinese-specific type-II categories'}), 400

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
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type2/sheets/<sheet_id>/complete', methods=['POST'])
def complete_writing_sheet(kid_id, sheet_id):
    """Mark a writing sheet as done."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        _, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            request.args.get('categoryKey'),
        )
        if not has_chinese_specific_logic:
            return jsonify({'error': 'Practice sheets are only available for Chinese-specific type-II categories'}), 400

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
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type2/sheets/<sheet_id>/withdraw', methods=['POST'])
def withdraw_writing_sheet(kid_id, sheet_id):
    """Withdraw a pending writing sheet by deleting it."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        _, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            request.args.get('categoryKey'),
        )
        if not has_chinese_specific_logic:
            return jsonify({'error': 'Practice sheets are only available for Chinese-specific type-II categories'}), 400

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
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type2/practice/start', methods=['POST'])
def start_writing_practice_session(kid_id):
    """Start a type-II practice session."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload = request.get_json(silent=True) or {}
        category_key, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            payload.get('categoryKey') or request.args.get('categoryKey'),
        )
        conn = get_kid_connection_for(kid)
        source_decks = get_shared_type_ii_merged_source_decks_for_kid(
            conn,
            kid,
            category_key,
        )
        included_sources = [src for src in source_decks if bool(src.get('included_in_queue'))]
        source_deck_ids = [
            int(src['local_deck_id'])
            for src in included_sources
            if int(src.get('active_card_count') or 0) > 0
        ]
        source_by_deck_id = {int(src['local_deck_id']): src for src in included_sources}

        pending_card_ids = get_pending_writing_card_ids(conn) if has_chinese_specific_logic else []
        continue_source_session = get_latest_unfinished_session_for_today(conn, kid, category_key)
        is_continue_session = continue_source_session is not None
        retry_source_session = None
        is_retry_session = False
        selected_cards = []
        if is_continue_session:
            practiced_card_ids = get_session_practiced_card_ids(
                conn,
                continue_source_session['session_id'],
            )
            excluded_card_ids = list(set([*pending_card_ids, *practiced_card_ids]))
            missing_count = max(
                0,
                int(continue_source_session['planned_count']) - int(continue_source_session['answer_count']),
            )
            continue_cards = build_continue_selected_cards_for_decks(
                conn,
                kid,
                source_deck_ids,
                category_key,
                missing_count,
                excluded_card_ids=excluded_card_ids,
            )
            selected_cards = []
            for card in continue_cards:
                local_deck_id = int(card.get('deck_id') or 0)
                src = source_by_deck_id.get(local_deck_id) or {}
                selected_cards.append({
                    **card,
                    'shared_deck_id': int(src['shared_deck_id']) if src.get('shared_deck_id') is not None else None,
                    'deck_id': local_deck_id,
                    'deck_name': str(src.get('local_name') or ''),
                    'source_tags': extract_shared_deck_tags_and_labels(src.get('tags') or [])[0],
                    'source_is_orphan': bool(src.get('is_orphan')),
                })
        else:
            retry_source_session = get_latest_retry_source_session_for_today(conn, kid, category_key)
            is_retry_session = retry_source_session is not None
            if is_retry_session:
                retry_wrong_card_ids = get_retry_source_wrong_card_ids(
                    conn,
                    retry_source_session['session_id'],
                )
                selected_cards = build_retry_selected_cards_for_sources(
                    conn,
                    source_by_deck_id,
                    retry_wrong_card_ids,
                )
            else:
                excluded_card_ids = list(set(pending_card_ids))
                writing_session_count = get_category_session_card_count_for_kid(kid, category_key)
                if writing_session_count <= 0:
                    conn.close()
                    return jsonify({
                        'category_key': category_key,
                        'pending_session_id': None,
                        'cards': [],
                        'planned_count': 0,
                        'is_continue_session': False,
                        'continue_source_session_id': None,
                        'is_retry_session': False,
                    }), 200
                preview_kid = with_preview_session_count_for_category(
                    kid,
                    category_key,
                    writing_session_count,
                )
                cards_by_id, selected_ids = plan_deck_practice_selection_for_decks(
                    conn,
                    preview_kid,
                    source_deck_ids,
                    category_key,
                    excluded_card_ids=excluded_card_ids
                )
                for card_id in selected_ids:
                    card = cards_by_id.get(card_id) or {}
                    local_deck_id = int(card.get('deck_id') or 0)
                    src = source_by_deck_id.get(local_deck_id) or {}
                    selected_cards.append({
                        **card,
                        'shared_deck_id': int(src['shared_deck_id']) if src.get('shared_deck_id') is not None else None,
                        'deck_id': local_deck_id,
                        'deck_name': str(src.get('local_name') or ''),
                        'source_tags': extract_shared_deck_tags_and_labels(src.get('tags') or [])[0],
                        'source_is_orphan': bool(src.get('is_orphan')),
                    })
        if len(selected_cards) == 0:
            conn.close()
            return jsonify({
                'category_key': category_key,
                'pending_session_id': None,
                'cards': [],
                'planned_count': 0,
                'is_continue_session': bool(is_continue_session),
                'continue_source_session_id': (
                    int(continue_source_session['session_id'])
                    if is_continue_session and continue_source_session is not None
                    else None
                ),
                'is_retry_session': bool(is_retry_session),
                'retry_source_session_id': (
                    int(retry_source_session['session_id'])
                    if is_retry_session and retry_source_session is not None
                    else None
                ),
            }), 200

        pending_session_payload = {
            'kind': category_key,
            'planned_count': len(selected_cards),
            'cards': [{'id': int(card['id'])} for card in selected_cards],
        }
        if is_continue_session and continue_source_session is not None:
            pending_session_payload[PENDING_CONTINUE_SOURCE_SESSION_ID_KEY] = int(continue_source_session['session_id'])
        if is_retry_session and retry_source_session is not None:
            pending_session_payload[PENDING_RETRY_SOURCE_SESSION_ID_KEY] = int(retry_source_session['session_id'])
        pending_session_id = create_pending_session(
            kid_id,
            category_key,
            pending_session_payload,
        )
        conn.close()

        cards_with_audio = []
        for card in selected_cards:
            audio_meta = build_writing_prompt_audio_payload(
                kid_id,
                card.get('front'),
                category_key=category_key,
                has_chinese_specific_logic=has_chinese_specific_logic,
            )
            cards_with_audio.append({
                **card,
                'audio_file_name': audio_meta['audio_file_name'],
                'audio_mime_type': audio_meta['audio_mime_type'],
                'audio_url': audio_meta['audio_url'],
                'prompt_audio_url': audio_meta['prompt_audio_url'],
            })

        return jsonify({
            'category_key': category_key,
            'pending_session_id': pending_session_id,
            'planned_count': len(cards_with_audio),
            'cards': cards_with_audio,
            'is_continue_session': bool(is_continue_session),
            'continue_source_session_id': (
                int(continue_source_session['session_id'])
                if is_continue_session and continue_source_session is not None
                else None
            ),
            'is_retry_session': bool(is_retry_session),
            'retry_source_session_id': (
                int(retry_source_session['session_id'])
                if is_retry_session and retry_source_session is not None
                else None
            ),
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/cards/practice/start', methods=['POST'])
def start_type1_practice_session(kid_id):
    """Start a merged type-I session from opted-in decks (+ orphan option)."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        payload = request.get_json(silent=True) or {}
        category_key, _ = resolve_kid_type_i_category_with_mode(
            kid,
            payload.get('categoryKey') or request.args.get('categoryKey'),
        )
        response_payload, status_code = start_type_i_practice_session_internal(
            kid_id,
            kid,
            category_key,
            include_multiple_choice_pool_cards=True,
        )
        return jsonify(response_payload), status_code
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type4/practice/start', methods=['POST'])
def start_type4_practice_session(kid_id):
    """Start one generator practice session for an opted-in category."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        payload = request.get_json(silent=True) or {}
        category_key, _ = resolve_kid_type_iv_category_with_mode(
            kid,
            payload.get('categoryKey') or request.args.get('categoryKey'),
        )
        practice_mode = normalize_type_iv_practice_mode(payload.get('practiceMode'))

        conn = get_kid_connection_for(kid)
        try:
            practice_sources = get_type_iv_practice_source_rows(conn, kid, category_key)
            practice_source_by_card_id = {
                int(source.get('representative_card_id') or 0): source
                for source in practice_sources
                if int(source.get('representative_card_id') or 0) > 0
            }
            continue_source_session = get_latest_unfinished_session_for_today(conn, kid, category_key)
            is_continue_session = continue_source_session is not None
            retry_source_session = None
            is_retry_session = False
            pending_items = []
            response_cards = []

            if is_continue_session:
                missing_count = max(
                    0,
                    int(continue_source_session['planned_count']) - int(continue_source_session['answer_count']),
                )
                count_by_source_key = build_type_iv_continue_count_by_source_key(
                    practice_sources,
                    missing_count,
                )
                pending_items, response_cards = build_type_iv_pending_items_for_sources(
                    practice_sources,
                    count_by_source_key,
                    practice_mode,
                )
            else:
                retry_source_session = get_latest_retry_source_session_for_today(conn, kid, category_key)
                is_retry_session = retry_source_session is not None
                if is_retry_session:
                    retry_rows = get_type_iv_retry_source_result_rows(
                        conn,
                        retry_source_session['session_id'],
                        [source.get('representative_card_id') for source in practice_sources],
                    )
                    pending_items = [{
                        'id': int(row['result_id']),
                        'representative_card_id': int(row['representative_card_id']),
                        'prompt': str(row['prompt'] or ''),
                        'answer': str(row['answer'] or ''),
                        'distractor_answers': [str(item) for item in list(row.get('distractor_answers') or [])],
                        'is_multichoice_only': bool(
                            (
                                practice_source_by_card_id.get(int(row['representative_card_id']))
                                or {}
                            ).get('is_multichoice_only')
                        ),
                    } for row in retry_rows]
                    response_cards = [
                        map_type_iv_pending_item_to_response_card(item, practice_mode)
                        for item in pending_items
                    ]
                else:
                    count_by_source_key = build_type_iv_initial_count_by_source_key(practice_sources)
                    pending_items, response_cards = build_type_iv_pending_items_for_sources(
                        practice_sources,
                        count_by_source_key,
                        practice_mode,
                    )

            if len(response_cards) == 0:
                return jsonify({
                    'category_key': category_key,
                    'pending_session_id': None,
                    'cards': [],
                    'planned_count': 0,
                    'practice_mode': practice_mode,
                    'is_continue_session': bool(is_continue_session),
                    'continue_source_session_id': (
                        int(continue_source_session['session_id'])
                        if is_continue_session and continue_source_session is not None
                        else None
                    ),
                    'is_retry_session': bool(is_retry_session),
                    'retry_source_session_id': (
                        int(retry_source_session['session_id'])
                        if is_retry_session and retry_source_session is not None
                        else None
                    ),
                }), 200

            pending_session_payload = {
                'kind': category_key,
                'planned_count': len(response_cards),
                'practice_mode': practice_mode,
                'cards': pending_items,
            }
            if is_continue_session and continue_source_session is not None:
                pending_session_payload[PENDING_CONTINUE_SOURCE_SESSION_ID_KEY] = int(continue_source_session['session_id'])
            if is_retry_session and retry_source_session is not None:
                pending_session_payload[PENDING_RETRY_SOURCE_SESSION_ID_KEY] = int(retry_source_session['session_id'])
            pending_session_id = create_pending_session(
                kid_id,
                category_key,
                pending_session_payload,
            )
        finally:
            conn.close()

        return jsonify({
            'category_key': category_key,
            'pending_session_id': pending_session_id,
            'planned_count': len(response_cards),
            'cards': response_cards,
            'practice_mode': practice_mode,
            'is_continue_session': bool(is_continue_session),
            'continue_source_session_id': (
                int(continue_source_session['session_id'])
                if is_continue_session and continue_source_session is not None
                else None
            ),
            'is_retry_session': bool(is_retry_session),
            'retry_source_session_id': (
                int(retry_source_session['session_id'])
                if is_retry_session and retry_source_session is not None
                else None
            ),
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/practice/start', methods=['POST'])
def start_type3_practice_session(kid_id):
    """Start a merged type-III session from opted-in decks (+ optional orphan)."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        payload = request.get_json(silent=True) or {}
        category_key, _ = resolve_kid_type_iii_category_with_mode(
            kid,
            payload.get('categoryKey') or request.args.get('categoryKey'),
        )
        response_payload, status_code = start_type_i_practice_session_internal(
            kid_id,
            kid,
            category_key,
            pending_session_payload_extras={
                'type3_audio_dir': ensure_type3_audio_dir(kid),
            },
        )
        return jsonify(response_payload), status_code
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/practice/upload-audio', methods=['POST'])
def upload_type3_practice_audio(kid_id):
    """Upload one type-III recording clip for an active pending session."""
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

        category_key, _ = resolve_kid_type_iii_category_with_mode(
            kid,
            request.form.get('categoryKey') or request.args.get('categoryKey'),
        )
        pending = get_pending_session(pending_session_id, kid_id, category_key)
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

        audio_dir = ensure_type3_audio_dir(kid)
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
                or str(live.get('session_type')) != category_key
            ):
                try:
                    os.remove(file_path)
                except Exception:
                    pass
                return jsonify({'error': 'Pending session not found or expired'}), 404

            type3_audio_by_card = live.get('type3_audio_by_card')
            if not isinstance(type3_audio_by_card, dict):
                type3_audio_by_card = {}
                live['type3_audio_by_card'] = type3_audio_by_card
            if not str(live.get('type3_audio_dir') or '').strip():
                live['type3_audio_dir'] = audio_dir

            old_meta = type3_audio_by_card.get(str(card_id))
            if isinstance(old_meta, dict):
                old_file_name = str(old_meta.get('file_name') or '').strip() or None

            type3_audio_by_card[str(card_id)] = {
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
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/cards/practice/complete', methods=['POST'])
def complete_type1_practice_session(kid_id):
    """Complete one type-I practice session with all answers."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        payload_data = request.get_json(silent=True) or {}
        category_key, _ = resolve_kid_type_i_category_with_mode(
            kid,
            payload_data.get('categoryKey') or request.args.get('categoryKey'),
        )

        payload, status_code = complete_session_internal(
            kid,
            kid_id,
            category_key,
            payload_data
        )
        return jsonify(payload), status_code
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/practice/complete', methods=['POST'])
def complete_type3_practice_session(kid_id):
    """Complete a type-III practice session with all answers."""
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
                'categoryKey': request.form.get('categoryKey') or request.args.get('categoryKey'),
                '_uploaded_type3_audio_by_card': uploaded_audio_by_card,
            }
        else:
            payload_data = request.get_json() or {}

        category_key, _ = resolve_kid_type_iii_category_with_mode(
            kid,
            payload_data.get('categoryKey') or request.args.get('categoryKey'),
        )
        payload, status_code = complete_session_internal(
            kid,
            kid_id,
            category_key,
            payload_data
        )
        return jsonify(payload), status_code
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type2/practice/complete', methods=['POST'])
def complete_writing_practice_session(kid_id):
    """Complete a type-II practice session with all answers."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload_data = request.get_json() or {}
        category_key, _ = resolve_kid_type_ii_category_with_mode(
            kid,
            payload_data.get('categoryKey') or request.args.get('categoryKey'),
        )
        payload, status_code = complete_session_internal(
            kid,
            kid_id,
            category_key,
            payload_data
        )
        return jsonify(payload), status_code
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type4/practice/complete', methods=['POST'])
def complete_type4_practice_session(kid_id):
    """Complete one generator practice session with server-side grading."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload_data = request.get_json() or {}
        category_key, _ = resolve_kid_type_iv_category_with_mode(
            kid,
            payload_data.get('categoryKey') or request.args.get('categoryKey'),
        )
        payload, status_code = complete_session_internal(
            kid,
            kid_id,
            category_key,
            payload_data
        )
        return jsonify(payload), status_code
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500
