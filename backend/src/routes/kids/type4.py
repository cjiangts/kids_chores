"""Type IV math routes — print-config, math-sheets."""
from src.routes.kids_constants import (
    DECK_CATEGORY_BEHAVIOR_TYPE_IV,
    DEFAULT_TYPE_IV_PRINT_SHEET_PAPER_SIZE,
    SESSION_RESULT_CORRECT,
    SESSION_RESULT_PARTIAL,
    SESSION_RESULT_RETRY_FIXED_FIRST,
    SESSION_RESULT_WRONG_UNRESOLVED,
)
from src.routes.kids import (
    build_type_iv_print_sheet_display_number,
    build_type_iv_print_sheet_layout,
    build_type_iv_print_sheet_layout_payload,
    build_type_iv_print_sheet_rendered_rows,
    current_family_id,
    encode_retry_recovered_session_result,
    get_kid_connection_for,
    get_kid_for_family,
    get_kid_materialized_shared_decks_by_first_tag,
    get_shared_deck_generator_definitions_by_deck_ids,
    get_shared_decks_connection,
    get_shared_type_iv_deck_rows,
    get_type_iv_print_sheet_record,
    is_super_family_id,
    json,
    jsonify,
    kids_bp,
    normalize_type_iv_print_sheet_paper_size,
    normalize_type_iv_print_sheet_repeat_count,
    normalize_type_iv_print_sheet_rows,
    paginate_type_iv_print_sheet_rendered_rows,
    request,
    resolve_kid_type_iv_category_with_mode,
    sync_badges_after_session_complete,
    time,
)
from src.services.practice_mode import normalize_session_practice_mode
from src.services.kid_today_sessions import normalize_logged_response_time_ms
from src.services.session_grading import (
    append_type4_result_submitted_answer,
    grade_type_iv_answer,
    insert_type4_result_item,
    normalize_type_iv_submitted_answer,
)

@kids_bp.route('/kids/<kid_id>/type4/print-config', methods=['GET'])
def get_type4_print_config(kid_id):
    """Return type-IV deck print configurations for a kid's category."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        can_design_cell = is_super_family_id(current_family_id())
        category_key, _ = resolve_kid_type_iv_category_with_mode(
            kid,
            request.args.get('categoryKey'),
            allow_default=True,
        )
        shared_conn = None
        kid_conn = None
        try:
            shared_conn = get_shared_decks_connection(read_only=True)
            decks = get_shared_type_iv_deck_rows(shared_conn, category_key)
            shared_deck_ids = [int(d['deck_id']) for d in decks]
            definitions = get_shared_deck_generator_definitions_by_deck_ids(shared_conn, shared_deck_ids)

            kid_conn = get_kid_connection_for(kid, read_only=True)
            materialized_by_local_id = get_kid_materialized_shared_decks_by_first_tag(
                kid_conn, category_key,
            )
            local_by_shared_id = {}
            for entry in materialized_by_local_id.values():
                sid = int(entry['shared_deck_id'])
                existing = local_by_shared_id.get(sid)
                if existing is None or int(entry['local_deck_id']) < int(existing['local_deck_id']):
                    local_by_shared_id[sid] = entry

            result_decks = []
            for deck_info in decks:
                deck_id = int(deck_info['deck_id'])
                deck_name = str(deck_info.get('name') or f'Deck {deck_id}')
                defn = definitions.get(deck_id) or {}
                is_materialized = deck_id in local_by_shared_id
                display_name = str(deck_info.get('representative_front') or '').strip() or deck_name
                result_decks.append({
                    'shared_deck_id': deck_id,
                    'name': deck_name,
                    'display_name': display_name,
                    'opted_in': is_materialized,
                    'cell_design': defn.get('cell_design'),
                })
        finally:
            if shared_conn is not None:
                shared_conn.close()
            if kid_conn is not None:
                kid_conn.close()

        return jsonify({
            'category_key': category_key,
            'decks': result_decks,
            'can_design_cell': bool(can_design_cell),
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type4/math-sheets', methods=['POST'])
def create_type4_print_sheet(kid_id):
    """Persist one custom printable math sheet in preview status."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        payload = request.get_json(silent=True) or {}
        category_key, _ = resolve_kid_type_iv_category_with_mode(
            kid,
            payload.get('categoryKey') or request.args.get('categoryKey'),
            allow_default=True,
        )
        layout_format = str(payload.get('layoutFormat') or 'vertical').strip().lower()
        if layout_format not in ('vertical', 'inline'):
            layout_format = 'vertical'
        paper_size = normalize_type_iv_print_sheet_paper_size(payload.get('paperSize'))
        repeat_count = normalize_type_iv_print_sheet_repeat_count(payload.get('repeatCount'))
        requested_rows = normalize_type_iv_print_sheet_rows(payload.get('rows'), layout_format=layout_format)

        kid_conn = None
        shared_conn = None
        try:
            kid_conn = get_kid_connection_for(kid, read_only=True)
            materialized_by_local_id = get_kid_materialized_shared_decks_by_first_tag(
                kid_conn, category_key,
            )
            opted_in_shared_ids = {
                int(entry['shared_deck_id'])
                for entry in materialized_by_local_id.values()
                if entry.get('shared_deck_id') is not None
            }

            shared_conn = get_shared_decks_connection(read_only=True)
            deck_rows = get_shared_type_iv_deck_rows(shared_conn, category_key)
            deck_rows_by_id = {
                int(deck['deck_id']): deck
                for deck in list(deck_rows or [])
                if deck.get('deck_id') is not None
            }
            requested_deck_ids = [int(row['shared_deck_id']) for row in requested_rows]
            for row in requested_rows:
                if int(row['shared_deck_id']) not in opted_in_shared_ids:
                    return jsonify({'error': 'Each row must use an opted-in deck for this kid'}), 400
                if int(row['shared_deck_id']) not in deck_rows_by_id:
                    return jsonify({'error': 'Each row must use a deck from this math category'}), 400
            definitions_by_id = get_shared_deck_generator_definitions_by_deck_ids(
                shared_conn,
                requested_deck_ids,
            )
            layout_payload = build_type_iv_print_sheet_layout_payload(
                requested_rows,
                deck_rows_by_id,
                definitions_by_id,
                layout_format=layout_format,
                repeat_count=repeat_count,
                paper_size=paper_size,
            )
        finally:
            if kid_conn is not None:
                kid_conn.close()
            if shared_conn is not None:
                shared_conn.close()

        seed_base = int(time.time_ns() % 2_000_000_000)
        layout_json = json.dumps(layout_payload, ensure_ascii=False, separators=(',', ':'))

        conn = None
        try:
            conn = get_kid_connection_for(kid)
            sheet_id = conn.execute(
                """
                INSERT INTO type4_print_sheets (category_key, layout_json, seed_base, status)
                VALUES (?, ?, ?, 'preview')
                RETURNING id
                """,
                [category_key, layout_json, seed_base],
            ).fetchone()[0]
        finally:
            if conn is not None:
                conn.close()

        layout_rows = list(layout_payload.get('rows') or [])
        return jsonify({
            'created': True,
            'sheet_id': int(sheet_id),
            'status': 'preview',
            'seed_base': seed_base,
            'sheet': {
                'id': int(sheet_id),
                'status': 'preview',
                'category_key': category_key,
                'paper_size': str(layout_payload.get('paper_size') or paper_size),
                'repeat_count': repeat_count,
                'row_count': len(layout_rows),
                'problem_count': sum(int(row.get('col_count') or 0) for row in layout_rows),
                'layout_rows': [
                    {
                        'shared_deck_id': int(row.get('shared_deck_id') or 0),
                        'deck_name': str(row.get('deck_name') or ''),
                        'scale': float(row.get('scale') or 1),
                        'col_count': int(row.get('col_count') or 0),
                    }
                    for row in layout_rows
                ],
            },
        }), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type4/math-sheets', methods=['GET'])
def list_type4_print_sheets(kid_id):
    """List persisted custom printable math sheets for one kid/category."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        category_key, _ = resolve_kid_type_iv_category_with_mode(
            kid,
            request.args.get('categoryKey'),
            allow_default=True,
        )

        conn = None
        try:
            conn = get_kid_connection_for(kid, read_only=True)
            rows = conn.execute(
                """
                SELECT id, category_key, layout_json, seed_base, status, incorrect_count, created_at, completed_at
                FROM type4_print_sheets
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
            sheet = {
                'id': int(row[0]),
                'category_key': str(row[1] or '').strip().lower(),
                'layout': build_type_iv_print_sheet_layout(row[2]),
                'seed_base': int(row[3] or 0),
                'status': str(row[4] or '').strip().lower(),
                'incorrect_count': int(row[5]) if row[5] is not None else None,
                'created_at': row[6].isoformat() if row[6] else None,
                'completed_at': row[7].isoformat() if row[7] else None,
            }
            sheet_layout = sheet.get('layout') or {}
            layout_rows = list(sheet_layout.get('rows') or [])
            sheet_layout_format = str(sheet_layout.get('layout_format') or 'vertical')
            sheets.append({
                'id': sheet['id'],
                'category_key': sheet['category_key'],
                'seed_base': sheet['seed_base'],
                'status': sheet['status'],
                'incorrect_count': sheet['incorrect_count'],
                'created_at': sheet['created_at'],
                'completed_at': sheet['completed_at'],
                'paper_size': str(sheet_layout.get('paper_size') or DEFAULT_TYPE_IV_PRINT_SHEET_PAPER_SIZE),
                'repeat_count': int(sheet_layout.get('repeat_count') or 1),
                'page_count': int(sheet_layout.get('repeat_count') or 1),
                'row_count': len(layout_rows),
                'problem_count': sum(int(item.get('col_count') or 0) for item in layout_rows),
                'layout_format': sheet_layout_format,
                'layout_rows': [
                    {
                        'shared_deck_id': int(item.get('shared_deck_id') or 0),
                        'deck_name': str(item.get('deck_name') or ''),
                        'scale': float(item.get('scale') or 1),
                        'col_count': int(item.get('col_count') or 0),
                    }
                    for item in layout_rows
                ],
            })

        return jsonify({'sheets': sheets}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type4/math-sheets/<int:sheet_id>', methods=['GET'])
def get_type4_print_sheet_details(kid_id, sheet_id):
    """Return one persisted custom sheet with generated row problems for preview/print."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = None
        try:
            conn = get_kid_connection_for(kid, read_only=True)
            sheet = get_type_iv_print_sheet_record(conn, sheet_id)
        finally:
            if conn is not None:
                conn.close()
        if not sheet:
            return jsonify({'error': 'Sheet not found'}), 404
        if not sheet.get('layout'):
            return jsonify({'error': 'Sheet layout is invalid'}), 500

        layout_rows = list(sheet['layout'].get('rows') or [])
        paper_size = str(
            (sheet.get('layout') or {}).get('paper_size')
            or DEFAULT_TYPE_IV_PRINT_SHEET_PAPER_SIZE
        ).strip().lower()
        saved_repeat_count = int((sheet.get('layout') or {}).get('repeat_count') or 1)
        repeat_count = saved_repeat_count
        if sheet.get('status') == 'preview' and request.args.get('repeatCount') not in (None, ''):
            repeat_count = normalize_type_iv_print_sheet_repeat_count(request.args.get('repeatCount'))
        shared_deck_ids = list({
            int(row['shared_deck_id'])
            for row in layout_rows
            if row.get('shared_deck_id') is not None
        })

        shared_conn = None
        try:
            shared_conn = get_shared_decks_connection(read_only=True)
            definitions_by_id = get_shared_deck_generator_definitions_by_deck_ids(
                shared_conn,
                shared_deck_ids,
            )
        finally:
            if shared_conn is not None:
                shared_conn.close()

        layout_format = str((sheet.get('layout') or {}).get('layout_format') or 'vertical')
        kid_name = str(kid.get('name') or '')
        rendered_page_batches = []
        try:
            for repeat_index in range(repeat_count):
                page_seed_base = int(sheet['seed_base']) + repeat_index
                rendered_rows = build_type_iv_print_sheet_rendered_rows(
                    layout_rows,
                    definitions_by_id,
                    page_seed_base,
                )
                rendered_page_batches.append({
                    'seed_base': page_seed_base,
                    'pages': paginate_type_iv_print_sheet_rendered_rows(
                        rendered_rows,
                        paper_size=paper_size,
                        layout_format=layout_format,
                    ),
                })
        except LookupError as exc:
            return jsonify({'error': str(exc)}), 404

        total_page_count = sum(
            len(batch.get('pages') or [])
            for batch in rendered_page_batches
        )
        pages = []
        for page_number, batch in enumerate(
            [
                {
                    'seed_base': batch['seed_base'],
                    'layout_rows': layout_rows_page,
                }
                for batch in rendered_page_batches
                for layout_rows_page in list(batch.get('pages') or [])
            ]
        ):
            page_rows = list(batch.get('layout_rows') or [])
            pages.append({
                'id': sheet['id'],
                'sheet_id': sheet['id'],
                'page_index': page_number + 1,
                'display_sheet_number': build_type_iv_print_sheet_display_number(
                    sheet['id'],
                    page_index=page_number,
                    total_pages=total_page_count,
                ),
                'seed_base': batch['seed_base'],
                'row_count': len(page_rows),
                'problem_count': sum(int(row.get('col_count') or 0) for row in page_rows),
                'kid_name': kid_name,
                'layout_rows': page_rows,
                'layout_format': layout_format,
                'paper_size': paper_size,
            })

        first_page = pages[0] if pages else {
            'display_sheet_number': build_type_iv_print_sheet_display_number(sheet['id']),
            'row_count': 0,
            'problem_count': 0,
            'layout_rows': [],
        }
        layout_format = str((sheet.get('layout') or {}).get('layout_format') or 'vertical')
        return jsonify({
            'sheet': {
                'id': sheet['id'],
                'category_key': sheet['category_key'],
                'seed_base': sheet['seed_base'],
                'status': sheet['status'],
                'incorrect_count': sheet['incorrect_count'],
                'created_at': sheet['created_at'],
                'completed_at': sheet['completed_at'],
                'paper_size': paper_size,
                'repeat_count': repeat_count,
                'saved_repeat_count': saved_repeat_count,
                'page_count': len(pages),
                'display_sheet_number': str(first_page.get('display_sheet_number') or sheet['id']),
                'row_count': int(first_page.get('row_count') or 0),
                'problem_count': int(first_page.get('problem_count') or 0),
                'total_problem_count': sum(int(page.get('problem_count') or 0) for page in pages),
                'kid_name': kid_name,
                'layout_rows': list(first_page.get('layout_rows') or []),
                'layout_format': layout_format,
                'pages': pages,
            },
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type4/math-sheets/<int:sheet_id>/complete', methods=['POST'])
def complete_type4_print_sheet(kid_id, sheet_id):
    """Mark one persisted custom sheet as done."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        payload = request.get_json(silent=True) or {}
        incorrect_count = payload.get('incorrect_count')
        if incorrect_count is not None:
            incorrect_count = int(incorrect_count)
            if incorrect_count < 0:
                incorrect_count = 0

        conn = None
        try:
            conn = get_kid_connection_for(kid)
            row = conn.execute(
                "SELECT id, status FROM type4_print_sheets WHERE id = ?",
                [sheet_id],
            ).fetchone()
            if not row:
                return jsonify({'error': 'Sheet not found'}), 404
            if str(row[1] or '').strip().lower() != 'done':
                conn.execute(
                    """
                    UPDATE type4_print_sheets
                    SET status = 'done', incorrect_count = ?, completed_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    [incorrect_count, sheet_id],
                )
        finally:
            if conn is not None:
                conn.close()

        return jsonify({'sheet_id': int(sheet_id), 'status': 'done'}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type4/math-sheets/<int:sheet_id>/withdraw', methods=['POST'])
def withdraw_type4_print_sheet(kid_id, sheet_id):
    """Delete one preview/pending custom sheet."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        conn = None
        try:
            conn = get_kid_connection_for(kid)
            row = conn.execute(
                "SELECT id, status FROM type4_print_sheets WHERE id = ?",
                [sheet_id],
            ).fetchone()
            if not row:
                return jsonify({'error': 'Sheet not found'}), 404
            status = str(row[1] or '').strip().lower()
            if status not in ('preview', 'pending'):
                return jsonify({'error': 'Only preview or pending sheets can be withdrawn'}), 400
            conn.execute("DELETE FROM type4_print_sheets WHERE id = ?", [sheet_id])
        finally:
            if conn is not None:
                conn.close()

        return jsonify({'sheet_id': int(sheet_id), 'deleted': True}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type4/math-sheets/<int:sheet_id>/regenerate', methods=['POST'])
def regenerate_type4_print_sheet(kid_id, sheet_id):
    """Regenerate a preview custom sheet with a fresh base seed."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404

        new_seed = int(time.time_ns() % 2_000_000_000)
        conn = None
        try:
            conn = get_kid_connection_for(kid)
            row = conn.execute(
                "SELECT id, status FROM type4_print_sheets WHERE id = ?",
                [sheet_id],
            ).fetchone()
            if not row:
                return jsonify({'error': 'Sheet not found'}), 404
            if str(row[1] or '').strip().lower() != 'preview':
                return jsonify({'error': 'Only preview sheets can be regenerated'}), 400
            conn.execute(
                "UPDATE type4_print_sheets SET seed_base = ? WHERE id = ?",
                [new_seed, sheet_id],
            )
        finally:
            if conn is not None:
                conn.close()

        return jsonify({'sheet_id': int(sheet_id), 'seed_base': new_seed}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@kids_bp.route('/kids/<kid_id>/type4/math-sheets/<int:sheet_id>/finalize', methods=['POST'])
def finalize_type4_print_sheet(kid_id, sheet_id):
    """Move one preview custom sheet into pending status."""
    try:
        kid = get_kid_for_family(kid_id)
        if not kid:
            return jsonify({'error': 'Kid not found'}), 404
        payload = request.get_json(silent=True) or {}

        conn = None
        try:
            conn = get_kid_connection_for(kid)
            row = conn.execute(
                "SELECT id, status, layout_json FROM type4_print_sheets WHERE id = ?",
                [sheet_id],
            ).fetchone()
            if not row:
                return jsonify({'error': 'Sheet not found'}), 404
            if str(row[1] or '').strip().lower() != 'preview':
                return jsonify({'error': 'Only preview sheets can be finalized'}), 400
            layout = build_type_iv_print_sheet_layout(row[2])
            if not layout:
                return jsonify({'error': 'Sheet layout is invalid'}), 500
            repeat_count = normalize_type_iv_print_sheet_repeat_count(
                payload.get('repeatCount') if payload.get('repeatCount') not in (None, '') else layout.get('repeat_count')
            )
            layout['repeat_count'] = repeat_count
            layout_json = json.dumps(layout, ensure_ascii=False, separators=(',', ':'))
            conn.execute(
                "UPDATE type4_print_sheets SET status = 'pending', layout_json = ? WHERE id = ?",
                [layout_json, sheet_id],
            )
        finally:
            if conn is not None:
                conn.close()

        return jsonify({
            'sheet_id': int(sheet_id),
            'status': 'pending',
            'repeat_count': repeat_count,
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


## ── Type-2 Chinese print sheets (builder) ──────────────────────────────────


def complete_type_iv_session_internal(
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
):
    """Complete one generator practice session using server-side grading."""
    pending_cards = pending.get('cards')
    if not isinstance(pending_cards, list) or len(pending_cards) == 0:
        conn.close()
        return {'error': 'Pending session is missing generated questions'}, 400

    pending_by_id = {}
    for item in pending_cards:
        if not isinstance(item, dict):
            continue
        try:
            item_id = int(item.get('id'))
        except (TypeError, ValueError):
            continue
        if item_id <= 0:
            continue
        pending_by_id[item_id] = item
    if len(pending_by_id) == 0:
        conn.close()
        return {'error': 'Pending session is missing generated questions'}, 400

    normalized_answers = []
    for answer in answers:
        try:
            item_id = int(answer.get('cardId'))
        except (TypeError, ValueError):
            conn.close()
            return {'error': 'Each answer needs cardId (int)'}, 400
        pending_item = pending_by_id.get(item_id)
        if not pending_item:
            conn.close()
            return {'error': 'answers do not match this pending session'}, 400
        response_time_ms = normalize_logged_response_time_ms(
            answer.get('responseTimeMs'),
            session_behavior_type=DECK_CATEGORY_BEHAVIOR_TYPE_IV,
        )
        normalized_answers.append({
            'item_id': item_id,
            'pending_item': pending_item,
            'submitted_answer': normalize_type_iv_submitted_answer(answer.get('submittedAnswer')),
            'response_time_ms': response_time_ms,
        })

    try:
        conn.execute("BEGIN TRANSACTION")

        if is_retry_session:
            source_row = conn.execute(
                """
                SELECT
                    s.id,
                    COUNT(sr.id) AS answer_count,
                    COALESCE(SUM(CASE WHEN sr.correct = 1 THEN 1 ELSE 0 END), 0) AS right_count,
                    COALESCE(SUM(CASE WHEN sr.correct < 0 OR sr.correct = ? THEN 1 ELSE 0 END), 0) AS wrong_count,
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
                [SESSION_RESULT_PARTIAL, retry_source_session_id, session_type],
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
            retry_partial_count = 0
            retry_total_response_ms = 0
            retry_success_result_ids = []
            retry_partial_result_ids = []
            for answer in normalized_answers:
                submitted_answer = answer['submitted_answer']
                pending_item = answer['pending_item']
                expected_answer = normalize_type_iv_submitted_answer(pending_item.get('answer'))
                retry_correct_value = grade_type_iv_answer(
                    submitted_answer, expected_answer, pending_item.get('validate')
                )
                is_correct = retry_correct_value == SESSION_RESULT_CORRECT
                if retry_correct_value == SESSION_RESULT_PARTIAL:
                    retry_partial_count += 1
                    retry_partial_result_ids.append(int(answer['item_id']))
                if is_correct:
                    retry_right_count += 1
                    retry_success_result_ids.append(int(answer['item_id']))
                else:
                    retry_wrong_count += 1
                retry_total_response_ms += int(answer['response_time_ms'] or 0)
                append_type4_result_submitted_answer(
                    conn,
                    answer['item_id'],
                    submitted_answer,
                    retry_correct_value,
                )

            if retry_success_result_ids:
                placeholders = ','.join(['?'] * len(retry_success_result_ids))
                recovered_correct_value = encode_retry_recovered_session_result(source_retry_count)
                conn.execute(
                    f"""
                    UPDATE session_results
                    SET correct = ?
                    WHERE id IN ({placeholders})
                      AND session_id = ?
                      AND correct IN (?, ?)
                    """,
                    [
                        recovered_correct_value,
                        *sorted(retry_success_result_ids),
                        int(retry_source_session_id),
                        SESSION_RESULT_WRONG_UNRESOLVED,
                        SESSION_RESULT_PARTIAL,
                    ],
                )

            if retry_partial_result_ids:
                partial_placeholders = ','.join(['?'] * len(retry_partial_result_ids))
                conn.execute(
                    f"""
                    UPDATE session_results
                    SET correct = ?
                    WHERE id IN ({partial_placeholders})
                      AND session_id = ?
                      AND correct = ?
                    """,
                    [
                        SESSION_RESULT_PARTIAL,
                        *sorted(retry_partial_result_ids),
                        int(retry_source_session_id),
                        SESSION_RESULT_WRONG_UNRESOLVED,
                    ],
                )

            best_retry_row = conn.execute(
                """
                SELECT COUNT(*)
                FROM session_results
                WHERE session_id = ?
                  AND correct <= ?
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

            conn.execute("COMMIT")
            conn.close()
            sync_badges_after_session_complete(kid)
            updated_retry_count = int(updated_retry_row[0] or 0) if updated_retry_row else 0
            updated_retry_total_ms = int(updated_retry_row[1] or 0) if updated_retry_row else 0
            updated_best_retry_correct = int(updated_retry_row[2] or 0) if updated_retry_row else 0
            total_correct_percent = (
                float(source_right_count + updated_best_retry_correct) * 100.0 / float(source_target_answer_count)
                if source_target_answer_count > 0 else 0.0
            )
            achieved_gold_star = total_correct_percent >= 100.0
            attempt_count_today_for_chain = 1 + max(0, updated_retry_count)
            return {
                'session_id': int(retry_source_session_id),
                'answer_count': len(normalized_answers),
                'planned_count': planned_count,
                'right_count': retry_right_count,
                'wrong_count': retry_wrong_count,
                'partial_count': retry_partial_count,
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
                'attempt_star_tiers': ['gold'],
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
            partial_count = 0
            for answer in normalized_answers:
                pending_item = answer['pending_item']
                representative_card_id = int(pending_item.get('representative_card_id') or 0)
                if representative_card_id <= 0:
                    raise ValueError('Pending generator item is missing representative card')
                submitted_answer = answer['submitted_answer']
                expected_answer = normalize_type_iv_submitted_answer(pending_item.get('answer'))
                correct_value = grade_type_iv_answer(
                    submitted_answer, expected_answer, pending_item.get('validate')
                )
                if correct_value == SESSION_RESULT_PARTIAL:
                    partial_count += 1
                elif correct_value > 0:
                    right_count += 1
                else:
                    wrong_count += 1
                result_row = conn.execute(
                    """
                    INSERT INTO session_results (session_id, card_id, correct, response_time_ms)
                    VALUES (?, ?, ?, ?)
                    RETURNING id
                    """,
                    [
                        continue_source_session_id,
                        representative_card_id,
                        correct_value,
                        int(answer['response_time_ms'] or 0),
                    ],
                ).fetchone()
                insert_type4_result_item(
                    conn,
                    int(result_row[0]),
                    pending_item,
                    submitted_answer,
                    correct_value,
                )

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
            updated_answer_count = max(0, int(updated_row[1] or 0)) if updated_row else (source_answer_count + len(normalized_answers))
            updated_right_count = max(0, int(updated_row[2] or 0)) if updated_row else (source_right_count + right_count)
            updated_wrong_count = max(0, int(updated_row[3] or 0)) if updated_row else (source_wrong_count + wrong_count)
            target_answer_count = max(updated_planned_count, updated_answer_count, updated_right_count + updated_wrong_count)
            is_incomplete = updated_planned_count > 0 and updated_answer_count < updated_planned_count
            total_correct_percentage = (
                float(updated_answer_count) * 100.0 / float(max(1, target_answer_count))
                if is_incomplete
                else float(updated_right_count) * 100.0 / float(max(1, target_answer_count))
            )
            achieved_gold_star = (not is_incomplete) and total_correct_percentage >= 100.0
            star_tier = 'half_silver' if is_incomplete else 'gold'
            attempt_star_tiers = ['half_silver'] if is_incomplete else ['gold']

            conn.execute("COMMIT")
            conn.close()
            sync_badges_after_session_complete(kid)
            return {
                'session_id': int(continue_source_session_id),
                'answer_count': int(updated_answer_count),
                'planned_count': int(updated_planned_count),
                'right_count': int(updated_right_count),
                'wrong_count': int(updated_wrong_count),
                'partial_count': int(partial_count),
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
        partial_count = 0
        session_practice_mode = normalize_session_practice_mode(pending.get('practice_mode'))
        session_id = conn.execute(
            """
            INSERT INTO sessions (type, planned_count, retry_count, retry_total_response_ms, retry_best_rety_correct_count, started_at, completed_at, practice_mode)
            VALUES (?, ?, 0, 0, 0, ?, ?, ?)
            RETURNING id
            """,
            [session_type, planned_count, started_at_utc, completed_at_utc, session_practice_mode]
        ).fetchone()[0]

        for answer in normalized_answers:
            pending_item = answer['pending_item']
            representative_card_id = int(pending_item.get('representative_card_id') or 0)
            if representative_card_id <= 0:
                raise ValueError('Pending generator item is missing representative card')
            submitted_answer = answer['submitted_answer']
            expected_answer = normalize_type_iv_submitted_answer(pending_item.get('answer'))
            correct_value = grade_type_iv_answer(
                submitted_answer, expected_answer, pending_item.get('validate')
            )
            if correct_value == SESSION_RESULT_PARTIAL:
                partial_count += 1
            elif correct_value > 0:
                right_count += 1
            else:
                wrong_count += 1
            result_row = conn.execute(
                """
                INSERT INTO session_results (session_id, card_id, correct, response_time_ms)
                VALUES (?, ?, ?, ?)
                RETURNING id
                """,
                [
                    session_id,
                    representative_card_id,
                    correct_value,
                    int(answer['response_time_ms'] or 0),
                ],
            ).fetchone()
            insert_type4_result_item(
                conn,
                int(result_row[0]),
                pending_item,
                submitted_answer,
                correct_value,
            )

        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        conn.close()
        raise

    conn.close()
    sync_badges_after_session_complete(kid)
    target_answer_count = int(max(planned_count, len(normalized_answers), right_count + wrong_count + partial_count))
    is_incomplete = planned_count > 0 and len(normalized_answers) < planned_count
    total_correct_percentage = (
        float(len(normalized_answers)) * 100.0 / float(max(1, target_answer_count))
        if is_incomplete
        else float(right_count) * 100.0 / float(max(1, target_answer_count))
    )
    achieved_gold_star = (not is_incomplete) and total_correct_percentage >= 100.0
    star_tier = 'half_silver' if is_incomplete else 'gold'
    attempt_star_tiers = ['half_silver'] if is_incomplete else ['gold']
    return {
        'session_id': session_id,
        'answer_count': len(normalized_answers),
        'planned_count': planned_count,
        'right_count': int(right_count),
        'wrong_count': int(wrong_count),
        'partial_count': int(partial_count),
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
        'achieved_gold_star': bool(achieved_gold_star),
        'star_tier': star_tier,
    }, 200
