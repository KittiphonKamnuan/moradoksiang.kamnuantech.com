import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { audioBlob, form, params, tempDataDir, url, webmClip } from './helpers';

const dataDir = tempDataDir();
process.env.DATA_DIR = dataDir;
process.env.GOOGLE_TTS_API_KEY = 'test-key';

let mp3: Buffer;
const realFetch = globalThis.fetch;
beforeAll(() => {
  const f = path.join(dataDir, 'v.mp3');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=duration=1', '-c:a', 'libmp3lame', f]);
  mp3 = fs.readFileSync(f);
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) =>
    String(input).startsWith('https://texttospeech.googleapis.com') ? Response.json({ audioContent: mp3.toString('base64') }) : realFetch(input, init),
  );
});
afterAll(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function png(w: number, h: number) {
  const f = path.join(dataDir, `p-${w}.png`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=${w}x${h}:duration=1`, '-frames:v', '1', f]);
  return new Blob([new Uint8Array(fs.readFileSync(f))], { type: 'image/png' });
}

async function setup(name = 'คุณยายมาลี', creatorName = 'ภูมิ') {
  const { getDb } = await import('@/lib/db');
  const { createStoryteller, listQuestions } = await import('@/lib/repo');
  const s = createStoryteller(getDb(), { name, callName: 'ยาย', creatorName });
  return { s, qs: listQuestions(getDb(), s.id) };
}
const files = (sub: string) => (fs.existsSync(`${dataDir}/files/${sub}`) ? fs.readdirSync(`${dataDir}/files/${sub}`) : []);

describe('a. manage view shows progress', () => {
  it('reports answer status per question and totals', async () => {
    const { s, qs } = await setup();
    const { getDb } = await import('@/lib/db');
    const { saveAnswer, skipAnswer } = await import('@/lib/repo');
    saveAnswer(getDb(), { storytellerId: s.id, questionId: qs[0].id, audioPath: 'a', mime: 'audio/mp4', durationMs: 5000 });
    skipAnswer(getDb(), s.id, qs[1].id);
    const { manageView } = await import('@/lib/manage');
    const v = manageView(s.manageToken);
    expect(v.questions[0]).toMatchObject({ answerStatus: 'saved', durationMs: 5000 });
    expect(v.questions[1].answerStatus).toBe('skipped');
    expect(v.progress).toEqual({ answered: 1, skipped: 1, failed: 0, total: 11 });
  });
});

describe('c. upload that cannot be decoded', () => {
  it('422, keeps the original bytes, and marks the question failed for the grandchild to see', async () => {
    const { s, qs } = await setup();
    const before = files('answers').length;
    const { POST } = await import('@/app/api/r/[token]/answers/route');
    const res = await POST(
      new Request(url('/'), { method: 'POST', body: form({ questionId: qs[0].id, audio: audioBlob(Buffer.from('not really audio')) }) }),
      params({ token: s.recordToken }),
    );
    expect(res.status).toBe(422);
    expect(files('answers').length).toBe(before + 1); // raw kept for recovery
    const { manageView } = await import('@/lib/manage');
    expect(manageView(s.manageToken).questions[0].answerStatus).toBe('failed');
    expect(manageView(s.manageToken).progress.failed).toBe(1);
  });

  it('the grandchild can ask for that question again (manage token only)', async () => {
    const { s, qs } = await setup();
    const answers = await import('@/app/api/r/[token]/answers/route');
    await answers.POST(
      new Request(url('/'), { method: 'POST', body: form({ questionId: qs[0].id, audio: audioBlob(Buffer.from('nope')) }) }),
      params({ token: s.recordToken }),
    );
    const before = files('answers').length;
    const { DELETE } = await import('@/app/api/m/[token]/questions/[id]/answer/route');
    expect((await DELETE(new Request(url('/'), { method: 'DELETE' }), params({ token: s.recordToken, id: qs[0].id }))).status).toBe(404);
    expect((await DELETE(new Request(url('/'), { method: 'DELETE' }), params({ token: s.manageToken, id: qs[0].id }))).status).toBe(200);
    expect(files('answers').length).toBe(before - 1);
    const { getDb } = await import('@/lib/db');
    const { getSession } = await import('@/lib/repo');
    expect(getSession(getDb(), s.recordToken)!.nextIndex).toBe(0);
  });

  it('a decodable upload after a failure replaces it and removes the raw file', async () => {
    const { s, qs } = await setup();
    const { POST } = await import('@/app/api/r/[token]/answers/route');
    await POST(new Request(url('/'), { method: 'POST', body: form({ questionId: qs[0].id, audio: audioBlob(Buffer.from('x')) }) }), params({ token: s.recordToken }));
    const failedRaw = files('answers').filter((f) => f.includes('.failed.')).length;
    const ok = await POST(new Request(url('/'), { method: 'POST', body: form({ questionId: qs[0].id, audio: audioBlob(webmClip()) }) }), params({ token: s.recordToken }));
    expect(ok.status).toBe(200);
    expect(files('answers').filter((f) => f.includes('.failed.')).length).toBe(failedRaw - 1);
  });
});

describe('d. PDPA: story-line voices that contain names', () => {
  async function warmLines(recordToken: string) {
    const { GET } = await import('@/app/api/r/[token]/route');
    await GET(new Request(url('/')), params({ token: recordToken }));
    const { getTtsService } = await import('@/lib/tts');
    await getTtsService()!.idle();
  }
  const introPath = async (name: string, creatorName: string) => {
    const { getTtsService } = await import('@/lib/tts');
    const { lineText } = await import('@/lib/script');
    return getTtsService()!.pathFor(lineText('intro', { name, callName: 'ยาย', creatorName })!);
  };

  it('DELETE removes the intro/outro voices that say the names', async () => {
    const { s } = await setup('คุณยายพีดีพีเอ', 'หลานลบได้');
    await warmLines(s.recordToken);
    const rel = await introPath('คุณยายพีดีพีเอ', 'หลานลบได้');
    const { storage } = await import('@/lib/storage');
    expect(await storage.exists(rel)).toBe(true);
    const { DELETE } = await import('@/app/api/m/[token]/route');
    await DELETE(new Request(url('/'), { method: 'DELETE' }), params({ token: s.manageToken }));
    expect(await storage.exists(rel)).toBe(false);
  }, 30000);

  it('renaming removes voices that still say the old names', async () => {
    const { s } = await setup('คุณยายชื่อเก่า', 'หลานชื่อเก่า');
    await warmLines(s.recordToken);
    const rel = await introPath('คุณยายชื่อเก่า', 'หลานชื่อเก่า');
    const { PATCH } = await import('@/app/api/m/[token]/route');
    await PATCH(
      new Request(url('/'), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ creatorName: 'หลานชื่อใหม่' }) }),
      params({ token: s.manageToken }),
    );
    const { storage } = await import('@/lib/storage');
    expect(await storage.exists(rel)).toBe(false);
  }, 30000);
});

describe('f. change the storyteller photo', () => {
  it('upload replaces the photo with a normalised jpeg; delete removes it', async () => {
    const { s } = await setup();
    const route = await import('@/app/api/m/[token]/photo/route');
    const up = await route.POST(new Request(url('/'), { method: 'POST', body: form({ photo: png(2400, 1800) }) }), params({ token: s.manageToken }));
    expect(up.status).toBe(200);
    const photo = await (await import('@/app/api/photo/route')).GET(new Request(url(`/api/photo?t=${s.bookToken}`)));
    expect(photo.status).toBe(200);
    expect(photo.headers.get('content-type')).toBe('image/jpeg');

    const first = files('photos');
    await route.POST(new Request(url('/'), { method: 'POST', body: form({ photo: png(300, 300) }) }), params({ token: s.manageToken }));
    expect(files('photos').length).toBe(first.length); // old one replaced, not piled up

    expect((await route.DELETE(new Request(url('/'), { method: 'DELETE' }), params({ token: s.manageToken }))).status).toBe(200);
    const { manageView } = await import('@/lib/manage');
    expect(manageView(s.manageToken).storyteller.hasPhoto).toBe(false);
    expect(files('photos').length).toBe(first.length - 1);
  });

  it('rejects non-images (415) and undecodable images (422); record token cannot change it', async () => {
    const { s } = await setup();
    const route = await import('@/app/api/m/[token]/photo/route');
    const html = new Blob(['<html>'], { type: 'text/html' });
    expect((await route.POST(new Request(url('/'), { method: 'POST', body: form({ photo: html }) }), params({ token: s.manageToken }))).status).toBe(415);
    const fake = new Blob(['not a png'], { type: 'image/png' });
    expect((await route.POST(new Request(url('/'), { method: 'POST', body: form({ photo: fake }) }), params({ token: s.manageToken }))).status).toBe(422);
    expect((await route.POST(new Request(url('/'), { method: 'POST', body: form({ photo: png(10, 10) }) }), params({ token: s.recordToken }))).status).toBe(404);
  });
});
