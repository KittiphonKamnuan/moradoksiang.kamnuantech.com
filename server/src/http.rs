//! Port of lib/http.ts + lib/stream.ts: JSON errors, form parsing, ranged file streaming.

use crate::util::{parse_range, Range};
use axum::body::Body;
use axum::extract::multipart::MultipartError;
use axum::extract::{FromRequest, Multipart, Request};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;

pub const MAX_AUDIO_BYTES: usize = 30 * 1024 * 1024; // ~15 min of iOS AAC with headroom
pub const MAX_PHOTO_BYTES: usize = 8 * 1024 * 1024;
/// whole request body; larger than MAX_AUDIO_BYTES so "too large" can still be recorded as a failed answer
pub const MAX_BODY_BYTES: usize = 64 * 1024 * 1024;

pub const PHOTO_TYPES: &[(&str, &str)] = &[("image/jpeg", "jpg"), ("image/png", "png"), ("image/webp", "webp"), ("image/heic", "heic")];

#[derive(Debug)]
pub struct HttpError(pub StatusCode, pub String);

impl HttpError {
    pub fn new(status: u16, msg: &str) -> Self {
        Self(StatusCode::from_u16(status).unwrap(), msg.to_string())
    }
    pub fn internal(e: impl std::fmt::Display) -> Self {
        eprintln!("[api] {e}");
        Self::new(500, "internal error")
    }
}

impl From<rusqlite::Error> for HttpError {
    fn from(e: rusqlite::Error) -> Self {
        Self::internal(e)
    }
}
impl From<std::io::Error> for HttpError {
    fn from(e: std::io::Error) -> Self {
        Self::internal(e)
    }
}

impl IntoResponse for HttpError {
    fn into_response(self) -> Response {
        json(self.0, &serde_json::json!({ "error": self.1 }))
    }
}

pub type ApiResult = Result<Response, HttpError>;

pub fn json<T: Serialize + ?Sized>(status: StatusCode, data: &T) -> Response {
    let body = serde_json::to_vec(data).unwrap_or_else(|_| b"{}".to_vec());
    (status, [(header::CONTENT_TYPE, "application/json"), (header::CACHE_CONTROL, "no-store")], body).into_response()
}

pub fn ok<T: Serialize + ?Sized>(data: &T) -> ApiResult {
    Ok(json(StatusCode::OK, data))
}

pub fn text(status: StatusCode, body: &'static str) -> Response {
    (status, [(header::CONTENT_TYPE, "text/plain;charset=UTF-8")], body).into_response()
}

pub fn not_found_text() -> Response {
    text(StatusCode::NOT_FOUND, "not found")
}

pub fn client_key(h: &HeaderMap) -> String {
    let get = |k: &str| h.get(k).and_then(|v| v.to_str().ok());
    if let Some(ip) = get("cf-connecting-ip") {
        return ip.to_string();
    }
    if let Some(x) = get("x-forwarded-for") {
        return x.split(',').next().unwrap_or("").trim().to_string();
    }
    "local".into()
}

// ---------- forms ----------

pub enum FormValue {
    Text(String),
    File { bytes: Vec<u8>, content_type: String },
}

/// Parsed multipart body; like FormData.get, the first value of a name wins.
pub struct Form(pub HashMap<String, FormValue>);

impl Form {
    pub fn text(&self, k: &str) -> Option<&str> {
        match self.0.get(k) {
            Some(FormValue::Text(s)) => Some(s),
            _ => None,
        }
    }
    pub fn file(&self, k: &str) -> Option<(&[u8], &str)> {
        match self.0.get(k) {
            Some(FormValue::File { bytes, content_type }) => Some((bytes, content_type)),
            _ => None,
        }
    }
}

fn form_error(e: MultipartError) -> HttpError {
    if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
        HttpError::new(413, "request too large")
    } else {
        HttpError::new(400, "invalid form data")
    }
}

pub async fn read_form(req: Request) -> Result<Form, HttpError> {
    let mut mp = Multipart::from_request(req, &()).await.map_err(|_| HttpError::new(400, "invalid form data"))?;
    let mut map = HashMap::new();
    while let Some(field) = mp.next_field().await.map_err(form_error)? {
        let name = field.name().unwrap_or("").to_string();
        let is_file = field.file_name().is_some();
        let content_type = field.content_type().unwrap_or("").to_string();
        let bytes = field.bytes().await.map_err(form_error)?;
        let value = if is_file {
            FormValue::File { bytes: bytes.to_vec(), content_type }
        } else {
            FormValue::Text(String::from_utf8_lossy(&bytes).into_owned())
        };
        map.entry(name).or_insert(value);
    }
    Ok(Form(map))
}

pub async fn read_json(req: Request) -> Result<serde_json::Value, HttpError> {
    let bytes = axum::body::to_bytes(req.into_body(), MAX_BODY_BYTES).await.map_err(|_| HttpError::new(400, "invalid json"))?;
    serde_json::from_slice(&bytes).map_err(|_| HttpError::new(400, "invalid json"))
}

pub struct Upload<'a> {
    pub bytes: &'a [u8],
    pub mime: String,
}

pub fn read_audio_field<'a>(fd: &'a Form, field: &str) -> Result<Upload<'a>, HttpError> {
    let Some((bytes, ctype)) = fd.file(field).filter(|(b, _)| !b.is_empty()) else {
        return Err(HttpError::new(400, "missing audio"));
    };
    let mime = fd.text("mime").filter(|m| !m.is_empty()).unwrap_or(ctype).to_string();
    if !crate::storage::is_allowed_upload_mime(&mime) {
        return Err(HttpError::new(415, "unsupported audio type"));
    }
    if bytes.len() > MAX_AUDIO_BYTES {
        return Err(HttpError::new(413, "audio too large"));
    }
    Ok(Upload { bytes, mime })
}

pub fn read_photo_field<'a>(fd: &'a Form, field: &str) -> Result<Option<&'a [u8]>, HttpError> {
    let Some((bytes, ctype)) = fd.file(field).filter(|(b, _)| !b.is_empty()) else { return Ok(None) };
    if !PHOTO_TYPES.iter().any(|(t, _)| *t == ctype) {
        return Err(HttpError::new(415, "unsupported photo type"));
    }
    if bytes.len() > MAX_PHOTO_BYTES {
        return Err(HttpError::new(413, "photo too large"));
    }
    Ok(Some(bytes))
}

// ---------- streaming ----------

/// Stream a file honouring HTTP Range (Safari needs 206 responses to play/seek audio).
pub async fn stream_file(headers: &HeaderMap, abs: &Path, content_type: &str) -> Response {
    let Ok(mut file) = tokio::fs::File::open(abs).await else { return not_found_text() };
    let size = match file.metadata().await {
        Ok(m) if m.is_file() => m.len(),
        _ => return not_found_text(),
    };
    let range = parse_range(headers.get(header::RANGE).and_then(|v| v.to_str().ok()), size);
    let mut b = Response::builder()
        .header(header::CONTENT_TYPE, HeaderValue::from_str(content_type).unwrap_or(HeaderValue::from_static("application/octet-stream")))
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "private, max-age=3600")
        .header("x-robots-tag", "noindex");
    let (start, end, status) = match range {
        Range::Unsatisfiable => {
            return b
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{size}"))
                .body(Body::empty())
                .unwrap();
        }
        Range::Whole if size == 0 => return b.status(StatusCode::OK).header(header::CONTENT_LENGTH, "0").body(Body::empty()).unwrap(),
        Range::Whole => (0, size - 1, StatusCode::OK),
        Range::Part(s, e) => {
            b = b.header(header::CONTENT_RANGE, format!("bytes {s}-{e}/{size}"));
            (s, e, StatusCode::PARTIAL_CONTENT)
        }
    };
    if start > 0 && file.seek(std::io::SeekFrom::Start(start)).await.is_err() {
        return HttpError::internal("seek failed").into_response();
    }
    let len = end - start + 1;
    b.status(status)
        .header(header::CONTENT_LENGTH, len.to_string())
        .body(Body::from_stream(ReaderStream::new(file.take(len))))
        .unwrap()
}
