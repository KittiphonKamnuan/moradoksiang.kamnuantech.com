//! Port of lib/storage.ts + lib/audio.ts: files under DATA_DIR/files, transcoded with ffmpeg.

use crate::util::new_id;
use std::io;
use std::path::{Component, Path, PathBuf};
use tokio::process::Command;

pub const MAX_PHOTO_PX: u32 = 1024;

const EXTENSIONS: &[(&str, &str)] = &[
    ("audio/webm", "webm"),
    ("audio/mp4", "mp4"),
    ("audio/x-m4a", "m4a"),
    ("audio/m4a", "m4a"),
    ("audio/aac", "aac"),
    ("audio/ogg", "ogg"),
    ("audio/mpeg", "mp3"),
    ("audio/wav", "wav"),
    ("audio/x-wav", "wav"),
    ("audio/wave", "wav"),
];

fn base_type(mime: &str) -> String {
    mime.split(';').next().unwrap_or("").trim().to_lowercase()
}

pub fn extension_for_mime(mime: &str) -> &'static str {
    let b = base_type(mime);
    EXTENSIONS.iter().find(|(m, _)| *m == b).map(|(_, e)| *e).unwrap_or("bin")
}

pub fn is_allowed_upload_mime(mime: &str) -> bool {
    let b = base_type(mime);
    EXTENSIONS.iter().any(|(m, _)| *m == b)
}

#[derive(Clone)]
pub struct Storage {
    pub root: PathBuf,
    ffmpeg: String,
    ffprobe: String,
}

fn escape_err() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, "path escapes data dir")
}

impl Storage {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        let root = root.into();
        let root = std::path::absolute(&root).unwrap_or(root);
        Self {
            root,
            ffmpeg: std::env::var("FFMPEG_PATH").unwrap_or_else(|_| "ffmpeg".into()),
            ffprobe: std::env::var("FFPROBE_PATH").unwrap_or_else(|_| "ffprobe".into()),
        }
    }

    /// Only plain relative paths inside the data dir are allowed.
    pub fn absolute_path(&self, rel: &str) -> io::Result<PathBuf> {
        let p = Path::new(rel);
        if rel.is_empty() || p.is_absolute() {
            return Err(escape_err());
        }
        let mut normal = 0;
        for c in p.components() {
            match c {
                Component::Normal(_) => normal += 1,
                Component::CurDir => {}
                _ => return Err(escape_err()),
            }
        }
        if normal == 0 {
            return Err(escape_err());
        }
        Ok(self.root.join(p))
    }

    async fn run(&self, bin: &str, args: &[&str]) -> io::Result<Vec<u8>> {
        let out = Command::new(bin).args(args).kill_on_drop(true).output().await?;
        if !out.status.success() {
            let msg = String::from_utf8_lossy(&out.stderr);
            return Err(io::Error::other(format!("{bin} failed: {}", msg.trim())));
        }
        Ok(out.stdout)
    }

    /// Normalise any recorder output to mono AAC in .m4a — plays everywhere including Safari.
    async fn transcode_to_m4a(&self, input: &Path, output: &Path) -> io::Result<()> {
        let (i, o) = (input.to_string_lossy(), output.to_string_lossy());
        self.run(
            &self.ffmpeg,
            &["-v", "error", "-y", "-i", &i, "-vn", "-ac", "1", "-ar", "44100", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", &o],
        )
        .await
        .map(|_| ())
    }

    /// Re-encode any image to a JPEG whose long side is ≤ max_px, dropping all metadata (EXIF/GPS).
    async fn normalize_image(&self, input: &Path, output: &Path, max_px: u32) -> io::Result<()> {
        let fit = format!("'if(gte(iw,ih),min({max_px},iw),-1)':'if(gte(iw,ih),-1,min({max_px},ih))'");
        let vf = format!("scale={fit}");
        let (i, o) = (input.to_string_lossy(), output.to_string_lossy());
        self.run(&self.ffmpeg, &["-v", "error", "-y", "-i", &i, "-frames:v", "1", "-vf", &vf, "-map_metadata", "-1", "-q:v", "3", &o])
            .await
            .map(|_| ())
    }

    pub async fn probe_duration_ms(&self, file: &Path) -> Option<i64> {
        let f = file.to_string_lossy();
        let out = self.run(&self.ffprobe, &["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", &f]).await.ok()?;
        let secs: f64 = String::from_utf8_lossy(&out).trim().parse().ok()?;
        secs.is_finite().then(|| (secs * 1000.0).round() as i64)
    }

    /// `name` gives a deterministic file name (used for the TTS cache); default is random.
    /// Returns (relative path, duration).
    pub async fn save_audio(&self, bytes: &[u8], kind: &str, mime: &str, name: Option<&str>) -> io::Result<(String, Option<i64>)> {
        let dir = self.root.join(kind);
        tokio::fs::create_dir_all(&dir).await?;
        let id = name.map(str::to_string).unwrap_or_else(new_id);
        let tmp = dir.join(format!("{id}.{}.upload.{}", new_id(), extension_for_mime(mime)));
        let rel = format!("{kind}/{id}.m4a");
        let abs = self.absolute_path(&rel)?;
        tokio::fs::write(&tmp, bytes).await?;
        let res = self.transcode_to_m4a(&tmp, &abs).await;
        let _ = tokio::fs::remove_file(&tmp).await;
        if let Err(e) = res {
            let _ = tokio::fs::remove_file(&abs).await;
            return Err(e);
        }
        let duration = self.probe_duration_ms(&abs).await;
        Ok((rel, duration))
    }

    pub async fn save_file(&self, bytes: &[u8], kind: &str, ext: &str) -> io::Result<String> {
        tokio::fs::create_dir_all(self.root.join(kind)).await?;
        let rel = format!("{kind}/{}.{ext}", new_id());
        tokio::fs::write(self.absolute_path(&rel)?, bytes).await?;
        Ok(rel)
    }

    /// Store a photo as a normalised JPEG (≤ MAX_PHOTO_PX, no metadata). Errors if it is not an image.
    pub async fn save_image(&self, bytes: &[u8], kind: &str) -> io::Result<String> {
        let dir = self.root.join(kind);
        tokio::fs::create_dir_all(&dir).await?;
        let id = new_id();
        let tmp = dir.join(format!("{id}.upload"));
        let rel = format!("{kind}/{id}.jpg");
        let abs = self.absolute_path(&rel)?;
        tokio::fs::write(&tmp, bytes).await?;
        let res = self.normalize_image(&tmp, &abs, MAX_PHOTO_PX).await;
        let _ = tokio::fs::remove_file(&tmp).await;
        if let Err(e) = res {
            let _ = tokio::fs::remove_file(&abs).await;
            return Err(e);
        }
        Ok(rel)
    }

    pub async fn exists(&self, rel: &str) -> bool {
        match self.absolute_path(rel) {
            Ok(p) => tokio::fs::metadata(p).await.is_ok(),
            Err(_) => false,
        }
    }

    pub async fn remove_files<I, S>(&self, rels: I) -> io::Result<()>
    where
        I: IntoIterator<Item = Option<S>>,
        S: AsRef<str>,
    {
        for rel in rels.into_iter().flatten() {
            let rel = rel.as_ref();
            if rel.is_empty() {
                continue;
            }
            match tokio::fs::remove_file(self.absolute_path(rel)?).await {
                Ok(()) => {}
                Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                Err(e) => return Err(e),
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mime_rules_match_lib_mime() {
        assert_eq!(extension_for_mime("audio/webm;codecs=opus"), "webm");
        assert_eq!(extension_for_mime("AUDIO/MP4"), "mp4");
        assert_eq!(extension_for_mime("audio/x-m4a"), "m4a");
        assert_eq!(extension_for_mime("video/mp4"), "bin");
        assert!(is_allowed_upload_mime("audio/ogg; codecs=opus"));
        assert!(is_allowed_upload_mime("audio/mpeg"));
        assert!(!is_allowed_upload_mime("text/html"));
        assert!(!is_allowed_upload_mime(""));
    }

    #[test]
    fn absolute_path_rejects_escapes() {
        let s = Storage::new("/data/files");
        assert_eq!(s.absolute_path("answers/a.m4a").unwrap(), PathBuf::from("/data/files/answers/a.m4a"));
        assert!(s.absolute_path("../app.db").is_err());
        assert!(s.absolute_path("answers/../../x").is_err());
        assert!(s.absolute_path("/etc/passwd").is_err());
        assert!(s.absolute_path("").is_err());
        assert!(s.absolute_path(".").is_err());
    }
}
