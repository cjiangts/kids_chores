"""Shared stroke identities, vector shapes, and spoken names; no per-kid copies."""
import json
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def get_chinese_stroke_dictionary():
    path = Path(__file__).resolve().parents[1] / 'data' / 'chinese_strokes.json'
    return json.loads(path.read_text(encoding='utf-8'))


@lru_cache(maxsize=1)
def stroke_characters():
    return {
        character: stroke
        for stroke in get_chinese_stroke_dictionary()['strokes']
        for character in [stroke['character'], *stroke['aliases']]
    }


def stroke_spoken_text(text):
    """Only map dedicated stroke characters, never ordinary words such as 一."""
    lookup = stroke_characters()
    return '，'.join(lookup[char]['name'] for char in text) if text and all(char in lookup for char in text) else ''.join(
        lookup[char]['name'] if char in lookup else char for char in text
    )
