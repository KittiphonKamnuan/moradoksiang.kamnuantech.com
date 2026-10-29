"""
มรดกเสียง — local transcription worker.

Polls the SQLite DB for answers with transcript_status='pending', transcribes them with
faster-whisper on this machine (audio never leaves the house), and writes the text back.

    pip install -r worker/requirements.txt
    DATA_DIR=./data python worker/transcribe.py

Env: DATA_DIR (default ./data), WHISPER_MODEL (small), WHISPER_DEVICE (auto|cpu|cuda),
     WHISPER_COMPUTE (int8 on CPU), POLL_SECONDS (5)
"""
from __future__ import annotations

import logging
import os
import sqlite3
import time
from pathlib import Path
from typing import Callable, Optional, Tuple

log = logging.getLogger("transcribe")

Transcriber = Callable[[Path], str]


def connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, isolation_level=None, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def recover(conn: sqlite3.Connection) -> int:
    """Rows left 'processing' by a crashed run go back to the queue."""
    return conn.execute("UPDATE answers SET transcript_status='pending' WHERE transcript_status='processing'").rowcount


def claim_next(conn: sqlite3.Connection) -> Optional[Tuple[str, str]]:
    conn.execute("BEGIN IMMEDIATE")
    try:
        found = conn.execute(
            "SELECT id, audio_path FROM answers WHERE transcript_status='pending' AND status='saved' "
            "AND audio_path IS NOT NULL ORDER BY created_at LIMIT 1"
        ).fetchone()
        if found:
            conn.execute("UPDATE answers SET transcript_status='processing' WHERE id=?", (found[0],))
        conn.execute("COMMIT")
        return (found[0], found[1]) if found else None
    except Exception:
        conn.execute("ROLLBACK")
        raise


def _finish(conn: sqlite3.Connection, answer_id: str, status: str, text: Optional[str] = None) -> None:
    # if the answer was re-recorded meanwhile its row is gone and this is a no-op
    conn.execute("UPDATE answers SET transcript_status=?, transcript=? WHERE id=?", (status, text, answer_id))


def resolve(files_root: Path, rel: str) -> Optional[Path]:
    root = files_root.resolve()
    path = (root / rel).resolve()
    return path if root in path.parents and path.is_file() else None


def run_once(conn: sqlite3.Connection, files_root: Path, transcriber: Transcriber) -> bool:
    """Process one pending answer. Returns False when there was nothing to do."""
    job = claim_next(conn)
    if not job:
        return False
    answer_id, rel = job
    path = resolve(files_root, rel)
    if path is None:
        log.warning("audio missing or outside data dir: %s", rel)
        _finish(conn, answer_id, "failed")
        return True
    try:
        started = time.time()
        text = transcriber(path).strip()
        _finish(conn, answer_id, "done", text)
        log.info("transcribed %s (%d chars, %.1fs)", answer_id, len(text), time.time() - started)
    except Exception:  # noqa: BLE001 — one bad file must not stop the worker
        log.exception("failed %s", answer_id)
        _finish(conn, answer_id, "failed")
    return True


def whisper_transcriber() -> Transcriber:
    from faster_whisper import WhisperModel  # imported lazily so tests don't need it

    device = os.environ.get("WHISPER_DEVICE", "auto")
    compute = os.environ.get("WHISPER_COMPUTE", "int8" if device in ("auto", "cpu") else "float16")
    model_name = os.environ.get("WHISPER_MODEL", "small")
    log.info("loading whisper model=%s device=%s compute=%s", model_name, device, compute)
    model = WhisperModel(model_name, device=device, compute_type=compute)

    def transcribe(path: Path) -> str:
        segments, _ = model.transcribe(str(path), language="th", vad_filter=True, beam_size=5)
        return "".join(s.text for s in segments)

    return transcribe


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    data_dir = Path(os.environ.get("DATA_DIR", "data")).resolve()
    db_path = data_dir / "app.db"
    poll = float(os.environ.get("POLL_SECONDS", "5"))

    while not db_path.exists():
        log.info("waiting for %s (start the web app first)", db_path)
        time.sleep(poll)

    conn = connect(db_path)
    if (n := recover(conn)):
        log.info("re-queued %d interrupted job(s)", n)
    transcriber = whisper_transcriber()
    log.info("watching %s", db_path)
    while True:
        try:
            if not run_once(conn, data_dir / "files", transcriber):
                time.sleep(poll)
        except sqlite3.OperationalError as err:  # e.g. database is locked
            log.warning("db busy: %s", err)
            time.sleep(poll)


if __name__ == "__main__":
    main()
