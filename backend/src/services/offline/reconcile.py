"""Import settled chore items and release the lock in one database transaction."""
import json
import math
from datetime import datetime, timezone, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from src.db import metadata
from src.services.points import (insert_point_event, session_finalization_note, list_family_rules,
                                 get_family_rule, pull_in_app_chore_events_for_today)
from src.services.writing_audio import ensure_type3_audio_dir
from src.services import sheet_tasks
from .repository import load


def _stamp(task, record, zone, index):
    raw = record.get('submittedAt') or record.get('completedAt')
    if raw:
        value = datetime.fromisoformat(raw.replace('Z', '+00:00'))
        if value.tzinfo and value.astimezone(zone).date().isoformat() == task['date']:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
    return datetime.combine(datetime.fromisoformat(task['date']).date(), time(12), zone).astimezone(timezone.utc).replace(tzinfo=None, microsecond=index)


def _grade(answer):
    grade = answer.get('grade')
    if type(grade) is not bool:
        raise ValueError('Every submitted answer must be reviewed')
    if grade and answer.get('firstCorrect') is False:
        return -2
    return 1 if grade else -1


def _duration(answer):
    ms = answer.get('responseTimeMs', 0)
    if not isinstance(ms, (int, float)) or not math.isfinite(ms) or ms < 0:
        raise ValueError('Invalid answer duration')
    return min(round(ms), 24 * 3600 * 1000)


def upload(conn, shared, kid, package_id, device_id, manifest, records, files):
    package = load(conn, package_id, device_id)
    if package['status'] == 'completed':
        return {'packageId': package_id, 'status': 'completed'}
    if package['status'] != 'active':
        raise ValueError('This offline package is not active')
    if not isinstance(manifest, dict) or manifest.get('id') != package_id or str(manifest.get('kidId')) != str(kid['id']):
        raise ValueError('Task package does not match this child and offline package')
    if manifest.get('deviceId') != device_id or manifest.get('days') != package['days']:
        raise ValueError('Task package does not match this device and duration')
    zone = ZoneInfo(metadata.get_family_timezone(kid['familyId']))
    start = package['activatedAt'].replace(tzinfo=timezone.utc).astimezone(zone).date()
    if manifest.get('startDate') != start.isoformat():
        raise ValueError('Task package start date does not match activation')
    end = start + timedelta(days=package['days'])
    task_list = manifest.get('tasks')
    if not isinstance(task_list, list) or any(not isinstance(t, dict) for t in task_list):
        raise ValueError('Invalid task list')
    today = datetime.now(timezone.utc).astimezone(zone).date().isoformat()
    tasks = {t['id']: t for t in task_list}
    if len(tasks) != len(task_list):
        raise ValueError('Duplicate task IDs')
    for task in task_list:
        task_date = datetime.fromisoformat(task['date']).date()
        if not start <= task_date < end:
            raise ValueError('Task date falls outside this offline package')
    rules = list_family_rules(shared, kid['familyId'], rule_kind='in_app_chore', include_inactive=False)
    points_rules = {r['triggerKey']: r for r in rules}
    if not isinstance(records, dict) or set(records) - set(tasks):
        raise ValueError('Results do not match this offline package')
    for key, record in records.items():
        if not isinstance(record, dict):
            raise ValueError('Invalid task result')
        if record.get('status', 'not_started') not in ('not_started', 'done', 'closed'):
            raise ValueError(f"{tasks[key]['name']}: finish practice and parent review, or explicitly end this chore first")
        if tasks[key]['date'] > today and record.get('status') != 'not_started':
            raise ValueError('Future tasks cannot be submitted')
    receipt = {'packageId': package_id, 'status': 'completed', 'sessions': [], 'points': 0}
    written_files = []
    award_days = {}
    conn.execute('BEGIN TRANSACTION')
    try:
        for index, (key, task) in enumerate(tasks.items(), 1):
            record = records.get(key) or {}
            if record.get('status') not in ('done', 'closed'):
                continue
            stamp = _stamp(task, record, zone, index)
            if task['delivery'] == 'offapp':
                if record.get('status') == 'done':
                    rule = get_family_rule(shared, kid['familyId'], task.get('ruleId'))
                    if not rule or rule['ruleKind'] != 'off_app_chore':
                        raise ValueError('Off-app chore rule no longer exists')
                    points = record.get('points')
                    if type(points) is not int or points <= 0:
                        raise ValueError('Off-app points must be a positive integer')
                    insert_point_event(conn, rule['ruleId'], points, note=record.get('note'), created_at=stamp)
                    receipt['points'] += points
                continue
            answers = record.get('answers') or []
            if not isinstance(answers, list):
                raise ValueError('Invalid answers')
            if task['delivery'] == 'sheet':
                items = task['items'] if record['status'] == 'done' else [i for i in task['items'] if str(i['id']) in (record.get('grades') or {})]
                if not items:
                    continue
                if task['behavior'] == 'type_iv' and any(type(record.get('grades', {}).get(str(i['id']))) is not bool for i in items):
                    raise ValueError('Grade every sheet question before uploading')
                planned = len({sheet_tasks.assignment_unit_key(i) for i in items})
                mode = 'na'
            else:
                cards = {str(c['id']): c for c in task['cards']}
                if not answers:
                    if record['status'] == 'done':
                        raise ValueError('Completed tasks need answers')
                    continue
                if record['status'] == 'done' and len(answers) < task['target']:
                    raise ValueError('Completed task is missing answers')
                if len(answers) > max(task['target'], len(task['cards'])) * 5:
                    raise ValueError('Too many answers')
                for answer in answers:
                    if str(answer.get('cardId')) not in cards:
                        raise ValueError('Answer references an unassigned card')
                    _grade(answer)
                if record['status'] == 'done' and task['behavior'] != 'type_iii' and any(not a['grade'] for a in answers):
                    raise ValueError('Corrections must be completed before uploading, or a parent must end the chore')
                planned = task['target']
                mode = record.get('practiceMode') or task['mode']
                if task['review'] and task['behavior'] == 'type_ii':
                    mode = 'parent_review'
                if not record.get('drill'):
                    mode = mode.replace('+drill', '')
            session_id = conn.execute('''INSERT INTO sessions(type,planned_count,practice_mode,delivery_mode,started_at,completed_at)
                VALUES (?,?,?,?,?,?) RETURNING id''', [task['categoryKey'], planned, mode, task['delivery'], stamp, stamp]).fetchone()[0]
            receipt['sessions'].append(session_id)
            earned_count = 0
            if task['delivery'] == 'sheet':
                for item in items:
                    result_id = None
                    if task['behavior'] == 'type_iv':
                        problem = task['problems'][str(item['id'])]
                        correct = 1 if record['grades'][str(item['id'])] else -1
                        result_id = conn.execute('INSERT INTO session_results(session_id,card_id,correct,timestamp) VALUES (?,?,?,?) RETURNING id', [session_id, problem['card_id'], correct, stamp]).fetchone()[0]
                        conn.execute('INSERT INTO type4_result_item(result_id,prompt,answer,submitted_grades) VALUES (?,?,?,?)', [result_id, problem['prompt'], problem['answer'], [correct]])
                    conn.execute('INSERT INTO sheet_session_items(session_id,sheet_kind,sheet_id,page_index,item_index,result_id) VALUES (?,?,?,?,?,?)', [session_id, item['sheet_kind'], item['sheet_id'], item['page_index'], item['item_index'], result_id])
                earned_count = planned if task['behavior'] == 'type_ii' else len(items)
            else:
                for answer in answers:
                    card = cards[str(answer['cardId'])]
                    card_id = card.get('representative_card_id') or card['id']
                    correct = _grade(answer)
                    if answer['grade']:
                        earned_count += 1
                    result_id = conn.execute('INSERT INTO session_results(session_id,card_id,correct,response_time_ms,timestamp) VALUES (?,?,?,?,?) RETURNING id', [session_id, card_id, correct, _duration(answer), stamp]).fetchone()[0]
                    if task['behavior'] == 'type_iv':
                        conn.execute('INSERT INTO type4_result_item(result_id,prompt,answer,distractor_answers,submitted_answers,submitted_grades) VALUES (?,?,?,?,?,?)', [result_id, card['prompt'], card['answer'], card.get('distractor_answers') or [], [str(answer.get('submittedAnswer') or '')], [correct]])
                    if task['behavior'] == 'type_iii':
                        audio_id = answer.get('audioId')
                        audio = files.get(audio_id) if audio_id else None
                        if not audio:
                            raise ValueError('A reading recording is missing')
                        mime = audio.mimetype
                        if mime not in ('audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'application/octet-stream'):
                            raise ValueError('Unsupported recording format')
                        extension = {'audio/mp4': '.m4a', 'audio/ogg': '.ogg', 'audio/wav': '.wav'}.get(mime, '.webm')
                        filename = f'offline_{package_id}_{result_id}{extension}'
                        path = Path(ensure_type3_audio_dir(kid)) / filename
                        audio.save(path)
                        written_files.append(path)
                        conn.execute('INSERT INTO lesson_reading_audio(result_id,file_name,mime_type) VALUES (?,?,?)', [result_id, filename, mime])
            rule = points_rules.get(task['categoryKey']) or {}
            rule_id = rule.get('ruleId')
            rate = rule.get('maxPoint')
            if record['status'] == 'closed' and rule_id and rate:
                points = earned_count // max(1, int(rate))
                note = session_finalization_note(len(answers), task['target'])
                insert_point_event(conn, rule_id, points, note=note, created_at=stamp)
                receipt['points'] += points
            elif record['status'] == 'done':
                award_days[(task['date'], task['categoryKey'])] = stamp
        # Reuse online automatic scoring with today's rules, at each original practice date.
        for (_, key), stamp in award_days.items():
            credited = pull_in_app_chore_events_for_today(conn, shared, kid['familyId'],
                trigger_keys=[key], at_utc=stamp, manage_transaction=False)
            receipt['points'] += sum(event['pointsDelta'] for event in credited['awarded'])
        # Mark printed sheets done only after every paper position is consumed.
        for kind, sheet_id in {(i['sheet_kind'], i['sheet_id']) for t in tasks.values() for i in t.get('items', [])}:
            table = 'type2_chinese_print_sheets' if kind == 'type2' else 'type4_print_sheets'
            raw = conn.execute(f'SELECT layout_json FROM {table} WHERE id=?', [sheet_id]).fetchone()
            if not raw:
                raise ValueError('A reserved sheet was removed')
            layout = json.loads(raw[0])
            total = sum(1 for _ in sheet_tasks.enumerate_sheet_items(kind, sheet_id, layout))
            consumed = conn.execute('SELECT COUNT(*) FROM sheet_session_items WHERE sheet_kind=? AND sheet_id=?', [kind, sheet_id]).fetchone()[0]
            if total and consumed >= total:
                conn.execute(f"UPDATE {table} SET status='done',completed_at=? WHERE id=?", [datetime.now(timezone.utc).replace(tzinfo=None), sheet_id])
        conn.execute("UPDATE offline_packages SET completed_at=CURRENT_TIMESTAMP WHERE id=?", [package_id])
        conn.execute('COMMIT')
    except Exception:
        conn.execute('ROLLBACK')
        for path in written_files:
            path.unlink(missing_ok=True)
        raise
    return receipt
