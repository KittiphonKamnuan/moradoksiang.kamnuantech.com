"""Run: python3 -m unittest discover -s worker"""
import sqlite3
import tempfile
import unittest
from pathlib import Path

import transcribe as t

SCHEMA = """
CREATE TABLE answers (
  id TEXT PRIMARY KEY, question_id TEXT, storyteller_id TEXT, audio_path TEXT, mime TEXT,
  duration_ms INTEGER, status TEXT NOT NULL DEFAULT 'saved', transcript TEXT,
  transcript_status TEXT NOT NULL DEFAULT 'pending', title TEXT, created_at INTEGER NOT NULL
);
"""


def make_db():
    conn = sqlite3.connect(":memory:", isolation_level=None)
    conn.executescript(SCHEMA)
    return conn


def add(conn, id, created, status="saved", ts="pending", path=None):
    conn.execute(
        "INSERT INTO answers (id, status, transcript_status, audio_path, created_at) VALUES (?,?,?,?,?)",
        (id, status, ts, path or f"answers/{id}.m4a", created),
    )


def row(conn, id):
    return conn.execute("SELECT transcript_status, transcript FROM answers WHERE id=?", (id,)).fetchone()


class ClaimTest(unittest.TestCase):
    def test_claims_oldest_pending_saved_answer(self):
        conn = make_db()
        add(conn, "b", 2)
        add(conn, "a", 1)
        add(conn, "s", 0, status="skipped", ts="pending")
        job = t.claim_next(conn)
        self.assertEqual(job, ("a", "answers/a.m4a"))
        self.assertEqual(row(conn, "a")[0], "processing")

    def test_returns_none_when_nothing_pending(self):
        conn = make_db()
        add(conn, "a", 1, ts="done")
        add(conn, "b", 1, ts="disabled")
        self.assertIsNone(t.claim_next(conn))

    def test_recover_resets_stuck_processing_rows(self):
        conn = make_db()
        add(conn, "a", 1, ts="processing")
        self.assertEqual(t.recover(conn), 1)
        self.assertEqual(row(conn, "a")[0], "pending")


class RunOnceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "answers").mkdir()
        (self.root / "answers" / "a.m4a").write_bytes(b"x")

    def tearDown(self):
        self.tmp.cleanup()

    def test_stores_transcript(self):
        conn = make_db()
        add(conn, "a", 1)
        self.assertTrue(t.run_once(conn, self.root, lambda p: "  สวัสดีจ้ะหลาน  "))
        self.assertEqual(row(conn, "a"), ("done", "สวัสดีจ้ะหลาน"))

    def test_marks_failed_when_transcriber_raises(self):
        conn = make_db()
        add(conn, "a", 1)

        def boom(_):
            raise RuntimeError("decode")

        self.assertTrue(t.run_once(conn, self.root, boom))
        self.assertEqual(row(conn, "a")[0], "failed")

    def test_marks_failed_when_file_missing(self):
        conn = make_db()
        add(conn, "x", 1, path="answers/missing.m4a")
        self.assertTrue(t.run_once(conn, self.root, lambda p: "never"))
        self.assertEqual(row(conn, "x")[0], "failed")

    def test_refuses_paths_outside_root(self):
        conn = make_db()
        add(conn, "x", 1, path="../../etc/passwd")
        seen = []
        t.run_once(conn, self.root, lambda p: seen.append(p) or "x")
        self.assertEqual(seen, [])
        self.assertEqual(row(conn, "x")[0], "failed")

    def test_returns_false_when_idle(self):
        self.assertFalse(t.run_once(make_db(), self.root, lambda p: "x"))

    def test_empty_transcript_is_still_done(self):
        conn = make_db()
        add(conn, "a", 1)
        t.run_once(conn, self.root, lambda p: "")
        self.assertEqual(row(conn, "a"), ("done", ""))


if __name__ == "__main__":
    unittest.main()
