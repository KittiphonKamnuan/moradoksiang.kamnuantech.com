import { getDb } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { manageView, requireManage } from '@/lib/manage';
import { deleteStoryteller, updateStoryteller } from '@/lib/repo';
import { storage } from '@/lib/storage';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ token: string }> };

export const GET = handle(async (req: Request, ctx: Ctx) => json(manageView((await ctx.params).token, req)));

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const s = requireManage((await ctx.params).token);
  const body = await readJson<{ name?: string; callName?: string; creatorName?: string }>(req);
  const patch: Parameters<typeof updateStoryteller>[2] = {};
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 100);
  if (typeof body.callName === 'string' && body.callName.trim()) patch.callName = body.callName.trim().slice(0, 30);
  if (typeof body.creatorName === 'string') patch.creatorName = body.creatorName.trim().slice(0, 100) || null;
  updateStoryteller(getDb(), s.id, patch);
  return json({ ok: true });
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const s = requireManage((await ctx.params).token);
  await storage.removeFiles(deleteStoryteller(getDb(), s.id));
  return json({ ok: true });
});
