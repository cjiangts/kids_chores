"""One-time script to populate chinese_character_bank from the JSON meanings file + pypinyin."""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

import duckdb
from pypinyin import pinyin, Style
from pypinyin_dict.phrase_pinyin_data import cc_cedict
from pypinyin_dict.pinyin_data import kxhc1983

# Load better dictionaries
cc_cedict.load()
kxhc1983.load()

# Paths
JSON_PATH = os.path.join(os.path.dirname(__file__), '..', 'src', 'resources', 'chinese_character_meanings.json')
DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'shared_decks.duckdb')

# Load JSON meanings
with open(JSON_PATH, 'r', encoding='utf-8') as f:
    meanings = json.load(f)

# Generate pinyin for each character
rows = []
for char, en in meanings.items():
    char = char.strip()
    en = en.strip()
    if not char or not en:
        continue
    # Get all heteronym readings
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
    rows.append((char, pinyin_str, en))

print(f"Prepared {len(rows)} characters for insertion.")

# Insert into DB
conn = duckdb.connect(DB_PATH)
conn.execute("DROP TABLE IF EXISTS chinese_character_bank")
conn.execute("""
    CREATE TABLE chinese_character_bank (
        character VARCHAR PRIMARY KEY,
        pinyin VARCHAR NOT NULL,
        en VARCHAR NOT NULL,
        used BOOLEAN NOT NULL DEFAULT FALSE,
        verified BOOLEAN NOT NULL DEFAULT FALSE,
        last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
""")
conn.executemany(
    "INSERT INTO chinese_character_bank (character, pinyin, en) VALUES (?, ?, ?)",
    rows,
)
count = conn.execute("SELECT COUNT(*) FROM chinese_character_bank").fetchone()[0]
print(f"Inserted {count} rows into chinese_character_bank.")
conn.close()
