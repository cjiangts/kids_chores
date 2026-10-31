import json
import math
from datetime import datetime
from threading import RLock

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
        for column in range(columns):
            if column % (empty + 1) == 0 and column != columns - 1:
                continue
            index += 1
            yield {'sheet_kind': kind, 'sheet_id': sheet_id, 'page_index': 1, 'item_index': index,
                   'row_index': row_index, 'column_index': column, 'card_id': int(row['card_id'])}


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
    reviewed = bool(mapped) and all(item['result_id'] is not None for item in mapped)
    return {'id': int(row[0]), 'category_key': row[1], 'planned_count': int(row[2] or 0),
            'started_at': row[3].isoformat() if row[3] else None, 'completed_at': row[4].isoformat() if row[4] else None,
            'status': 'reviewed' if reviewed else ('pending_review' if row[4] else 'in_progress'),
            'grading_policy': 'per_item' if mapped and mapped[0]['sheet_kind'] == 'type4' else 'completion', 'items': mapped}


def current_sheet_task(conn, kid, category_key):
    start, end = _family_day_bounds_utc(kid['familyId'])
    row = conn.execute("""
        SELECT id FROM sessions
        WHERE type = ? AND delivery_mode = 'sheet'
          AND completed_at >= ? AND completed_at < ?
        ORDER BY completed_at DESC, id DESC LIMIT 1
    """, [category_key, start, end]).fetchone()
    return get_sheet_task(conn, int(row[0])) if row else None


def sheet_summary(conn, kid, category_key):
    supported = bool(sheet_kind_for_category(category_key))
    if not supported:
        return {'supported': False, 'mode': 'online'}
    remaining = len(read_sheet_inventory(conn, category_key))
    target = sheet_target(conn, kid, category_key)
    task = current_sheet_task(conn, kid, category_key)
    available_today = int(task['planned_count']) if task else min(remaining, target)
    return {'supported': True, 'mode': delivery_mode(conn, category_key), 'remaining_count': remaining,
            'target_count': target, 'available_today': available_today,
            'shortage': remaining < target, 'task': task}


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
    items = read_sheet_inventory(conn, category_key)[:sheet_target(conn, kid, category_key)]
    if not items:
        return None
    return {'id': 'preview', 'category_key': category_key, 'planned_count': len(items),
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
            "INSERT INTO sessions (type, planned_count, delivery_mode, started_at, completed_at) VALUES (?, ?, 'sheet', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
            [category_key, len(task['items'])],
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
                row = layout['rows'][item['row_index']]
                problems[item_key(item)] = {'card_id': item['card_id'], 'prompt': row.get('front') or row.get('back') or '', 'answer': row.get('front') or row.get('back') or ''}
    return problems


def review_sheet_task(conn, shared_conn, kid, session_id, grades):
    task = get_sheet_task(conn, session_id)
    if task['status'] == 'reviewed':
        return task
    if task['status'] != 'pending_review':
        raise ValueError('The child must mark this task done before it can be reviewed')
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
    if task['grading_policy'] == 'completion' and not all(grade_map.values()):
        raise ValueError('Confirm the writing task is complete before saving')
    problems = load_task_problems(conn, shared_conn, kid, task)
    conn.execute('BEGIN TRANSACTION')
    try:
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
            done = conn.execute('SELECT COUNT(*) FROM sheet_session_items WHERE sheet_kind = ? AND sheet_id = ? AND result_id IS NOT NULL', [kind, sheet_id]).fetchone()[0]
            if total and done == total:
                conn.execute(f"UPDATE {table} SET status = 'done', completed_at = CURRENT_TIMESTAMP WHERE id = ?", [sheet_id])
        pull_in_app_chore_events_for_today(conn, shared_conn, kid['familyId'], trigger_keys=[task['category_key']], at_utc=datetime.fromisoformat(task['completed_at']), manage_transaction=False)
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
               COUNT(i.id), COUNT(i.result_id)
        FROM sessions s JOIN sheet_session_items i ON i.session_id = s.id
        WHERE s.delivery_mode = 'sheet' AND s.completed_at IS NOT NULL
        GROUP BY s.id, s.type, s.completed_at, s.planned_count, s.started_at
        HAVING COUNT(i.result_id) < COUNT(i.id) OR (s.completed_at >= ? AND s.completed_at < ?)
        ORDER BY s.id
    """, [start, end]).fetchall()
    pending = {}
    for session_id, key, completed_at, planned, count, reviewed in rows:
        if key not in statuses:
            continue
        status = statuses[key]
        if count > reviewed and completed_at is not None:
            pending.setdefault(key, (session_id, count - reviewed))
        status.update({'status': 'done' if count == reviewed or completed_at else 'in_progress',
                       'sessionId': session_id, 'deliveryMode': 'sheet', 'pendingReview': completed_at is not None and count > reviewed})
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
