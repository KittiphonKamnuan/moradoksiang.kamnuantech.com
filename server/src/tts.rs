//! Port of lib/tts.ts: Google Thai TTS for questions the grandchild hasn't recorded.
//! Only the question text is sent to Google — the storyteller's voice never leaves the house.
//! Each spoken text is synthesized once and cached as data/files/tts/<hash>.m4a
//! (same hash as the Node version, so the existing cache stays valid).

use crate::storage::Storage;
use base64::Engine;
use regex::Regex;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, LazyLock, Mutex};

static STRIP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\p{Extended_Pictographic}\x{FE0F}\x{200D}]").unwrap());
static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\s\x{FEFF}]+").unwrap());

pub fn prepare_tts_text(text: &str) -> String {
    let t = STRIP.replace_all(text, "");
    let t = SPACES.replace_all(&t, " ");
    crate::questions::js_trim(&t).to_string()
}

/// `String(n)` / JSON.stringify for a number, as JavaScript prints it.
fn js_number(n: f64) -> String {
    if !n.is_finite() {
        return "null".into();
    }
    if n.fract() == 0.0 && n.abs() < 1e21 {
        return format!("{}", n as i64);
    }
    format!("{n}")
}

pub fn tts_cache_path(text: &str, voice: &str, rate: f64) -> String {
    let key = format!(
        "[{},{},{}]",
        serde_json::to_string(&prepare_tts_text(text)).unwrap(),
        serde_json::to_string(voice).unwrap(),
        js_number(rate)
    );
    let hash = hex::encode(Sha256::digest(key.as_bytes()));
    format!("tts/{}.m4a", &hash[..32])
}

pub type SynthFuture = Pin<Box<dyn Future<Output = Result<Vec<u8>, String>> + Send>>;
pub type Synthesizer = Arc<dyn Fn(String) -> SynthFuture + Send + Sync>;

pub struct Tts {
    pub voice: String,
    pub rate: f64,
    storage: Storage,
    synthesize: Synthesizer,
    locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

impl Tts {
    pub fn new(storage: Storage, voice: String, rate: f64, synthesize: Synthesizer) -> Self {
        Self { voice, rate, storage, synthesize, locks: Mutex::new(HashMap::new()) }
    }

    pub fn path_for(&self, text: &str) -> String {
        tts_cache_path(text, &self.voice, self.rate)
    }

    async fn create(&self, text: &str, rel: &str) -> Option<String> {
        if self.storage.exists(rel).await {
            return Some(rel.to_string());
        }
        let mp3 = match (self.synthesize)(text.to_string()).await {
            Ok(b) => b,
            Err(e) => {
                eprintln!("[tts] synthesis failed: {e}");
                return None;
            }
        };
        let name = &rel["tts/".len()..rel.len() - ".m4a".len()];
        match self.storage.save_audio(&mp3, "tts", "audio/mpeg", Some(name)).await {
            Ok(_) => Some(rel.to_string()),
            Err(e) => {
                eprintln!("[tts] synthesis failed: {e}");
                None
            }
        }
    }

    /// Concurrent calls for the same text wait for one synthesis (the second finds the cached file).
    pub async fn get_or_create(&self, raw: &str) -> Option<String> {
        let text = prepare_tts_text(raw);
        if text.is_empty() {
            return None;
        }
        let rel = self.path_for(&text);
        let lock = self.locks.lock().unwrap().entry(rel.clone()).or_default().clone();
        let out = {
            let _g = lock.lock().await;
            self.create(&text, &rel).await
        };
        let mut locks = self.locks.lock().unwrap();
        if locks.get(&rel).is_some_and(|l| Arc::strong_count(l) <= 2) {
            locks.remove(&rel);
        }
        out
    }

    /// generate in the background, one at a time (no burst against the API)
    pub fn warm(self: &Arc<Self>, texts: Vec<String>) {
        let me = self.clone();
        tokio::spawn(async move {
            for t in texts {
                me.get_or_create(&t).await;
            }
        });
    }
}

pub fn google_synthesizer(api_key: String, voice: String, rate: f64) -> Synthesizer {
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(30)).build().unwrap();
    Arc::new(move |text: String| {
        let (client, api_key, voice) = (client.clone(), api_key.clone(), voice.clone());
        Box::pin(async move {
            let res = client
                .post("https://texttospeech.googleapis.com/v1/text:synthesize")
                .header("x-goog-api-key", api_key)
                .json(&serde_json::json!({
                    "input": { "text": text },
                    "voice": { "languageCode": "th-TH", "name": voice },
                    "audioConfig": { "audioEncoding": "MP3", "speakingRate": rate, "sampleRateHertz": 24000 },
                }))
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let status = res.status();
            let body: serde_json::Value = res.json().await.unwrap_or_default();
            let audio = body.get("audioContent").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
            match audio {
                Some(a) if status.is_success() => base64::engine::general_purpose::STANDARD.decode(a).map_err(|e| e.to_string()),
                _ => Err(body
                    .pointer("/error/message")
                    .and_then(|m| m.as_str())
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("Google TTS {}", status.as_u16()))),
            }
        }) as SynthFuture
    })
}
