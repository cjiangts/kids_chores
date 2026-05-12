"""Resolve and validate a category key against one kid's opt-ins.

Helpers that:
  - Look up one category by key, check its behavior + chinese-logic flags,
    confirm the kid's family has access, and confirm the kid is opted in.
  - Handle the default-when-unique fallback for callers that don't pass an
    explicit category key.
  - Provide per-behavior thin wrappers (type-I, type-II, type-III, type-IV)
    that supply the expected behavior set + error messages.

All helpers raise `ValueError` on validation failure — route handlers wrap
those into 4xx responses. No module state.

Layout:
  1. Single-behavior resolver + type-I + type-I-Chinese variants
  2. Multi-behavior resolver returning chinese-specific mode flag
  3. Per-behavior thin wrappers (type-I/II/III/IV with custom error messages)
"""
from src.routes.kids_constants import (
    DECK_CATEGORY_BEHAVIOR_TYPE_I,
    DECK_CATEGORY_BEHAVIOR_TYPE_II,
    DECK_CATEGORY_BEHAVIOR_TYPE_III,
    DECK_CATEGORY_BEHAVIOR_TYPE_IV,
)
from src.services.family_auth import can_family_access_deck_category
from src.services.kid_daily_progress import get_kid_opted_in_deck_category_keys
from src.services.shared_deck_category import get_shared_deck_category_meta_by_key
from src.services.shared_deck_normalize import normalize_shared_deck_tag


# =====================================================================
# === 1. Single-behavior resolver + type-I + type-I-Chinese variants
# =====================================================================

def resolve_kid_deck_category_key_for_behavior(
    kid,
    raw_category_key,
    *,
    expected_behavior_type,
    expected_has_chinese_specific_logic,
    conn=None,
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

    opted_in_keys = set(get_kid_opted_in_deck_category_keys(kid, conn=conn))
    if key not in opted_in_keys:
        raise ValueError(f'Kid is not opted-in to categoryKey: {key}')
    return key


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


def resolve_kid_type_i_chinese_category_key(kid, raw_category_key, *, allow_default=True):
    """Resolve category key for type-I Chinese-specific deck management."""
    return resolve_kid_type_i_category_key(
        kid,
        raw_category_key,
        has_chinese_specific_logic=True,
        allow_default=allow_default,
    )


# =====================================================================
# === 2. Multi-behavior resolver returning chinese-specific mode flag
# =====================================================================

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
    conn=None,
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
            conn=conn,
        )
        return resolved_category_key, has_chinese_specific_logic

    if not allow_default:
        raise ValueError('categoryKey is required')

    opted_in_keys = set(get_kid_opted_in_deck_category_keys(kid, conn=conn))
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


# =====================================================================
# === 3. Per-behavior thin wrappers (type-I/II/III/IV with custom error messages)
# =====================================================================

def resolve_kid_type_i_category_with_mode(kid, raw_category_key, *, conn=None):
    """Resolve explicit type-I/type-III category key and return its chinese-specific mode flag."""
    return resolve_kid_category_with_mode(
        kid,
        raw_category_key,
        {DECK_CATEGORY_BEHAVIOR_TYPE_I, DECK_CATEGORY_BEHAVIOR_TYPE_III},
        allow_default=False,
        wrong_type_error='categoryKey must be a type-I or type-III deck category',
        conn=conn,
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
