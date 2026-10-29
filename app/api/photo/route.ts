import { getDb } from '@/lib/db';
import { PHOTO_TYPES } from '@/lib/http';
import { resolvePhoto } from '@/lib/repo';
import { storage } from '@/lib/storage';
import { streamFile } from '@/lib/stream';

export const runtime = 'nodejs';

const TYPE_BY_EXT = Object.fromEntries(Object.entries(PHOTO_TYPES).map(([type, ext]) => [ext, type]));

/** GET /api/photo?t={any token of the storyteller} */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('t') ?? '';
  const rel = token ? resolvePhoto(getDb(), token) : null;
  if (!rel) return new Response('not found', { status: 404 });
  const ext = rel.split('.').pop() ?? '';
  return streamFile(req, storage.absolutePath(rel), TYPE_BY_EXT[ext] ?? 'application/octet-stream');
}
