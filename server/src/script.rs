//! Port of lib/script.ts: the fixed spoken lines around the questions.
//! The TTS route only ever speaks these, never arbitrary input.

use crate::questions::js_trim;

/// Same order as `Object.keys(LINES)` in script.ts (warm-up order depends on it).
pub const LINE_KEYS: &[&str] = &[
    "intro",
    "welcome-back",
    "outro",
    "ack-skip",
    "ack-0",
    "ack-1",
    "ack-2",
    "ack-3",
    "chapter-roots",
    "chapter-past",
    "chapter-love",
    "chapter-family",
    "chapter-life",
    "chapter-someday",
    "chapter-closing",
];

pub fn is_line_key(k: &str) -> bool {
    LINE_KEYS.contains(&k)
}

pub struct LineContext<'a> {
    pub name: &'a str,
    pub call_name: &'a str,
    pub creator_name: Option<&'a str>,
}

pub fn line_text(key: &str, ctx: &LineContext) -> Option<String> {
    let call = js_trim(ctx.call_name);
    let kid = match ctx.creator_name.map(js_trim) {
        Some(k) if !k.is_empty() => k,
        _ => "หลาน",
    };
    let _ = ctx.name;
    Some(match key {
        "intro" => format!(
            "สวัสดีครับ{call} {kid}อยากฟังเรื่องชีวิตของ{call}มากเลยครับ เลยฝากคำถามไว้ให้ถามทีละเรื่อง \
             {call}เล่าได้ตามสบายเลยนะครับ ไม่มีถูกไม่มีผิด นึกอะไรออกก็เล่าได้หมด จะยาวแค่ไหนก็ได้ \
             เล่าจบแล้วแตะปุ่ม เล่าจบแล้ว ได้เลยครับ ถ้าข้อไหนไม่อยากเล่าก็ข้ามได้นะครับ"
        ),
        "welcome-back" => format!(
            "ยินดีที่ได้คุยกันอีกครั้งนะครับ{call} คราวก่อน{call}เล่าไว้หลายเรื่องแล้ว {kid}ฟังแล้วชอบมากครับ วันนี้มาเล่าต่อกันนะครับ"
        ),
        "outro" => format!(
            "ขอบคุณ{call}มากนะครับที่เล่าให้ฟัง {kid}จะได้ฟังเรื่องของ{call}ไปอีกนานแสนนาน และจะเล่าต่อให้ลูกหลานฟังด้วยครับ"
        ),
        "ack-skip" => "ไม่เป็นไรครับ ไปเรื่องต่อไปกันนะครับ".to_string(),
        "ack-0" => "ขอบคุณที่เล่าให้ฟังนะครับ".to_string(),
        "ack-1" => format!("{kid}จะเก็บเรื่องนี้ไว้อย่างดีเลยครับ"),
        "ack-2" => format!("ขอบคุณครับ{call}"),
        "ack-3" => "ฟังแล้วเห็นภาพเลยครับ".to_string(),
        "chapter-roots" => format!("เริ่มกันที่เรื่องรากเหง้าก่อนนะครับ เรื่องบ้านและครอบครัวที่{call}โตมา"),
        "chapter-past" => format!("ทีนี้ลองย้อนกลับไปวันวานกันนะครับ สมัยที่{call}ยังเด็ก"),
        "chapter-love" => format!("ต่อไปเป็นเรื่องความรักครับ เรื่องนี้{kid}อยากรู้มานานแล้ว"),
        "chapter-family" => format!("มาถึงเรื่องครอบครัวกันนะครับ ตอนที่{call}มีลูกมีหลาน"),
        "chapter-life" => format!("ทีนี้อยากฟังเรื่องชีวิตและการงานของ{call}บ้างครับ"),
        "chapter-someday" => format!("ช่วงสุดท้ายแล้วนะครับ เป็นเรื่องที่{kid}อยากเก็บไว้ฟังตอนโตขึ้น ถ้าสักวันหนึ่ง…"),
        "chapter-closing" => "ก่อนจากกัน มีอีกคำถามเดียวครับ".to_string(),
        _ => return None,
    })
}
