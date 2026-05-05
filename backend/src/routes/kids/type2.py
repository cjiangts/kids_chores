"""Type II writing routes — cards, audio, chinese-print-sheets."""
from src.routes.kids import *  # noqa: F401,F403  -- pulls in kids_bp + helpers/state

@kids_bp.route('/kids/<kid_id>/type2/cards', methods=['GET'])
def get_writing_cards(kid_id):
    """Get merged type-II cards across opted-in shared decks (+ optional orphan queue)."""
    return get_shared_type2_cards(kid_id)


@kids_bp.route('/kids/<kid_id>/type2/cards', methods=['POST'])
def add_writing_cards(kid_id):
    """Add one type-II orphan card from provided prompt/answer text."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload = request.get_json(silent=True) or {}
        category_key, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            payload.get('categoryKey') or request.args.get('categoryKey'),
        )
        if has_chinese_specific_logic:
            answer_text = (
                payload.get('characters')
                or payload.get('text')
                or request.form.get('characters')
                or request.form.get('text')
                or ''
            )
            answer_text = str(answer_text).strip()
            if len(answer_text) == 0:
                return jsonify({'error': 'Please provide answer text'}), 400
            card_front = answer_text
            card_back = answer_text
        else:
            front_text = (
                payload.get('front')
                or payload.get('text')
                or request.form.get('front')
                or request.form.get('text')
                or ''
            )
            back_text = (
                payload.get('back')
                or request.form.get('back')
                or ''
            )
            front_text = str(front_text).strip()
            back_text = str(back_text).strip() or front_text
            if len(front_text) == 0:
                return jsonify({'error': 'Please provide card front text'}), 400
            card_front = front_text
            card_back = back_text

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_category_orphan_deck(conn, category_key)

        source_decks = get_shared_type_ii_merged_source_decks_for_kid(
            conn,
            kid,
            category_key,
        )
        source_deck_ids = [int(src['local_deck_id']) for src in source_decks]
        existing_values = {
            str(value or '').strip()
            for value in (
                get_kid_card_backs_for_deck_ids(conn, source_deck_ids)
                if has_chinese_specific_logic
                else get_kid_card_fronts_for_deck_ids(conn, source_deck_ids)
            )
        }
        dedupe_value = (
            str(card_back or '').strip()
            if has_chinese_specific_logic
            else str(card_front or '').strip()
        )
        if dedupe_value in existing_values:
            conn.close()
            return jsonify({
                'error': (
                    'This Chinese writing answer already exists in the card bank'
                    if has_chinese_specific_logic
                    else 'This type-II prompt already exists in the card bank'
                )
            }), 400

        row = conn.execute(
            """
            INSERT INTO cards (deck_id, front, back)
            VALUES (?, ?, ?)
            RETURNING id, deck_id, front, back, created_at
            """,
            [deck_id, card_front, card_back]
        ).fetchone()

        conn.close()
        audio_meta = build_writing_prompt_audio_payload(
            kid_id,
            row[2],
            category_key=category_key,
            has_chinese_specific_logic=has_chinese_specific_logic,
        )
        return jsonify({
            'category_key': category_key,
            'deck_id': deck_id,
            'inserted_count': 1,
            'cards': [{
                'id': row[0],
                'deck_id': row[1],
                'front': row[2],
                'back': row[3],
                'created_at': row[4].isoformat() if row[4] else None,
                'audio_file_name': audio_meta['audio_file_name'],
                'audio_mime_type': audio_meta['audio_mime_type'],
                'audio_url': audio_meta['audio_url'],
                'prompt_audio_url': audio_meta['prompt_audio_url'],
            }]
        }), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type2/cards/<card_id>', methods=['PUT'])
def update_writing_card(kid_id, card_id):
    """Update one type-II card front text (voice prompt source)."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        data = request.get_json(silent=True) or {}
        category_key, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            data.get('categoryKey') or request.args.get('categoryKey'),
        )
        next_front = str(data.get('front') or '').strip()
        if not next_front:
            return jsonify({'error': 'front is required'}), 400

        conn = get_kid_connection_for(kid)
        source_decks = get_shared_type_ii_merged_source_decks_for_kid(
            conn,
            kid,
            category_key,
        )
        source_deck_ids = [int(src['local_deck_id']) for src in source_decks]
        if len(source_deck_ids) == 0:
            conn.close()
            return jsonify({'error': 'Writing card not found'}), 404
        placeholders = ','.join(['?'] * len(source_deck_ids))
        row = conn.execute(
            f"""
            SELECT id, deck_id, front, back, COALESCE(skip_practice, FALSE), hardness_score, created_at
            FROM cards
            WHERE id = ? AND deck_id IN ({placeholders})
            LIMIT 1
            """,
            [card_id, *source_deck_ids]
        ).fetchone()
        if not row:
            conn.close()
            return jsonify({'error': 'Writing card not found'}), 404

        old_front = str(row[2] or '')
        card_back = str(row[3] or '')
        if old_front != next_front:
            conn.execute(
                "UPDATE cards SET front = ? WHERE id = ?",
                [next_front, row[0]]
            )
        conn.close()

        old_file_name = build_shared_writing_audio_file_name(old_front)
        new_audio_meta = build_writing_prompt_audio_payload(
            kid_id,
            next_front,
            category_key=category_key,
            has_chinese_specific_logic=has_chinese_specific_logic,
        )
        kept_file_names = {
            build_shared_writing_audio_file_name(next_front),
            build_shared_writing_audio_file_name(card_back),
        }
        kept_file_names.discard('')
        if old_file_name and old_file_name not in kept_file_names:
            old_audio_path = os.path.join(get_shared_writing_audio_dir(), old_file_name)
            if os.path.exists(old_audio_path):
                try:
                    os.remove(old_audio_path)
                except OSError:
                    pass

        return jsonify({
            'category_key': category_key,
            'id': int(row[0]),
            'deck_id': int(row[1]),
            'front': next_front,
            'back': card_back,
            'skip_practice': bool(row[4]),
            'hardness_score': float(row[5] if row[5] is not None else 0),
            'created_at': row[6].isoformat() if row[6] else None,
            'audio_file_name': new_audio_meta.get('audio_file_name'),
            'audio_mime_type': new_audio_meta.get('audio_mime_type'),
            'audio_url': new_audio_meta.get('audio_url'),
            'prompt_audio_url': new_audio_meta.get('prompt_audio_url'),
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type2/cards/bulk', methods=['POST'])
def add_writing_cards_bulk(kid_id):
    """Bulk-add type-II orphan cards."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload = request.get_json() or {}
        category_key, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            payload.get('categoryKey') or request.args.get('categoryKey'),
        )
        raw_text = payload.get('text', '')
        rows_to_insert = split_type2_bulk_rows(raw_text, has_chinese_specific_logic)
        if len(rows_to_insert) == 0:
            return jsonify({
                'error': (
                    'Please paste at least one Chinese word/phrase'
                    if has_chinese_specific_logic
                    else 'Please paste at least one non-empty line'
                )
            }), 400

        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_category_orphan_deck(conn, category_key)
        source_decks = get_shared_type_ii_merged_source_decks_for_kid(
            conn,
            kid,
            category_key,
        )
        source_deck_ids = [int(src['local_deck_id']) for src in source_decks]
        existing_set = {
            str(value or '').strip()
            for value in (
                get_kid_card_backs_for_deck_ids(conn, source_deck_ids)
                if has_chinese_specific_logic
                else get_kid_card_fronts_for_deck_ids(conn, source_deck_ids)
            )
        }

        created = []
        skipped_existing = 0
        skipped_existing_cards = []
        for front_text, back_text in rows_to_insert:
            dedupe_value = (
                str(back_text or '').strip()
                if has_chinese_specific_logic
                else str(front_text or '').strip()
            )
            if not dedupe_value:
                continue
            if dedupe_value in existing_set:
                skipped_existing += 1
                skipped_existing_cards.append(
                    format_type2_bulk_card_text(front_text, back_text, has_chinese_specific_logic)
                )
                continue

            row = conn.execute(
                """
                INSERT INTO cards (deck_id, front, back)
                VALUES (?, ?, ?)
                RETURNING id, deck_id, front, back, created_at
                """,
                [deck_id, front_text, back_text]
            ).fetchone()
            existing_set.add(dedupe_value)
            audio_meta = build_writing_prompt_audio_payload(
                kid_id,
                front_text,
                category_key=category_key,
                has_chinese_specific_logic=has_chinese_specific_logic,
            )
            created.append({
                'id': int(row[0]),
                'deck_id': int(row[1]),
                'front': row[2],
                'back': row[3],
                'created_at': row[4].isoformat() if row[4] else None,
                'audio_file_name': audio_meta['audio_file_name'],
                'audio_mime_type': audio_meta['audio_mime_type'],
                'audio_url': audio_meta['audio_url'],
                'prompt_audio_url': audio_meta['prompt_audio_url'],
            })

        conn.close()
        return jsonify({
            'category_key': category_key,
            'deck_id': deck_id,
            'input_token_count': len(rows_to_insert),
            'inserted_count': len(created),
            'skipped_existing_count': skipped_existing,
            'skipped_existing_cards': skipped_existing_cards,
            'cards': created
        }), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type2/audio/<path:file_name>', methods=['GET'])
def get_writing_audio(kid_id, file_name):
    """Serve type-II prompt audio file for a kid."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        category_key, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            request.args.get('categoryKey'),
        )
        if file_name != os.path.basename(file_name):
            return jsonify({'error': 'Invalid file name'}), 400

        conn = get_kid_connection_for(kid, read_only=True)
        try:
            # Keep this endpoint read-only. Do not create orphan decks while serving audio.
            materialized_by_local_id = get_kid_materialized_shared_type_ii_decks(conn, category_key)
            source_deck_ids = [
                int(entry['local_deck_id'])
                for entry in materialized_by_local_id.values()
                if int(entry.get('local_deck_id') or 0) > 0
            ]
            include_orphan = get_category_include_orphan_for_kid(kid, category_key)
            if include_orphan:
                orphan_deck_name = get_category_orphan_deck_name(category_key)
                orphan_row = conn.execute(
                    "SELECT id FROM decks WHERE name = ? LIMIT 1",
                    [orphan_deck_name],
                ).fetchone()
                if orphan_row and int(orphan_row[0] or 0) > 0:
                    source_deck_ids.append(int(orphan_row[0]))

            source_deck_ids = sorted(set(source_deck_ids))
            if not source_deck_ids:
                return jsonify({'error': 'Audio file not found'}), 404
            placeholders = ','.join(['?'] * len(source_deck_ids))
            rows = conn.execute(
                f"SELECT front, back FROM cards WHERE deck_id IN ({placeholders})",
                source_deck_ids
            ).fetchall()
        finally:
            conn.close()

        synth_args_by_file_name = {}
        for row in rows:
            front_text = normalize_writing_audio_text(row[0])
            back_text = normalize_writing_audio_text(row[1])
            front_file = build_shared_writing_audio_file_name(front_text)
            if front_file and front_file not in synth_args_by_file_name:
                synth_args_by_file_name[front_file] = {
                    'file_key_text': front_text,
                    'spoken_text': build_writing_front_tts_text(
                        front_text,
                        back_text,
                        has_chinese_specific_logic=has_chinese_specific_logic,
                    ),
                }

        synth_args = synth_args_by_file_name.get(file_name)
        if not synth_args:
            return jsonify({'error': 'Audio file not found'}), 404

        audio_dir = get_shared_writing_audio_dir()
        audio_path = os.path.join(audio_dir, file_name)
        if not os.path.exists(audio_path):
            synthesize_shared_writing_audio(
                synth_args.get('file_key_text'),
                overwrite=False,
                spoken_text=synth_args.get('spoken_text'),
                has_chinese_specific_logic=has_chinese_specific_logic,
            )
            if not os.path.exists(audio_path):
                return jsonify({'error': 'Audio file not found'}), 404

        mime_type = mimetypes.guess_type(file_name)[0] or 'audio/mpeg'
        return send_from_directory(audio_dir, file_name, as_attachment=False, mimetype=mime_type)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/cards/audio/<path:file_name>', methods=['GET'])
def get_type1_chinese_prompt_audio(kid_id, file_name):
    """Serve type-I Chinese multiple-choice prompt audio for a kid."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        category_key = resolve_kid_type_i_chinese_category_key(
            kid,
            request.args.get('categoryKey'),
            allow_default=False,
        )
        if file_name != os.path.basename(file_name):
            return jsonify({'error': 'Invalid file name'}), 400

        conn = get_kid_connection_for(kid, read_only=True)
        try:
            sources = get_shared_type_i_merged_source_decks_for_kid(
                conn,
                kid,
                category_key,
            )
            source_deck_ids = [
                int(source['local_deck_id'])
                for source in sources
                if int(source.get('local_deck_id') or 0) > 0
            ]
            if not source_deck_ids:
                return jsonify({'error': 'Audio file not found'}), 404
            placeholders = ','.join(['?'] * len(source_deck_ids))
            rows = conn.execute(
                f"SELECT front FROM cards WHERE deck_id IN ({placeholders})",
                source_deck_ids,
            ).fetchall()
        finally:
            conn.close()

        synth_args_by_file_name = {}
        for row in rows:
            front_text = normalize_writing_audio_text(row[0])
            front_file = build_shared_type1_prompt_audio_file_name(front_text)
            if front_file and front_file not in synth_args_by_file_name:
                synth_args_by_file_name[front_file] = {
                    'file_key_text': front_text,
                    'spoken_text': front_text,
                }

        synth_args = synth_args_by_file_name.get(file_name)
        if not synth_args:
            return jsonify({'error': 'Audio file not found'}), 404

        audio_dir = get_shared_writing_audio_dir()
        audio_path = os.path.join(audio_dir, file_name)
        if not os.path.exists(audio_path):
            synthesize_shared_writing_audio(
                synth_args.get('file_key_text'),
                overwrite=False,
                spoken_text=synth_args.get('spoken_text'),
                has_chinese_specific_logic=True,
                file_name_builder=build_shared_type1_prompt_audio_file_name,
            )
            if not os.path.exists(audio_path):
                return jsonify({'error': 'Audio file not found'}), 404

        mime_type = mimetypes.guess_type(file_name)[0] or 'audio/mpeg'
        return send_from_directory(audio_dir, file_name, as_attachment=False, mimetype=mime_type)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type2/cards/<card_id>', methods=['DELETE'])
def delete_writing_card(kid_id, card_id):
    """Delete a type-II orphan card and remove its shared generated clip."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        category_key, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            request.args.get('categoryKey'),
        )
        conn = get_kid_connection_for(kid)
        deck_id = get_or_create_category_orphan_deck(conn, category_key)

        row = conn.execute(
            """
            SELECT c.id, c.front, c.back
            FROM cards c
            WHERE c.id = ? AND c.deck_id = ?
            """,
            [card_id, deck_id]
        ).fetchone()
        if not row:
            conn.close()
            return jsonify({'error': 'Writing card not found'}), 404

        practiced_count = int(conn.execute(
            "SELECT COUNT(*) FROM session_results WHERE card_id = ?",
            [card_id]
        ).fetchone()[0] or 0)
        if practiced_count > 0:
            conn.close()
            return jsonify({'error': 'Cards with practice history cannot be deleted'}), 400

        remove_cards_from_type2_chinese_print_sheets(conn, [card_id])
        delete_card_from_deck_internal(conn, card_id)
        conn.close()

        clip_names = {
            build_shared_writing_audio_file_name(row[1]),
            build_shared_writing_audio_file_name(row[2]),
        }
        clip_names.discard('')
        for file_name in clip_names:
            audio_path = os.path.join(get_shared_writing_audio_dir(), file_name)
            if os.path.exists(audio_path):
                try:
                    os.remove(audio_path)
                except OSError:
                    pass

        return jsonify({'message': 'Writing card deleted successfully'}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@kids_bp.route('/kids/<kid_id>/type2/chinese-print-sheets', methods=['POST'])
def create_chinese_print_sheet(kid_id):
    """Persist one custom printable Chinese writing sheet."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload = request.get_json(silent=True) or {}
        category_key, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            payload.get('categoryKey') or request.args.get('categoryKey'),
        )
        if not has_chinese_specific_logic:
            return jsonify({'error': 'Practice sheets are only available for Chinese-specific type-II categories'}), 400

        rows = payload.get('rows')
        if not isinstance(rows, list) or len(rows) == 0:
            return jsonify({'error': 'rows must be a non-empty array'}), 400

        paper_size = str(payload.get('paperSize') or 'us-letter').strip().lower()
        if paper_size not in ('us-letter', 'a4'):
            paper_size = 'us-letter'

        conn = None
        try:
            conn = get_kid_connection_for(kid)
            card_ids = []
            for row in rows:
                if not isinstance(row, dict):
                    return jsonify({'error': 'rows must contain objects'}), 400
                try:
                    card_id = int(row.get('cardId'))
                except (TypeError, ValueError):
                    return jsonify({'error': 'rows must contain valid cardId values'}), 400
                if card_id <= 0:
                    return jsonify({'error': 'rows must contain valid cardId values'}), 400
                if card_id not in card_ids:
                    card_ids.append(card_id)

            source_decks = get_shared_type_ii_merged_source_decks_for_kid(
                conn,
                kid,
                category_key,
            )
            bank_deck_ids = [
                int(src['local_deck_id'])
                for src in source_decks
                if int(src.get('card_count') or 0) > 0
            ]
            if len(bank_deck_ids) == 0:
                return jsonify({'error': 'No writing cards are available for this category'}), 409

            pending_card_ids = get_pending_writing_card_ids(conn)
            pending_card_set = set(pending_card_ids)
            if any(card_id in pending_card_set for card_id in card_ids):
                return jsonify({'error': 'Some selected cards are already practicing in another sheet'}), 409

            candidate_card_set = set(get_writing_candidate_card_ids(
                conn,
                bank_deck_ids,
                category_key,
                excluded_card_ids=pending_card_ids,
            ))
            if any(card_id not in candidate_card_set for card_id in card_ids):
                return jsonify({'error': 'Some selected cards are no longer in the suggested card list'}), 409

            deck_placeholders = ','.join(['?'] * len(bank_deck_ids))
            card_placeholders = ','.join(['?'] * len(card_ids))
            found = conn.execute(
                f"""
                SELECT id, front, back
                FROM cards
                WHERE deck_id IN ({deck_placeholders})
                  AND id IN ({card_placeholders})
                """,
                [*bank_deck_ids, *card_ids],
            ).fetchall()
            found_map = {
                int(row[0]): {'id': int(row[0]), 'front': row[1], 'back': row[2]}
                for row in found
            }
            if len(found_map) != len(card_ids):
                return jsonify({'error': 'Some selected cards are no longer available'}), 409

            layout_rows = []
            for row in rows:
                card_id = int(row.get('cardId'))
                card = found_map.get(card_id)
                if not card:
                    return jsonify({'error': f'Card {card_id} not found'}), 404
                layout_rows.append({
                    'card_id': card_id,
                    'front': card['front'],
                    'back': card['back'],
                    'empty_count': max(1, min(9, int(row.get('emptyCount') or 1))),
                    'scale': round(max(0.5, min(2.0, float(row.get('scale') or 1.0))), 2),
                })

            layout_json = json.dumps({
                'paper_size': paper_size,
                'rows': layout_rows,
            }, ensure_ascii=False, separators=(',', ':'))
            sheet_id = conn.execute(
                """
                INSERT INTO type2_chinese_print_sheets (category_key, layout_json, status)
                VALUES (?, ?, 'pending')
                RETURNING id
                """,
                [category_key, layout_json],
            ).fetchone()[0]
        finally:
            if conn is not None:
                conn.close()

        return jsonify({
            'created': True,
            'sheet_id': int(sheet_id),
            'status': 'pending',
        }), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type2/chinese-print-sheets', methods=['GET'])
def list_chinese_print_sheets(kid_id):
    """List persisted custom printable Chinese writing sheets for one kid/category."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        category_key, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            request.args.get('categoryKey'),
        )
        if not has_chinese_specific_logic:
            return jsonify({'error': 'Practice sheets are only available for Chinese-specific type-II categories'}), 400

        conn = None
        try:
            conn = get_kid_connection_for(kid, read_only=True)
            rows = conn.execute(
                """
                SELECT id, category_key, layout_json, status, created_at, completed_at
                FROM type2_chinese_print_sheets
                WHERE category_key = ?
                ORDER BY created_at DESC, id DESC
                """,
                [category_key],
            ).fetchall()
        finally:
            if conn is not None:
                conn.close()

        sheets = []
        for row in rows:
            layout = {}
            try:
                layout = json.loads(row[2]) if row[2] else {}
            except (json.JSONDecodeError, TypeError):
                pass
            layout_rows = list(layout.get('rows') or [])
            card_labels = []
            for lr in layout_rows:
                label = str(lr.get('back') or lr.get('front') or '')
                if label and label not in card_labels:
                    card_labels.append(label)
            sheets.append({
                'id': int(row[0]),
                'category_key': str(row[1] or ''),
                'status': str(row[3] or 'pending'),
                'created_at': row[4].isoformat() if row[4] else None,
                'completed_at': row[5].isoformat() if row[5] else None,
                'paper_size': str(layout.get('paper_size') or 'us-letter'),
                'row_count': len(layout_rows),
                'card_labels': card_labels,
            })

        return jsonify({'sheets': sheets}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type2/chinese-print-sheets/<int:sheet_id>', methods=['GET'])
def get_chinese_print_sheet_detail(kid_id, sheet_id):
    """Return one persisted Chinese writing sheet with layout for print."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = None
        try:
            conn = get_kid_connection_for(kid, read_only=True)
            row = conn.execute(
                """
                SELECT id, category_key, layout_json, status, created_at, completed_at
                FROM type2_chinese_print_sheets
                WHERE id = ?
                """,
                [sheet_id],
            ).fetchone()
        finally:
            if conn is not None:
                conn.close()

        if not row:
            return jsonify({'error': 'Sheet not found'}), 404

        layout = {}
        try:
            layout = json.loads(row[2]) if row[2] else {}
        except (json.JSONDecodeError, TypeError):
            pass

        kid_name = str(kid.get('name') or '')
        return jsonify({
            'sheet': {
                'id': int(row[0]),
                'category_key': str(row[1] or ''),
                'status': str(row[3] or 'pending'),
                'created_at': row[4].isoformat() if row[4] else None,
                'completed_at': row[5].isoformat() if row[5] else None,
                'kid_name': kid_name,
                'layout': layout,
            },
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type2/chinese-print-sheets/<int:sheet_id>/complete', methods=['POST'])
def complete_chinese_print_sheet(kid_id, sheet_id):
    """Mark one Chinese print sheet as done."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = None
        try:
            conn = get_kid_connection_for(kid)
            row = conn.execute(
                "SELECT id, status FROM type2_chinese_print_sheets WHERE id = ?",
                [sheet_id],
            ).fetchone()
            if not row:
                return jsonify({'error': 'Sheet not found'}), 404
            if str(row[1] or '').strip().lower() != 'done':
                conn.execute(
                    """
                    UPDATE type2_chinese_print_sheets
                    SET status = 'done', completed_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    [sheet_id],
                )
        finally:
            if conn is not None:
                conn.close()

        return jsonify({'sheet_id': int(sheet_id), 'status': 'done'}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type2/chinese-print-sheets/<int:sheet_id>/withdraw', methods=['POST'])
def withdraw_chinese_print_sheet(kid_id, sheet_id):
    """Delete one pending Chinese print sheet."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = None
        try:
            conn = get_kid_connection_for(kid)
            row = conn.execute(
                "SELECT id, status FROM type2_chinese_print_sheets WHERE id = ?",
                [sheet_id],
            ).fetchone()
            if not row:
                return jsonify({'error': 'Sheet not found'}), 404
            status = str(row[1] or '').strip().lower()
            if status == 'done':
                return jsonify({'error': 'Completed sheets cannot be withdrawn'}), 400
            conn.execute("DELETE FROM type2_chinese_print_sheets WHERE id = ?", [sheet_id])
        finally:
            if conn is not None:
                conn.close()

        return jsonify({'sheet_id': int(sheet_id), 'deleted': True}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


