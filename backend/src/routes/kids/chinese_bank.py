"""Chinese-bank (super-family) routes."""
from src.routes.kids import *  # noqa: F401,F403  -- pulls in kids_bp + helpers/state

@kids_bp.route('/chinese-bank', methods=['GET'])
def get_chinese_bank():
    """List chinese character bank with pagination, search, and filters."""
    family_id = current_family_id()
    if not family_id:
        return jsonify({'error': 'Family login required'}), 401
    is_super = is_super_family_id(family_id)

    page = max(1, int(request.args.get('page') or 1))
    per_page = min(200, max(10, int(request.args.get('perPage') or 50)))
    search = str(request.args.get('search') or '').strip()
    filter_verified = str(request.args.get('verified') or '').strip().lower()
    sort_param = str(request.args.get('sort') or '').strip().lower()

    conn = get_shared_decks_connection(read_only=True)
    try:
        conditions = []
        params = []

        if search:
            conditions.append(
                "(character = ? OR pinyin ILIKE ? OR en ILIKE ?)"
            )
            params.extend([search, f'%{search}%', f'%{search}%'])

        if filter_verified == 'verified':
            conditions.append("verified = TRUE")
        elif filter_verified == 'unverified':
            conditions.append("verified = FALSE")
            conditions.append("used = TRUE")
        elif filter_verified == 'used':
            conditions.append("used = TRUE")

        where = (' WHERE ' + ' AND '.join(conditions)) if conditions else ''

        total = conn.execute(
            f"SELECT COUNT(*) FROM chinese_character_bank{where}", params
        ).fetchone()[0]

        offset = (page - 1) * per_page
        if sort_param == 'updated_asc':
            order_by = 'last_updated ASC, character ASC'
        elif sort_param == 'updated_desc':
            order_by = 'last_updated DESC, character ASC'
        else:
            order_by = 'used DESC, character ASC'

        rows = conn.execute(
            f"SELECT character, pinyin, en, used, verified, last_updated FROM chinese_character_bank{where} ORDER BY {order_by} LIMIT ? OFFSET ?",
            params + [per_page, offset],
        ).fetchall()

        stats = conn.execute("""
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE used) AS used,
                COUNT(*) FILTER (WHERE verified) AS verified
            FROM chinese_character_bank
        """).fetchone()

        return jsonify({
            'characters': [
                {
                    'character': r[0],
                    'pinyin': r[1],
                    'en': r[2],
                    'used': bool(r[3]),
                    'verified': bool(r[4]),
                    'lastUpdated': str(r[5] or ''),
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
            },
        })
    finally:
        conn.close()


@kids_bp.route('/chinese-bank', methods=['PUT'])
def update_chinese_bank():
    """Update pinyin, en, and verified for one or more characters."""
    auth_err = require_super_family()
    if auth_err:
        return auth_err

    payload = request.get_json() or {}
    updates = payload.get('updates')
    if not isinstance(updates, list) or not updates:
        return jsonify({'error': 'updates array is required'}), 400

    conn = get_shared_decks_connection()
    try:
        updated = 0
        for item in updates:
            char = str(item.get('character') or '').strip()
            if not char:
                continue
            pinyin_val = str(item.get('pinyin') or '').strip()
            en_val = str(item.get('en') or '').strip()
            verified = bool(item.get('verified'))
            if not pinyin_val or not en_val:
                continue
            conn.execute(
                "UPDATE chinese_character_bank SET pinyin = ?, en = ?, verified = ?, last_updated = CURRENT_TIMESTAMP WHERE character = ?",
                [pinyin_val, en_val, verified, char],
            )
            updated += 1
        return jsonify({'updated': updated})
    finally:
        conn.close()


@kids_bp.route('/chinese-bank/refresh-used', methods=['POST'])
def refresh_chinese_bank_used():
    """Sweep all shared and kid DBs to update the used column."""
    auth_err = require_super_family()
    if auth_err:
        return auth_err

    import re
    from pathlib import Path
    from src.db import kid_db

    han_only_re = re.compile(r'^[\u3400-\u9FFF\uF900-\uFAFF]+$')

    conn = get_shared_decks_connection()
    try:
        # Only sweep cards whose deck belongs to a chinese-logic type_i category.
        # Other categories (type_ii writing, type_iii reading, non-chinese) are
        # not backed by the character/vocabulary bank.
        chinese_type_i_keys = [
            str(row[0])
            for row in conn.execute(
                """
                SELECT category_key FROM deck_category
                WHERE has_chinese_specific_logic = TRUE
                  AND behavior_type = ?
                """,
                [DECK_CATEGORY_BEHAVIOR_TYPE_I],
            ).fetchall()
        ]
        used_chars = set()

        if chinese_type_i_keys:
            placeholders = ', '.join(['?'] * len(chinese_type_i_keys))
            shared_rows = conn.execute(
                f"""
                SELECT DISTINCT c.front
                FROM cards c
                JOIN deck d ON d.deck_id = c.deck_id
                WHERE array_length(d.tags) >= 1
                  AND lower(d.tags[1]) IN ({placeholders})
                """,
                chinese_type_i_keys,
            ).fetchall()
            for row in shared_rows:
                front = str(row[0] or '').strip()
                if han_only_re.fullmatch(front):
                    used_chars.add(front)

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
                            chinese_type_i_keys,
                        ).fetchall()
                        for row in kid_rows:
                            front = str(row[0] or '').strip()
                            if han_only_re.fullmatch(front):
                                used_chars.add(front)
                    except Exception:
                        pass
                    finally:
                        if kid_conn is not None:
                            kid_conn.close()

        # Snapshot before: which chars were used before this refresh
        prev_used = {
            r[0]
            for r in conn.execute(
                "SELECT character FROM chinese_character_bank WHERE used = TRUE"
            ).fetchall()
        }
        existing_chars = {
            r[0]
            for r in conn.execute(
                "SELECT character FROM chinese_character_bank"
            ).fetchall()
        }

        # Insert missing characters into the bank with pypinyin defaults
        missing_chars = used_chars - existing_chars
        inserted_chars = []
        for char in sorted(missing_chars):
            try:
                pinyin = build_chinese_pinyin_text(char)
            except Exception:
                pinyin = ''
            conn.execute(
                "INSERT INTO chinese_character_bank (character, pinyin, en, used, verified, last_updated) VALUES (?, ?, '', TRUE, FALSE, CURRENT_TIMESTAMP)",
                [char, pinyin],
            )
            inserted_chars.append(char)

        # Reset all to unused, then mark used
        conn.execute("UPDATE chinese_character_bank SET used = FALSE")
        if used_chars:
            placeholders = ', '.join(['?'] * len(used_chars))
            conn.execute(
                f"UPDATE chinese_character_bank SET used = TRUE, last_updated = CURRENT_TIMESTAMP WHERE character IN ({placeholders})",
                list(used_chars),
            )

        # Compute newly used (was not used before, now is)
        newly_used = sorted(used_chars - prev_used - missing_chars)
        # Compute newly unused (was used before, now is not)
        newly_unused = sorted(prev_used - used_chars)

        used_count = conn.execute("SELECT COUNT(*) FROM chinese_character_bank WHERE used = TRUE").fetchone()[0]
        prev_used_count = len(prev_used)

        return jsonify({
            'usedCount': used_count,
            'prevUsedCount': prev_used_count,
            'newlyUsed': newly_used,
            'newlyUnused': newly_unused,
            'insertedChars': inserted_chars,
        })
    finally:
        conn.close()


@kids_bp.route('/chinese-bank/force-sync-backs', methods=['POST'])
def force_sync_chinese_bank_backs():
    """Re-generate the back text for every card whose front matches a verified bank entry.

    For cards in character decks (chinese_back_content='pinyin'), back <- bank.pinyin.
    For cards in vocabulary decks (chinese_back_content='english'), back <- bank.en.
    Writing decks are skipped regardless of back content.
    """
    auth_err = require_super_family()
    if auth_err:
        return auth_err

    from pathlib import Path
    from src.db import kid_db

    shared_conn = get_shared_decks_connection()
    try:
        verified_rows = shared_conn.execute(
            "SELECT character, pinyin, en FROM chinese_character_bank WHERE verified = TRUE"
        ).fetchall()
        if not verified_rows:
            return jsonify({'verified_count': 0, 'changed': []})
        bank = {
            r[0]: {'pinyin': str(r[1] or '').strip(), 'en': str(r[2] or '').strip()}
            for r in verified_rows
        }

        # Map deck_id -> back_content ('pinyin' | 'english') for chinese-logic decks only.
        shared_back_content_by_deck = {}
        for row in shared_conn.execute(
            """
            SELECT d.deck_id, dc.chinese_back_content
            FROM deck d
            JOIN deck_category dc ON dc.category_key = d.tags[1]
            WHERE dc.has_chinese_specific_logic = TRUE
              AND dc.chinese_back_content IN ('pinyin', 'english')
              AND NOT list_contains(d.tags, 'chinese_writing')
            """
        ).fetchall():
            shared_back_content_by_deck[row[0]] = str(row[1] or '').strip().lower()

        changed = {}
        for char, data in bank.items():
            rows = shared_conn.execute(
                "SELECT id, deck_id, back FROM cards WHERE front = ?",
                [char],
            ).fetchall()
            for card_id, deck_id, current_back in rows:
                bc = shared_back_content_by_deck.get(deck_id)
                if not bc:
                    continue
                target = data['pinyin'] if bc == 'pinyin' else data['en']
                if not target or target == (current_back or ''):
                    continue
                shared_conn.execute(
                    "UPDATE cards SET back = ? WHERE id = ?",
                    [target, card_id],
                )
                changed.setdefault(char, {'shared': 0, 'kid_dbs': 0})
                changed[char]['shared'] += 1
    finally:
        shared_conn.close()

    families_root = Path(kid_db.DATA_DIR) / 'families'
    if families_root.exists():
        for db_path in sorted(families_root.glob('family_*/kid_*.db')):
            kid_conn = None
            try:
                kid_conn = kid_db.duckdb.connect(str(db_path))
                kid_shared_conn = get_shared_decks_connection(read_only=True)
                try:
                    kid_back_content_by_deck = {}
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
                        if bc in ('pinyin', 'english'):
                            kid_back_content_by_deck[deck_id] = bc
                finally:
                    kid_shared_conn.close()

                for char, data in bank.items():
                    rows = kid_conn.execute(
                        "SELECT id, deck_id, back FROM cards WHERE front = ?",
                        [char],
                    ).fetchall()
                    touched = False
                    for card_id, deck_id, current_back in rows:
                        bc = kid_back_content_by_deck.get(deck_id)
                        if not bc:
                            continue
                        target = data['pinyin'] if bc == 'pinyin' else data['en']
                        if not target or target == (current_back or ''):
                            continue
                        kid_conn.execute(
                            "UPDATE cards SET back = ? WHERE id = ?",
                            [target, card_id],
                        )
                        touched = True
                    if touched:
                        changed.setdefault(char, {'shared': 0, 'kid_dbs': 0})
                        changed[char]['kid_dbs'] += 1
            except Exception:
                pass
            finally:
                if kid_conn is not None:
                    kid_conn.close()

    return jsonify({
        'verified_count': len(bank),
        'changed': [
            {'character': char, 'shared': counts['shared'], 'kid_dbs': counts['kid_dbs']}
            for char, counts in changed.items()
        ],
    })
