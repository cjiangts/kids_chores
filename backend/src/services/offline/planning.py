"""Generate an immutable multi-day plan from one queue snapshot."""
import hashlib
import json
from datetime import date, timedelta
from urllib.parse import urlencode
from src.services.kid_category_config import hydrate_kid_category_config_from_db, get_category_session_card_count_for_kid
from src.services.shared_deck_category import get_shared_deck_category_meta_by_key
from src.services.deck_source_merge import get_shared_merged_source_decks_for_kid
from src.services.practice_session import get_practice_candidate_cards_for_decks, preview_deck_practice_order_for_decks
from src.services.practice_mode import get_latest_session_practice_mode, get_session_practice_mode_base
from src.services.shared_deck_payloads import get_type_iv_practice_source_rows
from src.services.type4_session import build_type_iv_pending_items_for_sources, distribute_type_iv_count_across_sources
from src.services.writing_audio import build_writing_prompt_audio_payload, build_type_i_chinese_prompt_audio_payload
from src.services.points import list_enabled_off_app_chores, list_latest_point_events_today_by_rule
from src.services import sheet_tasks
from src.services.kid_avatar import avatar_url_for_kid
from src.services.points import get_point_total


def practice_config(conn, kid):
    """Small read-only snapshot needed by the existing kid-facing API shapes."""
    meta = get_shared_deck_category_meta_by_key()
    hydrate_kid_category_config_from_db(kid, category_meta_by_key=meta, conn=conn)
    return {'categoryMetaByKey': meta, 'targetsByCategory': kid.get('sessionCardCountByCategory') or {},
            'avatarUrl': avatar_url_for_kid(kid), 'pointTotal': get_point_total(conn)}


def fingerprint(report):
    return hashlib.sha256(json.dumps(report, sort_keys=True, default=str).encode()).hexdigest()


def build(conn, shared, kid, package, report):
    meta = get_shared_deck_category_meta_by_key()
    hydrate_kid_category_config_from_db(kid, category_meta_by_key=meta, conn=conn)
    modes = {r[0]: r[1:] for r in conn.execute('SELECT category_key, task_delivery_mode, parent_review_required, speed_drill_enabled, drill_speed_cutoff_ms FROM deck_category_opt_in').fetchall()}
    offapp = list_enabled_off_app_chores(conn, shared, kid['familyId'])
    credited = list_latest_point_events_today_by_rule(conn, kid['familyId'], [r['ruleId'] for r in offapp])
    manifest = {'version': 1, 'id': package['id'], 'kidId': str(kid['id']), 'kidName': kid['name'],
                'timezone': report['timezone'], 'startDate': report['date'], 'days': package['days'],
                'handoff': fingerprint(report), 'tasks': [], 'snapshots': {}, 'assets': [], 'completedToday': []}
    manifest['practiceConfig'] = practice_config(conn, kid)
    if manifest['practiceConfig']['avatarUrl']:
        manifest['assets'].append(manifest['practiceConfig']['avatarUrl'])
    for key in report['keys']:
        category = meta[key]
        behavior = category['behavior_type']
        target = get_category_session_card_count_for_kid(kid, key)
        if target <= 0:
            continue
        mode, parent_review, drill, cutoff = modes.get(key, ('online', False, False, None))
        sources = get_shared_merged_source_decks_for_kid(conn, kid, key)
        deck_ids = [int(s['local_deck_id']) for s in sources if s.get('included_in_queue') and int(s.get('active_card_count') or 0) > 0]
        cards, order, inventory = {}, [], []
        generators = []
        if mode == 'sheet':
            inventory = sheet_tasks.read_sheet_inventory(conn, key)
        elif behavior == 'type_iv':
            generators = get_type_iv_practice_source_rows(conn, kid, key)
        else:
            cards, _ = get_practice_candidate_cards_for_decks(conn, deck_ids)
            order = preview_deck_practice_order_for_decks(conn, kid, deck_ids, key)
            if not order:
                raise ValueError(f"{category['display_name']}: no cards are available")
        offset = 0
        for day in range(package['days']):
            day_date = (date.fromisoformat(report['date']) + timedelta(days=day)).isoformat()
            if day == 0 and report['statuses'].get(key, {}).get('status') == 'done':
                manifest['completedToday'].append(category['display_name'])
                continue
            task = {'id': f'{day}:{key}', 'date': day_date, 'categoryKey': key, 'name': category['display_name'],
                    'behavior': behavior, 'chinese': bool(category.get('has_chinese_specific_logic')), 'delivery': mode,
                    'target': target, 'review': bool(parent_review or behavior == 'type_iii'),
                    'mode': get_session_practice_mode_base(get_latest_session_practice_mode(conn, key)),
                    'cards': []}
            if mode == 'sheet':
                items, units = sheet_tasks.select_sheet_items(inventory, target)
                if units < target:
                    raise ValueError(f"{task['name']}: not enough finalized sheet stock for {day_date} ({units}/{target}). Finalize more sheets first.")
                used = {sheet_tasks.item_key(i) for i in items}
                inventory = [i for i in inventory if sheet_tasks.item_key(i) not in used]
                task['target'] = units
                task['review'] = True
                task['sheetTaskId'] = -(len(manifest['tasks']) + 1)
                task['items'] = [{**item, 'id': index + 1, 'result_id': None, 'correct': None} for index, item in enumerate(items)]
                problems = sheet_tasks.load_task_problems(conn, shared, kid, {'category_key': key, 'items': items})
                task['problems'] = {str(i['id']): problems[sheet_tasks.item_key(i)] for i in task['items']}
                snapshot = {'id': task['sheetTaskId'], 'category_key': key, 'items': task['items'], 'status': 'in_progress',
                            'grading_policy': 'completion' if behavior == 'type_ii' else 'per_item'}
                manifest['snapshots'][f"/api/kids/{kid['id']}/sheet-tasks/{task['sheetTaskId']}"] = snapshot
                for kind, sheet_id in dict.fromkeys((i['sheet_kind'], i['sheet_id']) for i in items):
                    if kind == 'type2':
                        from src.routes.kids.type2 import get_chinese_print_sheet_detail
                        response, status = get_chinese_print_sheet_detail(kid['id'], sheet_id)
                        path = f"/api/kids/{kid['id']}/type2/chinese-print-sheets/{sheet_id}"
                    else:
                        from src.routes.kids.type4 import get_type4_print_sheet_details
                        response, status = get_type4_print_sheet_details(kid['id'], sheet_id)
                        path = f"/api/kids/{kid['id']}/type4/math-sheets/{sheet_id}"
                    if status != 200:
                        raise ValueError('Could not prepare a printed sheet')
                    manifest['snapshots'][path + '?' + urlencode({'categoryKey': key})] = response.get_json()
            elif behavior == 'type_iv':
                generated, _ = build_type_iv_pending_items_for_sources(generators, distribute_type_iv_count_across_sources(generators, target), 'multi')
                task['cards'] = [{k: v for k, v in item.items() if k not in ('validate', 'validate_generator_code')} for item in generated]
                if len(task['cards']) != target:
                    raise ValueError(f"{task['name']}: no generator questions available")
                task['review'] = True  # Parent grading also covers custom Python validators.
            else:
                use_drill = behavior == 'type_i' and not task['chinese'] and drill and target >= 20
                size = min(len(order), 40 if use_drill else target)
                ids = [order[(offset + i) % len(order)] for i in range(size)]
                offset += size
                task['cards'] = [dict(cards[card_id]) for card_id in ids]
                task['target'] = target if use_drill else len(ids)
                task['drill'] = bool(use_drill)
                task['speedTargetMs'] = cutoff or 3000
                task['choicePool'] = list(dict.fromkeys(str(cards[cid].get('back') or '') for cid in order))
                for card in task['cards']:
                    if behavior == 'type_ii':
                        audio = build_writing_prompt_audio_payload(kid['id'], card.get('front'), card.get('back'), category_key=key)
                        card['audioUrl'] = audio['prompt_audio_url']
                    elif behavior == 'type_i' and task['chinese'] and category.get('chinese_back_content') == 'english':
                        card['audioUrl'] = build_type_i_chinese_prompt_audio_payload(kid['id'], card.get('front'), category_key=key)['prompt_audio_url']
                    if card.get('audioUrl'):
                        manifest['assets'].append(card['audioUrl'])
            manifest['tasks'].append(task)
    for day in range(package['days']):
        day_date = (date.fromisoformat(report['date']) + timedelta(days=day)).isoformat()
        for chore in offapp:
            if day == 0 and chore['ruleId'] in credited:
                manifest['completedToday'].append(chore['name'])
                continue
            manifest['tasks'].append({'id': f"{day}:off:{chore['ruleId']}", 'date': day_date,
                                      'name': chore['name'], 'emoji': chore.get('emoji', ''), 'delivery': 'offapp', 'ruleId': chore['ruleId'],
                                      'review': True, 'target': 1, 'cards': []})
    manifest['assets'] = list(dict.fromkeys(manifest['assets']))
    return manifest
