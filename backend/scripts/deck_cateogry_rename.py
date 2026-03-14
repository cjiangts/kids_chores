#!/usr/bin/env python3
"""One-time full-backup migration: rename one deck category key/display name."""

from __future__ import annotations

import argparse
import json
import re
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import duckdb


SHARED_DB_NAME = "shared_decks.duckdb"
MATERIALIZED_NAME_RE = re.compile(r"^(shared_deck_\d+__)(.+)$")
MATERIALIZED_DESC_RE = re.compile(r"^(Materialized from shared deck #\d+:\s*)(.+)$")
BACKEND_ROOT = Path(__file__).resolve().parents[1]
SHARED_SCHEMA_PATHS = [
    BACKEND_ROOT / "src" / "db" / "shared_deck_schema.sql",
    BACKEND_ROOT / "src" / "db" / "shared_deck_badge_art.sql",
    BACKEND_ROOT / "src" / "db" / "shared_deck_achievement_badge_map.sql",
]


@dataclass(frozen=True)
class RenameConfig:
    old_key: str
    new_key: str
    old_display_name: str
    new_display_name: str

    @property
    def old_orphan_name(self) -> str:
        return f"{self.old_key}_orphan"

    @property
    def new_orphan_name(self) -> str:
        return f"{self.new_key}_orphan"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Rename one deck category across a full backup zip."
    )
    parser.add_argument(
        "--input-zip",
        required=True,
        help="Input full-backup zip path.",
    )
    parser.add_argument(
        "--output-zip",
        required=True,
        help="Output zip path for the migrated backup.",
    )
    parser.add_argument(
        "--old-key",
        default="math",
        help="Old category key to rename.",
    )
    parser.add_argument(
        "--new-key",
        default="basic_math_facts",
        help="New category key.",
    )
    parser.add_argument(
        "--old-display-name",
        default="Math",
        help="Old category display name.",
    )
    parser.add_argument(
        "--new-display-name",
        default="Basic Math Facts",
        help="New category display name.",
    )
    return parser.parse_args()


def list_replace_exact(values: list[str], old_value: str, new_value: str) -> list[str]:
    return [new_value if str(item) == old_value else str(item) for item in values]


def rename_shared_deck_name(name: str, config: RenameConfig) -> str:
    text = str(name or "").strip()
    prefix = f"{config.old_key}_"
    if text.startswith(prefix):
        return f"{config.new_key}_{text[len(prefix):]}"
    return text


def rename_kid_deck_name(name: str, config: RenameConfig) -> str:
    text = str(name or "").strip()
    if text == config.old_orphan_name:
        return config.new_orphan_name
    match = MATERIALIZED_NAME_RE.match(text)
    if match:
        renamed_tail = rename_shared_deck_name(match.group(2), config)
        return f"{match.group(1)}{renamed_tail}"
    return text


def rename_kid_deck_description(description: str, config: RenameConfig) -> str:
    text = str(description or "")
    replacements = {
        f"orphaned/manual {config.old_key} cards": f"orphaned/manual {config.new_key} cards",
        f"orphaned {config.old_key} cards": f"orphaned {config.new_key} cards",
    }
    for old_text, new_text in replacements.items():
        if old_text in text:
            return text.replace(old_text, new_text)

    match = MATERIALIZED_DESC_RE.match(text)
    if match:
        renamed_tail = rename_shared_deck_name(match.group(2), config)
        return f"{match.group(1)}{renamed_tail}"
    return text


def replace_reward_text(text: str, config: RenameConfig) -> str:
    value = str(text or "")
    if not value:
        return value
    value = re.sub(
        rf"\b{re.escape(config.old_display_name)}\b",
        config.new_display_name,
        value,
    )
    return re.sub(
        rf"\b{re.escape(config.old_key)}\b",
        config.new_key,
        value,
    )


def rewrite_json_values(value: Any, config: RenameConfig) -> Any:
    if isinstance(value, dict):
        return {key: rewrite_json_values(item, config) for key, item in value.items()}
    if isinstance(value, list):
        return [rewrite_json_values(item, config) for item in value]
    if isinstance(value, str):
        if value == config.old_key:
            return config.new_key
        if value == config.old_display_name:
            return config.new_display_name
        return value
    return value


def replace_reward_evidence(raw_json: str, config: RenameConfig) -> str:
    text = str(raw_json or "").strip()
    if not text:
        return text
    try:
        payload = json.loads(text)
    except Exception:
        return replace_reward_text(text, config)
    rewritten = rewrite_json_values(payload, config)
    return json.dumps(rewritten, ensure_ascii=False)


def table_exists(conn: duckdb.DuckDBPyConnection, table_name: str) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'main' AND table_name = ?
        LIMIT 1
        """,
        [table_name],
    ).fetchone()
    return bool(row)


def initialize_shared_db(conn: duckdb.DuckDBPyConnection) -> None:
    for schema_path in SHARED_SCHEMA_PATHS:
        conn.execute(schema_path.read_text(encoding="utf-8"))


def advance_sequence_next_value(
    conn: duckdb.DuckDBPyConnection,
    sequence_name: str,
    next_value: int,
) -> None:
    target = int(next_value or 1)
    if target <= 1:
        return
    conn.execute(f"SELECT nextval('{sequence_name}') FROM range({target - 1})")


def migrate_shared_db(db_path: Path, config: RenameConfig) -> dict[str, int]:
    stats = {
        "deck_category_rows": 0,
        "shared_deck_rows": 0,
        "achievement_badge_rows": 0,
    }
    source_conn = duckdb.connect(str(db_path))
    rebuilt_path = db_path.with_name(f"{db_path.stem}_rewritten{db_path.suffix}")
    target_conn = duckdb.connect(str(rebuilt_path))
    try:
        if not table_exists(source_conn, "deck_category"):
            raise RuntimeError(f"Missing deck_category table in shared DB: {db_path}")
        if not table_exists(source_conn, "deck"):
            raise RuntimeError(f"Missing deck table in shared DB: {db_path}")

        old_row = source_conn.execute(
            "SELECT category_key, display_name FROM deck_category WHERE category_key = ?",
            [config.old_key],
        ).fetchone()
        new_row = source_conn.execute(
            "SELECT category_key, display_name FROM deck_category WHERE category_key = ?",
            [config.new_key],
        ).fetchone()
        if old_row and new_row:
            raise RuntimeError(
                f"Shared DB has both {config.old_key!r} and {config.new_key!r}; refusing ambiguous migration."
            )

        initialize_shared_db(target_conn)
        target_conn.execute("BEGIN TRANSACTION")

        deck_category_rows = source_conn.execute(
            """
            SELECT
              category_key,
              behavior_type,
              has_chinese_specific_logic,
              is_shared_with_non_super_family,
              display_name,
              emoji
            FROM deck_category
            ORDER BY category_key
            """
        ).fetchall()
        for (
            category_key,
            behavior_type,
            has_logic,
            shared_with_non_super,
            display_name,
            emoji,
        ) in deck_category_rows:
            original_key = str(category_key or "")
            original_display_name = str(display_name or "")
            renamed_key = config.new_key if original_key == config.old_key else original_key
            renamed_display_name = original_display_name
            if renamed_key == config.new_key and original_display_name != config.new_display_name:
                renamed_display_name = config.new_display_name
            if renamed_key != original_key or renamed_display_name != original_display_name:
                stats["deck_category_rows"] += 1
            target_conn.execute(
                """
                INSERT INTO deck_category (
                  category_key,
                  behavior_type,
                  has_chinese_specific_logic,
                  is_shared_with_non_super_family,
                  display_name,
                  emoji
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                [
                    renamed_key,
                    behavior_type,
                    bool(has_logic),
                    bool(shared_with_non_super),
                    renamed_display_name,
                    emoji,
                ],
            )

        if table_exists(source_conn, "badge_art"):
            badge_art_rows = source_conn.execute(
                """
                SELECT badge_art_id, theme_key, image_path, source_url, license, is_active
                FROM badge_art
                ORDER BY badge_art_id
                """
            ).fetchall()
            for row in badge_art_rows:
                target_conn.execute(
                    """
                    INSERT INTO badge_art (
                      badge_art_id,
                      theme_key,
                      image_path,
                      source_url,
                      license,
                      is_active
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    list(row),
                )

        if table_exists(source_conn, "achievement_badge_art"):
            achievement_rows = source_conn.execute(
                """
                SELECT achievement_key, category_key, badge_art_id
                FROM achievement_badge_art
                ORDER BY achievement_key, category_key
                """
            ).fetchall()
            for achievement_key, category_key, badge_art_id in achievement_rows:
                original_category_key = str(category_key or "")
                renamed_category_key = (
                    config.new_key if original_category_key == config.old_key else original_category_key
                )
                if renamed_category_key != original_category_key:
                    stats["achievement_badge_rows"] += 1
                target_conn.execute(
                    """
                    INSERT INTO achievement_badge_art (
                      achievement_key,
                      category_key,
                      badge_art_id
                    ) VALUES (?, ?, ?)
                    """,
                    [achievement_key, renamed_category_key, int(badge_art_id)],
                )

        deck_rows = source_conn.execute(
            "SELECT deck_id, name, tags, creator_family_id, created_at FROM deck ORDER BY deck_id"
        ).fetchall()
        for deck_id, name, tags, creator_family_id, created_at in deck_rows:
            original_name = str(name or "").strip()
            original_tags = [str(item) for item in list(tags or [])]
            renamed_name = rename_shared_deck_name(original_name, config)
            renamed_tags = list_replace_exact(original_tags, config.old_key, config.new_key)
            if renamed_name != original_name or renamed_tags != original_tags:
                stats["shared_deck_rows"] += 1
            target_conn.execute(
                """
                INSERT INTO deck (
                  deck_id,
                  name,
                  tags,
                  creator_family_id,
                  created_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                [
                    int(deck_id),
                    renamed_name,
                    renamed_tags,
                    int(creator_family_id),
                    created_at,
                ],
            )

        if table_exists(source_conn, "cards"):
            card_rows = source_conn.execute(
                "SELECT id, deck_id, front, back FROM cards ORDER BY id"
            ).fetchall()
            for row in card_rows:
                target_conn.execute(
                    "INSERT INTO cards (id, deck_id, front, back) VALUES (?, ?, ?, ?)",
                    list(row),
                )

        max_deck_id = source_conn.execute("SELECT COALESCE(MAX(deck_id), 0) FROM deck").fetchone()[0]
        max_card_id = (
            source_conn.execute("SELECT COALESCE(MAX(id), 0) FROM cards").fetchone()[0]
            if table_exists(source_conn, "cards")
            else 0
        )
        max_badge_art_id = (
            source_conn.execute("SELECT COALESCE(MAX(badge_art_id), 0) FROM badge_art").fetchone()[0]
            if table_exists(source_conn, "badge_art")
            else 0
        )
        advance_sequence_next_value(target_conn, "shared_deck_id_seq", int(max_deck_id) + 1)
        advance_sequence_next_value(target_conn, "shared_card_id_seq", int(max_card_id) + 1)
        advance_sequence_next_value(target_conn, "badge_art_id_seq", int(max_badge_art_id) + 1)

        target_conn.execute("COMMIT")
        target_conn.close()
        target_conn = None
        source_conn.close()
        source_conn = None
        db_path.write_bytes(rebuilt_path.read_bytes())
    except Exception:
        try:
            target_conn.execute("ROLLBACK")
        except Exception:
            pass
        raise
    finally:
        if source_conn is not None:
            source_conn.close()
        if target_conn is not None:
            target_conn.close()
        if rebuilt_path.exists():
            rebuilt_path.unlink()
    return stats


def migrate_kid_db(db_path: Path, config: RenameConfig) -> dict[str, int]:
    stats = {
        "opt_in_rows": 0,
        "session_rows": 0,
        "deck_rows": 0,
        "badge_category_rows": 0,
        "badge_text_rows": 0,
    }
    conn = duckdb.connect(str(db_path))
    try:
        conn.execute("BEGIN TRANSACTION")

        if table_exists(conn, "deck_category_opt_in"):
            opt_in_rows = conn.execute(
                "SELECT category_key FROM deck_category_opt_in WHERE category_key = ?",
                [config.old_key],
            ).fetchall()
            if opt_in_rows:
                conn.execute(
                    "UPDATE deck_category_opt_in SET category_key = ? WHERE category_key = ?",
                    [config.new_key, config.old_key],
                )
                stats["opt_in_rows"] = len(opt_in_rows)

        if table_exists(conn, "sessions"):
            session_rows = conn.execute(
                "SELECT id FROM sessions WHERE type = ?",
                [config.old_key],
            ).fetchall()
            if session_rows:
                conn.execute(
                    "UPDATE sessions SET type = ? WHERE type = ?",
                    [config.new_key, config.old_key],
                )
                stats["session_rows"] = len(session_rows)

        if table_exists(conn, "decks"):
            for deck_id, name, description, tags in conn.execute(
                "SELECT id, name, description, tags FROM decks ORDER BY id"
            ).fetchall():
                original_name = str(name or "").strip()
                original_description = str(description or "")
                original_tags = [str(item) for item in list(tags or [])]
                renamed_name = rename_kid_deck_name(original_name, config)
                renamed_description = rename_kid_deck_description(original_description, config)
                renamed_tags = list_replace_exact(original_tags, config.old_key, config.new_key)
                if (
                    renamed_name == original_name
                    and renamed_description == original_description
                    and renamed_tags == original_tags
                ):
                    continue
                conn.execute(
                    """
                    UPDATE decks
                    SET name = ?, description = ?, tags = ?
                    WHERE id = ?
                    """,
                    [renamed_name, renamed_description, renamed_tags, int(deck_id)],
                )
                stats["deck_rows"] += 1

        if table_exists(conn, "kid_badge_award"):
            badge_rows = conn.execute(
                """
                SELECT award_id, category_key, reason_text, evidence_json
                FROM kid_badge_award
                ORDER BY award_id
                """
            ).fetchall()
            for award_id, category_key, reason_text, evidence_json in badge_rows:
                original_category_key = str(category_key or "")
                original_reason_text = str(reason_text or "")
                original_evidence_json = str(evidence_json or "")

                renamed_category_key = (
                    config.new_key if original_category_key == config.old_key else original_category_key
                )
                renamed_reason_text = original_reason_text
                renamed_evidence_json = original_evidence_json
                if renamed_category_key == config.new_key:
                    renamed_reason_text = replace_reward_text(original_reason_text, config)
                    renamed_evidence_json = replace_reward_evidence(original_evidence_json, config)

                if (
                    renamed_category_key == original_category_key
                    and renamed_reason_text == original_reason_text
                    and renamed_evidence_json == original_evidence_json
                ):
                    continue

                conn.execute(
                    """
                    UPDATE kid_badge_award
                    SET category_key = ?, reason_text = ?, evidence_json = ?
                    WHERE award_id = ?
                    """,
                    [
                        renamed_category_key,
                        renamed_reason_text,
                        renamed_evidence_json,
                        int(award_id),
                    ],
                )
                if renamed_category_key != original_category_key:
                    stats["badge_category_rows"] += 1
                if (
                    renamed_reason_text != original_reason_text
                    or renamed_evidence_json != original_evidence_json
                ):
                    stats["badge_text_rows"] += 1

        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
    return stats


def is_kid_db_zip_member(name: str) -> bool:
    return (
        name.startswith("families/family_")
        and name.endswith(".db")
        and "/kid_" in name
    )


def migrate_db_bytes(name: str, data: bytes, config: RenameConfig) -> tuple[bytes, dict[str, int]] | None:
    with tempfile.TemporaryDirectory(prefix="deck_category_rename_") as tmp_dir:
        temp_db = Path(tmp_dir) / Path(name).name
        temp_db.write_bytes(data)
        if name == SHARED_DB_NAME:
            stats = migrate_shared_db(temp_db, config)
        elif is_kid_db_zip_member(name):
            stats = migrate_kid_db(temp_db, config)
        else:
            return None
        return temp_db.read_bytes(), stats


def migrate_full_backup_zip(input_zip: Path, output_zip: Path, config: RenameConfig) -> list[tuple[str, dict[str, int]]]:
    summaries: list[tuple[str, dict[str, int]]] = []
    with zipfile.ZipFile(input_zip, "r") as zin, zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            name = str(info.filename or "")
            data = zin.read(name)
            migrated = migrate_db_bytes(name, data, config)
            if migrated is None:
                zout.writestr(info, data)
                continue
            migrated_bytes, stats = migrated
            zout.writestr(info, migrated_bytes)
            summaries.append((name, stats))
    return summaries


def main() -> None:
    args = parse_args()
    config = RenameConfig(
        old_key=str(args.old_key or "").strip(),
        new_key=str(args.new_key or "").strip(),
        old_display_name=str(args.old_display_name or "").strip(),
        new_display_name=str(args.new_display_name or "").strip(),
    )
    if not config.old_key or not config.new_key:
        raise SystemExit("Both --old-key and --new-key are required.")
    if config.old_key == config.new_key:
        raise SystemExit("--old-key and --new-key must differ.")

    input_zip = Path(args.input_zip).expanduser().resolve()
    output_zip = Path(args.output_zip).expanduser().resolve()
    if not input_zip.exists():
        raise SystemExit(f"Input zip not found: {input_zip}")
    output_zip.parent.mkdir(parents=True, exist_ok=True)

    summaries = migrate_full_backup_zip(input_zip, output_zip, config)
    if not summaries:
        raise SystemExit("No shared_decks.duckdb or kid_*.db files were found in the input zip.")

    print(
        f"Renamed category {config.old_key!r} -> {config.new_key!r} "
        f"and display {config.old_display_name!r} -> {config.new_display_name!r}."
    )
    for name, stats in summaries:
        stat_text = ", ".join(f"{key}={value}" for key, value in stats.items())
        print(f"Migrated {name}: {stat_text}")
    print(f"Output: {output_zip}")


if __name__ == "__main__":
    main()
