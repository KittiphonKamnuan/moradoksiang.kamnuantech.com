import { getDb } from '@/lib/db';
import { HttpError, handle, json, readAudioField, readForm } from '@/lib/http';
import { createRateLimiter } from '@/lib/ratelimit';
import { getByRecordToken, getQuestion, saveAnswer, skipAnswer } from '@/lib/repo';
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

  const { bytes, mime } = await readAudioField(fd);
  let saved;
  try {
    saved = await storage.saveAudio(bytes, 'answers', mime);
  } catch {
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
