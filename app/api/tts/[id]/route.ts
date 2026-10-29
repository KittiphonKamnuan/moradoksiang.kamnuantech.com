import { getDb } from '@/lib/db';
import { renderQuestion } from '@/lib/questions';
import { getQuestionForToken } from '@/lib/repo';
import { storage } from '@/lib/storage';
import { streamFile } from '@/lib/stream';
import { getTtsService } from '@/lib/tts';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };

/** GET /api/tts/{questionId}?t={token} — natural Thai voice for a question; 404 = use the browser voice. */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const token = new URL(req.url).searchParams.get('t') ?? '';
  const tts = getTtsService();
  const row = token ? getQuestionForToken(getDb(), id, token) : undefined;
  if (!tts || !row) return new Response('not found', { status: 404 });
  const rel = await tts.getOrCreate(renderQuestion(row.q.text, row.s.callName));
  if (!rel) return new Response('tts unavailable', { status: 404 });
  return streamFile(req, storage.absolutePath(rel), 'audio/mp4');
}
