"""Practice session start/complete routes.

Layout (search for `# === N. ` banner markers to jump between sections):

    1. Session start routes — per-behavior-type entry points
         /kids/<id>/type2/practice/start                 (type-II writing/audio)
         /kids/<id>/cards/practice/start                 (type-I flash cards)
         /kids/<id>/type4/practice/start                 (type-IV math generator)
         /kids/<id>/lesson-reading/practice/start        (type-III lesson reading)
    2. Type-III audio upload — /lesson-reading/practice/upload-audio
    3. Session complete routes — per-behavior-type completion
         /kids/<id>/cards/practice/complete
         /kids/<id>/lesson-reading/practice/complete
         /kids/<id>/type2/practice/complete
         /kids/<id>/type4/practice/complete
    4. Shared helpers — start_type_i_practice_session_internal,
       complete_session_internal (reused by start and complete routes)

Practice runs live in `_PENDING_SESSIONS` (in routes.kids.__init__) until
`practice/complete` is hit. The lock dict `_PENDING_SESSION_LOCKS` guards
concurrent edits to a single in-flight session.
"""
from src.routes.kids_constants import (
    DECK_CATEGORY_BEHAVIOR_TYPE_I,
    DECK_CATEGORY_BEHAVIOR_TYPE_II,
    DECK_CATEGORY_BEHAVIOR_TYPE_III,
    DECK_CATEGORY_BEHAVIOR_TYPE_IV,
    DRILL_SESSION_CARD_POOL_SIZE,
    PENDING_CONTINUE_SOURCE_SESSION_ID_KEY,
    PENDING_RETRY_SOURCE_SESSION_ID_KEY,
    SESSION_RESULT_CORRECT,
    SESSION_RESULT_RETRY_FIXED_FIRST,
    SESSION_RESULT_WRONG_UNRESOLVED,
)
from src.routes.kids import (
    build_type_i_chinese_prompt_audio_payload,
    build_writing_prompt_audio_payload,
    cleanup_type3_pending_audio_files_by_payload,
    cleanup_uncommitted_type3_audio,
    datetime,
    defaultdict,
    encode_retry_recovered_session_result,
    ensure_type3_audio_dir,
    extract_shared_deck_tags_and_labels,
    get_category_drill_speed_cutoff_ms_for_kid,
    get_category_session_card_count_for_kid,
    get_shared_merged_source_decks_for_kid,
    get_type_iv_practice_source_rows,
    json,
    jsonify,
    kids_bp,
    mimetypes,
    normalize_shared_deck_category_behavior,
    os,
    request,
    run_type4_generator,
    secure_filename,
    timezone,
    uuid,
    with_preview_session_count_for_category,
)
from src.services.family_auth import get_kid_connection_for, get_kid_for_family
from src.services.kid_category_resolve import (
    resolve_kid_type_i_category_with_mode,
    resolve_kid_type_ii_category_with_mode,
    resolve_kid_type_iii_category_with_mode,
    resolve_kid_type_iv_category_with_mode,
)
from src.services.practice_session import (
    build_continue_selected_cards_for_decks,
    build_retry_selected_cards_for_sources,
    build_type_i_multiple_choice_pool_cards,
    get_retry_source_wrong_card_ids,
    plan_deck_practice_selection_for_decks,
)
from src.services.session_grading import (
    append_type1_result_submitted_answer,
    insert_type1_result_item,
    update_card_correct_time_ema,
)
from src.services.type4_session import (
    build_type_iv_continue_count_by_source_key,
    build_type_iv_initial_count_by_source_key,
    build_type_iv_pending_items_for_sources,
    get_type_iv_retry_source_result_rows,
    map_type_iv_pending_item_to_response_card,
)
from src.services.writing_candidates import get_pending_writing_card_ids
from src.services.kid_today_sessions import (
    filter_answers_to_pending_cards,
    get_latest_retry_source_session_for_today,
    get_latest_unfinished_session_for_today,
    get_session_practiced_card_ids,
    normalize_logged_response_time_ms,
)
from src.services.pending_sessions import (
    _PENDING_SESSIONS,
    _PENDING_SESSIONS_LOCK,
    create_pending_session,
    get_pending_session,
    parse_client_started_at,
    pop_pending_session,
)
from src.services.practice_mode import (
    TYPE_IV_PRACTICE_MODE_MULTI,
    compose_session_practice_mode,
    get_session_practice_mode,
    get_session_practice_mode_base,
    normalize_session_practice_mode,
    normalize_type_iv_practice_mode,
    parse_session_practice_mode,
)
from src.services.shared_deck_category import (
    get_session_behavior_type,
    get_shared_deck_category_meta_by_key,
    is_type_iii_session_type,
)
from src.routes.kids.type4 import (
    build_type_iv_offline_pending_payload,
    complete_type_iv_session_internal,
)

# ============================================================================
# 1. Session start routes — per-behavior-type entry points
# ============================================================================

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
        source_decks = get_shared_merged_source_decks_for_kid(
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

        pending_session_payload['offline_pack_id'] = request.headers.get('X-Offline-Pack-Id') or None
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
                card.get('back'),
                category_key=category_key,
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
                    drill_speed_target_ms = get_category_drill_speed_cutoff_ms_for_kid(
                        speed_conn, category_key,
                    )
                finally:
                    speed_conn.close()
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
        # Offline packs always bake choices (multi mode) so the kid can switch
        # modes mid-pack without re-fetching. The actual mode they pick is
        # supplied at completion time and overrides the baked value.
        is_offline_acquire = bool(request.headers.get('X-Offline-Pack-Id'))
        practice_mode = (
            TYPE_IV_PRACTICE_MODE_MULTI
            if is_offline_acquire
            else normalize_type_iv_practice_mode(payload.get('practiceMode'))
        )

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
            include_pending_payload = bool(request.headers.get('X-Offline-Pack-Id'))

            pending_session_payload['offline_pack_id'] = request.headers.get('X-Offline-Pack-Id') or None
            pending_session_id = create_pending_session(
                kid_id,
                category_key,
                pending_session_payload,
            )
        finally:
            conn.close()

        response_payload = {
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
        }
        if include_pending_payload:
            response_payload['pending_payload'] = build_type_iv_offline_pending_payload(
                pending_session_payload
            )
        return jsonify(response_payload), 200
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


# ============================================================================
# 2. Type-III audio upload
# ============================================================================

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


# ============================================================================
# 3. Session complete routes — per-behavior-type completion
# ============================================================================

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


# ============================================================================
# 4. Shared helpers — reused by both start and complete routes
# ============================================================================

def start_type_i_practice_session_internal(
    kid_id,
    kid,
    category_key,
    *,
    session_card_count_override=None,
    include_orphan_in_queue_override=None,
    pending_session_payload_extras=None,
    include_category_key_in_response=True,
    include_multiple_choice_pool_cards=False,
):
    """Start one merged type-I practice session with optional per-category overrides."""
    conn = get_kid_connection_for(kid)
    try:
        source_decks = get_shared_merged_source_decks_for_kid(
            conn,
            kid,
            category_key,
            include_orphan_in_queue_override=include_orphan_in_queue_override,
        )
        included_sources = [src for src in source_decks if bool(src.get('included_in_queue'))]
        source_deck_ids = [
            int(src['local_deck_id'])
            for src in included_sources
            if int(src.get('active_card_count') or 0) > 0
        ]
        source_by_deck_id = {int(src['local_deck_id']): src for src in included_sources}
        continue_source_session = get_latest_unfinished_session_for_today(conn, kid, category_key)
        continue_practiced_card_ids = []
        is_continue_session = continue_source_session is not None
        retry_source_session = None
        is_retry_session = False
        if is_continue_session:
            continue_practiced_card_ids = get_session_practiced_card_ids(
                conn,
                continue_source_session['session_id'],
            )
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
                excluded_card_ids=continue_practiced_card_ids,
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
        if is_continue_session:
            pass
        elif is_retry_session:
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
            preview_kid = with_preview_session_count_for_category(
                kid,
                category_key,
                (
                    int(session_card_count_override)
                    if session_card_count_override is not None
                    else get_category_session_card_count_for_kid(kid, category_key)
                ),
            )
            cards_by_id, selected_ids = plan_deck_practice_selection_for_decks(
                conn,
                preview_kid,
                source_deck_ids,
                category_key
            )
            selected_cards = []
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
            payload = {'pending_session_id': None, 'cards': [], 'planned_count': 0}
            if include_category_key_in_response:
                payload['category_key'] = category_key
            payload['is_continue_session'] = bool(is_continue_session)
            payload['continue_source_session_id'] = (
                int(continue_source_session['session_id'])
                if is_continue_session and continue_source_session is not None
                else None
            )
            payload['is_retry_session'] = bool(is_retry_session)
            payload['retry_source_session_id'] = (
                int(retry_source_session['session_id'])
                if is_retry_session and retry_source_session is not None
                else None
            )
            extras_mode = (pending_session_payload_extras or {}).get('practice_mode') if isinstance(pending_session_payload_extras, dict) else None
            payload['practice_mode'] = normalize_session_practice_mode(extras_mode)
            return payload, 200

        multiple_choice_pool_cards = []
        if include_multiple_choice_pool_cards and (is_continue_session or is_retry_session):
            source_session_card_ids = []
            if is_continue_session and continue_source_session is not None:
                selected_card_ids = [int(card.get('id') or 0) for card in selected_cards]
                source_session_card_ids = [
                    card_id
                    for card_id in [*continue_practiced_card_ids, *selected_card_ids]
                    if int(card_id or 0) > 0
                ]
            elif is_retry_session and retry_source_session is not None:
                source_session_card_ids = get_session_practiced_card_ids(
                    conn,
                    retry_source_session['session_id'],
                )
            multiple_choice_pool_cards = build_type_i_multiple_choice_pool_cards(
                conn,
                source_by_deck_id,
                source_session_card_ids,
            )

        pending_session_payload = {
            'kind': category_key,
            'planned_count': len(selected_cards),
            'cards': [{'id': int(card['id'])} for card in selected_cards],
        }
        if is_continue_session and continue_source_session is not None:
            pending_session_payload[PENDING_CONTINUE_SOURCE_SESSION_ID_KEY] = int(continue_source_session['session_id'])
        if is_retry_session and retry_source_session is not None:
            pending_session_payload[PENDING_RETRY_SOURCE_SESSION_ID_KEY] = int(retry_source_session['session_id'])
        if isinstance(pending_session_payload_extras, dict):
            pending_session_payload.update(pending_session_payload_extras)

        source_session_id = None
        if is_continue_session and continue_source_session is not None:
            source_session_id = int(continue_source_session['session_id'])
        elif is_retry_session and retry_source_session is not None:
            source_session_id = int(retry_source_session['session_id'])
        if source_session_id is not None:
            inherited_mode = get_session_practice_mode(conn, source_session_id)
            inherited_base = get_session_practice_mode_base(inherited_mode)
            pending_session_payload['practice_mode'] = compose_session_practice_mode(
                inherited_base, drill=False
            )

        resolved_practice_mode = normalize_session_practice_mode(pending_session_payload.get('practice_mode'))

        pending_session_payload['offline_pack_id'] = request.headers.get('X-Offline-Pack-Id') or None
        pending_session_id = create_pending_session(
            kid_id,
            category_key,
            pending_session_payload
        )
    finally:
        conn.close()

    category_meta = get_shared_deck_category_meta_by_key().get(category_key) or {}
    has_type_i_chinese_prompt_audio = (
        normalize_shared_deck_category_behavior(category_meta.get('behavior_type'))
        == DECK_CATEGORY_BEHAVIOR_TYPE_I
        and bool(category_meta.get('has_chinese_specific_logic'))
    )
    response_cards = []
    for card in selected_cards:
        response_card = dict(card)
        if has_type_i_chinese_prompt_audio:
            audio_meta = build_type_i_chinese_prompt_audio_payload(
                kid_id,
                response_card.get('front'),
                category_key=category_key,
            )
            response_card['audio_file_name'] = audio_meta.get('audio_file_name')
            response_card['audio_mime_type'] = audio_meta.get('audio_mime_type')
            response_card['audio_url'] = audio_meta.get('audio_url')
            response_card['prompt_audio_url'] = audio_meta.get('prompt_audio_url')
        response_cards.append(response_card)

    payload = {
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
    }
    if include_multiple_choice_pool_cards:
        payload['multiple_choice_pool_cards'] = multiple_choice_pool_cards
    if include_category_key_in_response:
        payload['category_key'] = category_key
    return payload, 200

def complete_session_internal(kid, kid_id, session_type, data):
    """Complete a session by saving all answers in one batch."""
    pending_session_id = data.get('pendingSessionId')
    if not pending_session_id:
        return {'error': 'pendingSessionId is required'}, 400
    answers = data.get('answers')
    if not isinstance(answers, list) or len(answers) == 0:
        return {'error': 'answers must be a non-empty list'}, 400

    pending = pop_pending_session(pending_session_id, kid_id, session_type)
    if not pending:
        return {'error': 'Pending session not found or expired'}, 404
    answers = filter_answers_to_pending_cards(answers, pending)
    if len(answers) == 0:
        return {'error': 'answers do not match this pending session'}, 400
    started_at_utc = parse_client_started_at(data.get('startedAt'), pending)
    completed_at_utc = datetime.now(timezone.utc).replace(tzinfo=None)

    conn = get_kid_connection_for(kid)
    planned_count = int(pending.get('planned_count') or 0)
    uses_type_iii_audio = is_type_iii_session_type(session_type)
    try:
        category_meta_by_key = get_shared_deck_category_meta_by_key()
    except Exception:
        category_meta_by_key = {}
    session_behavior_type = get_session_behavior_type(
        session_type,
        category_meta_by_key=category_meta_by_key,
    )
    try:
        retry_source_session_id = int(pending.get(PENDING_RETRY_SOURCE_SESSION_ID_KEY) or 0)
    except (TypeError, ValueError):
        retry_source_session_id = 0
    try:
        continue_source_session_id = int(pending.get(PENDING_CONTINUE_SOURCE_SESSION_ID_KEY) or 0)
    except (TypeError, ValueError):
        continue_source_session_id = 0
    is_retry_session = (
        retry_source_session_id > 0
        and session_behavior_type in (
            DECK_CATEGORY_BEHAVIOR_TYPE_I,
            DECK_CATEGORY_BEHAVIOR_TYPE_II,
            DECK_CATEGORY_BEHAVIOR_TYPE_IV,
        )
    )
    is_continue_session = (
        continue_source_session_id > 0
        and session_behavior_type in (
            DECK_CATEGORY_BEHAVIOR_TYPE_I,
            DECK_CATEGORY_BEHAVIOR_TYPE_II,
            DECK_CATEGORY_BEHAVIOR_TYPE_III,
            DECK_CATEGORY_BEHAVIOR_TYPE_IV,
        )
    )
    if is_continue_session:
        is_retry_session = False
    uploaded_type3_audio = data.get('_uploaded_type3_audio_by_card') if uses_type_iii_audio else {}
    if not isinstance(uploaded_type3_audio, dict):
        uploaded_type3_audio = {}
    pending_type3_audio = pending.get('type3_audio_by_card') if uses_type_iii_audio else {}
    if not isinstance(pending_type3_audio, dict):
        pending_type3_audio = {}
    written_type3_audio_paths = []

    def _record_written_type3_audio_path(file_path):
        written_type3_audio_paths.append(file_path)

    def _queue_type3_pending_cleanup(payload):
        if not payload:
            return
        cleanup_type3_pending_audio_files_by_payload(payload)

    def _queue_type3_leftover_cleanup(consumed_type3_audio_files):
        if not uses_type_iii_audio or not isinstance(pending_type3_audio, dict):
            return
        leftovers = {}
        for item in pending_type3_audio.values():
            if not isinstance(item, dict):
                continue
            file_name = str(item.get('file_name') or '').strip()
            if file_name and file_name not in consumed_type3_audio_files:
                leftovers[file_name] = item
        if len(leftovers) > 0:
            _queue_type3_pending_cleanup({
                'type3_audio_dir': pending.get('type3_audio_dir'),
                'type3_audio_by_card': {name: meta for name, meta in leftovers.items()},
            })

    def _attach_type3_audio_to_result(card_id, result_id, consumed_type3_audio_files):
        uploaded_audio = uploaded_type3_audio.get(card_id)
        if uploaded_audio is None:
            uploaded_audio = uploaded_type3_audio.get(str(card_id))
        if isinstance(uploaded_audio, dict):
            audio_bytes = uploaded_audio.get('bytes')
            if not isinstance(audio_bytes, (bytes, bytearray)) or len(audio_bytes) == 0:
                raise ValueError(f'Uploaded audio for card {card_id} is empty')
            mime_type = str(uploaded_audio.get('mime_type') or 'application/octet-stream').strip()
            original_filename = str(uploaded_audio.get('filename') or '').strip()
            safe_name = secure_filename(original_filename)
            ext = os.path.splitext(safe_name)[1].lower()
            if not ext:
                guessed_ext = mimetypes.guess_extension(mime_type) or ''
                ext = guessed_ext.lower() if guessed_ext else '.webm'
            audio_dir = ensure_type3_audio_dir(kid)
            file_name = f"lr_{pending_session_id}_{card_id}_{uuid.uuid4().hex}{ext}"
            file_path = os.path.join(audio_dir, file_name)
            with open(file_path, 'wb') as f:
                f.write(bytes(audio_bytes))
            _record_written_type3_audio_path(file_path)
            conn.execute(
                """
                INSERT INTO lesson_reading_audio (result_id, file_name, mime_type)
                VALUES (?, ?, ?)
                """,
                [result_id, file_name, mime_type]
            )
            consumed_type3_audio_files.add(file_name)
            return

        audio_meta = pending_type3_audio.get(str(card_id))
        if isinstance(audio_meta, dict):
            file_name = str(audio_meta.get('file_name') or '').strip()
            mime_type = str(audio_meta.get('mime_type') or 'application/octet-stream').strip()
            if file_name:
                conn.execute(
                    """
                    INSERT INTO lesson_reading_audio (result_id, file_name, mime_type)
                    VALUES (?, ?, ?)
                    """,
                    [result_id, file_name, mime_type]
                )
                consumed_type3_audio_files.add(file_name)

    def _finalize_success():
        conn.execute("COMMIT")
        conn.close()

    if session_behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_IV:
        return complete_type_iv_session_internal(
            conn,
            kid,
            session_type,
            pending_session_id,
            pending,
            answers,
            planned_count,
            started_at_utc,
            completed_at_utc,
            is_retry_session,
            retry_source_session_id,
            is_continue_session,
            continue_source_session_id,
        )

    # Validate answers before starting transaction
    for answer in answers:
        card_id = answer.get('cardId')
        known = answer.get('known')
        if not card_id or not isinstance(known, bool):
            conn.close()
            if uses_type_iii_audio:
                cleanup_type3_pending_audio_files_by_payload(pending)
            return {'error': 'Each answer needs cardId (int) and known (bool)'}, 400

    try:
        conn.execute("BEGIN TRANSACTION")

        consumed_type3_audio_files = set()
        if is_retry_session:
            retry_result_ids_by_card_id = defaultdict(list)
            answer_card_ids_unique = []
            seen_answer_card_ids = set()
            for answer in answers:
                try:
                    answer_card_id = int(answer.get('cardId'))
                except (TypeError, ValueError):
                    continue
                if answer_card_id <= 0 or answer_card_id in seen_answer_card_ids:
                    continue
                seen_answer_card_ids.add(answer_card_id)
                answer_card_ids_unique.append(answer_card_id)
            if answer_card_ids_unique:
                placeholders = ','.join(['?'] * len(answer_card_ids_unique))
                retry_result_rows = conn.execute(
                    f"""
                    SELECT id, card_id
                    FROM session_results
                    WHERE session_id = ?
                      AND card_id IN ({placeholders})
                      AND correct = ?
                    ORDER BY id ASC
                    """,
                    [
                        retry_source_session_id,
                        *answer_card_ids_unique,
                        SESSION_RESULT_WRONG_UNRESOLVED,
                    ],
                ).fetchall()
                for row in retry_result_rows:
                    if row[0] is None or row[1] is None:
                        continue
                    retry_result_ids_by_card_id[int(row[1])].append(int(row[0]))

            source_row = conn.execute(
                """
                SELECT
                    s.id,
                    COUNT(sr.id) AS answer_count,
                    COALESCE(SUM(CASE WHEN sr.correct = 1 THEN 1 ELSE 0 END), 0) AS right_count,
                    COALESCE(SUM(CASE WHEN sr.correct < 0 OR sr.correct = 2 THEN 1 ELSE 0 END), 0) AS wrong_count,
                    COALESCE(s.retry_count, 0) AS retry_count,
                    COALESCE(s.retry_total_response_ms, 0) AS retry_total_response_ms,
                    COALESCE(s.retry_best_rety_correct_count, 0) AS retry_best_rety_correct_count
                FROM sessions s
                LEFT JOIN session_results sr ON sr.session_id = s.id
                WHERE s.id = ?
                  AND s.type = ?
                GROUP BY
                    s.id,
                    s.retry_count,
                    s.retry_total_response_ms,
                    s.retry_best_rety_correct_count
                """,
                [retry_source_session_id, session_type],
            ).fetchone()
            if not source_row:
                raise ValueError('Retry source session not found')

            source_answer_count = int(source_row[1] or 0)
            source_right_count = int(source_row[2] or 0)
            source_wrong_count = int(source_row[3] or 0)
            source_retry_count = int(source_row[4] or 0)
            source_target_answer_count = max(source_answer_count, source_right_count + source_wrong_count)
            if source_target_answer_count <= 0:
                raise ValueError('Retry source session has no graded answers')

            retry_right_count = 0
            retry_wrong_count = 0
            retry_total_response_ms = 0
            promoted_result_ids = []
            recovered_correct_value = encode_retry_recovered_session_result(source_retry_count)
            for answer in answers:
                try:
                    answer_card_id = int(answer.get('cardId'))
                except (TypeError, ValueError):
                    answer_card_id = 0
                known = bool(answer.get('known'))
                if known:
                    retry_right_count += 1
                else:
                    retry_wrong_count += 1
                response_time_ms = normalize_logged_response_time_ms(
                    answer.get('responseTimeMs'),
                    session_behavior_type=session_behavior_type,
                )
                retry_total_response_ms += int(response_time_ms or 0)

                claimed_result_id = None
                if answer_card_id > 0:
                    queue = retry_result_ids_by_card_id.get(answer_card_id)
                    if queue:
                        claimed_result_id = queue.pop(0)

                if known and claimed_result_id is not None:
                    promoted_result_ids.append(claimed_result_id)

                if session_behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_I and claimed_result_id is not None:
                    append_type1_result_submitted_answer(
                        conn,
                        claimed_result_id,
                        answer,
                        SESSION_RESULT_CORRECT if known else SESSION_RESULT_WRONG_UNRESOLVED,
                    )

            for result_id in promoted_result_ids:
                conn.execute(
                    """
                    UPDATE session_results
                    SET correct = ?
                    WHERE id = ?
                      AND session_id = ?
                      AND correct = ?
                    """,
                    [
                        recovered_correct_value,
                        int(result_id),
                        retry_source_session_id,
                        SESSION_RESULT_WRONG_UNRESOLVED,
                    ],
                )

            best_retry_row = conn.execute(
                """
                SELECT COUNT(*)
                FROM session_results
                WHERE session_id = ?
                  AND correct <= ?
                  AND card_id IS NOT NULL
                """,
                [retry_source_session_id, SESSION_RESULT_RETRY_FIXED_FIRST],
            ).fetchone()
            candidate_best_retry_correct = max(0, int(best_retry_row[0] or 0)) if best_retry_row else 0
            conn.execute(
                """
                UPDATE sessions
                SET
                    retry_count = COALESCE(retry_count, 0) + 1,
                    retry_total_response_ms = COALESCE(retry_total_response_ms, 0) + ?,
                    retry_best_rety_correct_count = GREATEST(
                        COALESCE(retry_best_rety_correct_count, 0),
                        ?
                    )
                WHERE id = ?
                """,
                [retry_total_response_ms, candidate_best_retry_correct, retry_source_session_id],
            )
            updated_retry_row = conn.execute(
                """
                SELECT
                    COALESCE(retry_count, 0),
                    COALESCE(retry_total_response_ms, 0),
                    COALESCE(retry_best_rety_correct_count, 0)
                FROM sessions
                WHERE id = ?
                """,
                [retry_source_session_id],
            ).fetchone()

            _finalize_success()
            updated_retry_count = int(updated_retry_row[0] or 0) if updated_retry_row else 0
            updated_retry_total_ms = int(updated_retry_row[1] or 0) if updated_retry_row else 0
            updated_best_retry_correct = int(updated_retry_row[2] or 0) if updated_retry_row else 0
            total_correct_percent = (
                float(source_right_count + updated_best_retry_correct) * 100.0 / float(source_target_answer_count)
                if source_target_answer_count > 0 else 0.0
            )
            achieved_gold_star = total_correct_percent >= 100.0
            attempt_count_today_for_chain = 1 + max(0, updated_retry_count)
            attempt_star_tiers = ['gold']
            return {
                'session_id': int(retry_source_session_id),
                'answer_count': len(answers),
                'planned_count': planned_count,
                'right_count': retry_right_count,
                'wrong_count': retry_wrong_count,
                'completed': True,
                'is_continue_session': False,
                'continue_source_session_id': None,
                'is_retry_session': True,
                'retry_source_session_id': int(retry_source_session_id),
                'retry_count': updated_retry_count,
                'retry_total_response_ms': updated_retry_total_ms,
                'retry_best_rety_correct_count': updated_best_retry_correct,
                'target_answer_count': int(source_target_answer_count),
                'attempt_count_today_for_chain': int(attempt_count_today_for_chain),
                'attempt_star_tiers': attempt_star_tiers,
                'total_correct_percentage': float(total_correct_percent),
                'achieved_gold_star': bool(achieved_gold_star),
                'star_tier': 'gold',
            }, 200

        if is_continue_session:
            source_row = conn.execute(
                """
                SELECT
                    s.id,
                    COALESCE(s.planned_count, 0) AS planned_count,
                    COUNT(sr.id) AS answer_count,
                    COALESCE(SUM(CASE WHEN sr.correct = 1 THEN 1 ELSE 0 END), 0) AS right_count,
                    COALESCE(SUM(CASE WHEN sr.correct < 0 OR sr.correct = 2 THEN 1 ELSE 0 END), 0) AS wrong_count
                FROM sessions s
                LEFT JOIN session_results sr ON sr.session_id = s.id
                WHERE s.id = ?
                  AND s.type = ?
                GROUP BY s.id, s.planned_count
                """,
                [continue_source_session_id, session_type],
            ).fetchone()
            if not source_row:
                raise ValueError('Continue source session not found')

            source_planned_count = max(0, int(source_row[1] or 0))
            source_answer_count = max(0, int(source_row[2] or 0))
            source_right_count = max(0, int(source_row[3] or 0))
            source_wrong_count = max(0, int(source_row[4] or 0))
            if source_planned_count <= 0:
                raise ValueError('Continue source session has invalid planned count')

            right_count = 0
            wrong_count = 0
            for answer in answers:
                card_id = answer.get('cardId')
                known = answer.get('known')
                response_time_ms = normalize_logged_response_time_ms(
                    answer.get('responseTimeMs'),
                    session_behavior_type=session_behavior_type,
                )
                if uses_type_iii_audio:
                    correct_value = 0
                else:
                    correct_value = SESSION_RESULT_CORRECT if bool(known) else SESSION_RESULT_WRONG_UNRESOLVED
                if correct_value > 0:
                    right_count += 1
                elif correct_value < 0:
                    wrong_count += 1
                result_row = conn.execute(
                    """
                    INSERT INTO session_results (session_id, card_id, correct, response_time_ms)
                    VALUES (?, ?, ?, ?)
                    RETURNING id
                    """,
                    [continue_source_session_id, card_id, correct_value, response_time_ms]
                ).fetchone()
                result_id = int(result_row[0])
                update_card_correct_time_ema(conn, card_id, correct_value, response_time_ms)
                if session_behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_I:
                    insert_type1_result_item(conn, result_id, answer, correct_value)

                if uses_type_iii_audio:
                    _attach_type3_audio_to_result(card_id, result_id, consumed_type3_audio_files)

            conn.execute(
                """
                UPDATE sessions
                SET completed_at = ?
                WHERE id = ?
                """,
                [completed_at_utc, continue_source_session_id],
            )
            updated_row = conn.execute(
                """
                SELECT
                    COALESCE(planned_count, 0),
                    COUNT(sr.id) AS answer_count,
                    COALESCE(SUM(CASE WHEN sr.correct = 1 THEN 1 ELSE 0 END), 0) AS right_count,
                    COALESCE(SUM(CASE WHEN sr.correct < 0 OR sr.correct = 2 THEN 1 ELSE 0 END), 0) AS wrong_count
                FROM sessions s
                LEFT JOIN session_results sr ON sr.session_id = s.id
                WHERE s.id = ?
                GROUP BY s.id, s.planned_count
                """,
                [continue_source_session_id],
            ).fetchone()
            updated_planned_count = max(0, int(updated_row[0] or 0)) if updated_row else source_planned_count
            updated_answer_count = max(0, int(updated_row[1] or 0)) if updated_row else (source_answer_count + len(answers))
            updated_right_count = max(0, int(updated_row[2] or 0)) if updated_row else (source_right_count + right_count)
            updated_wrong_count = max(0, int(updated_row[3] or 0)) if updated_row else (source_wrong_count + wrong_count)
            target_answer_count = max(updated_planned_count, updated_answer_count, updated_right_count + updated_wrong_count)
            is_incomplete = updated_planned_count > 0 and updated_answer_count < updated_planned_count
            if is_incomplete:
                total_correct_percentage = (
                    float(updated_answer_count) * 100.0 / float(max(1, target_answer_count))
                )
            elif uses_type_iii_audio and (updated_right_count + updated_wrong_count) <= 0:
                total_correct_percentage = (
                    float(updated_answer_count) * 100.0 / float(max(1, target_answer_count))
                )
            else:
                total_correct_percentage = (
                    float(updated_right_count) * 100.0 / float(max(1, target_answer_count))
                )
            if is_incomplete:
                attempt_star_tiers = ['half_silver']
                achieved_gold_star = False
                star_tier = 'half_silver'
            else:
                achieved_gold_star = total_correct_percentage >= 100.0
                star_tier = 'gold'
                attempt_star_tiers = ['gold']

            _finalize_success()
            _queue_type3_leftover_cleanup(consumed_type3_audio_files)
            return {
                'session_id': int(continue_source_session_id),
                'answer_count': int(updated_answer_count),
                'planned_count': int(updated_planned_count),
                'right_count': int(updated_right_count),
                'wrong_count': int(updated_wrong_count),
                'completed': True,
                'is_continue_session': True,
                'continue_source_session_id': int(continue_source_session_id),
                'is_retry_session': False,
                'retry_source_session_id': None,
                'retry_count': 0,
                'retry_total_response_ms': 0,
                'retry_best_rety_correct_count': 0,
                'target_answer_count': int(target_answer_count),
                'attempt_count_today_for_chain': 1,
                'attempt_star_tiers': attempt_star_tiers,
                'total_correct_percentage': float(total_correct_percentage),
                'achieved_gold_star': bool(achieved_gold_star),
                'star_tier': star_tier,
            }, 200

        right_count = 0
        wrong_count = 0
        session_practice_mode = normalize_session_practice_mode(pending.get('practice_mode'))
        session_id = conn.execute(
            """
            INSERT INTO sessions (type, planned_count, retry_count, retry_total_response_ms, retry_best_rety_correct_count, started_at, completed_at, practice_mode)
            VALUES (?, ?, 0, 0, 0, ?, ?, ?)
            RETURNING id
            """,
            [session_type, planned_count, started_at_utc, completed_at_utc, session_practice_mode]
        ).fetchone()[0]

        for answer in answers:
            card_id = answer.get('cardId')
            known = answer.get('known')
            response_time_ms = normalize_logged_response_time_ms(
                answer.get('responseTimeMs'),
                session_behavior_type=session_behavior_type,
            )
            if uses_type_iii_audio:
                correct_value = 0
            else:
                correct_value = SESSION_RESULT_CORRECT if bool(known) else SESSION_RESULT_WRONG_UNRESOLVED
            if correct_value > 0:
                right_count += 1
            elif correct_value < 0:
                wrong_count += 1
            result_row = conn.execute(
                """
                INSERT INTO session_results (session_id, card_id, correct, response_time_ms)
                VALUES (?, ?, ?, ?)
                RETURNING id
                """,
                [session_id, card_id, correct_value, response_time_ms]
            ).fetchone()
            result_id = int(result_row[0])
            update_card_correct_time_ema(conn, card_id, correct_value, response_time_ms)
            if session_behavior_type == DECK_CATEGORY_BEHAVIOR_TYPE_I:
                insert_type1_result_item(conn, result_id, answer, correct_value)

            if uses_type_iii_audio:
                _attach_type3_audio_to_result(card_id, result_id, consumed_type3_audio_files)
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        conn.close()
        if uses_type_iii_audio:
            cleanup_uncommitted_type3_audio(written_type3_audio_paths, pending)
        raise

    conn.close()
    _queue_type3_leftover_cleanup(consumed_type3_audio_files)
    target_answer_count = int(max(planned_count, len(answers), right_count + wrong_count))
    is_incomplete = planned_count > 0 and len(answers) < planned_count
    if is_incomplete:
        total_correct_percentage = float(len(answers)) * 100.0 / float(max(1, target_answer_count))
    elif uses_type_iii_audio and (right_count + wrong_count) <= 0:
        total_correct_percentage = float(len(answers)) * 100.0 / float(max(1, target_answer_count))
    else:
        total_correct_percentage = float(right_count) * 100.0 / float(max(1, target_answer_count))
    if is_incomplete:
        attempt_star_tiers = ['half_silver']
        achieved_gold_star = False
        star_tier = 'half_silver'
    else:
        achieved_gold_star = total_correct_percentage >= 100.0
        star_tier = 'gold'
        attempt_star_tiers = ['gold']
    return {
        'session_id': session_id,
        'answer_count': len(answers),
        'planned_count': planned_count,
        'right_count': int(right_count),
        'wrong_count': int(wrong_count),
        'completed': True,
        'is_continue_session': False,
        'continue_source_session_id': None,
        'is_retry_session': False,
        'retry_source_session_id': None,
        'retry_count': 0,
        'retry_total_response_ms': 0,
        'retry_best_rety_correct_count': 0,
        'target_answer_count': target_answer_count,
        'attempt_count_today_for_chain': 1,
        'attempt_star_tiers': attempt_star_tiers,
        'total_correct_percentage': float(total_correct_percentage),
        'achieved_gold_star': achieved_gold_star,
        'star_tier': star_tier,
    }, 200
