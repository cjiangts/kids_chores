import json
from datetime import datetime, timedelta
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

import duckdb

from src.services import sheet_tasks, points


class SheetTasksTest(TestCase):
    def setUp(self):
        self.conn = duckdb.connect(':memory:')
        self.conn.execute((Path(__file__).parents[1] / 'src/db/schema.sql').read_text())
        self.addCleanup(self.conn.close)
        self.shared = duckdb.connect(':memory:')
        self.addCleanup(self.shared.close)
        self.kid = {'id': 'kid', 'familyId': 'family'}
        self.start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        self.end = self.start + timedelta(days=1)
        self.target = 5
        patches = [
            patch.object(sheet_tasks, 'sheet_kind_for_category', side_effect=lambda key: {'math': 'type4', 'writing': 'type2'}.get(key)),
            patch.object(sheet_tasks, 'sheet_target', side_effect=lambda *args: self.target),
            patch.object(sheet_tasks, '_family_day_bounds_utc', return_value=(self.start, self.end)),
            patch.object(points, '_family_day_bounds_utc', return_value=(self.start, self.end)),
            patch.object(points, 'list_family_rules', return_value=[{'ruleId': 1, 'maxPoint': 2, 'triggerKey': 'math'}]),
            patch.object(sheet_tasks, 'load_task_problems', side_effect=self.problems),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)
        self.conn.execute("INSERT INTO decks (id, name) VALUES (1, 'math')")
        self.conn.execute("INSERT INTO cards (id, deck_id, front, back) VALUES (1, 1, 'representative', '')")
        self.conn.execute("INSERT INTO deck_category_opt_in (category_key, is_opted_in, task_delivery_mode) VALUES ('math', TRUE, 'sheet'), ('writing', TRUE, 'sheet')")
        self.layout = {'paper_size': 'letter', 'repeat_count': 2, 'rows': [
            {'shared_deck_id': 10, 'col_count': 4, 'scale': 1, 'cell_design': {'cell_width': 170, 'cell_height': 100}},
        ]}
        self.conn.execute("INSERT INTO type4_print_sheets (id, category_key, layout_json, seed_base, status) VALUES (1, 'math', ?, 123, 'pending')", [json.dumps(self.layout)])

    def problems(self, conn, shared, kid, task):
        return {sheet_tasks.item_key(item): {'prompt': f'{item["item_index"]}+1', 'answer': '2', 'card_id': 1} for item in task['items']}

    def allocate(self):
        return sheet_tasks.allocate_sheet_task(self.conn, self.kid, 'math')

    def submit_and_review(self, task, correct=False):
        sheet_tasks.submit_sheet_task(self.conn, task['id'])
        grades = [{'id': item['id'], 'correct': correct} for item in task['items']]
        return sheet_tasks.review_sheet_task(self.conn, self.shared, self.kid, task['id'], grades)

    def test_inventory_allocation_spans_pages_and_is_idempotent(self):
        self.assertEqual(len(sheet_tasks.read_sheet_inventory(self.conn, 'math')), 8)
        task = self.allocate()
        self.assertEqual(task['planned_count'], 5)
        self.assertEqual([(i['page_index'], i['item_index']) for i in task['items']], [(1,1), (1,2), (1,3), (1,4), (2,1)])
        self.assertEqual(self.allocate()['id'], task['id'])
        self.assertEqual(len(sheet_tasks.read_sheet_inventory(self.conn, 'math')), 3)
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM session_results').fetchone()[0], 0)

    def test_pending_review_has_no_results_or_points(self):
        task = self.allocate()
        submitted = sheet_tasks.submit_sheet_task(self.conn, task['id'])
        self.assertEqual(submitted['status'], 'pending_review')
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM session_results').fetchone()[0], 0)
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM point_event').fetchone()[0], 0)

    def test_all_wrong_still_earns_points_once_and_uses_existing_results(self):
        task = self.allocate()
        reviewed = self.submit_and_review(task, correct=False)
        self.assertEqual(reviewed['status'], 'reviewed')
        self.assertTrue(all(item['result_id'] for item in reviewed['items']))
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM session_results WHERE correct = -1').fetchone()[0], 5)
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM type4_result_item').fetchone()[0], 5)
        self.assertEqual(self.conn.execute('SELECT points_delta FROM point_event').fetchone()[0], 2)
        self.submit_and_review(task, correct=True)
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM point_event').fetchone()[0], 1)
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM session_results').fetchone()[0], 5)

    def test_incomplete_duplicate_and_foreign_grades_are_rejected(self):
        task = self.allocate()
        sheet_tasks.submit_sheet_task(self.conn, task['id'])
        valid = [{'id': item['id'], 'correct': True} for item in task['items']]
        for grades in (valid[:-1], [valid[0]]*5, [*valid[:-1], {'id': 999, 'correct': True}], [{**g, 'correct': 1} for g in valid]):
            with self.assertRaises(ValueError):
                sheet_tasks.review_sheet_task(self.conn, self.shared, self.kid, task['id'], grades)
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM session_results').fetchone()[0], 0)

    def test_review_before_child_submission_is_rejected(self):
        task = self.allocate()
        with self.assertRaises(ValueError):
            sheet_tasks.review_sheet_task(self.conn, self.shared, self.kid, task['id'], [])

    def test_next_day_allocates_remaining_questions_and_shows_shortage(self):
        first = self.allocate()
        self.submit_and_review(first)
        self.conn.execute("UPDATE sessions SET started_at = ?, completed_at = ?", [self.start-timedelta(hours=2), self.start-timedelta(hours=1)])
        second = self.allocate()
        self.assertNotEqual(first['id'], second['id'])
        self.assertEqual(second['planned_count'], 3)
        self.assertEqual([item['item_index'] for item in second['items']], [2,3,4])
        summary = sheet_tasks.sheet_summary(self.conn, self.kid, 'math')
        self.assertEqual(summary['available_today'], 3)
        self.assertEqual(summary['target_count'], 5)
        self.assertTrue(summary['shortage'])
        self.submit_and_review(second)
        self.assertEqual(self.conn.execute('SELECT status FROM type4_print_sheets').fetchone()[0], 'done')

    def test_yesterday_pending_does_not_release_inventory_and_stays_reviewable(self):
        first = self.allocate()
        sheet_tasks.submit_sheet_task(self.conn, first['id'])
        self.conn.execute('UPDATE sessions SET started_at = ?, completed_at = ?', [self.start-timedelta(hours=2), self.start-timedelta(hours=1)])
        second = self.allocate()
        self.assertEqual(second['planned_count'], 3)
        statuses = {'math': {'earnedPoints': 0}}
        sheet_tasks.apply_sheet_statuses(self.conn, self.kid, statuses)
        self.assertTrue(statuses['math']['pendingReview'])
        self.assertEqual(statuses['math']['sessionId'], first['id'])

    def test_mode_cannot_start_without_inventory_but_existing_mode_is_retained(self):
        self.conn.execute("UPDATE type4_print_sheets SET status = 'preview'")
        sheet_tasks.set_delivery_mode(self.conn, self.kid, 'math', 'online')
        with self.assertRaises(ValueError):
            sheet_tasks.set_delivery_mode(self.conn, self.kid, 'math', 'sheet')
        self.conn.execute("UPDATE type4_print_sheets SET status = 'pending'")
        sheet_tasks.set_delivery_mode(self.conn, self.kid, 'math', 'sheet')
        self.conn.execute("UPDATE type4_print_sheets SET status = 'done'")
        self.assertEqual(sheet_tasks.sheet_summary(self.conn, self.kid, 'math')['mode'], 'sheet')
        self.assertIsNone(self.allocate())

    def test_review_rolls_back_results_and_inventory_when_points_fail(self):
        task = self.allocate()
        sheet_tasks.submit_sheet_task(self.conn, task['id'])
        with patch.object(sheet_tasks, 'pull_in_app_chore_events_for_today', side_effect=RuntimeError('failed')):
            with self.assertRaises(RuntimeError):
                self.submit_and_review(task)
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM session_results').fetchone()[0], 0)
        self.assertEqual(self.conn.execute('SELECT COUNT(result_id) FROM sheet_session_items').fetchone()[0], 0)
        self.assertEqual(sheet_tasks.get_sheet_task(self.conn, task['id'])['status'], 'pending_review')

    def test_chinese_inventory_counts_only_writable_boxes(self):
        layout = {'paper_size': 'letter', 'rows': [{'card_id': 1, 'front': '中', 'scale': 1.3, 'empty_count': 1}]}
        items = list(sheet_tasks.enumerate_sheet_items('type2', 1, layout))
        self.assertEqual(len(items), 5)
        self.assertEqual([item['column_index'] for item in items], [1,3,5,7,9])

    def test_unique_paper_positions_prevent_duplicate_reservations(self):
        self.allocate()
        with self.assertRaises(duckdb.ConstraintException):
            self.conn.execute("INSERT INTO sheet_session_items (session_id, sheet_kind, sheet_id, page_index, item_index) VALUES (999, 'type4', 1, 1, 1)")

    def test_zero_point_review_is_still_final_and_not_awarded_twice(self):
        self.target = 1
        task = self.allocate()
        self.submit_and_review(task)
        self.submit_and_review(task)
        self.assertEqual(self.conn.execute('SELECT COUNT(*), SUM(points_delta) FROM point_event').fetchone(), (1, 0))

    def test_chinese_review_is_whole_task_confirmation(self):
        layout = {'paper_size': 'letter', 'rows': [{'card_id': 1, 'front': '中', 'scale': 1.3, 'empty_count': 1}]}
        self.conn.execute("INSERT INTO type2_chinese_print_sheets (id, category_key, layout_json, status) VALUES (1, 'writing', ?, 'pending')", [json.dumps(layout)])
        task = sheet_tasks.allocate_sheet_task(self.conn, self.kid, 'writing')
        self.assertEqual(task['grading_policy'], 'completion')
        sheet_tasks.submit_sheet_task(self.conn, task['id'])
        with self.assertRaises(ValueError):
            sheet_tasks.review_sheet_task(self.conn, self.shared, self.kid, task['id'], [{'id': item['id'], 'correct': False} for item in task['items']])
        result = self.submit_and_review(task, correct=True)
        self.assertEqual(result['status'], 'reviewed')
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM type4_result_item').fetchone()[0], 0)

    def test_started_sheet_and_session_cannot_be_deleted(self):
        import importlib
        from flask import Flask
        from src.services.session_delete import delete_session_with_recompute
        routes = importlib.import_module('src.routes.kids.type4')
        task = self.allocate()
        with self.assertRaises(ValueError):
            delete_session_with_recompute(self.conn, task['id'])
        with patch.object(routes, 'get_kid_for_family', return_value=self.kid), patch.object(routes, 'get_kid_connection_for', side_effect=lambda *a, **kw: self.conn.cursor()):
            with Flask(__name__).test_request_context():
                response, status = routes.withdraw_type4_print_sheet('kid', 1)
                self.assertEqual(status, 409, response.get_json())
        self.assertEqual(len(sheet_tasks.get_sheet_task(self.conn, task['id'])['items']), 5)

    def test_inventory_and_print_renderer_share_page_and_question_numbering(self):
        from src.services.type4_print_sheet import build_type_iv_print_pages, get_type_iv_print_sheet_record
        sheet = get_type_iv_print_sheet_record(self.conn, 1)
        code = "def generate(rng):\n    a = rng.randint(1, 9)\n    return {'prompt': str(a) + '+1', 'answer': str(a+1)}"
        first = build_type_iv_print_pages(sheet, {10: {'code': code}})
        second = build_type_iv_print_pages(sheet, {10: {'code': code}})
        self.assertEqual(first, second)
        self.assertEqual(len(first), 2)
        self.assertEqual([page['problem_count'] for page in first], [4,4])
        self.assertNotEqual(first[0]['layout_rows'][0]['problems'], first[1]['layout_rows'][0]['problems'])
        self.assertEqual(len(sheet_tasks.read_sheet_inventory(self.conn, 'math')), sum(page['problem_count'] for page in first))

    def test_online_wrong_results_do_not_receive_sheet_point_exception(self):
        session_id = self.conn.execute("INSERT INTO sessions (type, planned_count, completed_at) VALUES ('math', 1, CURRENT_TIMESTAMP) RETURNING id").fetchone()[0]
        self.conn.execute('INSERT INTO session_results (session_id, card_id, correct) VALUES (?, 1, -1)', [session_id])
        self.assertEqual(points.list_app_category_strictly_done_sessions_today(self.conn, 'family', 'math'), [])
