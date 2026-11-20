"""
มรดกเสียง — local transcription worker.

Polls the SQLite DB for answers with transcript_status='pending', transcribes them with
faster-whisper on this machine (audio never leaves the house), and writes the text back.

    pip install -r worker/requirements.txt
    DATA_DIR=./data python worker/transcribe.py

The model (~600 MB RAM for "small") is only in memory while there is work: the long-running
supervisor just polls SQLite; when an answer is pending it starts `transcribe.py --batch`, which
loads the model, drains the queue and exits after IDLE_EXIT_SECONDS without new work.

Env: DATA_DIR (default ./data), WHISPER_MODEL (small), WHISPER_DEVICE (auto|cpu|cuda),
     WHISPER_COMPUTE (int8 on CPU), POLL_SECONDS (5), IDLE_EXIT_SECONDS (120)
"""
from __future__ import annotations

import logging
import os
import sqlite3
import subprocess
import sys
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


PENDING_WHERE = "transcript_status='pending' AND status='saved' AND audio_path IS NOT NULL"


def has_pending(conn: sqlite3.Connection) -> bool:
    return conn.execute(f"SELECT 1 FROM answers WHERE {PENDING_WHERE} LIMIT 1").fetchone() is not None


def claim_next(conn: sqlite3.Connection) -> Optional[Tuple[str, str]]:
    conn.execute("BEGIN IMMEDIATE")
    try:
        found = conn.execute(
            f"SELECT id, audio_path FROM answers WHERE {PENDING_WHERE} ORDER BY created_at LIMIT 1"
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


def decode_audio(path: Path, sampling_rate: int = 16000):
    """Mono float32 PCM at 16 kHz, as Whisper expects.

    faster-whisper 1.2.x decodes with av.open(..., metadata_errors=...), an argument PyAV 15+ no
    longer accepts, so every transcription failed. Decoding here keeps working on any PyAV.
    """
    import av  # installed with faster-whisper
    import numpy as np

    resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=sampling_rate)
    chunks = []
    with av.open(str(path), mode="r") as container:
        for frame in container.decode(audio=0):
            for out in resampler.resample(frame):
                chunks.append(out.to_ndarray().reshape(-1))
    for out in resampler.resample(None):  # flush
        chunks.append(out.to_ndarray().reshape(-1))
    pcm = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.int16)
    return pcm.astype(np.float32) / 32768.0


def whisper_transcriber() -> Transcriber:
    from faster_whisper import WhisperModel  # imported lazily so tests don't need it

    device = os.environ.get("WHISPER_DEVICE", "auto")
    compute = os.environ.get("WHISPER_COMPUTE", "int8" if device in ("auto", "cpu") else "float16")
    model_name = os.environ.get("WHISPER_MODEL", "small")
    log.info("loading whisper model=%s device=%s compute=%s", model_name, device, compute)
    model = WhisperModel(model_name, device=device, compute_type=compute)

    def transcribe(path: Path) -> str:
        segments, _ = model.transcribe(decode_audio(path), language="th", vad_filter=True, beam_size=5)
        return "".join(s.text for s in segments)

    return transcribe


def drain(conn: sqlite3.Connection, files_root: Path, transcriber: Transcriber, idle_exit: float, poll: float,
          clock: Callable[[], float] = time.monotonic, sleep: Callable[[float], None] = time.sleep) -> int:
    """Process jobs until there has been nothing to do for `idle_exit` seconds. Returns the job count."""
    done = 0
    last_work = clock()
    while True:
        try:
            if run_once(conn, files_root, transcriber):
                done += 1
                last_work = clock()
                continue
        except sqlite3.OperationalError as err:  # e.g. database is locked
            log.warning("db busy: %s", err)
        if clock() - last_work >= idle_exit:
            return done
        sleep(poll)


def supervise(conn: sqlite3.Connection, start_batch: Callable[[], int], poll: float,
              sleep: Callable[[float], None] = time.sleep, rounds: Optional[int] = None) -> None:
    """Poll with no model loaded; run a batch process whenever an answer is waiting."""
    n = 0
    while rounds is None or n < rounds:
        n += 1
        try:
            pending = has_pending(conn)
        except sqlite3.OperationalError as err:
            log.warning("db busy: %s", err)
            pending = False
        if not pending:
            sleep(poll)
            continue
        code = start_batch()
        # the batch is gone: anything it left 'processing' was interrupted
        if (r := recover(conn)):
            log.info("re-queued %d interrupted job(s)", r)
        if code != 0:
            log.warning("batch exited with %s; retrying in 60s", code)
            sleep(60)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    data_dir = Path(os.environ.get("DATA_DIR", "data")).resolve()
    db_path = data_dir / "app.db"
    poll = float(os.environ.get("POLL_SECONDS", "5"))
    idle_exit = float(os.environ.get("IDLE_EXIT_SECONDS", "120"))

    while not db_path.exists():
        log.info("waiting for %s (start the web app first)", db_path)
        time.sleep(poll)
    conn = connect(db_path)

    if "--batch" in sys.argv:
        transcriber = whisper_transcriber()
        n = drain(conn, data_dir / "files", transcriber, idle_exit, poll)
        log.info("batch done: %d answer(s); unloading model", n)
        return

    if (n := recover(conn)):
        log.info("re-queued %d interrupted job(s)", n)
    log.info("watching %s (model loads only when there is work)", db_path)
    supervise(conn, lambda: subprocess.call([sys.executable, str(Path(__file__).resolve()), "--batch"]), poll)


if __name__ == "__main__":
    main()
