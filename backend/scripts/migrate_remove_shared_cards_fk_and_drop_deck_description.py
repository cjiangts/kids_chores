#!/usr/bin/env python3
"""One-time migration: schema cleanup plus polyphone pinyin backfill."""

from __future__ import annotations

import argparse
import re
import tempfile
from pathlib import Path
import zipfile

import duckdb


SHARED_DB_NAME = "shared_decks.duckdb"
SHARED_CARDS_FK_SQL = "FOREIGN KEY (deck_id) REFERENCES deck(deck_id)"
DB_DIR = Path(__file__).resolve().parents[1] / "src" / "db"
KID_SCHEMA_FILES = (
    DB_DIR / "schema.sql",
    DB_DIR / "schema_badges.sql",
)
SHARED_SCHEMA_FILES = (
    DB_DIR / "shared_deck_schema.sql",
    DB_DIR / "shared_deck_badge_art.sql",
    DB_DIR / "shared_deck_achievement_badge_map.sql",
)


def read_schema_sql(*file_paths: Path) -> str:
    parts: list[str] = []
    for file_path in file_paths:
        if not file_path.exists():
            continue
        parts.append(file_path.read_text(encoding="utf-8").strip())
    return "\n\n".join(part for part in parts if part)


KID_SCHEMA_SQL = read_schema_sql(*KID_SCHEMA_FILES)
SHARED_SCHEMA_SQL = read_schema_sql(*SHARED_SCHEMA_FILES)
SINGLE_CHINESE_CHAR_RE = re.compile(r"^[\u3400-\u9FFF\uF900-\uFAFF]$")
TYPE_I_BEHAVIOR = "type_i"
_PYPINYIN_DICTS_LOADED = False


def is_kid_db_path(path: Path) -> bool:
    return path.is_file() and path.name.startswith("kid_") and path.suffix == ".db"


def is_kid_db_zip_member(name: str) -> bool:
    return (
        name.startswith("families/family_")
        and name.endswith(".db")
        and "/kid_" in name
    )


def is_shared_db_zip_member(name: str) -> bool:
    return Path(name).name == SHARED_DB_NAME


def table_sql(conn: duckdb.DuckDBPyConnection, table_name: str) -> str:
    row = conn.execute(
        """
        SELECT sql
        FROM duckdb_tables()
        WHERE schema_name = 'main' AND table_name = ?
        LIMIT 1
        """,
        [str(table_name or "").strip()],
    ).fetchone()
    return str(row[0] or "") if row else ""


def table_has_column(conn: duckdb.DuckDBPyConnection, table_name: str, column_name: str) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'main'
          AND table_name = ?
          AND column_name = ?
        LIMIT 1
        """,
        [str(table_name or "").strip(), str(column_name or "").strip()],
    ).fetchone()
    return bool(row)


def normalize_shared_deck_tag(raw_tag: str) -> str:
    text = str(raw_tag or "").strip().lower()
    if not text:
        return ""
    text = re.sub(r"\([^()]*\)\s*$", "", text).strip()
    if not text:
        return ""
    text = re.sub(r"\s+", "_", text)
    text = re.sub(r"_+", "_", text).strip("_")
    return text


def get_first_normalized_tag(raw_tags) -> str:
    tags = [normalize_shared_deck_tag(item) for item in list(raw_tags or [])]
    tags = [item for item in tags if item]
    return tags[0] if tags else ""


def ensure_pypinyin_dicts_loaded() -> None:
    global _PYPINYIN_DICTS_LOADED
    if _PYPINYIN_DICTS_LOADED:
        return
    from pypinyin_dict.phrase_pinyin_data import cc_cedict  # type: ignore
    from pypinyin_dict.pinyin_data import kxhc1983  # type: ignore

    cc_cedict.load()
    kxhc1983.load()
    _PYPINYIN_DICTS_LOADED = True


def build_legacy_chinese_pinyin_text(text) -> str:
    normalized = str(text or "").strip()
    if not normalized:
        return ""
    from pypinyin import Style, lazy_pinyin  # type: ignore

    syllables = lazy_pinyin(
        normalized,
        style=Style.TONE,
        neutral_tone_with_five=True,
        strict=False,
        errors="default",
    )
    parts = [str(item or "").strip() for item in list(syllables or [])]
    parts = [item for item in parts if item]
    return " ".join(parts)


def build_current_chinese_pinyin_text(text) -> str:
    normalized = str(text or "").strip()
    if not normalized:
        return ""
    from pypinyin import Style, lazy_pinyin, pinyin  # type: ignore

    ensure_pypinyin_dicts_loaded()

    if len(normalized) == 1:
        heteronyms = pinyin(
            normalized,
            style=Style.TONE,
            heteronym=True,
            neutral_tone_with_five=True,
            strict=False,
            errors="default",
        )
        first_group = heteronyms[0] if heteronyms else []
        ordered = []
        seen = set()
        for item in list(first_group or []):
            syllable = str(item or "").strip()
            if not syllable or syllable in seen:
                continue
            ordered.append(syllable)
            seen.add(syllable)
        return " / ".join(ordered)

    syllables = lazy_pinyin(
        normalized,
        style=Style.TONE,
        neutral_tone_with_five=True,
        strict=False,
        errors="default",
    )
    parts = [str(item or "").strip() for item in list(syllables or [])]
    parts = [item for item in parts if item]
    return " ".join(parts)


def get_chinese_type_i_category_keys(conn: duckdb.DuckDBPyConnection) -> set[str]:
    rows = conn.execute(
        """
        SELECT category_key
        FROM deck_category
        WHERE behavior_type = ?
          AND has_chinese_specific_logic = TRUE
        """,
        [TYPE_I_BEHAVIOR],
    ).fetchall()
    return {
        str(row[0] or "").strip()
        for row in rows
        if str(row[0] or "").strip()
    }


def collect_polyphone_backfill_candidates(
    conn: duckdb.DuckDBPyConnection,
    *,
    deck_table_name: str,
    deck_id_col: str,
    chinese_category_keys: set[str],
) -> list[tuple[int, str, str]]:
    if not chinese_category_keys:
        return []
    deck_rows = conn.execute(
        f"SELECT {deck_id_col}, tags FROM {deck_table_name}"
    ).fetchall()
    target_deck_ids = {
        int(row[0])
        for row in deck_rows
        if int(row[0] or 0) > 0 and get_first_normalized_tag(row[1]) in chinese_category_keys
    }
    if not target_deck_ids:
        return []

    placeholders = ",".join(["?"] * len(target_deck_ids))
    card_rows = conn.execute(
        f"""
        SELECT id, front, back
        FROM cards
        WHERE deck_id IN ({placeholders})
        ORDER BY id ASC
        """,
        sorted(target_deck_ids),
    ).fetchall()

    candidates: list[tuple[int, str, str]] = []
    for row in card_rows:
        card_id = int(row[0] or 0)
        front = str(row[1] or "").strip()
        back = str(row[2] or "").strip()
        if card_id <= 0 or not SINGLE_CHINESE_CHAR_RE.fullmatch(front):
            continue
        legacy_back = build_legacy_chinese_pinyin_text(front)
        if not legacy_back or back != legacy_back:
            continue
        candidates.append((card_id, front, back))
    return candidates


def apply_polyphone_backfill(
    conn: duckdb.DuckDBPyConnection,
    candidates: list[tuple[int, str, str]],
) -> int:
    if not candidates:
        return 0
    update_rows = []
    for card_id, front, old_back in candidates:
        new_back = str(build_current_chinese_pinyin_text(front) or "").strip()
        if not new_back or new_back == old_back:
            continue
        update_rows.append([new_back, int(card_id)])
    if update_rows:
        conn.executemany("UPDATE cards SET back = ? WHERE id = ?", update_rows)
    return len(update_rows)


def migrate_shared_db(db_path: Path) -> tuple[dict[str, int], set[str]]:
    stats = {
        "shared_cards_fk_removed": 0,
        "shared_schema_applied": 0,
        "polyphone_pinyin_updated": 0,
    }
    conn = duckdb.connect(str(db_path))
    try:
        cards_sql = table_sql(conn, "cards")
        if cards_sql and SHARED_CARDS_FK_SQL in cards_sql:
            conn.execute("BEGIN TRANSACTION")
            try:
                conn.execute("DROP TABLE IF EXISTS cards_rebuilt")
                conn.execute(
                    """
                    CREATE TABLE cards_rebuilt (
                      id INTEGER PRIMARY KEY DEFAULT nextval('shared_card_id_seq'),
                      deck_id INTEGER NOT NULL,
                      front VARCHAR NOT NULL,
                      back VARCHAR NOT NULL,
                      UNIQUE (deck_id, front)
                    )
                    """
                )
                conn.execute(
                    """
                    INSERT INTO cards_rebuilt (id, deck_id, front, back)
                    SELECT id, deck_id, front, back
                    FROM cards
                    ORDER BY id
                    """
                )
                conn.execute("DROP TABLE cards")
                conn.execute("ALTER TABLE cards_rebuilt RENAME TO cards")
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_cards_deck_id_front ON cards(deck_id, front)"
                )
                conn.execute("COMMIT")
                stats["shared_cards_fk_removed"] = 1
            except Exception:
                conn.execute("ROLLBACK")
                raise

        if SHARED_SCHEMA_SQL:
            conn.execute(SHARED_SCHEMA_SQL)
            stats["shared_schema_applied"] = 1
        chinese_category_keys = get_chinese_type_i_category_keys(conn)
        candidates = collect_polyphone_backfill_candidates(
            conn,
            deck_table_name="deck",
            deck_id_col="deck_id",
            chinese_category_keys=chinese_category_keys,
        )
        stats["polyphone_pinyin_updated"] = apply_polyphone_backfill(conn, candidates)
    finally:
        conn.close()
    return stats, chinese_category_keys


def migrate_kid_db(db_path: Path, chinese_category_keys: set[str]) -> dict[str, int]:
    stats = {
        "deck_description_removed": 0,
        "kid_schema_applied": 0,
        "polyphone_pinyin_updated": 0,
    }
    conn = duckdb.connect(str(db_path))
    try:
        if KID_SCHEMA_SQL:
            conn.execute(KID_SCHEMA_SQL)
            stats["kid_schema_applied"] = 1
        if table_has_column(conn, "decks", "description"):
            conn.execute("BEGIN TRANSACTION")
            try:
                conn.execute("ALTER TABLE decks DROP COLUMN description")
                conn.execute("COMMIT")
                stats["deck_description_removed"] = 1
            except Exception:
                conn.execute("ROLLBACK")
                raise
        candidates = collect_polyphone_backfill_candidates(
            conn,
            deck_table_name="decks",
            deck_id_col="id",
            chinese_category_keys=chinese_category_keys,
        )
        stats["polyphone_pinyin_updated"] = apply_polyphone_backfill(conn, candidates)
    finally:
        conn.close()
    return stats


def migrate_db_bytes(
    name: str,
    data: bytes,
    *,
    chinese_category_keys: set[str],
) -> tuple[bytes, dict[str, int], set[str]] | None:
    with tempfile.TemporaryDirectory(prefix="schema_cleanup_zip_mig_") as tmp_dir:
        temp_db = Path(tmp_dir) / Path(name).name
        temp_db.write_bytes(data)
        if is_shared_db_zip_member(name):
            stats, shared_chinese_keys = migrate_shared_db(temp_db)
        elif is_kid_db_zip_member(name):
            stats = migrate_kid_db(temp_db, chinese_category_keys)
            shared_chinese_keys = set(chinese_category_keys)
        else:
            return None
        return temp_db.read_bytes(), stats, shared_chinese_keys


def migrate_full_backup_zip(input_zip: Path, output_zip: Path) -> list[tuple[str, dict[str, int]]]:
    summaries: list[tuple[str, dict[str, int]]] = []
    shared_bytes = None
    shared_stats = None
    chinese_category_keys: set[str] = set()

    with zipfile.ZipFile(input_zip, "r") as zin:
        for info in zin.infolist():
            name = str(info.filename or "")
            if not is_shared_db_zip_member(name):
                continue
            migrated = migrate_db_bytes(name, zin.read(name), chinese_category_keys=set())
            if migrated is None:
                continue
            shared_bytes, shared_stats, chinese_category_keys = migrated
            summaries.append((name, shared_stats))
            break

    with zipfile.ZipFile(input_zip, "r") as zin, zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            name = str(info.filename or "")
            if is_shared_db_zip_member(name) and shared_bytes is not None:
                zout.writestr(info, shared_bytes)
                continue
            data = zin.read(name)
            migrated = migrate_db_bytes(
                name,
                data,
                chinese_category_keys=chinese_category_keys,
            )
            if migrated is None:
                zout.writestr(info, data)
                continue
            migrated_bytes, stats, _ = migrated
            zout.writestr(info, migrated_bytes)
            if not is_shared_db_zip_member(name):
                summaries.append((name, stats))
    return summaries


def find_kid_dbs(data_root: Path) -> list[Path]:
    families_root = data_root / "families"
    if not families_root.exists():
        return []
    return sorted(path for path in families_root.glob("family_*/kid_*.db") if path.is_file())


def migrate_data_root(data_root: Path) -> list[tuple[str, dict[str, int]]]:
    summaries: list[tuple[str, dict[str, int]]] = []
    chinese_category_keys: set[str] = set()

    shared_db = data_root / SHARED_DB_NAME
    if shared_db.is_file():
        shared_stats, chinese_category_keys = migrate_shared_db(shared_db)
        summaries.append((str(shared_db), shared_stats))

    for kid_db in find_kid_dbs(data_root):
        summaries.append((str(kid_db), migrate_kid_db(kid_db, chinese_category_keys)))

    return summaries


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Clean up backup DB schema and apply one-time polyphone pinyin backfill."
    )
    parser.add_argument(
        "--data-root",
        default="",
        help="Optional backend data root to migrate in place (e.g. backend/data).",
    )
    parser.add_argument(
        "--input-zip",
        default="",
        help="Optional full-backup zip to migrate.",
    )
    parser.add_argument(
        "--output-zip",
        default="",
        help="Output zip path when --input-zip is provided.",
    )
    return parser


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()

    input_zip = Path(str(args.input_zip or "").strip()).expanduser() if str(args.input_zip or "").strip() else None
    output_zip = Path(str(args.output_zip or "").strip()).expanduser() if str(args.output_zip or "").strip() else None
    data_root = Path(str(args.data_root or "").strip()).expanduser() if str(args.data_root or "").strip() else None

    if input_zip:
        if not output_zip:
            raise SystemExit("--output-zip is required when --input-zip is provided")
        if not input_zip.exists():
            raise SystemExit(f"Input zip not found: {input_zip}")
        output_zip.parent.mkdir(parents=True, exist_ok=True)
        summaries = migrate_full_backup_zip(input_zip.resolve(), output_zip.resolve())
        if not summaries:
            raise SystemExit("No shared_decks.duckdb or kid_*.db files were found in the input zip.")
        for name, stats in summaries:
            stat_text = ", ".join(f"{key}={value}" for key, value in stats.items())
            print(f"Migrated {name}: {stat_text}")
        print(f"Output: {output_zip.resolve()}")
        return

    if not data_root:
        raise SystemExit("Provide either --input-zip/--output-zip or --data-root")
    resolved_data_root = data_root.resolve()
    if not resolved_data_root.exists():
        raise SystemExit(f"Data root not found: {resolved_data_root}")

    summaries = migrate_data_root(resolved_data_root)
    if not summaries:
        raise SystemExit(f"No shared/kid DB files found under: {resolved_data_root}")

    for name, stats in summaries:
        stat_text = ", ".join(f"{key}={value}" for key, value in stats.items())
        print(f"Migrated {name}: {stat_text}")


if __name__ == "__main__":
    main()
