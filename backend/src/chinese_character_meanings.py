"""Lookup helpers for the chinese_character_bank table.

The bank's `character` column may contain 1+ Chinese characters. Single-char
rows back character decks (pinyin as the card back); multi-char rows back
vocabulary decks (english meaning as the card back).
"""

from __future__ import annotations

import re

from src.db.shared_deck_db import get_shared_decks_connection


SINGLE_CHINESE_CHAR_RE = re.compile(r"^[\u3400-\u9FFF\uF900-\uFAFF]$")
CHINESE_TEXT_RE = re.compile(r"^[\u3400-\u9FFF\uF900-\uFAFF]+$")


def _normalize_text(value) -> str:
    return str(value or "").strip()


def is_single_chinese_character(value) -> bool:
    return bool(SINGLE_CHINESE_CHAR_RE.fullmatch(_normalize_text(value)))


def is_chinese_text(value) -> bool:
    return bool(CHINESE_TEXT_RE.fullmatch(_normalize_text(value)))


def _lookup_bank(text: str, conn=None) -> dict | None:
    """Look up one entry in chinese_character_bank. Returns {pinyin, en} or None.

    Pass an existing connection to batch lookups without reopening the DB.
    """
    def _query(c):
        row = c.execute(
            "SELECT pinyin, en FROM chinese_character_bank WHERE character = ?",
            [text],
        ).fetchone()
        if row:
            return {'pinyin': str(row[0] or '').strip(), 'en': str(row[1] or '').strip()}
        return None

    try:
        if conn is not None:
            return _query(conn)
        owned = get_shared_decks_connection(read_only=True)
        try:
            return _query(owned)
        finally:
            owned.close()
    except Exception:
        return None


def get_character_bank_pinyin(value, conn=None) -> str:
    """Pinyin for a single Chinese character from the bank. Empty if not found."""
    text = _normalize_text(value)
    if not is_single_chinese_character(text):
        return ""
    data = _lookup_bank(text, conn=conn)
    return data['pinyin'] if data and data.get('pinyin') else ""


def get_bank_meaning(value, conn=None) -> str:
    """English meaning for any Chinese text from the bank. Empty if not found."""
    text = _normalize_text(value)
    if not is_chinese_text(text):
        return ""
    data = _lookup_bank(text, conn=conn)
    return data['en'] if data and data.get('en') else ""
