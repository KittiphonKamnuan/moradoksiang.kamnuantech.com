import { getDb } from '@/lib/db';
import { HttpError, handle, json, readJson } from '@/lib/http';
import type { QuestionInput } from '@/lib/questions';
import { replaceQuestions } from '@/lib/repo';
import { storage } from '@/lib/storage';
import { manageView, requireManage } from '@/lib/manage';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ token: string }> };

export const PUT = handle(async (req: Request, ctx: Ctx) => {
  const { token } = await ctx.params;
  const s = requireManage(token);
  const body = await readJson<{ questions?: unknown }>(req);
  if (!Array.isArray(body.questions)) throw new HttpError(400, 'questions must be an array');
  const input: QuestionInput[] = body.questions
    .filter((q): q is QuestionInput => !!q && typeof (q as QuestionInput).text === 'string')
    .slice(0, 60)
    .map((q) => ({ id: q.id, chapter: q.chapter, text: q.text.slice(0, 300), isClosing: q.isClosing }));
  await storage.removeFiles(replaceQuestions(getDb(), s.id, input));
  return json(manageView(token, req));
});
