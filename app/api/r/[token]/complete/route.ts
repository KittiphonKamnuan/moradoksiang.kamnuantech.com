import { getDb } from '@/lib/db';
import { HttpError, handle, json } from '@/lib/http';
import { completeSession, getByRecordToken } from '@/lib/repo';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ token: string }> };

export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const s = getByRecordToken(getDb(), (await ctx.params).token);
  if (!s) throw new HttpError(404, 'not found');
  completeSession(getDb(), s.id);
  return json({ ok: true });
});
