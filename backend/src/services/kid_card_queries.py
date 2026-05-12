"""Kid-local card distinct-value readers + shared-deck dedupe-key resolver.

Pure helpers that:
  - Read distinct card fronts / backs across one or more kid-local deck ids.
  - Resolve a dedupe key for one shared deck from its category behavior.

DB helpers take an open `conn`. No module state.
"""
from src.routes.kids_constants import DECK_CATEGORY_BEHAVIOR_TYPE_II
from src.services.shared_deck_queries import get_shared_deck_behavior_type_from_raw_tags


def get_shared_deck_dedupe_key(conn, raw_tags):
    """Resolve dedupe key for one shared deck from its category behavior."""
    behavior_type = get_shared_deck_behavior_type_from_raw_tags(conn, raw_tags)
    if behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_II:
        return 'back'
    return 'front'


def get_kid_card_fronts_for_deck_ids(conn, deck_ids):
    """Return distinct card fronts across selected kid-local deck ids."""
    normalized = []
    for raw_id in list(deck_ids or []):
        try:
            deck_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if deck_id <= 0 or deck_id in normalized:
            continue
        normalized.append(deck_id)
    if not normalized:
        return set()
    placeholders = ','.join(['?'] * len(normalized))
    rows = conn.execute(
        f"SELECT DISTINCT front FROM cards WHERE deck_id IN ({placeholders})",
        normalized
    ).fetchall()
    return {str(row[0] or '') for row in rows if str(row[0] or '')}


def get_kid_card_backs_for_deck_ids(conn, deck_ids):
    """Return distinct card backs across selected kid-local deck ids."""
    normalized = []
    for raw_id in list(deck_ids or []):
        try:
            deck_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if deck_id <= 0 or deck_id in normalized:
            continue
        normalized.append(deck_id)
    if not normalized:
        return set()
    placeholders = ','.join(['?'] * len(normalized))
    rows = conn.execute(
        f"SELECT DISTINCT back FROM cards WHERE deck_id IN ({placeholders})",
        normalized
    ).fetchall()
    return {str(row[0] or '') for row in rows if str(row[0] or '')}
