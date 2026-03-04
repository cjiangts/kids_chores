#!/usr/bin/env python3
"""One-time cleanup and migration for full backup zips.

Actions:
1) Drop sessions.deck_id from kid DBs in the backup zip.
2) Remove shared decks whose only tag is 'math' and delete their cards.
3) Rewrite sessions.type legacy values to deck category keys.
4) Populate deck_category display_name/emoji in shared_decks.duckdb.
5) Drop obsolete writing candidate queue tables from kid DBs.
6) Seed kid-local deck_category_opt_in rows when the table is empty.
7) Migrate kids.json type-I/type-III and type-II settings into category-keyed map fields.
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

SESSION_CARD_COUNT_BY_CATEGORY_FIELD = "sessionCardCountByCategory"
HARD_CARD_PERCENT_BY_CATEGORY_FIELD = "hardCardPercentageByCategory"
INCLUDE_ORPHAN_BY_CATEGORY_FIELD = "includeOrphanByCategory"

KID_DECK_CATEGORY_OPT_IN_TABLE = "deck_category_opt_in"
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
    ("math", "type_i", False, "Math", "➗"),
    ("chinese_characters", "type_i", True, "Chinese Characters", "📖"),
    ("chinese_writing", "type_ii", True, "Chinese Writing", "✍️"),
    ("chinese_reading", "type_iii", True, "Chinese Reading", "📚"),
]

LEGACY_WRITING_QUEUE_TABLES = (
    "writing_practicing_queue",
    "writing_practicing_queue_meta",
)

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
    if "display_name" not in columns:
        conn.execute("ALTER TABLE deck_category ADD COLUMN display_name VARCHAR")
    if "emoji" not in columns:
        conn.execute("ALTER TABLE deck_category ADD COLUMN emoji VARCHAR")

    inserted = 0
    updated = 0
    for category_key, behavior_type, has_chinese_logic, display_name, emoji in LEGACY_SHARED_CATEGORY_ROWS:
        row = conn.execute(
            """
            SELECT behavior_type, has_chinese_specific_logic, display_name, emoji
            FROM deck_category
            WHERE category_key = ?
            """,
            [category_key],
        ).fetchone()

        if row is None:
            conn.execute(
                """
                INSERT INTO deck_category (
                    category_key, behavior_type, has_chinese_specific_logic, display_name, emoji
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                [category_key, behavior_type, has_chinese_logic, display_name, emoji],
            )
            inserted += 1
            continue

        existing_behavior_type = str(row[0] or "").strip().lower()
        existing_has_chinese_logic = bool(row[1])
        existing_display_name = str(row[2] or "").strip()
        existing_emoji = str(row[3] or "").strip()

        needs_update = False
        if existing_behavior_type != behavior_type:
            needs_update = True
        if existing_has_chinese_logic != bool(has_chinese_logic):
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
            [behavior_type, bool(has_chinese_logic), display_name, emoji, category_key],
        )
        updated += 1

    return inserted, updated


def _get_shared_deck_category_meta(conn):
    tables = _get_table_names(conn)
    if "deck_category" not in tables:
        return {}

    rows = conn.execute(
        """
        SELECT category_key, behavior_type, has_chinese_specific_logic, display_name, emoji
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
            "display_name": str(row[3] or "").strip(),
            "emoji": str(row[4] or "").strip(),
        }
    return meta


def _discover_kid_opt_in_keys_from_db(conn, shared_key_set):
    discovered = []
    seen = set()
    tables = _get_table_names(conn)
    if "sessions" in tables:
        rows = conn.execute("SELECT DISTINCT type FROM sessions").fetchall()
        for row in rows:
            key = _normalize_category_key(row[0])
            if key and key in shared_key_set and key not in seen:
                seen.add(key)
                discovered.append(key)
    if "decks" in tables:
        rows = conn.execute("SELECT tags FROM decks").fetchall()
        for row in rows:
            tags = list(row[0] or [])
            if not tags:
                continue
            key = _normalize_category_key(tags[0])
            if key and key in shared_key_set and key not in seen:
                seen.add(key)
                discovered.append(key)
    return discovered


def _seed_kid_deck_category_opt_in_if_empty(conn, shared_category_meta_by_key, preferred_keys):
    if not isinstance(shared_category_meta_by_key, dict) or not shared_category_meta_by_key:
        return 0, False

    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {KID_DECK_CATEGORY_OPT_IN_TABLE} (
          category_key VARCHAR PRIMARY KEY
        )
        """
    )

    existing_count = int(
        conn.execute(f"SELECT COUNT(*) FROM {KID_DECK_CATEGORY_OPT_IN_TABLE}").fetchone()[0] or 0
    )
    if existing_count > 0:
        return 0, False

    shared_key_set = set(shared_category_meta_by_key.keys())
    chosen = []
    seen = set()

    for raw_key in list(preferred_keys or []):
        key = _normalize_category_key(raw_key)
        if key and key in shared_key_set and key not in seen:
            seen.add(key)
            chosen.append(key)

    for key in _discover_kid_opt_in_keys_from_db(conn, shared_key_set):
        if key not in seen:
            seen.add(key)
            chosen.append(key)

    if not chosen:
        chosen = sorted(shared_key_set)

    for key in chosen:
        conn.execute(
            f"INSERT INTO {KID_DECK_CATEGORY_OPT_IN_TABLE} (category_key) VALUES (?)",
            [key],
        )

    return len(chosen), True


def _build_fallback_shared_category_meta():
    meta = {}
    for category_key, behavior_type, has_chinese_specific_logic, display_name, emoji in LEGACY_SHARED_CATEGORY_ROWS:
        key = _normalize_category_key(category_key)
        if not key:
            continue
        meta[key] = {
            "behavior_type": str(behavior_type).strip().lower(),
            "has_chinese_specific_logic": bool(has_chinese_specific_logic),
            "display_name": str(display_name or "").strip(),
            "emoji": str(emoji or "").strip(),
        }
    return meta


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
    type_i_keys = sorted(
        [
            key
            for key, item in shared_meta.items()
            if str((item or {}).get("behavior_type") or "").strip().lower() == BEHAVIOR_TYPE_I
        ]
    )
    type_iii_keys = sorted(
        [
            key
            for key, item in shared_meta.items()
            if str((item or {}).get("behavior_type") or "").strip().lower() == BEHAVIOR_TYPE_III
        ]
    )
    type_ii_keys = sorted(
        [
            key
            for key, item in shared_meta.items()
            if str((item or {}).get("behavior_type") or "").strip().lower() == BEHAVIOR_TYPE_II
        ]
    )
    type_i_and_iii_keys = sorted(set(type_i_keys + type_iii_keys))
    shared_key_set = set(shared_meta.keys())

    preferred_opt_in_by_kid_id = {}
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

        normalized_counts = {}
        normalized_hard = {}
        normalized_orphan = {}
        preferred_keys = []
        preferred_seen = set()

        for key in type_i_and_iii_keys:
            if key in merged_count_map:
                count_value = _to_int(merged_count_map.get(key), minimum=0, maximum=MAX_SESSION_CARD_COUNT, default=0)
            elif key == "chinese_characters":
                count_value = _to_int(kid.get("sessionCardCount"), minimum=0, maximum=MAX_SESSION_CARD_COUNT, default=0)
            elif key == "math":
                count_value = _to_int(
                    kid.get("sharedMathSessionCardCount"),
                    minimum=0,
                    maximum=MAX_SESSION_CARD_COUNT,
                    default=0,
                )
            elif key == "chinese_reading":
                count_value = _to_int(
                    kid.get("sharedLessonReadingSessionCardCount"),
                    minimum=0,
                    maximum=MAX_SESSION_CARD_COUNT,
                    default=0,
                )
            else:
                count_value = 0

            if key in merged_hard_map:
                hard_value = _to_percent(merged_hard_map.get(key))
            elif key == "chinese_characters":
                hard_value = _to_percent(kid.get("sharedChineseCharactersHardCardPercentage"))
            elif key == "math":
                hard_value = _to_percent(kid.get("sharedMathHardCardPercentage"))
            elif key == "chinese_reading":
                hard_value = _to_percent(kid.get("sharedLessonReadingHardCardPercentage"))
            else:
                hard_value = DEFAULT_HARD_CARD_PERCENTAGE

            if key in merged_include_map:
                orphan_value = _to_bool(merged_include_map.get(key), default=False)
            elif key == "chinese_characters":
                orphan_value = _to_bool(kid.get("sharedChineseCharactersIncludeOrphan"), default=False)
            elif key == "chinese_reading":
                orphan_value = _to_bool(kid.get("sharedLessonReadingIncludeOrphan"), default=False)
            else:
                orphan_value = False

            normalized_counts[key] = count_value
            normalized_hard[key] = hard_value
            normalized_orphan[key] = orphan_value

            if count_value > 0 and key not in preferred_seen:
                preferred_seen.add(key)
                preferred_keys.append(key)

        for key in type_ii_keys:
            if key in merged_count_map:
                count_value = _to_int(
                    merged_count_map.get(key),
                    minimum=0,
                    maximum=MAX_SESSION_CARD_COUNT,
                    default=0,
                )
            elif key == "chinese_writing":
                count_value = _to_int(
                    kid.get("writingSessionCardCount"),
                    minimum=0,
                    maximum=MAX_SESSION_CARD_COUNT,
                    default=0,
                )
            else:
                count_value = 0

            if key in merged_hard_map:
                hard_value = _to_percent(merged_hard_map.get(key))
            elif key == "chinese_writing":
                hard_value = _to_percent(kid.get("sharedWritingHardCardPercentage"))
            else:
                hard_value = DEFAULT_HARD_CARD_PERCENTAGE

            if key in merged_include_map:
                orphan_value = _to_bool(merged_include_map.get(key), default=False)
            elif key == "chinese_writing":
                orphan_value = _to_bool(kid.get("sharedWritingIncludeOrphan"), default=False)
            else:
                orphan_value = False

            normalized_counts[key] = count_value
            normalized_hard[key] = hard_value
            normalized_orphan[key] = orphan_value

            if count_value > 0 and key not in preferred_seen:
                preferred_seen.add(key)
                preferred_keys.append(key)

        reading_count = _to_int(
            kid.get("sharedLessonReadingSessionCardCount"),
            minimum=0,
            maximum=MAX_SESSION_CARD_COUNT,
            default=0,
        )
        if reading_count > 0 and "chinese_reading" in shared_key_set and "chinese_reading" not in preferred_seen:
            preferred_seen.add("chinese_reading")
            preferred_keys.append("chinese_reading")

        for raw_key in list(kid.get("optedInDeckCategoryKeys") or []):
            key = _normalize_category_key(raw_key)
            if key and key in shared_key_set and key not in preferred_seen:
                preferred_seen.add(key)
                preferred_keys.append(key)

        kid[SESSION_CARD_COUNT_BY_CATEGORY_FIELD] = normalized_counts
        kid[HARD_CARD_PERCENT_BY_CATEGORY_FIELD] = normalized_hard
        kid[INCLUDE_ORPHAN_BY_CATEGORY_FIELD] = normalized_orphan
        for field_name in DEPRECATED_KID_FIELDS_TO_DROP:
            kid.pop(field_name, None)
        kids[idx] = kid

        if kid_id:
            preferred_opt_in_by_kid_id[kid_id] = preferred_keys

        if (
            normalized_counts != merged_count_map
            or normalized_hard != merged_hard_map
            or normalized_orphan != merged_include_map
        ):
            updated_kid_count += 1

    payload["kids"] = kids
    migrated_bytes = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
    return migrated_bytes, preferred_opt_in_by_kid_id, updated_kid_count


def cleanup_db_bytes(
    entry_name,
    raw_bytes,
    *,
    shared_category_meta_by_key=None,
    preferred_opt_in_keys=None,
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
            inserted_opt_in_row_count = 0
            seeded_opt_in = False
            observed_shared_category_meta = {}

            base_name = os.path.basename(str(entry_name or "")).lower()
            if base_name == "shared_decks.duckdb":
                removed_deck_count, removed_card_count = _remove_single_math_tag_shared_decks_if_present(conn)
                inserted_category_count, updated_category_count = _populate_shared_deck_category_display_data(conn)
                observed_shared_category_meta = _get_shared_deck_category_meta(conn)
            else:
                kid_id = _extract_kid_id_from_entry_name(entry_name)
                if kid_id and isinstance(shared_category_meta_by_key, dict) and shared_category_meta_by_key:
                    inserted_opt_in_row_count, seeded_opt_in = _seed_kid_deck_category_opt_in_if_empty(
                        conn,
                        shared_category_meta_by_key,
                        preferred_opt_in_keys,
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

        cleaned_shared_bytes = None
        shared_cleanup_summary = None
        shared_category_meta_by_key = _build_fallback_shared_category_meta()
        if shared_entry_name is not None:
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
                "inserted_opt_in_rows": inserted_opt_in_rows_local,
                "seeded_opt_in": seeded_opt_in_local,
            }
            if observed_shared_meta:
                shared_category_meta_by_key = observed_shared_meta

        kids_json_bytes = None
        preferred_opt_in_by_kid_id = {}
        kids_json_entry_name = next((name for name in info_by_name.keys() if name.lower() == "kids.json"), None)
        if kids_json_entry_name is not None:
            migrated_kids_json_bytes, preferred_opt_in_by_kid_id, kids_json_updated_kid_count = (
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

                elif lower_name.endswith(".duckdb") or lower_name.endswith(".db"):
                    checked_db_count += 1
                    kid_id = _extract_kid_id_from_entry_name(entry_name)
                    preferred_keys = preferred_opt_in_by_kid_id.get(kid_id, [])
                    (
                        entry_bytes,
                        dropped_sessions_deck_id,
                        dropped_legacy_writing_tables,
                        session_type_updates,
                        removed_decks,
                        removed_cards,
                        inserted_categories,
                        updated_categories,
                        inserted_opt_in_rows_local,
                        seeded_opt_in_local,
                        observed_shared_meta,
                    ) = cleanup_db_bytes(
                        entry_name,
                        entry_bytes,
                        shared_category_meta_by_key=shared_category_meta_by_key,
                        preferred_opt_in_keys=preferred_keys,
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
        "seeded_opt_in_db_count": seeded_opt_in_db_count,
        "inserted_opt_in_row_count": inserted_opt_in_row_count,
        "kids_json_updated_kid_count": kids_json_updated_kid_count,
    }


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Clean a full backup zip by removing sessions.deck_id, rewriting sessions.type values, "
            "removing single-tag math decks, filling deck_category display metadata, dropping legacy "
            "writing queue tables, seeding deck_category_opt_in rows, and migrating kids.json category-keyed maps."
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
        "Kid DBs seeded with deck_category_opt_in rows: "
        f"{summary['seeded_opt_in_db_count']}"
    )
    print(
        "deck_category_opt_in rows inserted: "
        f"{summary['inserted_opt_in_row_count']}"
    )
    print(f"kids.json kid rows migrated: {summary['kids_json_updated_kid_count']}")


if __name__ == "__main__":
    main()
