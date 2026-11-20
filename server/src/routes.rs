//! The JSON API — same paths, status codes and bodies as the old app/api/** Next.js routes.

use crate::db::{self, Storyteller, StorytellerPatch};
use crate::http::*;
use crate::questions::{js_slice, js_trim, render_question, QuestionInput};
use crate::script::{is_line_key, line_text, LineContext, LINE_KEYS};
use crate::storage::{extension_for_mime, Storage};
use crate::tts::Tts;
use crate::util::RateLimiter;
use axum::extract::{Path, Query, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::Router;
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{json as j, Value};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

pub struct App {
    pub db: Mutex<Connection>,
    pub storage: Storage,
    pub tts: Option<Arc<Tts>>,
    /// NEXT_PUBLIC_BASE_URL without the trailing slash
    pub base_url: Option<String>,
    pub transcribe_off: bool,
    pub demo_book_token: Option<String>,
    pub static_dir: PathBuf,
    pub create_limiter: RateLimiter,
    pub answer_limiter: RateLimiter,
}

impl App {
    pub fn new(db: Connection, storage: Storage, tts: Option<Arc<Tts>>, static_dir: PathBuf) -> Self {
        Self {
            db: Mutex::new(db),
            storage,
            tts,
            base_url: None,
            transcribe_off: false,
            demo_book_token: None,
            static_dir,
            create_limiter: RateLimiter::new(100, 60 * 60 * 1000),
            answer_limiter: RateLimiter::new(120, 10 * 60 * 1000),
        }
    }

    pub fn db(&self) -> MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn base(&self, h: &HeaderMap) -> String {
        if let Some(b) = &self.base_url {
            return b.clone();
        }
        match h.get(header::HOST).and_then(|v| v.to_str().ok()) {
            Some(host) => format!("http://{host}"),
            None => "http://localhost:3000".into(),
        }
    }

    fn links(&self, s: &Storyteller, h: &HeaderMap) -> Value {
        let base = self.base(h);
        j!({ "manage": format!("{base}/m/{}", s.manage_token), "record": format!("{base}/r/{}", s.record_token), "book": format!("{base}/b/{}", s.book_token) })
    }

    fn abs(&self, rel: &str) -> Result<PathBuf, HttpError> {
        Ok(self.storage.absolute_path(rel)?)
    }
}

type S = State<Arc<App>>;

pub fn api_router() -> Router<Arc<App>> {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/config", get(config))
        .route("/api/storytellers", post(create_storyteller))
        .route("/api/r/{token}", get(session))
        .route("/api/r/{token}/answers", post(post_answer))
        .route("/api/r/{token}/complete", post(complete))
        .route("/api/b/{token}", get(book))
        .route("/api/m/{token}", get(manage_get).patch(manage_patch).delete(manage_delete))
        .route("/api/m/{token}/questions", put(put_questions))
        .route("/api/m/{token}/questions/{id}/audio", post(prompt_post).delete(prompt_delete))
        .route("/api/m/{token}/questions/{id}/answer", delete(answer_reset))
        .route("/api/m/{token}/intro", post(intro_post).delete(intro_delete))
        .route("/api/m/{token}/photo", post(photo_post).delete(photo_delete))
        .route("/api/audio/{kind}/{id}", get(audio))
        .route("/api/photo", get(photo))
        .route("/api/tts/{id}", get(tts_question))
        .route("/api/tts/line/{key}", get(tts_line))
}

// ---------- health / config ----------

/// Used by the container healthcheck and deploy scripts.
async fn health(State(app): S) -> Response {
    match db::health(&app.db()) {
        Ok(()) => json(StatusCode::OK, &j!({ "ok": true, "db": true })),
        Err(_) => HttpError::new(503, "database unavailable").into_response(),
    }
}

/// Runtime settings the static home page needs (was read from env during SSR).
async fn config(State(app): S) -> Response {
    json(StatusCode::OK, &j!({ "demoBookToken": app.demo_book_token }))
}

// ---------- storytellers ----------

fn parse_questions(raw: Option<&Value>) -> Result<Option<Vec<QuestionInput>>, HttpError> {
    let value = match raw {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::String(s)) if s.is_empty() => return Ok(None),
        Some(Value::String(s)) => serde_json::from_str::<Value>(s).map_err(|_| HttpError::new(400, "invalid questions"))?,
        Some(v) => v.clone(),
    };
    let Value::Array(items) = value else { return Err(HttpError::new(400, "questions must be an array")) };
    Ok(Some(items.iter().filter_map(QuestionInput::from_json).collect()))
}

async fn create_storyteller(State(app): S, req: Request) -> ApiResult {
    let headers = req.headers().clone();
    if !app.create_limiter.check(&client_key(&headers)) {
        return Err(HttpError::new(429, "too many requests"));
    }
    let is_form = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").contains("multipart/form-data");

    let (name, call_name, creator_name, questions_raw, photo): (Option<String>, Option<String>, Option<String>, Option<Value>, Option<Vec<u8>>);
    if is_form {
        let fd = read_form(req).await?;
        photo = read_photo_field(&fd, "photo")?.map(<[u8]>::to_vec);
        // FormData.get(...)?.toString(): a file part stringifies, which never matters here
        let t = |k: &str| fd.0.get(k).map(|v| match v {
            FormValue::Text(s) => s.clone(),
            FormValue::File { .. } => "[object File]".into(),
        });
        name = t("name");
        call_name = t("callName");
        creator_name = t("creatorName");
        questions_raw = t("questions").map(Value::String);
    } else {
        let body = read_json(req).await?;
        let s = |k: &str| body.get(k).and_then(|v| v.as_str()).map(str::to_string);
        name = s("name");
        call_name = s("callName");
        creator_name = s("creatorName");
        questions_raw = body.get("questions").cloned();
        photo = None;
    }

    let name = name.filter(|n| !js_trim(n).is_empty());
    let call_name = call_name.filter(|n| !js_trim(n).is_empty());
    let (Some(name), Some(call_name)) = (name, call_name) else {
        return Err(HttpError::new(400, "name and callName are required"));
    };
    let questions = parse_questions(questions_raw.as_ref())?;

    let photo_path = match photo {
        Some(bytes) => Some(app.storage.save_image(&bytes, "photos").await.map_err(|_| HttpError::new(422, "could not decode photo"))?),
        None => None,
    };
    let s = db::create_storyteller(
        &mut app.db(),
        db::CreateStoryteller {
            name: js_slice(&name, 100),
            call_name: js_slice(&call_name, 30),
            creator_name: creator_name.map(|c| js_slice(&c, 100)),
            photo_path,
            questions,
        },
    )?;
    Ok(json(
        StatusCode::CREATED,
        &j!({ "manageToken": s.manage_token, "recordToken": s.record_token, "bookToken": s.book_token, "links": app.links(&s, &headers) }),
    ))
}

// ---------- record link ----------

async fn session(State(app): S, Path(token): Path<String>) -> ApiResult {
    let session = db::get_session(&app.db(), &token)?.ok_or_else(|| HttpError::new(404, "not found"))?;
    // pre-generate question voices while the storyteller is still on the welcome screen
    // order matters: the opening line plays first, then questions in order, then the other story lines
    if let Some(tts) = &app.tts {
        let st = &session.storyteller;
        let ctx = LineContext { name: &st.name, call_name: &st.call_name, creator_name: st.creator_name.as_deref() };
        let line = |k: &str| line_text(k, &ctx).unwrap();
        let first = vec![line("intro"), line("welcome-back")];
        let mut texts = first.clone();
        texts.extend(session.questions.iter().filter(|q| !q.has_prompt_audio).map(|q| q.text.clone()));
        texts.extend(LINE_KEYS.iter().map(|k| line(k)).filter(|t| !first.contains(t)));
        tts.warm(texts);
    }
    ok(&session)
}

async fn post_answer(State(app): S, Path(token): Path<String>, req: Request) -> ApiResult {
    let s = db::get_by_record_token(&app.db(), &token)?.ok_or_else(|| HttpError::new(404, "not found"))?;
    if !app.answer_limiter.check(&token) {
        return Err(HttpError::new(429, "too many uploads"));
    }
    let fd = read_form(req).await?;
    let question_id = fd.text("questionId").unwrap_or("").to_string();
    if db::get_question(&app.db(), &s.id, &question_id)?.is_none() {
        return Err(HttpError::new(404, "question not found"));
    }
    if fd.text("skip") == Some("1") {
        db::skip_answer(&mut app.db(), &s.id, &question_id)?;
        return ok(&j!({ "ok": true, "skipped": true }));
    }
    let audio = match read_audio_field(&fd, "audio") {
        Ok(a) => a,
        Err(e) => {
            // too large: nothing worth keeping, but the grandchild should know this answer is missing
            if e.0 == StatusCode::PAYLOAD_TOO_LARGE {
                db::fail_answer(&mut app.db(), &s.id, &question_id, None)?;
            }
            return Err(e);
        }
    };
    let saved = match app.storage.save_audio(audio.bytes, "answers", &audio.mime, None).await {
        Ok(v) => v,
        Err(_) => {
            // keep the original recording for manual recovery and flag it on the manage page
            let raw = app.storage.save_file(audio.bytes, "answers", &format!("failed.{}", extension_for_mime(&audio.mime))).await?;
            let drop = db::fail_answer(&mut app.db(), &s.id, &question_id, Some(&raw))?;
            app.storage.remove_files([drop]).await?;
            return Err(HttpError::new(422, "could not decode audio"));
        }
    };
    let status = if app.transcribe_off { "disabled" } else { "pending" };
    let res = db::save_answer(&mut app.db(), &s.id, &question_id, &saved.0, "audio/mp4", saved.1, status)?;
    app.storage.remove_files([res.previous_audio_path]).await?;
    ok(&j!({ "ok": true, "answerId": res.answer_id, "durationMs": saved.1 }))
}

async fn complete(State(app): S, Path(token): Path<String>) -> ApiResult {
    let db = app.db();
    let s = db::get_by_record_token(&db, &token)?.ok_or_else(|| HttpError::new(404, "not found"))?;
    db::complete_session(&db, &s.id)?;
    ok(&j!({ "ok": true }))
}

// ---------- book link ----------

async fn book(State(app): S, Path(token): Path<String>) -> ApiResult {
    let b = db::get_book(&app.db(), &token)?.ok_or_else(|| HttpError::new(404, "not found"))?;
    ok(&b)
}

// ---------- manage link ----------

fn require_manage(app: &App, token: &str) -> Result<Storyteller, HttpError> {
    db::get_by_manage_token(&app.db(), token)?.ok_or_else(|| HttpError::new(404, "not found"))
}

pub fn manage_view(app: &App, token: &str, h: &HeaderMap) -> Result<Value, HttpError> {
    let s = require_manage(app, token)?;
    let rows = db::list_questions_with_answers(&app.db(), &s.id)?;
    let count = |st: &str| rows.iter().filter(|r| r.answer_status.as_deref() == Some(st)).count();
    let progress = j!({ "answered": count("saved"), "skipped": count("skipped"), "failed": count("failed"), "total": rows.len() });
    let questions: Vec<Value> = rows
        .iter()
        .map(|r| {
            j!({
                "id": r.q.id, "chapter": r.q.chapter, "text": r.q.text, "isClosing": r.q.is_closing,
                "hasPromptAudio": r.q.prompt_audio.as_deref().is_some_and(|p| !p.is_empty()),
                "answerStatus": r.answer_status, "durationMs": r.duration_ms,
            })
        })
        .collect();
    Ok(j!({
        "storytellerId": s.id,
        "storyteller": {
            "name": s.name, "callName": s.call_name, "creatorName": s.creator_name,
            "hasPhoto": s.photo_path.as_deref().is_some_and(|p| !p.is_empty()),
            "hasIntroAudio": s.intro_audio.as_deref().is_some_and(|p| !p.is_empty()),
            "status": s.status,
        },
        "questions": questions,
        "progress": progress,
        "links": app.links(&s, h),
        "tokens": { "manage": s.manage_token, "record": s.record_token, "book": s.book_token },
    }))
}

/// Every cached TTS file that speaks this storyteller's names (questions with {เรียก}, story lines
/// with the grandchild's name). Used to honour "delete everything" and to drop stale voices on rename.
fn cached_voices_for(app: &App, id: &str, name: &str, call_name: &str, creator_name: Option<&str>) -> Result<Vec<String>, HttpError> {
    let Some(tts) = &app.tts else { return Ok(vec![]) };
    let ctx = LineContext { name, call_name, creator_name };
    let mut texts: Vec<String> = db::list_questions(&app.db(), id)?.iter().map(|q| render_question(&q.text, call_name)).collect();
    texts.extend(LINE_KEYS.iter().filter_map(|k| line_text(k, &ctx)));
    Ok(texts.iter().map(|t| tts.path_for(t)).collect())
}

async fn manage_get(State(app): S, Path(token): Path<String>, headers: HeaderMap) -> ApiResult {
    ok(&manage_view(&app, &token, &headers)?)
}

async fn manage_patch(State(app): S, Path(token): Path<String>, req: Request) -> ApiResult {
    let s = require_manage(&app, &token)?;
    let body = read_json(req).await?;
    let mut patch = StorytellerPatch::default();
    if let Some(n) = body.get("name").and_then(Value::as_str).map(js_trim).filter(|n| !n.is_empty()) {
        patch.name = Some(js_slice(n, 100));
    }
    if let Some(n) = body.get("callName").and_then(Value::as_str).map(js_trim).filter(|n| !n.is_empty()) {
        patch.call_name = Some(js_slice(n, 30));
    }
    if let Some(n) = body.get("creatorName").and_then(Value::as_str) {
        patch.creator_name = Some(Some(js_slice(js_trim(n), 100)).filter(|c| !c.is_empty()));
    }
    let before = cached_voices_for(&app, &s.id, &s.name, &s.call_name, s.creator_name.as_deref())?;
    db::update_storyteller(&app.db(), &s.id, &patch)?;
    // voices that still say the old names are personal data we no longer need
    let name = patch.name.as_deref().unwrap_or(&s.name);
    let call = patch.call_name.as_deref().unwrap_or(&s.call_name);
    let creator = match &patch.creator_name {
        Some(c) => c.as_deref(),
        None => s.creator_name.as_deref(),
    };
    let after: HashSet<String> = cached_voices_for(&app, &s.id, name, call, creator)?.into_iter().collect();
    app.storage.remove_files(before.into_iter().filter(|p| !after.contains(p)).map(Some)).await?;
    ok(&j!({ "ok": true }))
}

async fn manage_delete(State(app): S, Path(token): Path<String>) -> ApiResult {
    let s = require_manage(&app, &token)?;
    let voices = cached_voices_for(&app, &s.id, &s.name, &s.call_name, s.creator_name.as_deref())?;
    let files = db::delete_storyteller(&app.db(), &s.id)?;
    app.storage.remove_files(files.into_iter().chain(voices).map(Some)).await?;
    ok(&j!({ "ok": true }))
}

async fn put_questions(State(app): S, Path(token): Path<String>, req: Request) -> ApiResult {
    let headers = req.headers().clone();
    let s = require_manage(&app, &token)?;
    let body = read_json(req).await?;
    let Some(items) = body.get("questions").and_then(Value::as_array) else {
        return Err(HttpError::new(400, "questions must be an array"));
    };
    let input: Vec<QuestionInput> = items
        .iter()
        .filter_map(QuestionInput::from_json)
        .take(60)
        .map(|q| QuestionInput { text: js_slice(&q.text, 300), ..q })
        .collect();
    let removed = db::replace_questions(&mut app.db(), &s.id, &input)?;
    app.storage.remove_files(removed.into_iter().map(Some)).await?;
    ok(&manage_view(&app, &token, &headers)?)
}

fn require_question(app: &App, token: &str, id: &str) -> Result<db::Question, HttpError> {
    let s = require_manage(app, token)?;
    db::get_question(&app.db(), &s.id, id)?.ok_or_else(|| HttpError::new(404, "question not found"))
}

async fn prompt_post(State(app): S, Path((token, id)): Path<(String, String)>, req: Request) -> ApiResult {
    let q = require_question(&app, &token, &id)?;
    let fd = read_form(req).await?;
    let a = read_audio_field(&fd, "audio")?;
    let saved = app.storage.save_audio(a.bytes, "prompts", &a.mime, None).await.map_err(|_| HttpError::new(422, "could not decode audio"))?;
    let prev = db::set_prompt_audio(&app.db(), &q.id, Some(&saved.0))?;
    app.storage.remove_files([prev]).await?;
    ok(&j!({ "ok": true, "durationMs": saved.1 }))
}

async fn prompt_delete(State(app): S, Path((token, id)): Path<(String, String)>) -> ApiResult {
    let q = require_question(&app, &token, &id)?;
    let prev = db::set_prompt_audio(&app.db(), &q.id, None)?;
    app.storage.remove_files([prev]).await?;
    ok(&j!({ "ok": true }))
}

/// Clear an answer (e.g. one that failed to upload) so the interview asks that question again.
async fn answer_reset(State(app): S, Path((token, id)): Path<(String, String)>) -> ApiResult {
    let s = require_manage(&app, &token)?;
    if db::get_question(&app.db(), &s.id, &id)?.is_none() {
        return Err(HttpError::new(404, "question not found"));
    }
    let f = db::reset_answer(&app.db(), &s.id, &id)?;
    app.storage.remove_files([f]).await?;
    ok(&j!({ "ok": true }))
}

/// The grandchild's own opening message, played before the first question.
async fn intro_post(State(app): S, Path(token): Path<String>, req: Request) -> ApiResult {
    let s = require_manage(&app, &token)?;
    let fd = read_form(req).await?;
    let a = read_audio_field(&fd, "audio")?;
    let saved = app.storage.save_audio(a.bytes, "prompts", &a.mime, None).await.map_err(|_| HttpError::new(422, "could not decode audio"))?;
    let prev = db::set_intro_audio(&app.db(), &s.id, Some(&saved.0))?;
    app.storage.remove_files([prev]).await?;
    ok(&j!({ "ok": true, "durationMs": saved.1 }))
}

async fn intro_delete(State(app): S, Path(token): Path<String>) -> ApiResult {
    let s = require_manage(&app, &token)?;
    let prev = db::set_intro_audio(&app.db(), &s.id, None)?;
    app.storage.remove_files([prev]).await?;
    ok(&j!({ "ok": true }))
}

async fn photo_post(State(app): S, Path(token): Path<String>, req: Request) -> ApiResult {
    let s = require_manage(&app, &token)?;
    let fd = read_form(req).await?;
    let bytes = read_photo_field(&fd, "photo")?.ok_or_else(|| HttpError::new(400, "missing photo"))?;
    let rel = app.storage.save_image(bytes, "photos").await.map_err(|_| HttpError::new(422, "could not decode photo"))?;
    let prev = db::set_photo(&app.db(), &s.id, Some(&rel))?;
    app.storage.remove_files([prev]).await?;
    ok(&j!({ "ok": true }))
}

async fn photo_delete(State(app): S, Path(token): Path<String>) -> ApiResult {
    let s = require_manage(&app, &token)?;
    let prev = db::set_photo(&app.db(), &s.id, None)?;
    app.storage.remove_files([prev]).await?;
    ok(&j!({ "ok": true }))
}

// ---------- media ----------

#[derive(Deserialize)]
struct TokenQuery {
    t: Option<String>,
}

/// GET /api/audio/{answer|prompt|intro}/{id}?t={token}  (intro id = storyteller id)
async fn audio(State(app): S, Path((kind, id)): Path<(String, String)>, Query(q): Query<TokenQuery>, headers: HeaderMap) -> Response {
    let token = q.t.unwrap_or_default();
    if !matches!(kind.as_str(), "answer" | "prompt" | "intro") || token.is_empty() {
        return not_found_text();
    }
    let rel = match db::resolve_audio(&app.db(), &kind, &id, &token) {
        Ok(Some(r)) => r,
        Ok(None) => return not_found_text(),
        Err(e) => return HttpError::from(e).into_response(),
    };
    match app.abs(&rel) {
        Ok(p) => stream_file(&headers, &p, "audio/mp4").await,
        Err(e) => e.into_response(),
    }
}

/// GET /api/photo?t={any token of the storyteller}
async fn photo(State(app): S, Query(q): Query<TokenQuery>, headers: HeaderMap) -> Response {
    let token = q.t.unwrap_or_default();
    let rel = if token.is_empty() { None } else { db::resolve_photo(&app.db(), &token).ok().flatten() };
    let Some(rel) = rel else { return not_found_text() };
    let ext = rel.rsplit('.').next().unwrap_or("");
    let ctype = PHOTO_TYPES.iter().find(|(_, e)| *e == ext).map(|(t, _)| *t).unwrap_or("application/octet-stream");
    match app.abs(&rel) {
        Ok(p) => stream_file(&headers, &p, ctype).await,
        Err(e) => e.into_response(),
    }
}

async fn speak(app: &App, tts: &Tts, text: &str, headers: &HeaderMap) -> Response {
    let Some(rel) = tts.get_or_create(text).await else { return text_404("tts unavailable") };
    match app.abs(&rel) {
        Ok(p) => stream_file(headers, &p, "audio/mp4").await,
        Err(e) => e.into_response(),
    }
}

fn text_404(body: &'static str) -> Response {
    crate::http::text(StatusCode::NOT_FOUND, body)
}

/// GET /api/tts/{questionId}?t={token} — natural Thai voice for a question; 404 = use the browser voice.
async fn tts_question(State(app): S, Path(id): Path<String>, Query(q): Query<TokenQuery>, headers: HeaderMap) -> Response {
    let token = q.t.unwrap_or_default();
    let Some(tts) = app.tts.clone() else { return not_found_text() };
    let row = if token.is_empty() { None } else { db::get_question_for_token(&app.db(), &id, &token).ok().flatten() };
    let Some((q, s)) = row else { return not_found_text() };
    speak(&app, &tts, &render_question(&q.text, &s.call_name), &headers).await
}

/// GET /api/tts/line/{intro|chapter-love|…}?t={token} — fixed story lines only, never arbitrary text.
async fn tts_line(State(app): S, Path(key): Path<String>, Query(q): Query<TokenQuery>, headers: HeaderMap) -> Response {
    let token = q.t.unwrap_or_default();
    let Some(tts) = app.tts.clone() else { return not_found_text() };
    if token.is_empty() || !is_line_key(&key) {
        return not_found_text();
    }
    let s = {
        let db = app.db();
        db::get_by_record_token(&db, &token)
            .ok()
            .flatten()
            .or_else(|| db::get_by_book_token(&db, &token).ok().flatten())
            .or_else(|| db::get_by_manage_token(&db, &token).ok().flatten())
    };
    let Some(s) = s else { return not_found_text() };
    let ctx = LineContext { name: &s.name, call_name: &s.call_name, creator_name: s.creator_name.as_deref() };
    let Some(text) = line_text(&key, &ctx) else { return not_found_text() };
    speak(&app, &tts, &text, &headers).await
}
