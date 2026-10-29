import { getDb } from '@/lib/db';
import { HttpError, handle, json } from '@/lib/http';
import { getSession } from '@/lib/repo';
import { allLineKeys, lineText } from '@/lib/script';
import { getTtsService } from '@/lib/tts';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ token: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const session = getSession(getDb(), (await ctx.params).token);
  if (!session) throw new HttpError(404, 'not found');
  // pre-generate question voices while the storyteller is still on the welcome screen
  // order matters: the opening line plays first, then questions in order, then the other story lines
  const line = (k: Parameters<typeof lineText>[0]) => lineText(k, session.storyteller)!;
  const first = [line('intro'), line('welcome-back')];
  const questions = session.questions.filter((q) => !q.hasPromptAudio).map((q) => q.text);
  const rest = allLineKeys().map(line).filter((t) => !first.includes(t));
  getTtsService()?.warm([...first, ...questions, ...rest]);
  return json(session);
});
