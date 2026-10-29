import { getDb } from '@/lib/db';
import { getByBookToken, getByManageToken, getByRecordToken } from '@/lib/repo';
import { isLineKey, lineText } from '@/lib/script';
import { storage } from '@/lib/storage';
import { streamFile } from '@/lib/stream';
import { getTtsService } from '@/lib/tts';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ key: string }> };

/** GET /api/tts/line/{intro|chapter-love|…}?t={token} — fixed story lines only, never arbitrary text. */
export async function GET(req: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  const token = new URL(req.url).searchParams.get('t') ?? '';
  const tts = getTtsService();
  if (!tts || !token || !isLineKey(key)) return new Response('not found', { status: 404 });
  const db = getDb();
  const s = getByRecordToken(db, token) ?? getByBookToken(db, token) ?? getByManageToken(db, token);
  const text = s && lineText(key, s);
  if (!text) return new Response('not found', { status: 404 });
  const rel = await tts.getOrCreate(text);
  if (!rel) return new Response('tts unavailable', { status: 404 });
  return streamFile(req, storage.absolutePath(rel), 'audio/mp4');
}
