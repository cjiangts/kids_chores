"""Type IV math routes — print-config, math-sheets."""
from src.routes.kids import *  # noqa: F401,F403  -- pulls in kids_bp + helpers/state

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


