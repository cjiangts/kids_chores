"""Kid CRUD, deck-categories, and report routes."""
from src.routes.kids import *  # noqa: F401,F403  -- pulls in kids_bp + helpers/state

@kids_bp.route('/kids', methods=['GET'])
def get_kids():
    """Get all kids"""
    try:
        family_id = current_family_id()
        if not family_id:
            return jsonify({'error': 'Family login required'}), 401
        view = str(request.args.get('view') or '').strip().lower()
        is_admin_view = (view == 'admin')
        kids = metadata.get_all_kids(family_id=family_id)
        is_super = is_super_family_id(family_id)
        all_category_meta_by_key = get_shared_deck_category_meta_by_key()
        category_meta_by_key = {
            key: meta
            for key, meta in all_category_meta_by_key.items()
            if can_family_access_deck_category(meta, family_id=family_id, is_super=is_super)
        }
        type_iii_category_keys = get_type_iii_category_keys(category_meta_by_key)

        if is_admin_view:
            kids_with_admin_summary = []
            for kid in kids:
                conn = None
                try:
                    conn = get_kid_connection_for(kid, read_only=True)
                except Exception:
                    conn = None
                try:
                    opted_in_category_keys = get_kid_opted_in_deck_category_keys(
                        kid,
                        category_meta_by_key=category_meta_by_key,
                        conn=conn,
                    )
                    practice_target_by_deck_category = get_kid_practice_target_by_deck_category(
                        kid,
                        opted_in_category_keys,
                        category_meta_by_key,
                        conn=conn,
                    )
                    ungraded_count = get_kid_ungraded_type_iii_count(
                        kid,
                        type_iii_category_keys=type_iii_category_keys,
                        conn=conn,
                    )
                    kids_with_admin_summary.append({
                        **kid,
                        'typeIIIToReviewCount': ungraded_count,
                        'optedInDeckCategoryKeys': opted_in_category_keys,
                        'practiceTargetByDeckCategory': practice_target_by_deck_category,
                        'deckCategoryMetaByKey': category_meta_by_key,
                    })
                finally:
                    if conn is not None:
                        conn.close()

            return jsonify(kids_with_admin_summary), 200

        family_timezone = metadata.get_family_timezone(family_id)
        kids_with_progress = []
        for kid in kids:
            conn = None
            try:
                conn = get_kid_connection_for(kid, read_only=True)
            except Exception:
                conn = None
            try:
                opted_in_category_keys = get_kid_opted_in_deck_category_keys(
                    kid,
                    category_meta_by_key=category_meta_by_key,
                    conn=conn,
                )
                practice_target_by_deck_category = get_kid_practice_target_by_deck_category(
                    kid,
                    opted_in_category_keys,
                    category_meta_by_key,
                    conn=conn,
                )
                (
                    today_counts,
                    today_star_tiers,
                    today_latest_percent,
                    today_latest_target_count,
                    today_latest_tried_count,
                    today_latest_right_count,
                    ungraded_count,
                ) = get_kid_dashboard_stats(
                    kid,
                    category_meta_by_key=category_meta_by_key,
                    type_iii_category_keys=type_iii_category_keys,
                    conn=conn,
                    family_timezone=family_timezone,
                )
                daily_completed_by_deck_category = get_kid_daily_completed_by_deck_category(
                    kid,
                    opted_in_category_keys,
                    today_counts=today_counts,
                )
                daily_star_tiers_by_deck_category = get_kid_daily_star_tiers_by_deck_category(
                    opted_in_category_keys,
                    today_star_tiers=today_star_tiers,
                )
                daily_percent_by_deck_category = get_kid_daily_percent_by_deck_category(
                    opted_in_category_keys,
                    today_latest_percent=today_latest_percent,
                )
                daily_target_by_deck_category = {
                    key: int(today_latest_target_count.get(key, 0) or 0)
                    for key in opted_in_category_keys
                }
                daily_tried_by_deck_category = {
                    key: int(today_latest_tried_count.get(key, 0) or 0)
                    for key in opted_in_category_keys
                }
                daily_right_by_deck_category = {
                    key: int(today_latest_right_count.get(key, 0) or 0)
                    for key in opted_in_category_keys
                }
                kid_with_progress = {
                    **kid,
                    'dailyCompletedCountToday': int(today_counts.get('total', 0) or 0),
                    'typeIIIToReviewCount': ungraded_count,
                    'optedInDeckCategoryKeys': opted_in_category_keys,
                    'dailyCompletedByDeckCategory': daily_completed_by_deck_category,
                    'dailyStarTiersByDeckCategory': daily_star_tiers_by_deck_category,
                    'dailyPercentByDeckCategory': daily_percent_by_deck_category,
                    'dailyTargetByDeckCategory': daily_target_by_deck_category,
                    'dailyTriedByDeckCategory': daily_tried_by_deck_category,
                    'dailyRightByDeckCategory': daily_right_by_deck_category,
                    'practiceTargetByDeckCategory': practice_target_by_deck_category,
                    'deckCategoryMetaByKey': category_meta_by_key,
                }
                kids_with_progress.append(kid_with_progress)
            finally:
                if conn is not None:
                    conn.close()

        return jsonify(kids_with_progress), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids', methods=['POST'])
def create_kid():
    """Create a new kid"""
    try:
        data = request.get_json()

        # Validate required fields
        if not data.get('name'):
            return jsonify({'error': 'Name is required'}), 400

        family_id = current_family_id()
        if not family_id:
            return jsonify({'error': 'Family login required'}), 401

        # Save to metadata (ID assigned atomically inside the lock)
        kid = metadata.add_kid({
            'familyId': family_id,
            'name': data['name'],
            'createdAt': datetime.now().isoformat()
        })
        kid_id = kid['id']
        db_relpath = f"data/families/family_{family_id}/kid_{kid_id}.db"
        metadata.update_kid(kid_id, {'dbFilePath': db_relpath}, family_id)

        # Initialize kid's database
        kid_db.init_kid_database_by_path(db_relpath)

        return jsonify(kid), 201

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>', methods=['GET'])
def get_kid(kid_id):
    """Get a specific kid"""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        view = str(request.args.get('view') or '').strip().lower()
        include_dashboard_metrics = view not in {'practice_session', 'manage'}
        include_ungraded_count = view not in {'practice_home', 'practice_session', 'manage'}

        family_id = str(kid.get('familyId') or '').strip()
        family_timezone = metadata.get_family_timezone(family_id)
        is_super = is_super_family_id(family_id)
        all_category_meta_by_key = get_shared_deck_category_meta_by_key()
        category_meta_by_key = {
            key: meta
            for key, meta in all_category_meta_by_key.items()
            if can_family_access_deck_category(meta, family_id=family_id, is_super=is_super)
        }
        conn = None
        try:
            conn = get_kid_connection_for(kid, read_only=True)
        except Exception:
            conn = None
        try:
            if include_dashboard_metrics:
                (
                    today_counts,
                    today_star_tiers,
                    today_latest_percent,
                    today_latest_target_count,
                    today_latest_tried_count,
                    today_latest_right_count,
                    ungraded_count,
                ) = get_kid_dashboard_stats(
                    kid,
                    category_meta_by_key=category_meta_by_key,
                    type_iii_category_keys=get_type_iii_category_keys(category_meta_by_key),
                    include_ungraded_count=include_ungraded_count,
                    conn=conn,
                    family_timezone=family_timezone,
                )
            else:
                today_counts = defaultdict(int)
                today_star_tiers = defaultdict(list)
                today_latest_percent = defaultdict(float)
                today_latest_target_count = defaultdict(int)
                today_latest_tried_count = defaultdict(int)
                today_latest_right_count = defaultdict(int)
                ungraded_count = 0
            opted_in_category_keys = get_kid_opted_in_deck_category_keys(
                kid,
                category_meta_by_key=category_meta_by_key,
                conn=conn,
            )
            practice_target_by_deck_category = get_kid_practice_target_by_deck_category(
                kid,
                opted_in_category_keys,
                category_meta_by_key,
                conn=conn,
            )
        finally:
            if conn is not None:
                conn.close()
        if include_dashboard_metrics:
            daily_completed_by_deck_category = get_kid_daily_completed_by_deck_category(
                kid,
                opted_in_category_keys,
                today_counts=today_counts,
            )
            daily_star_tiers_by_deck_category = get_kid_daily_star_tiers_by_deck_category(
                opted_in_category_keys,
                today_star_tiers=today_star_tiers,
            )
            daily_percent_by_deck_category = get_kid_daily_percent_by_deck_category(
                opted_in_category_keys,
                today_latest_percent=today_latest_percent,
            )
        else:
            daily_completed_by_deck_category = {}
            daily_star_tiers_by_deck_category = {}
            daily_percent_by_deck_category = {}
        daily_target_by_deck_category = {
            key: int(today_latest_target_count.get(key, 0) or 0)
            for key in opted_in_category_keys
        }
        daily_tried_by_deck_category = {
            key: int(today_latest_tried_count.get(key, 0) or 0)
            for key in opted_in_category_keys
        }
        daily_right_by_deck_category = {
            key: int(today_latest_right_count.get(key, 0) or 0)
            for key in opted_in_category_keys
        }
        kid_with_progress = {
            **kid,
            'dailyCompletedCountToday': int(today_counts.get('total', 0) or 0),
            'typeIIIToReviewCount': ungraded_count,
            'optedInDeckCategoryKeys': opted_in_category_keys,
            'dailyCompletedByDeckCategory': daily_completed_by_deck_category,
            'dailyStarTiersByDeckCategory': daily_star_tiers_by_deck_category,
            'dailyPercentByDeckCategory': daily_percent_by_deck_category,
            'dailyTargetByDeckCategory': daily_target_by_deck_category,
            'dailyTriedByDeckCategory': daily_tried_by_deck_category,
            'dailyRightByDeckCategory': daily_right_by_deck_category,
            'practiceTargetByDeckCategory': practice_target_by_deck_category,
            'deckCategoryMetaByKey': category_meta_by_key,
        }

        return jsonify(kid_with_progress), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/deck-categories', methods=['GET'])
def get_kid_deck_categories(kid_id):
    """Get available/opted-in deck categories for one kid."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        family_id = str(kid.get('familyId') or '').strip()
        is_super = is_super_family_id(family_id)

        shared_conn = get_shared_decks_connection(read_only=True)
        try:
            all_categories = get_shared_deck_categories(shared_conn)
        finally:
            shared_conn.close()
        categories = [
            item for item in all_categories
            if can_family_access_deck_category(
                item,
                family_id=family_id,
                is_super=is_super,
            )
        ]

        category_keys = [
            normalize_shared_deck_tag(item.get('category_key'))
            for item in categories
            if normalize_shared_deck_tag(item.get('category_key'))
        ]
        allowed_keys = set(category_keys)
        category_meta_by_key = {}
        for item in categories:
            key = normalize_shared_deck_tag(item.get('category_key'))
            if not key:
                continue
            category_meta_by_key[key] = {
                'display_name': str(item.get('display_name') or '').strip(),
                'emoji': str(item.get('emoji') or '').strip(),
                'behavior_type': str(item.get('behavior_type') or '').strip().lower(),
                'has_chinese_specific_logic': bool(item.get('has_chinese_specific_logic')),
                'is_shared_with_non_super_family': bool(item.get('is_shared_with_non_super_family')),
            }

        kid_conn = get_kid_connection_for(kid, read_only=True)
        try:
            rows = kid_conn.execute(
                f"""
                SELECT category_key
                FROM {KID_DECK_CATEGORY_OPT_IN_TABLE}
                WHERE {KID_DECK_CATEGORY_OPT_IN_COL_IS_OPTED_IN} = TRUE
                ORDER BY category_key ASC
                """
            ).fetchall()
        finally:
            kid_conn.close()

        opted_in_keys = []
        seen = set()
        for row in rows:
            key = normalize_shared_deck_tag(row[0])
            if not key or key not in allowed_keys or key in seen:
                continue
            seen.add(key)
            opted_in_keys.append(key)

        opted_in_key_set = set(opted_in_keys)
        available_keys = [key for key in category_keys if key not in opted_in_key_set]

        return jsonify({
            'kid_id': str(kid.get('id') or ''),
            'available_category_keys': available_keys,
            'opted_in_category_keys': opted_in_keys,
            'all_category_keys': category_keys,
            'category_meta_by_key': category_meta_by_key,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/deck-categories', methods=['PUT'])
def update_kid_deck_categories(kid_id):
    """Replace opted-in deck categories for one kid."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        family_id = str(kid.get('familyId') or '').strip()
        is_super = is_super_family_id(family_id)

        payload = request.get_json() or {}
        category_keys = normalize_deck_category_keys(payload.get('categoryKeys'))

        shared_conn = get_shared_decks_connection(read_only=True)
        try:
            allowed_keys = {
                normalize_shared_deck_tag(item.get('category_key'))
                for item in get_shared_deck_categories(shared_conn)
                if can_family_access_deck_category(
                    item,
                    family_id=family_id,
                    is_super=is_super,
                )
                if normalize_shared_deck_tag(item.get('category_key'))
            }
        finally:
            shared_conn.close()

        invalid = [key for key in category_keys if key not in allowed_keys]
        if invalid:
            return jsonify({'error': f'Unknown category key(s): {", ".join(invalid)}'}), 400

        kid_conn = get_kid_connection_for(kid)
        try:
            kid_conn.execute(
                f"UPDATE {KID_DECK_CATEGORY_OPT_IN_TABLE} SET {KID_DECK_CATEGORY_OPT_IN_COL_IS_OPTED_IN} = FALSE"
            )
            if category_keys:
                kid_conn.executemany(
                    f"""
                    INSERT INTO {KID_DECK_CATEGORY_OPT_IN_TABLE} (
                      category_key,
                      {KID_DECK_CATEGORY_OPT_IN_COL_IS_OPTED_IN}
                    )
                    VALUES (?, TRUE)
                    ON CONFLICT (category_key)
                    DO UPDATE SET {KID_DECK_CATEGORY_OPT_IN_COL_IS_OPTED_IN} = TRUE
                    """,
                    [[key] for key in category_keys],
                )
                for key in category_keys:
                    get_or_create_category_orphan_deck(kid_conn, key)
        finally:
            kid_conn.close()

        kid['optedInDeckCategoryKeys'] = list(category_keys)

        return jsonify({
            'updated': True,
            'kid_id': str(kid.get('id') or ''),
            'opted_in_category_keys': category_keys,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/report', methods=['GET'])
def get_kid_report(kid_id):
    """Get one kid's practice history report for parent view."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = get_kid_connection_for(kid, read_only=True)
        try:
            rows = conn.execute(
                """
                WITH unresolved_cards AS (
                    SELECT sr.session_id, sr.card_id
                    FROM session_results sr
                    WHERE sr.card_id IS NOT NULL
                      AND sr.correct != 1
                ),
                session_results_agg AS (
                    SELECT
                        sr.session_id,
                        COUNT(*) AS answer_count,
                        COALESCE(SUM(CASE WHEN sr.response_time_ms IS NULL THEN 0 ELSE sr.response_time_ms END), 0) AS total_response_ms
                    FROM session_results sr
                    GROUP BY sr.session_id
                ),
                unresolved_counts AS (
                    SELECT session_id, COUNT(*) AS unresolved_count
                    FROM unresolved_cards
                    GROUP BY session_id
                )
                SELECT
                    s.id,
                    s.type,
                    s.started_at,
                    s.completed_at,
                    COALESCE(s.planned_count, 0) AS planned_count,
                    COALESCE(s.retry_count, 0) AS retry_count,
                    COALESCE(s.retry_total_response_ms, 0) AS retry_total_response_ms,
                    COALESCE(s.retry_best_rety_correct_count, 0) AS retry_best_rety_correct_count,
                    COALESCE(a.answer_count, 0) AS answer_count,
                    GREATEST(
                        0,
                        COALESCE(a.answer_count, 0) - COALESCE(uc.unresolved_count, 0)
                    ) AS right_count,
                    COALESCE(uc.unresolved_count, 0) AS wrong_count,
                    COALESCE(a.total_response_ms, 0) AS total_response_ms,
                    COALESCE(s.practice_mode, 'na') AS practice_mode
                FROM sessions s
                LEFT JOIN session_results_agg a ON a.session_id = s.id
                LEFT JOIN unresolved_counts uc ON uc.session_id = s.id
                ORDER BY COALESCE(s.completed_at, s.started_at) DESC, s.id DESC
                """
            ).fetchall()
            practiced_card_rows = conn.execute(
                """
                SELECT DISTINCT session_id, card_id
                FROM session_results
                WHERE card_id IS NOT NULL
                ORDER BY session_id ASC, card_id ASC
                """
            ).fetchall()
        finally:
            conn.close()

        category_meta_by_key = get_shared_deck_category_meta_by_key()
        family_id = str(kid.get('familyId') or '').strip()
        family_timezone = metadata.get_family_timezone(family_id)
        practiced_card_ids_by_session_id = defaultdict(list)
        for row in practiced_card_rows:
            try:
                session_id_int = int(row[0] or 0)
                card_id_int = int(row[1] or 0)
            except (TypeError, ValueError):
                continue
            if session_id_int > 0 and card_id_int > 0:
                practiced_card_ids_by_session_id[session_id_int].append(card_id_int)
        sessions = []
        for row in rows:
            session_id = int(row[0])
            session_type = normalize_shared_deck_tag(row[1])
            session_category_display_name = get_deck_category_display_name(session_type, category_meta_by_key)
            session_category_emoji = str((category_meta_by_key.get(session_type) or {}).get('emoji') or '').strip()
            sessions.append({
                'id': session_id,
                'type': row[1],
                'behavior_type': get_session_behavior_type(session_type, category_meta_by_key),
                'category_display_name': session_category_display_name,
                'category_emoji': session_category_emoji,
                'started_at': row[2].isoformat() if row[2] else None,
                'completed_at': row[3].isoformat() if row[3] else None,
                'planned_count': int(row[4] or 0),
                'retry_count': int(row[5] or 0),
                'retry_total_response_ms': int(row[6] or 0),
                'retry_best_rety_correct_count': int(row[7] or 0),
                'answer_count': int(row[8] or 0),
                'right_count': int(row[9] or 0),
                'wrong_count': int(row[10] or 0),
                'total_response_ms': int(row[11] or 0),
                'practice_mode': normalize_session_practice_mode(row[12]),
                'practiced_card_ids': practiced_card_ids_by_session_id.get(session_id, []),
            })

        return jsonify({
            'kid': {
                'id': kid.get('id'),
                'name': kid.get('name'),
            },
            'family_timezone': family_timezone,
            'sessions': sessions
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/report/sessions/<session_id>', methods=['GET'])
def get_kid_report_session_detail(kid_id, session_id):
    """Get detailed card-level results for one session in parent report view."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        try:
            session_id_int = int(session_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid session id'}), 400

        conn = get_kid_connection_for(kid, read_only=True)
        session_row = conn.execute(
            """
            SELECT
                id,
                type,
                started_at,
                completed_at,
                COALESCE(planned_count, 0),
                COALESCE(retry_count, 0),
                COALESCE(retry_total_response_ms, 0),
                COALESCE(retry_best_rety_correct_count, 0),
                COALESCE(practice_mode, 'na') AS practice_mode
            FROM sessions
            WHERE id = ?
            """,
            [session_id_int]
        ).fetchone()
        if not session_row:
            conn.close()
            return jsonify({'error': 'Session not found'}), 404

        def _session_source_deck_label(local_deck_name):
            local_name = str(local_deck_name or '').strip()
            if not local_name:
                return ''
            if local_name == get_category_orphan_deck_name(session_type):
                return 'Personal Deck'
            _, _, tail_name = local_name.partition('__')
            return tail_name.strip() or local_name

        result_rows = conn.execute(
            """
            SELECT
                sr.id,
                sr.card_id,
                sr.correct,
                COALESCE(sr.response_time_ms, 0) AS response_time_ms,
                sr.timestamp,
                c.front,
                c.back,
                d.name,
                lra.file_name,
                lra.mime_type,
                t1.distractor_answers,
                t1.submitted_answers,
                t1.submitted_grades,
                t4.prompt,
                t4.answer,
                t4.submitted_answers,
                t4.submitted_grades
            FROM session_results sr
            LEFT JOIN cards c ON c.id = sr.card_id
            LEFT JOIN decks d ON d.id = c.deck_id
            LEFT JOIN lesson_reading_audio lra ON lra.result_id = sr.id
            LEFT JOIN type1_result_item t1 ON t1.result_id = sr.id
            LEFT JOIN type4_result_item t4 ON t4.result_id = sr.id
            WHERE sr.session_id = ?
            ORDER BY sr.id ASC
            """,
            [session_id_int]
        ).fetchall()
        conn.close()
        session_type = normalize_shared_deck_tag(session_row[1])
        session_behavior_type = get_session_behavior_type(session_type)
        category_meta_by_key = get_shared_deck_category_meta_by_key()
        session_category_meta = category_meta_by_key.get(session_type) or {}
        session_category_display_name = get_deck_category_display_name(session_type, category_meta_by_key)

        answers = []
        right_cards = []
        wrong_cards = []
        for row in result_rows:
            correct_score = int(row[2] or 0)
            type1_distractor_answers = [
                str(a).strip()
                for a in list(row[10] or [])
                if str(a or '').strip()
            ]
            type1_submitted_answers = [
                str(a).strip()
                for a in list(row[11] or [])
                if str(a or '').strip()
            ]
            type1_submitted_grades = [int(g) for g in list(row[12] or [])]
            materialized_prompt = str(row[13] or '').strip()
            materialized_answer = str(row[14] or '').strip()
            type4_submitted_answers = [
                str(a).strip()
                for a in list(row[15] or [])
                if str(a or '').strip()
            ]
            type4_submitted_grades = [int(g) for g in list(row[16] or [])]
            submitted_answers = (
                type4_submitted_answers
                if materialized_prompt or materialized_answer or type4_submitted_answers
                else type1_submitted_answers
            )
            submitted_grades = (
                type4_submitted_grades
                if materialized_prompt or materialized_answer or type4_submitted_grades
                else type1_submitted_grades
            )
            item = {
                'result_id': int(row[0]),
                'card_id': int(row[1]) if row[1] is not None else None,
                'correct_score': correct_score,
                'correct': correct_score == 1 or correct_score <= -2,
                'response_time_ms': int(row[3] or 0),
                'timestamp': row[4].isoformat() if row[4] else None,
                'front': row[5] or '',
                'back': row[6] or '',
                'source_deck_name': str(row[7] or '').strip(),
                'source_deck_label': _session_source_deck_label(row[7]),
                'grade_status': (
                    'pass' if correct_score == 1 or correct_score <= -2
                    else ('partial' if correct_score == 2 else ('fail' if correct_score < 0 else 'unknown'))
                ),
                'audio_file_name': row[8] or None,
                'audio_mime_type': row[9] or None,
                'audio_url': f"/api/kids/{kid_id}/lesson-reading/audio/{row[8]}" if row[8] else None,
                'distractor_answers': type1_distractor_answers,
                'materialized_prompt': materialized_prompt,
                'materialized_answer': materialized_answer,
                'submitted_answers': submitted_answers,
                'submitted_grades': submitted_grades,
            }
            answers.append(item)
            if correct_score == 1 or correct_score <= -2:
                right_cards.append(item)
            elif correct_score < 0 or correct_score == 2:
                wrong_cards.append(item)

        return jsonify({
            'kid': {
                'id': kid.get('id'),
                'name': kid.get('name'),
            },
            'session': {
                'id': int(session_row[0]),
                'type': session_row[1],
                'behavior_type': session_behavior_type,
                'has_chinese_specific_logic': bool(session_category_meta.get('has_chinese_specific_logic')),
                'category_display_name': session_category_display_name,
                'started_at': session_row[2].isoformat() if session_row[2] else None,
                'completed_at': session_row[3].isoformat() if session_row[3] else None,
                'planned_count': int(session_row[4] or 0),
                'retry_count': int(session_row[5] or 0),
                'retry_total_response_ms': int(session_row[6] or 0),
                'retry_best_rety_correct_count': int(session_row[7] or 0),
                'practice_mode': normalize_session_practice_mode(session_row[8]),
                'answer_count': len(answers),
                'right_count': len(right_cards),
                'wrong_count': len(wrong_cards),
            },
            'right_cards': right_cards,
            'wrong_cards': wrong_cards,
            'answers': answers,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/report/type-iii/next-to-grade', methods=['GET'])
def get_kid_type_iii_next_to_grade(kid_id):
    """Return the latest type-III session that still has ungraded cards."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        category_meta_by_key = get_shared_deck_category_meta_by_key()
        requested_category_key = normalize_shared_deck_tag(request.args.get('categoryKey'))
        if requested_category_key:
            category_meta = category_meta_by_key.get(requested_category_key)
            if not isinstance(category_meta, dict):
                return jsonify({'error': 'Unknown categoryKey'}), 400
            behavior_type = str(category_meta.get('behavior_type') or '').strip().lower()
            if behavior_type != DECK_CATEGORY_BEHAVIOR_TYPE_III:
                return jsonify({'error': 'categoryKey must be a type-III deck category'}), 400
            type_iii_category_keys = [requested_category_key]
        else:
            type_iii_category_keys = get_type_iii_category_keys(category_meta_by_key)

        if not type_iii_category_keys:
            return jsonify({
                'session_id': None,
                'latest_session_id': None,
                'has_ungraded': False,
            }), 200

        placeholders = ', '.join(['?'] * len(type_iii_category_keys))
        conn = get_kid_connection_for(kid, read_only=True)

        ungraded_row = conn.execute(
            f"""
            SELECT s.id
            FROM sessions s
            JOIN session_results sr ON sr.session_id = s.id
            WHERE s.type IN ({placeholders})
              AND s.completed_at IS NOT NULL
              AND sr.correct = 0
            GROUP BY s.id, s.completed_at
            ORDER BY s.completed_at DESC, s.id DESC
            LIMIT 1
            """,
            type_iii_category_keys,
        ).fetchone()

        latest_row = conn.execute(
            f"""
            SELECT s.id
            FROM sessions s
            WHERE s.type IN ({placeholders})
              AND s.completed_at IS NOT NULL
            ORDER BY s.completed_at DESC, s.id DESC
            LIMIT 1
            """,
            type_iii_category_keys,
        ).fetchone()
        conn.close()

        return jsonify({
            'session_id': int(ungraded_row[0]) if ungraded_row else None,
            'latest_session_id': int(latest_row[0]) if latest_row else None,
            'has_ungraded': bool(ungraded_row),
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/report/cards/<card_id>', methods=['GET'])
def get_kid_report_card_detail(kid_id, card_id):
    """Get full practice history for one card in parent report view."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        try:
            card_id_int = int(card_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid card id'}), 400

        conn = get_kid_connection_for(kid, read_only=True)
        card_row = conn.execute(
            """
            SELECT
                c.id,
                c.front,
                c.back,
                c.created_at,
                COALESCE(c.hardness_score, 0) AS hardness_score,
                d.id,
                d.name
            FROM cards c
            JOIN decks d ON d.id = c.deck_id
            WHERE c.id = ?
            """,
            [card_id_int]
        ).fetchone()
        if not card_row:
            conn.close()
            return jsonify({'error': 'Card not found'}), 404

        attempts_rows = conn.execute(
            """
            SELECT
                sr.id,
                sr.correct,
                COALESCE(sr.response_time_ms, 0) AS response_time_ms,
                sr.timestamp,
                s.id AS session_id,
                s.type AS session_type,
                s.started_at,
                s.completed_at,
                COALESCE(s.retry_total_response_ms, 0) AS retry_total_response_ms,
                lra.file_name,
                lra.mime_type,
                t1.distractor_answers,
                t1.submitted_answers,
                t1.submitted_grades,
                t4.prompt,
                t4.answer,
                t4.submitted_answers,
                t4.submitted_grades
            FROM session_results sr
            JOIN sessions s ON s.id = sr.session_id
            LEFT JOIN lesson_reading_audio lra ON lra.result_id = sr.id
            LEFT JOIN type1_result_item t1 ON t1.result_id = sr.id
            LEFT JOIN type4_result_item t4 ON t4.result_id = sr.id
            WHERE sr.card_id = ?
            ORDER BY COALESCE(s.completed_at, s.started_at, sr.timestamp) ASC, sr.id ASC
            """,
            [card_id_int]
        ).fetchall()
        conn.close()

        category_meta_by_key = get_shared_deck_category_meta_by_key()
        attempts = []
        right_count = 0
        wrong_count = 0
        ungraded_count = 0
        response_sum_ms = 0
        for row in attempts_rows:
            correct_score = int(row[1] or 0)
            is_correct = correct_score == 1 or correct_score <= -2
            response_ms = int(row[2] or 0)
            session_type = normalize_shared_deck_tag(row[5])
            session_behavior_type = get_session_behavior_type(session_type, category_meta_by_key)
            type1_distractor_answers = [
                str(a).strip()
                for a in list(row[11] or [])
                if str(a or '').strip()
            ]
            type1_submitted_answers = [
                str(a).strip()
                for a in list(row[12] or [])
                if str(a or '').strip()
            ]
            type1_submitted_grades = [int(g) for g in list(row[13] or [])]
            materialized_prompt = str(row[14] or '').strip()
            materialized_answer = str(row[15] or '').strip()
            type4_submitted_answers = [
                str(a).strip()
                for a in list(row[16] or [])
                if str(a or '').strip()
            ]
            type4_submitted_grades = [int(g) for g in list(row[17] or [])]
            submitted_answers = (
                type4_submitted_answers
                if materialized_prompt or materialized_answer or type4_submitted_answers
                else type1_submitted_answers
            )
            submitted_grades = (
                type4_submitted_grades
                if materialized_prompt or materialized_answer or type4_submitted_grades
                else type1_submitted_grades
            )
            attempt_submission_count = max(1, len(submitted_answers)) if materialized_prompt else 1
            avg_response_ms = float(response_ms)
            if materialized_prompt and attempt_submission_count > 1:
                avg_response_ms = (
                    float(response_ms) + float(int(row[8] or 0))
                ) / float(attempt_submission_count)
            attempts.append({
                'result_id': int(row[0]),
                'correct': is_correct,
                'correct_score': correct_score,
                'grade_status': (
                    'pass' if is_correct
                    else ('partial' if correct_score == 2 else ('fail' if correct_score < 0 else 'ungraded'))
                ),
                'response_time_ms': response_ms,
                'avg_response_ms': avg_response_ms,
                'timestamp': row[3].isoformat() if row[3] else None,
                'session_id': int(row[4]) if row[4] is not None else None,
                'session_type': row[5],
                'session_behavior_type': session_behavior_type,
                'session_category_display_name': get_deck_category_display_name(session_type, category_meta_by_key),
                'session_started_at': row[6].isoformat() if row[6] else None,
                'session_completed_at': row[7].isoformat() if row[7] else None,
                'retry_total_response_ms': int(row[8] or 0),
                'audio_file_name': row[9] or None,
                'audio_mime_type': row[10] or None,
                'audio_url': f"/api/kids/{kid_id}/lesson-reading/audio/{row[9]}" if row[9] else None,
                'distractor_answers': type1_distractor_answers,
                'materialized_prompt': materialized_prompt,
                'materialized_answer': materialized_answer,
                'submitted_answers': submitted_answers,
                'submitted_grades': submitted_grades,
            })
            response_sum_ms += avg_response_ms
            if correct_score == 1 or correct_score <= SESSION_RESULT_RETRY_FIXED_FIRST:
                right_count += 1
            elif correct_score < 0:
                wrong_count += 1
            else:
                ungraded_count += 1

        attempts_count = len(attempts)
        avg_response_ms = (response_sum_ms / attempts_count) if attempts_count > 0 else 0
        graded_count = right_count + wrong_count
        accuracy_pct = ((right_count * 100.0) / graded_count) if graded_count > 0 else 0

        return jsonify({
            'kid': {
                'id': kid.get('id'),
                'name': kid.get('name'),
            },
            'card': {
                'id': int(card_row[0]),
                'front': card_row[1] or '',
                'back': card_row[2] or '',
                'created_at': card_row[3].isoformat() if card_row[3] else None,
                'hardness_score': float(card_row[4] or 0),
                'deck_id': int(card_row[5]) if card_row[5] is not None else None,
                'deck_name': card_row[6] or '',
            },
            'summary': {
                'attempt_count': attempts_count,
                'right_count': right_count,
                'wrong_count': wrong_count,
                'ungraded_count': ungraded_count,
                'accuracy_pct': accuracy_pct,
                'avg_response_ms': avg_response_ms,
            },
            'attempts': attempts,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/report/sessions/<session_id>/results/<result_id>/grade', methods=['PUT'])
def grade_kid_report_session_result(kid_id, session_id, result_id):
    """Persist parent pass/fail grade for one session result row."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        try:
            session_id_int = int(session_id)
            result_id_int = int(result_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid session id or result id'}), 400

        data = request.get_json() or {}
        review_grade_raw = str(data.get('reviewGrade') or '').strip().lower()
        if review_grade_raw not in ('pass', 'fail'):
            return jsonify({'error': 'reviewGrade must be "pass" or "fail"'}), 400

        conn = get_kid_connection_for(kid)
        target = conn.execute(
            """
            SELECT sr.id, sr.correct, s.type
            FROM session_results sr
            JOIN sessions s ON s.id = sr.session_id
            WHERE sr.id = ? AND sr.session_id = ?
            LIMIT 1
            """,
            [result_id_int, session_id_int],
        ).fetchone()
        if not target:
            conn.close()
            return jsonify({'error': 'Session result not found'}), 404

        session_type = normalize_shared_deck_tag(target[2])
        if not is_type_iii_session_type(session_type):
            conn.close()
            return jsonify({'error': 'Only type-III session results support grading'}), 400

        current_correct = int(target[1] or 0)
        if current_correct != 0:
            status = 'pass' if current_correct > 0 else 'fail'
            conn.close()
            return jsonify({
                'error': 'This card has already been graded and cannot be changed.',
                'result_id': result_id_int,
                'grade_status': status,
            }), 409

        mapped_correct = 1 if review_grade_raw == 'pass' else -1
        conn.execute(
            "UPDATE session_results SET correct = ? WHERE id = ?",
            [mapped_correct, result_id_int]
        )
        conn.close()

        return jsonify({
            'result_id': result_id_int,
            'correct_score': mapped_correct,
            'grade_status': review_grade_raw,
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/report/results/<result_id>/response-time', methods=['PUT'])
def backfill_kid_report_result_response_time(kid_id, result_id):
    """Backfill type-III response time from browser-observed audio duration."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        try:
            result_id_int = int(result_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid result id'}), 400
        if result_id_int <= 0:
            return jsonify({'error': 'Invalid result id'}), 400

        data = request.get_json() or {}
        try:
            response_time_ms = int(data.get('responseTimeMs'))
        except (TypeError, ValueError):
            return jsonify({'error': 'responseTimeMs must be an integer'}), 400
        if response_time_ms <= 0:
            return jsonify({'error': 'responseTimeMs must be > 0'}), 400

        conn = get_kid_connection_for(kid)
        try:
            row = conn.execute(
                """
                SELECT
                    sr.id,
                    sr.card_id,
                    COALESCE(sr.response_time_ms, 0) AS response_time_ms,
                    s.type
                FROM session_results sr
                JOIN sessions s ON s.id = sr.session_id
                WHERE sr.id = ?
                LIMIT 1
                """,
                [result_id_int]
            ).fetchone()
            if not row:
                return jsonify({'error': 'Session result not found'}), 404

            card_id = int(row[1]) if row[1] is not None else None
            current_ms = int(row[2] or 0)
            session_type = normalize_shared_deck_tag(row[3])
            if not is_type_iii_session_type(session_type):
                return jsonify({'error': 'Only type-III results support duration backfill'}), 400

            updated = False
            if current_ms <= 0:
                conn.execute(
                    "UPDATE session_results SET response_time_ms = ? WHERE id = ?",
                    [response_time_ms, result_id_int]
                )
                updated = True

                if card_id is not None:
                    latest_row = conn.execute(
                        """
                        SELECT sr.id
                        FROM session_results sr
                        JOIN sessions s ON s.id = sr.session_id
                        WHERE sr.card_id = ? AND s.type = ?
                        ORDER BY COALESCE(s.completed_at, s.started_at, sr.timestamp) DESC, sr.id DESC
                        LIMIT 1
                        """,
                        [card_id, session_type]
                    ).fetchone()
                    if latest_row and int(latest_row[0]) == result_id_int:
                        conn.execute(
                            "UPDATE cards SET hardness_score = ? WHERE id = ?",
                            [float(response_time_ms), card_id]
                        )

            return jsonify({
                'result_id': result_id_int,
                'updated': bool(updated),
                'response_time_ms': int(response_time_ms if updated else current_ms),
            }), 200
        finally:
            conn.close()
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>', methods=['PUT'])
def update_kid(kid_id):
    """Update a specific kid's metadata"""
    try:
        family_id = current_family_id()
        if not family_id:
            return jsonify({'error': 'Family login required'}), 401
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        data = request.get_json() or {}
        metadata_updates = {}
        session_count_updates_by_key = {}
        hard_pct_updates_by_key = {}
        include_orphan_updates_by_key = {}
        category_meta_by_key = get_shared_deck_category_meta_by_key()
        all_category_keys = {
            normalize_shared_deck_tag(raw_key)
            for raw_key in category_meta_by_key.keys()
            if normalize_shared_deck_tag(raw_key)
        }

        if SESSION_CARD_COUNT_BY_CATEGORY_FIELD in data:
            raw_map = data.get(SESSION_CARD_COUNT_BY_CATEGORY_FIELD)
            if not isinstance(raw_map, dict):
                return jsonify({'error': f'{SESSION_CARD_COUNT_BY_CATEGORY_FIELD} must be an object'}), 400
            for raw_key, raw_value in raw_map.items():
                key = normalize_shared_deck_tag(raw_key)
                if key not in all_category_keys:
                    return jsonify({'error': f'Unknown category key in {SESSION_CARD_COUNT_BY_CATEGORY_FIELD}: {raw_key}'}), 400
                try:
                    parsed = int(raw_value)
                except (TypeError, ValueError):
                    return jsonify({'error': f'{SESSION_CARD_COUNT_BY_CATEGORY_FIELD}.{key} must be an integer'}), 400
                if parsed < 0:
                    return jsonify({'error': f'{SESSION_CARD_COUNT_BY_CATEGORY_FIELD}.{key} must be 0 or more'}), 400
                session_count_updates_by_key[key] = parsed

        if HARD_CARD_PERCENT_BY_CATEGORY_FIELD in data:
            raw_map = data.get(HARD_CARD_PERCENT_BY_CATEGORY_FIELD)
            if not isinstance(raw_map, dict):
                return jsonify({'error': f'{HARD_CARD_PERCENT_BY_CATEGORY_FIELD} must be an object'}), 400
            for raw_key, raw_value in raw_map.items():
                key = normalize_shared_deck_tag(raw_key)
                if key not in all_category_keys:
                    return jsonify({'error': f'Unknown category key in {HARD_CARD_PERCENT_BY_CATEGORY_FIELD}: {raw_key}'}), 400
                try:
                    parsed = int(raw_value)
                except (TypeError, ValueError):
                    return jsonify({'error': f'{HARD_CARD_PERCENT_BY_CATEGORY_FIELD}.{key} must be an integer'}), 400
                if parsed < MIN_HARD_CARD_PERCENTAGE or parsed > MAX_HARD_CARD_PERCENTAGE:
                    return jsonify({'error': f'{HARD_CARD_PERCENT_BY_CATEGORY_FIELD}.{key} must be between {MIN_HARD_CARD_PERCENTAGE} and {MAX_HARD_CARD_PERCENTAGE}'}), 400
                hard_pct_updates_by_key[key] = parsed

        if INCLUDE_ORPHAN_BY_CATEGORY_FIELD in data:
            raw_map = data.get(INCLUDE_ORPHAN_BY_CATEGORY_FIELD)
            if not isinstance(raw_map, dict):
                return jsonify({'error': f'{INCLUDE_ORPHAN_BY_CATEGORY_FIELD} must be an object'}), 400
            for raw_key, raw_value in raw_map.items():
                key = normalize_shared_deck_tag(raw_key)
                if key not in all_category_keys:
                    return jsonify({'error': f'Unknown category key in {INCLUDE_ORPHAN_BY_CATEGORY_FIELD}: {raw_key}'}), 400
                if not isinstance(raw_value, bool):
                    return jsonify({'error': f'{INCLUDE_ORPHAN_BY_CATEGORY_FIELD}.{key} must be a boolean'}), 400
                include_orphan_updates_by_key[key] = raw_value

        if TYPE_I_NON_CHINESE_DECK_MIX_FIELD in data:
            if not isinstance(data[TYPE_I_NON_CHINESE_DECK_MIX_FIELD], dict):
                return jsonify({'error': f'{TYPE_I_NON_CHINESE_DECK_MIX_FIELD} must be an object'}), 400
            metadata_updates[TYPE_I_NON_CHINESE_DECK_MIX_FIELD] = sanitize_deck_mix_payload(
                data[TYPE_I_NON_CHINESE_DECK_MIX_FIELD]
            )

        has_db_updates = bool(
            session_count_updates_by_key
            or hard_pct_updates_by_key
            or include_orphan_updates_by_key
        )
        if not has_db_updates and not metadata_updates:
            return jsonify({'error': 'No supported fields to update'}), 400

        if has_db_updates:
            kid_conn = get_kid_connection_for(kid)
            try:
                if session_count_updates_by_key:
                    kid_conn.executemany(
                        f"""
                        INSERT INTO {KID_DECK_CATEGORY_OPT_IN_TABLE} (
                          category_key,
                          {KID_DECK_CATEGORY_OPT_IN_COL_SESSION_CARD_COUNT}
                        )
                        VALUES (?, ?)
                        ON CONFLICT (category_key)
                        DO UPDATE SET {KID_DECK_CATEGORY_OPT_IN_COL_SESSION_CARD_COUNT} = EXCLUDED.{KID_DECK_CATEGORY_OPT_IN_COL_SESSION_CARD_COUNT}
                        """,
                        [
                            [key, int(value)]
                            for key, value in session_count_updates_by_key.items()
                        ],
                    )
                if hard_pct_updates_by_key:
                    kid_conn.executemany(
                        f"""
                        INSERT INTO {KID_DECK_CATEGORY_OPT_IN_TABLE} (
                          category_key,
                          {KID_DECK_CATEGORY_OPT_IN_COL_HARD_CARD_PERCENTAGE}
                        )
                        VALUES (?, ?)
                        ON CONFLICT (category_key)
                        DO UPDATE SET {KID_DECK_CATEGORY_OPT_IN_COL_HARD_CARD_PERCENTAGE} = EXCLUDED.{KID_DECK_CATEGORY_OPT_IN_COL_HARD_CARD_PERCENTAGE}
                        """,
                        [
                            [key, int(value)]
                            for key, value in hard_pct_updates_by_key.items()
                        ],
                    )
                if include_orphan_updates_by_key:
                    kid_conn.executemany(
                        f"""
                        INSERT INTO {KID_DECK_CATEGORY_OPT_IN_TABLE} (
                          category_key,
                          {KID_DECK_CATEGORY_OPT_IN_COL_INCLUDE_ORPHAN}
                        )
                        VALUES (?, ?)
                        ON CONFLICT (category_key)
                        DO UPDATE SET {KID_DECK_CATEGORY_OPT_IN_COL_INCLUDE_ORPHAN} = EXCLUDED.{KID_DECK_CATEGORY_OPT_IN_COL_INCLUDE_ORPHAN}
                        """,
                        [
                            [key, bool(value)]
                            for key, value in include_orphan_updates_by_key.items()
                        ],
                    )
            finally:
                kid_conn.close()

        if metadata_updates:
            updated_kid = metadata.update_kid(kid_id, metadata_updates, family_id=family_id)
        else:
            updated_kid = metadata.get_kid_by_id(kid_id, family_id=family_id)
        if not updated_kid:
            return jsonify({'error': 'Kid not found'}), 404
        hydrate_kid_category_config_from_db(
            updated_kid,
            category_meta_by_key=category_meta_by_key,
            force_reload=True,
        )

        return jsonify(updated_kid), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>', methods=['DELETE'])
def delete_kid(kid_id):
    """Delete a kid and their database"""
    try:
        auth_err = require_critical_password()
        if auth_err:
            return auth_err
        family_id = current_family_id()
        if not family_id:
            return jsonify({'error': 'Family login required'}), 401
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        # Delete database file
        kid_db.delete_kid_database_by_path(kid.get('dbFilePath') or get_kid_scoped_db_relpath(kid))
        type3_audio_dir = get_kid_type3_audio_dir(kid)
        if os.path.exists(type3_audio_dir):
            shutil.rmtree(type3_audio_dir, ignore_errors=True)

        # Delete from metadata
        metadata.delete_kid(kid_id, family_id=family_id)

        return jsonify({'message': 'Kid deleted successfully'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# Card routes

