"""Lookup helpers for the chinese character/vocabulary banks.

chinese_character_bank backs single-character decks (pinyin).
chinese_vocabulary_bank backs vocabulary decks (english meaning).
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


def _query_with_conn(conn, query: str, params: list) -> str:
    def _run(c):
        row = c.execute(query, params).fetchone()
        return str(row[0] or '').strip() if row else ""

    try:
        if conn is not None:
            return _run(conn)
        owned = get_shared_decks_connection(read_only=True)
        try:
            return _run(owned)
        finally:
            owned.close()
    except Exception:
        return ""


def get_character_bank_pinyin(value, conn=None) -> str:
    """Pinyin for a single Chinese character. Empty if not found."""
    text = _normalize_text(value)
    if not is_single_chinese_character(text):
        return ""
    return _query_with_conn(
        conn,
        "SELECT pinyin FROM chinese_character_bank WHERE character = ?",
        [text],
    )


def get_bank_meaning(value, conn=None) -> str:
    """English meaning for a Chinese vocabulary word. Empty if not found."""
    text = _normalize_text(value)
    if not is_chinese_text(text):
        return ""
    return _query_with_conn(
        conn,
        "SELECT en FROM chinese_vocabulary_bank WHERE word = ?",
        [text],
    )
