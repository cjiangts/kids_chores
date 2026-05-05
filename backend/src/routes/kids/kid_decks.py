"""Per-kid card and deck routes (personal + shared opt-in/out)."""
from src.routes.kids import *  # noqa: F401,F403  -- pulls in kids_bp + helpers/state

@kids_bp.route('/kids/<kid_id>/cards', methods=['GET'])
def get_cards(kid_id):
    """Get all Chinese-character cards from the current merged practice source pool."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        category_key = resolve_kid_type_i_chinese_category_key(
            kid,
            request.args.get('categoryKey'),
            allow_default=True,
        )

        conn = get_kid_connection_for(kid)
        try:
            orphan_deck_id = get_or_create_category_orphan_deck(conn, category_key)
            sources = get_shared_type_i_merged_source_decks_for_kid(
                conn,
                kid,
                category_key,
            )
            deck_ids = [
                int(src['local_deck_id'])
                for src in sources
                if bool(src.get('included_in_queue'))
            ]

            cards = get_cards_with_stats_for_deck_ids(conn, deck_ids)
        finally:
            conn.close()

        card_list = [map_card_row(card, {}) for card in cards]

        return jsonify({'category_key': category_key, 'deck_id': orphan_deck_id, 'cards': card_list}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/cards', methods=['POST'])
def add_card(kid_id):
    """Add a new card for a kid"""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        data = request.get_json()

        front = str(data.get('front') or '').strip()
        if not front:
            return jsonify({'error': 'Front text is required'}), 400

        category_key = resolve_kid_type_i_chinese_category_key(
            kid,
            data.get('categoryKey') or request.args.get('categoryKey'),
            allow_default=True,
        )
        chinese_back_content = get_category_chinese_back_content(category_key)

        back = str(data.get('back') or '').strip()
        if not back and chinese_back_content:
            back = build_chinese_auto_back_text(front, chinese_back_content)

        conn = get_kid_connection_for(kid)
        try:
            deck_id = get_or_create_category_orphan_deck(conn, category_key)
            source_decks = get_shared_type_i_merged_source_decks_for_kid(
                conn,
                kid,
                category_key,
            )
            source_deck_ids = [int(src['local_deck_id']) for src in source_decks]
            existing_fronts = {
                str(value or '').strip()
                for value in get_kid_card_fronts_for_deck_ids(conn, source_deck_ids)
            }
            if front in existing_fronts:
                return jsonify({'error': 'This Chinese character already exists in the card bank'}), 400

            card_id = conn.execute(
                """
                INSERT INTO cards (deck_id, front, back)
                VALUES (?, ?, ?)
                RETURNING id
                """,
                [
                    deck_id,
                    front,
                    back
                ]
            ).fetchone()[0]

            card = conn.execute(
                """
                SELECT id, deck_id, front, back, created_at
                FROM cards
                WHERE id = ?
                """,
                [card_id]
            ).fetchone()
        finally:
            conn.close()

        card_obj = {
            'id': card[0],
            'deck_id': card[1],
            'front': card[2],
            'back': card[3],
            'created_at': card[4].isoformat() if card[4] else None,
            'category_key': category_key,
        }

        return jsonify(card_obj), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/cards/bulk', methods=['POST'])
def add_cards_bulk(kid_id):
    """Add multiple cards at once"""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        data = request.get_json()
        items = data.get('cards', [])

        if not items:
            return jsonify({'error': 'No cards provided'}), 400

        category_key = resolve_kid_type_i_chinese_category_key(
            kid,
            data.get('categoryKey') or request.args.get('categoryKey'),
            allow_default=True,
        )
        chinese_back_content = get_category_chinese_back_content(category_key)

        conn = get_kid_connection_for(kid)
        try:
            deck_id = get_or_create_category_orphan_deck(conn, category_key)
            source_decks = get_shared_type_i_merged_source_decks_for_kid(
                conn,
                kid,
                category_key,
            )
            source_deck_ids = [int(src['local_deck_id']) for src in source_decks]
            existing_fronts = {
                str(value or '').strip()
                for value in get_kid_card_fronts_for_deck_ids(conn, source_deck_ids)
            }

            created = []
            skipped_existing_count = 0
            skipped_existing_cards = []
            for item in items:
                front = (item.get('front') or '').strip()
                if not front:
                    continue
                if front in existing_fronts:
                    skipped_existing_count += 1
                    skipped_existing_cards.append(front)
                    continue
                existing_fronts.add(front)

                back = str(item.get('back') or '').strip()
                if not back and chinese_back_content:
                    back = build_chinese_auto_back_text(front, chinese_back_content)

                card_id = conn.execute(
                    "INSERT INTO cards (deck_id, front, back) VALUES (?, ?, ?) RETURNING id",
                    [deck_id, front, back]
                ).fetchone()[0]
                created.append({'id': card_id, 'front': front})
        finally:
            conn.close()

        return jsonify({
            'created': len(created),
            'skipped_existing_count': skipped_existing_count,
            'skipped_existing_cards': skipped_existing_cards,
            'cards': created,
            'category_key': category_key,
        }), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/cards/<card_id>', methods=['DELETE'])
def delete_card(kid_id, card_id):
    """Delete one type-I orphan card."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        category_key = resolve_kid_type_i_chinese_category_key(
            kid,
            request.args.get('categoryKey'),
            allow_default=True,
        )

        conn = get_kid_connection_for(kid)
        try:
            deck_id = get_or_create_category_orphan_deck(conn, category_key)
            row = conn.execute(
                """
                SELECT c.id
                FROM cards c
                WHERE c.id = ? AND c.deck_id = ?
                LIMIT 1
                """,
                [card_id, deck_id]
            ).fetchone()
            if not row:
                return jsonify({'error': 'Card not found'}), 404

            practiced_count = int(conn.execute(
                "SELECT COUNT(*) FROM session_results WHERE card_id = ?",
                [card_id]
            ).fetchone()[0] or 0)
            if practiced_count > 0:
                return jsonify({'error': 'Cards with practice history cannot be deleted'}), 400

            remove_cards_from_type2_chinese_print_sheets(conn, [card_id])
            delete_card_from_deck_internal(conn, card_id)
        finally:
            conn.close()

        return jsonify({
            'category_key': category_key,
            'card_id': int(card_id),
            'deleted': True,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/<scope>/shared-decks', methods=['GET'])
def get_kid_shared_decks_by_scope(kid_id, scope):
    """Get shared decks for one category scope."""
    return dispatch_shared_deck_scope_operation(scope, SHARED_DECK_OP_GET, kid_id)


@kids_bp.route('/kids/<kid_id>/<scope>/shared-decks/opt-in', methods=['POST'])
def opt_in_kid_shared_decks_by_scope(kid_id, scope):
    """Opt-in shared decks for one category scope."""
    return dispatch_shared_deck_scope_operation(scope, SHARED_DECK_OP_OPT_IN, kid_id)


@kids_bp.route('/kids/<kid_id>/<scope>/shared-decks/opt-out', methods=['POST'])
def opt_out_kid_shared_decks_by_scope(kid_id, scope):
    """Opt-out shared decks for one category scope."""
    return dispatch_shared_deck_scope_operation(scope, SHARED_DECK_OP_OPT_OUT, kid_id)


@kids_bp.route('/kids/<kid_id>/<scope>/shared-decks/cards', methods=['GET'])
def get_kid_shared_deck_cards_by_scope(kid_id, scope):
    """Get merged shared deck cards for one category scope."""
    return dispatch_shared_deck_scope_operation(scope, SHARED_DECK_OP_GET_CARDS, kid_id)


@kids_bp.route('/kids/<kid_id>/<scope>/shared-decks/cards/<card_id>/skip', methods=['PUT'])
def update_kid_shared_deck_card_skip_by_scope(kid_id, scope, card_id):
    """Update shared-deck card skip status for one category scope."""
    return dispatch_shared_deck_scope_operation(scope, SHARED_DECK_OP_SKIP_UPDATE, kid_id, card_id=card_id)


@kids_bp.route('/kids/<kid_id>/<scope>/shared-decks/cards/skip-bulk', methods=['PUT'])
def update_kid_shared_deck_card_skip_bulk_by_scope(kid_id, scope):
    """Bulk update shared-deck card skip status for one category scope."""
    return dispatch_shared_deck_scope_operation(scope, SHARED_DECK_OP_SKIP_UPDATE_BULK, kid_id)


@kids_bp.route('/kids/<kid_id>/<scope>/decks', methods=['GET'])
def get_kid_decks_by_scope(kid_id, scope):
    """Get practice readiness deck summary for one category scope."""
    return dispatch_shared_deck_scope_operation(scope, SHARED_DECK_OP_GET_DECKS, kid_id)


@kids_bp.route('/kids/<kid_id>/type4/shared-decks/cards/<card_id>/generator-preview', methods=['POST'])
def preview_type4_generator_for_card(kid_id, card_id):
    """Run one opted-in type-IV deck generator and return fresh example rows."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        category_key, _ = resolve_kid_type_iv_category_with_mode(
            kid,
            (request.get_json(silent=True) or {}).get('categoryKey') or request.args.get('categoryKey'),
        )
        try:
            card_id_int = int(card_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid card id'}), 400
        if card_id_int <= 0:
            return jsonify({'error': 'Invalid card id'}), 400

        conn = get_kid_connection_for(kid, read_only=True)
        try:
            card_row = conn.execute(
                """
                SELECT c.id, c.front, c.deck_id
                FROM cards c
                WHERE c.id = ?
                LIMIT 1
                """,
                [card_id_int],
            ).fetchone()
            if not card_row:
                return jsonify({'error': 'Card not found'}), 404

            local_deck_id = int(card_row[2] or 0)
            materialized_by_local_id = get_kid_materialized_shared_decks_by_first_tag(
                conn,
                category_key,
            )
            source_entry = materialized_by_local_id.get(local_deck_id)
            shared_deck_id = int(source_entry.get('shared_deck_id') or 0) if source_entry else 0
        finally:
            conn.close()

        if shared_deck_id <= 0:
            representative_front = str(card_row[1] or '').strip()
            if representative_front:
                generator_details_by_front = build_type_iv_generator_details_by_representative_front(category_key)
                shared_deck_id = int(
                    (generator_details_by_front.get(representative_front) or {}).get('shared_deck_id') or 0
                )

        if shared_deck_id <= 0:
            return jsonify({'error': 'Shared generator deck not found for this card'}), 404

        shared_conn = get_shared_decks_connection(read_only=True)
        try:
            generator_definition = get_shared_deck_generator_definition(shared_conn, shared_deck_id)
        finally:
            shared_conn.close()
        if not generator_definition or not str(generator_definition.get('code') or '').strip():
            return jsonify({'error': 'Generator definition not found for this deck'}), 404

        seed_base = int(time.time_ns() % 2_000_000_000)
        samples, has_validate = preview_type4_generator(
            generator_definition.get('code'),
            sample_count=1,
            seed_base=seed_base,
        )
        return jsonify({
            'card_id': card_id_int,
            'shared_deck_id': shared_deck_id,
            'representative_label': str(card_row[1] or ''),
            'code': str(generator_definition.get('code') or ''),
            'samples': samples,
            'has_validate': has_validate,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type4/shared-decks/daily-targets', methods=['PUT'])
def update_type4_shared_deck_daily_targets(kid_id):
    """Update per-deck daily target counts for one opted-in type-IV category."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload = request.get_json() or {}
        category_key, _ = resolve_kid_type_iv_category_with_mode(
            kid,
            payload.get('categoryKey') or request.args.get('categoryKey'),
        )
        raw_counts = payload.get('dailyCountsByDeckId')
        if raw_counts is None:
            raw_counts = payload.get('daily_counts_by_deck_id')
        daily_counts_by_shared_deck_id = normalize_type_iv_daily_counts_payload(raw_counts)
        raw_orphan_daily_target_count = payload.get('orphanDailyTargetCount')
        if raw_orphan_daily_target_count is None and 'orphan_daily_target_count' in payload:
            raw_orphan_daily_target_count = payload.get('orphan_daily_target_count')
        orphan_daily_target_count = None
        if raw_orphan_daily_target_count is not None:
            try:
                orphan_daily_target_count = max(0, min(1000, int(raw_orphan_daily_target_count)))
            except (TypeError, ValueError):
                return jsonify({'error': 'orphanDailyTargetCount must be an integer between 0 and 1000'}), 400

        conn = get_kid_connection_for(kid)
        try:
            materialized_by_local_id = get_kid_materialized_shared_decks_by_first_tag(
                conn,
                category_key,
            )
            local_by_shared_id = {
                int(entry['shared_deck_id']): int(entry['local_deck_id'])
                for entry in materialized_by_local_id.values()
            }
            invalid_shared_ids = [
                int(shared_deck_id)
                for shared_deck_id in daily_counts_by_shared_deck_id.keys()
                if shared_deck_id not in local_by_shared_id
            ]
            if invalid_shared_ids:
                return jsonify({
                    'error': (
                        'dailyCountsByDeckId includes deck(s) that are not currently opted in: '
                        f'{", ".join(str(v) for v in invalid_shared_ids)}'
                    )
                }), 400

            updated = []
            for shared_deck_id, local_deck_id in local_by_shared_id.items():
                next_daily_count = int(daily_counts_by_shared_deck_id.get(shared_deck_id, 0))
                conn.execute(
                    "UPDATE decks SET daily_target_count = ? WHERE id = ?",
                    [next_daily_count, local_deck_id]
                )
                updated.append({
                    'shared_deck_id': int(shared_deck_id),
                    'deck_id': int(local_deck_id),
                    'daily_target_count': int(next_daily_count),
                })
            orphan_daily_target_saved = None
            orphan_deck_name = get_category_orphan_deck_name(category_key)
            orphan_row = conn.execute(
                "SELECT id, COALESCE(daily_target_count, 0) FROM decks WHERE name = ? LIMIT 1",
                [orphan_deck_name],
            ).fetchone()
            if orphan_row and int(orphan_row[0] or 0) > 0:
                orphan_deck_id = int(orphan_row[0] or 0)
                if orphan_daily_target_count is not None:
                    conn.execute(
                        "UPDATE decks SET daily_target_count = ? WHERE id = ?",
                        [int(orphan_daily_target_count), orphan_deck_id],
                    )
                    orphan_daily_target_saved = int(orphan_daily_target_count)
                else:
                    orphan_daily_target_saved = int(orphan_row[1] or 0)
            include_orphan_in_queue = get_category_include_orphan_for_kid(kid, category_key)
            session_card_count = int(sum(item['daily_target_count'] for item in updated))
            if include_orphan_in_queue and orphan_daily_target_saved is not None:
                session_card_count += int(orphan_daily_target_saved)
        finally:
            conn.close()

        return jsonify({
            'updated': True,
            'category_key': category_key,
            'updated_count': len(updated),
            'session_card_count': session_card_count,
            'daily_counts_by_deck_id': {
                str(item['shared_deck_id']): int(item['daily_target_count'])
                for item in updated
            },
            'orphan_daily_target_count': orphan_daily_target_saved,
            'decks': updated,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


