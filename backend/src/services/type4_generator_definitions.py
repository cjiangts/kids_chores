"""Type-IV generator definition DB readers + detail-map builders.

Pure helpers that:
  - Probe optional columns on shared_decks `deck_generator_definition`.
  - Parse one raw definition row into API shape.
  - Read one or many generator definitions by shared deck id.
  - Build per-deck and per-representative-front generator detail maps.

DB helpers take an open `conn` (shared-decks DB). No module state.
"""
from src.db.shared_deck_db import get_shared_decks_connection
from src.services.shared_deck_queries import get_shared_type_iv_deck_rows
from src.services.type4_print_layout import build_shared_deck_print_cell_design


def shared_deck_generator_definition_has_column(conn, column_name):
    """Return whether shared generator definitions include one named column."""
    row = conn.execute(
        """
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'main'
          AND table_name = 'deck_generator_definition'
          AND column_name = ?
        LIMIT 1
        """,
        [str(column_name or '').strip()],
    ).fetchone()
    return bool(row)


def shared_deck_generator_definition_has_multichoice_only_column(conn):
    """Return whether shared generator definitions already include the multichoice-only flag."""
    return shared_deck_generator_definition_has_column(conn, 'is_multichoice_only')


def shared_deck_generator_definition_has_print_cell_design_columns(conn):
    """Return whether shared generator definitions include persisted print cell design columns."""
    return shared_deck_generator_definition_has_column(conn, 'print_cell_design_json')


def parse_shared_deck_generator_definition_row(
    row,
    *,
    has_multichoice,
    has_cell_design,
    includes_deck_id=False,
):
    """Convert one raw deck_generator_definition row into API shape."""
    if row is None:
        return None
    idx = 1 if includes_deck_id else 0
    code = str(row[idx] or '')
    idx += 1
    if has_multichoice:
        is_multichoice_only = bool(row[idx]) if row[idx] is not None else False
        idx += 1
    else:
        is_multichoice_only = False
    created_at = row[idx]
    idx += 1

    result = {
        'code': code,
        'is_multichoice_only': bool(is_multichoice_only),
        'created_at': created_at.isoformat() if created_at else None,
    }
    if has_cell_design:
        result['cell_design'] = build_shared_deck_print_cell_design(
            row[idx],
        )
    else:
        result['cell_design'] = None
    return result


def get_shared_deck_generator_definition(conn, deck_id):
    """Return immutable generator definition for one shared type-IV deck."""
    has_multichoice = shared_deck_generator_definition_has_multichoice_only_column(conn)
    has_cell_design = shared_deck_generator_definition_has_print_cell_design_columns(conn)
    select_cols = ['code']
    if has_multichoice:
        select_cols.append('is_multichoice_only')
    select_cols.append('created_at')
    if has_cell_design:
        select_cols.append('print_cell_design_json')
    row = conn.execute(
        f"""
        SELECT {', '.join(select_cols)}
        FROM deck_generator_definition
        WHERE deck_id = ?
        LIMIT 1
        """,
        [deck_id],
    ).fetchone()
    return parse_shared_deck_generator_definition_row(
        row,
        has_multichoice=has_multichoice,
        has_cell_design=has_cell_design,
    )


def get_shared_deck_generator_definitions_by_deck_ids(conn, deck_ids):
    """Return immutable generator definitions by shared type-IV deck id."""
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

    has_multichoice = shared_deck_generator_definition_has_multichoice_only_column(conn)
    has_cell_design = shared_deck_generator_definition_has_print_cell_design_columns(conn)
    placeholders = ','.join(['?'] * len(normalized_ids))
    select_cols = ['deck_id', 'code']
    if has_multichoice:
        select_cols.append('is_multichoice_only')
    select_cols.append('created_at')
    if has_cell_design:
        select_cols.append('print_cell_design_json')
    rows = conn.execute(
        f"""
        SELECT {', '.join(select_cols)}
        FROM deck_generator_definition
        WHERE deck_id IN ({placeholders})
        """,
        normalized_ids,
    ).fetchall()
    definitions = {}
    for row in rows:
        deck_id = int(row[0] or 0) if row else 0
        if deck_id <= 0:
            continue
        definitions[deck_id] = parse_shared_deck_generator_definition_row(
            row,
            has_multichoice=has_multichoice,
            has_cell_design=has_cell_design,
            includes_deck_id=True,
        )
    return definitions


def build_type_iv_generator_detail_maps(category_key, deck_ids=None, *, shared_conn=None, include_code=True):
    """Return generator details keyed by shared deck id and representative front."""
    should_close = shared_conn is None
    if should_close:
        shared_conn = get_shared_decks_connection(read_only=True)
    try:
        decks = get_shared_type_iv_deck_rows(shared_conn, category_key)
        lookup_ids = {int(deck.get('deck_id') or 0) for deck in decks if int(deck.get('deck_id') or 0) > 0}
        for raw_id in list(deck_ids or []):
            try:
                deck_id = int(raw_id)
            except (TypeError, ValueError):
                continue
            if deck_id > 0:
                lookup_ids.add(deck_id)
        definitions_by_id = get_shared_deck_generator_definitions_by_deck_ids(shared_conn, sorted(lookup_ids))
    finally:
        if should_close and shared_conn is not None:
            shared_conn.close()

    details_by_id = {}
    for deck_id, definition in definitions_by_id.items():
        code = str(definition.get('code') or '') if include_code else ''
        details_by_id[int(deck_id)] = {
            'code': code,
            'is_multichoice_only': bool(definition.get('is_multichoice_only')),
        }

    details_by_front = {}
    for deck in decks:
        representative_front = str(deck.get('representative_front') or '').strip()
        if not representative_front or representative_front in details_by_front:
            continue
        shared_deck_id = int(deck.get('deck_id') or 0)
        definition = definitions_by_id.get(shared_deck_id) or {}
        code = str(definition.get('code') or '') if include_code else ''
        if shared_deck_id <= 0:
            continue
        if include_code and not code:
            continue
        details_by_front[representative_front] = {
            'shared_deck_id': shared_deck_id,
            'code': code,
            'is_multichoice_only': bool(definition.get('is_multichoice_only')),
        }
    return details_by_id, details_by_front


def build_type_iv_card_generator_details_by_shared_id(deck_ids, *, category_key=None, shared_conn=None):
    """Return generator code keyed by shared type-IV deck id."""
    details_by_id, _ = build_type_iv_generator_detail_maps(
        category_key,
        deck_ids=deck_ids,
        shared_conn=shared_conn,
        include_code=True,
    )
    return details_by_id


def build_type_iv_generator_details_by_representative_front(category_key, *, deck_ids=None, shared_conn=None):
    """Return generator details keyed by representative front label."""
    _, details_by_front = build_type_iv_generator_detail_maps(
        category_key,
        deck_ids=deck_ids,
        shared_conn=shared_conn,
        include_code=True,
    )
    return details_by_front
