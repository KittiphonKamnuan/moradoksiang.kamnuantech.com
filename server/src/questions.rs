//! Port of lib/questions.ts (server side only: chapters, defaults, normalisation).
//! The full question bank stays in the frontend; the server only needs the default list.

use serde_json::Value;

pub const PLACEHOLDER: &str = "{เรียก}";

pub const CHAPTERS: &[(&str, &str)] = &[
    ("roots", "รากเหง้า"),
    ("past", "วันวาน"),
    ("love", "ความรัก"),
    ("family", "ครอบครัว"),
    ("life", "ชีวิตและการงาน"),
    ("someday", "ถ้าสักวันหนึ่ง…"),
    ("closing", "เรื่องที่อยากเล่าเอง"),
];

pub fn chapter_title(id: &str) -> Option<&'static str> {
    CHAPTERS.iter().find(|(k, _)| *k == id).map(|(_, t)| *t)
}

pub const CLOSING_TEXT: &str = "มีเรื่องไหนที่{เรียก}อยากเล่า แต่หลานยังไม่ได้ถามไหมครับ";

/// QUESTION_BANK entries for DEFAULT_QUESTION_IDS = [1, 5, 9, 12, 14, 16, 17, 20, 25, 26], in that order.
pub const DEFAULT_QUESTIONS: &[(&str, &str)] = &[
    ("roots", "พ่อกับแม่ของ{เรียก}เป็นคนแบบไหนครับ"),
    ("past", "ความทรงจำแรกที่{เรียก}จำได้คืออะไร"),
    ("love", "{เรียก}เจอคู่ชีวิตครั้งแรกที่ไหน ตอนนั้นคิดอะไรอยู่"),
    ("family", "วันแรกที่เห็นหน้าพ่อหรือแม่ของหนู {เรียก}รู้สึกยังไง"),
    ("family", "เพลงที่{เรียก}เคยร้องกล่อมลูก ร้องให้หลานฟังหน่อยได้ไหม 🎵"),
    ("life", "ช่วงไหนในชีวิตที่ลำบากที่สุด ผ่านมาได้ยังไง"),
    ("life", "เรื่องที่{เรียก}ภูมิใจในตัวเองที่สุดคืออะไร"),
    ("someday", "ถ้าสักวันหนึ่งหลานท้อจนไม่อยากสู้ต่อ {เรียก}อยากบอกอะไร"),
    ("someday", "ถ้าสักวันหนึ่งหลานคิดถึง{เรียก} อยากให้หลานทำอะไร"),
    ("someday", "{เรียก}อยากให้ทุกคนจดจำ{เรียก}แบบไหน"),
];

/// What the client sends. `chapter` / `is_closing` keep JS semantics (any JSON value).
#[derive(Debug, Clone, Default)]
pub struct QuestionInput {
    pub id: Option<String>,
    pub chapter: Value,
    pub text: String,
    pub is_closing: Value,
}

impl QuestionInput {
    /// `q && typeof q.text === 'string'` — anything else is dropped by the caller.
    pub fn from_json(v: &Value) -> Option<Self> {
        let o = v.as_object()?;
        let text = o.get("text")?.as_str()?.to_string();
        Some(Self {
            id: o.get("id").and_then(|x| x.as_str()).map(str::to_string),
            chapter: o.get("chapter").cloned().unwrap_or(Value::Null),
            text,
            is_closing: o.get("isClosing").cloned().unwrap_or(Value::Null),
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct QuestionDraft {
    pub id: Option<String>,
    pub position: i64,
    pub chapter: String,
    pub text: String,
    pub is_closing: bool,
}

/// JavaScript truthiness of a JSON value.
pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(true),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// JS `String.prototype.trim` (whitespace + line terminators + BOM).
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}')
}

/// JS `s.slice(0, n)` for BMP text (Thai, Latin): first n chars.
pub fn js_slice(s: &str, n: usize) -> String {
    let mut units = 0;
    let mut end = s.len();
    for (i, c) in s.char_indices() {
        if units + c.len_utf16() > n {
            end = i;
            break;
        }
        units += c.len_utf16();
    }
    s[..end].to_string()
}

pub fn render_question(text: &str, call_name: &str) -> String {
    text.split(PLACEHOLDER).collect::<Vec<_>>().join(js_trim(call_name))
}

/// Keep user order, drop blanks, guarantee exactly one closing question at the end.
pub fn normalize_question_list(input: &[QuestionInput]) -> Vec<QuestionDraft> {
    let mut body: Vec<QuestionDraft> = Vec::new();
    let mut closing: Option<QuestionDraft> = None;
    for q in input {
        let text = js_trim(&q.text);
        if text.is_empty() {
            continue;
        }
        let chapter = q.chapter.as_str();
        if truthy(&q.is_closing) || chapter == Some("closing") {
            if closing.is_none() {
                closing = Some(QuestionDraft { id: q.id.clone(), position: 0, chapter: "closing".into(), text: text.into(), is_closing: true });
            }
            continue;
        }
        let chapter = match chapter {
            Some(c) if chapter_title(c).is_some() => c.to_string(),
            _ => "life".to_string(),
        };
        body.push(QuestionDraft { id: q.id.clone(), position: 0, chapter, text: text.into(), is_closing: false });
    }
    let closing = closing.unwrap_or(QuestionDraft { id: None, position: 0, chapter: "closing".into(), text: CLOSING_TEXT.into(), is_closing: true });
    body.push(closing);
    for (i, q) in body.iter_mut().enumerate() {
        q.position = i as i64;
    }
    body
}

pub fn build_default_question_list() -> Vec<QuestionDraft> {
    let input: Vec<QuestionInput> = DEFAULT_QUESTIONS
        .iter()
        .map(|(c, t)| QuestionInput { id: None, chapter: Value::String((*c).into()), text: (*t).into(), is_closing: Value::Null })
        .collect();
    normalize_question_list(&input)
}
