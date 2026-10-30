import { getDb } from '@/lib/db';
import { HttpError, handle, json, readAudioField, readForm } from '@/lib/http';
import { extensionForMime } from '@/lib/mime';
import { createRateLimiter } from '@/lib/ratelimit';
import { failAnswer, getByRecordToken, getQuestion, saveAnswer, skipAnswer } from '@/lib/repo';
import { storage } from '@/lib/storage';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ token: string }> };

const limiter = createRateLimiter({ limit: 120, windowMs: 10 * 60 * 1000 });

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { token } = await ctx.params;
  const db = getDb();
  const s = getByRecordToken(db, token);
  if (!s) throw new HttpError(404, 'not found');
  if (!limiter.check(token)) throw new HttpError(429, 'too many uploads');

  const fd = await readForm(req);
  const questionId = fd.get('questionId')?.toString() ?? '';
  if (!getQuestion(db, s.id, questionId)) throw new HttpError(404, 'question not found');

  if (fd.get('skip') === '1') {
    skipAnswer(db, s.id, questionId);
    return json({ ok: true, skipped: true });
  }

  let audio;
  try {
    audio = await readAudioField(fd);
  } catch (err) {
    // too large: nothing worth keeping, but the grandchild should know this answer is missing
    if (err instanceof HttpError && err.status === 413) failAnswer(db, s.id, questionId, null);
    throw err;
  }
  const { bytes, mime } = audio;
  let saved;
  try {
    saved = await storage.saveAudio(bytes, 'answers', mime);
  } catch {
    // keep the original recording for manual recovery and flag it on the manage page
    const raw = await storage.saveFile(bytes, 'answers', `failed.${extensionForMime(mime)}`);
    await storage.removeFiles([failAnswer(db, s.id, questionId, raw)]);
    throw new HttpError(422, 'could not decode audio');
  }
  const res = saveAnswer(db, {
    storytellerId: s.id,
    questionId,
    audioPath: saved.path,
    mime: 'audio/mp4',
    durationMs: saved.durationMs,
    transcriptStatus: process.env.TRANSCRIBE === 'off' ? 'disabled' : 'pending',
  });
  await storage.removeFiles([res.previousAudioPath]);
  return json({ ok: true, answerId: res.answerId, durationMs: saved.durationMs });
});
