import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { fail, json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Used by scripts/deploy.sh to decide whether to keep a release or roll back. */
export async function GET() {
  try {
    getDb().get(sql`select 1`);
    return json({ ok: true, db: true });
  } catch {
    return fail(503, 'database unavailable');
  }
}
