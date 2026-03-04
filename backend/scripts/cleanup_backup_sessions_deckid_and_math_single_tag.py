#!/usr/bin/env python3
"""One-time cleanup and migration for full backup zips.

Actions:
1) Drop sessions.deck_id from kid DBs in the backup zip.
2) Remove shared decks whose only tag is 'math' and delete their cards.
3) Rewrite sessions.type legacy values to deck category keys.
4) Populate deck_category display_name/emoji/share access in shared_decks.duckdb.
5) Drop obsolete writing candidate queue tables from kid DBs.
6) Migrate kids.json per-category settings into kid DB deck_category_opt_in columns.
7) Prefix type-III card backs with "Page " in shared and kid DBs.
"""

import argparse
import json
import os
import re
import tempfile
import zipfile

import duckdb


MAX_SESSION_CARD_COUNT = 200
DEFAULT_HARD_CARD_PERCENTAGE = 0
DEFAULT_INCLUDE_ORPHAN = True

SESSION_CARD_COUNT_BY_CATEGORY_FIELD = "sessionCardCountByCategory"
HARD_CARD_PERCENT_BY_CATEGORY_FIELD = "hardCardPercentageByCategory"
INCLUDE_ORPHAN_BY_CATEGORY_FIELD = "includeOrphanByCategory"

KID_DECK_CATEGORY_OPT_IN_TABLE = "deck_category_opt_in"
KID_DECK_CATEGORY_OPT_IN_COL_IS_OPTED_IN = "is_opted_in"
KID_DECK_CATEGORY_OPT_IN_COL_SESSION_CARD_COUNT = "session_card_count"
KID_DECK_CATEGORY_OPT_IN_COL_HARD_CARD_PERCENTAGE = "hard_card_percentage"
KID_DECK_CATEGORY_OPT_IN_COL_INCLUDE_ORPHAN = "include_orphan"
KID_DB_NAME_PATTERN = re.compile(r"(?:^|/)kid_(\d+)\.(?:db|duckdb)$", re.IGNORECASE)

BEHAVIOR_TYPE_I = "type_i"
BEHAVIOR_TYPE_II = "type_ii"
BEHAVIOR_TYPE_III = "type_iii"
VALID_BEHAVIOR_TYPES = {BEHAVIOR_TYPE_I, BEHAVIOR_TYPE_II, BEHAVIOR_TYPE_III}

LEGACY_SESSION_TYPE_TO_CATEGORY_KEY = {
    "flashcard": "chinese_characters",
    "math": "math",
    "writing": "chinese_writing",
    "lesson_reading": "chinese_reading",
}

LEGACY_SHARED_CATEGORY_ROWS = [
    ("math", "type_i", False, True, "Math", "➗"),
    ("chinese_characters", "type_i", True, True, "Chinese Characters", "📖"),
    ("chinese_writing", "type_ii", True, True, "Chinese Writing", "✍️"),
    ("chinese_reading", "type_iii", True, True, "Chinese Reading", "📚"),
]

LEGACY_WRITING_QUEUE_TABLES = (
    "writing_practicing_queue",
    "writing_practicing_queue_meta",
)

SHARED_TAG_COMMENT_MIGRATIONS = {
    "maprek": "马立平学前班",
    "siwukuaidu": "四五快读",
}

DEPRECATED_KID_FIELDS_TO_DROP = (
    "sessionCardCount",
    "type1SessionCardCountByCategory",
    "type1HardCardPercentageByCategory",
    "type1IncludeOrphanByCategory",
    "type2SessionCardCountByCategory",
    "type2HardCardPercentageByCategory",
    "sharedMathSessionCardCount",
    "sharedChineseCharactersIncludeOrphan",
    "sharedChineseCharactersHardCardPercentage",
    "sharedMathHardCardPercentage",
    "sharedWritingHardCardPercentage",
    "sharedWritingIncludeOrphan",
    "writingSessionCardCount",
    "sharedLessonReadingSessionCardCount",
    "sharedLessonReadingHardCardPercentage",
    "sharedLessonReadingIncludeOrphan",
)


def _normalize_category_key(value):
    text = str(value or "").strip().lower()
    if not text:
        return ""
    text = re.sub(r"[\s\-]+", "_", text)
    text = re.sub(r"_+", "_", text).strip("_")
    return text


def _normalize_shared_tag_key(value):
    text = str(value or "").strip().lower()
    if not text:
        return ""
    text = re.sub(r"\([^()]*\)\s*$", "", text).strip()
    if not text:
        return ""
    text = re.sub(r"\s+", "_", text)
    text = re.sub(r"_+", "_", text).strip("_")
    return text


def _resolve_shared_tag_comment(key):
    normalized = _normalize_shared_tag_key(key)
    if not normalized:
        return ""
    if normalized in SHARED_TAG_COMMENT_MIGRATIONS:
        return SHARED_TAG_COMMENT_MIGRATIONS[normalized]
    if normalized != "math" and normalized.startswith("ma"):
        grade_match = re.match(r"^ma(\d+)$", normalized)
        if grade_match:
            return f"马立平{int(grade_match.group(1))}年级"
        return "马立平"
    return ""


def _migrate_shared_deck_tag_comments(conn):
    tables = _get_table_names(conn)
    if "deck" not in tables:
        return 0, 0

    deck_rows = conn.execute(
        """
        SELECT deck_id, name, tags, creator_family_id, created_at
        FROM deck
        ORDER BY deck_id ASC
        """
    ).fetchall()
    updated_deck_count = 0
    migrated_tag_count = 0
    migrated_deck_rows = []
    for row in deck_rows:
        deck_id = int(row[0])
        name = str(row[1] or "").strip()
        raw_tags = list(row[2] or [])
        creator_family_id = int(row[3])
        created_at = row[4]
        if not raw_tags:
            migrated_deck_rows.append(
                (deck_id, name, [], creator_family_id, created_at)
            )
            continue
        next_tags = []
        changed = False
        changed_in_row = 0
        for raw_tag in raw_tags:
            original = str(raw_tag or "").strip()
            if not original:
                continue
            key = _normalize_shared_tag_key(original)
            if not key:
                continue
            comment = _resolve_shared_tag_comment(key)
            if comment:
                migrated = f"{key}({comment})"
                next_tags.append(migrated)
                if migrated != original:
                    changed = True
                    changed_in_row += 1
            else:
                next_tags.append(original)

        if changed:
            updated_deck_count += 1
            migrated_tag_count += changed_in_row
        migrated_deck_rows.append(
            (deck_id, name, next_tags, creator_family_id, created_at)
        )

    if updated_deck_count <= 0:
        return 0, 0

    has_cards = "cards" in tables
    card_rows = []
    max_card_id = 0
    if has_cards:
        card_rows = conn.execute(
            "SELECT id, deck_id, front, back FROM cards ORDER BY id ASC"
        ).fetchall()
        if card_rows:
            max_card_id = max(int(row[0]) for row in card_rows)
    max_deck_id = 0
    if migrated_deck_rows:
        max_deck_id = max(int(row[0]) for row in migrated_deck_rows)

    if has_cards:
        conn.execute("DROP TABLE cards")
    conn.execute("DROP TABLE deck")
    conn.execute("DROP SEQUENCE IF EXISTS shared_deck_id_seq")
    conn.execute(f"CREATE SEQUENCE shared_deck_id_seq START {max_deck_id + 1}")
    conn.execute(
        """
        CREATE TABLE deck (
          deck_id INTEGER PRIMARY KEY DEFAULT nextval('shared_deck_id_seq'),
          name VARCHAR NOT NULL UNIQUE,
          tags VARCHAR[] NOT NULL DEFAULT [],
          creator_family_id INTEGER NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.executemany(
        """
        INSERT INTO deck (deck_id, name, tags, creator_family_id, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        migrated_deck_rows,
    )

    if has_cards:
        conn.execute("DROP SEQUENCE IF EXISTS shared_card_id_seq")
        conn.execute(f"CREATE SEQUENCE shared_card_id_seq START {max_card_id + 1}")
        conn.execute(
            """
            CREATE TABLE cards (
              id INTEGER PRIMARY KEY DEFAULT nextval('shared_card_id_seq'),
              deck_id INTEGER NOT NULL,
              front VARCHAR NOT NULL,
              back VARCHAR NOT NULL,
              FOREIGN KEY (deck_id) REFERENCES deck(deck_id),
              UNIQUE (deck_id, front)
            )
            """
        )
        if card_rows:
            conn.executemany(
                """
                INSERT INTO cards (id, deck_id, front, back)
                VALUES (?, ?, ?, ?)
                """,
                card_rows,
            )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_cards_deck_id_front ON cards(deck_id, front)"
        )

    return updated_deck_count, migrated_tag_count


def _to_int(value, minimum=0, maximum=MAX_SESSION_CARD_COUNT, default=0):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = int(default)
    if parsed < minimum:
        parsed = minimum
    if parsed > maximum:
        parsed = maximum
    return parsed


def _to_percent(value):
    return _to_int(value, minimum=0, maximum=100, default=DEFAULT_HARD_CARD_PERCENTAGE)


def _to_bool(value, default=False):
    if isinstance(value, bool):
        return value
    if value is None:
        return bool(default)
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "y", "on"}:
        return True
    if text in {"0", "false", "no", "n", "off", ""}:
        return False
    return bool(default)


def _extract_kid_id_from_entry_name(entry_name):
    match = KID_DB_NAME_PATTERN.search(str(entry_name or ""))
    if not match:
        return ""
    return str(match.group(1) or "").strip()


def _get_table_names(conn):
    return {str(row[0]) for row in conn.execute("SHOW TABLES").fetchall()}


def _drop_sessions_deck_id_if_present(conn):
    tables = _get_table_names(conn)
    if "sessions" not in tables:
        return False

    columns = [str(row[1]) for row in conn.execute("PRAGMA table_info('sessions')").fetchall()]
    if "deck_id" not in columns:
        return False

    # Drop sessions indexes first; DuckDB can block column drop if indexes remain.
    index_rows = conn.execute(
        "SELECT index_name FROM duckdb_indexes() WHERE table_name = 'sessions'"
    ).fetchall()
    for row in index_rows:
        index_name = str(row[0] or "").strip()
        if index_name:
            conn.execute(f'DROP INDEX IF EXISTS "{index_name}"')

    conn.execute("ALTER TABLE sessions DROP COLUMN deck_id")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_type_completed ON sessions(type, completed_at)"
    )
    return True


def _drop_legacy_writing_queue_tables_if_present(conn):
    tables = _get_table_names(conn)
    dropped_count = 0
    for table_name in LEGACY_WRITING_QUEUE_TABLES:
        if table_name in tables:
            dropped_count += 1
        conn.execute(f"DROP TABLE IF EXISTS {table_name}")
    return dropped_count


def _migrate_sessions_type_values(conn):
    tables = _get_table_names(conn)
    if "sessions" not in tables:
        return 0

    updated_count = 0
    for old_value, new_value in LEGACY_SESSION_TYPE_TO_CATEGORY_KEY.items():
        count_before = int(
            conn.execute(
                "SELECT COUNT(*) FROM sessions WHERE type = ?",
                [old_value],
            ).fetchone()[0]
            or 0
        )
        if count_before <= 0:
            continue
        conn.execute(
            "UPDATE sessions SET type = ? WHERE type = ?",
            [new_value, old_value],
        )
        updated_count += count_before
    return updated_count


def _remove_single_math_tag_shared_decks_if_present(conn):
    tables = _get_table_names(conn)
    if "deck" not in tables or "cards" not in tables:
        return 0, 0

    bad_ids = [
        int(row[0])
        for row in conn.execute(
            """
            SELECT deck_id
            FROM deck
            WHERE array_length(tags) = 1
              AND lower(tags[1]) = 'math'
            ORDER BY deck_id
            """
        ).fetchall()
    ]
    if not bad_ids:
        return 0, 0

    placeholders = ",".join(["?"] * len(bad_ids))
    card_count = int(
        conn.execute(
            f"SELECT COUNT(*) FROM cards WHERE deck_id IN ({placeholders})",
            bad_ids,
        ).fetchone()[0]
        or 0
    )
    conn.execute(f"DELETE FROM cards WHERE deck_id IN ({placeholders})", bad_ids)
    conn.execute(f"DELETE FROM deck WHERE deck_id IN ({placeholders})", bad_ids)
    return len(bad_ids), card_count


def _populate_shared_deck_category_display_data(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS deck_category (
          category_key VARCHAR PRIMARY KEY,
          behavior_type VARCHAR NOT NULL,
          has_chinese_specific_logic BOOLEAN NOT NULL DEFAULT FALSE,
          is_shared_with_non_super_family BOOLEAN NOT NULL DEFAULT FALSE,
          display_name VARCHAR,
          emoji VARCHAR
        )
        """
    )

    columns = {str(row[1]) for row in conn.execute("PRAGMA table_info('deck_category')").fetchall()}
    if "has_chinese_specific_logic" not in columns:
        conn.execute(
            "ALTER TABLE deck_category ADD COLUMN has_chinese_specific_logic BOOLEAN DEFAULT FALSE"
        )
    if "is_shared_with_non_super_family" not in columns:
        conn.execute(
            "ALTER TABLE deck_category ADD COLUMN is_shared_with_non_super_family BOOLEAN DEFAULT FALSE"
        )
    if "display_name" not in columns:
        conn.execute("ALTER TABLE deck_category ADD COLUMN display_name VARCHAR")
    if "emoji" not in columns:
        conn.execute("ALTER TABLE deck_category ADD COLUMN emoji VARCHAR")

    inserted = 0
    updated = 0
    for (
        category_key,
        behavior_type,
        has_chinese_logic,
        is_shared_with_non_super_family,
        display_name,
        emoji,
    ) in LEGACY_SHARED_CATEGORY_ROWS:
        row = conn.execute(
            """
            SELECT
                behavior_type,
                has_chinese_specific_logic,
                is_shared_with_non_super_family,
                display_name,
                emoji
            FROM deck_category
            WHERE category_key = ?
            """,
            [category_key],
        ).fetchone()

        if row is None:
            conn.execute(
                """
                INSERT INTO deck_category (
                    category_key,
                    behavior_type,
                    has_chinese_specific_logic,
                    is_shared_with_non_super_family,
                    display_name,
                    emoji
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                [
                    category_key,
                    behavior_type,
                    has_chinese_logic,
                    bool(is_shared_with_non_super_family),
                    display_name,
                    emoji,
                ],
            )
            inserted += 1
            continue

        existing_behavior_type = str(row[0] or "").strip().lower()
        existing_has_chinese_logic = bool(row[1])
        existing_is_shared_with_non_super = bool(row[2])
        existing_display_name = str(row[3] or "").strip()
        existing_emoji = str(row[4] or "").strip()

        needs_update = False
        if existing_behavior_type != behavior_type:
            needs_update = True
        if existing_has_chinese_logic != bool(has_chinese_logic):
            needs_update = True
        if existing_is_shared_with_non_super != bool(is_shared_with_non_super_family):
            needs_update = True
        if not existing_display_name or not existing_emoji:
            needs_update = True

        if not needs_update:
            continue

        conn.execute(
            """
            UPDATE deck_category
            SET behavior_type = ?,
                has_chinese_specific_logic = ?,
                is_shared_with_non_super_family = ?,
                display_name = CASE
                    WHEN display_name IS NULL OR trim(display_name) = '' THEN ?
                    ELSE display_name
                END,
                emoji = CASE
                    WHEN emoji IS NULL OR trim(emoji) = '' THEN ?
                    ELSE emoji
                END
            WHERE category_key = ?
            """,
            [
                behavior_type,
                bool(has_chinese_logic),
                bool(is_shared_with_non_super_family),
                display_name,
                emoji,
                category_key,
            ],
        )
        updated += 1

    return inserted, updated


def _get_shared_deck_category_meta(conn):
    tables = _get_table_names(conn)
    if "deck_category" not in tables:
        return {}

    rows = conn.execute(
        """
        SELECT
          category_key,
          behavior_type,
          has_chinese_specific_logic,
          is_shared_with_non_super_family,
          display_name,
          emoji
        FROM deck_category
        ORDER BY category_key ASC
        """
    ).fetchall()
    meta = {}
    for row in rows:
        key = _normalize_category_key(row[0])
        if not key:
            continue
        behavior_type = str(row[1] or "").strip().lower()
        if behavior_type not in VALID_BEHAVIOR_TYPES:
            continue
        meta[key] = {
            "behavior_type": behavior_type,
            "has_chinese_specific_logic": bool(row[2]),
            "is_shared_with_non_super_family": bool(row[3]),
            "display_name": str(row[4] or "").strip(),
            "emoji": str(row[5] or "").strip(),
        }
    return meta


def _prefix_page_back(raw_back):
    text = str(raw_back or "").strip()
    if re.match(r"^page\s+", text, flags=re.IGNORECASE):
        suffix = re.sub(r"^page\s+", "", text, flags=re.IGNORECASE).strip()
        return f"Page {suffix}" if suffix else "Page "
    return f"Page {text}" if text else "Page "


def _migrate_shared_type3_card_back_prefix(conn):
    tables = _get_table_names(conn)
    if "deck" not in tables or "cards" not in tables:
        return 0

    meta = _get_shared_deck_category_meta(conn)
    type3_keys = {
        _normalize_category_key(key)
        for key, value in meta.items()
        if str((value or {}).get("behavior_type") or "").strip().lower() == BEHAVIOR_TYPE_III
    }
    if not type3_keys:
        return 0

    deck_rows = conn.execute("SELECT deck_id, tags FROM deck").fetchall()
    target_deck_ids = []
    for row in deck_rows:
        deck_id = int(row[0])
        tags = [_normalize_shared_tag_key(tag) for tag in list(row[1] or [])]
        tags = [tag for tag in tags if tag]
        if any(tag in type3_keys for tag in tags):
            target_deck_ids.append(deck_id)
    if not target_deck_ids:
        return 0

    placeholders = ",".join(["?"] * len(target_deck_ids))
    card_rows = conn.execute(
        f"SELECT id, back FROM cards WHERE deck_id IN ({placeholders})",
        target_deck_ids,
    ).fetchall()
    updates = []
    for row in card_rows:
        card_id = int(row[0])
        current_back = str(row[1] or "")
        next_back = _prefix_page_back(current_back)
        if next_back != current_back:
            updates.append([next_back, card_id])
    if not updates:
        return 0

    conn.executemany(
        "UPDATE cards SET back = ? WHERE id = ?",
        updates,
    )
    return len(updates)


def _migrate_kid_type3_card_back_prefix(conn, shared_category_meta_by_key):
    tables = _get_table_names(conn)
    if "decks" not in tables or "cards" not in tables:
        return 0
    if not isinstance(shared_category_meta_by_key, dict) or not shared_category_meta_by_key:
        return 0

    type3_keys = {
        _normalize_category_key(key)
        for key, value in shared_category_meta_by_key.items()
        if str((value or {}).get("behavior_type") or "").strip().lower() == BEHAVIOR_TYPE_III
    }
    if not type3_keys:
        return 0

    deck_rows = conn.execute("SELECT id, tags FROM decks").fetchall()
    target_deck_ids = []
    for row in deck_rows:
        deck_id = int(row[0])
        tags = [_normalize_shared_tag_key(tag) for tag in list(row[1] or [])]
        tags = [tag for tag in tags if tag]
        if any(tag in type3_keys for tag in tags):
            target_deck_ids.append(deck_id)
    if not target_deck_ids:
        return 0

    placeholders = ",".join(["?"] * len(target_deck_ids))
    card_rows = conn.execute(
        f"SELECT id, back FROM cards WHERE deck_id IN ({placeholders})",
        target_deck_ids,
    ).fetchall()
    updates = []
    for row in card_rows:
        card_id = int(row[0])
        current_back = str(row[1] or "")
        next_back = _prefix_page_back(current_back)
        if next_back != current_back:
            updates.append([next_back, card_id])
    if not updates:
        return 0

    conn.executemany(
        "UPDATE cards SET back = ? WHERE id = ?",
        updates,
    )
    return len(updates)


def _ensure_kid_deck_category_opt_in_table_columns(conn):
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {KID_DECK_CATEGORY_OPT_IN_TABLE} (
          category_key VARCHAR PRIMARY KEY,
          {KID_DECK_CATEGORY_OPT_IN_COL_IS_OPTED_IN} BOOLEAN NOT NULL DEFAULT FALSE,
          {KID_DECK_CATEGORY_OPT_IN_COL_SESSION_CARD_COUNT} INTEGER NOT NULL DEFAULT 0,
          {KID_DECK_CATEGORY_OPT_IN_COL_HARD_CARD_PERCENTAGE} INTEGER NOT NULL DEFAULT {DEFAULT_HARD_CARD_PERCENTAGE},
          {KID_DECK_CATEGORY_OPT_IN_COL_INCLUDE_ORPHAN} BOOLEAN NOT NULL DEFAULT TRUE
        )
        """
    )
    columns = {
        str(row[1] or "").strip().lower()
        for row in conn.execute(
            f"PRAGMA table_info('{KID_DECK_CATEGORY_OPT_IN_TABLE}')"
        ).fetchall()
    }
    if KID_DECK_CATEGORY_OPT_IN_COL_IS_OPTED_IN not in columns:
        conn.execute(
            f"""
            ALTER TABLE {KID_DECK_CATEGORY_OPT_IN_TABLE}
            ADD COLUMN {KID_DECK_CATEGORY_OPT_IN_COL_IS_OPTED_IN} BOOLEAN NOT NULL DEFAULT FALSE
            """
        )
    if KID_DECK_CATEGORY_OPT_IN_COL_SESSION_CARD_COUNT not in columns:
        conn.execute(
            f"""
            ALTER TABLE {KID_DECK_CATEGORY_OPT_IN_TABLE}
            ADD COLUMN {KID_DECK_CATEGORY_OPT_IN_COL_SESSION_CARD_COUNT} INTEGER NOT NULL DEFAULT 0
            """
        )
    if KID_DECK_CATEGORY_OPT_IN_COL_HARD_CARD_PERCENTAGE not in columns:
        conn.execute(
            f"""
            ALTER TABLE {KID_DECK_CATEGORY_OPT_IN_TABLE}
            ADD COLUMN {KID_DECK_CATEGORY_OPT_IN_COL_HARD_CARD_PERCENTAGE} INTEGER NOT NULL DEFAULT {DEFAULT_HARD_CARD_PERCENTAGE}
            """
        )
    if KID_DECK_CATEGORY_OPT_IN_COL_INCLUDE_ORPHAN not in columns:
        conn.execute(
            f"""
            ALTER TABLE {KID_DECK_CATEGORY_OPT_IN_TABLE}
            ADD COLUMN {KID_DECK_CATEGORY_OPT_IN_COL_INCLUDE_ORPHAN} BOOLEAN NOT NULL DEFAULT TRUE
            """
        )


def _migrate_kid_deck_category_opt_in_config(conn, shared_category_meta_by_key, kid_category_config):
    if not isinstance(shared_category_meta_by_key, dict) or not shared_category_meta_by_key:
        return 0, False

    _ensure_kid_deck_category_opt_in_table_columns(conn)
    shared_keys = sorted(
        {
            _normalize_category_key(raw_key)
            for raw_key in shared_category_meta_by_key.keys()
            if _normalize_category_key(raw_key)
        }
    )
    if not shared_keys:
        return 0, False

    config = kid_category_config if isinstance(kid_category_config, dict) else {}

    raw_session_map = config.get("session_card_count_by_category")
    session_map = {
        _normalize_category_key(raw_key): raw_value
        for raw_key, raw_value in (raw_session_map or {}).items()
        if _normalize_category_key(raw_key)
    }

    raw_hard_map = config.get("hard_card_percentage_by_category")
    hard_map = {
        _normalize_category_key(raw_key): raw_value
        for raw_key, raw_value in (raw_hard_map or {}).items()
        if _normalize_category_key(raw_key)
    }

    raw_include_map = config.get("include_orphan_by_category")
    include_map = {
        _normalize_category_key(raw_key): raw_value
        for raw_key, raw_value in (raw_include_map or {}).items()
        if _normalize_category_key(raw_key)
    }

    raw_opted_in_keys = config.get("opted_in_category_keys")
    has_opted_in_keys = isinstance(raw_opted_in_keys, list)
    opted_in_set = {
        _normalize_category_key(raw_key)
        for raw_key in list(raw_opted_in_keys or [])
        if _normalize_category_key(raw_key)
    }

    existing_rows = conn.execute(
        f"""
        SELECT
          category_key,
          COALESCE({KID_DECK_CATEGORY_OPT_IN_COL_IS_OPTED_IN}, FALSE),
          COALESCE({KID_DECK_CATEGORY_OPT_IN_COL_SESSION_CARD_COUNT}, 0),
          COALESCE({KID_DECK_CATEGORY_OPT_IN_COL_HARD_CARD_PERCENTAGE}, {DEFAULT_HARD_CARD_PERCENTAGE}),
          COALESCE({KID_DECK_CATEGORY_OPT_IN_COL_INCLUDE_ORPHAN}, TRUE)
        FROM {KID_DECK_CATEGORY_OPT_IN_TABLE}
        """
    ).fetchall()
    existing_by_key = {}
    for row in existing_rows:
        key = _normalize_category_key(row[0])
        if not key:
            continue
        existing_by_key[key] = {
            "is_opted_in": bool(row[1]),
            "session_card_count": int(row[2] or 0),
            "hard_card_percentage": int(row[3] or 0),
            "include_orphan": bool(row[4]),
        }
    existing_key_set = set(existing_by_key.keys())

    if not has_opted_in_keys:
        opted_in_set = {
            key
            for key, values in existing_by_key.items()
            if bool(values.get("is_opted_in"))
        }

    missing_keys = [key for key in shared_keys if key not in existing_key_set]
    if missing_keys:
        conn.executemany(
            f"""
            INSERT INTO {KID_DECK_CATEGORY_OPT_IN_TABLE} (
                category_key,
                {KID_DECK_CATEGORY_OPT_IN_COL_IS_OPTED_IN},
                {KID_DECK_CATEGORY_OPT_IN_COL_SESSION_CARD_COUNT},
                {KID_DECK_CATEGORY_OPT_IN_COL_HARD_CARD_PERCENTAGE},
                {KID_DECK_CATEGORY_OPT_IN_COL_INCLUDE_ORPHAN}
            )
            VALUES (?, FALSE, 0, {DEFAULT_HARD_CARD_PERCENTAGE}, TRUE)
            """,
            [[key] for key in missing_keys],
        )
        for key in missing_keys:
            existing_by_key[key] = {
                "is_opted_in": False,
                "session_card_count": 0,
                "hard_card_percentage": DEFAULT_HARD_CARD_PERCENTAGE,
                "include_orphan": DEFAULT_INCLUDE_ORPHAN,
            }

    conn.executemany(
        f"""
        UPDATE {KID_DECK_CATEGORY_OPT_IN_TABLE}
        SET
          {KID_DECK_CATEGORY_OPT_IN_COL_IS_OPTED_IN} = ?,
          {KID_DECK_CATEGORY_OPT_IN_COL_SESSION_CARD_COUNT} = ?,
          {KID_DECK_CATEGORY_OPT_IN_COL_HARD_CARD_PERCENTAGE} = ?,
          {KID_DECK_CATEGORY_OPT_IN_COL_INCLUDE_ORPHAN} = ?
        WHERE category_key = ?
        """,
        [
            [
                bool(key in opted_in_set),
                (
                    _to_int(session_map.get(key), minimum=0, maximum=MAX_SESSION_CARD_COUNT, default=0)
                    if key in session_map
                    else _to_int(
                        existing_by_key.get(key, {}).get("session_card_count"),
                        minimum=0,
                        maximum=MAX_SESSION_CARD_COUNT,
                        default=0,
                    )
                ),
                (
                    _to_percent(hard_map.get(key))
                    if key in hard_map
                    else _to_percent(
                        existing_by_key.get(key, {}).get("hard_card_percentage")
                    )
                ),
                (
                    _to_bool(include_map.get(key), default=DEFAULT_INCLUDE_ORPHAN)
                    if key in include_map
                    else _to_bool(
                        existing_by_key.get(key, {}).get("include_orphan"),
                        default=DEFAULT_INCLUDE_ORPHAN,
                    )
                ),
                key,
            ]
            for key in shared_keys
        ],
    )

    return len(missing_keys), True


def _migrate_kids_json_bytes(raw_bytes, shared_category_meta_by_key):
    if not raw_bytes:
        return raw_bytes, {}, 0

    try:
        payload = json.loads(raw_bytes.decode("utf-8"))
    except Exception:
        return raw_bytes, {}, 0

    kids = payload.get("kids")
    if not isinstance(kids, list):
        return raw_bytes, {}, 0

    shared_meta = shared_category_meta_by_key if isinstance(shared_category_meta_by_key, dict) else {}
    shared_key_set = set(shared_meta.keys())

    kid_category_config_by_kid_id = {}
    updated_kid_count = 0

    for idx, item in enumerate(kids):
        if not isinstance(item, dict):
            continue
        kid = dict(item)
        kid_id = str(kid.get("id") or "").strip()

        merged_count_map = {}
        for source_map in (
            kid.get("type1SessionCardCountByCategory"),
            kid.get("type2SessionCardCountByCategory"),
            kid.get(SESSION_CARD_COUNT_BY_CATEGORY_FIELD),
        ):
            if not isinstance(source_map, dict):
                continue
            for raw_key, raw_value in source_map.items():
                key = _normalize_category_key(raw_key)
                if key:
                    merged_count_map[key] = raw_value

        merged_hard_map = {}
        for source_map in (
            kid.get("type1HardCardPercentageByCategory"),
            kid.get("type2HardCardPercentageByCategory"),
            kid.get(HARD_CARD_PERCENT_BY_CATEGORY_FIELD),
        ):
            if not isinstance(source_map, dict):
                continue
            for raw_key, raw_value in source_map.items():
                key = _normalize_category_key(raw_key)
                if key:
                    merged_hard_map[key] = raw_value

        merged_include_map = {}
        for source_map in (
            kid.get("type1IncludeOrphanByCategory"),
            kid.get(INCLUDE_ORPHAN_BY_CATEGORY_FIELD),
        ):
            if not isinstance(source_map, dict):
                continue
            for raw_key, raw_value in source_map.items():
                key = _normalize_category_key(raw_key)
                if key:
                    merged_include_map[key] = raw_value

        normalized_counts = {
            key: _to_int(raw_value, minimum=0, maximum=MAX_SESSION_CARD_COUNT, default=0)
            for key, raw_value in merged_count_map.items()
            if key in shared_key_set
        }
        if "sessionCardCount" in kid and "chinese_characters" in shared_key_set:
            normalized_counts["chinese_characters"] = _to_int(
                kid.get("sessionCardCount"),
                minimum=0,
                maximum=MAX_SESSION_CARD_COUNT,
                default=0,
            )
        if "sharedMathSessionCardCount" in kid and "math" in shared_key_set:
            normalized_counts["math"] = _to_int(
                kid.get("sharedMathSessionCardCount"),
                minimum=0,
                maximum=MAX_SESSION_CARD_COUNT,
                default=0,
            )
        if "sharedLessonReadingSessionCardCount" in kid and "chinese_reading" in shared_key_set:
            normalized_counts["chinese_reading"] = _to_int(
                kid.get("sharedLessonReadingSessionCardCount"),
                minimum=0,
                maximum=MAX_SESSION_CARD_COUNT,
                default=0,
            )
        if "writingSessionCardCount" in kid and "chinese_writing" in shared_key_set:
            normalized_counts["chinese_writing"] = _to_int(
                kid.get("writingSessionCardCount"),
                minimum=0,
                maximum=MAX_SESSION_CARD_COUNT,
                default=0,
            )

        normalized_hard = {
            key: _to_percent(raw_value)
            for key, raw_value in merged_hard_map.items()
            if key in shared_key_set
        }
        if "sharedChineseCharactersHardCardPercentage" in kid and "chinese_characters" in shared_key_set:
            normalized_hard["chinese_characters"] = _to_percent(
                kid.get("sharedChineseCharactersHardCardPercentage")
            )
        if "sharedMathHardCardPercentage" in kid and "math" in shared_key_set:
            normalized_hard["math"] = _to_percent(
                kid.get("sharedMathHardCardPercentage")
            )
        if "sharedLessonReadingHardCardPercentage" in kid and "chinese_reading" in shared_key_set:
            normalized_hard["chinese_reading"] = _to_percent(
                kid.get("sharedLessonReadingHardCardPercentage")
            )
        if "sharedWritingHardCardPercentage" in kid and "chinese_writing" in shared_key_set:
            normalized_hard["chinese_writing"] = _to_percent(
                kid.get("sharedWritingHardCardPercentage")
            )

        normalized_orphan = {
            key: _to_bool(raw_value, default=DEFAULT_INCLUDE_ORPHAN)
            for key, raw_value in merged_include_map.items()
            if key in shared_key_set
        }
        if "sharedChineseCharactersIncludeOrphan" in kid and "chinese_characters" in shared_key_set:
            normalized_orphan["chinese_characters"] = _to_bool(
                kid.get("sharedChineseCharactersIncludeOrphan"),
                default=DEFAULT_INCLUDE_ORPHAN,
            )
        if "sharedLessonReadingIncludeOrphan" in kid and "chinese_reading" in shared_key_set:
            normalized_orphan["chinese_reading"] = _to_bool(
                kid.get("sharedLessonReadingIncludeOrphan"),
                default=DEFAULT_INCLUDE_ORPHAN,
            )
        if "sharedWritingIncludeOrphan" in kid and "chinese_writing" in shared_key_set:
            normalized_orphan["chinese_writing"] = _to_bool(
                kid.get("sharedWritingIncludeOrphan"),
                default=DEFAULT_INCLUDE_ORPHAN,
            )

        preferred_keys = []
        preferred_seen = set()
        for key, count_value in normalized_counts.items():
            if int(count_value) > 0 and key not in preferred_seen:
                preferred_seen.add(key)
                preferred_keys.append(key)

        for raw_key in list(kid.get("optedInDeckCategoryKeys") or []):
            key = _normalize_category_key(raw_key)
            if key and key in shared_key_set and key not in preferred_seen:
                preferred_seen.add(key)
                preferred_keys.append(key)

        has_opted_in_source = isinstance(kid.get("optedInDeckCategoryKeys"), list)
        config_payload = {}
        if normalized_counts:
            config_payload["session_card_count_by_category"] = normalized_counts
        if normalized_hard:
            config_payload["hard_card_percentage_by_category"] = normalized_hard
        if normalized_orphan:
            config_payload["include_orphan_by_category"] = normalized_orphan
        if has_opted_in_source or normalized_counts:
            config_payload["opted_in_category_keys"] = preferred_keys
        if kid_id and config_payload:
            kid_category_config_by_kid_id[kid_id] = config_payload

        kid.pop(SESSION_CARD_COUNT_BY_CATEGORY_FIELD, None)
        kid.pop(HARD_CARD_PERCENT_BY_CATEGORY_FIELD, None)
        kid.pop(INCLUDE_ORPHAN_BY_CATEGORY_FIELD, None)
        for field_name in DEPRECATED_KID_FIELDS_TO_DROP:
            kid.pop(field_name, None)
        kids[idx] = kid

        if (
            normalized_counts != merged_count_map
            or normalized_hard != merged_hard_map
            or normalized_orphan != merged_include_map
            or SESSION_CARD_COUNT_BY_CATEGORY_FIELD in item
            or HARD_CARD_PERCENT_BY_CATEGORY_FIELD in item
            or INCLUDE_ORPHAN_BY_CATEGORY_FIELD in item
        ):
            updated_kid_count += 1

    payload["kids"] = kids
    migrated_bytes = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
    return migrated_bytes, kid_category_config_by_kid_id, updated_kid_count


def cleanup_db_bytes(
    entry_name,
    raw_bytes,
    *,
    shared_category_meta_by_key=None,
    kid_category_config=None,
):
    with tempfile.TemporaryDirectory(prefix="backup_zip_cleanup_") as temp_dir:
        db_path = os.path.join(temp_dir, "db.duckdb")
        with open(db_path, "wb") as db_file:
            db_file.write(raw_bytes)

        conn = duckdb.connect(db_path)
        try:
            dropped_sessions_deck_id = _drop_sessions_deck_id_if_present(conn)
            dropped_legacy_writing_tables = _drop_legacy_writing_queue_tables_if_present(conn)
            session_type_updates = _migrate_sessions_type_values(conn)

            removed_deck_count = 0
            removed_card_count = 0
            inserted_category_count = 0
            updated_category_count = 0
            migrated_tag_comment_deck_count = 0
            migrated_tag_comment_count = 0
            type3_back_prefixed_count = 0
            inserted_opt_in_row_count = 0
            seeded_opt_in = False
            observed_shared_category_meta = {}

            base_name = os.path.basename(str(entry_name or "")).lower()
            if base_name == "shared_decks.duckdb":
                removed_deck_count, removed_card_count = _remove_single_math_tag_shared_decks_if_present(conn)
                inserted_category_count, updated_category_count = _populate_shared_deck_category_display_data(conn)
                (
                    migrated_tag_comment_deck_count,
                    migrated_tag_comment_count,
                ) = _migrate_shared_deck_tag_comments(conn)
                type3_back_prefixed_count = _migrate_shared_type3_card_back_prefix(conn)
                observed_shared_category_meta = _get_shared_deck_category_meta(conn)
            else:
                kid_id = _extract_kid_id_from_entry_name(entry_name)
                if kid_id and isinstance(shared_category_meta_by_key, dict) and shared_category_meta_by_key:
                    inserted_opt_in_row_count, seeded_opt_in = _migrate_kid_deck_category_opt_in_config(
                        conn,
                        shared_category_meta_by_key,
                        kid_category_config,
                    )
                    type3_back_prefixed_count = _migrate_kid_type3_card_back_prefix(
                        conn,
                        shared_category_meta_by_key,
                    )
        finally:
            conn.close()

        with open(db_path, "rb") as db_file:
            cleaned_bytes = db_file.read()

    return (
        cleaned_bytes,
        dropped_sessions_deck_id,
        dropped_legacy_writing_tables,
        session_type_updates,
        removed_deck_count,
        removed_card_count,
        inserted_category_count,
        updated_category_count,
        migrated_tag_comment_deck_count,
        migrated_tag_comment_count,
        type3_back_prefixed_count,
        inserted_opt_in_row_count,
        seeded_opt_in,
        observed_shared_category_meta,
    )


def cleanup_backup_zip(input_zip, output_zip):
    if not os.path.exists(input_zip):
        raise FileNotFoundError(f"Input zip not found: {input_zip}")
    if os.path.abspath(input_zip) == os.path.abspath(output_zip):
        raise ValueError("Input and output zip paths must be different")

    checked_db_count = 0
    sessions_column_dropped_db_count = 0
    writing_queue_table_dropped_db_count = 0
    writing_queue_table_dropped_count = 0
    sessions_type_updated_row_count = 0
    removed_shared_deck_count = 0
    removed_shared_card_count = 0
    inserted_shared_category_count = 0
    updated_shared_category_count = 0
    migrated_shared_tag_comment_deck_count = 0
    migrated_shared_tag_comment_count = 0
    type3_back_prefixed_count = 0
    seeded_opt_in_db_count = 0
    inserted_opt_in_row_count = 0
    kids_json_updated_kid_count = 0

    with zipfile.ZipFile(input_zip, "r") as source_zip:
        info_by_name = {entry.filename: entry for entry in source_zip.infolist()}
        shared_entry_name = None
        for entry_name in info_by_name.keys():
            if os.path.basename(entry_name).lower() == "shared_decks.duckdb":
                shared_entry_name = entry_name
                break

        if shared_entry_name is None:
            raise ValueError("Input backup zip is missing shared_decks.duckdb")

        cleaned_shared_bytes = None
        shared_cleanup_summary = None
        shared_category_meta_by_key = {}
        raw_shared_bytes = source_zip.read(shared_entry_name)
        (
            cleaned_shared_bytes,
            dropped_sessions_deck_id,
            dropped_legacy_writing_tables,
            session_type_updates,
            removed_decks,
            removed_cards,
            inserted_categories,
            updated_categories,
            migrated_tag_comment_decks,
            migrated_tag_comments,
            type3_back_prefixed_local,
            inserted_opt_in_rows_local,
            seeded_opt_in_local,
            observed_shared_meta,
        ) = cleanup_db_bytes(shared_entry_name, raw_shared_bytes)
        shared_cleanup_summary = {
            "dropped_sessions_deck_id": dropped_sessions_deck_id,
            "dropped_legacy_writing_tables": dropped_legacy_writing_tables,
            "session_type_updates": session_type_updates,
            "removed_decks": removed_decks,
            "removed_cards": removed_cards,
            "inserted_categories": inserted_categories,
            "updated_categories": updated_categories,
            "migrated_tag_comment_decks": migrated_tag_comment_decks,
            "migrated_tag_comments": migrated_tag_comments,
            "type3_back_prefixed_count": type3_back_prefixed_local,
            "inserted_opt_in_rows": inserted_opt_in_rows_local,
            "seeded_opt_in": seeded_opt_in_local,
        }
        if not observed_shared_meta:
            raise ValueError("shared_decks.duckdb has no deck_category metadata")
        shared_category_meta_by_key = observed_shared_meta

        kids_json_bytes = None
        kid_category_config_by_kid_id = {}
        kids_json_entry_name = next((name for name in info_by_name.keys() if name.lower() == "kids.json"), None)
        if kids_json_entry_name is not None:
            migrated_kids_json_bytes, kid_category_config_by_kid_id, kids_json_updated_kid_count = (
                _migrate_kids_json_bytes(
                    source_zip.read(kids_json_entry_name),
                    shared_category_meta_by_key,
                )
            )
            kids_json_bytes = migrated_kids_json_bytes

        with zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as target_zip:
            target_zip.comment = source_zip.comment
            for entry in source_zip.infolist():
                entry_name = entry.filename
                lower_name = entry_name.lower()
                entry_bytes = source_zip.read(entry_name)

                if shared_entry_name is not None and entry_name == shared_entry_name:
                    checked_db_count += 1
                    entry_bytes = cleaned_shared_bytes
                    dropped_sessions_deck_id = bool(shared_cleanup_summary["dropped_sessions_deck_id"])
                    dropped_legacy_writing_tables = int(shared_cleanup_summary["dropped_legacy_writing_tables"] or 0)
                    session_type_updates = int(shared_cleanup_summary["session_type_updates"] or 0)
                    removed_decks = int(shared_cleanup_summary["removed_decks"] or 0)
                    removed_cards = int(shared_cleanup_summary["removed_cards"] or 0)
                    inserted_categories = int(shared_cleanup_summary["inserted_categories"] or 0)
                    updated_categories = int(shared_cleanup_summary["updated_categories"] or 0)
                    migrated_tag_comment_decks = int(
                        shared_cleanup_summary["migrated_tag_comment_decks"] or 0
                    )
                    migrated_tag_comments = int(
                        shared_cleanup_summary["migrated_tag_comments"] or 0
                    )
                    type3_back_prefixed_local = int(
                        shared_cleanup_summary["type3_back_prefixed_count"] or 0
                    )

                    if dropped_sessions_deck_id:
                        sessions_column_dropped_db_count += 1
                    if dropped_legacy_writing_tables:
                        writing_queue_table_dropped_db_count += 1
                    writing_queue_table_dropped_count += dropped_legacy_writing_tables
                    sessions_type_updated_row_count += session_type_updates
                    removed_shared_deck_count += removed_decks
                    removed_shared_card_count += removed_cards
                    inserted_shared_category_count += inserted_categories
                    updated_shared_category_count += updated_categories
                    migrated_shared_tag_comment_deck_count += migrated_tag_comment_decks
                    migrated_shared_tag_comment_count += migrated_tag_comments
                    type3_back_prefixed_count += type3_back_prefixed_local

                elif lower_name.endswith(".duckdb") or lower_name.endswith(".db"):
                    checked_db_count += 1
                    kid_id = _extract_kid_id_from_entry_name(entry_name)
                    kid_category_config = kid_category_config_by_kid_id.get(kid_id, {})
                    (
                        entry_bytes,
                        dropped_sessions_deck_id,
                        dropped_legacy_writing_tables,
                        session_type_updates,
                        removed_decks,
                        removed_cards,
                        inserted_categories,
                        updated_categories,
                        migrated_tag_comment_decks,
                        migrated_tag_comments,
                        type3_back_prefixed_local,
                        inserted_opt_in_rows_local,
                        seeded_opt_in_local,
                        observed_shared_meta,
                    ) = cleanup_db_bytes(
                        entry_name,
                        entry_bytes,
                        shared_category_meta_by_key=shared_category_meta_by_key,
                        kid_category_config=kid_category_config,
                    )
                    if dropped_sessions_deck_id:
                        sessions_column_dropped_db_count += 1
                    if dropped_legacy_writing_tables:
                        writing_queue_table_dropped_db_count += 1
                    writing_queue_table_dropped_count += int(dropped_legacy_writing_tables or 0)
                    sessions_type_updated_row_count += int(session_type_updates or 0)
                    removed_shared_deck_count += int(removed_decks or 0)
                    removed_shared_card_count += int(removed_cards or 0)
                    inserted_shared_category_count += int(inserted_categories or 0)
                    updated_shared_category_count += int(updated_categories or 0)
                    migrated_shared_tag_comment_deck_count += int(migrated_tag_comment_decks or 0)
                    migrated_shared_tag_comment_count += int(migrated_tag_comments or 0)
                    type3_back_prefixed_count += int(type3_back_prefixed_local or 0)
                    inserted_opt_in_row_count += int(inserted_opt_in_rows_local or 0)
                    if seeded_opt_in_local:
                        seeded_opt_in_db_count += 1

                    if observed_shared_meta:
                        shared_category_meta_by_key = observed_shared_meta

                elif lower_name == "kids.json" and kids_json_bytes is not None:
                    entry_bytes = kids_json_bytes

                target_zip.writestr(entry, entry_bytes)

    return {
        "checked_db_count": checked_db_count,
        "sessions_column_dropped_db_count": sessions_column_dropped_db_count,
        "writing_queue_table_dropped_db_count": writing_queue_table_dropped_db_count,
        "writing_queue_table_dropped_count": writing_queue_table_dropped_count,
        "sessions_type_updated_row_count": sessions_type_updated_row_count,
        "removed_shared_deck_count": removed_shared_deck_count,
        "removed_shared_card_count": removed_shared_card_count,
        "inserted_shared_category_count": inserted_shared_category_count,
        "updated_shared_category_count": updated_shared_category_count,
        "migrated_shared_tag_comment_deck_count": migrated_shared_tag_comment_deck_count,
        "migrated_shared_tag_comment_count": migrated_shared_tag_comment_count,
        "type3_back_prefixed_count": type3_back_prefixed_count,
        "seeded_opt_in_db_count": seeded_opt_in_db_count,
        "inserted_opt_in_row_count": inserted_opt_in_row_count,
        "kids_json_updated_kid_count": kids_json_updated_kid_count,
    }


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Clean a full backup zip by removing sessions.deck_id, rewriting sessions.type values, "
            "removing single-tag math decks, filling deck_category display metadata, dropping legacy "
            "writing queue tables, migrating kid config maps into deck_category_opt_in, and cleaning kids.json."
        )
    )
    parser.add_argument("--input-zip", required=True, help="Path to source backup zip")
    parser.add_argument("--output-zip", required=True, help="Path to cleaned backup zip")
    return parser.parse_args()


def main():
    args = parse_args()
    summary = cleanup_backup_zip(args.input_zip, args.output_zip)
    print(f"Wrote cleaned zip: {args.output_zip}")
    print(f"Databases checked: {summary['checked_db_count']}")
    print(
        "Kid DBs with sessions.deck_id dropped: "
        f"{summary['sessions_column_dropped_db_count']}"
    )
    print(
        "DBs with legacy writing queue tables dropped: "
        f"{summary['writing_queue_table_dropped_db_count']}"
    )
    print(
        "Legacy writing queue tables dropped: "
        f"{summary['writing_queue_table_dropped_count']}"
    )
    print(f"Session rows with type migrated: {summary['sessions_type_updated_row_count']}")
    print(f"Shared decks removed (single 'math' tag): {summary['removed_shared_deck_count']}")
    print(f"Shared cards removed: {summary['removed_shared_card_count']}")
    print(
        "Shared deck_category rows inserted: "
        f"{summary['inserted_shared_category_count']}"
    )
    print(
        "Shared deck_category rows updated: "
        f"{summary['updated_shared_category_count']}"
    )
    print(
        "Shared decks with tag comment migrated: "
        f"{summary['migrated_shared_tag_comment_deck_count']}"
    )
    print(
        "Shared tag comments migrated: "
        f"{summary['migrated_shared_tag_comment_count']}"
    )
    print(
        'Type-III card backs prefixed with "Page ": '
        f"{summary['type3_back_prefixed_count']}"
    )
    print(
        "Kid DBs with deck_category_opt_in config migrated: "
        f"{summary['seeded_opt_in_db_count']}"
    )
    print(
        "deck_category_opt_in rows inserted: "
        f"{summary['inserted_opt_in_row_count']}"
    )
    print(f"kids.json kid rows migrated: {summary['kids_json_updated_kid_count']}")


if __name__ == "__main__":
    main()
