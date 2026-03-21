"""Generate chinese_character_bank.json from meanings JSON + pypinyin.

Run this locally to regenerate the pre-built data file.
The server startup loads this file directly (no pypinyin needed at runtime).
"""

import json
import os

from pypinyin import pinyin, Style
from pypinyin_dict.phrase_pinyin_data import cc_cedict
from pypinyin_dict.pinyin_data import kxhc1983

cc_cedict.load()
kxhc1983.load()

MEANINGS_PATH = os.path.join(os.path.dirname(__file__), '..', 'src', 'resources', 'chinese_character_meanings.json')
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'src', 'resources', 'chinese_character_bank.json')

with open(MEANINGS_PATH, 'r', encoding='utf-8') as f:
    meanings = json.load(f)

bank = {}
for char, en in meanings.items():
    char = char.strip()
    en = en.strip()
    if not char or not en:
        continue
    readings = pinyin(
        char,
        style=Style.TONE,
        heteronym=True,
        neutral_tone_with_five=True,
        strict=False,
        errors='default',
    )
    first_group = readings[0] if readings else []
    seen = set()
    ordered = []
    for item in first_group:
        syllable = str(item or '').strip()
        if syllable and syllable not in seen:
            ordered.append(syllable)
            seen.add(syllable)
    pinyin_str = ' / '.join(ordered) if ordered else ''
    if not pinyin_str:
        continue
    bank[char] = {'pinyin': pinyin_str, 'en': en}

with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(bank, f, ensure_ascii=False)

print(f"Generated {len(bank)} entries -> {OUTPUT_PATH}")
