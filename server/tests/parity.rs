//! Compares the Rust ports with output captured from the original TypeScript (tests/fixtures/js.json).

use moradok_server::questions::{build_default_question_list, chapter_title, normalize_question_list, QuestionInput, CLOSING_TEXT};
use moradok_server::script::{line_text, LineContext, LINE_KEYS};
use moradok_server::tts::{prepare_tts_text, tts_cache_path};
use serde_json::Value;

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/js.json")).unwrap()
}

#[test]
fn line_keys_and_texts_match_script_ts() {
    let f = fixture();
    let keys: Vec<&str> = f["keys"].as_array().unwrap().iter().map(|k| k.as_str().unwrap()).collect();
    assert_eq!(keys, LINE_KEYS);
    for (i, ctx) in f["ctxs"].as_array().unwrap().iter().enumerate() {
        let c = LineContext {
            name: ctx["name"].as_str().unwrap(),
            call_name: ctx["callName"].as_str().unwrap(),
            creator_name: ctx["creatorName"].as_str(),
        };
        for k in LINE_KEYS {
            assert_eq!(line_text(k, &c).as_deref(), f["lines"][i][*k].as_str(), "ctx {i} key {k}");
        }
    }
    assert_eq!(line_text("bogus", &LineContext { name: "", call_name: "", creator_name: None }), None);
}

#[test]
fn tts_text_and_cache_paths_match_tts_ts() {
    for t in fixture()["tts"].as_array().unwrap() {
        let text = t["text"].as_str().unwrap();
        assert_eq!(prepare_tts_text(text), t["prepared"].as_str().unwrap(), "{text:?}");
        assert_eq!(tts_cache_path(text, t["voice"].as_str().unwrap(), t["rate"].as_f64().unwrap()), t["path"].as_str().unwrap(), "{text:?}");
    }
}

fn drafts_json(list: &[moradok_server::questions::QuestionDraft]) -> Value {
    Value::Array(
        list.iter()
            .map(|q| {
                let mut o = serde_json::json!({ "position": q.position, "chapter": q.chapter, "text": q.text, "isClosing": q.is_closing });
                if let Some(id) = &q.id {
                    o["id"] = Value::String(id.clone());
                }
                o
            })
            .collect(),
    )
}

fn strip_undefined_ids(v: &Value) -> Value {
    let mut v = v.clone();
    for q in v.as_array_mut().unwrap() {
        if q.get("id").is_some_and(Value::is_null) {
            q.as_object_mut().unwrap().remove("id");
        }
    }
    v
}

#[test]
fn questions_match_questions_ts() {
    let f = fixture();
    assert_eq!(CLOSING_TEXT, f["closing"].as_str().unwrap());
    for (k, v) in f["chapters"].as_object().unwrap() {
        assert_eq!(chapter_title(k), v["title"].as_str(), "{k}");
    }
    assert_eq!(drafts_json(&build_default_question_list()), strip_undefined_ids(&f["defaults"]));

    let input = vec![
        serde_json::json!({ "chapter": "love", "text": "  a " }),
        serde_json::json!({ "chapter": "bogus", "text": "b" }),
        serde_json::json!({ "chapter": "life", "text": "   " }),
        serde_json::json!({ "chapter": "closing", "text": "c1" }),
        serde_json::json!({ "chapter": "roots", "text": "c2", "isClosing": true }),
        serde_json::json!({ "id": "X", "chapter": "past", "text": "d" }),
    ];
    let input: Vec<QuestionInput> = input.iter().filter_map(QuestionInput::from_json).collect();
    assert_eq!(drafts_json(&normalize_question_list(&input)), strip_undefined_ids(&f["normalize"][0]));
    assert_eq!(drafts_json(&normalize_question_list(&[])), strip_undefined_ids(&f["normalize"][1]));
}
