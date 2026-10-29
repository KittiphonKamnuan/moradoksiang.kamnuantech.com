import { getDb } from '@/lib/db';
import { HttpError, handle, json } from '@/lib/http';
import { getSession } from '@/lib/repo';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ token: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const session = getSession(getDb(), (await ctx.params).token);
  if (!session) throw new HttpError(404, 'not found');
  return json(session);
});
