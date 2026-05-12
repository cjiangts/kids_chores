"""Shared-deck category metadata cache + session-type behavior resolution.

This module owns:
  * A cached, in-memory snapshot (30s TTL) of the `categories` table from the
    shared-decks DB, keyed by normalized category key.
  * Helpers to invalidate that cache when shared-deck category rows change.
  * Helpers that resolve a `session_type` / category-key string to its
    behavior type (type_i / type_ii / type_iii / type_iv).

Extracted from `src.routes.kids` Phase 2 refactor.
"""
import time

from src.db.shared_deck_db import get_shared_decks_connection
from src.routes.kids_constants import (
    DECK_CATEGORY_BEHAVIOR_TYPE_I,
    DECK_CATEGORY_BEHAVIOR_TYPE_III,
    DECK_CATEGORY_BEHAVIOR_TYPES,
)
from src.services.shared_deck_normalize import (
    normalize_shared_deck_category_behavior,
    normalize_shared_deck_tag,
)


_category_meta_cache = {'data': None, 'ts': 0}
_CATEGORY_META_CACHE_TTL = 30


def invalidate_category_meta_cache():
    """Clear the in-memory category metadata cache."""
    _category_meta_cache['data'] = None
    _category_meta_cache['ts'] = 0


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
          chinese_back_content
        FROM deck_category
        ORDER BY category_key ASC
        """
    ).fetchall()
    categories = []
    for row in rows:
        behavior_type = str(row[1] or '').strip().lower()
        if behavior_type not in DECK_CATEGORY_BEHAVIOR_TYPES:
            continue
        has_chinese = bool(row[2])
        is_type_i = (behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_I)
        chinese_back_content = str(row[5] or '').strip().lower() if (has_chinese and is_type_i) else ''
        if chinese_back_content not in ('pinyin', 'english'):
            chinese_back_content = ''
        categories.append({
            'category_key': str(row[0] or ''),
            'behavior_type': behavior_type,
            'has_chinese_specific_logic': has_chinese,
            'is_shared_with_non_super_family': bool(row[3]),
            'display_name': str(row[4] or '').strip(),
            'chinese_back_content': chinese_back_content,
        })
    return categories


def get_shared_deck_category_meta_by_key():
    """Return deck_category metadata map keyed by normalized category key.

    Results are cached in memory for up to 30 seconds to avoid opening a
    shared-DB connection on every single API call.
    """
    now = time.monotonic()
    if _category_meta_cache['data'] is not None and (now - _category_meta_cache['ts']) < _CATEGORY_META_CACHE_TTL:
        return _category_meta_cache['data']

    conn = get_shared_decks_connection(read_only=True)
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
            'chinese_back_content': str(item.get('chinese_back_content') or '').strip().lower(),
        }
    _category_meta_cache['data'] = metadata_by_key
    _category_meta_cache['ts'] = now
    return metadata_by_key


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
