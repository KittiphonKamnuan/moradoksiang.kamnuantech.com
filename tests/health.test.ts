import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { tempDataDir } from './helpers';

const dataDir = tempDataDir();
process.env.DATA_DIR = dataDir;
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

describe('GET /api/health', () => {
  it('reports ok when the database answers, and is never cached', async () => {
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.db).toBe(true);
  });
});
