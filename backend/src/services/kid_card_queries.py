"""Kid-local card distinct-value readers + shared-deck dedupe-key resolver.

Pure helpers that:
  - Read distinct card fronts / backs across one or more kid-local deck ids.
  - Resolve a dedupe key for one shared deck from its category behavior.

DB helpers take an open `conn`. No module state.
"""
from src.routes.kids_constants import DECK_CATEGORY_BEHAVIOR_TYPE_II
from src.services.normalize_inputs import normalize_positive_int_list
from src.services.shared_deck_queries import get_shared_deck_behavior_type_from_raw_tags


def get_shared_deck_dedupe_key(conn, raw_tags):
    """Resolve dedupe key for one shared deck from its category behavior."""
    behavior_type = get_shared_deck_behavior_type_from_raw_tags(conn, raw_tags)
    if behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_II:
        return 'back'
    return 'front'


def _get_kid_card_distinct_column_for_deck_ids(conn, deck_ids, column):
    deck_id_list = normalize_positive_int_list(deck_ids)
    if not deck_id_list:
        return set()
    placeholders = ','.join(['?'] * len(deck_id_list))
    rows = conn.execute(
        f"SELECT DISTINCT {column} FROM cards WHERE deck_id IN ({placeholders})",
        deck_id_list,
    ).fetchall()
    return {str(row[0] or '') for row in rows if str(row[0] or '')}


def get_kid_card_fronts_for_deck_ids(conn, deck_ids):
    """Return distinct card fronts across selected kid-local deck ids."""
    return _get_kid_card_distinct_column_for_deck_ids(conn, deck_ids, 'front')


def get_kid_card_backs_for_deck_ids(conn, deck_ids):
    """Return distinct card backs across selected kid-local deck ids."""
    return _get_kid_card_distinct_column_for_deck_ids(conn, deck_ids, 'back')
