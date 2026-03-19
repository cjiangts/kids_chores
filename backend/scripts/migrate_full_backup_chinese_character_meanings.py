#!/usr/bin/env python3
"""One-time full-backup migration: append short English glosses to Chinese type-I card backs."""

from __future__ import annotations

import argparse
import re
import tempfile
import zipfile
from pathlib import Path

import duckdb


SHARED_DB_NAME = "shared_decks.duckdb"
TYPE_I_BEHAVIOR = "type_i"
ENGLISH_MEANING_MARKER = "\nEN: "
SINGLE_CHINESE_CHAR_RE = re.compile(r"^[\u3400-\u9FFF\uF900-\uFAFF]$")
UNIHAN_CODEPOINT_RE = re.compile(r"^U\+([0-9A-F]{4,6})$")
SKIP_DEFINITION_HINTS = (
    "variant of",
    "same as",
    "used in",
    "interchangeable with",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Append short English meanings to Chinese type-I card backs inside a full backup zip. "
            "The source of truth is Unicode Unihan kDefinition."
        )
    )
    parser.add_argument("--input-zip", required=True, help="Input full-backup zip path.")
    parser.add_argument("--output-zip", required=True, help="Output zip path for the migrated backup.")
    parser.add_argument(
        "--unihan-zip",
        required=True,
        help="Path to a downloaded official Unihan.zip file.",
    )
    return parser.parse_args()


def is_kid_db_zip_member(name: str) -> bool:
    return (
        name.startswith("families/family_")
        and name.endswith(".db")
        and "/kid_" in name
    )


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "").strip())


def shorten_unihan_definition(raw_definition: str) -> str:
    """Trim Unihan kDefinition into one concise gloss."""
    text = normalize_space(raw_definition)
    if not text:
        return ""

    candidates: list[str] = []
    major_parts = [part.strip() for part in text.split(";") if part.strip()]
    for part in major_parts:
        minor_parts = [item.strip() for item in part.split(",") if item.strip()]
        if not minor_parts:
            minor_parts = [part]
        for item in minor_parts:
            cleaned = re.sub(r"^\([^)]*\)\s*", "", item).strip(" .")
            cleaned = normalize_space(cleaned)
            if cleaned:
                candidates.append(cleaned)

    if not candidates:
        return ""

    for candidate in candidates:
        lowered = candidate.lower()
        if any(hint in lowered for hint in SKIP_DEFINITION_HINTS) and len(candidates) > 1:
            continue
        return candidate
    return candidates[0]


def load_unihan_meanings(unihan_zip: Path) -> dict[str, str]:
    """Load one short English gloss per character from Unihan kDefinition."""
    meaning_by_char: dict[str, str] = {}
    with zipfile.ZipFile(unihan_zip, "r") as zf:
        for info in zf.infolist():
            name = str(info.filename or "")
            if not name.startswith("Unihan") or not name.endswith(".txt"):
                continue
            with zf.open(info, "r") as handle:
                for raw_line in handle.read().decode("utf-8").splitlines():
                    line = raw_line.strip()
                    if not line or line.startswith("#"):
                        continue
                    parts = line.split("\t")
                    if len(parts) != 3:
                        continue
                    codepoint_text, field_name, raw_value = parts
                    if field_name != "kDefinition":
                        continue
                    match = UNIHAN_CODEPOINT_RE.match(codepoint_text)
                    if not match:
                        continue
                    char = chr(int(match.group(1), 16))
                    gloss = shorten_unihan_definition(raw_value)
                    if gloss:
                        meaning_by_char[char] = gloss
    return meaning_by_char


def split_structured_back(raw_back: str) -> tuple[str, str]:
    text = str(raw_back or "").strip()
    if not text:
        return "", ""
    if ENGLISH_MEANING_MARKER not in text:
        return text, ""
    pinyin, meaning = text.split(ENGLISH_MEANING_MARKER, 1)
    return pinyin.strip(), meaning.strip()


def compose_structured_back(pinyin: str, meaning: str) -> str:
    pinyin_text = normalize_space(pinyin)
    meaning_text = normalize_space(meaning)
    if not meaning_text:
        return pinyin_text
    if not pinyin_text:
        return f"EN: {meaning_text}"
    return f"{pinyin_text}{ENGLISH_MEANING_MARKER}{meaning_text}"


def get_first_tag_key(raw_tags) -> str:
    values = list(raw_tags or [])
    if not values:
        return ""
    return str(values[0] or "").strip().lower()


def get_chinese_type1_category_keys(shared_db_path: Path) -> set[str]:
    conn = duckdb.connect(str(shared_db_path), read_only=True)
    try:
        rows = conn.execute(
            """
            SELECT category_key
            FROM deck_category
            WHERE behavior_type = ?
              AND has_chinese_specific_logic = TRUE
            """,
            [TYPE_I_BEHAVIOR],
        ).fetchall()
    finally:
        conn.close()
    return {
        str(row[0] or "").strip().lower()
        for row in rows
        if str(row[0] or "").strip()
    }


def find_target_deck_ids(
    conn: duckdb.DuckDBPyConnection,
    deck_table: str,
    deck_id_col: str,
    chinese_category_keys: set[str],
) -> set[int]:
    rows = conn.execute(f"SELECT {deck_id_col}, tags FROM {deck_table}").fetchall()
    return {
        int(deck_id)
        for deck_id, tags in rows
        if int(deck_id or 0) > 0 and get_first_tag_key(tags) in chinese_category_keys
    }


def migrate_cards_table(
    conn: duckdb.DuckDBPyConnection,
    deck_table: str,
    deck_id_col: str,
    chinese_category_keys: set[str],
    meaning_by_char: dict[str, str],
) -> dict[str, int]:
    target_deck_ids = find_target_deck_ids(conn, deck_table, deck_id_col, chinese_category_keys)
    stats = {
        "target_decks": len(target_deck_ids),
        "target_cards": 0,
        "updated_cards": 0,
        "missing_meaning_cards": 0,
    }
    if not target_deck_ids:
        return stats

    placeholders = ",".join(["?"] * len(target_deck_ids))
    rows = conn.execute(
        f"""
        SELECT id, front, back
        FROM cards
        WHERE deck_id IN ({placeholders})
        ORDER BY id
        """,
        sorted(target_deck_ids),
    ).fetchall()

    updates: list[list[object]] = []
    for card_id, front, back in rows:
        front_text = str(front or "").strip()
        if not SINGLE_CHINESE_CHAR_RE.fullmatch(front_text):
            continue
        stats["target_cards"] += 1
        meaning = meaning_by_char.get(front_text, "").strip()
        if not meaning:
            stats["missing_meaning_cards"] += 1
            continue
        current_pinyin, _current_meaning = split_structured_back(str(back or ""))
        next_back = compose_structured_back(current_pinyin or str(back or "").strip() or front_text, meaning)
        if next_back == str(back or "").strip():
            continue
        updates.append([next_back, int(card_id)])

    if updates:
        conn.executemany("UPDATE cards SET back = ? WHERE id = ?", updates)
    stats["updated_cards"] = len(updates)
    return stats


def migrate_shared_db(
    db_path: Path,
    chinese_category_keys: set[str],
    meaning_by_char: dict[str, str],
) -> dict[str, int]:
    conn = duckdb.connect(str(db_path))
    try:
        conn.execute("BEGIN TRANSACTION")
        stats = migrate_cards_table(
            conn,
            deck_table="deck",
            deck_id_col="deck_id",
            chinese_category_keys=chinese_category_keys,
            meaning_by_char=meaning_by_char,
        )
        conn.execute("COMMIT")
        return stats
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()


def migrate_kid_db(
    db_path: Path,
    chinese_category_keys: set[str],
    meaning_by_char: dict[str, str],
) -> dict[str, int]:
    conn = duckdb.connect(str(db_path))
    try:
        conn.execute("BEGIN TRANSACTION")
        stats = migrate_cards_table(
            conn,
            deck_table="decks",
            deck_id_col="id",
            chinese_category_keys=chinese_category_keys,
            meaning_by_char=meaning_by_char,
        )
        conn.execute("COMMIT")
        return stats
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()


def migrate_db_bytes(
    name: str,
    data: bytes,
    chinese_category_keys: set[str],
    meaning_by_char: dict[str, str],
) -> tuple[bytes, dict[str, int]] | None:
    with tempfile.TemporaryDirectory(prefix="chinese_meaning_backfill_") as tmp_dir:
        temp_db = Path(tmp_dir) / Path(name).name
        temp_db.write_bytes(data)
        if name == SHARED_DB_NAME:
            stats = migrate_shared_db(temp_db, chinese_category_keys, meaning_by_char)
        elif is_kid_db_zip_member(name):
            stats = migrate_kid_db(temp_db, chinese_category_keys, meaning_by_char)
        else:
            return None
        return temp_db.read_bytes(), stats


def load_chinese_category_keys_from_backup(input_zip: Path) -> set[str]:
    with zipfile.ZipFile(input_zip, "r") as zin:
        if SHARED_DB_NAME not in zin.namelist():
            raise RuntimeError(f"{SHARED_DB_NAME} not found in input zip.")
        shared_bytes = zin.read(SHARED_DB_NAME)
    with tempfile.TemporaryDirectory(prefix="backup_shared_db_") as tmp_dir:
        shared_db = Path(tmp_dir) / SHARED_DB_NAME
        shared_db.write_bytes(shared_bytes)
        return get_chinese_type1_category_keys(shared_db)


def migrate_full_backup_zip(
    input_zip: Path,
    output_zip: Path,
    meaning_by_char: dict[str, str],
) -> list[tuple[str, dict[str, int]]]:
    chinese_category_keys = load_chinese_category_keys_from_backup(input_zip)
    if not chinese_category_keys:
        raise RuntimeError("No Chinese-specific type-I category keys were found in shared deck metadata.")

    summaries: list[tuple[str, dict[str, int]]] = []
    with zipfile.ZipFile(input_zip, "r") as zin, zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            name = str(info.filename or "")
            data = zin.read(name)
            migrated = migrate_db_bytes(name, data, chinese_category_keys, meaning_by_char)
            if migrated is None:
                zout.writestr(info, data)
                continue
            migrated_bytes, stats = migrated
            zout.writestr(info, migrated_bytes)
            summaries.append((name, stats))
    return summaries


def main() -> None:
    args = parse_args()
    input_zip = Path(args.input_zip).expanduser().resolve()
    output_zip = Path(args.output_zip).expanduser().resolve()
    unihan_zip = Path(args.unihan_zip).expanduser().resolve()

    if not input_zip.exists():
        raise SystemExit(f"Input zip not found: {input_zip}")
    if not unihan_zip.exists():
        raise SystemExit(f"Unihan zip not found: {unihan_zip}")

    output_zip.parent.mkdir(parents=True, exist_ok=True)
    meaning_by_char = load_unihan_meanings(unihan_zip)
    if not meaning_by_char:
        raise SystemExit("No Unihan kDefinition entries were loaded.")

    summaries = migrate_full_backup_zip(input_zip, output_zip, meaning_by_char)
    if not summaries:
        raise SystemExit("No shared_decks.duckdb or kid_*.db files were found in the input zip.")

    print(
        f"Loaded {len(meaning_by_char)} Unihan glosses and migrated Chinese type-I card backs "
        f"using marker {ENGLISH_MEANING_MARKER!r}."
    )
    for name, stats in summaries:
        stat_text = ", ".join(f"{key}={value}" for key, value in stats.items())
        print(f"Migrated {name}: {stat_text}")
    print(f"Output: {output_zip}")


if __name__ == "__main__":
    main()
