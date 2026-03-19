"""Short English gloss lookup for single Chinese characters."""

from __future__ import annotations

import json
import os
import re
import threading


ENGLISH_MEANING_MARKER = "\nEN: "
SINGLE_CHINESE_CHAR_RE = re.compile(r"^[\u3400-\u9FFF\uF900-\uFAFF]$")
DATA_FILE_PATH = os.path.join(
    os.path.dirname(__file__),
    "resources",
    "chinese_character_meanings.json",
)

_meaning_by_char = None
_meaning_lock = threading.Lock()


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


def _load_meaning_by_char() -> dict[str, str]:
    global _meaning_by_char
    if isinstance(_meaning_by_char, dict):
        return _meaning_by_char
    with _meaning_lock:
        if isinstance(_meaning_by_char, dict):
            return _meaning_by_char
        try:
            with open(DATA_FILE_PATH, "r", encoding="utf-8") as handle:
                loaded = json.load(handle)
        except FileNotFoundError:
            loaded = {}
        except Exception:
            loaded = {}
        _meaning_by_char = {
            _normalize_text(key): _normalize_text(value)
            for key, value in dict(loaded or {}).items()
            if _normalize_text(key) and _normalize_text(value)
        }
        return _meaning_by_char


def get_short_chinese_character_meaning(value) -> str:
    text = _normalize_text(value)
    if not is_single_chinese_character(text):
        return ""
    return str(_load_meaning_by_char().get(text) or "").strip()


def build_single_character_back(front_text, pinyin_text) -> str:
    pinyin = _normalize_text(pinyin_text)
    meaning = get_short_chinese_character_meaning(front_text)
    return compose_chinese_back(pinyin, meaning) or pinyin
