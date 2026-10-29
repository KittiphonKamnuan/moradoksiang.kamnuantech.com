import { getDb } from '@/lib/db';
import { HttpError, handle, json, readAudioField, readForm } from '@/lib/http';
import { requireManage } from '@/lib/manage';
import { setIntroAudio } from '@/lib/repo';
import { storage } from '@/lib/storage';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ token: string }> };

/** The grandchild's own opening message, played before the first question. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const s = requireManage((await ctx.params).token);
  const { bytes, mime } = await readAudioField(await readForm(req));
  let saved;
  try {
    saved = await storage.saveAudio(bytes, 'prompts', mime);
  } catch {
    throw new HttpError(422, 'could not decode audio');
  }
  await storage.removeFiles([setIntroAudio(getDb(), s.id, saved.path)]);
  return json({ ok: true, durationMs: saved.durationMs });
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const s = requireManage((await ctx.params).token);
  await storage.removeFiles([setIntroAudio(getDb(), s.id, null)]);
  return json({ ok: true });
});
