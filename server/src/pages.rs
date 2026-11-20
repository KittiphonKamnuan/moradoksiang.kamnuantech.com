//! Serves the statically exported frontend (`next build` with `output: 'export'`).
//! Token pages (/m, /r, /b) share one prebuilt shell each (exported as `<x>/_.html`);
//! the server checks the token, sets the page title and answers 404 for unknown links.

use crate::db;
use crate::routes::App;
use axum::body::Body;
use axum::extract::{Path, Request, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use std::path::{Component, PathBuf};
use std::sync::Arc;
use tower::ServiceExt;
use tower_http::services::ServeFile;

type S = State<Arc<App>>;

pub fn page_router() -> Router<Arc<App>> {
    Router::new().route("/m/{token}", get(manage)).route("/r/{token}", get(record)).route("/b/{token}", get(book))
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn set_title(html: &str, title: &str) -> String {
    match (html.find("<title>"), html.find("</title>")) {
        (Some(a), Some(b)) if a < b => format!("{}<title>{}</title>{}", &html[..a], html_escape(title), &html[b + "</title>".len()..]),
        _ => html.to_string(),
    }
}

fn html_response(status: StatusCode, body: String) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8"), (header::CACHE_CONTROL, "private, no-cache, no-store, max-age=0, must-revalidate")],
        body,
    )
        .into_response()
}

async fn read_html(app: &App, rel: &str) -> Option<String> {
    tokio::fs::read_to_string(app.static_dir.join(rel)).await.ok()
}

pub async fn not_found_page(app: &App) -> Response {
    match read_html(app, "404.html").await {
        Some(h) => html_response(StatusCode::NOT_FOUND, h),
        None => crate::http::not_found_text(),
    }
}

async fn shell(app: &App, dir: &str, title: Option<String>) -> Response {
    let Some(html) = read_html(app, &format!("{dir}/_.html")).await else { return not_found_page(app).await };
    let html = match title {
        Some(t) => set_title(&html, &format!("{t} · มรดกเสียง")),
        None => html,
    };
    html_response(StatusCode::OK, html)
}

async fn manage(State(app): S, Path(token): Path<String>) -> Response {
    let found = db::get_by_manage_token(&app.db(), &token).ok().flatten().is_some();
    if !found {
        return not_found_page(&app).await;
    }
    shell(&app, "m", None).await
}

async fn record(State(app): S, Path(token): Path<String>) -> Response {
    let s = db::get_by_record_token(&app.db(), &token).ok().flatten();
    let Some(s) = s else { return not_found_page(&app).await };
    let kid = s.creator_name.unwrap_or_else(|| "หลาน".into());
    shell(&app, "r", Some(format!("เล่าให้{kid}ฟัง"))).await
}

async fn book(State(app): S, Path(token): Path<String>) -> Response {
    let s = db::get_by_book_token(&app.db(), &token).ok().flatten();
    let Some(s) = s else { return not_found_page(&app).await };
    shell(&app, "b", Some(format!("สมุดชีวิตของ{}", s.name))).await
}

/// Percent-decode a URL path (chunk names contain `[token]`, sent as `%5Btoken%5D`).
fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Map a URL path to a file in the export: `/x` → `x`, `x.html` or `x/index.html`.
fn resolve_static(root: &std::path::Path, url_path: &str) -> Option<PathBuf> {
    let decoded = percent_decode(url_path)?;
    let rel = decoded.trim_start_matches('/');
    let p = std::path::Path::new(rel);
    if p.components().any(|c| !matches!(c, Component::Normal(_))) {
        return None;
    }
    if rel.is_empty() {
        return Some(root.join("index.html")).filter(|f| f.is_file());
    }
    // the token shells are only reachable through the handlers above
    if rel.ends_with("/_.html") || rel.ends_with("/_") || rel.ends_with("/_.txt") {
        return None;
    }
    [root.join(rel), root.join(format!("{rel}.html")), root.join(rel).join("index.html")].into_iter().find(|f| f.is_file())
}

/// Fallback for everything that is not an API route or a token page.
pub async fn static_files(State(app): S, req: Request) -> Response {
    let path = req.uri().path().to_string();
    if path.starts_with("/api/") {
        return crate::http::not_found_text();
    }
    let Some(file) = resolve_static(&app.static_dir, &path) else { return not_found_page(&app).await };
    let is_html = file.extension().is_some_and(|e| e == "html");
    let mut res = match ServeFile::new(&file).oneshot(req).await {
        Ok(r) => r.map(Body::new),
        Err(_) => return not_found_page(&app).await,
    };
    let cache = if path.starts_with("/_next/static/") {
        "public, max-age=31536000, immutable"
    } else if is_html {
        "public, max-age=0, must-revalidate"
    } else {
        "public, max-age=3600"
    };
    res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_is_replaced_and_escaped() {
        let h = "<html><head><title>x · มรดกเสียง</title></head></html>";
        assert_eq!(set_title(h, "a<b>&\""), "<html><head><title>a&lt;b&gt;&amp;&quot;</title></head></html>");
        assert_eq!(set_title("<p>no title</p>", "t"), "<p>no title</p>");
    }

    #[test]
    fn static_paths_cannot_escape_or_reach_shells() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("index.html"), "i").unwrap();
        std::fs::write(dir.path().join("new.html"), "n").unwrap();
        std::fs::create_dir(dir.path().join("m")).unwrap();
        std::fs::write(dir.path().join("m/_.html"), "s").unwrap();
        assert_eq!(resolve_static(dir.path(), "/"), Some(dir.path().join("index.html")));
        assert_eq!(resolve_static(dir.path(), "/new"), Some(dir.path().join("new.html")));
        assert_eq!(resolve_static(dir.path(), "/m/_.html"), None);
        assert_eq!(resolve_static(dir.path(), "/../etc/passwd"), None);
        assert_eq!(resolve_static(dir.path(), "/missing"), None);
        std::fs::create_dir(dir.path().join("[token]")).unwrap();
        std::fs::write(dir.path().join("[token]/page.js"), "j").unwrap();
        assert_eq!(resolve_static(dir.path(), "/%5Btoken%5D/page.js"), Some(dir.path().join("[token]/page.js")));
        assert_eq!(resolve_static(dir.path(), "/%2e%2e/etc/passwd"), None, "decoded .. is still rejected");
        assert_eq!(resolve_static(dir.path(), "/%zz"), None);
    }
}
