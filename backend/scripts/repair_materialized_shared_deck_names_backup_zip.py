#!/usr/bin/env python3
"""Repair misnamed materialized shared decks inside a full backup zip.

This fixes a bug where SQL LIKE matching on names such as `shared_deck_1__...`
could also match `shared_deck_162__...`, causing deck metadata sync to rename
the wrong kid-local materialized deck. The repair uses actual card contents to
infer the correct shared deck, then:

- renames the practiced/canonical local deck to the correct shared metadata
- deletes only duplicate local copies that have no history
- preserves card ids and session history for practiced copies
"""

from __future__ import annotations

import argparse
import tempfile
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
import zipfile

import duckdb


SHARED_DB_NAME = "shared_decks.duckdb"
MATERIALIZED_SHARED_DECK_NAME_PREFIX = "shared_deck_"


def is_shared_db_zip_member(name: str) -> bool:
    return Path(str(name or "")).name == SHARED_DB_NAME


def is_kid_db_zip_member(name: str) -> bool:
    return (
        str(name or "").startswith("families/family_")
        and str(name or "").endswith(".db")
        and "/kid_" in str(name or "")
    )


def parse_shared_deck_id_from_materialized_name(deck_name: str) -> int | None:
    text = str(deck_name or "").strip()
    if not text.startswith(MATERIALIZED_SHARED_DECK_NAME_PREFIX):
        return None
    tail = text[len(MATERIALIZED_SHARED_DECK_NAME_PREFIX):]
    parts = tail.split("__", 1)
    if len(parts) != 2:
        return None
    try:
        deck_id = int(parts[0])
    except (TypeError, ValueError):
        return None
    return deck_id if deck_id > 0 else None


def build_materialized_shared_deck_name(shared_deck_id: int, shared_deck_name: str) -> str:
    return f"{MATERIALIZED_SHARED_DECK_NAME_PREFIX}{int(shared_deck_id)}__{str(shared_deck_name or '').strip()}"


def normalize_tags(raw_tags) -> list[str]:
    return [str(item) for item in list(raw_tags or [])]


def build_card_signature(rows) -> tuple[tuple[str, str], ...]:
    return tuple(sorted((str(row[0] or ""), str(row[1] or "")) for row in list(rows or [])))


@dataclass
class SharedDeckMeta:
    deck_id: int
    name: str
    tags: list[str]
    signature: tuple[tuple[str, str], ...]


@dataclass
class LocalDeckEntry:
    deck_id: int
    current_shared_id: int | None
    inferred_shared_id: int
    name: str
    tags: list[str]
    card_ids: list[int]
    history_count: int
    signature: tuple[tuple[str, str], ...]


def load_shared_signature_map(db_path: Path) -> tuple[dict[int, SharedDeckMeta], dict[tuple[tuple[str, str], ...], list[int]]]:
    conn = duckdb.connect(str(db_path), read_only=True)
    try:
        deck_rows = conn.execute(
            "SELECT deck_id, name, tags FROM deck ORDER BY deck_id ASC"
        ).fetchall()
        card_rows = conn.execute(
            "SELECT deck_id, front, back FROM cards ORDER BY deck_id ASC, id ASC"
        ).fetchall()
    finally:
        conn.close()

    cards_by_deck_id: dict[int, list[tuple[str, str]]] = defaultdict(list)
    for row in card_rows:
        cards_by_deck_id[int(row[0])].append((str(row[1] or ""), str(row[2] or "")))

    meta_by_id: dict[int, SharedDeckMeta] = {}
    signature_to_ids: dict[tuple[tuple[str, str], ...], list[int]] = defaultdict(list)
    for row in deck_rows:
        deck_id = int(row[0])
        signature = build_card_signature(cards_by_deck_id.get(deck_id, []))
        meta = SharedDeckMeta(
            deck_id=deck_id,
            name=str(row[1] or ""),
            tags=normalize_tags(row[2]),
            signature=signature,
        )
        meta_by_id[deck_id] = meta
        if signature:
            signature_to_ids[signature].append(deck_id)
    return meta_by_id, dict(signature_to_ids)


def delete_related_rows_for_cards(conn: duckdb.DuckDBPyConnection, card_ids: list[int]) -> None:
    if not card_ids:
        return
    placeholders = ",".join(["?"] * len(card_ids))
    conn.execute(f"DELETE FROM writing_sheet_cards WHERE card_id IN ({placeholders})", card_ids)
    conn.execute(f"DELETE FROM session_results WHERE card_id IN ({placeholders})", card_ids)
    conn.execute(f"DELETE FROM cards WHERE id IN ({placeholders})", card_ids)


def choose_canonical_entry(entries: list[LocalDeckEntry]) -> LocalDeckEntry:
    return sorted(
        entries,
        key=lambda entry: (
            -int(entry.history_count > 0),
            -int(entry.history_count),
            int(entry.deck_id),
        ),
    )[0]


def repair_kid_db(
    db_path: Path,
    shared_meta_by_id: dict[int, SharedDeckMeta],
    shared_signature_to_ids: dict[tuple[tuple[str, str], ...], list[int]],
) -> dict[str, int]:
    conn = duckdb.connect(str(db_path))
    try:
        deck_rows = conn.execute(
            "SELECT id, name, tags FROM decks WHERE name LIKE ? ORDER BY id ASC",
            [f"{MATERIALIZED_SHARED_DECK_NAME_PREFIX}%"],
        ).fetchall()

        local_entries: list[LocalDeckEntry] = []
        for row in deck_rows:
            deck_id = int(row[0])
            name = str(row[1] or "")
            tags = normalize_tags(row[2])
            current_shared_id = parse_shared_deck_id_from_materialized_name(name)
            card_rows = conn.execute(
                "SELECT id, front, back FROM cards WHERE deck_id = ? ORDER BY id ASC",
                [deck_id],
            ).fetchall()
            if not card_rows:
                continue
            signature = build_card_signature((item[1], item[2]) for item in card_rows)
            matched_shared_ids = list(shared_signature_to_ids.get(signature, []))
            if len(matched_shared_ids) != 1:
                continue
            inferred_shared_id = int(matched_shared_ids[0])
            card_ids = [int(item[0]) for item in card_rows]
            placeholders = ",".join(["?"] * len(card_ids))
            history_row = conn.execute(
                f"SELECT COUNT(*) FROM session_results WHERE card_id IN ({placeholders})",
                card_ids,
            ).fetchone()
            local_entries.append(LocalDeckEntry(
                deck_id=deck_id,
                current_shared_id=current_shared_id,
                inferred_shared_id=inferred_shared_id,
                name=name,
                tags=tags,
                card_ids=card_ids,
                history_count=int((history_row[0] if history_row else 0) or 0),
                signature=signature,
            ))

        by_inferred_id: dict[int, list[LocalDeckEntry]] = defaultdict(list)
        for entry in local_entries:
            by_inferred_id[entry.inferred_shared_id].append(entry)

        renamed_count = 0
        deleted_duplicate_count = 0
        preserved_duplicate_count = 0

        conn.execute("BEGIN TRANSACTION")
        try:
            for inferred_shared_id, entries in by_inferred_id.items():
                meta = shared_meta_by_id.get(inferred_shared_id)
                if meta is None:
                    continue
                target_name = build_materialized_shared_deck_name(meta.deck_id, meta.name)
                target_tags = list(meta.tags)
                needs_group_repair = any(
                    entry.current_shared_id != inferred_shared_id
                    or entry.name != target_name
                    or entry.tags != target_tags
                    for entry in entries
                )
                if not needs_group_repair:
                    continue

                canonical = choose_canonical_entry(entries)
                if canonical.name != target_name or canonical.tags != target_tags:
                    conn.execute(
                        "UPDATE decks SET name = ?, tags = ? WHERE id = ?",
                        [target_name, target_tags, canonical.deck_id],
                    )
                    renamed_count += 1

                for entry in entries:
                    if entry.deck_id == canonical.deck_id:
                        continue
                    if entry.history_count > 0:
                        if entry.name != target_name or entry.tags != target_tags:
                            conn.execute(
                                "UPDATE decks SET name = ?, tags = ? WHERE id = ?",
                                [target_name, target_tags, entry.deck_id],
                            )
                            renamed_count += 1
                        preserved_duplicate_count += 1
                        continue

                    delete_related_rows_for_cards(conn, entry.card_ids)
                    conn.execute("DELETE FROM decks WHERE id = ?", [entry.deck_id])
                    deleted_duplicate_count += 1

            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise

        return {
            "renamed_count": renamed_count,
            "deleted_duplicate_count": deleted_duplicate_count,
            "preserved_duplicate_count": preserved_duplicate_count,
        }
    finally:
        conn.close()


def repair_full_backup_zip(input_zip: Path, output_zip: Path) -> dict[str, int]:
    totals = {
        "kid_db_count": 0,
        "kid_db_changed_count": 0,
        "renamed_count": 0,
        "deleted_duplicate_count": 0,
        "preserved_duplicate_count": 0,
    }

    with zipfile.ZipFile(input_zip, "r") as zin:
        shared_member_name = next((info.filename for info in zin.infolist() if is_shared_db_zip_member(info.filename)), None)
        if not shared_member_name:
            raise SystemExit("Shared deck DB not found in backup zip")
        with tempfile.TemporaryDirectory(prefix="repair_shared_meta_") as tmp_dir:
            shared_db_path = Path(tmp_dir) / SHARED_DB_NAME
            shared_db_path.write_bytes(zin.read(shared_member_name))
            shared_meta_by_id, shared_signature_to_ids = load_shared_signature_map(shared_db_path)

        with zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as zout:
            for info in zin.infolist():
                name = str(info.filename or "")
                data = zin.read(name)
                if not is_kid_db_zip_member(name):
                    zout.writestr(info, data)
                    continue

                totals["kid_db_count"] += 1
                with tempfile.TemporaryDirectory(prefix="repair_kid_zip_") as tmp_dir:
                    tmp_db = Path(tmp_dir) / Path(name).name
                    tmp_db.write_bytes(data)
                    result = repair_kid_db(tmp_db, shared_meta_by_id, shared_signature_to_ids)
                    if any(int(result.get(key) or 0) > 0 for key in result.keys()):
                        totals["kid_db_changed_count"] += 1
                    for key in ("renamed_count", "deleted_duplicate_count", "preserved_duplicate_count"):
                        totals[key] += int(result.get(key) or 0)
                    zout.writestr(info, tmp_db.read_bytes())
    return totals


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Repair misnamed materialized shared decks inside a full backup zip."
    )
    parser.add_argument("--input-zip", required=True, help="Input full-backup zip path.")
    parser.add_argument("--output-zip", required=True, help="Output zip path for the repaired backup.")
    args = parser.parse_args()

    input_zip = Path(str(args.input_zip or "").strip()).expanduser().resolve()
    output_zip = Path(str(args.output_zip or "").strip()).expanduser().resolve()
    if not input_zip.exists():
        raise SystemExit(f"Input zip not found: {input_zip}")
    output_zip.parent.mkdir(parents=True, exist_ok=True)

    totals = repair_full_backup_zip(input_zip, output_zip)
    print(
        "Repaired materialized shared deck metadata: "
        f"kid_dbs={totals['kid_db_count']}, "
        f"changed_kid_dbs={totals['kid_db_changed_count']}, "
        f"renamed={totals['renamed_count']}, "
        f"deleted_duplicates={totals['deleted_duplicate_count']}, "
        f"preserved_duplicates={totals['preserved_duplicate_count']}"
    )
    print(f"Output: {output_zip}")


if __name__ == "__main__":
    main()
