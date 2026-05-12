"""Shared-card skip toggles (single + bulk).

Pure helpers that toggle `skip_practice` on cards belonging to a
materialized shared deck or the per-category orphan deck. Validate
that each target card actually lives in a shared/orphan deck for the
given category before updating. Open and close their own kid-DB
connection — no module state.
"""
from src.services.family_auth import get_kid_connection_for
from src.services.shared_deck_materialize import parse_shared_deck_id_from_materialized_name
from src.services.shared_deck_normalize import extract_shared_deck_tags_and_labels


def update_shared_card_skip_internal(kid, card_id_int, skipped, *, category_key, orphan_deck_name, deck_label):
    """Toggle skip status for one shared/materialized/orphan card for one category."""
    conn = get_kid_connection_for(kid)
    try:
        card_row = conn.execute(
            """
            SELECT c.id, c.deck_id, d.name, d.tags
            FROM cards c
            JOIN decks d ON d.id = c.deck_id
            WHERE c.id = ?
            LIMIT 1
            """,
            [card_id_int]
        ).fetchone()
        if not card_row:
            return {'error': 'Card not found'}, 404

        local_deck_name = str(card_row[2] or '')
        local_deck_tags = extract_shared_deck_tags_and_labels(card_row[3])[0]
        is_materialized_shared = parse_shared_deck_id_from_materialized_name(local_deck_name) is not None
        is_orphan = local_deck_name == str(orphan_deck_name or '')
        if is_materialized_shared and str(category_key or '') not in local_deck_tags:
            return {'error': f'Card does not belong to a shared {deck_label} deck'}, 400
        if not is_materialized_shared and not is_orphan:
            return {'error': f'Card does not belong to a shared {deck_label} or orphan deck'}, 400

        conn.execute(
            "UPDATE cards SET skip_practice = ? WHERE id = ?",
            [bool(skipped), card_id_int]
        )
    finally:
        conn.close()

    return {
        'id': card_id_int,
        'skip_practice': bool(skipped),
    }, 200


def update_shared_cards_skip_bulk_internal(kid, card_ids, skipped, *, category_key, orphan_deck_name, deck_label):
    """Toggle skip status for many shared/materialized/orphan cards for one category."""
    unique_card_ids = []
    seen = set()
    for raw_id in card_ids or []:
        card_id_int = int(raw_id)
        if card_id_int in seen:
            continue
        seen.add(card_id_int)
        unique_card_ids.append(card_id_int)
    if not unique_card_ids:
        return {'error': 'No card ids provided'}, 400

    conn = get_kid_connection_for(kid)
    try:
        placeholders = ','.join(['?'] * len(unique_card_ids))
        card_rows = conn.execute(
            f"""
            SELECT c.id, c.deck_id, d.name, d.tags
            FROM cards c
            JOIN decks d ON d.id = c.deck_id
            WHERE c.id IN ({placeholders})
            """,
            unique_card_ids
        ).fetchall()
        row_by_id = {int(row[0]): row for row in card_rows}
        missing_ids = [card_id for card_id in unique_card_ids if card_id not in row_by_id]
        if missing_ids:
            return {'error': f'Card not found: {missing_ids[0]}'}, 404

        for card_id in unique_card_ids:
            row = row_by_id[card_id]
            local_deck_name = str(row[2] or '')
            local_deck_tags = extract_shared_deck_tags_and_labels(row[3])[0]
            is_materialized_shared = parse_shared_deck_id_from_materialized_name(local_deck_name) is not None
            is_orphan = local_deck_name == str(orphan_deck_name or '')
            if is_materialized_shared and str(category_key or '') not in local_deck_tags:
                return {'error': f'Card does not belong to a shared {deck_label} deck'}, 400
            if not is_materialized_shared and not is_orphan:
                return {'error': f'Card does not belong to a shared {deck_label} or orphan deck'}, 400

        conn.execute(
            f"UPDATE cards SET skip_practice = ? WHERE id IN ({placeholders})",
            [bool(skipped), *unique_card_ids]
        )
    finally:
        conn.close()

    return {
        'updated_count': len(unique_card_ids),
        'skip_practice': bool(skipped),
    }, 200
