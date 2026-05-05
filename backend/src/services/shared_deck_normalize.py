"""Normalizers / dedupers for shared-deck tags, cards, payloads.

Pure helpers extracted from `src.routes.kids` Phase 2 refactor.
"""
import re

from src.routes.kids_constants import (
    DECK_CATEGORY_BEHAVIOR_TYPES,
    MAX_SHARED_DECK_CARDS,
    MAX_SHARED_DECK_OPTIN_BATCH,
    MAX_SHARED_DECK_TAGS,
    MAX_SHARED_TAG_COMMENT_LENGTH,
    MAX_SHARED_TAG_LENGTH,
    MAX_TYPE_IV_DAILY_TARGET_COUNT,
    MAX_TYPE_IV_DISPLAY_LABEL_LENGTH,
    MAX_TYPE_IV_GENERATOR_CODE_LENGTH,
)


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


def normalize_shared_deck_cards(cards, allow_empty_back=False):
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
        if not front:
            raise ValueError(f'cards[{index}] requires non-empty front')
        if not back and not allow_empty_back:
            raise ValueError(f'cards[{index}] requires non-empty front and back')
        normalized.append({'front': front, 'back': back})
    return normalized


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


def dedupe_shared_deck_cards_by_front(cards):
    """Deduplicate cards by front text, preserving first-seen order."""
    return dedupe_shared_deck_cards_by_key(cards, 'front')


def dedupe_shared_deck_cards_by_back(cards):
    """Deduplicate cards by back text, preserving first-seen order."""
    return dedupe_shared_deck_cards_by_key(cards, 'back')


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
