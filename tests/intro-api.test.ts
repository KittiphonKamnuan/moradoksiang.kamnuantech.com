import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { audioBlob, form, params, tempDataDir, url, webmClip } from './helpers';

const dataDir = tempDataDir();
process.env.DATA_DIR = dataDir;
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

async function setup() {
  const { getDb } = await import('@/lib/db');
  const { createStoryteller } = await import('@/lib/repo');
  return createStoryteller(getDb(), { name: 'คุณยายมาลี', callName: 'ยาย', creatorName: 'ภูมิ' });
}
const session = async (t: string) => {
  const { GET } = await import('@/app/api/r/[token]/route');
  return (await GET(new Request(url('/')), params({ token: t }))).json();
};
const audio = async (id: string, t: string) => {
  const { GET } = await import('@/app/api/audio/[kind]/[id]/route');
  return GET(new Request(url(`/api/audio/intro/${id}?t=${t}`)), params({ kind: 'intro', id }));
};

describe('grandchild-recorded intro /api/m/[token]/intro', () => {
  it('upload -> session says hasIntroAudio -> streamable with the record token -> delete', async () => {
    const s = await setup();
    const route = await import('@/app/api/m/[token]/intro/route');
    const up = await route.POST(new Request(url('/'), { method: 'POST', body: form({ audio: audioBlob(webmClip()) }) }), params({ token: s.manageToken }));
    expect(up.status).toBe(200);

    const sess = await session(s.recordToken);
    expect(sess.storyteller.hasIntroAudio).toBe(true);
    expect((await audio(sess.storyteller.id, s.recordToken)).status).toBe(200);

    const del = await route.DELETE(new Request(url('/'), { method: 'DELETE' }), params({ token: s.manageToken }));
    expect(del.status).toBe(200);
    expect((await session(s.recordToken)).storyteller.hasIntroAudio).toBe(false);
    expect((await audio(sess.storyteller.id, s.recordToken)).status).toBe(404);
  });

  it('404 with a record token (only the manage link can change it)', async () => {
    const s = await setup();
    const route = await import('@/app/api/m/[token]/intro/route');
    const up = await route.POST(new Request(url('/'), { method: 'POST', body: form({ audio: audioBlob(webmClip()) }) }), params({ token: s.recordToken }));
    expect(up.status).toBe(404);
  });

  it('manage view reports hasIntroAudio', async () => {
    const s = await setup();
    const { manageView } = await import('@/lib/manage');
    expect(manageView(s.manageToken).storyteller.hasIntroAudio).toBe(false);
  });

  it('intro audio of another family is not reachable', async () => {
    const a = await setup();
    const b = await setup();
    const route = await import('@/app/api/m/[token]/intro/route');
    await route.POST(new Request(url('/'), { method: 'POST', body: form({ audio: audioBlob(webmClip()) }) }), params({ token: a.manageToken }));
    const aId = (await session(a.recordToken)).storyteller.id;
    expect((await audio(aId, b.recordToken)).status).toBe(404);
  });

  it('deleting the storyteller removes the intro file', async () => {
    const s = await setup();
    const route = await import('@/app/api/m/[token]/intro/route');
    await route.POST(new Request(url('/'), { method: 'POST', body: form({ audio: audioBlob(webmClip()) }) }), params({ token: s.manageToken }));
    const before = fs.readdirSync(`${dataDir}/files/prompts`).length;
    const m = await import('@/app/api/m/[token]/route');
    await m.DELETE(new Request(url('/'), { method: 'DELETE' }), params({ token: s.manageToken }));
    expect(fs.readdirSync(`${dataDir}/files/prompts`).length).toBe(before - 1);
  });
});
