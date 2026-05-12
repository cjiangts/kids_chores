"""Read-only shared-deck DB queries.

Pure helpers that:
  - List allowed shared-deck first tags from the deck_category table.
  - List shared decks by first-tag and per-behavior shortcuts.
  - List type-IV decks with representative front/back labels.
  - Find a representative-label conflict for a type-IV deck.
  - List kid-local materialized shared decks (per-kid SQLite) by first tag.
  - Look up one shared deck owned by a specific family.
  - Resolve a shared deck's behavior type / Chinese-type-I flag from its tags.
  - Read the immutable card rows of one shared deck.

DB helpers take a `conn` for the shared-decks DB (or a per-kid `conn` for the
materialized-deck readers). No module state.

Layout:
  1. Allowed first tags + shared-deck row queries (first-tag, type-II/IV)
  2. Type-IV representative-label conflict + per-kid materialized decks
  3. Single-deck lookups + behavior-type resolution + card rows
"""
from src.routes.kids_constants import (
    DECK_CATEGORY_BEHAVIOR_TYPE_I,
    MATERIALIZED_SHARED_DECK_NAME_PREFIX,
)
from src.services.shared_deck_category import get_shared_deck_categories
from src.services.shared_deck_materialize import parse_shared_deck_id_from_materialized_name
from src.services.shared_deck_normalize import (
    extract_shared_deck_tags_and_labels,
    normalize_shared_deck_category_behavior,
    normalize_shared_deck_tag,
    normalize_type_iv_display_label,
)


# =====================================================================
# === 1. Allowed first tags + shared-deck row queries (first-tag, type-II/IV)
# =====================================================================

def get_allowed_shared_deck_first_tags(conn):
    """Return allowed first tags from deck categories."""
    categories = get_shared_deck_categories(conn)
    return {
        normalize_shared_deck_tag(item.get('category_key'))
        for item in categories
        if normalize_shared_deck_tag(item.get('category_key'))
    }


def get_shared_deck_rows_by_first_tag(conn, first_tag):
    """Return shared decks with card counts filtered by required first tag."""
    required_tag = str(first_tag or '').strip()
    if not required_tag:
        return []
    rows = conn.execute(
        """
        SELECT
            d.deck_id,
            d.name,
            d.tags,
            d.creator_family_id,
            d.created_at,
            COUNT(c.id) AS card_count
        FROM deck d
        LEFT JOIN cards c ON c.deck_id = d.deck_id
        GROUP BY d.deck_id, d.name, d.tags, d.creator_family_id, d.created_at
        ORDER BY d.created_at DESC, d.deck_id DESC
        """
    ).fetchall()
    decks = []
    for row in rows:
        tags, tag_labels = extract_shared_deck_tags_and_labels(row[2])
        if required_tag not in tags:
            continue
        decks.append({
            'deck_id': int(row[0]),
            'name': str(row[1]),
            'tags': tags,
            'tag_labels': tag_labels,
            'creator_family_id': int(row[3]),
            'created_at': row[4].isoformat() if row[4] else None,
            'card_count': int(row[5] or 0),
        })
    return decks


def get_shared_type_ii_deck_rows(conn, category_key):
    """Return all shared decks tagged by one type-II category key with card counts."""
    first_tag = normalize_shared_deck_tag(category_key)
    if not first_tag:
        return []
    return get_shared_deck_rows_by_first_tag(conn, first_tag)


def get_shared_type_iv_deck_rows(conn, category_key):
    """Return type-IV shared decks with their representative-card label."""
    first_tag = normalize_shared_deck_tag(category_key)
    if not first_tag:
        return []

    decks = get_shared_deck_rows_by_first_tag(conn, first_tag)
    deck_ids = [int(deck['deck_id']) for deck in decks]
    if not deck_ids:
        return decks

    placeholders = ','.join(['?'] * len(deck_ids))
    card_rows = conn.execute(
        f"""
        SELECT deck_id, front, back
        FROM cards
        WHERE deck_id IN ({placeholders})
        ORDER BY deck_id ASC, id ASC
        """,
        deck_ids
    ).fetchall()
    representative_by_deck_id = {}
    for row in card_rows:
        deck_id = int(row[0])
        if deck_id in representative_by_deck_id:
            continue
        representative_by_deck_id[deck_id] = {
            'representative_front': str(row[1] or ''),
            'representative_back': str(row[2] or ''),
        }

    for deck in decks:
        representative = representative_by_deck_id.get(int(deck['deck_id'])) or {}
        deck['representative_front'] = str(representative.get('representative_front') or '')
        deck['representative_back'] = str(representative.get('representative_back') or '')
    return decks


# =====================================================================
# === 2. Type-IV representative-label conflict + per-kid materialized decks
# =====================================================================

def find_shared_type_iv_representative_label_conflict(
    conn,
    category_key,
    representative_label,
    *,
    exclude_deck_id=None,
):
    """Find an existing type-IV deck in one category by representative label."""
    category = normalize_shared_deck_tag(category_key)
    label = normalize_type_iv_display_label(representative_label)
    excluded = None
    if exclude_deck_id is not None:
        try:
            excluded = int(exclude_deck_id)
        except (TypeError, ValueError):
            excluded = None

    for deck in get_shared_type_iv_deck_rows(conn, category):
        deck_id = int(deck.get('deck_id') or 0)
        if excluded is not None and deck_id == excluded:
            continue
        if str(deck.get('representative_front') or '').strip() != label:
            continue
        return {
            'deck_id': deck_id,
            'deck_name': str(deck.get('name') or '').strip(),
            'representative_label': label,
            'tags': list(deck.get('tags') or []),
            'tag_labels': list(deck.get('tag_labels') or []),
        }
    return None


def get_kid_materialized_shared_decks_by_first_tag(conn, first_tag):
    """Return kid-local materialized shared decks keyed by local deck id."""
    required_tag = str(first_tag or '').strip()
    if not required_tag:
        return {}
    rows = conn.execute(
        "SELECT id, name, tags FROM decks WHERE name LIKE ? ORDER BY id ASC",
        [f"{MATERIALIZED_SHARED_DECK_NAME_PREFIX}%"]
    ).fetchall()
    decks = {}
    for row in rows:
        local_deck_id = int(row[0])
        local_name = str(row[1] or '')
        shared_deck_id = parse_shared_deck_id_from_materialized_name(local_name)
        if shared_deck_id is None:
            continue
        tags, tag_labels = extract_shared_deck_tags_and_labels(row[2])
        if required_tag not in tags:
            continue
        decks[local_deck_id] = {
            'local_deck_id': local_deck_id,
            'local_name': local_name,
            'shared_deck_id': shared_deck_id,
            'tags': tags,
            'tag_labels': tag_labels,
        }
    return decks


def get_kid_materialized_shared_type_ii_decks(conn, category_key):
    """Return kid-local materialized shared type-II decks keyed by local deck id."""
    first_tag = normalize_shared_deck_tag(category_key)
    if not first_tag:
        return {}
    return get_kid_materialized_shared_decks_by_first_tag(conn, first_tag)


# =====================================================================
# === 3. Single-deck lookups + behavior-type resolution + card rows
# =====================================================================

def get_shared_deck_owned_by_family(conn, deck_id, family_id_int):
    """Fetch one shared deck row if it belongs to the given family."""
    return conn.execute(
        """
        SELECT deck_id, name, tags, creator_family_id, created_at
        FROM deck
        WHERE deck_id = ? AND creator_family_id = ?
        """,
        [deck_id, family_id_int]
    ).fetchone()


def get_shared_deck_behavior_type_from_raw_tags(conn, raw_tags):
    """Resolve behavior type for one shared deck row from its first tag."""
    tags = extract_shared_deck_tags_and_labels(raw_tags)[0]
    first_tag = normalize_shared_deck_tag(tags[0]) if tags else ''
    if not first_tag:
        return ''
    row = conn.execute(
        "SELECT behavior_type FROM deck_category WHERE category_key = ? LIMIT 1",
        [first_tag],
    ).fetchone()
    return normalize_shared_deck_category_behavior(row[0] if row else '')


def is_shared_deck_chinese_type_i(conn, raw_tags):
    """Check if a shared deck is a Chinese type-I deck (auto-generates backs)."""
    tags = extract_shared_deck_tags_and_labels(raw_tags)[0]
    first_tag = normalize_shared_deck_tag(tags[0]) if tags else ''
    if not first_tag:
        return False
    row = conn.execute(
        "SELECT behavior_type, has_chinese_specific_logic FROM deck_category WHERE category_key = ? LIMIT 1",
        [first_tag],
    ).fetchone()
    if not row:
        return False
    behavior = normalize_shared_deck_category_behavior(row[0])
    return behavior == DECK_CATEGORY_BEHAVIOR_TYPE_I and bool(row[1])


def get_shared_deck_cards(conn, deck_id):
    """Return immutable cards for one deck as id/front/back rows."""
    rows = conn.execute(
        """
        SELECT id, front, back
        FROM cards
        WHERE deck_id = ?
        ORDER BY id ASC
        """,
        [deck_id]
    ).fetchall()
    return [{
        'id': int(row[0]),
        'front': str(row[1]),
        'back': str(row[2]),
    } for row in rows]
