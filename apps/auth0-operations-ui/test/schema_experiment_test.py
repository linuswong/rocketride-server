"""Schema experiment only: no identity, API or production persistence is tested."""

import sqlite3
import tempfile
import unittest
from pathlib import Path


SCHEMA = Path(__file__).parents[1] / 'backend/design/001_sqlite_experiment.sql'


class SchemaExperimentTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript(SCHEMA.read_text(encoding='utf-8'))
        self.db.executemany('INSERT INTO organizations VALUES (?, ?, NULL)', [('a', 'now'), ('b', 'now')])
        for org in ('a', 'b'):
            self.db.execute(
                'INSERT INTO tickets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (
                    't' + org,
                    org,
                    'same@example.com',
                    'subject',
                    'description',
                    'new',
                    'other',
                    'normal',
                    'now',
                    'now',
                    1,
                ),
            )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_migration_and_same_email(self):
        self.assertEqual(self.db.execute('PRAGMA user_version').fetchone()[0], 1)
        self.assertEqual(
            self.db.execute('SELECT count(*) FROM tickets WHERE customer_ref = ?', ('same@example.com',)).fetchone()[0],
            2,
        )

    def test_cross_tenant_foreign_key_and_immutable_binding(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                'INSERT INTO investigations VALUES (?, ?, ?, ?, ?, ?, ?)',
                ('i', 'a', 'tb', 'run', 'started', 'now', None),
            )
        self.db.execute(
            'INSERT INTO investigations VALUES (?, ?, ?, ?, ?, ?, ?)', ('i', 'a', 'ta', 'run', 'started', 'now', None)
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                'UPDATE investigations SET organization_id = ?, ticket_id = ? WHERE id = ?', ('b', 'tb', 'i')
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                'INSERT INTO evidence_metadata VALUES (?, ?, ?, ?, ?, ?)', ('e', 'b', 'i', 'tool', 'ref', 'now')
            )

    def test_transaction_rollback_and_version_compare(self):
        self.db.execute('BEGIN')
        self.db.execute("UPDATE tickets SET version = version + 1 WHERE id = 'ta' AND version = 1")
        self.db.rollback()
        self.assertEqual(self.db.execute("SELECT version FROM tickets WHERE id = 'ta'").fetchone()[0], 1)
        self.assertEqual(
            self.db.execute("UPDATE tickets SET version = version + 1 WHERE id = 'ta' AND version = 1").rowcount, 1
        )
        self.assertEqual(
            self.db.execute("UPDATE tickets SET version = version + 1 WHERE id = 'ta' AND version = 1").rowcount, 0
        )

    def test_file_reopen_and_competing_version_updates(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'experiment.db')
            first = sqlite3.connect(path)
            try:
                first.executescript(SCHEMA.read_text(encoding='utf-8'))
                first.execute("INSERT INTO organizations VALUES ('a', 'now', NULL)")
                first.execute(
                    "INSERT INTO tickets VALUES ('t', 'a', 'x', 's', 'd', 'new', 'other', 'normal', 'now', 'now', 1)"
                )
                first.commit()
                second = sqlite3.connect(path)
                try:
                    second.execute('PRAGMA foreign_keys = ON')
                    self.assertEqual(second.execute('SELECT version FROM tickets').fetchone()[0], 1)
                    first.execute("UPDATE tickets SET version = version + 1 WHERE id = 't' AND version = 1")
                    first.commit()
                    self.assertEqual(
                        second.execute(
                            "UPDATE tickets SET version = version + 1 WHERE id = 't' AND version = 1"
                        ).rowcount,
                        0,
                    )
                finally:
                    second.close()
            finally:
                first.close()
            reopened = sqlite3.connect(path)
            try:
                self.assertEqual(reopened.execute('SELECT version FROM tickets').fetchone()[0], 2)
                self.assertEqual(reopened.execute('PRAGMA user_version').fetchone()[0], 1)
            finally:
                reopened.close()


if __name__ == '__main__':
    unittest.main()
