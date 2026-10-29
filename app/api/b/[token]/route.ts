import { getDb } from '@/lib/db';
import { HttpError, handle, json } from '@/lib/http';
import { getBook } from '@/lib/repo';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ token: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const book = getBook(getDb(), (await ctx.params).token);
  if (!book) throw new HttpError(404, 'not found');
  return json(book);
});
