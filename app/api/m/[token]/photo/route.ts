import { getDb } from '@/lib/db';
import { HttpError, handle, json, readForm, readPhotoField, storePhoto } from '@/lib/http';
import { requireManage } from '@/lib/manage';
import { setPhoto } from '@/lib/repo';
import { storage } from '@/lib/storage';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ token: string }> };

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const s = requireManage((await ctx.params).token);
  const photo = await readPhotoField(await readForm(req));
  if (!photo) throw new HttpError(400, 'missing photo');
  const rel = await storePhoto((b) => storage.saveImage(b, 'photos'), photo);
  await storage.removeFiles([setPhoto(getDb(), s.id, rel)]);
  return json({ ok: true });
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const s = requireManage((await ctx.params).token);
  await storage.removeFiles([setPhoto(getDb(), s.id, null)]);
  return json({ ok: true });
});
