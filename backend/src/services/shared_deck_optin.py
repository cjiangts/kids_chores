"""Opt-in / opt-out workflow for materializing shared decks into a kid's per-kid DB.

Helpers that:
  - Materialize selected shared decks into a kid DB as per-kid "shared_deck_*"
    decks, copying source cards and moving any matching orphan rows into the
    new local deck.
  - Remove materialized shared decks for a kid: cards that have never been
    practiced are hard-deleted; cards with session_results are moved back to
    the category's orphan deck so history stays intact.
  - Cover type-I (Chinese-aware front-dedupe), type-IV (single representative
    card per deck), and the shared type-II/type-III internal variants that take
    a parameterized unique-key field + materialized-decks reader.

Callers in route modules acquire `_SHARED_DECK_MUTATION_LOCK` before invoking
these helpers. DB connections are opened and closed inside each helper. No
module state.

Layout (search for `# === N. ` banner markers to jump between sections):

    1. Shared-deck fetch — fetch_shared_decks_by_ids
    2. Type-I opt-in (+ opt-out wrapper that delegates to internal)
    3. Type-IV opt-in (+ opt-out wrapper that delegates to internal)
    4. Generic shared-deck materialize — opt_in_shared_decks_internal used by
       type-II / type-III routes (parametrized over deck-key field + reader)
    5. Generic shared-deck cleanup — opt_out_shared_decks_internal (used by
       all four types) + delete_shared_deck_related_rows (cascade through
       session_results, lesson-reading audio, type-II chinese print sheets)
"""
from src.db.shared_deck_db import get_shared_decks_connection
from src.routes.kids_constants import DEFAULT_TYPE_IV_DAILY_TARGET_COUNT
from src.services.family_auth import get_kid_connection_for
from src.services.kid_card_queries import (
    get_kid_card_backs_for_deck_ids,
    get_kid_card_fronts_for_deck_ids,
)
from src.services.kid_category_config import (
    get_category_orphan_deck_name,
    get_or_create_category_orphan_deck,
    get_or_create_orphan_deck,
)
from src.services.shared_deck_materialize import (
    build_materialized_shared_deck_name,
    build_materialized_shared_deck_tags,
)
from src.services.shared_deck_normalize import extract_shared_deck_tags_and_labels
from src.services.shared_deck_queries import (
    get_kid_materialized_shared_decks_by_first_tag,
    get_shared_type_iv_deck_rows,
)
from src.services.writing_candidates import remove_cards_from_type2_chinese_print_sheets


# ============================================================================
# 1. Shared-deck fetch
# ============================================================================

def fetch_shared_decks_by_ids(shared_conn, deck_ids):
    """Load shared deck metadata by ids and report missing ids."""
    normalized_ids = [int(deck_id) for deck_id in list(deck_ids or [])]
    if len(normalized_ids) == 0:
        return {}, []
    placeholders = ','.join(['?'] * len(normalized_ids))
    deck_rows = shared_conn.execute(
        f"""
        SELECT deck_id, name, tags
        FROM deck
        WHERE deck_id IN ({placeholders})
        """,
        normalized_ids
    ).fetchall()
    shared_by_id = {
        int(row[0]): {
            'deck_id': int(row[0]),
            'name': str(row[1]),
            'tags': extract_shared_deck_tags_and_labels(row[2])[0],
        }
        for row in deck_rows
    }
    missing_ids = [deck_id for deck_id in normalized_ids if deck_id not in shared_by_id]
    return shared_by_id, missing_ids


# ============================================================================
# 2. Type-I opt-in / opt-out — Chinese-aware front-dedupe per category
# ============================================================================

def opt_in_type_i_shared_decks(kid, category_key, deck_ids, has_chinese_specific_logic):
    """Materialize selected shared decks for one type-I category."""
    shared_conn = None
    kid_conn = None
    try:
        shared_conn = get_shared_decks_connection(read_only=True)
        shared_by_id, missing_ids = fetch_shared_decks_by_ids(shared_conn, deck_ids)
        if missing_ids:
            return {
                'error': f'Shared deck(s) not found: {", ".join(str(v) for v in missing_ids)}'
            }, 404

        placeholders = ','.join(['?'] * len(deck_ids))
        invalid_tag_ids = [
            deck_id for deck_id in deck_ids
            if category_key not in shared_by_id[deck_id]['tags']
        ]
        if invalid_tag_ids:
            return {
                'error': (
                    f'Deck(s) are not {category_key}-tagged: '
                    f'{", ".join(str(v) for v in invalid_tag_ids)}'
                )
            }, 400

        card_rows = shared_conn.execute(
            f"""
            SELECT deck_id, front, back
            FROM cards
            WHERE deck_id IN ({placeholders})
            ORDER BY deck_id ASC, id ASC
            """,
            deck_ids
        ).fetchall()
        cards_by_deck_id = {}
        for row in card_rows:
            src_deck_id = int(row[0])
            cards_by_deck_id.setdefault(src_deck_id, []).append({
                'front': str(row[1]),
                'back': str(row[2]),
            })

        kid_conn = get_kid_connection_for(kid)
        existing_materialized = get_kid_materialized_shared_decks_by_first_tag(
            kid_conn,
            category_key,
        )
        occupied_fronts = get_kid_card_fronts_for_deck_ids(
            kid_conn,
            list(existing_materialized.keys())
        )
        created = []
        already_opted_in = []
        for src_deck_id in deck_ids:
            src_deck = shared_by_id[src_deck_id]
            materialized_name = build_materialized_shared_deck_name(src_deck_id, src_deck['name'])
            existing = kid_conn.execute(
                "SELECT id FROM decks WHERE name = ? LIMIT 1",
                [materialized_name]
            ).fetchone()
            if existing:
                already_opted_in.append({
                    'shared_deck_id': src_deck_id,
                    'shared_name': src_deck['name'],
                    'materialized_name': materialized_name,
                    'deck_id': int(existing[0]),
                })
                continue

            materialized_tags = build_materialized_shared_deck_tags(src_deck['tags'])
            inserted = kid_conn.execute(
                """
                INSERT INTO decks (name, tags)
                VALUES (?, ?)
                RETURNING id
                """,
                [materialized_name, materialized_tags]
            ).fetchone()
            local_deck_id = int(inserted[0])

            cards = cards_by_deck_id.get(src_deck_id, [])
            cards_added = 0
            cards_moved_from_orphan = 0
            cards_skipped_existing_front = 0
            if cards:
                orphan_deck_id = get_or_create_category_orphan_deck(kid_conn, category_key)
                source_fronts = []
                seen_fronts = set()
                for card in cards:
                    front = str(card.get('front') or '')
                    if front in seen_fronts:
                        continue
                    seen_fronts.add(front)
                    source_fronts.append(front)

                orphan_by_front = {}
                if source_fronts:
                    front_placeholders = ','.join(['?'] * len(source_fronts))
                    orphan_rows = kid_conn.execute(
                        f"""
                        SELECT id, front, back, skip_practice, hardness_score, created_at
                        FROM cards
                        WHERE deck_id = ?
                          AND front IN ({front_placeholders})
                        ORDER BY id ASC
                        """,
                        [orphan_deck_id, *source_fronts]
                    ).fetchall()
                    for row in orphan_rows:
                        row_front = str(row[1] or '')
                        if row_front in orphan_by_front:
                            continue
                        orphan_by_front[row_front] = row

                moved_rows = []
                insert_rows = []
                for card in cards:
                    front = str(card.get('front') or '')
                    if not front:
                        continue
                    if front in occupied_fronts:
                        cards_skipped_existing_front += 1
                        continue
                    orphan_row = orphan_by_front.pop(front, None)
                    if orphan_row is not None:
                        if has_chinese_specific_logic:
                            moved_rows.append((orphan_row, str(card.get('back') or '')))
                        else:
                            moved_rows.append(orphan_row)
                        occupied_fronts.add(front)
                        continue
                    insert_rows.append([local_deck_id, front, str(card.get('back') or '')])
                    occupied_fronts.add(front)

                if moved_rows:
                    moved_ids = [
                        int(row[0][0]) if has_chinese_specific_logic else int(row[0])
                        for row in moved_rows
                    ]
                    moved_placeholders = ','.join(['?'] * len(moved_ids))
                    # DuckDB can fail UPDATE on indexed columns; replace row with same id to "move" decks.
                    kid_conn.execute(
                        f"DELETE FROM cards WHERE id IN ({moved_placeholders})",
                        moved_ids
                    )
                    if has_chinese_specific_logic:
                        kid_conn.executemany(
                            """
                            INSERT INTO cards (id, deck_id, front, back, skip_practice, hardness_score, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                            """,
                            [
                                [
                                    int(orphan_row[0]),
                                    local_deck_id,
                                    str(orphan_row[1] or ''),
                                    shared_back,
                                    bool(orphan_row[3]),
                                    float(orphan_row[4] or 0.0),
                                    orphan_row[5],
                                ]
                                for orphan_row, shared_back in moved_rows
                            ]
                        )
                    else:
                        kid_conn.executemany(
                            """
                            INSERT INTO cards (id, deck_id, front, back, skip_practice, hardness_score, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                            """,
                            [
                                [
                                    int(row[0]),
                                    local_deck_id,
                                    str(row[1] or ''),
                                    str(row[2] or ''),
                                    bool(row[3]),
                                    float(row[4] or 0.0),
                                    row[5],
                                ]
                                for row in moved_rows
                            ]
                        )
                    cards_moved_from_orphan = len(moved_rows)

                if insert_rows:
                    kid_conn.executemany(
                        "INSERT INTO cards (deck_id, front, back) VALUES (?, ?, ?)",
                        insert_rows
                    )
                    cards_added = len(insert_rows)

            created.append({
                'shared_deck_id': src_deck_id,
                'shared_name': src_deck['name'],
                'materialized_name': materialized_name,
                'deck_id': local_deck_id,
                'cards_added': cards_added,
                'cards_moved_from_orphan': cards_moved_from_orphan,
                'cards_skipped_existing_front': cards_skipped_existing_front,
                'cards_total': len(cards),
            })
    finally:
        if kid_conn is not None:
            kid_conn.close()
        if shared_conn is not None:
            shared_conn.close()

    return {
        'requested_count': len(deck_ids),
        'created_count': len(created),
        'already_opted_in_count': len(already_opted_in),
        'created': created,
        'already_opted_in': already_opted_in,
    }, 200


def opt_out_type_i_shared_decks(kid, category_key, deck_ids):
    """Remove selected opted-in shared decks for one type-I category."""
    return opt_out_shared_decks_internal(
        kid,
        deck_ids,
        first_tag=category_key,
        orphan_deck_name=get_category_orphan_deck_name(category_key),
        get_materialized_decks_fn=lambda conn: get_kid_materialized_shared_decks_by_first_tag(
            conn,
            category_key,
        ),
        delete_type3_audio=True,
    )


# ============================================================================
# 3. Type-IV opt-in / opt-out — single representative card per deck
# ============================================================================

def opt_in_type_iv_shared_decks(kid, category_key, deck_ids):
    """Materialize selected shared decks for one type-IV category."""
    shared_conn = None
    kid_conn = None
    try:
        shared_conn = get_shared_decks_connection(read_only=True)
        shared_by_id = {
            int(deck['deck_id']): deck
            for deck in get_shared_type_iv_deck_rows(shared_conn, category_key)
        }
        missing_ids = [deck_id for deck_id in deck_ids if deck_id not in shared_by_id]
        if missing_ids:
            return {
                'error': f'Shared deck(s) not found: {", ".join(str(v) for v in missing_ids)}'
            }, 404

        representative_rows = shared_conn.execute(
            f"""
            SELECT deck_id, front, back
            FROM cards
            WHERE deck_id IN ({','.join(['?'] * len(deck_ids))})
            ORDER BY deck_id ASC, id ASC
            """,
            deck_ids
        ).fetchall()
        representative_by_deck_id = {}
        for row in representative_rows:
            deck_id = int(row[0])
            if deck_id in representative_by_deck_id:
                continue
            representative_by_deck_id[deck_id] = {
                'front': str(row[1] or ''),
                'back': str(row[2] or ''),
            }

        invalid_definition_ids = []
        for deck_id in deck_ids:
            representative = representative_by_deck_id.get(deck_id)
            if not representative or not str(representative.get('front') or '').strip():
                invalid_definition_ids.append(deck_id)
        if invalid_definition_ids:
            return {
                'error': (
                    'Type-IV deck(s) are missing their representative card: '
                    f'{", ".join(str(v) for v in invalid_definition_ids)}'
                )
            }, 400

        kid_conn = get_kid_connection_for(kid)
        orphan_deck_id = None
        orphan_deck_row = kid_conn.execute(
            "SELECT id FROM decks WHERE name = ? LIMIT 1",
            [get_category_orphan_deck_name(category_key)]
        ).fetchone()
        if orphan_deck_row:
            orphan_deck_id = int(orphan_deck_row[0])
        representative_fronts = []
        seen_fronts = set()
        for deck_id in deck_ids:
            representative = representative_by_deck_id.get(deck_id) or {}
            front = str(representative.get('front') or '')
            if not front or front in seen_fronts:
                continue
            seen_fronts.add(front)
            representative_fronts.append(front)

        orphan_by_front = {}
        if orphan_deck_id is not None and representative_fronts:
            front_placeholders = ','.join(['?'] * len(representative_fronts))
            orphan_rows = kid_conn.execute(
                f"""
                SELECT id, front, back, skip_practice, hardness_score, created_at
                FROM cards
                WHERE deck_id = ?
                  AND front IN ({front_placeholders})
                ORDER BY id ASC
                """,
                [orphan_deck_id, *representative_fronts]
            ).fetchall()
            for row in orphan_rows:
                row_front = str(row[1] or '')
                if row_front in orphan_by_front:
                    continue
                orphan_by_front[row_front] = row

        created = []
        already_opted_in = []
        for src_deck_id in deck_ids:
            src_deck = shared_by_id[src_deck_id]
            materialized_name = build_materialized_shared_deck_name(src_deck_id, src_deck['name'])
            existing = kid_conn.execute(
                "SELECT id FROM decks WHERE name = ? LIMIT 1",
                [materialized_name]
            ).fetchone()
            if existing:
                already_opted_in.append({
                    'shared_deck_id': src_deck_id,
                    'shared_name': src_deck['name'],
                    'materialized_name': materialized_name,
                    'deck_id': int(existing[0]),
                })
                continue

            materialized_tags = build_materialized_shared_deck_tags(src_deck['tags'])
            inserted = kid_conn.execute(
                """
                INSERT INTO decks (name, tags, daily_target_count)
                VALUES (?, ?, ?)
                RETURNING id
                """,
                [
                    materialized_name,
                    materialized_tags,
                    DEFAULT_TYPE_IV_DAILY_TARGET_COUNT,
                ]
            ).fetchone()
            local_deck_id = int(inserted[0])

            representative = representative_by_deck_id[src_deck_id]
            representative_front = str(representative.get('front') or '')
            representative_back = str(representative.get('back') or '')
            orphan_row = orphan_by_front.pop(representative_front, None)
            cards_moved_from_orphan = 0
            if orphan_row is not None:
                moved_card_id = int(orphan_row[0])
                kid_conn.execute("DELETE FROM cards WHERE id = ?", [moved_card_id])
                kid_conn.execute(
                    """
                    INSERT INTO cards (id, deck_id, front, back, skip_practice, hardness_score, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        moved_card_id,
                        local_deck_id,
                        representative_front,
                        representative_back,
                        bool(orphan_row[3]),
                        float(orphan_row[4] or 0.0),
                        orphan_row[5],
                    ]
                )
                cards_moved_from_orphan = 1
            else:
                kid_conn.execute(
                    "INSERT INTO cards (deck_id, front, back) VALUES (?, ?, ?)",
                    [
                        local_deck_id,
                        representative_front,
                        representative_back,
                    ]
                )
            created.append({
                'shared_deck_id': src_deck_id,
                'shared_name': src_deck['name'],
                'materialized_name': materialized_name,
                'deck_id': local_deck_id,
                'cards_added': 1,
                'cards_moved_from_orphan': cards_moved_from_orphan,
                'cards_total': 1,
            })
    finally:
        if kid_conn is not None:
            kid_conn.close()
        if shared_conn is not None:
            shared_conn.close()

    return {
        'requested_count': len(deck_ids),
        'created_count': len(created),
        'already_opted_in_count': len(already_opted_in),
        'created': created,
        'already_opted_in': already_opted_in,
    }, 200


def opt_out_type_iv_shared_decks(kid, category_key, deck_ids):
    """Remove selected opted-in shared decks for one type-IV category."""
    return opt_out_shared_decks_internal(
        kid,
        deck_ids,
        first_tag=category_key,
        orphan_deck_name=get_category_orphan_deck_name(category_key),
        get_materialized_decks_fn=lambda conn: get_kid_materialized_shared_decks_by_first_tag(
            conn,
            category_key,
        ),
        delete_type3_audio=False,
    )


# ============================================================================
# 4. Generic shared-deck materialize — type-II / type-III via parametrized reader
# ============================================================================

def opt_in_shared_decks_internal(
    kid,
    deck_ids,
    *,
    first_tag,
    orphan_deck_name,
    get_materialized_decks_fn,
    unique_key_field,
):
    """Materialize shared decks into kid DB for type-II/type-III categories."""
    shared_conn = None
    kid_conn = None
    try:
        shared_conn = get_shared_decks_connection(read_only=True)
        shared_by_id, missing_ids = fetch_shared_decks_by_ids(shared_conn, deck_ids)
        if missing_ids:
            return {
                'error': f'Shared deck(s) not found: {", ".join(str(v) for v in missing_ids)}'
            }, 404

        placeholders = ','.join(['?'] * len(deck_ids))
        invalid_tag_ids = [
            deck_id for deck_id in deck_ids
            if first_tag not in shared_by_id[deck_id]['tags']
        ]
        if invalid_tag_ids:
            return {
                'error': f'Deck(s) are not {first_tag}-tagged: {", ".join(str(v) for v in invalid_tag_ids)}'
            }, 400

        card_rows = shared_conn.execute(
            f"""
            SELECT deck_id, front, back
            FROM cards
            WHERE deck_id IN ({placeholders})
            ORDER BY deck_id ASC, id ASC
            """,
            deck_ids
        ).fetchall()
        cards_by_deck_id = {}
        for row in card_rows:
            src_deck_id = int(row[0])
            cards_by_deck_id.setdefault(src_deck_id, []).append({
                'front': str(row[1]),
                'back': str(row[2]),
            })

        kid_conn = get_kid_connection_for(kid)
        existing_materialized = get_materialized_decks_fn(kid_conn)
        occupied_deck_ids = list(existing_materialized.keys())
        occupied_values = (
            get_kid_card_fronts_for_deck_ids(kid_conn, occupied_deck_ids)
            if unique_key_field == 'front'
            else get_kid_card_backs_for_deck_ids(kid_conn, occupied_deck_ids)
        )
        orphan_deck_id = get_or_create_orphan_deck(
            kid_conn,
            orphan_deck_name,
            first_tag,
        )

        created = []
        already_opted_in = []
        skipped_existing_key = f'cards_skipped_existing_{unique_key_field}'
        for src_deck_id in deck_ids:
            src_deck = shared_by_id[src_deck_id]
            materialized_name = build_materialized_shared_deck_name(src_deck_id, src_deck['name'])
            existing = kid_conn.execute(
                "SELECT id FROM decks WHERE name = ? LIMIT 1",
                [materialized_name]
            ).fetchone()
            if existing:
                already_opted_in.append({
                    'shared_deck_id': src_deck_id,
                    'shared_name': src_deck['name'],
                    'materialized_name': materialized_name,
                    'deck_id': int(existing[0]),
                })
                continue

            materialized_tags = build_materialized_shared_deck_tags(src_deck['tags'])
            inserted = kid_conn.execute(
                """
                INSERT INTO decks (name, tags)
                VALUES (?, ?)
                RETURNING id
                """,
                [materialized_name, materialized_tags]
            ).fetchone()
            local_deck_id = int(inserted[0])

            cards = cards_by_deck_id.get(src_deck_id, [])
            cards_added = 0
            cards_moved_from_orphan = 0
            cards_skipped_existing = 0
            if cards:
                source_keys = []
                seen_keys = set()
                source_front_by_back = {}
                for card in cards:
                    front = str(card.get('front') or '')
                    back = str(card.get('back') or '')
                    key_value = front if unique_key_field == 'front' else back
                    if not key_value or key_value in seen_keys:
                        continue
                    seen_keys.add(key_value)
                    source_keys.append(key_value)
                    if unique_key_field == 'back':
                        source_front_by_back[key_value] = front

                orphan_by_key = {}
                if source_keys:
                    key_placeholders = ','.join(['?'] * len(source_keys))
                    orphan_rows = kid_conn.execute(
                        f"""
                        SELECT id, front, back, skip_practice, hardness_score, created_at
                        FROM cards
                        WHERE deck_id = ?
                          AND {unique_key_field} IN ({key_placeholders})
                        ORDER BY id ASC
                        """,
                        [orphan_deck_id, *source_keys]
                    ).fetchall()
                    for row in orphan_rows:
                        row_key = str(row[1] or '') if unique_key_field == 'front' else str(row[2] or '')
                        if row_key in orphan_by_key:
                            continue
                        orphan_by_key[row_key] = row

                moved_rows = []
                insert_rows = []
                for card in cards:
                    front = str(card.get('front') or '')
                    back = str(card.get('back') or '')
                    key_value = front if unique_key_field == 'front' else back
                    if not key_value:
                        continue
                    if key_value in occupied_values:
                        cards_skipped_existing += 1
                        continue

                    orphan_row = orphan_by_key.pop(key_value, None)
                    if orphan_row is not None:
                        if unique_key_field == 'back':
                            orphan_front = str(orphan_row[1] or '')
                            orphan_back = str(orphan_row[2] or '')
                            source_front = str(source_front_by_back.get(key_value) or '')
                            resolved_front = orphan_front if orphan_front != orphan_back else (source_front or orphan_back)
                            moved_rows.append(
                                (
                                    int(orphan_row[0]),
                                    resolved_front,
                                    orphan_back,
                                    bool(orphan_row[3]),
                                    float(orphan_row[4] or 0.0),
                                    orphan_row[5],
                                )
                            )
                        else:
                            moved_rows.append(orphan_row)
                        occupied_values.add(key_value)
                        continue

                    insert_rows.append([local_deck_id, front, back])
                    occupied_values.add(key_value)

                if moved_rows:
                    moved_ids = [int(row[0]) for row in moved_rows]
                    moved_placeholders = ','.join(['?'] * len(moved_ids))
                    kid_conn.execute(
                        f"DELETE FROM cards WHERE id IN ({moved_placeholders})",
                        moved_ids
                    )
                    kid_conn.executemany(
                        """
                        INSERT INTO cards (id, deck_id, front, back, skip_practice, hardness_score, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        [
                            [
                                int(row[0]),
                                local_deck_id,
                                str(row[1] or ''),
                                str(row[2] or ''),
                                bool(row[3]),
                                float(row[4] or 0.0),
                                row[5],
                            ]
                            for row in moved_rows
                        ]
                    )
                    cards_moved_from_orphan = len(moved_rows)

                if insert_rows:
                    kid_conn.executemany(
                        "INSERT INTO cards (deck_id, front, back) VALUES (?, ?, ?)",
                        insert_rows
                    )
                    cards_added = len(insert_rows)

            created_item = {
                'shared_deck_id': src_deck_id,
                'shared_name': src_deck['name'],
                'materialized_name': materialized_name,
                'deck_id': local_deck_id,
                'cards_added': cards_added,
                'cards_moved_from_orphan': cards_moved_from_orphan,
                'cards_total': len(cards),
            }
            created_item[skipped_existing_key] = cards_skipped_existing
            created.append(created_item)
    finally:
        if kid_conn is not None:
            kid_conn.close()
        if shared_conn is not None:
            shared_conn.close()

    return {
        'requested_count': len(deck_ids),
        'created_count': len(created),
        'already_opted_in_count': len(already_opted_in),
        'created': created,
        'already_opted_in': already_opted_in,
    }, 200


# ============================================================================
# 5. Generic shared-deck cleanup — opt-out + cascade related rows
# ============================================================================

def delete_shared_deck_related_rows(conn, card_ids, *, delete_type3_audio):
    """Delete rows related to selected card ids when opt-out removes cards."""
    if not card_ids:
        return
    placeholders = ','.join(['?'] * len(card_ids))
    remove_cards_from_type2_chinese_print_sheets(conn, card_ids)
    if delete_type3_audio:
        conn.execute(
            f"""
            DELETE FROM lesson_reading_audio
            WHERE result_id IN (
                SELECT id FROM session_results WHERE card_id IN ({placeholders})
            )
            """,
            card_ids
        )
    conn.execute(
        f"DELETE FROM session_results WHERE card_id IN ({placeholders})",
        card_ids
    )


def opt_out_shared_decks_internal(
    kid,
    deck_ids,
    *,
    first_tag,
    orphan_deck_name,
    get_materialized_decks_fn,
    delete_type3_audio,
):
    """Opt out shared decks for type-II/type-III categories."""
    kid_conn = None
    try:
        kid_conn = get_kid_connection_for(kid)
        materialized_by_local_id = get_materialized_decks_fn(kid_conn)
        local_by_shared_id = {
            int(entry['shared_deck_id']): {
                'local_deck_id': int(entry['local_deck_id']),
                'local_name': str(entry['local_name'] or ''),
            }
            for entry in materialized_by_local_id.values()
        }

        removed = []
        already_opted_out = []
        for shared_deck_id in deck_ids:
            local_entry = local_by_shared_id.get(shared_deck_id)
            if not local_entry:
                already_opted_out.append({'shared_deck_id': int(shared_deck_id)})
                continue

            local_deck_id = int(local_entry['local_deck_id'])
            local_name = str(local_entry['local_name'])
            card_rows = kid_conn.execute(
                "SELECT id FROM cards WHERE deck_id = ?",
                [local_deck_id]
            ).fetchall()
            card_ids = [int(row[0]) for row in card_rows]
            card_count = len(card_ids)

            practiced_card_ids = []
            if card_ids:
                placeholders = ','.join(['?'] * len(card_ids))
                practiced_rows = kid_conn.execute(
                    f"SELECT DISTINCT card_id FROM session_results WHERE card_id IN ({placeholders})",
                    card_ids
                ).fetchall()
                practiced_card_ids = [int(row[0]) for row in practiced_rows]
            had_practice_sessions = len(practiced_card_ids) > 0

            if had_practice_sessions:
                orphan_deck_id = get_or_create_orphan_deck(
                    kid_conn,
                    orphan_deck_name,
                    first_tag,
                )
                practiced_placeholders = ','.join(['?'] * len(practiced_card_ids))
                practiced_cards = kid_conn.execute(
                    f"""
                    SELECT id, front, back, skip_practice, hardness_score, created_at
                    FROM cards
                    WHERE id IN ({practiced_placeholders})
                    """,
                    practiced_card_ids
                ).fetchall()
                if practiced_cards:
                    kid_conn.execute(
                        f"DELETE FROM cards WHERE id IN ({practiced_placeholders})",
                        practiced_card_ids
                    )
                    kid_conn.executemany(
                        """
                        INSERT INTO cards (id, deck_id, front, back, skip_practice, hardness_score, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        [
                            [
                                int(row[0]),
                                orphan_deck_id,
                                row[1],
                                row[2],
                                bool(row[3]),
                                float(row[4] or 0.0),
                                row[5],
                            ]
                            for row in practiced_cards
                        ]
                    )

                practiced_card_id_set = set(practiced_card_ids)
                unpracticed_ids = [card_id for card_id in card_ids if card_id not in practiced_card_id_set]
                if unpracticed_ids:
                    delete_shared_deck_related_rows(
                        kid_conn,
                        unpracticed_ids,
                        delete_type3_audio=delete_type3_audio,
                    )
                    unpracticed_placeholders = ','.join(['?'] * len(unpracticed_ids))
                    kid_conn.execute(
                        f"DELETE FROM cards WHERE id IN ({unpracticed_placeholders})",
                        unpracticed_ids
                    )
            else:
                delete_shared_deck_related_rows(
                    kid_conn,
                    card_ids,
                    delete_type3_audio=delete_type3_audio,
                )
                kid_conn.execute("DELETE FROM cards WHERE deck_id = ?", [local_deck_id])

            kid_conn.execute("DELETE FROM decks WHERE id = ?", [local_deck_id])
            removed.append({
                'shared_deck_id': int(shared_deck_id),
                'deck_id': local_deck_id,
                'materialized_name': local_name,
                'had_practice_sessions': had_practice_sessions,
                'cards_removed': card_count - len(practiced_card_ids),
                'cards_detached': len(practiced_card_ids),
            })
    finally:
        if kid_conn is not None:
            kid_conn.close()

    return {
        'requested_count': len(deck_ids),
        'removed_count': len(removed),
        'already_opted_out_count': len(already_opted_out),
        'removed': removed,
        'already_opted_out': already_opted_out,
    }, 200
