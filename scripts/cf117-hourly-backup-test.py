"""Synthetic, in-memory D1 50-byte GLOB-limit regression; never opens a live DB.

The ledger helper mirrors the BEGIN/execute/ledger/COMMIT contract of
cf117-backup-check.mjs. It does not invoke or claim to test the Wrangler CLI.
"""

import hashlib
import io
import json
from pathlib import Path
import random
import re
import sqlite3
import sys
import unittest
from uuid import UUID


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "apps/cloudflare/migrations"
OLD_SQL = (MIGRATIONS / "0052_cf79_case_law_member_alerts_backups.sql").read_text(encoding="utf-8")
MIGRATION = "0061_cf117_hourly_backup_pattern.sql"
TABLE = "preview_report_hourly_backups"
INSERT = f"INSERT INTO {TABLE} VALUES ({','.join('?' for _ in range(11))})"


def row(index=100, content="synthetic", editor=None, hour=None):
    return (str(UUID(int=index + 1)), "concost", "case-1", index + 1,
            "CF117 synthetic", content, editor,
            hashlib.sha256(content.encode()).hexdigest(),
            hour or f"2026-09-07T{index % 24:02}", "user-1", "2026-09-07T10:00:00Z")


def fixture(populated=True):
    db = sqlite3.connect(":memory:", isolation_level=None)
    db.executescript("""
      PRAGMA foreign_keys=ON;
      CREATE TABLE preview_users(id TEXT PRIMARY KEY);
      CREATE TABLE preview_cases(id TEXT PRIMARY KEY);
      CREATE TABLE preview_report_drafts(case_id TEXT PRIMARY KEY);
      CREATE TABLE preview_report_ai_generations(id TEXT PRIMARY KEY);
      CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL, applied_at TEXT DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO preview_users VALUES ('user-1');
      INSERT INTO preview_cases VALUES ('case-1');
      INSERT INTO preview_report_drafts VALUES ('case-1');
      INSERT INTO d1_migrations(name) VALUES ('0052_cf79_case_law_member_alerts_backups.sql');
    """)
    db.executescript(OLD_SQL)
    if populated:
        rich = json.dumps({"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "한글 😀"}]},
            {"type": "table", "content": [{"type": "tableRow", "content": []}]},
            {"type": "image", "attrs": {"src": "data:image/png;base64,YQ=="}},
            {"type": "pageBreak"}], "header": {"enabled": False, "text": "합성"}}, ensure_ascii=False)
        # No conversion is permitted: plain text, Markdown, HTML, rich JSON,
        # empty content, and the maximum allowed body must survive byte-for-byte.
        values = [("한글\nsecond line 😀", None), ("# Heading\n1. Evidence", None),
                  ('<p>A&amp;B</p><table><tr><td>cell</td></tr></table>', None),
                  ("rich body", rich), ("", "null"), ("장" * 500000, "{}")]
        db.executemany(INSERT, [row(i, body, editor) for i, (body, editor) in enumerate(values)])
        db.execute("INSERT INTO preview_member_alert_reads VALUES (?,?,?,?)",
                   ("concost", "user-1", "synthetic-event", "2026-09-07T10:00:00Z"))
    return db


def tables(db):
    return [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]


def rows(db, table=TABLE):
    return db.execute(f'SELECT * FROM "{table}" ORDER BY 1').fetchall()


def schema(db):
    return db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name").fetchall()


def run_pending(db):
    if db.execute("SELECT 1 FROM d1_migrations WHERE name=?", (MIGRATION,)).fetchone():
        return False
    db.execute("BEGIN IMMEDIATE")
    try:
        # Unlike executescript(), this preserves the caller's transaction.
        statement = ""
        for line in (MIGRATIONS / MIGRATION).read_text(encoding="utf-8").splitlines(True):
            statement += line
            if sqlite3.complete_statement(statement):
                db.execute(statement)
                statement = ""
        if statement.strip():
            db.execute(statement)
        db.execute("INSERT INTO d1_migrations(name) VALUES (?)", (MIGRATION,))
        db.execute("COMMIT")
    except BaseException:
        db.execute("ROLLBACK")
        raise
    return True


class HourlyBackupTests(unittest.TestCase):
    def setUp(self):
        self.db = fixture()
        self.addCleanup(self.db.close)

    def migrate(self):
        self.db.setlimit(sqlite3.SQLITE_LIMIT_LIKE_PATTERN_LENGTH, 50)
        self.assertTrue(run_pending(self.db))

    def integrity(self):
        self.assertEqual(self.db.execute("PRAGMA integrity_check").fetchall(), [("ok",)])
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_original_schema_reproduces_d1_error_without_writing(self):
        before = rows(self.db)
        self.db.setlimit(sqlite3.SQLITE_LIMIT_LIKE_PATTERN_LENGTH, 50)
        with self.assertRaisesRegex(sqlite3.OperationalError, "LIKE or GLOB pattern too complex"):
            self.db.execute(INSERT, row(hour="2026-09-07T20"))
        self.assertEqual(rows(self.db), before)

    def test_populated_copy_preserves_every_column_format_and_ledger_noop(self):
        before = {name: rows(self.db, name) for name in tables(self.db)}
        columns = self.db.execute(f"PRAGMA table_info({TABLE})").fetchall()
        foreign_keys = self.db.execute(f"PRAGMA foreign_key_list({TABLE})").fetchall()
        self.migrate()
        self.assertEqual(tables(self.db), sorted(before), "No temporary or legacy tables remain")
        for name, values in before.items():
            if name != "d1_migrations":
                self.assertEqual(rows(self.db, name), values, f"All original values retained: {name}")
        self.assertEqual(self.db.execute(f"PRAGMA table_info({TABLE})").fetchall(), columns)
        self.assertEqual(self.db.execute(f"PRAGMA foreign_key_list({TABLE})").fetchall(), foreign_keys)
        self.integrity()
        after = {name: rows(self.db, name) for name in tables(self.db)}
        after_schema = schema(self.db)
        self.assertFalse(run_pending(self.db))
        self.assertEqual({name: rows(self.db, name) for name in tables(self.db)}, after)
        self.assertEqual(schema(self.db), after_schema)
        self.assertEqual(len(after["d1_migrations"]), len(before["d1_migrations"]) + 1)

    def test_empty_database_and_subsequent_backup_insert(self):
        self.db.close()
        self.db = fixture(False)
        self.addCleanup(self.db.close)
        self.migrate()
        self.db.execute(INSERT, row())
        self.assertEqual(len(rows(self.db)), 1)
        self.integrity()

    def test_valid_invalid_hours_remain_equivalent_to_original_glob(self):
        original_schema = self.db.execute("SELECT sql FROM sqlite_master WHERE name=?", (TABLE,)).fetchone()[0]
        pattern = re.search(r"backup_hour GLOB '([^']+)'", original_schema).group(1)
        self.assertEqual(len(pattern.encode()), 53)
        reference = sqlite3.connect(":memory:")
        self.addCleanup(reference.close)
        self.migrate()
        samples = ["2026-09-08T20", "0000-00-00T00", "9999-99-99T99", "2026-09-08T2",
                   "2026-09-08T200", "2026-09-08t20", "2026/09/08T20", "２０２６-09-08T20", "", None]
        rng = random.Random(117)
        for _ in range(100):
            sample = list("2026-09-08T20")
            sample[rng.randrange(len(sample))] = rng.choice("0123456789-xTt/ ")
            samples.append("".join(sample))
        for index, hour in enumerate(samples):
            expected = bool(reference.execute("SELECT ? GLOB ?", (hour, pattern)).fetchone()[0])
            self.db.execute("SAVEPOINT hour_case")
            try:
                candidate = list(row(1000 + index, hour="2026-09-08T20"))
                candidate[8] = hour
                try:
                    self.db.execute(INSERT, candidate)
                    accepted = True
                except sqlite3.IntegrityError:
                    accepted = False
                self.assertEqual(accepted, expected, f"Hour-shape compatibility case {index}")
            finally:
                self.db.execute("ROLLBACK TO hour_case")
                self.db.execute("RELEASE hour_case")
        self.integrity()

    def test_original_checks_foreign_keys_uniqueness_and_immutable_guards(self):
        self.migrate()
        base = list(row(hour="2026-09-08T20"))
        invalid = [(0, "bad-id"), (1, "other-org"), (2, "missing-case"), (3, 0),
                   (4, ""), (4, "x" * 301), (5, "x" * 500001), (6, "not-json"),
                   (7, "short-hash"), (9, "missing-user"), (8, "2026-09-07T00")]
        for field, value in invalid:
            candidate = base.copy()
            candidate[field] = value
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(INSERT, candidate)
        self.db.execute(INSERT, base)
        with self.assertRaisesRegex(sqlite3.IntegrityError, "UNIQUE"):
            self.db.execute(INSERT, base)
        for sql in [f"UPDATE {TABLE} SET title='changed'", f"DELETE FROM {TABLE}"]:
            with self.assertRaisesRegex(sqlite3.IntegrityError, "hourly report backups are immutable"):
                self.db.execute(sql)
        for sql in ["DELETE FROM preview_report_drafts", "DELETE FROM preview_users"]:
            with self.assertRaisesRegex(sqlite3.IntegrityError, "FOREIGN KEY"):
                self.db.execute(sql)
        self.assertEqual(len(rows(self.db)), 7)
        names = {r[0] for r in self.db.execute("SELECT name FROM sqlite_master WHERE tbl_name=?", (TABLE,))}
        self.assertTrue({"idx_preview_report_hourly_backups_case", "preview_report_hourly_backup_update_guard",
                         "preview_report_hourly_backup_delete_guard"}.issubset(names))
        self.integrity()

    def test_failed_copy_rolls_back_original_rows_schema_and_migration_ledger(self):
        self.db.execute("PRAGMA ignore_check_constraints=ON")
        self.db.execute(INSERT, row(200, editor="invalid JSON", hour="2026-09-08T20"))
        self.db.execute("PRAGMA ignore_check_constraints=OFF")
        before = {name: rows(self.db, name) for name in tables(self.db)}
        before_schema = schema(self.db)
        self.db.setlimit(sqlite3.SQLITE_LIMIT_LIKE_PATTERN_LENGTH, 50)
        with self.assertRaisesRegex(sqlite3.IntegrityError, "CHECK constraint failed"):
            run_pending(self.db)
        self.assertEqual({name: rows(self.db, name) for name in tables(self.db)}, before)
        self.assertEqual(schema(self.db), before_schema)
        with self.assertRaisesRegex(sqlite3.IntegrityError, "hourly report backups are immutable"):
            self.db.execute(f"DELETE FROM {TABLE}")


if __name__ == "__main__":
    # Counts only: even on failure no stored report text or fixture rows are printed.
    result = unittest.TextTestRunner(stream=io.StringIO()).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(HourlyBackupTests))
    print(json.dumps({"tests": result.testsRun, "failures": len(result.failures), "errors": len(result.errors)}))
    sys.exit(not result.wasSuccessful())
