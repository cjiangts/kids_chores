"""Shared-deck (super-family-managed) routes."""
from src.routes.kids import *  # noqa: F401,F403  -- pulls in kids_bp + helpers/state

@kids_bp.route('/shared-decks/categories', methods=['GET'])
def list_shared_deck_categories():
    """Return all deck categories."""
    try:
        family_id = current_family_id()
        if not family_id:
            return jsonify({'error': 'Family login required'}), 401
        is_super = metadata.is_super_family(family_id)

        conn = get_shared_decks_connection(read_only=True)
        try:
            categories = get_shared_deck_categories(conn)
        finally:
            conn.close()

        if not is_super:
            categories = [c for c in categories if c.get('is_shared_with_non_super_family')]

        return jsonify({'categories': categories}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/categories', methods=['POST'])
def create_shared_deck_category():
    """Create one shared deck category (super-family only)."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err

        payload = request.get_json() or {}
        category_key = normalize_shared_deck_tag(payload.get('categoryKey'))
        if not category_key:
            raise ValueError('categoryKey is required')
        if len(category_key) > MAX_SHARED_TAG_LENGTH:
            raise ValueError(f'categoryKey is too long (max {MAX_SHARED_TAG_LENGTH})')

        behavior_type = normalize_shared_deck_category_behavior(payload.get('behaviorType'))
        if behavior_type not in DECK_CATEGORY_BEHAVIOR_TYPES:
            raise ValueError('behaviorType must be one of: type_i, type_ii, type_iii, type_iv')
        has_chinese_specific_logic = normalize_optional_bool(
            payload.get('hasChineseSpecificLogic'),
            'hasChineseSpecificLogic',
            False,
        )
        if (
            behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_IV
            and has_chinese_specific_logic
        ):
            raise ValueError('type_iv categories do not support hasChineseSpecificLogic')
        raw_back_content = str(payload.get('chineseBackContent') or '').strip().lower()
        is_type_i = (behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_I)
        if has_chinese_specific_logic and is_type_i:
            if raw_back_content not in CHINESE_BACK_CONTENTS:
                raise ValueError("chineseBackContent must be 'pinyin' or 'english' for type_i chinese categories")
            chinese_back_content = raw_back_content
        else:
            if raw_back_content:
                raise ValueError('chineseBackContent is only allowed for type_i categories with hasChineseSpecificLogic=true')
            chinese_back_content = None
        display_name = normalize_optional_display_name(payload.get('displayName'))
        emoji = normalize_optional_emoji(payload.get('emoji'))

        conn = get_shared_decks_connection()
        try:
            row = conn.execute(
                """
                INSERT INTO deck_category (
                    category_key,
                    behavior_type,
                    has_chinese_specific_logic,
                    is_shared_with_non_super_family,
                    display_name,
                    emoji,
                    chinese_back_content
                )
                VALUES (?, ?, ?, FALSE, ?, ?, ?)
                RETURNING
                  category_key,
                  behavior_type,
                  has_chinese_specific_logic,
                  is_shared_with_non_super_family,
                  display_name,
                  emoji,
                  chinese_back_content
                """,
                [
                    category_key,
                    behavior_type,
                    has_chinese_specific_logic,
                    display_name,
                    emoji,
                    chinese_back_content,
                ]
            ).fetchone()
        finally:
            conn.close()

        invalidate_category_meta_cache()
        return jsonify({
            'created': True,
            'category': {
                'category_key': str(row[0] or ''),
                'behavior_type': str(row[1] or ''),
                'has_chinese_specific_logic': bool(row[2]),
                'is_shared_with_non_super_family': bool(row[3]),
                'display_name': str(row[4] or '').strip(),
                'emoji': str(row[5] or '').strip(),
                'chinese_back_content': str(row[6] or '').strip().lower(),
            },
        }), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        err = str(e).lower()
        if 'unique' in err and 'category_key' in err:
            return jsonify({'error': 'categoryKey already exists'}), 409
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/categories/<category_key>/emoji', methods=['PUT'])
def update_shared_deck_category_emoji(category_key):
    """Update one shared deck category emoji (super-family only)."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err

        key = normalize_shared_deck_tag(category_key)
        if not key:
            return jsonify({'error': 'categoryKey is required'}), 400

        payload = request.get_json() or {}
        emoji = normalize_optional_emoji(payload.get('emoji'))

        conn = get_shared_decks_connection()
        try:
            row = conn.execute(
                """
                UPDATE deck_category
                SET emoji = ?
                WHERE category_key = ?
                RETURNING
                  category_key,
                  behavior_type,
                  has_chinese_specific_logic,
                  is_shared_with_non_super_family,
                  display_name,
                  emoji
                """,
                [emoji, key],
            ).fetchone()
        finally:
            conn.close()

        if row is None:
            return jsonify({'error': 'Category not found'}), 404

        invalidate_category_meta_cache()
        return jsonify({
            'updated': True,
            'category': {
                'category_key': str(row[0] or ''),
                'behavior_type': str(row[1] or ''),
                'has_chinese_specific_logic': bool(row[2]),
                'is_shared_with_non_super_family': bool(row[3]),
                'display_name': str(row[4] or '').strip(),
                'emoji': str(row[5] or '').strip(),
            },
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/categories/<category_key>/share', methods=['POST'])
def share_deck_category_to_non_super(category_key):
    """One-way share: allow non-super families to access one deck category."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err

        key = normalize_shared_deck_tag(category_key)
        if not key:
            return jsonify({'error': 'categoryKey is required'}), 400

        conn = get_shared_decks_connection()
        try:
            row = conn.execute(
                """
                SELECT
                  category_key,
                  behavior_type,
                  has_chinese_specific_logic,
                  is_shared_with_non_super_family,
                  display_name,
                  emoji
                FROM deck_category
                WHERE category_key = ?
                LIMIT 1
                """,
                [key],
            ).fetchone()
            if row is None:
                return jsonify({'error': 'Category not found'}), 404

            already_shared = bool(row[3])
            if not already_shared:
                row = conn.execute(
                    """
                    UPDATE deck_category
                    SET is_shared_with_non_super_family = TRUE
                    WHERE category_key = ?
                    RETURNING
                      category_key,
                      behavior_type,
                      has_chinese_specific_logic,
                      is_shared_with_non_super_family,
                      display_name,
                      emoji
                    """,
                    [key],
                ).fetchone()
            else:
                row = conn.execute(
                    """
                    SELECT
                      category_key,
                      behavior_type,
                      has_chinese_specific_logic,
                      is_shared_with_non_super_family,
                      display_name,
                      emoji
                    FROM deck_category
                    WHERE category_key = ?
                    LIMIT 1
                    """,
                    [key],
                ).fetchone()
        finally:
            conn.close()

        if not already_shared:
            invalidate_category_meta_cache()
        return jsonify({
            'shared': True,
            'updated': not already_shared,
            'category': {
                'category_key': str(row[0] or ''),
                'behavior_type': str(row[1] or ''),
                'has_chinese_specific_logic': bool(row[2]),
                'is_shared_with_non_super_family': bool(row[3]),
                'display_name': str(row[4] or '').strip(),
                'emoji': str(row[5] or '').strip(),
            },
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/name-availability', methods=['GET'])
def shared_deck_name_availability():
    """Check whether a shared deck name is globally available."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err
        requested_name = str(request.args.get('name') or '').strip()
        exclude_deck_id_raw = str(request.args.get('excludeDeckId') or '').strip()
        exclude_deck_id = None
        if exclude_deck_id_raw:
            try:
                exclude_deck_id = int(exclude_deck_id_raw)
            except (TypeError, ValueError):
                return jsonify({'error': 'excludeDeckId must be an integer'}), 400

        conn = get_shared_decks_connection(read_only=True)
        try:
            tags = None
            first_tag_raw = request.args.get('firstTag')
            if first_tag_raw is not None:
                extra_tags_raw = request.args.getlist('extraTag')
                allowed_first_tags = get_allowed_shared_deck_first_tags(conn)
                tags = build_shared_deck_tags(
                    first_tag_raw,
                    extra_tags_raw,
                    allowed_first_tags=allowed_first_tags,
                )

            deck_name = '_'.join(tags) if tags else requested_name
            if not deck_name:
                return jsonify({'error': 'name is required'}), 400

            if exclude_deck_id is not None and exclude_deck_id > 0:
                row = conn.execute(
                    "SELECT deck_id FROM deck WHERE name = ? AND deck_id <> ? LIMIT 1",
                    [deck_name, exclude_deck_id]
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT deck_id FROM deck WHERE name = ? LIMIT 1",
                    [deck_name]
                ).fetchone()
            prefix_conflict_tags = (
                find_shared_deck_tag_prefix_conflict(conn, tags)
                if tags
                else None
            )
        finally:
            conn.close()

        if row is not None:
            conflict_type = 'exact_name'
        elif prefix_conflict_tags:
            conflict_type = 'tag_prefix_conflict'
        else:
            conflict_type = None
        return jsonify({
            'name': deck_name,
            'available': row is None and not prefix_conflict_tags,
            'existing_deck_id': int(row[0]) if row else None,
            'conflict_type': conflict_type,
            'conflict_tags': prefix_conflict_tags,
            'exclude_deck_id': exclude_deck_id,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/chinese-characters/pinyin', methods=['POST'])
def shared_deck_chinese_characters_pinyin():
    """Return pinyin and composed back-text mappings for requested Chinese text."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err

        payload = request.get_json() or {}
        texts = normalize_shared_deck_fronts(payload.get('texts'))
        back_content = normalize_chinese_back_content(payload.get('backContent'))
        if not back_content:
            raise ValueError("backContent must be 'pinyin' or 'english'")
        pinyin_by_text = {}
        back_by_text = {}
        conn = get_shared_decks_connection(read_only=True)
        try:
            for text in texts:
                key = str(text)
                if back_content == CHINESE_BACK_CONTENT_PINYIN:
                    if not is_single_chinese_character(text):
                        continue
                    bank_pinyin = get_character_bank_pinyin(text, conn=conn)
                    generated_pinyin = bank_pinyin or build_chinese_pinyin_text(text)
                    pinyin_by_text[key] = generated_pinyin
                    back_by_text[key] = build_chinese_auto_back_text(
                        text, back_content, generated_pinyin=generated_pinyin, conn=conn
                    )
                else:
                    if not is_chinese_text(text):
                        continue
                    back_by_text[key] = build_chinese_auto_back_text(text, back_content, conn=conn)
        finally:
            conn.close()
        return jsonify({
            'count': len(texts),
            'pinyin_by_text': pinyin_by_text,
            'back_by_text': back_by_text,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/type4/preview', methods=['POST'])
def preview_shared_type4_generator():
    """Run a Type IV generator snippet and return example outputs."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err

        payload = request.get_json() or {}
        generator_code = normalize_type_iv_generator_code(payload.get('generatorCode'))
        raw_seed_base = payload.get('seedBase')
        if raw_seed_base in (None, ''):
            seed_base = 1000
        else:
            seed_base = int(raw_seed_base)
        samples, has_validate = preview_type4_generator(
            generator_code,
            sample_count=TYPE_IV_PREVIEW_SAMPLE_COUNT,
            seed_base=seed_base,
        )
        return jsonify({
            'sample_count': len(samples),
            'samples': samples,
            'has_validate': has_validate,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/type4/test-validate', methods=['POST'])
def test_shared_type4_validate():
    """Test a Type IV generator's validate function against a submitted answer."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err

        payload = request.get_json() or {}
        generator_code = normalize_type_iv_generator_code(payload.get('generatorCode'))
        submitted_answer = str(payload.get('submittedAnswer') or '').strip()
        expected_answer = str(payload.get('expectedAnswer') or '').strip()
        if not submitted_answer:
            return jsonify({'error': 'submittedAnswer is required'}), 400
        if not expected_answer:
            return jsonify({'error': 'expectedAnswer is required'}), 400

        result = test_type4_validate(generator_code, submitted_answer, expected_answer)
        return jsonify(result), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/type4/representative-label-availability', methods=['POST'])
def shared_type4_representative_label_availability():
    """Check whether a type-IV representative label is available in one category."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err

        payload = request.get_json() or {}
        category_key = normalize_shared_deck_tag(payload.get('categoryKey'))
        if not category_key:
            raise ValueError('categoryKey is required')
        representative_label = normalize_type_iv_display_label(payload.get('displayLabel'))
        exclude_deck_id_raw = payload.get('excludeDeckId')
        exclude_deck_id = None
        if exclude_deck_id_raw not in (None, ''):
            try:
                exclude_deck_id = int(exclude_deck_id_raw)
            except (TypeError, ValueError):
                raise ValueError('excludeDeckId must be an integer')

        conn = get_shared_decks_connection(read_only=True)
        try:
            category_meta = None
            for item in get_shared_deck_categories(conn):
                key = normalize_shared_deck_tag(item.get('category_key'))
                if key == category_key:
                    category_meta = item
                    break
            if category_meta is None:
                raise ValueError(f'Unknown categoryKey: {category_key}')
            behavior_type = str(category_meta.get('behavior_type') or '').strip().lower()
            if behavior_type != DECK_CATEGORY_BEHAVIOR_TYPE_IV:
                raise ValueError('Representative-label availability is only for type_iv categories')

            conflict = find_shared_type_iv_representative_label_conflict(
                conn,
                category_key,
                representative_label,
                exclude_deck_id=exclude_deck_id,
            )
        finally:
            conn.close()

        return jsonify({
            'category_key': category_key,
            'display_label': representative_label,
            'available': conflict is None,
            'existing_deck_id': int(conflict['deck_id']) if conflict else None,
            'existing_deck_name': str(conflict['deck_name']) if conflict else '',
            'existing_tags': list(conflict['tags']) if conflict else [],
            'existing_tag_labels': list(conflict['tag_labels']) if conflict else [],
            'exclude_deck_id': exclude_deck_id,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/category-card-overlap', methods=['POST'])
def shared_deck_category_card_overlap():
    """Compare candidate cards with existing cards in one category."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err

        payload = request.get_json() or {}
        category_key = normalize_shared_deck_tag(payload.get('categoryKey'))
        if not category_key:
            raise ValueError('categoryKey is required')

        conn = get_shared_decks_connection(read_only=True)
        try:
            category_meta = None
            for item in get_shared_deck_categories(conn):
                key = normalize_shared_deck_tag(item.get('category_key'))
                if key == category_key:
                    category_meta = item
                    break
            if category_meta is None:
                raise ValueError(f'Unknown categoryKey: {category_key}')

            behavior_type = str(category_meta.get('behavior_type') or '').strip().lower()
            chinese_type_i = (
                behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_I
                and bool(category_meta.get('has_chinese_specific_logic'))
            )
            cards = normalize_shared_deck_cards(
                payload.get('cards'), allow_empty_back=chinese_type_i
            )
            if behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_IV:
                raise ValueError('type_iv categories use Python generators, not static cards')
            dedupe_key = 'back' if behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_II else 'front'
            other_key = 'front' if dedupe_key == 'back' else 'back'

            rows = conn.execute(
                """
                SELECT
                  c.front,
                  c.back,
                  d.deck_id,
                  d.name
                FROM cards c
                JOIN deck d ON d.deck_id = c.deck_id
                WHERE array_length(d.tags) >= 1
                  AND lower(d.tags[1]) = ?
                ORDER BY d.deck_id ASC, c.id ASC
                """,
                [category_key],
            ).fetchall()
        finally:
            conn.close()

        existing_by_dedupe = {}
        for row in rows:
            front = str(row[0] or '')
            back = str(row[1] or '')
            dedupe_value = back if dedupe_key == 'back' else front
            existing_by_dedupe.setdefault(dedupe_value, []).append({
                'front': front,
                'back': back,
                'deck_id': int(row[2]),
                'deck_name': str(row[3] or ''),
            })

        def unique_decks(entries):
            seen = set()
            out = []
            for entry in entries:
                key = int(entry.get('deck_id') or 0)
                if key <= 0 or key in seen:
                    continue
                seen.add(key)
                out.append({
                    'deck_id': key,
                    'deck_name': str(entry.get('deck_name') or '').strip(),
                })
            return out

        overlaps = []
        for idx, card in enumerate(cards):
            front = str(card.get('front') or '')
            back = str(card.get('back') or '')
            dedupe_value = back if dedupe_key == 'back' else front
            matches = list(existing_by_dedupe.get(dedupe_value) or [])
            if not matches:
                continue

            exact_matches = [entry for entry in matches if entry.get('front') == front and entry.get('back') == back]
            mismatch_matches = [entry for entry in matches if not (entry.get('front') == front and entry.get('back') == back)]
            overlaps.append({
                'index': idx,
                'front': front,
                'back': back,
                'dedupe_key': dedupe_key,
                'dedupe_value': dedupe_value,
                'other_key': other_key,
                'exact_match_decks': unique_decks(exact_matches),
                'mismatch_decks': unique_decks(mismatch_matches),
            })

        return jsonify({
            'category_key': category_key,
            'dedupe_key': dedupe_key,
            'other_key': other_key,
            'overlaps': overlaps,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/tags', methods=['GET'])
def shared_deck_tags():
    """Return shared-deck ordered tag paths for autocomplete."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err

        conn = get_shared_decks_connection(read_only=True)
        try:
            tag_paths = get_all_shared_deck_tag_paths(conn)
        finally:
            conn.close()

        return jsonify({'tag_paths': tag_paths}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/mine', methods=['GET'])
def list_my_shared_decks():
    """List shared decks visible to the currently authenticated family."""
    try:
        family_id = current_family_id()
        if not family_id:
            return jsonify({'error': 'Family login required'}), 401
        is_super = metadata.is_super_family(family_id)

        conn = get_shared_decks_connection(read_only=True)
        try:
            has_cell_design = shared_deck_generator_definition_has_print_cell_design_columns(conn)
            print_cell_design_select = (
                "CASE WHEN COALESCE(dgd.print_cell_design_json, '') <> '' THEN TRUE ELSE FALSE END AS has_print_cell_design"
                if has_cell_design
                else "FALSE AS has_print_cell_design"
            )
            if is_super:
                where_clause = "WHERE d.creator_family_id = ?"
                params = [int(family_id)]
            else:
                where_clause = ""
                params = []
            rows = conn.execute(
                f"""
                SELECT
                    d.deck_id,
                    d.name,
                    d.tags,
                    d.creator_family_id,
                    d.created_at,
                    CAST(COALESCE(COUNT(c.id), 0) AS INTEGER) AS card_count,
                    CASE
                        WHEN COUNT(c.id) = 1 THEN MIN(c.front)
                        ELSE NULL
                    END AS single_card_front,
                    {print_cell_design_select}
                FROM deck d
                LEFT JOIN cards c ON c.deck_id = d.deck_id
                LEFT JOIN deck_generator_definition dgd ON dgd.deck_id = d.deck_id
                {where_clause}
                GROUP BY d.deck_id, d.name, d.tags, d.creator_family_id, d.created_at, dgd.print_cell_design_json
                ORDER BY d.created_at DESC, d.deck_id DESC
                """,
                params
            ).fetchall()

            shared_category_keys = set()
            type_ii_category_keys = set()
            cat_rows = conn.execute(
                "SELECT category_key, behavior_type, is_shared_with_non_super_family FROM deck_category"
            ).fetchall()
            for cr in cat_rows:
                ck = str(cr[0]).strip().lower()
                if str(cr[1] or '').strip().lower() == 'type_ii':
                    type_ii_category_keys.add(ck)
                if not is_super and cr[2]:
                    shared_category_keys.add(ck)

            card_rows_all = conn.execute(
                "SELECT deck_id, front, back FROM cards ORDER BY deck_id, id"
            ).fetchall()
            card_fronts_by_deck = {}
            card_backs_by_deck = {}
            for cf_row in card_rows_all:
                cf_deck_id = int(cf_row[0])
                card_fronts_by_deck.setdefault(cf_deck_id, []).append(str(cf_row[1]))
                card_backs_by_deck.setdefault(cf_deck_id, []).append(str(cf_row[2]))
        finally:
            conn.close()

        decks = []
        for row in rows:
            tags, tag_labels = extract_shared_deck_tags_and_labels(row[2])
            first_tag = normalize_shared_deck_tag(tags[0]) if tags else ''
            if not is_super and first_tag not in shared_category_keys:
                continue
            deck_id_val = int(row[0])
            is_type_ii = first_tag in type_ii_category_keys
            deck_entry = {
                'deck_id': deck_id_val,
                'name': str(row[1]),
                'tags': tags,
                'tag_labels': tag_labels,
                'creator_family_id': int(row[3]),
                'created_at': row[4].isoformat() if row[4] else None,
                'card_count': int(row[5] or 0),
                'single_card_front': str(row[6] or '').strip(),
                'has_print_cell_design': bool(row[7]) if len(row) > 7 and row[7] is not None else False,
                'card_texts': card_backs_by_deck.get(deck_id_val, []) if is_type_ii else card_fronts_by_deck.get(deck_id_val, []),
            }
            decks.append(deck_entry)

        return jsonify({'decks': decks}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/<int:deck_id>', methods=['GET'])
def get_shared_deck_details(deck_id):
    """Return one shared deck and cards for view UI."""
    try:
        family_id = current_family_id()
        if not family_id:
            return jsonify({'error': 'Family login required'}), 401

        conn = get_shared_decks_connection(read_only=True)
        try:
            deck_row = conn.execute(
                "SELECT deck_id, name, tags, creator_family_id, created_at FROM deck WHERE deck_id = ?",
                [deck_id],
            ).fetchone()
            if not deck_row:
                return jsonify({'error': 'Deck not found'}), 404
            behavior_type = get_shared_deck_behavior_type_from_raw_tags(conn, deck_row[2])
            chinese_type_i = is_shared_deck_chinese_type_i(conn, deck_row[2])
            cards = get_shared_deck_cards(conn, deck_id)
            generator_definition = (
                get_shared_deck_generator_definition(conn, deck_id)
                if behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_IV
                else None
            )
        finally:
            conn.close()

        return jsonify({
            'deck': {
                'deck_id': int(deck_row[0]),
                'name': str(deck_row[1]),
                'tags': extract_shared_deck_tags_and_labels(deck_row[2])[0],
                'tag_labels': extract_shared_deck_tags_and_labels(deck_row[2])[1],
                'creator_family_id': int(deck_row[3]),
                'created_at': deck_row[4].isoformat() if deck_row[4] else None,
                'behavior_type': behavior_type,
                'has_chinese_specific_logic': chinese_type_i,
            },
            'card_count': len(cards),
            'cards': cards,
            'generator_definition': generator_definition,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/<int:deck_id>/tags', methods=['PUT'])
def update_shared_deck_tags(deck_id):
    """Rename one owned shared deck's tag path while keeping its first tag fixed."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err
        family_id_int = get_current_family_id_int()
        if family_id_int is None:
            if not current_family_id():
                return jsonify({'error': 'Family login required'}), 401
            return jsonify({'error': 'Invalid family id in session'}), 400

        payload = request.get_json(silent=True) or {}
        extra_tags_payload = payload.get('extraTags')

        with _SHARED_DECK_MUTATION_LOCK:
            conn = None
            try:
                conn = get_shared_decks_connection()
                deck_row = get_shared_deck_owned_by_family(conn, deck_id, family_id_int)
                if not deck_row:
                    return jsonify({'error': 'Deck not found'}), 404

                current_name = str(deck_row[1] or '').strip()
                current_tags, _ = extract_shared_deck_tags_and_labels(deck_row[2])
                current_first_tag = normalize_shared_deck_tag(current_tags[0] if current_tags else '')
                if not current_first_tag:
                    return jsonify({'error': 'Deck is missing a valid first tag'}), 400

                allowed_first_tags = get_allowed_shared_deck_first_tags(conn)
                tags, comments_by_tag = build_shared_deck_tags(
                    current_first_tag,
                    extra_tags_payload,
                    allowed_first_tags=allowed_first_tags,
                    include_comments=True,
                )
                if tags[0] != current_first_tag:
                    return jsonify({'error': 'First tag cannot be changed here'}), 400

                if tags != current_tags:
                    prefix_conflict_tags = find_shared_deck_tag_prefix_conflict(conn, tags)
                    if prefix_conflict_tags:
                        raise ValueError(
                            'Tag path conflicts with existing deck path '
                            f'{format_shared_deck_tag_path(prefix_conflict_tags)}. '
                            'Nested tag paths are not allowed.'
                        )

                next_name = '_'.join(tags)
                storage_tags = [
                    format_shared_deck_tag_display_label(tag, comments_by_tag.get(tag))
                    for tag in tags
                ]

                existing_name_row = conn.execute(
                    "SELECT deck_id FROM deck WHERE name = ? AND deck_id <> ? LIMIT 1",
                    [next_name, deck_id],
                ).fetchone()
                if existing_name_row:
                    return jsonify({'error': 'Deck name already exists. Please choose different tags.'}), 409

                shared_updated = False
                if next_name != current_name or storage_tags != [str(item) for item in list(deck_row[2] or [])]:
                    conn.execute("BEGIN TRANSACTION")
                    try:
                        conn.execute(
                            """
                            UPDATE deck
                            SET name = ?, tags = ?
                            WHERE deck_id = ? AND creator_family_id = ?
                            """,
                            [next_name, storage_tags, deck_id, family_id_int],
                        )
                        conn.execute("COMMIT")
                        shared_updated = True
                    except Exception:
                        conn.execute("ROLLBACK")
                        raise
            finally:
                if conn is not None:
                    conn.close()

            sync_result = sync_materialized_shared_deck_metadata_for_all_kids(
                deck_id,
                next_name,
                storage_tags,
            )
            if sync_result['failures']:
                failed_labels = [
                    item['kid_name'] or f"kid {item['kid_id']}"
                    for item in sync_result['failures']
                ]
                return jsonify({
                    'error': (
                        'Shared deck tags were updated, but some kid DBs failed to sync: '
                        + ', '.join(failed_labels)
                        + '. Re-running the same rename will retry the kid sync.'
                    ),
                    'shared_updated': bool(shared_updated),
                    'deck_id': int(deck_id),
                    'deck': {
                        'deck_id': int(deck_id),
                        'name': next_name,
                        'tags': tags,
                        'tag_labels': storage_tags,
                    },
                    'updated_kid_count': int(sync_result['updated_kid_count']),
                    'updated_deck_count': int(sync_result['updated_deck_count']),
                    'kid_sync_failures': sync_result['failures'],
                }), 500

        return jsonify({
            'updated': True,
            'shared_updated': bool(shared_updated),
            'deck': {
                'deck_id': int(deck_id),
                'name': next_name,
                'tags': tags,
                'tag_labels': storage_tags,
            },
            'updated_kid_count': int(sync_result['updated_kid_count']),
            'updated_deck_count': int(sync_result['updated_deck_count']),
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/rename-tag', methods=['POST'])
def rename_shared_deck_tag():
    """Rename a tag across all decks that contain it at the specified position."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err
        family_id_int = get_current_family_id_int()
        if family_id_int is None:
            if not current_family_id():
                return jsonify({'error': 'Family login required'}), 401
            return jsonify({'error': 'Invalid family id in session'}), 400

        payload = request.get_json(silent=True) or {}
        old_tag_raw = str(payload.get('oldTag') or '').strip()
        new_tag_raw = str(payload.get('newTag') or '').strip()
        tag_index = int(payload.get('tagIndex', -1))

        old_tag = normalize_shared_deck_tag(old_tag_raw)
        new_tag_parsed, new_comment = parse_shared_deck_tag_with_comment(new_tag_raw)
        if not old_tag:
            return jsonify({'error': 'oldTag is required'}), 400
        if not new_tag_parsed:
            return jsonify({'error': 'newTag is required'}), 400
        if tag_index < 1:
            return jsonify({'error': 'tagIndex must be >= 1 (cannot rename first tag)'}), 400
        if old_tag == new_tag_parsed and not new_comment:
            return jsonify({'error': 'New tag is the same as the old tag'}), 400

        new_label = format_shared_deck_tag_display_label(new_tag_parsed, new_comment)

        with _SHARED_DECK_MUTATION_LOCK:
            conn = None
            try:
                conn = get_shared_decks_connection()
                all_rows = conn.execute(
                    "SELECT deck_id, name, tags, creator_family_id FROM deck WHERE creator_family_id = ?",
                    [family_id_int],
                ).fetchall()

                matching_decks = []
                for row in all_rows:
                    deck_id = row[0]
                    raw_tags = row[2]
                    tags, _ = extract_shared_deck_tags_and_labels(raw_tags)
                    if tag_index < len(tags) and tags[tag_index] == old_tag:
                        matching_decks.append((deck_id, row[1], raw_tags, tags))

                if not matching_decks:
                    return jsonify({'error': f'No decks found with tag "{old_tag}" at position {tag_index}'}), 404

                # Check for name conflicts before making any changes
                for deck_id, current_name, raw_tags, tags in matching_decks:
                    new_tags = list(tags)
                    new_tags[tag_index] = new_tag_parsed
                    new_name = '_'.join(new_tags)
                    if new_name != current_name:
                        conflict = conn.execute(
                            "SELECT deck_id FROM deck WHERE name = ? AND deck_id <> ? LIMIT 1",
                            [new_name, deck_id],
                        ).fetchone()
                        if conflict:
                            return jsonify({
                                'error': f'Renaming would create duplicate deck name "{new_name}"',
                            }), 409

                # Apply all renames in a single transaction
                conn.execute("BEGIN TRANSACTION")
                try:
                    updated_decks = []
                    for deck_id, current_name, raw_tags, tags in matching_decks:
                        new_tags = list(tags)
                        new_tags[tag_index] = new_tag_parsed
                        new_name = '_'.join(new_tags)

                        storage_tags = list(raw_tags or [])
                        if tag_index < len(storage_tags):
                            storage_tags[tag_index] = new_label

                        conn.execute(
                            "UPDATE deck SET name = ?, tags = ? WHERE deck_id = ? AND creator_family_id = ?",
                            [new_name, storage_tags, deck_id, family_id_int],
                        )
                        updated_decks.append({
                            'deck_id': int(deck_id),
                            'name': new_name,
                            'tags': new_tags,
                            'tag_labels': storage_tags,
                        })
                    conn.execute("COMMIT")
                except Exception:
                    conn.execute("ROLLBACK")
                    raise
            finally:
                if conn is not None:
                    conn.close()

            # Sync each renamed deck to kid DBs
            total_kid_updates = 0
            total_deck_updates = 0
            sync_failures = []
            for deck_info in updated_decks:
                result = sync_materialized_shared_deck_metadata_for_all_kids(
                    deck_info['deck_id'],
                    deck_info['name'],
                    deck_info['tag_labels'],
                )
                total_kid_updates += result['updated_kid_count']
                total_deck_updates += result['updated_deck_count']
                sync_failures.extend(result['failures'])

        return jsonify({
            'updated': True,
            'renamed_deck_count': len(updated_decks),
            'updated_kid_count': total_kid_updates,
            'updated_deck_count': total_deck_updates,
            'decks': updated_decks,
            'sync_failures': sync_failures,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/<int:deck_id>/generator-definition', methods=['PUT'])
def update_shared_deck_generator_definition(deck_id):
    """Update the stored Python generator code for one owned type-IV shared deck."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err
        family_id_int = get_current_family_id_int()
        if family_id_int is None:
            if not current_family_id():
                return jsonify({'error': 'Family login required'}), 401
            return jsonify({'error': 'Invalid family id in session'}), 400

        payload = request.get_json(silent=True) or {}
        generator_code = normalize_type_iv_generator_code(payload.get('generatorCode'))
        preview_type4_generator(generator_code, sample_count=1)

        with _SHARED_DECK_MUTATION_LOCK:
            conn = None
            try:
                conn = get_shared_decks_connection()
                deck_row = get_shared_deck_owned_by_family(conn, deck_id, family_id_int)
                if not deck_row:
                    return jsonify({'error': 'Deck not found'}), 404
                behavior_type = get_shared_deck_behavior_type_from_raw_tags(conn, deck_row[2])
                if behavior_type != DECK_CATEGORY_BEHAVIOR_TYPE_IV:
                    return jsonify({'error': 'Only type_iv decks support generator code updates'}), 400
                existing_definition = get_shared_deck_generator_definition(conn, deck_id)
                if not existing_definition:
                    return jsonify({'error': 'Generator definition not found for this deck'}), 404
                is_multichoice_only = normalize_type_iv_multichoice_only(
                    payload.get('isMultichoiceOnly'),
                    default=bool(existing_definition.get('is_multichoice_only')),
                )
                conn.execute(
                    """
                    UPDATE deck_generator_definition
                    SET code = ?, is_multichoice_only = ?
                    WHERE deck_id = ?
                    """,
                    [generator_code, bool(is_multichoice_only), deck_id],
                )
            finally:
                if conn is not None:
                    conn.close()

        return jsonify({
            'updated': True,
            'deck_id': int(deck_id),
            'generator_definition': {
                'code': generator_code,
                'is_multichoice_only': bool(is_multichoice_only),
            },
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@kids_bp.route('/shared-decks/<int:deck_id>/print-problems', methods=['POST'])
def generate_shared_deck_print_problems(deck_id):
    """Generate math problems from a type-IV deck generator for printable sheets."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err
        family_id_int = get_current_family_id_int()
        if family_id_int is None:
            if not current_family_id():
                return jsonify({'error': 'Family login required'}), 401
            return jsonify({'error': 'Invalid family id in session'}), 400

        payload = request.get_json(silent=True) or {}
        count = _safe_positive_int_or_none(payload.get('count'))
        if count is None or count <= 0:
            return jsonify({'error': 'count is required and must be a positive integer'}), 400
        if count > 200:
            return jsonify({'error': 'count must be at most 200'}), 400

        seed_base = payload.get('seedBase')
        if seed_base is None:
            seed_base = int(time.time_ns() % 2_000_000_000)
        else:
            try:
                seed_base = int(seed_base)
            except (TypeError, ValueError):
                return jsonify({'error': 'seedBase must be an integer'}), 400

        conn = None
        try:
            conn = get_shared_decks_connection(read_only=True)
            deck_row = get_shared_deck_owned_by_family(conn, deck_id, family_id_int)
            if not deck_row:
                return jsonify({'error': 'Deck not found'}), 404
            behavior_type = get_shared_deck_behavior_type_from_raw_tags(conn, deck_row[2])
            if behavior_type != DECK_CATEGORY_BEHAVIOR_TYPE_IV:
                return jsonify({'error': 'Only type_iv decks support print problems'}), 400
            definition = get_shared_deck_generator_definition(conn, deck_id)
            if not definition or not definition.get('code'):
                return jsonify({'error': 'Generator definition not found for this deck'}), 404
        finally:
            if conn is not None:
                conn.close()

        samples = run_type4_generator(
            definition['code'],
            sample_count=count,
            seed_base=seed_base,
        )
        problems = []
        for sample in samples:
            problems.append({
                'prompt': str(sample.get('prompt', '')),
                'answer': str(sample.get('answer', '')),
            })

        return jsonify({
            'deck_id': int(deck_id),
            'problems': problems,
            'seed_base': seed_base,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/<int:deck_id>/print-cell-design', methods=['PUT'])
def update_shared_deck_print_cell_design(deck_id):
    """Persist one shared type-IV deck cell design (super family only)."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err
        family_id_int = get_current_family_id_int()
        if family_id_int is None:
            if not current_family_id():
                return jsonify({'error': 'Family login required'}), 401
            return jsonify({'error': 'Invalid family id in session'}), 400

        payload = request.get_json(silent=True) or {}
        raw_cell_design = payload.get('cellDesign')
        if raw_cell_design is None:
            cell_design = None
            design_json = None
        else:
            cell_design = normalize_type_iv_print_cell_design(raw_cell_design)
            design_json = json.dumps(cell_design, ensure_ascii=False, separators=(',', ':'))

        with _SHARED_DECK_MUTATION_LOCK:
            conn = None
            try:
                conn = get_shared_decks_connection()
                deck_row = get_shared_deck_owned_by_family(conn, deck_id, family_id_int)
                if not deck_row:
                    return jsonify({'error': 'Deck not found'}), 404
                behavior_type = get_shared_deck_behavior_type_from_raw_tags(conn, deck_row[2])
                if behavior_type != DECK_CATEGORY_BEHAVIOR_TYPE_IV:
                    return jsonify({'error': 'Only type_iv decks support print cell design'}), 400
                existing_definition = get_shared_deck_generator_definition(conn, deck_id)
                if not existing_definition:
                    return jsonify({'error': 'Generator definition not found for this deck'}), 404
                conn.execute(
                    """
                    UPDATE deck_generator_definition
                    SET print_cell_design_json = ?
                    WHERE deck_id = ?
                    """,
                    [design_json, deck_id],
                )
            finally:
                if conn is not None:
                    conn.close()

        return jsonify({
            'updated': True,
            'deck_id': int(deck_id),
            'cell_design': cell_design,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/<int:deck_id>/cards', methods=['POST'])
def add_shared_deck_cards(deck_id):
    """Add cards to one owned shared deck with category-aware dedupe."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err
        family_id_int = get_current_family_id_int()
        if family_id_int is None:
            if not current_family_id():
                return jsonify({'error': 'Family login required'}), 401
            return jsonify({'error': 'Invalid family id in session'}), 400

        conn = None
        try:
            conn = get_shared_decks_connection()
            deck_row = get_shared_deck_owned_by_family(conn, deck_id, family_id_int)
            if not deck_row:
                return jsonify({'error': 'Deck not found'}), 404
            behavior_type = get_shared_deck_behavior_type_from_raw_tags(conn, deck_row[2])
            if behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_IV:
                return jsonify({'error': 'type_iv decks are immutable and do not support card edits'}), 400

            payload = request.get_json(silent=True) or {}
            if isinstance(payload.get('cards'), list):
                cards = normalize_shared_deck_cards(payload.get('cards'))
            else:
                front = str(payload.get('front') or '').strip()
                back = str(payload.get('back') or '').strip()
                if not front or not back:
                    return jsonify({'error': 'Provide cards[] or one front/back pair.'}), 400
                cards = [{'front': front, 'back': back}]

            dedupe_key = get_shared_deck_dedupe_key(conn, deck_row[2])
            cards = (
                dedupe_shared_deck_cards_by_back(cards)
                if dedupe_key == 'back'
                else dedupe_shared_deck_cards_by_front(cards)
            )

            existing_rows = conn.execute(
                "SELECT front, back FROM cards WHERE deck_id = ?",
                [deck_id]
            ).fetchall()
            existing_fronts = {str(row[0] or '') for row in existing_rows if str(row[0] or '')}
            existing_backs = {str(row[1] or '') for row in existing_rows if str(row[1] or '')}

            insert_rows = []
            skipped_existing_front = 0
            skipped_existing_back = 0
            for card in cards:
                front = str(card.get('front') or '')
                back = str(card.get('back') or '')
                if front in existing_fronts:
                    skipped_existing_front += 1
                    continue
                if dedupe_key == 'back' and back in existing_backs:
                    skipped_existing_back += 1
                    continue
                existing_fronts.add(front)
                existing_backs.add(back)
                insert_rows.append([deck_id, front, back])

            if insert_rows:
                conn.executemany(
                    """
                    INSERT INTO cards (deck_id, front, back)
                    VALUES (?, ?, ?)
                    """,
                    insert_rows
                )

            card_count = int(conn.execute(
                "SELECT COUNT(*) FROM cards WHERE deck_id = ?",
                [deck_id]
            ).fetchone()[0] or 0)
        finally:
            if conn is not None:
                conn.close()

        return jsonify({
            'deck_id': int(deck_id),
            'dedupe_key': dedupe_key,
            'input_count': len(cards),
            'inserted_count': len(insert_rows),
            'skipped_existing_front': skipped_existing_front,
            'skipped_existing_back': skipped_existing_back,
            'skipped_existing_count': int(skipped_existing_front + skipped_existing_back),
            'card_count': card_count,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        err = str(e).lower()
        if 'unique' in err and 'front' in err:
            return jsonify({'error': 'One or more cards already exist by front text in this deck.'}), 409
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/<int:deck_id>/cards/<int:card_id>', methods=['DELETE'])
def delete_shared_deck_card(deck_id, card_id):
    """Delete one card from one owned shared deck."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err
        family_id_int = get_current_family_id_int()
        if family_id_int is None:
            if not current_family_id():
                return jsonify({'error': 'Family login required'}), 401
            return jsonify({'error': 'Invalid family id in session'}), 400

        conn = None
        try:
            conn = get_shared_decks_connection()
            deck_row = get_shared_deck_owned_by_family(conn, deck_id, family_id_int)
            if not deck_row:
                return jsonify({'error': 'Deck not found'}), 404
            behavior_type = get_shared_deck_behavior_type_from_raw_tags(conn, deck_row[2])
            if behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_IV:
                return jsonify({'error': 'type_iv decks are immutable and do not support card edits'}), 400

            card_row = conn.execute(
                "SELECT id FROM cards WHERE id = ? AND deck_id = ? LIMIT 1",
                [card_id, deck_id]
            ).fetchone()
            if not card_row:
                return jsonify({'error': 'Card not found'}), 404

            conn.execute(
                "DELETE FROM cards WHERE id = ? AND deck_id = ?",
                [card_id, deck_id]
            )
            card_count = int(conn.execute(
                "SELECT COUNT(*) FROM cards WHERE deck_id = ?",
                [deck_id]
            ).fetchone()[0] or 0)
        finally:
            if conn is not None:
                conn.close()

        return jsonify({
            'deleted': True,
            'deck_id': int(deck_id),
            'card_id': int(card_id),
            'card_count': card_count,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/<int:deck_id>/cards/replace', methods=['PUT'])
def replace_shared_deck_cards(deck_id):
    """Replace all cards in one owned shared deck with a new set, using key-aware diff."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err
        family_id_int = get_current_family_id_int()
        if family_id_int is None:
            if not current_family_id():
                return jsonify({'error': 'Family login required'}), 401
            return jsonify({'error': 'Invalid family id in session'}), 400

        conn = None
        try:
            conn = get_shared_decks_connection()
            deck_row = get_shared_deck_owned_by_family(conn, deck_id, family_id_int)
            if not deck_row:
                return jsonify({'error': 'Deck not found'}), 404
            behavior_type = get_shared_deck_behavior_type_from_raw_tags(conn, deck_row[2])
            if behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_IV:
                return jsonify({'error': 'type_iv decks are immutable and do not support card edits'}), 400

            chinese_type_i = is_shared_deck_chinese_type_i(conn, deck_row[2])
            chinese_back_content = (
                get_shared_deck_chinese_back_content(conn, deck_row[2])
                if chinese_type_i
                else ''
            )
            payload = request.get_json(silent=True) or {}
            new_cards = normalize_shared_deck_cards(payload.get('cards'), allow_empty_back=chinese_type_i)

            if chinese_type_i and chinese_back_content:
                for card in new_cards:
                    if not card['back']:
                        card['back'] = build_chinese_auto_back_text(card['front'], chinese_back_content)

            dedupe_key = get_shared_deck_dedupe_key(conn, deck_row[2])
            new_cards = (
                dedupe_shared_deck_cards_by_back(new_cards)
                if dedupe_key == 'back'
                else dedupe_shared_deck_cards_by_front(new_cards)
            )

            existing_rows = conn.execute(
                "SELECT id, front, back FROM cards WHERE deck_id = ? ORDER BY id ASC",
                [deck_id]
            ).fetchall()

            old_by_key = {}
            for row in existing_rows:
                card_id = int(row[0])
                front = str(row[1] or '')
                back = str(row[2] or '')
                k = back if dedupe_key == 'back' else front
                old_by_key[k] = {'id': card_id, 'front': front, 'back': back}

            added = 0
            updated = 0
            removed = 0
            seen_keys = set()

            for card in new_cards:
                front = str(card.get('front') or '')
                back = str(card.get('back') or '')
                k = back if dedupe_key == 'back' else front
                seen_keys.add(k)
                old = old_by_key.get(k)
                if old is None:
                    conn.execute(
                        "INSERT INTO cards (deck_id, front, back) VALUES (?, ?, ?)",
                        [deck_id, front, back]
                    )
                    added += 1
                else:
                    value_field = 'front' if dedupe_key == 'back' else 'back'
                    old_value = old[value_field]
                    new_value = front if dedupe_key == 'back' else back
                    if old_value != new_value:
                        conn.execute(
                            f"UPDATE cards SET {value_field} = ? WHERE id = ? AND deck_id = ?",
                            [new_value, old['id'], deck_id]
                        )
                        updated += 1

            for k, old in old_by_key.items():
                if k not in seen_keys:
                    conn.execute(
                        "DELETE FROM cards WHERE id = ? AND deck_id = ?",
                        [old['id'], deck_id]
                    )
                    removed += 1

            card_count = int(conn.execute(
                "SELECT COUNT(*) FROM cards WHERE deck_id = ?",
                [deck_id]
            ).fetchone()[0] or 0)
        finally:
            if conn is not None:
                conn.close()

        return jsonify({
            'deck_id': int(deck_id),
            'added': added,
            'updated': updated,
            'removed': removed,
            'card_count': card_count,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks/<int:deck_id>', methods=['DELETE'])
def delete_shared_deck(deck_id):
    """Delete one owned shared deck and all of its cards."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err
        pwd_err = require_critical_password()
        if pwd_err:
            return pwd_err
        family_id_int = get_current_family_id_int()
        if family_id_int is None:
            if not current_family_id():
                return jsonify({'error': 'Family login required'}), 401
            return jsonify({'error': 'Invalid family id in session'}), 400

        with _SHARED_DECK_MUTATION_LOCK:
            conn = None
            try:
                conn = get_shared_decks_connection()
                deck_row = get_shared_deck_owned_by_family(conn, deck_id, family_id_int)
                if not deck_row:
                    return jsonify({'error': 'Deck not found'}), 404
                # Keep delete simple in autocommit mode: remove dependent shared rows,
                # then delete the deck shell.
                conn.execute("DELETE FROM deck_generator_definition WHERE deck_id = ?", [deck_id])
                conn.execute("DELETE FROM cards WHERE deck_id = ?", [deck_id])
                conn.execute("DELETE FROM deck WHERE deck_id = ? AND creator_family_id = ?", [deck_id, family_id_int])
            finally:
                if conn is not None:
                    conn.close()

        return jsonify({
            'deleted': True,
            'deck_id': int(deck_id),
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/shared-decks', methods=['POST'])
def create_shared_deck():
    """Create one shared deck and immutable cards for each provided pair."""
    try:
        auth_err = require_super_family()
        if auth_err:
            return auth_err
        family_id = current_family_id()
        payload = request.get_json() or {}

        try:
            family_id_int = int(family_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid family id in session'}), 400

        with _SHARED_DECK_MUTATION_LOCK:
            conn = None
            try:
                conn = get_shared_decks_connection()
                allowed_first_tags = get_allowed_shared_deck_first_tags(conn)
                tags, comments_by_tag = build_shared_deck_tags(
                    payload.get('firstTag'),
                    payload.get('extraTags'),
                    allowed_first_tags=allowed_first_tags,
                    include_comments=True,
                )
                prefix_conflict_tags = find_shared_deck_tag_prefix_conflict(conn, tags)
                if prefix_conflict_tags:
                    raise ValueError(
                        'Tag path conflicts with existing deck path '
                        f'{format_shared_deck_tag_path(prefix_conflict_tags)}. '
                        'Nested tag paths are not allowed.'
                    )
                behavior_type = get_shared_deck_behavior_type_from_raw_tags(conn, tags)
                is_type_iv = behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_IV
                if is_type_iv:
                    display_label = normalize_type_iv_display_label(payload.get('displayLabel'))
                    generator_code = normalize_type_iv_generator_code(payload.get('generatorCode'))
                    is_multichoice_only = normalize_type_iv_multichoice_only(
                        payload.get('isMultichoiceOnly'),
                        default=False,
                    )
                    label_conflict = find_shared_type_iv_representative_label_conflict(
                        conn,
                        tags[0],
                        display_label,
                    )
                    if label_conflict:
                        return jsonify({
                            'error': (
                                'Representative label already exists in this category: '
                                f"{label_conflict['deck_name']}"
                            ),
                            'existing_deck_id': int(label_conflict['deck_id']),
                            'existing_deck_name': str(label_conflict['deck_name']),
                        }), 409
                    preview_type4_generator(generator_code, sample_count=1)
                    cards = [{'front': display_label, 'back': ''}]
                else:
                    dedupe_by_back = behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_II
                    category_meta = (
                        get_shared_deck_category_meta_by_key().get(tags[0])
                        or {}
                    )
                    chinese_type_i = (
                        behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_I
                        and bool(category_meta.get('has_chinese_specific_logic'))
                    )
                    chinese_back_content = (
                        normalize_chinese_back_content(category_meta.get('chinese_back_content'))
                        if chinese_type_i
                        else ''
                    )
                    cards = normalize_shared_deck_cards(
                        payload.get('cards'), allow_empty_back=chinese_type_i
                    )
                    if chinese_type_i and chinese_back_content:
                        for card in cards:
                            if not card['back']:
                                card['back'] = build_chinese_auto_back_text(
                                    card['front'], chinese_back_content
                                )
                    cards = (
                        dedupe_shared_deck_cards_by_back(cards)
                        if dedupe_by_back
                        else dedupe_shared_deck_cards_by_front(cards)
                    )
                deck_name = '_'.join(tags)
                storage_tags = [
                    format_shared_deck_tag_display_label(tag, comments_by_tag.get(tag))
                    for tag in tags
                ]

                conn.execute("BEGIN TRANSACTION")
                deck_row = conn.execute(
                    """
                    INSERT INTO deck (name, tags, creator_family_id)
                    VALUES (?, ?, ?)
                    RETURNING deck_id, created_at
                    """,
                    [deck_name, storage_tags, family_id_int]
                ).fetchone()
                deck_id = int(deck_row[0])
                created_at = deck_row[1].isoformat() if deck_row and deck_row[1] else None

                conn.executemany(
                    """
                    INSERT INTO cards (deck_id, front, back)
                    VALUES (?, ?, ?)
                    """,
                    [[deck_id, card['front'], card['back']] for card in cards]
                )
                if is_type_iv:
                    conn.execute(
                        """
                        INSERT INTO deck_generator_definition (deck_id, code, is_multichoice_only)
                        VALUES (?, ?, ?)
                        """,
                        [deck_id, generator_code, bool(is_multichoice_only)],
                    )
                conn.execute("COMMIT")
            except Exception:
                if conn is not None:
                    try:
                        conn.execute("ROLLBACK")
                    except Exception:
                        pass
                raise
            finally:
                if conn is not None:
                    conn.close()

        return jsonify({
            'created': True,
            'deck': {
                'deck_id': deck_id,
                'name': deck_name,
                'tags': tags,
                'creator_family_id': family_id_int,
                'created_at': created_at,
                'behavior_type': behavior_type,
            },
            'cards_added': len(cards),
        }), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        err = str(e).lower()
        if 'unique' in err and 'name' in err:
            return jsonify({'error': 'Deck name already exists. Please choose different tags.'}), 409
        if 'unique' in err and 'front' in err:
            return jsonify({'error': 'Shared deck DB schema mismatch on card uniqueness. Expected UNIQUE(deck_id, front).'}), 409
        return jsonify({'error': str(e)}), 500


