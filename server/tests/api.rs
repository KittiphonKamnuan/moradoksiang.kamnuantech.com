//! HTTP-level tests: same cases as the old vitest suites (api, manage-extra, intro-api, tts-api, health).

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use moradok_server::storage::Storage;
use moradok_server::tts::{Synthesizer, Tts};
use moradok_server::{db, router, App};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use tower::ServiceExt;

struct Ctx {
    app: Arc<App>,
    dir: tempfile::TempDir,
    synth_calls: Arc<AtomicUsize>,
}

fn media() -> &'static (Vec<u8>, Vec<u8>, Vec<u8>) {
    static M: OnceLock<(Vec<u8>, Vec<u8>, Vec<u8>)> = OnceLock::new();
    M.get_or_init(|| {
        let d = tempfile::tempdir().unwrap();
        let run = |args: &[&str]| assert!(Command::new("ffmpeg").args(args).status().unwrap().success());
        let wav = d.path().join("a.wav");
        let mp3 = d.path().join("a.mp3");
        let png = d.path().join("p.png");
        run(&["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", wav.to_str().unwrap()]);
        run(&["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=500:duration=1", "-c:a", "libmp3lame", mp3.to_str().unwrap()]);
        run(&["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=2000x1000", "-frames:v", "1", png.to_str().unwrap()]);
        (std::fs::read(wav).unwrap(), std::fs::read(mp3).unwrap(), std::fs::read(png).unwrap())
    })
}

fn setup(with_tts: bool) -> Ctx {
    let dir = tempfile::tempdir().unwrap();
    let storage = Storage::new(dir.path().join("files"));
    let static_dir = dir.path().join("out");
    std::fs::create_dir_all(static_dir.join("m")).unwrap();
    std::fs::create_dir_all(static_dir.join("r")).unwrap();
    std::fs::create_dir_all(static_dir.join("b")).unwrap();
    std::fs::write(static_dir.join("index.html"), "<title>home</title>home").unwrap();
    std::fs::write(static_dir.join("404.html"), "<title>404</title>nf").unwrap();
    for d in ["m", "r", "b"] {
        std::fs::write(static_dir.join(d).join("_.html"), format!("<head><title>shell</title></head>{d}")).unwrap();
    }
    let synth_calls = Arc::new(AtomicUsize::new(0));
    let tts = with_tts.then(|| {
        let calls = synth_calls.clone();
        let synth: Synthesizer = Arc::new(move |_t: String| {
            calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Ok(media().1.clone()) })
        });
        Arc::new(Tts::new(storage.clone(), "th-TH-Neural2-C".into(), 0.9, synth))
    });
    let mut app = App::new(db::open_memory().unwrap(), storage, tts, static_dir);
    app.base_url = Some("https://example.test".into());
    Ctx { app: Arc::new(app), dir, synth_calls }
}

struct Res {
    status: StatusCode,
    headers: axum::http::HeaderMap,
    body: Vec<u8>,
}
impl Res {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }
}

impl Ctx {
    async fn send(&self, req: Request<Body>) -> Res {
        let res = router(self.app.clone()).oneshot(req).await.unwrap();
        let status = res.status();
        let headers = res.headers().clone();
        let body = res.into_body().collect().await.unwrap().to_bytes().to_vec();
        Res { status, headers, body }
    }
    async fn get(&self, uri: &str) -> Res {
        self.send(Request::get(uri).body(Body::empty()).unwrap()).await
    }
    async fn get_range(&self, uri: &str, range: &str) -> Res {
        self.send(Request::get(uri).header("range", range).body(Body::empty()).unwrap()).await
    }
    async fn json(&self, method: &str, uri: &str, body: Value) -> Res {
        self.send(Request::builder().method(method).uri(uri).header("content-type", "application/json").body(Body::from(body.to_string())).unwrap())
            .await
    }
    async fn delete(&self, uri: &str) -> Res {
        self.send(Request::delete(uri).body(Body::empty()).unwrap()).await
    }
    async fn form(&self, method: &str, uri: &str, parts: &[Part<'_>]) -> Res {
        let boundary = "XbOuNdArYx";
        let mut body: Vec<u8> = Vec::new();
        for p in parts {
            body.extend(format!("--{boundary}\r\n").as_bytes());
            match p {
                Part::Text(n, v) => body.extend(format!("Content-Disposition: form-data; name=\"{n}\"\r\n\r\n{v}\r\n").as_bytes()),
                Part::File(n, ct, bytes) => {
                    body.extend(format!("Content-Disposition: form-data; name=\"{n}\"; filename=\"blob\"\r\nContent-Type: {ct}\r\n\r\n").as_bytes());
                    body.extend(*bytes);
                    body.extend(b"\r\n");
                }
            }
        }
        body.extend(format!("--{boundary}--\r\n").as_bytes());
        self.send(
            Request::builder()
                .method(method)
                .uri(uri)
                .header("content-type", format!("multipart/form-data; boundary={boundary}"))
                .body(Body::from(body))
                .unwrap(),
        )
        .await
    }
    fn file(&self, rel: &str) -> PathBuf {
        self.dir.path().join("files").join(rel)
    }
    fn files_in(&self, kind: &str) -> Vec<String> {
        std::fs::read_dir(self.dir.path().join("files").join(kind))
            .map(|d| d.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).collect())
            .unwrap_or_default()
    }
    async fn create(&self) -> Value {
        let r = self.json("POST", "/api/storytellers", json!({ "name": "คุณยายมาลี", "callName": "ยาย", "creatorName": "ภูมิ" })).await;
        assert_eq!(r.status, StatusCode::CREATED);
        r.json()
    }
    async fn session(&self, record: &str) -> Value {
        let r = self.get(&format!("/api/r/{record}")).await;
        assert_eq!(r.status, StatusCode::OK);
        r.json()
    }
    async fn answer(&self, record: &str, qid: &str) -> Res {
        self.form("POST", &format!("/api/r/{record}/answers"), &[Part::Text("questionId", qid), Part::File("audio", "audio/wav", &media().0)]).await
    }
}

enum Part<'a> {
    Text(&'a str, &'a str),
    File(&'a str, &'a str, &'a [u8]),
}

fn s(v: &Value) -> &str {
    v.as_str().unwrap()
}

#[tokio::test]
async fn health_ok() {
    let c = setup(false);
    let r = c.get("/api/health").await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.json(), json!({ "ok": true, "db": true }));
    assert_eq!(r.headers["cache-control"], "no-store");
}

#[tokio::test]
async fn create_returns_three_links_and_default_questions() {
    let c = setup(false);
    let t = c.create().await;
    for k in ["manageToken", "recordToken", "bookToken"] {
        assert_eq!(s(&t[k]).len(), 24);
    }
    assert_eq!(s(&t["links"]["record"]), format!("https://example.test/r/{}", s(&t["recordToken"])));
    let sess = c.session(s(&t["recordToken"])).await;
    let qs = sess["questions"].as_array().unwrap();
    assert_eq!(qs.len(), 11);
    assert_eq!(s(&qs[0]["text"]), "พ่อกับแม่ของยายเป็นคนแบบไหนครับ");
    assert_eq!(qs[10]["isClosing"], json!(true));
    assert_eq!(sess["nextIndex"], json!(0));
    assert_eq!(sess["done"], json!(false));
    assert_eq!(sess["storyteller"]["status"], json!("draft"));
    assert_eq!(sess["storyteller"]["creatorName"], json!("ภูมิ"));
}

#[tokio::test]
async fn create_validation() {
    let c = setup(false);
    assert_eq!(c.json("POST", "/api/storytellers", json!({ "name": "  ", "callName": "ยาย" })).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(c.json("POST", "/api/storytellers", json!({ "name": "a", "callName": "b", "questions": {} })).await.status, StatusCode::BAD_REQUEST);
    let bad = c.send(Request::post("/api/storytellers").header("content-type", "application/json").body(Body::from("{")).unwrap()).await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
    assert_eq!(bad.json(), json!({ "error": "invalid json" }));
    let html = c
        .form("POST", "/api/storytellers", &[Part::Text("name", "a"), Part::Text("callName", "b"), Part::File("photo", "text/html", b"<html>")])
        .await;
    assert_eq!(html.status, StatusCode::UNSUPPORTED_MEDIA_TYPE);
    let fake = c
        .form("POST", "/api/storytellers", &[Part::Text("name", "a"), Part::Text("callName", "b"), Part::File("photo", "image/png", b"notapng")])
        .await;
    assert_eq!(fake.status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn create_multipart_with_photo_and_custom_questions() {
    let c = setup(false);
    let qs = json!([{ "chapter": "love", "text": "{เรียก}ชอบกินอะไร" }, { "chapter": "closing", "text": "จบ", "isClosing": true }]).to_string();
    let r = c
        .form(
            "POST",
            "/api/storytellers",
            &[Part::Text("name", "ตาสม"), Part::Text("callName", "ตา"), Part::Text("questions", &qs), Part::File("photo", "image/png", &media().2)],
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED);
    let t = r.json();
    let sess = c.session(s(&t["recordToken"])).await;
    assert_eq!(sess["questions"].as_array().unwrap().len(), 2);
    assert_eq!(s(&sess["questions"][0]["text"]), "ตาชอบกินอะไร");
    assert_eq!(sess["storyteller"]["hasPhoto"], json!(true));
    let photo = c.get(&format!("/api/photo?t={}", s(&t["bookToken"]))).await;
    assert_eq!(photo.status, StatusCode::OK);
    assert_eq!(photo.headers["content-type"], "image/jpeg");
    // normalised to ≤1024px wide JPEG
    let saved = c.files_in("photos");
    assert_eq!(saved.len(), 1);
    let out = Command::new("ffprobe")
        .args(["-v", "error", "-show_entries", "stream=width", "-of", "csv=p=0"])
        .arg(c.file(&format!("photos/{}", saved[0])))
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "1024");
}

#[tokio::test]
async fn unknown_tokens_are_404() {
    let c = setup(false);
    let t = "x".repeat(24);
    assert_eq!(c.get(&format!("/api/r/{t}")).await.status, StatusCode::NOT_FOUND);
    assert_eq!(c.get(&format!("/api/b/{t}")).await.status, StatusCode::NOT_FOUND);
    assert_eq!(c.get(&format!("/api/m/{t}")).await.json(), json!({ "error": "not found" }));
}

#[tokio::test]
async fn answer_skip_fail_complete_and_book() {
    let c = setup(false);
    let t = c.create().await;
    let rec = s(&t["recordToken"]);
    let sess = c.session(rec).await;
    let q0 = s(&sess["questions"][0]["id"]).to_string();
    let q1 = s(&sess["questions"][1]["id"]).to_string();
    let q2 = s(&sess["questions"][2]["id"]).to_string();

    let r = c.answer(rec, &q0).await;
    assert_eq!(r.status, StatusCode::OK, "{}", String::from_utf8_lossy(&r.body));
    let a = r.json();
    let answer_id = s(&a["answerId"]).to_string();
    let dur = a["durationMs"].as_i64().unwrap();
    assert!((900..=1200).contains(&dur), "{dur}");
    let sess = c.session(rec).await;
    assert_eq!(sess["nextIndex"], json!(1));
    assert_eq!(sess["storyteller"]["status"], json!("recording"));

    let skip = c.form("POST", &format!("/api/r/{rec}/answers"), &[Part::Text("questionId", &q1), Part::Text("skip", "1")]).await;
    assert_eq!(skip.json(), json!({ "ok": true, "skipped": true }));

    // 400 neither audio nor skip; 415 non-audio; 422 undecodable keeps the raw bytes as failed
    let none = c.form("POST", &format!("/api/r/{rec}/answers"), &[Part::Text("questionId", &q2)]).await;
    assert_eq!(none.status, StatusCode::BAD_REQUEST);
    let html = c.form("POST", &format!("/api/r/{rec}/answers"), &[Part::Text("questionId", &q2), Part::File("audio", "text/html", b"<p>")]).await;
    assert_eq!(html.status, StatusCode::UNSUPPORTED_MEDIA_TYPE);
    let junk = c.form("POST", &format!("/api/r/{rec}/answers"), &[Part::Text("questionId", &q2), Part::File("audio", "audio/webm", b"junkjunk")]).await;
    assert_eq!(junk.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(c.files_in("answers").iter().any(|f| f.ends_with(".failed.webm")));
    let manage = c.get(&format!("/api/m/{}", s(&t["manageToken"]))).await.json();
    assert_eq!(manage["progress"], json!({ "answered": 1, "skipped": 1, "failed": 1, "total": 11 }));

    // a good upload replaces the failure and removes the raw file
    assert_eq!(c.answer(rec, &q2).await.status, StatusCode::OK);
    assert!(!c.files_in("answers").iter().any(|f| f.contains("failed")));

    // foreign question
    let other = c.create().await;
    let foreign = s(&c.session(s(&other["recordToken"])).await["questions"][0]["id"]).to_string();
    assert_eq!(c.answer(rec, &foreign).await.status, StatusCode::NOT_FOUND);

    let book = c.get(&format!("/api/b/{}", s(&t["bookToken"]))).await.json();
    assert_eq!(s(&book["chapters"][0]["chapter"]), "roots");
    assert_eq!(s(&book["chapters"][0]["title"]), "รากเหง้า");
    assert_eq!(s(&book["chapters"][0]["entries"][0]["answerId"]), answer_id);
    assert_eq!(s(&book["chapters"][0]["entries"][0]["transcriptStatus"]), "pending");
    assert_eq!(book["chapters"].as_array().unwrap().len(), 2, "skipped answer is not in the book");
    assert_eq!(c.get(&format!("/api/b/{rec}")).await.status, StatusCode::NOT_FOUND, "record token cannot open the book");

    let done = c.send(Request::post(format!("/api/r/{rec}/complete")).body(Body::empty()).unwrap()).await;
    assert_eq!(done.status, StatusCode::OK);
    assert_eq!(c.session(rec).await["storyteller"]["status"], json!("completed"));

    // streaming + range + token rules
    let book_t = s(&t["bookToken"]);
    let full = c.get(&format!("/api/audio/answer/{answer_id}?t={book_t}")).await;
    assert_eq!(full.status, StatusCode::OK);
    assert_eq!(full.headers["accept-ranges"], "bytes");
    assert_eq!(full.headers["content-type"], "audio/mp4");
    let size = full.body.len();
    let part = c.get_range(&format!("/api/audio/answer/{answer_id}?t={book_t}"), "bytes=0-9").await;
    assert_eq!(part.status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(part.body.len(), 10);
    assert_eq!(part.headers["content-range"], format!("bytes 0-9/{size}").as_str());
    let bad = c.get_range(&format!("/api/audio/answer/{answer_id}?t={book_t}"), &format!("bytes={}-", size + 5)).await;
    assert_eq!(bad.status, StatusCode::RANGE_NOT_SATISFIABLE);
    assert_eq!(c.get(&format!("/api/audio/answer/{answer_id}?t={rec}")).await.status, StatusCode::NOT_FOUND);
    assert_eq!(c.get(&format!("/api/audio/answer/{answer_id}?t=")).await.status, StatusCode::NOT_FOUND);
    assert_eq!(c.get(&format!("/api/audio/bogus/{answer_id}?t={book_t}")).await.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn manage_patch_put_prompt_reset_delete() {
    let c = setup(false);
    let t = c.create().await;
    let (m, rec) = (s(&t["manageToken"]).to_string(), s(&t["recordToken"]).to_string());
    assert_eq!(c.get(&format!("/api/m/{}", s(&t["bookToken"]))).await.status, StatusCode::NOT_FOUND);
    let view = c.get(&format!("/api/m/{m}")).await.json();
    assert_eq!(s(&view["questions"][0]["text"]), "พ่อกับแม่ของ{เรียก}เป็นคนแบบไหนครับ", "manage shows templates");
    assert_eq!(view["tokens"]["record"], json!(rec));

    let p = c.json("PATCH", &format!("/api/m/{m}"), json!({ "name": "  ยายใหม่ ", "callName": "ย่า", "creatorName": "  " })).await;
    assert_eq!(p.status, StatusCode::OK);
    let st = c.get(&format!("/api/m/{m}")).await.json()["storyteller"].clone();
    assert_eq!((s(&st["name"]), s(&st["callName"]), st["creatorName"].clone()), ("ยายใหม่", "ย่า", Value::Null));

    // prompt upload with the record token's question, stream, delete
    let q0 = s(&view["questions"][0]["id"]).to_string();
    let up = c.form("POST", &format!("/api/m/{m}/questions/{q0}/audio"), &[Part::File("audio", "audio/wav", &media().0)]).await;
    assert_eq!(up.status, StatusCode::OK);
    assert_eq!(c.get(&format!("/api/audio/prompt/{q0}?t={rec}")).await.status, StatusCode::OK);
    let other = c.create().await;
    let up2 = c.form("POST", &format!("/api/m/{}/questions/{q0}/audio", s(&other["manageToken"])), &[Part::File("audio", "audio/wav", &media().0)]).await;
    assert_eq!(up2.status, StatusCode::NOT_FOUND);

    // PUT: keep q0 + a new one, drop the rest; the prompt of q0 survives
    let q1 = s(&view["questions"][1]["id"]).to_string();
    assert_eq!(c.answer(&rec, &q1).await.status, StatusCode::OK);
    assert_eq!(c.files_in("answers").len(), 1);
    let put = c
        .json("PUT", &format!("/api/m/{m}/questions"), json!({ "questions": [{ "chapter": "past", "text": "ใหม่" }, { "id": q0, "chapter": "roots", "text": "เดิม" }] }))
        .await;
    assert_eq!(put.status, StatusCode::OK);
    let v = put.json();
    let texts: Vec<&str> = v["questions"].as_array().unwrap().iter().map(|q| s(&q["text"])).collect();
    assert_eq!(texts[..2], ["ใหม่", "เดิม"]);
    assert_eq!(v["questions"][1]["hasPromptAudio"], json!(true));
    assert_eq!(c.files_in("answers").len(), 0, "answer of the removed question was deleted");
    assert_eq!(c.json("PUT", &format!("/api/m/{m}/questions"), json!({ "questions": "x" })).await.status, StatusCode::BAD_REQUEST);

    assert_eq!(c.delete(&format!("/api/m/{m}/questions/{q0}/audio")).await.status, StatusCode::OK);
    assert_eq!(c.get(&format!("/api/audio/prompt/{q0}?t={rec}")).await.status, StatusCode::NOT_FOUND);
    assert_eq!(c.files_in("prompts").len(), 0);

    // reset an answer: manage token only
    assert_eq!(c.answer(&rec, &q0).await.status, StatusCode::OK);
    assert_eq!(c.delete(&format!("/api/m/{rec}/questions/{q0}/answer")).await.status, StatusCode::NOT_FOUND);
    assert_eq!(c.delete(&format!("/api/m/{m}/questions/{q0}/answer")).await.status, StatusCode::OK);
    assert_eq!(c.session(&rec).await["questions"][1]["answerStatus"], Value::Null);

    // intro + photo
    let intro = c.form("POST", &format!("/api/m/{m}/intro"), &[Part::File("audio", "audio/wav", &media().0)]).await;
    assert_eq!(intro.status, StatusCode::OK);
    let sid = s(&c.session(&rec).await["storyteller"]["id"]).to_string();
    assert_eq!(c.get(&format!("/api/audio/intro/{sid}?t={rec}")).await.status, StatusCode::OK);
    assert_eq!(c.get(&format!("/api/audio/intro/{sid}?t={}", s(&other["recordToken"]))).await.status, StatusCode::NOT_FOUND);
    assert_eq!(c.form("POST", &format!("/api/m/{rec}/intro"), &[Part::File("audio", "audio/wav", &media().0)]).await.status, StatusCode::NOT_FOUND);
    assert_eq!(c.form("POST", &format!("/api/m/{m}/photo"), &[Part::File("photo", "image/png", &media().2)]).await.status, StatusCode::OK);
    assert_eq!(c.form("POST", &format!("/api/m/{m}/photo"), &[]).await.status, StatusCode::BAD_REQUEST);

    // delete everything
    assert_eq!(c.answer(&rec, &q0).await.status, StatusCode::OK);
    assert_eq!(c.delete(&format!("/api/m/{m}")).await.status, StatusCode::OK);
    assert_eq!(c.get(&format!("/api/m/{m}")).await.status, StatusCode::NOT_FOUND);
    for kind in ["answers", "prompts", "photos"] {
        assert!(c.files_in(kind).is_empty(), "{kind}: {:?}", c.files_in(kind));
    }
}

#[tokio::test]
async fn tts_question_and_lines_cache_and_cleanup() {
    let c = setup(true);
    let t = c.create().await;
    let (m, rec) = (s(&t["manageToken"]).to_string(), s(&t["recordToken"]).to_string());
    // avoid the background warm-up racing the assertions: read the session straight from the DB
    let q0 = db::get_session(&c.app.db(), &rec).unwrap().unwrap().questions[0].id.clone();
    let a = c.get(&format!("/api/tts/{q0}?t={rec}")).await;
    assert_eq!(a.status, StatusCode::OK);
    assert_eq!(a.headers["content-type"], "audio/mp4");
    let tts = c.app.tts.clone().unwrap();
    assert!(c.file(&tts.path_for("พ่อกับแม่ของยายเป็นคนแบบไหนครับ")).exists());
    let again = c.get(&format!("/api/tts/{q0}?t={}", s(&t["bookToken"]))).await;
    assert_eq!(again.status, StatusCode::OK);
    assert_eq!(c.synth_calls.load(Ordering::SeqCst), 1, "second request served from cache");

    assert_eq!(c.get(&format!("/api/tts/{q0}?t=nope")).await.status, StatusCode::NOT_FOUND);
    assert_eq!(c.get(&format!("/api/tts/line/intro?t={rec}")).await.status, StatusCode::OK);
    assert_eq!(c.get(&format!("/api/tts/line/hack?t={rec}")).await.status, StatusCode::NOT_FOUND);
    let intro_path = tts.path_for(&moradok_server::script::line_text(
        "intro",
        &moradok_server::script::LineContext { name: "คุณยายมาลี", call_name: "ยาย", creator_name: Some("ภูมิ") },
    )
    .unwrap());
    assert!(c.file(&intro_path).exists());

    // renaming removes voices that still say the old names
    assert_eq!(c.json("PATCH", &format!("/api/m/{m}"), json!({ "creatorName": "ปอ" })).await.status, StatusCode::OK);
    assert!(!c.file(&intro_path).exists());
    assert!(c.file(&tts.path_for("พ่อกับแม่ของยายเป็นคนแบบไหนครับ")).exists(), "question voice has no grandchild name");
    // delete removes the voices that say the names
    assert_eq!(c.delete(&format!("/api/m/{m}")).await.status, StatusCode::OK);
    assert!(!c.file(&tts.path_for("พ่อกับแม่ของยายเป็นคนแบบไหนครับ")).exists());
}

#[tokio::test]
async fn no_tts_means_404_browser_voice() {
    let c = setup(false);
    let t = c.create().await;
    let q0 = s(&c.session(s(&t["recordToken"])).await["questions"][0]["id"]).to_string();
    assert_eq!(c.get(&format!("/api/tts/{q0}?t={}", s(&t["recordToken"]))).await.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn pages_check_tokens_and_set_titles() {
    let c = setup(false);
    let t = c.create().await;
    let r = c.get(&format!("/r/{}", s(&t["recordToken"]))).await;
    assert_eq!(r.status, StatusCode::OK);
    assert!(String::from_utf8_lossy(&r.body).contains("<title>เล่าให้ภูมิฟัง · มรดกเสียง</title>"));
    let b = c.get(&format!("/b/{}", s(&t["bookToken"]))).await;
    assert!(String::from_utf8_lossy(&b.body).contains("<title>สมุดชีวิตของคุณยายมาลี · มรดกเสียง</title>"));
    assert_eq!(c.get(&format!("/m/{}", s(&t["manageToken"]))).await.status, StatusCode::OK);
    assert_eq!(c.get(&format!("/m/{}", s(&t["bookToken"]))).await.status, StatusCode::NOT_FOUND, "book token cannot open manage");
    assert_eq!(c.get("/b/_").await.status, StatusCode::NOT_FOUND);
    assert_eq!(c.get("/m/_.html").await.status, StatusCode::NOT_FOUND);
    assert_eq!(c.get("/").await.status, StatusCode::OK);
    assert_eq!(c.get("/nope").await.status, StatusCode::NOT_FOUND);
    assert_eq!(c.get("/api/nope").await.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn upload_rate_limit() {
    let c = setup(false);
    let t = c.create().await;
    let rec = s(&t["recordToken"]).to_string();
    let q = s(&c.session(&rec).await["questions"][0]["id"]).to_string();
    for _ in 0..120 {
        c.form("POST", &format!("/api/r/{rec}/answers"), &[Part::Text("questionId", &q), Part::Text("skip", "1")]).await;
    }
    let r = c.form("POST", &format!("/api/r/{rec}/answers"), &[Part::Text("questionId", &q), Part::Text("skip", "1")]).await;
    assert_eq!(r.status, StatusCode::TOO_MANY_REQUESTS);
}

#[allow(dead_code)]
fn _unused(_: &Path) {}
