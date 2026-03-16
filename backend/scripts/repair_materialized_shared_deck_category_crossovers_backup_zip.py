#!/usr/bin/env python3
"""Repair materialized shared decks whose cards clearly belong to another shared category.

This targets kid-local decks named like shared math decks but whose actual card
fronts strongly match a shared Chinese deck (or vice versa). The repair is
conservative:

- infer the correct shared deck by strongest front overlap
- require the match to be dominant and near-complete
- only repair when the inferred category differs from the local deck category
- preserve card ids/history
- collapse unpracticed duplicate local decks for the same inferred shared deck
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


@dataclass
class SharedDeckMeta:
    deck_id: int
    name: str
    tags: list[str]
    fronts: set[str]


@dataclass
class LocalDeckCandidate:
    deck_id: int
    current_shared_id: int | None
    inferred_shared_id: int
    name: str
    tags: list[str]
    card_ids: list[int]
    history_count: int
    local_front_count: int
    top_overlap: int
    second_overlap: int


def load_shared_front_map(db_path: Path) -> dict[int, SharedDeckMeta]:
    conn = duckdb.connect(str(db_path), read_only=True)
    try:
        deck_rows = conn.execute("SELECT deck_id, name, tags FROM deck ORDER BY deck_id ASC").fetchall()
        cards_by_deck_id: dict[int, set[str]] = defaultdict(set)
        for deck_id, front in conn.execute("SELECT deck_id, front FROM cards ORDER BY deck_id ASC, id ASC").fetchall():
            cards_by_deck_id[int(deck_id)].add(str(front or ""))
    finally:
        conn.close()

    result: dict[int, SharedDeckMeta] = {}
    for row in deck_rows:
        deck_id = int(row[0])
        result[deck_id] = SharedDeckMeta(
            deck_id=deck_id,
            name=str(row[1] or ""),
            tags=normalize_tags(row[2]),
            fronts=set(cards_by_deck_id.get(deck_id, set())),
        )
    return result


def choose_canonical_entry(entries: list[LocalDeckCandidate]) -> LocalDeckCandidate:
    return sorted(
        entries,
        key=lambda entry: (
            -int(entry.history_count > 0),
            -int(entry.history_count),
            int(entry.deck_id),
        ),
    )[0]


def delete_related_rows_for_cards(conn: duckdb.DuckDBPyConnection, card_ids: list[int]) -> None:
    if not card_ids:
        return
    placeholders = ",".join(["?"] * len(card_ids))
    conn.execute(f"DELETE FROM writing_sheet_cards WHERE card_id IN ({placeholders})", card_ids)
    conn.execute(f"DELETE FROM session_results WHERE card_id IN ({placeholders})", card_ids)
    conn.execute(f"DELETE FROM cards WHERE id IN ({placeholders})", card_ids)


def should_accept_inferred_target(
    local_tags: list[str],
    local_front_count: int,
    top_overlap: int,
    second_overlap: int,
    target_tags: list[str],
) -> bool:
    local_category = str(local_tags[0] or "").strip() if local_tags else ""
    target_category = str(target_tags[0] or "").strip() if target_tags else ""
    if not local_category or not target_category or local_category == target_category:
        return False
    if local_front_count <= 0:
        return False
    if top_overlap < max(3, local_front_count - 2):
        return False
    if top_overlap < second_overlap + 5:
        return False
    return True


def repair_kid_db(db_path: Path, shared_meta_by_id: dict[int, SharedDeckMeta]) -> dict[str, int]:
    conn = duckdb.connect(str(db_path))
    try:
        deck_rows = conn.execute(
            "SELECT id, name, tags FROM decks WHERE name LIKE ? ORDER BY id ASC",
            [f"{MATERIALIZED_SHARED_DECK_NAME_PREFIX}%"],
        ).fetchall()
        shared_items = list(shared_meta_by_id.values())

        candidates: list[LocalDeckCandidate] = []
        for row in deck_rows:
            deck_id = int(row[0])
            name = str(row[1] or "")
            tags = normalize_tags(row[2])
            current_shared_id = parse_shared_deck_id_from_materialized_name(name)
            local_cards = conn.execute(
                "SELECT id, front FROM cards WHERE deck_id = ? ORDER BY id ASC",
                [deck_id],
            ).fetchall()
            local_fronts = {str(item[1] or "") for item in local_cards}
            if not local_fronts:
                continue

            best_meta = None
            best_overlap = -1
            second_overlap = -1
            for meta in shared_items:
                overlap = len(local_fronts & meta.fronts)
                if overlap > best_overlap:
                    second_overlap = best_overlap
                    best_overlap = overlap
                    best_meta = meta
                elif overlap > second_overlap:
                    second_overlap = overlap
            if best_meta is None or best_overlap <= 0:
                continue
            if not should_accept_inferred_target(tags, len(local_fronts), best_overlap, max(0, second_overlap), best_meta.tags):
                continue

            card_ids = [int(item[0]) for item in local_cards]
            placeholders = ",".join(["?"] * len(card_ids))
            history_row = conn.execute(
                f"SELECT COUNT(*) FROM session_results WHERE card_id IN ({placeholders})",
                card_ids,
            ).fetchone()
            candidates.append(LocalDeckCandidate(
                deck_id=deck_id,
                current_shared_id=current_shared_id,
                inferred_shared_id=int(best_meta.deck_id),
                name=name,
                tags=tags,
                card_ids=card_ids,
                history_count=int((history_row[0] if history_row else 0) or 0),
                local_front_count=len(local_fronts),
                top_overlap=int(best_overlap),
                second_overlap=max(0, int(second_overlap)),
            ))

        by_inferred_id: dict[int, list[LocalDeckCandidate]] = defaultdict(list)
        for entry in candidates:
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
        with tempfile.TemporaryDirectory(prefix="repair_shared_fronts_") as tmp_dir:
            shared_db_path = Path(tmp_dir) / SHARED_DB_NAME
            shared_db_path.write_bytes(zin.read(shared_member_name))
            shared_meta_by_id = load_shared_front_map(shared_db_path)

        with zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as zout:
            for info in zin.infolist():
                name = str(info.filename or "")
                data = zin.read(name)
                if not is_kid_db_zip_member(name):
                    zout.writestr(info, data)
                    continue

                totals["kid_db_count"] += 1
                with tempfile.TemporaryDirectory(prefix="repair_category_crossovers_") as tmp_dir:
                    tmp_db = Path(tmp_dir) / Path(name).name
                    tmp_db.write_bytes(data)
                    result = repair_kid_db(tmp_db, shared_meta_by_id)
                    if any(int(result.get(key) or 0) > 0 for key in result.keys()):
                        totals["kid_db_changed_count"] += 1
                    for key in ("renamed_count", "deleted_duplicate_count", "preserved_duplicate_count"):
                        totals[key] += int(result.get(key) or 0)
                    zout.writestr(info, tmp_db.read_bytes())
    return totals


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Repair materialized shared decks whose cards belong to another shared category."
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
        "Repaired cross-category materialized shared decks: "
        f"kid_dbs={totals['kid_db_count']}, "
        f"changed_kid_dbs={totals['kid_db_changed_count']}, "
        f"renamed={totals['renamed_count']}, "
        f"deleted_duplicates={totals['deleted_duplicate_count']}, "
        f"preserved_duplicates={totals['preserved_duplicate_count']}"
    )
    print(f"Output: {output_zip}")


if __name__ == "__main__":
    main()
