import { getDb } from '@/lib/db';
import { HttpError, handle, json } from '@/lib/http';
import { getSession } from '@/lib/repo';
import { getTtsService } from '@/lib/tts';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ token: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const session = getSession(getDb(), (await ctx.params).token);
  if (!session) throw new HttpError(404, 'not found');
  // pre-generate question voices while the storyteller is still on the welcome screen
  getTtsService()?.warm(session.questions.filter((q) => !q.hasPromptAudio).map((q) => q.text));
  return json(session);
});
