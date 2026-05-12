"""Chinese-text helpers: pinyin generation, auto back-text fill, category lookups."""
from src.chinese_character_meanings import (
    get_bank_meaning,
    get_character_bank_pinyin,
    is_chinese_text,
    is_single_chinese_character,
)
from src.services.shared_deck_category import get_shared_deck_category_meta_by_key
from src.services.shared_deck_normalize import (
    extract_shared_deck_tags_and_labels,
    normalize_shared_deck_tag,
)


CHINESE_BACK_CONTENT_PINYIN = 'pinyin'
CHINESE_BACK_CONTENT_ENGLISH = 'english'
CHINESE_BACK_CONTENTS = (CHINESE_BACK_CONTENT_PINYIN, CHINESE_BACK_CONTENT_ENGLISH)


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


def normalize_chinese_back_content(value):
    """Return one of CHINESE_BACK_CONTENTS, or empty string if unrecognized."""
    text = str(value or '').strip().lower()
    return text if text in CHINESE_BACK_CONTENTS else ''


def build_chinese_auto_back_text(text, back_content, *, generated_pinyin=None, conn=None):
    """Build the stored back text for one Chinese card.

    back_content='pinyin'  -> character deck (single char). Bank pinyin wins
      over pypinyin; falls back to pypinyin when the char is not in the bank.
    back_content='english' -> vocabulary deck (1+ chars). Bank meaning only;
      empty when the text is not in the bank (caller can accept empty or
      require the user to fill it manually).
    Pass an existing shared-DB connection to batch bank lookups.
    """
    normalized = str(text or '').strip()
    if not normalized:
        return ''
    mode = normalize_chinese_back_content(back_content)
    if mode == CHINESE_BACK_CONTENT_PINYIN:
        if not is_single_chinese_character(normalized):
            return ''
        bank_pinyin = get_character_bank_pinyin(normalized, conn=conn)
        if bank_pinyin:
            return bank_pinyin
        if generated_pinyin is not None:
            return str(generated_pinyin).strip()
        return build_chinese_pinyin_text(normalized)
    if mode == CHINESE_BACK_CONTENT_ENGLISH:
        if not is_chinese_text(normalized):
            return ''
        return get_bank_meaning(normalized, conn=conn)
    return ''


def get_shared_deck_chinese_back_content(conn, raw_tags):
    """Return chinese_back_content ('pinyin'|'english'|'') for a shared deck row."""
    tags = extract_shared_deck_tags_and_labels(raw_tags)[0]
    first_tag = normalize_shared_deck_tag(tags[0]) if tags else ''
    if not first_tag:
        return ''
    row = conn.execute(
        """
        SELECT chinese_back_content
        FROM deck_category
        WHERE category_key = ? AND has_chinese_specific_logic = TRUE
        LIMIT 1
        """,
        [first_tag],
    ).fetchone()
    if not row:
        return ''
    return normalize_chinese_back_content(row[0])


def get_category_chinese_back_content(category_key):
    """Return chinese_back_content for one category key (cached)."""
    key = normalize_shared_deck_tag(category_key)
    if not key:
        return ''
    metadata = get_shared_deck_category_meta_by_key()
    entry = metadata.get(key) or {}
    if not entry.get('has_chinese_specific_logic'):
        return ''
    return normalize_chinese_back_content(entry.get('chinese_back_content'))
