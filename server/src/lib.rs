//! มรดกเสียง server: the JSON API (port of the old Next.js app/api routes) plus the static frontend.

pub mod db;
pub mod http;
pub mod pages;
pub mod questions;
pub mod routes;
pub mod script;
pub mod storage;
pub mod tts;
pub mod util;

use axum::extract::DefaultBodyLimit;
use axum::Router;
use std::sync::Arc;

pub use routes::App;

pub fn router(app: Arc<App>) -> Router {
    routes::api_router()
        .merge(pages::page_router())
        .fallback(pages::static_files)
        .layer(DefaultBodyLimit::max(http::MAX_BODY_BYTES))
        .with_state(app)
}
