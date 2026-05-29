"""Chinese-bank (super-family) routes.

Two parallel banks, selected by ?mode= on every route:
  mode='pinyin'  -> chinese_character_bank(character, pinyin, ...)   single Han chars
  mode='english' -> chinese_vocabulary_bank(word, en, ...)           multi-char vocab

Each mode is scoped to its own bank table AND to source decks whose category
has chinese_back_content matching the mode.

Layout:
  1. Per-mode config + request/payload mode resolvers + Han-only matcher
  2. GET bank listing (paginated + search + filters)
  3. Write routes: PUT update + refresh-used + force-sync-backs
"""
from pathlib import Path

from src.db import kid_db
from src.routes.kids import (
    get_shared_decks_connection,
    jsonify,
    kids_bp,
    request,
)
from src.services.chinese_text import build_chinese_pinyin_text
from src.services.family_auth import (
    current_family_id,
    is_super_family_id,
    require_super_family,
)


# =====================================================================
# === 1. Per-mode config + request/payload mode resolvers + Han-only matcher
# =====================================================================

# Per-mode config: target table + columns. Bank routing is driven entirely
# by the deck's category (chinese_back_content), never by character length.
_MODES = {
    'pinyin': {
        'table': 'chinese_character_bank',
        'pk': 'character',
        'payload': 'pinyin',
    },
    'english': {
        'table': 'chinese_vocabulary_bank',
        'pk': 'word',
        'payload': 'en',
    },
}


def _get_mode():
    raw = str(request.args.get('mode') or '').strip().lower()
    if raw not in _MODES:
        return None, (jsonify({'error': "mode must be 'pinyin' or 'english'"}), 400)
    return _MODES[raw], None


def _mode_from_payload(payload):
    raw = str((payload or {}).get('mode') or '').strip().lower()
    if raw not in _MODES:
        return None, (jsonify({'error': "mode must be 'pinyin' or 'english'"}), 400)
    return _MODES[raw], None


def _han_only(value: str) -> bool:
    import re
    return bool(re.fullmatch(r'[\u3400-\u9FFF\uF900-\uFAFF]+', value or ''))


def _mode_category_keys(back_content_value):
    """Category keys whose decks belong to the given chinese_back_content mode."""
    conn = get_shared_decks_connection(read_only=True)
    try:
        return [
            str(r[0]).strip().lower()
            for r in conn.execute(
                "SELECT category_key FROM deck_category "
                "WHERE has_chinese_specific_logic = TRUE "
                "AND chinese_back_content = ?",
                [back_content_value],
            ).fetchall()
        ]
    finally:
        conn.close()


def _aggregate_thumb_down_by_front(back_content_value):
    """Sum cards.thumb_down_count across all kid DBs, scoped to mode-decks."""
    totals = {}
    category_keys = _mode_category_keys(back_content_value)
    if not category_keys:
        return totals
    families_root = Path(kid_db.DATA_DIR) / 'families'
    if not families_root.exists():
        return totals
    cat_ph = ', '.join(['?'] * len(category_keys))
    for db_path in sorted(families_root.glob('family_*/kid_*.db')):
        conn = None
        try:
            conn = kid_db.duckdb.connect(str(db_path), read_only=True)
            rows = conn.execute(
                f"""
                SELECT c.front, SUM(c.thumb_down_count)
                FROM cards c
                JOIN decks d ON d.id = c.deck_id
                WHERE c.thumb_down_count > 0
                  AND array_length(d.tags) >= 1
                  AND lower(d.tags[1]) IN ({cat_ph})
                GROUP BY c.front
                """,
                category_keys,
            ).fetchall()
            for front, total in rows:
                totals[front] = totals.get(front, 0) + int(total or 0)
        except Exception:
            pass
        finally:
            if conn is not None:
                conn.close()
    return totals


# =====================================================================
# === 2. GET bank listing (paginated + search + filters)
# =====================================================================

@kids_bp.route('/chinese-bank', methods=['GET'])
def get_chinese_bank():
    """List a single mode's bank with pagination, search, and filters."""
    family_id = current_family_id()
    if not family_id:
        return jsonify({'error': 'Family login required'}), 401
    is_super = is_super_family_id(family_id)

    cfg, err = _get_mode()
    if err:
        return err
    table = cfg['table']
    pk = cfg['pk']
    payload = cfg['payload']

    page = max(1, int(request.args.get('page') or 1))
    per_page = min(200, max(10, int(request.args.get('perPage') or 50)))
    search = str(request.args.get('search') or '').strip()
    filter_verified = str(request.args.get('verified') or '').strip().lower()
    sort_param = str(request.args.get('sort') or '').strip().lower()

    back_content_value = 'pinyin' if payload == 'pinyin' else 'english'
    thumb_down_by_key = _aggregate_thumb_down_by_front(back_content_value)

    conn = get_shared_decks_connection(read_only=True)
    try:
        conditions = []
        params = []

        if search:
            conditions.append(
                f"({pk} ILIKE ? OR {payload} ILIKE ?)"
            )
            like = f'%{search}%'
            params.extend([like, like])

        if filter_verified == 'verified':
            conditions.append("verified = TRUE")
        elif filter_verified == 'unverified':
            conditions.append("verified = FALSE")
            conditions.append("used = TRUE")
        elif filter_verified == 'used':
            conditions.append("used = TRUE")
        elif filter_verified == 'thumbed':
            thumbed_keys = list(thumb_down_by_key.keys())
            if thumbed_keys:
                placeholders = ', '.join(['?'] * len(thumbed_keys))
                conditions.append(f"{pk} IN ({placeholders})")
                params.extend(thumbed_keys)
            else:
                conditions.append("1 = 0")

        where = (' WHERE ' + ' AND '.join(conditions)) if conditions else ''

        total = conn.execute(
            f"SELECT COUNT(*) FROM {table}{where}", params
        ).fetchone()[0]

        offset = (page - 1) * per_page
        if sort_param == 'updated_asc':
            order_by = f'last_updated ASC, {pk} ASC'
        elif sort_param == 'updated_desc':
            order_by = f'last_updated DESC, {pk} ASC'
        else:
            order_by = f'used DESC, {pk} ASC'

        rows = conn.execute(
            f"SELECT {pk}, {payload}, used, verified, last_updated FROM {table}{where} "
            f"ORDER BY {order_by} LIMIT ? OFFSET ?",
            params + [per_page, offset],
        ).fetchall()

        stats = conn.execute(
            f"""
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE used) AS used,
                COUNT(*) FILTER (WHERE verified) AS verified
            FROM {table}
            """
        ).fetchone()

        thumbed_count = 0
        if thumb_down_by_key:
            thumbed_keys = list(thumb_down_by_key.keys())
            placeholders = ', '.join(['?'] * len(thumbed_keys))
            thumbed_count = conn.execute(
                f"SELECT COUNT(*) FROM {table} WHERE {pk} IN ({placeholders})",
                thumbed_keys,
            ).fetchone()[0]

        return jsonify({
            'mode': 'pinyin' if payload == 'pinyin' else 'english',
            'rows': [
                {
                    'key': r[0],
                    'value': r[1],
                    'used': bool(r[2]),
                    'verified': bool(r[3]),
                    'lastUpdated': str(r[4] or ''),
                    'thumbDown': int(thumb_down_by_key.get(r[0], 0)),
                }
                for r in rows
            ],
            'page': page,
            'perPage': per_page,
            'total': total,
            'isSuper': is_super,
            'stats': {
                'total': stats[0],
                'used': stats[1],
                'verified': stats[2],
                'thumbed': thumbed_count,
            },
        })
    finally:
        conn.close()


# =====================================================================
# === 3. Write routes: PUT update + refresh-used + force-sync-backs
# =====================================================================

@kids_bp.route('/chinese-bank', methods=['PUT'])
def update_chinese_bank():
    """Update payload + verified for one or more rows in the chosen bank."""
    auth_err = require_super_family()
    if auth_err:
        return auth_err

    body = request.get_json() or {}
    cfg, err = _mode_from_payload(body)
    if err:
        return err
    table = cfg['table']
    pk = cfg['pk']
    payload_col = cfg['payload']

    updates = body.get('updates')
    if not isinstance(updates, list) or not updates:
        return jsonify({'error': 'updates array is required'}), 400

    back_content_value = 'pinyin' if payload_col == 'pinyin' else 'english'

    conn = get_shared_decks_connection()
    push_bank = {}
    try:
        updated = 0
        for item in updates:
            key = str(item.get('key') or '').strip()
            if not key:
                continue
            value = str(item.get('value') or '').strip()
            verified = bool(item.get('verified'))
            if not value:
                continue
            conn.execute(
                f"UPDATE {table} SET {payload_col} = ?, verified = ?, "
                "last_updated = CURRENT_TIMESTAMP WHERE " + pk + " = ?",
                [value, verified, key],
            )
            updated += 1
            if verified:
                push_bank[key] = value
    finally:
        conn.close()

    pushed = _push_bank_backs(push_bank, back_content_value) if push_bank else {}
    return jsonify({
        'updated': updated,
        'pushed': [
            {'key': key, 'shared': c['shared'], 'kid_dbs': c['kid_dbs']}
            for key, c in pushed.items()
        ],
    })


@kids_bp.route('/chinese-bank/dismiss-thumbs', methods=['POST'])
def dismiss_chinese_bank_thumbs():
    """Clear thumb_down_count for given fronts in mode-decks, across all kid DBs."""
    auth_err = require_super_family()
    if auth_err:
        return auth_err
    body = request.get_json() or {}
    cfg, err = _mode_from_payload(body)
    if err:
        return err
    back_content_value = 'pinyin' if cfg['payload'] == 'pinyin' else 'english'
    keys = [str(k).strip() for k in (body.get('keys') or []) if str(k).strip()]
    category_keys = _mode_category_keys(back_content_value) if keys else []
    families_root = Path(kid_db.DATA_DIR) / 'families'
    if not keys or not category_keys or not families_root.exists():
        return jsonify({'ok': True})

    key_ph = ', '.join(['?'] * len(keys))
    cat_ph = ', '.join(['?'] * len(category_keys))
    sql = (
        f"UPDATE cards SET thumb_down_count = 0 "
        f"WHERE thumb_down_count > 0 AND front IN ({key_ph}) "
        f"AND deck_id IN (SELECT id FROM decks WHERE array_length(tags) >= 1 "
        f"AND lower(tags[1]) IN ({cat_ph}))"
    )
    params = keys + category_keys
    for db_path in sorted(families_root.glob('family_*/kid_*.db')):
        conn = None
        try:
            conn = kid_db.duckdb.connect(str(db_path))
            conn.execute(sql, params)
        except Exception:
            pass
        finally:
            if conn is not None:
                conn.close()
    return jsonify({'ok': True})


@kids_bp.route('/chinese-bank/refresh-used', methods=['POST'])
def refresh_chinese_bank_used():
    """Sweep all shared and kid DBs to update the used column for the chosen mode."""
    auth_err = require_super_family()
    if auth_err:
        return auth_err

    cfg, err = _get_mode()
    if err:
        return err
    table = cfg['table']
    pk = cfg['pk']
    payload_col = cfg['payload']
    back_content_value = 'pinyin' if payload_col == 'pinyin' else 'english'

    conn = get_shared_decks_connection()
    try:
        category_keys = [
            str(row[0])
            for row in conn.execute(
                """
                SELECT category_key FROM deck_category
                WHERE has_chinese_specific_logic = TRUE
                  AND chinese_back_content = ?
                """,
                [back_content_value],
            ).fetchall()
        ]
        used_keys = set()

        if category_keys:
            placeholders = ', '.join(['?'] * len(category_keys))
            shared_rows = conn.execute(
                f"""
                SELECT DISTINCT c.front
                FROM cards c
                JOIN deck d ON d.deck_id = c.deck_id
                WHERE array_length(d.tags) >= 1
                  AND lower(d.tags[1]) IN ({placeholders})
                """,
                category_keys,
            ).fetchall()
            for row in shared_rows:
                front = str(row[0] or '').strip()
                if _han_only(front):
                    used_keys.add(front)

            families_root = Path(kid_db.DATA_DIR) / 'families'
            if families_root.exists():
                for db_path in sorted(families_root.glob('family_*/kid_*.db')):
                    kid_conn = None
                    try:
                        kid_conn = kid_db.duckdb.connect(str(db_path), read_only=True)
                        kid_rows = kid_conn.execute(
                            f"""
                            SELECT DISTINCT c.front
                            FROM cards c
                            JOIN decks d ON d.id = c.deck_id
                            WHERE array_length(d.tags) >= 1
                              AND lower(d.tags[1]) IN ({placeholders})
                            """,
                            category_keys,
                        ).fetchall()
                        for row in kid_rows:
                            front = str(row[0] or '').strip()
                            if _han_only(front):
                                used_keys.add(front)
                    except Exception:
                        pass
                    finally:
                        if kid_conn is not None:
                            kid_conn.close()

        prev_used = {
            r[0]
            for r in conn.execute(
                f"SELECT {pk} FROM {table} WHERE used = TRUE"
            ).fetchall()
        }
        existing_keys = {
            r[0]
            for r in conn.execute(f"SELECT {pk} FROM {table}").fetchall()
        }

        missing_keys = used_keys - existing_keys
        inserted = []
        for key in sorted(missing_keys):
            if payload_col == 'pinyin':
                try:
                    default_value = build_chinese_pinyin_text(key)
                except Exception:
                    default_value = ''
            else:
                default_value = ''
            conn.execute(
                f"INSERT INTO {table} ({pk}, {payload_col}, used, verified, last_updated) "
                "VALUES (?, ?, TRUE, FALSE, CURRENT_TIMESTAMP)",
                [key, default_value],
            )
            inserted.append(key)

        conn.execute(f"UPDATE {table} SET used = FALSE")
        if used_keys:
            placeholders = ', '.join(['?'] * len(used_keys))
            conn.execute(
                f"UPDATE {table} SET used = TRUE, last_updated = CURRENT_TIMESTAMP "
                f"WHERE {pk} IN ({placeholders})",
                list(used_keys),
            )

        newly_used = sorted(used_keys - prev_used - missing_keys)
        newly_unused = sorted(prev_used - used_keys)
        used_count = conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE used = TRUE"
        ).fetchone()[0]

        return jsonify({
            'usedCount': used_count,
            'prevUsedCount': len(prev_used),
            'newlyUsed': newly_used,
            'newlyUnused': newly_unused,
            'insertedKeys': inserted,
        })
    finally:
        conn.close()


def _push_bank_backs(bank, back_content_value):
    """Push bank values to shared+kid card backs (mode-decks only).

    Returns `changed` map: key -> {'shared': n, 'kid_dbs': n}.
    Also resets cards.thumb_down_count to 0 on each touched kid card.
    """
    changed = {}
    if not bank:
        return changed

    shared_conn = get_shared_decks_connection()
    try:
        shared_back_content_decks = set()
        for row in shared_conn.execute(
            """
            SELECT d.deck_id
            FROM deck d
            JOIN deck_category dc ON dc.category_key = d.tags[1]
            WHERE dc.has_chinese_specific_logic = TRUE
              AND dc.chinese_back_content = ?
              AND NOT list_contains(d.tags, 'chinese_writing')
            """,
            [back_content_value],
        ).fetchall():
            shared_back_content_decks.add(row[0])

        for key, target in bank.items():
            if not target:
                continue
            rows = shared_conn.execute(
                "SELECT id, deck_id, back FROM cards WHERE front = ?",
                [key],
            ).fetchall()
            for card_id, deck_id, current_back in rows:
                if deck_id not in shared_back_content_decks:
                    continue
                if target == (current_back or ''):
                    continue
                shared_conn.execute(
                    "UPDATE cards SET back = ? WHERE id = ?",
                    [target, card_id],
                )
                changed.setdefault(key, {'shared': 0, 'kid_dbs': 0})
                changed[key]['shared'] += 1
    finally:
        shared_conn.close()

    families_root = Path(kid_db.DATA_DIR) / 'families'
    if not families_root.exists():
        return changed
    for db_path in sorted(families_root.glob('family_*/kid_*.db')):
        kid_conn = None
        try:
            kid_conn = kid_db.duckdb.connect(str(db_path))
            kid_shared_conn = get_shared_decks_connection(read_only=True)
            try:
                kid_decks_in_mode = set()
                deck_rows = kid_conn.execute(
                    """
                    SELECT id, tags
                    FROM decks
                    WHERE tags IS NOT NULL
                      AND NOT list_contains(tags, 'chinese_writing')
                    """
                ).fetchall()
                for deck_id, tags in deck_rows:
                    first_tag = (tags or [''])[0] if tags else ''
                    if not first_tag:
                        continue
                    meta_row = kid_shared_conn.execute(
                        """
                        SELECT chinese_back_content
                        FROM deck_category
                        WHERE category_key = ?
                          AND has_chinese_specific_logic = TRUE
                        LIMIT 1
                        """,
                        [first_tag],
                    ).fetchone()
                    if not meta_row:
                        continue
                    bc = str(meta_row[0] or '').strip().lower()
                    if bc == back_content_value:
                        kid_decks_in_mode.add(deck_id)
            finally:
                kid_shared_conn.close()

            for key, target in bank.items():
                if not target:
                    continue
                rows = kid_conn.execute(
                    "SELECT id, deck_id, back, thumb_down_count FROM cards WHERE front = ?",
                    [key],
                ).fetchall()
                touched = False
                for card_id, deck_id, current_back, thumb_count in rows:
                    if deck_id not in kid_decks_in_mode:
                        continue
                    back_changed = target != (current_back or '')
                    thumb_clear = int(thumb_count or 0) > 0
                    if not back_changed and not thumb_clear:
                        continue
                    kid_conn.execute(
                        "UPDATE cards SET back = ?, thumb_down_count = 0 WHERE id = ?",
                        [target, card_id],
                    )
                    touched = touched or back_changed
                if touched:
                    changed.setdefault(key, {'shared': 0, 'kid_dbs': 0})
                    changed[key]['kid_dbs'] += 1
        except Exception:
            pass
        finally:
            if kid_conn is not None:
                kid_conn.close()
    return changed
