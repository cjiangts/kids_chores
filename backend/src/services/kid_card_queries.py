"""Kid-local card distinct-value reader.

DB helper takes an open `conn`. No module state.
"""
from src.services.normalize_inputs import normalize_positive_int_list


def get_kid_card_fronts_for_deck_ids(conn, deck_ids):
    """Return distinct card fronts across selected kid-local deck ids."""
    deck_id_list = normalize_positive_int_list(deck_ids)
    if not deck_id_list:
        return set()
    placeholders = ','.join(['?'] * len(deck_id_list))
    rows = conn.execute(
        f"SELECT DISTINCT front FROM cards WHERE deck_id IN ({placeholders})",
        deck_id_list,
    ).fetchall()
    return {str(row[0] or '') for row in rows if str(row[0] or '')}
