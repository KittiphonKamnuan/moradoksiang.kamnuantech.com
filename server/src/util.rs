//! Small helpers ported from lib/tokens.ts, lib/range.ts and lib/ratelimit.ts.

use rand::Rng;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const ALPHABET: &[u8] = b"useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

fn nanoid(len: usize) -> String {
    let mut rng = rand::thread_rng();
    (0..len).map(|_| ALPHABET[rng.gen_range(0..64)] as char).collect()
}

/// capability-link token: 24 url-safe chars ≈ 143 bits of entropy
pub fn new_token() -> String {
    nanoid(24)
}
pub fn new_id() -> String {
    nanoid(16)
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[derive(Debug, PartialEq)]
pub enum Range {
    Whole,
    Part(u64, u64),
    Unsatisfiable,
}

/// Parse an HTTP Range header for a single byte range (same rules as lib/range.ts).
pub fn parse_range(header: Option<&str>, size: u64) -> Range {
    let Some(h) = header else { return Range::Whole };
    let h = h.trim();
    let Some(rest) = h.strip_prefix("bytes=") else { return Range::Whole };
    let rest = rest.trim_start();
    let digits = |s: &str| s.chars().take_while(|c| c.is_ascii_digit()).collect::<String>();
    let a = digits(rest);
    let after = &rest[a.len()..];
    let Some(after) = after.strip_prefix('-') else { return Range::Whole };
    let b = digits(after);
    if a.is_empty() && b.is_empty() {
        return Range::Whole;
    }
    // JS Number() of a very long digit string is a float; saturate instead of overflowing
    let num = |s: &str| s.parse::<u64>().unwrap_or(u64::MAX);
    let (start, end) = if a.is_empty() {
        let suffix = num(&b);
        if suffix == 0 {
            return Range::Unsatisfiable;
        }
        (size.saturating_sub(suffix), size.wrapping_sub(1))
    } else {
        let start = num(&a);
        let end = if b.is_empty() { size.wrapping_sub(1) } else { num(&b).min(size.wrapping_sub(1)) };
        (start, end)
    };
    if size == 0 || start >= size || start > end {
        return Range::Unsatisfiable;
    }
    Range::Part(start, end)
}

/// Sliding-window in-memory limiter. Good enough for a single self-hosted process.
pub struct RateLimiter {
    limit: usize,
    window_ms: i64,
    hits: Mutex<HashMap<String, Vec<i64>>>,
}

impl RateLimiter {
    pub fn new(limit: usize, window_ms: i64) -> Self {
        Self { limit, window_ms, hits: Mutex::new(HashMap::new()) }
    }

    pub fn check_at(&self, key: &str, now: i64) -> bool {
        let mut hits = self.hits.lock().unwrap();
        let recent = hits.entry(key.to_string()).or_default();
        recent.retain(|t| now - t < self.window_ms);
        if recent.len() >= self.limit {
            return false;
        }
        recent.push(now);
        true
    }

    pub fn check(&self, key: &str) -> bool {
        self.check_at(key, now_ms())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_url_safe_and_sized() {
        let t = new_token();
        assert_eq!(t.len(), 24);
        assert!(t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'));
        assert_eq!(new_id().len(), 16);
        assert_ne!(new_token(), new_token());
    }

    #[test]
    fn range_cases_match_lib_range() {
        assert_eq!(parse_range(None, 100), Range::Whole);
        assert_eq!(parse_range(Some("bytes=0-"), 100), Range::Part(0, 99));
        assert_eq!(parse_range(Some("bytes=10-19"), 100), Range::Part(10, 19));
        assert_eq!(parse_range(Some("bytes=90-200"), 100), Range::Part(90, 99));
        assert_eq!(parse_range(Some("bytes=-10"), 100), Range::Part(90, 99));
        assert_eq!(parse_range(Some("bytes=-500"), 100), Range::Part(0, 99));
        assert_eq!(parse_range(Some("bytes=-0"), 100), Range::Unsatisfiable);
        assert_eq!(parse_range(Some("bytes=100-"), 100), Range::Unsatisfiable);
        assert_eq!(parse_range(Some("bytes=50-40"), 100), Range::Unsatisfiable);
        assert_eq!(parse_range(Some("bytes=-"), 100), Range::Whole);
        assert_eq!(parse_range(Some("items=0-1"), 100), Range::Whole);
        assert_eq!(parse_range(Some("  bytes= 5-9 "), 100), Range::Part(5, 9));
        assert_eq!(parse_range(Some("bytes=0-0,5-9"), 100), Range::Part(0, 0));
    }

    #[test]
    fn limiter_blocks_after_limit_and_slides() {
        let l = RateLimiter::new(2, 1000);
        assert!(l.check_at("a", 0));
        assert!(l.check_at("a", 10));
        assert!(!l.check_at("a", 20));
        assert!(l.check_at("b", 20), "keys are independent");
        assert!(l.check_at("a", 1001), "first hit left the window");
        assert!(!l.check_at("a", 1002));
    }
}
