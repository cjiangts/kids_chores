"""Manual sheet selection accepts any unskipped card in the current bank."""
import importlib
import json
import unittest
from unittest.mock import patch

import duckdb
from flask import Flask


routes = importlib.import_module('src.routes.kids.type2')


class ChinesePrintSheetSelectionTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.conn = duckdb.connect(':memory:')
        self.addCleanup(self.conn.close)
        self.conn.execute('''
            CREATE TABLE cards (
                id INTEGER, deck_id INTEGER, front VARCHAR, back VARCHAR,
                skip_practice BOOLEAN
            )
        ''')
        self.conn.execute("CREATE SEQUENCE sheet_ids START 1")
        self.conn.execute('''
            CREATE TABLE type2_chinese_print_sheets (
                id INTEGER DEFAULT nextval('sheet_ids'), category_key VARCHAR,
                layout_json VARCHAR, status VARCHAR
            )
        ''')
        self.conn.execute("""
            INSERT INTO cards VALUES
                (1, 10, '中', 'middle', FALSE),
                (2, 10, '文', 'writing', TRUE),
                (3, 20, '外', 'outside bank', FALSE),
                (4, 30, '另', 'other category', FALSE)
        """)
        mocks = patch.multiple(
            routes,
            get_kid_for_family=lambda kid_id: {'id': kid_id},
            get_kid_connection_for=lambda kid: self.conn.cursor(),
            resolve_kid_type_ii_category_with_mode=lambda *args, **kwargs: ('writing', True),
            get_shared_merged_source_decks_for_kid=lambda *args: [
                {'local_deck_id': 10, 'card_count': 2, 'included_in_bank': True},
                {'local_deck_id': 20, 'card_count': 1, 'included_in_bank': False},
            ],
        )
        mocks.start()
        self.addCleanup(mocks.stop)

    def save(self, card_id):
        with self.app.test_request_context(json={'rows': [{'cardId': card_id}]}):
            response, status = routes.create_chinese_print_sheet('kid')
            return response.get_json(), status

    def test_manual_card_needs_no_recommendation_or_practice_history(self):
        result, status = self.save(1)
        self.assertEqual(status, 201, result)
        layout = self.conn.execute('SELECT layout_json FROM type2_chinese_print_sheets').fetchone()[0]
        self.assertEqual(json.loads(layout)['rows'][0]['front'], '中')

    def test_card_can_be_used_in_multiple_pending_sheets(self):
        self.assertEqual(self.save(1)[1], 201)
        self.assertEqual(self.save(1)[1], 201)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM type2_chinese_print_sheets').fetchone()[0], 2)

    def test_sheet_list_exposes_card_ids_for_legacy_and_multi_card_rows(self):
        self.conn.execute('ALTER TABLE type2_chinese_print_sheets ADD COLUMN created_at TIMESTAMP')
        self.conn.execute('ALTER TABLE type2_chinese_print_sheets ADD COLUMN completed_at TIMESTAMP')
        self.conn.execute('CREATE TABLE sessions (id INTEGER, completed_at TIMESTAMP)')
        self.conn.execute('CREATE TABLE sheet_session_items (sheet_kind VARCHAR, sheet_id INTEGER, session_id INTEGER)')
        layout = {'rows': [
            {'card_id': 1, 'front': '中', 'scale': 1.1},
            {'cards': [{'card_id': 1, 'front': '中'}, {'card_id': 2, 'front': '文'}], 'scale': 1.1},
        ]}
        self.conn.execute("INSERT INTO type2_chinese_print_sheets (category_key, layout_json, status) VALUES ('writing', ?, 'pending')", [json.dumps(layout)])
        with patch.object(routes, 'get_kid_connection_for', side_effect=lambda *args, **kwargs: self.conn.cursor()):
            with self.app.test_request_context():
                response, status = routes.list_chinese_print_sheets('kid')
        self.assertEqual(status, 200, response.get_json())
        sheet = response.get_json()['sheets'][0]
        self.assertEqual(sheet['card_ids'], [1, 2])
        self.assertEqual(sheet['status'], 'pending')
        self.assertGreater(sheet['total_question_count'], sheet['completed_question_count'])

    def test_skipped_outside_bank_and_missing_cards_are_rejected(self):
        for card_id in (2, 3, 4, 999):
            with self.subTest(card_id=card_id):
                result, status = self.save(card_id)
                self.assertEqual(status, 409, result)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM type2_chinese_print_sheets').fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()
