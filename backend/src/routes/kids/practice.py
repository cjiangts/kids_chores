"""Practice session start/complete routes."""
from src.routes.kids import *  # noqa: F401,F403  -- pulls in kids_bp + helpers/state

@kids_bp.route('/kids/<kid_id>/type2/practice/start', methods=['POST'])
def start_writing_practice_session(kid_id):
    """Start a type-II practice session."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload = request.get_json(silent=True) or {}
        category_key, has_chinese_specific_logic = resolve_kid_type_ii_category_with_mode(
            kid,
            payload.get('categoryKey') or request.args.get('categoryKey'),
        )
        practice_mode = normalize_session_practice_mode(payload.get('practiceMode'))
        conn = get_kid_connection_for(kid)
        source_decks = get_shared_type_ii_merged_source_decks_for_kid(
            conn,
            kid,
            category_key,
        )
        included_sources = [src for src in source_decks if bool(src.get('included_in_queue'))]
        source_deck_ids = [
            int(src['local_deck_id'])
            for src in included_sources
            if int(src.get('active_card_count') or 0) > 0
        ]
        source_by_deck_id = {int(src['local_deck_id']): src for src in included_sources}

        pending_card_ids = get_pending_writing_card_ids(conn) if has_chinese_specific_logic else []
        continue_source_session = get_latest_unfinished_session_for_today(conn, kid, category_key)
        is_continue_session = continue_source_session is not None
        retry_source_session = None
        is_retry_session = False
        selected_cards = []
        if is_continue_session:
            practiced_card_ids = get_session_practiced_card_ids(
                conn,
                continue_source_session['session_id'],
            )
            excluded_card_ids = list(set([*pending_card_ids, *practiced_card_ids]))
            missing_count = max(
                0,
                int(continue_source_session['planned_count']) - int(continue_source_session['answer_count']),
            )
            continue_cards = build_continue_selected_cards_for_decks(
                conn,
                kid,
                source_deck_ids,
                category_key,
                missing_count,
                excluded_card_ids=excluded_card_ids,
            )
            selected_cards = []
            for card in continue_cards:
                local_deck_id = int(card.get('deck_id') or 0)
                src = source_by_deck_id.get(local_deck_id) or {}
                selected_cards.append({
                    **card,
                    'shared_deck_id': int(src['shared_deck_id']) if src.get('shared_deck_id') is not None else None,
                    'deck_id': local_deck_id,
                    'deck_name': str(src.get('local_name') or ''),
                    'source_tags': extract_shared_deck_tags_and_labels(src.get('tags') or [])[0],
                    'source_is_orphan': bool(src.get('is_orphan')),
                })
        else:
            retry_source_session = get_latest_retry_source_session_for_today(conn, kid, category_key)
            is_retry_session = retry_source_session is not None
            if is_retry_session:
                retry_wrong_card_ids = get_retry_source_wrong_card_ids(
                    conn,
                    retry_source_session['session_id'],
                )
                selected_cards = build_retry_selected_cards_for_sources(
                    conn,
                    source_by_deck_id,
                    retry_wrong_card_ids,
                )
            else:
                excluded_card_ids = list(set(pending_card_ids))
                writing_session_count = get_category_session_card_count_for_kid(kid, category_key)
                if writing_session_count <= 0:
                    conn.close()
                    return jsonify({
                        'category_key': category_key,
                        'pending_session_id': None,
                        'cards': [],
                        'planned_count': 0,
                        'practice_mode': practice_mode,
                        'is_continue_session': False,
                        'continue_source_session_id': None,
                        'is_retry_session': False,
                    }), 200
                preview_kid = with_preview_session_count_for_category(
                    kid,
                    category_key,
                    writing_session_count,
                )
                cards_by_id, selected_ids = plan_deck_practice_selection_for_decks(
                    conn,
                    preview_kid,
                    source_deck_ids,
                    category_key,
                    excluded_card_ids=excluded_card_ids
                )
                for card_id in selected_ids:
                    card = cards_by_id.get(card_id) or {}
                    local_deck_id = int(card.get('deck_id') or 0)
                    src = source_by_deck_id.get(local_deck_id) or {}
                    selected_cards.append({
                        **card,
                        'shared_deck_id': int(src['shared_deck_id']) if src.get('shared_deck_id') is not None else None,
                        'deck_id': local_deck_id,
                        'deck_name': str(src.get('local_name') or ''),
                        'source_tags': extract_shared_deck_tags_and_labels(src.get('tags') or [])[0],
                        'source_is_orphan': bool(src.get('is_orphan')),
                    })
        if len(selected_cards) == 0:
            conn.close()
            return jsonify({
                'category_key': category_key,
                'pending_session_id': None,
                'cards': [],
                'planned_count': 0,
                'practice_mode': practice_mode,
                'is_continue_session': bool(is_continue_session),
                'continue_source_session_id': (
                    int(continue_source_session['session_id'])
                    if is_continue_session and continue_source_session is not None
                    else None
                ),
                'is_retry_session': bool(is_retry_session),
                'retry_source_session_id': (
                    int(retry_source_session['session_id'])
                    if is_retry_session and retry_source_session is not None
                    else None
                ),
            }), 200

        pending_session_payload = {
            'kind': category_key,
            'planned_count': len(selected_cards),
            'cards': [{'id': int(card['id'])} for card in selected_cards],
            'practice_mode': practice_mode,
        }
        if is_continue_session and continue_source_session is not None:
            pending_session_payload[PENDING_CONTINUE_SOURCE_SESSION_ID_KEY] = int(continue_source_session['session_id'])
        if is_retry_session and retry_source_session is not None:
            pending_session_payload[PENDING_RETRY_SOURCE_SESSION_ID_KEY] = int(retry_source_session['session_id'])

        source_session_id = None
        if is_continue_session and continue_source_session is not None:
            source_session_id = int(continue_source_session['session_id'])
        elif is_retry_session and retry_source_session is not None:
            source_session_id = int(retry_source_session['session_id'])
        if source_session_id is not None:
            pending_session_payload['practice_mode'] = get_session_practice_mode(conn, source_session_id)

        resolved_practice_mode = normalize_session_practice_mode(pending_session_payload.get('practice_mode'))

        pending_session_id = create_pending_session(
            kid_id,
            category_key,
            pending_session_payload,
        )
        conn.close()

        cards_with_audio = []
        for card in selected_cards:
            audio_meta = build_writing_prompt_audio_payload(
                kid_id,
                card.get('front'),
                category_key=category_key,
                has_chinese_specific_logic=has_chinese_specific_logic,
            )
            cards_with_audio.append({
                **card,
                'audio_file_name': audio_meta['audio_file_name'],
                'audio_mime_type': audio_meta['audio_mime_type'],
                'audio_url': audio_meta['audio_url'],
                'prompt_audio_url': audio_meta['prompt_audio_url'],
            })

        return jsonify({
            'category_key': category_key,
            'pending_session_id': pending_session_id,
            'planned_count': len(cards_with_audio),
            'cards': cards_with_audio,
            'practice_mode': resolved_practice_mode,
            'is_continue_session': bool(is_continue_session),
            'continue_source_session_id': (
                int(continue_source_session['session_id'])
                if is_continue_session and continue_source_session is not None
                else None
            ),
            'is_retry_session': bool(is_retry_session),
            'retry_source_session_id': (
                int(retry_source_session['session_id'])
                if is_retry_session and retry_source_session is not None
                else None
            ),
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/cards/practice/start', methods=['POST'])
def start_type1_practice_session(kid_id):
    """Start a merged type-I session from opted-in decks (+ orphan option)."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        payload = request.get_json(silent=True) or {}
        category_key, _ = resolve_kid_type_i_category_with_mode(
            kid,
            payload.get('categoryKey') or request.args.get('categoryKey'),
        )
        parsed_mode = parse_session_practice_mode(payload.get('practiceMode'))
        practice_base = parsed_mode['base']
        drill_requested = parsed_mode['drill']
        session_card_count_override = None
        drill_speed_target_ms = None
        drill_planned_count = None
        if drill_requested:
            category_meta = get_shared_deck_category_meta_by_key().get(category_key) or {}
            is_type_i_non_chinese = (
                normalize_shared_deck_category_behavior(category_meta.get('behavior_type'))
                == DECK_CATEGORY_BEHAVIOR_TYPE_I
                and not bool(category_meta.get('has_chinese_specific_logic'))
            )
            daily_target = int(get_category_session_card_count_for_kid(kid, category_key) or 0)
            if not is_type_i_non_chinese or daily_target < 20:
                drill_requested = False
            else:
                session_card_count_override = DRILL_SESSION_CARD_POOL_SIZE
                drill_planned_count = daily_target
                speed_conn = get_kid_connection_for(kid, read_only=True)
                try:
                    avg_ms = get_kid_subject_avg_correct_response_time_ms(speed_conn, category_key)
                finally:
                    speed_conn.close()
                drill_speed_target_ms = compute_drill_speed_target_ms(avg_ms)
        practice_mode = compose_session_practice_mode(practice_base, drill_requested)
        pending_extras = {'practice_mode': practice_mode}
        if drill_planned_count is not None:
            pending_extras['planned_count'] = drill_planned_count
        response_payload, status_code = start_type_i_practice_session_internal(
            kid_id,
            kid,
            category_key,
            session_card_count_override=session_card_count_override,
            include_multiple_choice_pool_cards=True,
            pending_session_payload_extras=pending_extras,
        )
        if isinstance(response_payload, dict):
            if drill_speed_target_ms is not None:
                response_payload['drill_speed_target_ms'] = drill_speed_target_ms
            if drill_planned_count is not None:
                response_payload['planned_count'] = drill_planned_count
        return jsonify(response_payload), status_code
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type4/practice/start', methods=['POST'])
def start_type4_practice_session(kid_id):
    """Start one generator practice session for an opted-in category."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        payload = request.get_json(silent=True) or {}
        category_key, _ = resolve_kid_type_iv_category_with_mode(
            kid,
            payload.get('categoryKey') or request.args.get('categoryKey'),
        )
        practice_mode = normalize_type_iv_practice_mode(payload.get('practiceMode'))

        conn = get_kid_connection_for(kid)
        try:
            practice_sources = get_type_iv_practice_source_rows(conn, kid, category_key)
            practice_source_by_card_id = {
                int(source.get('representative_card_id') or 0): source
                for source in practice_sources
                if int(source.get('representative_card_id') or 0) > 0
            }
            continue_source_session = get_latest_unfinished_session_for_today(conn, kid, category_key)
            is_continue_session = continue_source_session is not None
            retry_source_session = None
            is_retry_session = False
            pending_items = []
            response_cards = []

            if is_continue_session:
                missing_count = max(
                    0,
                    int(continue_source_session['planned_count']) - int(continue_source_session['answer_count']),
                )
                count_by_source_key = build_type_iv_continue_count_by_source_key(
                    practice_sources,
                    missing_count,
                )
                pending_items, response_cards = build_type_iv_pending_items_for_sources(
                    practice_sources,
                    count_by_source_key,
                    practice_mode,
                )
            else:
                retry_source_session = get_latest_retry_source_session_for_today(conn, kid, category_key)
                is_retry_session = retry_source_session is not None
                if is_retry_session:
                    retry_rows = get_type_iv_retry_source_result_rows(
                        conn,
                        retry_source_session['session_id'],
                        [source.get('representative_card_id') for source in practice_sources],
                    )
                    validate_by_card_id = {}
                    for source in practice_sources:
                        src_card_id = int(source.get('representative_card_id') or 0)
                        if src_card_id <= 0 or src_card_id in validate_by_card_id:
                            continue
                        try:
                            probe = run_type4_generator(source.get('generator_code'), sample_count=1, seed_base=0)
                            if probe and probe[0].get('validate') is not None:
                                validate_by_card_id[src_card_id] = probe[0]['validate']
                        except Exception:
                            pass
                    pending_items = []
                    for row in retry_rows:
                        card_id = int(row['representative_card_id'])
                        item = {
                            'id': int(row['result_id']),
                            'representative_card_id': card_id,
                            'prompt': str(row['prompt'] or ''),
                            'answer': str(row['answer'] or ''),
                            'distractor_answers': [str(d) for d in list(row.get('distractor_answers') or [])],
                            'is_multichoice_only': bool(
                                (practice_source_by_card_id.get(card_id) or {}).get('is_multichoice_only')
                            ),
                            'previous_answers': [str(a) for a in list(row.get('submitted_answers') or []) if str(a or '').strip()],
                            'previous_grades': [int(g) for g in list(row.get('submitted_grades') or [])],
                        }
                        if card_id in validate_by_card_id:
                            item['validate'] = validate_by_card_id[card_id]
                        pending_items.append(item)
                    response_cards = [
                        map_type_iv_pending_item_to_response_card(item, practice_mode)
                        for item in pending_items
                    ]
                else:
                    count_by_source_key = build_type_iv_initial_count_by_source_key(practice_sources)
                    pending_items, response_cards = build_type_iv_pending_items_for_sources(
                        practice_sources,
                        count_by_source_key,
                        practice_mode,
                    )

            if len(response_cards) == 0:
                return jsonify({
                    'category_key': category_key,
                    'pending_session_id': None,
                    'cards': [],
                    'planned_count': 0,
                    'practice_mode': practice_mode,
                    'is_continue_session': bool(is_continue_session),
                    'continue_source_session_id': (
                        int(continue_source_session['session_id'])
                        if is_continue_session and continue_source_session is not None
                        else None
                    ),
                    'is_retry_session': bool(is_retry_session),
                    'retry_source_session_id': (
                        int(retry_source_session['session_id'])
                        if is_retry_session and retry_source_session is not None
                        else None
                    ),
                }), 200

            pending_session_payload = {
                'kind': category_key,
                'planned_count': len(response_cards),
                'practice_mode': practice_mode,
                'cards': pending_items,
            }
            if is_continue_session and continue_source_session is not None:
                pending_session_payload[PENDING_CONTINUE_SOURCE_SESSION_ID_KEY] = int(continue_source_session['session_id'])
            if is_retry_session and retry_source_session is not None:
                pending_session_payload[PENDING_RETRY_SOURCE_SESSION_ID_KEY] = int(retry_source_session['session_id'])

            source_session_id = None
            if is_continue_session and continue_source_session is not None:
                source_session_id = int(continue_source_session['session_id'])
            elif is_retry_session and retry_source_session is not None:
                source_session_id = int(retry_source_session['session_id'])
            if source_session_id is not None:
                pending_session_payload['practice_mode'] = get_session_practice_mode(conn, source_session_id)

            resolved_practice_mode = normalize_session_practice_mode(pending_session_payload.get('practice_mode'))

            pending_session_id = create_pending_session(
                kid_id,
                category_key,
                pending_session_payload,
            )
        finally:
            conn.close()

        return jsonify({
            'category_key': category_key,
            'pending_session_id': pending_session_id,
            'planned_count': len(response_cards),
            'cards': response_cards,
            'practice_mode': resolved_practice_mode,
            'is_continue_session': bool(is_continue_session),
            'continue_source_session_id': (
                int(continue_source_session['session_id'])
                if is_continue_session and continue_source_session is not None
                else None
            ),
            'is_retry_session': bool(is_retry_session),
            'retry_source_session_id': (
                int(retry_source_session['session_id'])
                if is_retry_session and retry_source_session is not None
                else None
            ),
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/practice/start', methods=['POST'])
def start_type3_practice_session(kid_id):
    """Start a merged type-III session from opted-in decks (+ optional orphan)."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        payload = request.get_json(silent=True) or {}
        category_key, _ = resolve_kid_type_iii_category_with_mode(
            kid,
            payload.get('categoryKey') or request.args.get('categoryKey'),
        )
        response_payload, status_code = start_type_i_practice_session_internal(
            kid_id,
            kid,
            category_key,
            pending_session_payload_extras={
                'type3_audio_dir': ensure_type3_audio_dir(kid),
            },
        )
        return jsonify(response_payload), status_code
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/practice/upload-audio', methods=['POST'])
def upload_type3_practice_audio(kid_id):
    """Upload one type-III recording clip for an active pending session."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        pending_session_id = str(request.form.get('pendingSessionId') or '').strip()
        card_id_raw = request.form.get('cardId')
        if not pending_session_id:
            return jsonify({'error': 'pendingSessionId is required'}), 400
        try:
            card_id = int(card_id_raw)
        except (TypeError, ValueError):
            return jsonify({'error': 'cardId must be an integer'}), 400
        if 'audio' not in request.files:
            return jsonify({'error': 'Audio recording is required'}), 400

        category_key, _ = resolve_kid_type_iii_category_with_mode(
            kid,
            request.form.get('categoryKey') or request.args.get('categoryKey'),
        )
        pending = get_pending_session(pending_session_id, kid_id, category_key)
        if not pending:
            return jsonify({'error': 'Pending session not found or expired'}), 404

        planned_ids = set()
        for card in pending.get('cards', []) if isinstance(pending.get('cards'), list) else []:
            try:
                planned_ids.add(int(card.get('id')))
            except Exception:
                continue
        if len(planned_ids) > 0 and card_id not in planned_ids:
            return jsonify({'error': 'cardId is not in this pending session'}), 400

        audio_file = request.files['audio']
        if not audio_file or audio_file.filename == '':
            return jsonify({'error': 'Audio recording is required'}), 400
        audio_bytes = audio_file.read()
        if not audio_bytes:
            return jsonify({'error': 'Uploaded audio is empty'}), 400

        safe_name = secure_filename(audio_file.filename or '')
        ext = os.path.splitext(safe_name)[1].lower()
        if not ext:
            ext = '.webm'
        mime_type = audio_file.mimetype or 'application/octet-stream'

        audio_dir = ensure_type3_audio_dir(kid)
        file_name = f"lr_{pending_session_id}_{card_id}_{uuid.uuid4().hex}{ext}"
        file_path = os.path.join(audio_dir, file_name)
        with open(file_path, 'wb') as f:
            f.write(audio_bytes)

        old_file_name = None
        with _PENDING_SESSIONS_LOCK:
            live = _PENDING_SESSIONS.get(pending_session_id)
            if (
                not live
                or str(live.get('kid_id')) != str(kid_id)
                or str(live.get('session_type')) != category_key
            ):
                try:
                    os.remove(file_path)
                except Exception:
                    pass
                return jsonify({'error': 'Pending session not found or expired'}), 404

            type3_audio_by_card = live.get('type3_audio_by_card')
            if not isinstance(type3_audio_by_card, dict):
                type3_audio_by_card = {}
                live['type3_audio_by_card'] = type3_audio_by_card
            if not str(live.get('type3_audio_dir') or '').strip():
                live['type3_audio_dir'] = audio_dir

            old_meta = type3_audio_by_card.get(str(card_id))
            if isinstance(old_meta, dict):
                old_file_name = str(old_meta.get('file_name') or '').strip() or None

            type3_audio_by_card[str(card_id)] = {
                'file_name': file_name,
                'mime_type': mime_type,
            }

        if old_file_name:
            old_path = os.path.join(audio_dir, old_file_name)
            if os.path.exists(old_path):
                try:
                    os.remove(old_path)
                except Exception:
                    pass

        return jsonify({
            'pending_session_id': pending_session_id,
            'card_id': card_id,
            'file_name': file_name,
            'mime_type': mime_type,
            'audio_url': f"/api/kids/{kid_id}/lesson-reading/audio/{file_name}",
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/cards/practice/complete', methods=['POST'])
def complete_type1_practice_session(kid_id):
    """Complete one type-I practice session with all answers."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        payload_data = request.get_json(silent=True) or {}
        category_key, _ = resolve_kid_type_i_category_with_mode(
            kid,
            payload_data.get('categoryKey') or request.args.get('categoryKey'),
        )

        payload, status_code = complete_session_internal(
            kid,
            kid_id,
            category_key,
            payload_data
        )
        return jsonify(payload), status_code
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/lesson-reading/practice/complete', methods=['POST'])
def complete_type3_practice_session(kid_id):
    """Complete a type-III practice session with all answers."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload_data = None
        content_type = str(request.content_type or '')
        if content_type.startswith('multipart/form-data'):
            pending_session_id = str(request.form.get('pendingSessionId') or '').strip()
            answers_raw = request.form.get('answers')
            started_at = str(request.form.get('startedAt') or '').strip()
            if not pending_session_id:
                return jsonify({'error': 'pendingSessionId is required'}), 400
            if not answers_raw:
                return jsonify({'error': 'answers is required'}), 400
            try:
                answers = json.loads(answers_raw)
            except Exception:
                return jsonify({'error': 'answers must be valid JSON'}), 400

            uploaded_audio_by_card = {}
            for field_name, audio_file in request.files.items():
                if not str(field_name).startswith('audio_'):
                    continue
                card_id_raw = str(field_name).split('_', 1)[1]
                try:
                    card_id = int(card_id_raw)
                except (TypeError, ValueError):
                    continue
                audio_bytes = audio_file.read()
                if not audio_bytes:
                    return jsonify({'error': f'Uploaded audio for card {card_id} is empty'}), 400
                uploaded_audio_by_card[card_id] = {
                    'bytes': audio_bytes,
                    'mime_type': audio_file.mimetype or 'application/octet-stream',
                    'filename': audio_file.filename or '',
                }

            payload_data = {
                'pendingSessionId': pending_session_id,
                'answers': answers,
                'startedAt': started_at or None,
                'categoryKey': request.form.get('categoryKey') or request.args.get('categoryKey'),
                '_uploaded_type3_audio_by_card': uploaded_audio_by_card,
            }
        else:
            payload_data = request.get_json() or {}

        category_key, _ = resolve_kid_type_iii_category_with_mode(
            kid,
            payload_data.get('categoryKey') or request.args.get('categoryKey'),
        )
        payload, status_code = complete_session_internal(
            kid,
            kid_id,
            category_key,
            payload_data
        )
        return jsonify(payload), status_code
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type2/practice/complete', methods=['POST'])
def complete_writing_practice_session(kid_id):
    """Complete a type-II practice session with all answers."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload_data = request.get_json() or {}
        category_key, _ = resolve_kid_type_ii_category_with_mode(
            kid,
            payload_data.get('categoryKey') or request.args.get('categoryKey'),
        )
        payload, status_code = complete_session_internal(
            kid,
            kid_id,
            category_key,
            payload_data
        )
        return jsonify(payload), status_code
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type4/practice/complete', methods=['POST'])
def complete_type4_practice_session(kid_id):
    """Complete one generator practice session with server-side grading."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload_data = request.get_json() or {}
        category_key, _ = resolve_kid_type_iv_category_with_mode(
            kid,
            payload_data.get('categoryKey') or request.args.get('categoryKey'),
        )
        payload, status_code = complete_session_internal(
            kid,
            kid_id,
            category_key,
            payload_data
        )
        return jsonify(payload), status_code
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ──────────────────────────────────────────────────────────────
# Chinese Character Bank
# ──────────────────────────────────────────────────────────────

