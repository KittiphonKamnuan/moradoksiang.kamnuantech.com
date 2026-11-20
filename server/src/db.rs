//! SQLite schema + queries: port of lib/db.ts, lib/schema.ts and lib/repo.ts.
//! Same tables and columns, so the existing app.db and worker/transcribe.py keep working.

use crate::questions::{
    build_default_question_list, chapter_title, js_trim, normalize_question_list, render_question, QuestionInput,
};
use crate::util::{new_id, new_token, now_ms};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;

pub type DbResult<T> = rusqlite::Result<T>;

pub const BOOTSTRAP_SQL: &str = "
CREATE TABLE IF NOT EXISTS storytellers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  call_name TEXT NOT NULL,
  creator_name TEXT,
  photo_path TEXT,
  intro_audio TEXT,
  manage_token TEXT UNIQUE NOT NULL,
  record_token TEXT UNIQUE NOT NULL,
  book_token TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  storyteller_id TEXT NOT NULL REFERENCES storytellers(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  chapter TEXT NOT NULL,
  text TEXT NOT NULL,
  prompt_audio TEXT,
  is_closing INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS questions_storyteller ON questions(storyteller_id, position);
CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL UNIQUE REFERENCES questions(id) ON DELETE CASCADE,
  storyteller_id TEXT NOT NULL REFERENCES storytellers(id) ON DELETE CASCADE,
  audio_path TEXT,
  mime TEXT,
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'saved',
  transcript TEXT,
  transcript_status TEXT NOT NULL DEFAULT 'pending',
  title TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS answers_transcript ON answers(transcript_status);
";

/// Columns added after the first release: (table, column, DDL) — applied if missing.
const MIGRATIONS: &[(&str, &str, &str)] = &[("storytellers", "intro_audio", "ALTER TABLE storytellers ADD COLUMN intro_audio TEXT")];

pub fn open(file: &Path) -> DbResult<Connection> {
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    init(Connection::open(file)?)
}

pub fn open_memory() -> DbResult<Connection> {
    init(Connection::open_in_memory()?)
}

fn init(conn: Connection) -> DbResult<Connection> {
    // WAL lets the transcription worker read/write concurrently
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "busy_timeout", 5000)?;
    conn.execute_batch(BOOTSTRAP_SQL)?;
    for (table, column, ddl) in MIGRATIONS {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
        let cols: Vec<String> = stmt.query_map([], |r| r.get::<_, String>(1))?.collect::<DbResult<_>>()?;
        drop(stmt);
        if !cols.iter().any(|c| c == column) {
            conn.execute_batch(ddl)?;
        }
    }
    Ok(conn)
}

#[derive(Debug, Clone)]
pub struct Storyteller {
    pub id: String,
    pub name: String,
    pub call_name: String,
    pub creator_name: Option<String>,
    pub photo_path: Option<String>,
    pub intro_audio: Option<String>,
    pub manage_token: String,
    pub record_token: String,
    pub book_token: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

const ST_COLS: &str = "s.id, s.name, s.call_name, s.creator_name, s.photo_path, s.intro_audio, s.manage_token, s.record_token, s.book_token, s.status, s.created_at, s.updated_at";

fn st_row(r: &Row, o: usize) -> DbResult<Storyteller> {
    Ok(Storyteller {
        id: r.get(o)?,
        name: r.get(o + 1)?,
        call_name: r.get(o + 2)?,
        creator_name: r.get(o + 3)?,
        photo_path: r.get(o + 4)?,
        intro_audio: r.get(o + 5)?,
        manage_token: r.get(o + 6)?,
        record_token: r.get(o + 7)?,
        book_token: r.get(o + 8)?,
        status: r.get(o + 9)?,
        created_at: r.get(o + 10)?,
        updated_at: r.get(o + 11)?,
    })
}

#[derive(Debug, Clone)]
pub struct Question {
    pub id: String,
    pub storyteller_id: String,
    pub position: i64,
    pub chapter: String,
    pub text: String,
    pub prompt_audio: Option<String>,
    pub is_closing: bool,
}

const Q_COLS: &str = "q.id, q.storyteller_id, q.position, q.chapter, q.text, q.prompt_audio, q.is_closing";

fn q_row(r: &Row, o: usize) -> DbResult<Question> {
    Ok(Question {
        id: r.get(o)?,
        storyteller_id: r.get(o + 1)?,
        position: r.get(o + 2)?,
        chapter: r.get(o + 3)?,
        text: r.get(o + 4)?,
        prompt_audio: r.get(o + 5)?,
        is_closing: r.get::<_, i64>(o + 6)? != 0,
    })
}

pub struct CreateStoryteller {
    pub name: String,
    pub call_name: String,
    pub creator_name: Option<String>,
    pub photo_path: Option<String>,
    pub questions: Option<Vec<QuestionInput>>,
}

pub fn create_storyteller(db: &mut Connection, input: CreateStoryteller) -> DbResult<Storyteller> {
    let name = js_trim(&input.name).to_string();
    let call_name = js_trim(&input.call_name).to_string();
    if name.is_empty() || call_name.is_empty() {
        return Err(rusqlite::Error::InvalidParameterName("name and callName are required".into()));
    }
    let now = now_ms();
    let row = Storyteller {
        id: new_id(),
        name,
        call_name,
        creator_name: input.creator_name.as_deref().map(js_trim).filter(|s| !s.is_empty()).map(str::to_string),
        photo_path: input.photo_path,
        intro_audio: None,
        manage_token: new_token(),
        record_token: new_token(),
        book_token: new_token(),
        status: "draft".into(),
        created_at: now,
        updated_at: now,
    };
    let list = match &input.questions {
        Some(q) => normalize_question_list(q),
        None => build_default_question_list(),
    };
    let tx = db.transaction()?;
    tx.execute(
        "INSERT INTO storytellers (id, name, call_name, creator_name, photo_path, intro_audio, manage_token, record_token, book_token, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![row.id, row.name, row.call_name, row.creator_name, row.photo_path, row.manage_token, row.record_token, row.book_token, row.status, row.created_at, row.updated_at],
    )?;
    for q in &list {
        tx.execute(
            "INSERT INTO questions (id, storyteller_id, position, chapter, text, is_closing) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![new_id(), row.id, q.position, q.chapter, q.text, q.is_closing as i64],
        )?;
    }
    tx.commit()?;
    Ok(row)
}

fn get_by(db: &Connection, column: &str, token: &str) -> DbResult<Option<Storyteller>> {
    db.query_row(&format!("SELECT {ST_COLS} FROM storytellers s WHERE s.{column} = ?1"), [token], |r| st_row(r, 0)).optional()
}
pub fn get_by_manage_token(db: &Connection, token: &str) -> DbResult<Option<Storyteller>> {
    get_by(db, "manage_token", token)
}
pub fn get_by_record_token(db: &Connection, token: &str) -> DbResult<Option<Storyteller>> {
    get_by(db, "record_token", token)
}
pub fn get_by_book_token(db: &Connection, token: &str) -> DbResult<Option<Storyteller>> {
    get_by(db, "book_token", token)
}

#[derive(Default)]
pub struct StorytellerPatch {
    pub name: Option<String>,
    pub call_name: Option<String>,
    /// Some(None) = clear
    pub creator_name: Option<Option<String>>,
}

pub fn update_storyteller(db: &Connection, id: &str, p: &StorytellerPatch) -> DbResult<()> {
    let now = now_ms();
    if let Some(v) = &p.name {
        db.execute("UPDATE storytellers SET name = ?1 WHERE id = ?2", params![v, id])?;
    }
    if let Some(v) = &p.call_name {
        db.execute("UPDATE storytellers SET call_name = ?1 WHERE id = ?2", params![v, id])?;
    }
    if let Some(v) = &p.creator_name {
        db.execute("UPDATE storytellers SET creator_name = ?1 WHERE id = ?2", params![v, id])?;
    }
    db.execute("UPDATE storytellers SET updated_at = ?1 WHERE id = ?2", params![now, id])?;
    Ok(())
}

pub fn list_questions(db: &Connection, storyteller_id: &str) -> DbResult<Vec<Question>> {
    let mut stmt = db.prepare(&format!("SELECT {Q_COLS} FROM questions q WHERE q.storyteller_id = ?1 ORDER BY q.position ASC"))?;
    let rows = stmt.query_map([storyteller_id], |r| q_row(r, 0))?.collect();
    rows
}

/// Replace the question list. Returns file paths (prompts + answers) of removed questions.
pub fn replace_questions(db: &mut Connection, storyteller_id: &str, input: &[QuestionInput]) -> DbResult<Vec<String>> {
    let existing = list_questions(db, storyteller_id)?;
    let own: HashSet<&str> = existing.iter().map(|q| q.id.as_str()).collect();
    let input: Vec<QuestionInput> = input
        .iter()
        .map(|q| QuestionInput { id: q.id.clone().filter(|id| own.contains(id.as_str())), ..q.clone() })
        .collect();
    let list = normalize_question_list(&input);
    let keep: HashSet<&str> = list.iter().filter_map(|q| q.id.as_deref()).collect();
    let removed: Vec<&Question> = existing.iter().filter(|q| !keep.contains(q.id.as_str())).collect();

    let mut files: Vec<String> = removed.iter().filter_map(|q| q.prompt_audio.clone()).collect();
    for q in &removed {
        let p: Option<Option<String>> =
            db.query_row("SELECT audio_path FROM answers WHERE question_id = ?1", [&q.id], |r| r.get(0)).optional()?;
        if let Some(Some(p)) = p {
            files.push(p);
        }
    }

    let tx = db.transaction()?;
    for q in &removed {
        tx.execute("DELETE FROM questions WHERE id = ?1", [&q.id])?;
    }
    for q in &list {
        match &q.id {
            Some(id) => {
                tx.execute(
                    "UPDATE questions SET position = ?1, chapter = ?2, text = ?3, is_closing = ?4 WHERE id = ?5",
                    params![q.position, q.chapter, q.text, q.is_closing as i64, id],
                )?;
            }
            None => {
                tx.execute(
                    "INSERT INTO questions (id, storyteller_id, position, chapter, text, is_closing) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![new_id(), storyteller_id, q.position, q.chapter, q.text, q.is_closing as i64],
                )?;
            }
        }
    }
    tx.commit()?;
    Ok(files)
}

/// Returns the previous prompt path (to delete)
pub fn set_prompt_audio(db: &Connection, question_id: &str, path: Option<&str>) -> DbResult<Option<String>> {
    let prev: Option<Option<String>> =
        db.query_row("SELECT prompt_audio FROM questions WHERE id = ?1", [question_id], |r| r.get(0)).optional()?;
    db.execute("UPDATE questions SET prompt_audio = ?1 WHERE id = ?2", params![path, question_id])?;
    Ok(prev.flatten())
}

pub fn get_question(db: &Connection, storyteller_id: &str, question_id: &str) -> DbResult<Option<Question>> {
    db.query_row(
        &format!("SELECT {Q_COLS} FROM questions q WHERE q.id = ?1 AND q.storyteller_id = ?2"),
        [question_id, storyteller_id],
        |r| q_row(r, 0),
    )
    .optional()
}

struct AnswerValues<'a> {
    audio_path: Option<&'a str>,
    mime: Option<&'a str>,
    duration_ms: Option<i64>,
    status: &'a str,
    transcript_status: &'a str,
}

pub struct Upserted {
    pub answer_id: String,
    pub previous_audio_path: Option<String>,
}

fn upsert_answer(db: &mut Connection, storyteller_id: &str, question_id: &str, v: AnswerValues) -> DbResult<Upserted> {
    if get_question(db, storyteller_id, question_id)?.is_none() {
        return Err(rusqlite::Error::InvalidParameterName("question does not belong to storyteller".into()));
    }
    let prev: Option<Option<String>> =
        db.query_row("SELECT audio_path FROM answers WHERE question_id = ?1", [question_id], |r| r.get(0)).optional()?;
    let id = new_id();
    let tx = db.transaction()?;
    tx.execute("DELETE FROM answers WHERE question_id = ?1", [question_id])?;
    tx.execute(
        "INSERT INTO answers (id, question_id, storyteller_id, audio_path, mime, duration_ms, status, transcript, transcript_status, title, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, NULL, ?9)",
        params![id, question_id, storyteller_id, v.audio_path, v.mime, v.duration_ms, v.status, v.transcript_status, now_ms()],
    )?;
    tx.execute(
        "UPDATE storytellers SET status = 'recording', updated_at = ?1 WHERE id = ?2 AND status = 'draft'",
        params![now_ms(), storyteller_id],
    )?;
    tx.commit()?;
    Ok(Upserted { answer_id: id, previous_audio_path: prev.flatten() })
}

pub fn save_answer(
    db: &mut Connection,
    storyteller_id: &str,
    question_id: &str,
    audio_path: &str,
    mime: &str,
    duration_ms: Option<i64>,
    transcript_status: &str,
) -> DbResult<Upserted> {
    upsert_answer(
        db,
        storyteller_id,
        question_id,
        AnswerValues { audio_path: Some(audio_path), mime: Some(mime), duration_ms, status: "saved", transcript_status },
    )
}

pub fn skip_answer(db: &mut Connection, storyteller_id: &str, question_id: &str) -> DbResult<Upserted> {
    upsert_answer(
        db,
        storyteller_id,
        question_id,
        AnswerValues { audio_path: None, mime: None, duration_ms: None, status: "skipped", transcript_status: "disabled" },
    )
}

/// The upload arrived but could not be decoded. Keeps the raw file (if any) for manual recovery and
/// marks the question so the grandchild sees it on the manage page. A good answer is never overwritten.
/// Returns the raw path to delete when it was not stored.
pub fn fail_answer(db: &mut Connection, storyteller_id: &str, question_id: &str, raw: Option<&str>) -> DbResult<Option<String>> {
    let prev: Option<String> =
        db.query_row("SELECT status FROM answers WHERE question_id = ?1", [question_id], |r| r.get(0)).optional()?;
    if prev.as_deref() == Some("saved") {
        return Ok(raw.map(str::to_string));
    }
    let u = upsert_answer(
        db,
        storyteller_id,
        question_id,
        AnswerValues { audio_path: raw, mime: None, duration_ms: None, status: "failed", transcript_status: "disabled" },
    )?;
    Ok(u.previous_audio_path)
}

/// Clear a question's answer so the interview asks it again. Returns the file to delete.
pub fn reset_answer(db: &Connection, storyteller_id: &str, question_id: &str) -> DbResult<Option<String>> {
    let row: Option<(String, Option<String>)> = db
        .query_row(
            "SELECT id, audio_path FROM answers WHERE question_id = ?1 AND storyteller_id = ?2",
            [question_id, storyteller_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let Some((id, p)) = row else { return Ok(None) };
    db.execute("DELETE FROM answers WHERE id = ?1", [id])?;
    Ok(p)
}

pub struct QuestionWithAnswer {
    pub q: Question,
    pub answer_status: Option<String>,
    pub duration_ms: Option<i64>,
}

pub fn list_questions_with_answers(db: &Connection, storyteller_id: &str) -> DbResult<Vec<QuestionWithAnswer>> {
    let mut stmt = db.prepare(&format!(
        "SELECT {Q_COLS}, a.status, a.duration_ms FROM questions q LEFT JOIN answers a ON a.question_id = q.id
         WHERE q.storyteller_id = ?1 ORDER BY q.position ASC"
    ))?;
    let rows = stmt
        .query_map([storyteller_id], |r| Ok(QuestionWithAnswer { q: q_row(r, 0)?, answer_status: r.get(7)?, duration_ms: r.get(8)? }))?
        .collect();
    rows
}

/// Returns the previous photo path (to delete)
pub fn set_photo(db: &Connection, storyteller_id: &str, path: Option<&str>) -> DbResult<Option<String>> {
    let prev: Option<Option<String>> =
        db.query_row("SELECT photo_path FROM storytellers WHERE id = ?1", [storyteller_id], |r| r.get(0)).optional()?;
    db.execute("UPDATE storytellers SET photo_path = ?1, updated_at = ?2 WHERE id = ?3", params![path, now_ms(), storyteller_id])?;
    Ok(prev.flatten())
}

/// Returns the previous intro path (to delete)
pub fn set_intro_audio(db: &Connection, storyteller_id: &str, path: Option<&str>) -> DbResult<Option<String>> {
    let prev: Option<Option<String>> =
        db.query_row("SELECT intro_audio FROM storytellers WHERE id = ?1", [storyteller_id], |r| r.get(0)).optional()?;
    db.execute("UPDATE storytellers SET intro_audio = ?1, updated_at = ?2 WHERE id = ?3", params![path, now_ms(), storyteller_id])?;
    Ok(prev.flatten())
}

pub fn complete_session(db: &Connection, storyteller_id: &str) -> DbResult<()> {
    db.execute("UPDATE storytellers SET status = 'completed', updated_at = ?1 WHERE id = ?2", params![now_ms(), storyteller_id])?;
    Ok(())
}

// ---------- views (JSON shapes are the same as the old Next.js API) ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStoryteller {
    pub id: String,
    pub name: String,
    pub call_name: String,
    pub creator_name: Option<String>,
    pub has_photo: bool,
    pub has_intro_audio: bool,
    pub status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionQuestion {
    pub id: String,
    pub chapter: String,
    pub text: String,
    pub has_prompt_audio: bool,
    pub is_closing: bool,
    pub answer_status: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub storyteller: SessionStoryteller,
    pub questions: Vec<SessionQuestion>,
    pub next_index: usize,
    pub done: bool,
}

pub fn get_session(db: &Connection, record_token: &str) -> DbResult<Option<Session>> {
    let Some(s) = get_by_record_token(db, record_token)? else { return Ok(None) };
    let questions: Vec<SessionQuestion> = list_questions_with_answers(db, &s.id)?
        .into_iter()
        .map(|r| SessionQuestion {
            id: r.q.id,
            chapter: r.q.chapter,
            text: render_question(&r.q.text, &s.call_name),
            has_prompt_audio: r.q.prompt_audio.is_some_and(|p| !p.is_empty()),
            is_closing: r.q.is_closing,
            answer_status: r.answer_status,
        })
        .collect();
    let next_index = questions.iter().position(|q| q.answer_status.is_none()).unwrap_or(questions.len());
    Ok(Some(Session {
        storyteller: SessionStoryteller {
            id: s.id,
            name: s.name,
            call_name: s.call_name,
            creator_name: s.creator_name,
            has_photo: s.photo_path.is_some_and(|p| !p.is_empty()),
            has_intro_audio: s.intro_audio.is_some_and(|p| !p.is_empty()),
            status: s.status,
        },
        done: next_index >= questions.len(),
        questions,
        next_index,
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookEntry {
    pub answer_id: String,
    pub question_id: String,
    pub question_text: String,
    pub has_prompt_audio: bool,
    pub duration_ms: Option<i64>,
    pub transcript: Option<String>,
    pub transcript_status: String,
    pub title: Option<String>,
}

#[derive(Serialize)]
pub struct BookChapter {
    pub chapter: String,
    pub title: String,
    pub entries: Vec<BookEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookStoryteller {
    pub id: String,
    pub name: String,
    pub call_name: String,
    pub creator_name: Option<String>,
    pub has_photo: bool,
    pub status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub storyteller: BookStoryteller,
    pub chapters: Vec<BookChapter>,
    pub total_duration_ms: i64,
}

pub fn get_book(db: &Connection, book_token: &str) -> DbResult<Option<Book>> {
    let Some(s) = get_by_book_token(db, book_token)? else { return Ok(None) };
    let mut stmt = db.prepare(&format!(
        "SELECT {Q_COLS}, a.id, a.duration_ms, a.transcript, a.transcript_status, a.title
         FROM questions q INNER JOIN answers a ON a.question_id = q.id
         WHERE q.storyteller_id = ?1 AND a.status = 'saved' ORDER BY q.position ASC"
    ))?;
    let rows = stmt.query_map([&s.id], |r| {
        Ok((
            q_row(r, 0)?,
            r.get::<_, String>(7)?,
            r.get::<_, Option<i64>>(8)?,
            r.get::<_, Option<String>>(9)?,
            r.get::<_, String>(10)?,
            r.get::<_, Option<String>>(11)?,
        ))
    })?;
    let mut chapters: Vec<BookChapter> = Vec::new();
    let mut total = 0i64;
    for row in rows {
        let (q, answer_id, duration_ms, transcript, transcript_status, title) = row?;
        if chapters.last().map(|c| c.chapter != q.chapter).unwrap_or(true) {
            let title = chapter_title(&q.chapter).map(str::to_string).unwrap_or_else(|| q.chapter.clone());
            chapters.push(BookChapter { chapter: q.chapter.clone(), title, entries: vec![] });
        }
        total += duration_ms.unwrap_or(0);
        chapters.last_mut().unwrap().entries.push(BookEntry {
            answer_id,
            question_id: q.id,
            question_text: render_question(&q.text, &s.call_name),
            has_prompt_audio: q.prompt_audio.is_some_and(|p| !p.is_empty()),
            duration_ms,
            transcript,
            transcript_status,
            title,
        });
    }
    Ok(Some(Book {
        storyteller: BookStoryteller {
            id: s.id,
            name: s.name,
            call_name: s.call_name,
            creator_name: s.creator_name,
            has_photo: s.photo_path.is_some_and(|p| !p.is_empty()),
            status: s.status,
        },
        chapters,
        total_duration_ms: total,
    }))
}

const ANY_TOKEN: &str = "(s.book_token = ?2 OR s.manage_token = ?2 OR s.record_token = ?2)";

/// Which tokens may stream which audio: answers -> book/manage; prompts + intro -> record/book/manage.
pub fn resolve_audio(db: &Connection, kind: &str, id: &str, token: &str) -> DbResult<Option<String>> {
    let sql = match kind {
        "intro" => format!("SELECT s.intro_audio FROM storytellers s WHERE s.id = ?1 AND {ANY_TOKEN}"),
        "answer" => "SELECT a.audio_path FROM answers a INNER JOIN storytellers s ON s.id = a.storyteller_id
                     WHERE a.id = ?1 AND (s.book_token = ?2 OR s.manage_token = ?2)"
            .to_string(),
        "prompt" => format!(
            "SELECT q.prompt_audio FROM questions q INNER JOIN storytellers s ON s.id = q.storyteller_id WHERE q.id = ?1 AND {ANY_TOKEN}"
        ),
        _ => return Ok(None),
    };
    let p: Option<Option<String>> = db.query_row(&sql, [id, token], |r| r.get(0)).optional()?;
    Ok(p.flatten().filter(|p| !p.is_empty()))
}

/// A question plus its storyteller, if `token` is any of that storyteller's tokens.
pub fn get_question_for_token(db: &Connection, question_id: &str, token: &str) -> DbResult<Option<(Question, Storyteller)>> {
    db.query_row(
        &format!("SELECT {Q_COLS}, {ST_COLS} FROM questions q INNER JOIN storytellers s ON s.id = q.storyteller_id WHERE q.id = ?1 AND {ANY_TOKEN}"),
        [question_id, token],
        |r| Ok((q_row(r, 0)?, st_row(r, 7)?)),
    )
    .optional()
}

/// Same rule for the cover photo.
pub fn resolve_photo(db: &Connection, token: &str) -> DbResult<Option<String>> {
    let p: Option<Option<String>> = db
        .query_row(
            "SELECT s.photo_path FROM storytellers s WHERE s.book_token = ?1 OR s.manage_token = ?1 OR s.record_token = ?1",
            [token],
            |r| r.get(0),
        )
        .optional()?;
    Ok(p.flatten().filter(|p| !p.is_empty()))
}

/// Deletes the storyteller (cascade). Returns every file path that must be removed from disk.
pub fn delete_storyteller(db: &Connection, id: &str) -> DbResult<Vec<String>> {
    let Some(s) = db.query_row(&format!("SELECT {ST_COLS} FROM storytellers s WHERE s.id = ?1"), [id], |r| st_row(r, 0)).optional()? else {
        return Ok(vec![]);
    };
    let mut files: Vec<String> = Vec::new();
    files.extend(s.photo_path.clone());
    files.extend(s.intro_audio.clone());
    for q in list_questions(db, id)? {
        files.extend(q.prompt_audio);
    }
    let mut stmt = db.prepare("SELECT audio_path FROM answers WHERE storyteller_id = ?1")?;
    for p in stmt.query_map([id], |r| r.get::<_, Option<String>>(0))? {
        files.extend(p?);
    }
    drop(stmt);
    db.execute("DELETE FROM storytellers WHERE id = ?1", [id])?;
    Ok(files.into_iter().filter(|f| !f.is_empty()).collect())
}

pub fn health(db: &Connection) -> DbResult<()> {
    db.query_row("SELECT 1", [], |_| Ok(()))
}
