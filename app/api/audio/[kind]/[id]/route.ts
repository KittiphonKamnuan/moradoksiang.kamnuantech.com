import { getDb } from '@/lib/db';
import { resolveAudio } from '@/lib/repo';
import { storage } from '@/lib/storage';
import { streamFile } from '@/lib/stream';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ kind: string; id: string }> };

/** GET /api/audio/{answer|prompt}/{id}?t={token} */
export async function GET(req: Request, ctx: Ctx) {
  const { kind, id } = await ctx.params;
  const token = new URL(req.url).searchParams.get('t') ?? '';
  if ((kind !== 'answer' && kind !== 'prompt') || !token) return new Response('not found', { status: 404 });
  const rel = resolveAudio(getDb(), kind, id, token);
  if (!rel) return new Response('not found', { status: 404 });
  return streamFile(req, storage.absolutePath(rel), 'audio/mp4');
}
