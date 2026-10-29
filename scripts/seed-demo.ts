/**
 * Create a complete demo life book.
 *
 *   npm run seed:demo                 # placeholder tones (for testing the UI)
 *   npm run seed:demo -- ./demo-audio # real recordings
 *
 * demo-audio/ layout (all optional):
 *   01.m4a 02.m4a …            answers, in the order of the default question set
 *   prompts/01.m4a …           grandchild asking each question
 *   transcripts.json           { "01": "ข้อความ…", … }
 *   photo.jpg                  cover photo
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb, DATA_DIR } from '../lib/db';
import { answers } from '../lib/schema';
import { eq } from 'drizzle-orm';
import { createStoryteller, completeSession, listQuestions, saveAnswer, setPromptAudio } from '../lib/repo';
import { storage } from '../lib/storage';
import { linksFor } from '../lib/http';

const dir = process.argv[2] ? path.resolve(process.argv[2]) : null;
const db = createDb(path.join(DATA_DIR, 'app.db'));

const mimeOf = (f: string) => (f.endsWith('.webm') ? 'audio/webm' : f.endsWith('.mp3') ? 'audio/mpeg' : f.endsWith('.wav') ? 'audio/wav' : 'audio/mp4');
const audioFiles = (d: string) =>
  fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /\.(m4a|mp4|webm|mp3|wav|ogg)$/i.test(f)).sort() : [];

function placeholderTone(i: number): Buffer {
  const file = path.join(os.tmpdir(), `moradok-demo-${i}.m4a`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${220 + i * 30}:duration=${4 + i}`, '-c:a', 'aac', file]);
  const buf = fs.readFileSync(file);
  fs.rmSync(file);
  return buf;
}

async function main() {
  const photo = dir && fs.existsSync(path.join(dir, 'photo.jpg')) ? await storage.saveFile(fs.readFileSync(path.join(dir, 'photo.jpg')), 'photos', 'jpg') : null;
  const s = createStoryteller(db, { name: 'คุณยายมาลี', callName: 'ยาย', creatorName: 'ภูมิ', photoPath: photo });
  const questions = listQuestions(db, s.id);
  const answerFiles = dir ? audioFiles(dir) : [];
  const promptFiles = dir ? audioFiles(path.join(dir, 'prompts')) : [];
  const transcripts: Record<string, string> =
    dir && fs.existsSync(path.join(dir, 'transcripts.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'transcripts.json'), 'utf8')) : {};

  const count = dir ? Math.min(answerFiles.length, questions.length) : questions.length;
  for (let i = 0; i < count; i++) {
    const q = questions[i];
    const key = String(i + 1).padStart(2, '0');
    const src = dir ? fs.readFileSync(path.join(dir, answerFiles[i])) : placeholderTone(i);
    const saved = await storage.saveAudio(src, 'answers', dir ? mimeOf(answerFiles[i]) : 'audio/mp4');
    const { answerId } = saveAnswer(db, {
      storytellerId: s.id,
      questionId: q.id,
      audioPath: saved.path,
      mime: 'audio/mp4',
      durationMs: saved.durationMs,
      transcriptStatus: transcripts[key] ? 'disabled' : 'pending',
    });
    if (transcripts[key]) db.update(answers).set({ transcript: transcripts[key], transcriptStatus: 'done' }).where(eq(answers.id, answerId)).run();
    if (promptFiles[i]) {
      const p = await storage.saveAudio(fs.readFileSync(path.join(dir!, 'prompts', promptFiles[i])), 'prompts', mimeOf(promptFiles[i]));
      setPromptAudio(db, q.id, p.path);
    }
    console.log(`  ${key} ${q.text.slice(0, 40)}…`);
  }
  completeSession(db, s.id);

  const links = linksFor(s);
  console.log(`\nDemo life book created${dir ? '' : ' (placeholder tones — pass a folder of real recordings for the real demo)'}:`);
  console.log(`  book:   ${links.book}`);
  console.log(`  manage: ${links.manage}`);
  console.log(`  record: ${links.record}`);
  console.log(`\nShow it on the landing page:  DEMO_BOOK_TOKEN=${s.bookToken}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
