import importlib.util
import tempfile
import zipfile
from pathlib import Path
from unittest import TestCase

import duckdb


script = Path(__file__).parents[1] / 'scripts/migrate_sheet_tasks_backup_zip.py'
spec = importlib.util.spec_from_file_location('migrate_sheet_tasks', script)
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class SheetMigrationTest(TestCase):
    def test_backup_migration_preserves_data_and_defaults_to_online(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            database = root / 'kid_1.db'
            conn = duckdb.connect(str(database))
            conn.execute('CREATE TABLE sessions (id INTEGER, type VARCHAR)')
            conn.execute('CREATE TABLE deck_category_opt_in (category_key VARCHAR)')
            conn.execute("INSERT INTO sessions VALUES (1, 'math')")
            conn.execute("INSERT INTO deck_category_opt_in VALUES ('math')")
            conn.close()
            original = root / 'before.zip'
            migrated = root / 'after.zip'
            with zipfile.ZipFile(original, 'w') as archive:
                archive.write(database, 'data/families/family_1/kid_1.db')
                archive.writestr('data/kids.json', '{"unchanged":true}')
            self.assertEqual(migration.migrate_zip(original, migrated), 1)
            with zipfile.ZipFile(migrated) as archive:
                self.assertEqual(archive.read('data/kids.json'), b'{"unchanged":true}')
                extracted = root / 'extracted'
                archive.extractall(extracted)
            conn = duckdb.connect(str(extracted / 'data/families/family_1/kid_1.db'))
            self.assertEqual(conn.execute('SELECT * FROM sessions').fetchall(), [(1, 'math', 'online')])
            self.assertEqual(conn.execute('SELECT * FROM deck_category_opt_in').fetchall(), [('math', 'online')])
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM sheet_session_items').fetchone()[0], 0)
            conn.close()
            conn = duckdb.connect(str(database))
            self.assertEqual(len(conn.execute('SELECT * FROM sessions').description), 2)
            conn.close()
