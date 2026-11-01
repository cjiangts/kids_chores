import json
import math
import unicodedata
from datetime import datetime
from threading import RLock

from src.services.chinese_sheet_layout import column_cards, column_characters
from src.services.deck_source_merge import get_shared_merged_source_decks_for_kid
from src.services.kid_category_config import get_category_session_card_count_for_kid
from src.services.points import _family_day_bounds_utc, pull_in_app_chore_events_for_today
from src.services.shared_deck_category import get_shared_deck_category_meta_by_key
from src.services.type4_generator_definitions import get_shared_deck_generator_definitions_by_deck_ids
from src.services.type4_print_layout import build_type_iv_print_sheet_layout, get_type_iv_print_sheet_paper_spec
from src.services.type4_print_sheet import build_type_iv_print_pages, get_type_iv_print_sheet_record, paginate_type_iv_print_sheet_rendered_rows

SHEET_TASK_LOCK = RLock()


def sheet_kind_for_category(category_key):
    meta = get_shared_deck_category_meta_by_key().get(category_key) or {}
    if meta.get('behavior_type') == 'type_iv':
        return 'type4'
    if meta.get('behavior_type') == 'type_ii' and meta.get('has_chinese_specific_logic'):
        return 'type2'
    return None


def item_key(item):
    return (item['sheet_kind'], int(item['sheet_id']), int(item['page_index']), int(item['item_index']))


def enumerate_sheet_items(kind, sheet_id, layout):
    rows = layout.get('rows') or []
    if kind == 'type4':
        pages = paginate_type_iv_print_sheet_rendered_rows(rows, paper_size=layout.get('paper_size') or 'letter', layout_format=layout.get('layout_format') or 'vertical')
        for repeat in range(int(layout.get('repeat_count') or 1)):
            for offset, page in enumerate(pages):
                index = 0
                for row_index, row in enumerate(page):
                    for column in range(int(row.get('col_count') or 0)):
                        index += 1
                        yield {'sheet_kind': kind, 'sheet_id': sheet_id, 'page_index': repeat * len(pages) + offset + 1,
                               'item_index': index, 'row_index': row_index, 'column_index': column,
                               'shared_deck_id': int(row['shared_deck_id'])}
        return
    paper = get_type_iv_print_sheet_paper_spec(layout.get('paper_size') or 'letter')
    width = float(paper['box_width'])
    index = 0
    for row_index, row in enumerate(rows):
        size = math.ceil(52 * max(0.5, min(2.0, float(row.get('scale') or 1))))
        columns = max(1, int(width // size))
        empty = max(1, min(9, int(row.get('empty_count') or 1)))
        assigned_cards = column_cards(row, columns, empty)
        characters = column_characters(row, columns, empty)
        for column in range(columns):
            if column % (empty + 1) == 0 and column != columns - 1:
                continue
            index += 1
            yield {'sheet_kind': kind, 'sheet_id': sheet_id, 'page_index': 1, 'item_index': index,
                   'row_index': row_index, 'column_index': column, 'card_id': int(assigned_cards[column]['card_id']),
                   'character': characters[column]}


def read_sheet_inventory(conn, category_key, *, include_used=False):
    kind = sheet_kind_for_category(category_key)
    if not kind:
        return []
    table = 'type4_print_sheets' if kind == 'type4' else 'type2_chinese_print_sheets'
    rows = conn.execute(f"SELECT id, layout_json FROM {table} WHERE category_key = ? AND status = 'pending' ORDER BY created_at, id", [category_key]).fetchall()
    used = set()
    if not include_used and rows:
        ids = [int(row[0]) for row in rows]
        placeholders = ','.join('?' for _ in ids)
        used = set(conn.execute(f'SELECT sheet_kind, sheet_id, page_index, item_index FROM sheet_session_items WHERE sheet_kind = ? AND sheet_id IN ({placeholders})', [kind, *ids]).fetchall())
    items = []
    for sheet_id, raw in rows:
        layout = build_type_iv_print_sheet_layout(raw) if kind == 'type4' else json.loads(raw)
        if not layout:
            continue
        for item in enumerate_sheet_items(kind, int(sheet_id), layout):
            if item_key(item) not in used:
                items.append(item)
    return items


def assignment_unit_key(item):
    if item['sheet_kind'] == 'type2':
        # Repeated copies on one page count once; a later sheet is a new exercise.
        return ('type2', int(item['sheet_id']), int(item['page_index']),
                unicodedata.normalize('NFC', item['character']))
    return item_key(item)


def select_sheet_items(items, target):
    units = dict.fromkeys(assignment_unit_key(item) for item in items)
    selected = set(list(units)[:target])
    # Preserve paper order even when the same character appears in separate rows.
    return [item for item in items if assignment_unit_key(item) in selected], len(selected)


def sheet_target(conn, kid, category_key):
    return max(0, get_category_session_card_count_for_kid(kid, category_key))


def delivery_mode(conn, category_key):
    row = conn.execute('SELECT task_delivery_mode FROM deck_category_opt_in WHERE category_key = ?', [category_key]).fetchone()
    return str(row[0]) if row else 'online'


def get_sheet_task(conn, session_id):
    row = conn.execute("SELECT id, type, planned_count, started_at, completed_at FROM sessions WHERE id = ? AND delivery_mode = 'sheet'", [session_id]).fetchone()
    if not row:
        raise LookupError('Sheet task not found')
    items = conn.execute('SELECT i.id, i.sheet_kind, i.sheet_id, i.page_index, i.item_index, i.result_id, sr.correct, sr.card_id FROM sheet_session_items i LEFT JOIN session_results sr ON sr.id = i.result_id WHERE i.session_id = ? ORDER BY i.id', [session_id]).fetchall()
    mapped = [dict(zip(('id', 'sheet_kind', 'sheet_id', 'page_index', 'item_index', 'result_id', 'correct', 'card_id'), item)) for item in items]
    completion = bool(mapped) and mapped[0]['sheet_kind'] == 'type2'
    # Copying sessions exist only after the child submits. Parent confirmation
    # completes the session without creating any scored session_results.
    reviewed = bool(row[4]) if completion else bool(mapped) and all(item['result_id'] is not None for item in mapped)
    return {'id': int(row[0]), 'category_key': row[1], 'planned_count': int(row[2] or 0),
            'started_at': row[3].isoformat() if row[3] else None, 'completed_at': row[4].isoformat() if row[4] else None,
            'status': 'reviewed' if reviewed else ('pending_review' if completion or row[4] else 'in_progress'),
            'grading_policy': 'per_item' if mapped and mapped[0]['sheet_kind'] == 'type4' else 'completion',
            'practice_box_count': len(mapped) if completion else 0,
            'unique_character_count': int(row[2] or 0) if completion else 0, 'items': mapped}


def current_sheet_task(conn, kid, category_key):
    # A copying task belongs to the child's submission day even if a parent
    # confirms it later. Math sheets keep their existing completion-day rule.
    start, end = _family_day_bounds_utc(kid['familyId'])
    row = conn.execute("""
        SELECT id FROM sessions
        WHERE type = ? AND delivery_mode = 'sheet'
          AND (CASE WHEN EXISTS (SELECT 1 FROM sheet_session_items i WHERE i.session_id = sessions.id AND i.sheet_kind = 'type2')
                    THEN started_at ELSE completed_at END) >= ?
          AND (CASE WHEN EXISTS (SELECT 1 FROM sheet_session_items i WHERE i.session_id = sessions.id AND i.sheet_kind = 'type2')
                    THEN started_at ELSE completed_at END) < ?
        ORDER BY started_at DESC, id DESC LIMIT 1
    """, [category_key, start, end]).fetchone()
    return get_sheet_task(conn, int(row[0])) if row else None


def sheet_summary(conn, kid, category_key):
    supported = bool(sheet_kind_for_category(category_key))
    if not supported:
        return {'supported': False, 'mode': 'online'}
    inventory = read_sheet_inventory(conn, category_key)
    remaining = len({assignment_unit_key(item) for item in inventory})
    target = sheet_target(conn, kid, category_key)
    task = current_sheet_task(conn, kid, category_key)
    available_today = int(task['planned_count']) if task else min(remaining, target)
    return {'supported': True, 'mode': delivery_mode(conn, category_key), 'remaining_count': remaining,
            'target_count': target, 'available_today': available_today,
            'shortage': remaining < target, 'task': task,
            'count_unit': 'character' if sheet_kind_for_category(category_key) == 'type2' else 'question'}


def set_delivery_mode(conn, kid, category_key, mode):
    if mode not in ('online', 'sheet'):
        raise ValueError('Mode must be online or sheet')
    row = conn.execute('SELECT is_opted_in FROM deck_category_opt_in WHERE category_key = ?', [category_key]).fetchone()
    if not row or not row[0] or not sheet_kind_for_category(category_key):
        raise ValueError('This subject does not support sheet tasks')
    conn.execute('UPDATE deck_category_opt_in SET task_delivery_mode = ? WHERE category_key = ?', [mode, category_key])


def preview_sheet_task(conn, kid, category_key):
    if delivery_mode(conn, category_key) != 'sheet' or not sheet_kind_for_category(category_key):
        raise ValueError('Sheet mode is not selected for this subject')
    current = current_sheet_task(conn, kid, category_key)
    if current:
        return current
    items, planned_count = select_sheet_items(read_sheet_inventory(conn, category_key), sheet_target(conn, kid, category_key))
    if not items:
        return None
    return {'id': 'preview', 'category_key': category_key, 'planned_count': planned_count,
            'practice_box_count': len(items) if items[0]['sheet_kind'] == 'type2' else 0,
            'unique_character_count': planned_count if items[0]['sheet_kind'] == 'type2' else 0,
            'started_at': None, 'completed_at': None, 'status': 'in_progress',
            'grading_policy': 'per_item' if items[0]['sheet_kind'] == 'type4' else 'completion',
            'items': [{**item, 'id': index + 1, 'result_id': None, 'correct': None} for index, item in enumerate(items)]}


def submit_sheet_task(conn, kid, category_key, submitted_items):
    task = preview_sheet_task(conn, kid, category_key)
    if not task:
        raise ValueError('No printed questions are available')
    if task['id'] != 'preview':
        return task
    if not isinstance(submitted_items, list) or [item_key(item) for item in submitted_items] != [item_key(item) for item in task['items']]:
        raise ValueError('The available sheet task changed. Reload the page before marking it done.')
    conn.execute('BEGIN TRANSACTION')
    try:
        session_id = conn.execute(
            "INSERT INTO sessions (type, planned_count, delivery_mode, started_at, completed_at) VALUES (?, ?, 'sheet', CURRENT_TIMESTAMP, CASE WHEN ? THEN NULL ELSE CURRENT_TIMESTAMP END) RETURNING id",
            [category_key, task['planned_count'], task['grading_policy'] == 'completion'],
        ).fetchone()[0]
        conn.executemany('INSERT INTO sheet_session_items (session_id, sheet_kind, sheet_id, page_index, item_index) VALUES (?, ?, ?, ?, ?)', [(session_id, *item_key(item)) for item in task['items']])
        conn.execute('COMMIT')
    except Exception:
        conn.execute('ROLLBACK')
        raise
    return get_sheet_task(conn, session_id)


def undo_sheet_task(conn, kid, session_id):
    task = get_sheet_task(conn, session_id)
    if task['status'] == 'reviewed':
        raise ValueError('This task has already been reviewed and cannot be undone')
    conn.execute('BEGIN TRANSACTION')
    try:
        conn.execute('DELETE FROM sheet_session_items WHERE session_id = ?', [session_id])
        conn.execute('DELETE FROM sessions WHERE id = ?', [session_id])
        conn.execute('COMMIT')
    except Exception:
        conn.execute('ROLLBACK')
        raise
    return preview_sheet_task(conn, kid, task['category_key'])


def load_task_problems(conn, shared_conn, kid, task):
    problems = {}
    sheet_refs = list(dict.fromkeys((item['sheet_kind'], item['sheet_id']) for item in task['items']))
    source_map = {int(source['shared_deck_id']): int(source['local_deck_id']) for source in get_shared_merged_source_decks_for_kid(conn, kid, task['category_key']) if source.get('shared_deck_id')}
    for kind, sheet_id in sheet_refs:
        if kind == 'type4':
            sheet = get_type_iv_print_sheet_record(conn, sheet_id)
            if not sheet:
                raise ValueError('An assigned sheet was deleted')
            deck_ids = list({int(row['shared_deck_id']) for row in sheet['layout']['rows']})
            definitions = get_shared_deck_generator_definitions_by_deck_ids(shared_conn, deck_ids)
            for page in build_type_iv_print_pages(sheet, definitions):
                index = 0
                for row in page['layout_rows']:
                    local_deck = source_map.get(int(row['shared_deck_id']))
                    card = conn.execute('SELECT id FROM cards WHERE deck_id = ? ORDER BY id LIMIT 1', [local_deck]).fetchone() if local_deck else None
                    if not card:
                        raise ValueError('A source deck for this printed sheet is no longer available')
                    for problem in row['problems']:
                        index += 1
                        problems[(kind, sheet_id, page['page_index'], index)] = {**problem, 'card_id': int(card[0])}
        else:
            raw = conn.execute('SELECT layout_json FROM type2_chinese_print_sheets WHERE id = ?', [sheet_id]).fetchone()
            if not raw:
                raise ValueError('An assigned sheet was deleted')
            layout = json.loads(raw[0])
            for item in enumerate_sheet_items(kind, sheet_id, layout):
                problems[item_key(item)] = {'card_id': item['card_id'], 'prompt': item['character'], 'answer': item['character']}
    return problems


def review_sheet_task(conn, shared_conn, kid, session_id, grades, *, confirmed=False):
    task = get_sheet_task(conn, session_id)
    if task['status'] == 'reviewed':
        return task
    if task['status'] != 'pending_review':
        raise ValueError('The child must mark this task done before it can be reviewed')
    completion = task['grading_policy'] == 'completion'
    if completion:
        if confirmed is not True:
            raise ValueError('Confirm the writing task is complete before saving')
    else:
        if not isinstance(grades, list) or len(grades) != len(task['items']):
            raise ValueError('Grade every assigned question before saving')
        grade_map = {}
        for grade in grades:
            if not isinstance(grade, dict) or type(grade.get('correct')) is not bool:
                raise ValueError('Each question must have a true or false grade')
            key = int(grade.get('id') or 0)
            if key in grade_map:
                raise ValueError('Duplicate question grade')
            grade_map[key] = grade['correct']
        if set(grade_map) != {item['id'] for item in task['items']}:
            raise ValueError('Grades must match exactly the assigned questions')
        problems = load_task_problems(conn, shared_conn, kid, task)
    conn.execute('BEGIN TRANSACTION')
    try:
        if completion:
            completed_at = conn.execute(
                'UPDATE sessions SET completed_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING completed_at',
                [session_id],
            ).fetchone()[0]
        else:
            completed_at = datetime.fromisoformat(task['completed_at'])
            for item in task['items']:
                problem = problems.get(item_key(item))
                if not problem:
                    raise ValueError('A printed question could not be restored')
                correct = 1 if grade_map[item['id']] else -1
                result_id = conn.execute('INSERT INTO session_results (session_id, card_id, correct, response_time_ms, timestamp) VALUES (?, ?, ?, NULL, ?) RETURNING id', [session_id, problem['card_id'], correct, task['completed_at']]).fetchone()[0]
                if item['sheet_kind'] == 'type4':
                    conn.execute('INSERT INTO type4_result_item (result_id, prompt, answer, submitted_answers, submitted_grades) VALUES (?, ?, ?, [], ?)', [result_id, problem['prompt'], problem['answer'], [correct]])
                conn.execute('UPDATE sheet_session_items SET result_id = ? WHERE id = ?', [result_id, item['id']])
        for kind, sheet_id in set((item['sheet_kind'], item['sheet_id']) for item in task['items']):
            table = 'type4_print_sheets' if kind == 'type4' else 'type2_chinese_print_sheets'
            raw = conn.execute(f'SELECT layout_json FROM {table} WHERE id = ?', [sheet_id]).fetchone()[0]
            layout = build_type_iv_print_sheet_layout(raw) if kind == 'type4' else json.loads(raw)
            total = sum(1 for _ in enumerate_sheet_items(kind, sheet_id, layout))
            done = conn.execute('''SELECT COUNT(*) FROM sheet_session_items i JOIN sessions s ON s.id = i.session_id
                WHERE i.sheet_kind = ? AND i.sheet_id = ?
                  AND ((i.sheet_kind = 'type2' AND s.completed_at IS NOT NULL)
                       OR (i.sheet_kind = 'type4' AND i.result_id IS NOT NULL))''', [kind, sheet_id]).fetchone()[0]
            if total and done == total:
                conn.execute(f"UPDATE {table} SET status = 'done', completed_at = CURRENT_TIMESTAMP WHERE id = ?", [sheet_id])
        pull_in_app_chore_events_for_today(conn, shared_conn, kid['familyId'], trigger_keys=[task['category_key']], at_utc=completed_at, manage_transaction=False)
        conn.execute('COMMIT')
    except Exception:
        conn.execute('ROLLBACK')
        raise
    return get_sheet_task(conn, session_id)


def apply_sheet_statuses(conn, kid, statuses):
    modes = dict(conn.execute("SELECT category_key, task_delivery_mode FROM deck_category_opt_in").fetchall())
    start, end = _family_day_bounds_utc(kid['familyId'])
    rows = conn.execute("""
        SELECT s.id, s.type, s.completed_at, s.planned_count,
               COUNT(i.id),
               SUM(CASE WHEN (i.sheet_kind = 'type2' AND s.completed_at IS NOT NULL)
                             OR (i.sheet_kind = 'type4' AND i.result_id IS NOT NULL) THEN 1 ELSE 0 END) AS reviewed
        FROM sessions s JOIN sheet_session_items i ON i.session_id = s.id
        WHERE s.delivery_mode = 'sheet' AND (s.completed_at IS NOT NULL OR i.sheet_kind = 'type2')
        GROUP BY s.id, s.type, s.completed_at, s.planned_count, s.started_at
        HAVING reviewed < COUNT(i.id)
            OR (CASE WHEN BOOL_OR(i.sheet_kind = 'type2') THEN s.started_at ELSE s.completed_at END >= ?
                AND CASE WHEN BOOL_OR(i.sheet_kind = 'type2') THEN s.started_at ELSE s.completed_at END < ?)
        ORDER BY s.id
    """, [start, end]).fetchall()
    pending = {}
    for session_id, key, completed_at, planned, count, reviewed in rows:
        if key not in statuses:
            continue
        status = statuses[key]
        if count > reviewed:
            pending.setdefault(key, (session_id, count - reviewed))
        status.update({'status': 'done',
                       'sessionId': session_id, 'deliveryMode': 'sheet', 'pendingReview': count > reviewed})
        if count == reviewed:
            status['ungradedCount'] = 0
    for key, (session_id, count) in pending.items():
        statuses[key].update({'status': 'done', 'sessionId': session_id, 'deliveryMode': 'sheet', 'pendingReview': True, 'ungradedCount': count})
    for key, status in statuses.items():
        if modes.get(key) != 'sheet':
            continue
        summary = sheet_summary(conn, kid, key)
        status.update({'taskDeliveryMode': 'sheet', 'sheetAvailableCount': summary['available_today'],
                       'sheetRemainingCount': summary['remaining_count'], 'sheetTargetCount': summary['target_count'], 'sheetShortage': summary['shortage']})
    return statuses


def chinese_sheet_card_states(conn, kid, category_key):
    """Use exactly the remaining finalized inventory counted by the stock badge."""
    inventory = read_sheet_inventory(conn, category_key)
    unit_orders = {unit: index for index, unit in enumerate(dict.fromkeys(
        assignment_unit_key(item) for item in inventory), 1)}
    target = sheet_target(conn, kid, category_key)
    states = {}
    for item in inventory:
        card_id = int(item['card_id'])
        if card_id in states:
            continue
        order = unit_orders[assignment_unit_key(item)]
        states[card_id] = {
            'sheet_print_order': len(states) + 1,
            'sheet_queue_order': order,
            'sheet_next_order': order if order <= target else None,
        }
    return states
