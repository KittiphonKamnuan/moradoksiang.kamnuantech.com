use moradok_server::{db, router, storage::Storage, tts, App};
use std::path::PathBuf;
use std::sync::Arc;

fn env(k: &str) -> Option<String> {
    std::env::var(k).ok().filter(|v| !v.is_empty())
}

#[tokio::main]
async fn main() {
    let data_dir = std::path::absolute(PathBuf::from(env("DATA_DIR").unwrap_or_else(|| "data".into()))).expect("DATA_DIR");
    let static_dir = PathBuf::from(env("STATIC_DIR").unwrap_or_else(|| "out".into()));
    let port: u16 = env("PORT").and_then(|p| p.parse().ok()).unwrap_or(3000);

    let conn = db::open(&data_dir.join("app.db")).expect("open app.db");
    let storage = Storage::new(data_dir.join("files"));
    let tts = env("GOOGLE_TTS_API_KEY").map(|key| {
        let voice = env("GOOGLE_TTS_VOICE").unwrap_or_else(|| "th-TH-Neural2-C".into());
        let rate: f64 = env("GOOGLE_TTS_RATE").and_then(|r| r.parse().ok()).unwrap_or(0.9);
        Arc::new(tts::Tts::new(storage.clone(), voice.clone(), rate, tts::google_synthesizer(key, voice, rate)))
    });

    let mut app = App::new(conn, storage, tts, static_dir);
    app.base_url = env("NEXT_PUBLIC_BASE_URL").map(|b| b.trim_end_matches('/').to_string());
    app.transcribe_off = env("TRANSCRIBE").as_deref() == Some("off");
    app.demo_book_token = env("DEMO_BOOK_TOKEN");
    let tts_on = app.tts.is_some();

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await.expect("bind");
    eprintln!("moradok-server on :{port} data={} tts={tts_on}", data_dir.display());
    axum::serve(listener, router(Arc::new(app)))
        .with_graceful_shutdown(async {
            let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).unwrap();
            tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = term.recv() => {} }
        })
        .await
        .unwrap();
}
