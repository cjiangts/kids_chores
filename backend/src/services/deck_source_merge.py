"""Source-deck merging helpers for kid decks (shared + orphan).

Pure helpers extracted from `src.routes.kids` Phase 2 refactor.

The type-I/II/IV merged-source-deck functions need access to the
kid-local materialized-deck readers (`get_kid_materialized_shared_decks_by_first_tag`,
`get_kid_materialized_shared_type_ii_decks`) which still live in
kids.py. Those callables are resolved lazily inside each function body
to avoid circular imports.
"""
from src.services.kid_category_config import (
    get_category_include_orphan_for_kid,
    get_category_orphan_deck,
    get_category_orphan_deck_name,
)
from src.services.shared_deck_normalize import (
    extract_shared_deck_tags_and_labels,
    normalize_shared_deck_tag,
)


def _build_shared_source_deck_entry(entry, total_cards, active_cards):
    """Build one non-orphan merged-source payload."""
    skipped_cards = max(0, total_cards - active_cards)
    tags, _ = extract_shared_deck_tags_and_labels(entry.get('tags') or [])
    return {
        'local_deck_id': int(entry['local_deck_id']),
        'shared_deck_id': int(entry['shared_deck_id']),
        'local_name': str(entry.get('local_name') or ''),
        'tags': tags,
        'is_orphan': False,
        'card_count': int(total_cards),
        'active_card_count': int(active_cards),
        'skipped_card_count': int(skipped_cards),
        'included_in_bank': True,
        'included_in_queue': True,
    }


def _build_orphan_source_deck_entry(orphan_row, orphan_deck_name, orphan_total, orphan_active, include_orphan_in_queue):
    """Build one orphan merged-source payload."""
    orphan_skipped = max(0, orphan_total - orphan_active)
    orphan_tags, _ = extract_shared_deck_tags_and_labels(orphan_row[2])
    return {
        'local_deck_id': int(orphan_row[0]),
        'shared_deck_id': None,
        'local_name': str(orphan_row[1] or orphan_deck_name),
        'tags': orphan_tags,
        'is_orphan': True,
        'card_count': int(orphan_total),
        'active_card_count': int(orphan_active),
        'skipped_card_count': int(orphan_skipped),
        'included_in_bank': bool(include_orphan_in_queue),
        'included_in_queue': bool(include_orphan_in_queue and orphan_active > 0),
    }


def get_card_count_summary_by_deck_ids(conn, deck_ids):
    """Return total / active / skipped counts keyed by deck id."""
    normalized_ids = []
    seen = set()
    for raw_id in list(deck_ids or []):
        try:
            deck_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if deck_id <= 0 or deck_id in seen:
            continue
        seen.add(deck_id)
        normalized_ids.append(deck_id)
    if not normalized_ids:
        return {}

    placeholders = ','.join(['?'] * len(normalized_ids))
    rows = conn.execute(
        f"""
        SELECT
            d.id AS deck_id,
            COUNT(c.id) AS card_count,
            COALESCE(SUM(CASE WHEN COALESCE(c.skip_practice, FALSE) = FALSE THEN 1 ELSE 0 END), 0) AS active_card_count,
            COALESCE(SUM(CASE WHEN COALESCE(c.skip_practice, FALSE) = TRUE THEN 1 ELSE 0 END), 0) AS skipped_card_count
        FROM decks d
        LEFT JOIN cards c ON c.deck_id = d.id
        WHERE d.id IN ({placeholders})
        GROUP BY d.id
        """,
        normalized_ids,
    ).fetchall()
    return {
        int(row[0]): {
            'card_count': int(row[1] or 0),
            'active_card_count': int(row[2] or 0),
            'skipped_card_count': int(row[3] or 0),
        }
        for row in rows
        if row and int(row[0] or 0) > 0
    }


def get_shared_merged_source_decks_for_kid(
    conn,
    kid,
    category_key,
    *,
    get_materialized_func,
    include_orphan_in_queue_override=None,
):
    """Return merged source decks (normal + orphan) for one category."""
    first_tag = normalize_shared_deck_tag(category_key)
    if not first_tag:
        return []
    materialized_by_local_id = get_materialized_func(conn, first_tag)
    include_orphan_in_queue = (
        bool(include_orphan_in_queue_override)
        if include_orphan_in_queue_override is not None
        else get_category_include_orphan_for_kid(kid, first_tag)
    )

    deck_ids_to_summarize = [int(deck_id) for deck_id in materialized_by_local_id.keys()]
    orphan_deck_name = get_category_orphan_deck_name(first_tag)
    orphan_deck_id = get_category_orphan_deck(conn, first_tag)
    if orphan_deck_id > 0:
        deck_ids_to_summarize.append(int(orphan_deck_id))
    counts_by_deck_id = get_card_count_summary_by_deck_ids(conn, deck_ids_to_summarize)

    sources = []
    for local_deck_id in sorted(materialized_by_local_id.keys()):
        entry = materialized_by_local_id[local_deck_id]
        local_id = int(entry['local_deck_id'])
        counts = counts_by_deck_id.get(local_id) or {}
        total_cards = int(counts.get('card_count') or 0)
        active_cards = int(counts.get('active_card_count') or 0)
        sources.append(_build_shared_source_deck_entry(entry, total_cards, active_cards))

    orphan_row = conn.execute(
        "SELECT id, name, tags FROM decks WHERE id = ? LIMIT 1",
        [orphan_deck_id]
    ).fetchone()
    if orphan_row:
        orphan_counts = counts_by_deck_id.get(int(orphan_deck_id)) or {}
        orphan_total = int(orphan_counts.get('card_count') or 0)
        orphan_active = int(orphan_counts.get('active_card_count') or 0)
        sources.append(_build_orphan_source_deck_entry(
            orphan_row,
            orphan_deck_name,
            orphan_total,
            orphan_active,
            include_orphan_in_queue,
        ))

    return sources


def get_shared_type_i_merged_source_decks_for_kid(
    conn,
    kid,
    category_key,
    *,
    include_orphan_in_queue_override=None,
):
    """Return type-I source decks for merged bank and merged practice queue."""
    # Lazy import: get_kid_materialized_shared_decks_by_first_tag still
    # lives in kids.py (not in the Phase-2 extract list).
    from src.routes.kids import get_kid_materialized_shared_decks_by_first_tag
    return get_shared_merged_source_decks_for_kid(
        conn,
        kid,
        category_key,
        get_materialized_func=get_kid_materialized_shared_decks_by_first_tag,
        include_orphan_in_queue_override=include_orphan_in_queue_override,
    )


def get_shared_type_ii_merged_source_decks_for_kid(conn, kid, category_key):
    """Return type-II source decks for merged bank and merged practice queue."""
    from src.routes.kids import get_kid_materialized_shared_type_ii_decks
    return get_shared_merged_source_decks_for_kid(
        conn,
        kid,
        category_key,
        get_materialized_func=get_kid_materialized_shared_type_ii_decks,
    )


def get_shared_type_iv_merged_source_decks_for_kid(
    conn,
    kid,
    category_key,
    *,
    include_orphan_in_queue_override=None,
):
    """Return type-IV source decks for merged bank and merged practice queue."""
    from src.routes.kids import get_kid_materialized_shared_decks_by_first_tag
    return get_shared_merged_source_decks_for_kid(
        conn,
        kid,
        category_key,
        get_materialized_func=get_kid_materialized_shared_decks_by_first_tag,
        include_orphan_in_queue_override=include_orphan_in_queue_override,
    )


def get_type_iv_bank_source_rows(
    conn,
    kid,
    category_key,
    *,
    include_orphan_in_queue_override=None,
):
    """Return type-IV bank sources currently included in the bank view."""
    sources = []
    for source in list(get_shared_type_iv_merged_source_decks_for_kid(
        conn,
        kid,
        category_key,
        include_orphan_in_queue_override=include_orphan_in_queue_override,
    )):
        if bool(source.get('is_orphan')):
            if int(source.get('card_count') or 0) <= 0 or not bool(source.get('included_in_bank')):
                continue
            source = dict(source)
            source['included_in_queue'] = bool(
                source.get('included_in_queue')
                and int(source.get('active_card_count') or 0) > 0
            )
        sources.append(source)
    return sources


def get_type_iv_total_daily_target_for_category(
    conn,
    kid,
    category_key,
    *,
    include_orphan_in_queue_override=None,
):
    """Return the sum of per-deck daily targets for one generator category."""
    first_tag = normalize_shared_deck_tag(category_key)
    if not first_tag:
        return 0
    from src.routes.kids import get_kid_materialized_shared_decks_by_first_tag
    materialized_by_local_id = get_kid_materialized_shared_decks_by_first_tag(conn, first_tag)
    local_deck_ids = [int(deck_id) for deck_id in materialized_by_local_id.keys()]
    total_count = 0
    if local_deck_ids:
        placeholders = ','.join(['?'] * len(local_deck_ids))
        total = conn.execute(
            f"""
            SELECT COALESCE(SUM(COALESCE(daily_target_count, 0)), 0)
            FROM decks
            WHERE id IN ({placeholders})
            """,
            local_deck_ids
        ).fetchone()
        total_count += int((total[0] if total else 0) or 0)

    include_orphan_in_queue = (
        bool(include_orphan_in_queue_override)
        if include_orphan_in_queue_override is not None
        else get_category_include_orphan_for_kid(kid, first_tag)
    )
    if not include_orphan_in_queue:
        return total_count

    orphan_row = conn.execute(
        "SELECT COALESCE(daily_target_count, 0) FROM decks WHERE name = ? LIMIT 1",
        [get_category_orphan_deck_name(first_tag)],
    ).fetchone()
    return total_count + int((orphan_row[0] if orphan_row else 0) or 0)
