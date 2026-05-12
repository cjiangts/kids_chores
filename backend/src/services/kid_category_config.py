"""Kid category-config hydration helpers.

Pure helpers extracted from `src.routes.kids` Phase 2 refactor.

These helpers still depend on a couple of stateful kids.py helpers
(`get_or_create_orphan_deck`, `get_orphan_deck`) that hold module-level
state and live in kids.py. Those calls are resolved lazily inside each
function body to avoid circular imports.
"""
from src.db import kid_db
from src.routes.kids_constants import (
    DEFAULT_DRILL_SPEED_CUTOFF_MS,
    DEFAULT_INCLUDE_ORPHAN_IN_QUEUE,
    DRILL_SPEED_CUTOFF_MS_BY_CATEGORY_FIELD,
    INCLUDE_ORPHAN_BY_CATEGORY_FIELD,
    KID_DECK_CATEGORY_OPT_IN_COL_DRILL_SPEED_CUTOFF_MS,
    KID_DECK_CATEGORY_OPT_IN_COL_INCLUDE_ORPHAN,
    KID_DECK_CATEGORY_OPT_IN_COL_IS_OPTED_IN,
    KID_DECK_CATEGORY_OPT_IN_COL_SESSION_CARD_COUNT,
    KID_DECK_CATEGORY_OPT_IN_TABLE,
    SESSION_CARD_COUNT_BY_CATEGORY_FIELD,
)
from src.services.shared_deck_category import get_shared_deck_category_meta_by_key
from src.services.shared_deck_normalize import normalize_shared_deck_tag


def hydrate_kid_category_config_from_db(
    kid,
    *,
    category_meta_by_key=None,
    force_reload=False,
    conn=None,
):
    """Populate kid payload with per-category config maps sourced from kid DB."""
    if not force_reload:
        existing_session = kid.get(SESSION_CARD_COUNT_BY_CATEGORY_FIELD)
        existing_orphan = kid.get(INCLUDE_ORPHAN_BY_CATEGORY_FIELD)
        existing_drill = kid.get(DRILL_SPEED_CUTOFF_MS_BY_CATEGORY_FIELD)
        existing_opted = kid.get('optedInDeckCategoryKeys')
        if (
            isinstance(existing_session, dict)
            and isinstance(existing_orphan, dict)
            and isinstance(existing_drill, dict)
            and isinstance(existing_opted, list)
        ):
            return kid

    if isinstance(category_meta_by_key, dict):
        metadata_map = category_meta_by_key
    else:
        metadata_map = get_shared_deck_category_meta_by_key()
    category_keys = sorted(
        {
            normalize_shared_deck_tag(raw_key)
            for raw_key in metadata_map.keys()
            if normalize_shared_deck_tag(raw_key)
        }
    )
    session_by_category = {key: 0 for key in category_keys}
    include_orphan_by_category = {key: DEFAULT_INCLUDE_ORPHAN_IN_QUEUE for key in category_keys}
    drill_speed_by_category = {key: DEFAULT_DRILL_SPEED_CUTOFF_MS for key in category_keys}
    opted_in_set = set()

    local_conn = conn
    owns_conn = False
    if local_conn is None:
        local_conn = kid_db.get_kid_connection_by_path(kid.get('dbFilePath'), read_only=True)
        owns_conn = True
    try:
        rows = local_conn.execute(
            f"""
            SELECT
              category_key,
              COALESCE({KID_DECK_CATEGORY_OPT_IN_COL_IS_OPTED_IN}, FALSE) AS is_opted_in,
              COALESCE({KID_DECK_CATEGORY_OPT_IN_COL_SESSION_CARD_COUNT}, 0) AS session_card_count,
              COALESCE({KID_DECK_CATEGORY_OPT_IN_COL_INCLUDE_ORPHAN}, TRUE) AS include_orphan,
              {KID_DECK_CATEGORY_OPT_IN_COL_DRILL_SPEED_CUTOFF_MS} AS drill_speed_cutoff_ms
            FROM {KID_DECK_CATEGORY_OPT_IN_TABLE}
            """
        ).fetchall()
    finally:
        if owns_conn and local_conn is not None:
            local_conn.close()

    for row in rows:
        key = normalize_shared_deck_tag(row[0])
        if not key:
            continue
        session_by_category[key] = max(
            0,
            int(row[2] or 0),
        )
        include_orphan_by_category[key] = bool(row[3])
        if row[4] is not None:
            try:
                drill_speed_by_category[key] = max(0, int(row[4]))
            except (TypeError, ValueError):
                drill_speed_by_category[key] = DEFAULT_DRILL_SPEED_CUTOFF_MS
        if bool(row[1]):
            opted_in_set.add(key)

    opted_in_keys = [
        key for key in category_keys
        if key in opted_in_set
    ]
    for key in sorted(opted_in_set):
        if key not in category_keys:
            opted_in_keys.append(key)

    kid[SESSION_CARD_COUNT_BY_CATEGORY_FIELD] = session_by_category
    kid[INCLUDE_ORPHAN_BY_CATEGORY_FIELD] = include_orphan_by_category
    kid[DRILL_SPEED_CUTOFF_MS_BY_CATEGORY_FIELD] = drill_speed_by_category
    kid['optedInDeckCategoryKeys'] = opted_in_keys
    return kid


def get_category_session_card_count_for_kid(kid, category_key):
    """Return one category's configured cards-per-session value."""
    key = normalize_shared_deck_tag(category_key)
    if not key:
        return 0
    raw_map = kid.get(SESSION_CARD_COUNT_BY_CATEGORY_FIELD)
    if not isinstance(raw_map, dict):
        hydrate_kid_category_config_from_db(kid)
        raw_map = kid.get(SESSION_CARD_COUNT_BY_CATEGORY_FIELD)
    if not isinstance(raw_map, dict):
        return 0
    raw_value = raw_map.get(key, 0)
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        return 0
    return max(0, parsed)


def with_preview_session_count_for_category(kid, category_key, session_count):
    """Return kid-like payload overriding one category session count for planning."""
    key = normalize_shared_deck_tag(category_key)
    if not key:
        return {**kid}

    try:
        parsed = int(session_count)
    except (TypeError, ValueError):
        parsed = 0
    parsed = max(0, parsed)

    existing = kid.get(SESSION_CARD_COUNT_BY_CATEGORY_FIELD)
    merged = {}
    if isinstance(existing, dict):
        for raw_key, raw_value in existing.items():
            normalized = normalize_shared_deck_tag(raw_key)
            if normalized:
                merged[normalized] = raw_value
    merged[key] = parsed
    return {
        **kid,
        SESSION_CARD_COUNT_BY_CATEGORY_FIELD: merged,
    }


def get_category_include_orphan_for_kid(kid, category_key):
    """Return one category's include-orphan-in-queue setting."""
    key = normalize_shared_deck_tag(category_key)
    if not key:
        return DEFAULT_INCLUDE_ORPHAN_IN_QUEUE
    raw_map = kid.get(INCLUDE_ORPHAN_BY_CATEGORY_FIELD)
    if not isinstance(raw_map, dict):
        hydrate_kid_category_config_from_db(kid)
        raw_map = kid.get(INCLUDE_ORPHAN_BY_CATEGORY_FIELD)
    if not isinstance(raw_map, dict):
        return DEFAULT_INCLUDE_ORPHAN_IN_QUEUE
    value = raw_map.get(key)
    if isinstance(value, bool):
        return value
    return DEFAULT_INCLUDE_ORPHAN_IN_QUEUE


def get_category_orphan_deck_name(category_key):
    """Return orphan deck name for one category key."""
    key = normalize_shared_deck_tag(category_key)
    if not key:
        raise ValueError('categoryKey is required')
    return f'{key}_orphan'


def get_or_create_category_orphan_deck(conn, category_key):
    """Get/create orphan deck id for one category key."""
    key = normalize_shared_deck_tag(category_key)
    if not key:
        raise ValueError('categoryKey is required')
    # Lazy import: get_or_create_orphan_deck is also reused by other
    # routes in kids.py and stays there.
    from src.routes.kids import get_or_create_orphan_deck
    return get_or_create_orphan_deck(
        conn,
        get_category_orphan_deck_name(key),
        key,
    )


def get_category_drill_speed_cutoff_ms_for_kid(conn, category_key):
    """Return parent-set drill speed cutoff (ms) for a category, or default."""
    key = normalize_shared_deck_tag(category_key)
    if not key:
        return DEFAULT_DRILL_SPEED_CUTOFF_MS
    row = conn.execute(
        f"""
        SELECT {KID_DECK_CATEGORY_OPT_IN_COL_DRILL_SPEED_CUTOFF_MS}
        FROM {KID_DECK_CATEGORY_OPT_IN_TABLE}
        WHERE category_key = ?
        """,
        [key],
    ).fetchone()
    if not row or row[0] is None:
        return DEFAULT_DRILL_SPEED_CUTOFF_MS
    try:
        return int(row[0])
    except (TypeError, ValueError):
        return DEFAULT_DRILL_SPEED_CUTOFF_MS


def get_category_orphan_deck(conn, category_key):
    """Look up orphan deck id for one category key (read-only, no auto-create)."""
    key = normalize_shared_deck_tag(category_key)
    if not key:
        raise ValueError('categoryKey is required')
    from src.routes.kids import get_orphan_deck
    return get_orphan_deck(conn, get_category_orphan_deck_name(key))
