import { getDb } from '@/lib/db';
import { HttpError, handle, json } from '@/lib/http';
import { requireManage } from '@/lib/manage';
import { getQuestion, resetAnswer } from '@/lib/repo';
import { storage } from '@/lib/storage';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ token: string; id: string }> };

/** Clear an answer (e.g. one that failed to upload) so the interview asks that question again. */
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const { token, id } = await ctx.params;
  const s = requireManage(token);
  if (!getQuestion(getDb(), s.id, id)) throw new HttpError(404, 'question not found');
  await storage.removeFiles([resetAnswer(getDb(), s.id, id)]);
  return json({ ok: true });
});
