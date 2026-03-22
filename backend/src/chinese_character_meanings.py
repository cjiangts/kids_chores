"""Short English gloss and pinyin lookup for single Chinese characters.

Looks up from the chinese_character_bank table in the shared decks DB.
Falls back gracefully if the table doesn't exist yet.
"""

from __future__ import annotations

import re

from src.db.shared_deck_db import get_shared_decks_connection


ENGLISH_MEANING_MARKER = "\nEN: "
SINGLE_CHINESE_CHAR_RE = re.compile(r"^[\u3400-\u9FFF\uF900-\uFAFF]$")


def _normalize_text(value) -> str:
    return str(value or "").strip()


def is_single_chinese_character(value) -> bool:
    return bool(SINGLE_CHINESE_CHAR_RE.fullmatch(_normalize_text(value)))


def compose_chinese_back(pinyin, meaning) -> str:
    pinyin_text = _normalize_text(pinyin)
    meaning_text = _normalize_text(meaning)
    if not meaning_text:
        return pinyin_text
    if not pinyin_text:
        return f"{ENGLISH_MEANING_MARKER.lstrip()}{meaning_text}"
    return f"{pinyin_text}{ENGLISH_MEANING_MARKER}{meaning_text}"


def _lookup_character_bank(char: str) -> dict | None:
    """Look up a character from chinese_character_bank. Returns {pinyin, en} or None."""
    try:
        conn = get_shared_decks_connection(read_only=True)
        try:
            row = conn.execute(
                "SELECT pinyin, en FROM chinese_character_bank WHERE character = ?",
                [char],
            ).fetchone()
            if row:
                return {'pinyin': str(row[0] or '').strip(), 'en': str(row[1] or '').strip()}
        finally:
            conn.close()
    except Exception:
        pass
    return None


def get_short_chinese_character_meaning(value) -> str:
    text = _normalize_text(value)
    if not is_single_chinese_character(text):
        return ""
    data = _lookup_character_bank(text)
    return data['en'] if data and data.get('en') else ""


def get_character_bank_pinyin(value) -> str:
    """Get pinyin from the character bank, or empty string if not found."""
    text = _normalize_text(value)
    if not is_single_chinese_character(text):
        return ""
    data = _lookup_character_bank(text)
    return data['pinyin'] if data and data.get('pinyin') else ""


def build_single_character_back(front_text, pinyin_text) -> str:
    pinyin = _normalize_text(pinyin_text)
    meaning = get_short_chinese_character_meaning(front_text)
    return compose_chinese_back(pinyin, meaning) or pinyin
