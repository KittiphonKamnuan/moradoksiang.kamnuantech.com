import { getDb } from '@/lib/db';
import { HttpError, handle, json, readAudioField, readForm } from '@/lib/http';
import { getQuestion, setPromptAudio } from '@/lib/repo';
import { storage } from '@/lib/storage';
import { requireManage } from '@/lib/manage';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ token: string; id: string }> };

async function requireQuestion(ctx: Ctx) {
  const { token, id } = await ctx.params;
  const s = requireManage(token);
  const q = getQuestion(getDb(), s.id, id);
  if (!q) throw new HttpError(404, 'question not found');
  return q;
}

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const q = await requireQuestion(ctx);
  const { bytes, mime } = await readAudioField(await readForm(req));
  let saved;
  try {
    saved = await storage.saveAudio(bytes, 'prompts', mime);
  } catch {
    throw new HttpError(422, 'could not decode audio');
  }
  await storage.removeFiles([setPromptAudio(getDb(), q.id, saved.path)]);
  return json({ ok: true, durationMs: saved.durationMs });
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const q = await requireQuestion(ctx);
  await storage.removeFiles([setPromptAudio(getDb(), q.id, null)]);
  return json({ ok: true });
});
