import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { params, tempDataDir, url } from './helpers';

const dataDir = tempDataDir();
process.env.DATA_DIR = dataDir;
process.env.GOOGLE_TTS_API_KEY = 'test-key';
process.env.GOOGLE_TTS_VOICE = 'th-TH-Neural2-C';

let mp3: Buffer;
const realFetch = globalThis.fetch;
const googleCalls: string[] = [];

beforeAll(() => {
  const file = path.join(dataDir, 'v.mp3');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=duration=1', '-c:a', 'libmp3lame', file]);
  mp3 = fs.readFileSync(file);
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).startsWith('https://texttospeech.googleapis.com')) {
      googleCalls.push(JSON.parse(init!.body as string).input.text);
      return Response.json({ audioContent: mp3.toString('base64') });
    }
    return realFetch(input, init);
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function setup() {
  const { getDb } = await import('@/lib/db');
  const { createStoryteller, listQuestions } = await import('@/lib/repo');
  const s = createStoryteller(getDb(), { name: 'คุณยายมาลี', callName: 'ยาย' });
  return { s, q: listQuestions(getDb(), s.id)[0] };
}

const getTts = async (id: string, t: string) => {
  const { GET } = await import('@/app/api/tts/[id]/route');
  return GET(new Request(url(`/api/tts/${id}?t=${t}`)), params({ id }));
};

describe('GET /api/tts/[questionId]', () => {
  it('speaks the rendered question ({เรียก} replaced) and streams m4a', async () => {
    const { s, q } = await setup();
    const res = await getTts(q.id, s.recordToken);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mp4');
    expect(googleCalls.at(-1)).toBe('พ่อกับแม่ของยายเป็นคนแบบไหนครับ');
  });

  it('works with the book token too (play whole book)', async () => {
    const { s, q } = await setup();
    expect((await getTts(q.id, s.bookToken)).status).toBe(200);
  });

  it('404 with a token of another storyteller', async () => {
    const a = await setup();
    const b = await setup();
    expect((await getTts(a.q.id, b.s.recordToken)).status).toBe(404);
  });

  it('404 when TTS is not configured (client falls back to the browser voice)', async () => {
    const { s, q } = await setup();
    const key = process.env.GOOGLE_TTS_API_KEY;
    delete process.env.GOOGLE_TTS_API_KEY;
    try {
      expect((await getTts(q.id, s.recordToken)).status).toBe(404);
    } finally {
      process.env.GOOGLE_TTS_API_KEY = key;
    }
  });

  it('opening the interview pre-generates every question without recorded audio', async () => {
    const { s } = await setup();
    const before = googleCalls.length;
    const { GET } = await import('@/app/api/r/[token]/route');
    await GET(new Request(url(`/api/r/${s.recordToken}`)), params({ token: s.recordToken }));
    const { getTtsService } = await import('@/lib/tts');
    await getTtsService()?.idle();
    // 11 questions; the first one was already cached by earlier tests (same text)
    expect(googleCalls.length - before).toBeGreaterThanOrEqual(9);
  });

  it('deleting the storyteller also removes its cached question voices (PDPA)', async () => {
    const { s, q } = await setup();
    const { getDb } = await import('@/lib/db');
    const { updateStoryteller } = await import('@/lib/repo');
    updateStoryteller(getDb(), s.id, { callName: 'คุณยายสมศรีลบได้' }); // unique text -> unique cache file
    expect((await getTts(q.id, s.recordToken)).status).toBe(200);
    const { getTtsService } = await import('@/lib/tts');
    const { storage } = await import('@/lib/storage');
    const rel = getTtsService()!.pathFor('พ่อกับแม่ของคุณยายสมศรีลบได้เป็นคนแบบไหนครับ');
    expect(await storage.exists(rel)).toBe(true);

    const { DELETE } = await import('@/app/api/m/[token]/route');
    expect((await DELETE(new Request(url('/'), { method: 'DELETE' }), params({ token: s.manageToken }))).status).toBe(200);
    expect(await storage.exists(rel)).toBe(false);
  });
});
