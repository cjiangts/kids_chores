"""Materialized shared-deck synchronization helpers.

Pure helpers extracted from `src.routes.kids` Phase 2 refactor.
"""
from src.db import kid_db, metadata
from src.routes.kids_constants import MATERIALIZED_SHARED_DECK_NAME_PREFIX
from src.services.shared_deck_normalize import extract_shared_deck_tags_and_labels


def build_materialized_shared_deck_name(shared_deck_id, shared_deck_name):
    """Build deterministic kid-local deck name for one shared deck."""
    shared_name = str(shared_deck_name or '').strip()
    return f"{MATERIALIZED_SHARED_DECK_NAME_PREFIX}{int(shared_deck_id)}__{shared_name}"


def parse_shared_deck_id_from_materialized_name(deck_name):
    """Parse shared deck id from kid-local materialized deck name."""
    text = str(deck_name or '').strip()
    prefix = MATERIALIZED_SHARED_DECK_NAME_PREFIX
    if not text.startswith(prefix):
        return None
    tail = text[len(prefix):]
    parts = tail.split('__', 1)
    if len(parts) != 2:
        return None
    try:
        deck_id = int(parts[0])
    except (TypeError, ValueError):
        return None
    if deck_id <= 0:
        return None
    return deck_id


def build_materialized_shared_deck_tags(shared_tags):
    """Build kid-local deck tags for materialized shared decks."""
    tags, _ = extract_shared_deck_tags_and_labels(shared_tags)
    return tags


def get_materialized_shared_deck_rows_by_shared_deck_id(conn, shared_deck_id):
    """Return kid-local materialized deck rows for one shared deck id."""
    try:
        shared_id = int(shared_deck_id)
    except (TypeError, ValueError):
        return []
    if shared_id <= 0:
        return []
    rows = conn.execute(
        "SELECT id, name, tags FROM decks WHERE name LIKE ? ORDER BY id ASC",
        [f"{MATERIALIZED_SHARED_DECK_NAME_PREFIX}%"],
    ).fetchall()
    matched = []
    for row in rows:
        local_name = str(row[1] or '')
        parsed_shared_id = parse_shared_deck_id_from_materialized_name(local_name)
        if parsed_shared_id != shared_id:
            continue
        matched.append(row)
    return matched


def sync_materialized_shared_deck_metadata_for_kid(conn, shared_deck_id, shared_deck_name, shared_storage_tags):
    """Align one kid DB's materialized deck metadata with the shared deck source."""
    target_name = build_materialized_shared_deck_name(shared_deck_id, shared_deck_name)
    target_tags = build_materialized_shared_deck_tags(shared_storage_tags)
    rows = get_materialized_shared_deck_rows_by_shared_deck_id(conn, shared_deck_id)
    if not rows:
        return 0

    changed_rows = []
    for deck_id, name, tags in rows:
        current_name = str(name or '')
        current_tags = [str(item) for item in list(tags or [])]
        if current_name == target_name and current_tags == target_tags:
            continue
        changed_rows.append(int(deck_id))

    if not changed_rows:
        return 0

    conn.execute("BEGIN TRANSACTION")
    try:
        for deck_id in changed_rows:
            conn.execute(
                "UPDATE decks SET name = ?, tags = ? WHERE id = ?",
                [target_name, target_tags, deck_id],
            )
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return len(changed_rows)


def sync_materialized_shared_deck_metadata_for_all_kids(shared_deck_id, shared_deck_name, shared_storage_tags):
    """Propagate one shared deck's renamed metadata to every kid DB."""
    updated_kid_ids = []
    updated_deck_count = 0
    failures = []
    for kid in metadata.get_all_kids():
        conn = None
        try:
            conn = kid_db.get_kid_connection_by_path(kid.get('dbFilePath'), read_only=False)
            changed_count = sync_materialized_shared_deck_metadata_for_kid(
                conn,
                shared_deck_id,
                shared_deck_name,
                shared_storage_tags,
            )
            if changed_count > 0:
                updated_kid_ids.append(str(kid.get('id') or ''))
                updated_deck_count += changed_count
        except Exception as e:
            failures.append({
                'kid_id': str(kid.get('id') or ''),
                'kid_name': str(kid.get('name') or ''),
                'error': str(e),
            })
        finally:
            if conn is not None:
                conn.close()
    return {
        'updated_kid_ids': updated_kid_ids,
        'updated_kid_count': len(updated_kid_ids),
        'updated_deck_count': int(updated_deck_count),
        'failures': failures,
    }
