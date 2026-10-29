import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { audioBlob, form, params, tempDataDir, url, webmClip } from './helpers';

const dataDir = tempDataDir();
process.env.DATA_DIR = dataDir;
process.env.NEXT_PUBLIC_BASE_URL = 'https://moradoksiang.kamnuantech.com';

// route modules are imported after DATA_DIR is set
let api: {
  storytellers: typeof import('@/app/api/storytellers/route');
  manage: typeof import('@/app/api/m/[token]/route');
  manageQuestions: typeof import('@/app/api/m/[token]/questions/route');
  promptAudio: typeof import('@/app/api/m/[token]/questions/[id]/audio/route');
  session: typeof import('@/app/api/r/[token]/route');
  answers: typeof import('@/app/api/r/[token]/answers/route');
  complete: typeof import('@/app/api/r/[token]/complete/route');
  book: typeof import('@/app/api/b/[token]/route');
  audio: typeof import('@/app/api/audio/[kind]/[id]/route');
  photo: typeof import('@/app/api/photo/route');
};

beforeAll(async () => {
  api = {
    storytellers: await import('@/app/api/storytellers/route'),
    manage: await import('@/app/api/m/[token]/route'),
    manageQuestions: await import('@/app/api/m/[token]/questions/route'),
    promptAudio: await import('@/app/api/m/[token]/questions/[id]/audio/route'),
    session: await import('@/app/api/r/[token]/route'),
    answers: await import('@/app/api/r/[token]/answers/route'),
    complete: await import('@/app/api/r/[token]/complete/route'),
    book: await import('@/app/api/b/[token]/route'),
    audio: await import('@/app/api/audio/[kind]/[id]/route'),
    photo: await import('@/app/api/photo/route'),
  };
});
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

type Tokens = { manageToken: string; recordToken: string; bookToken: string };

async function create(body: Record<string, unknown> = {}): Promise<Tokens> {
  const res = await api.storytellers.POST(
    new Request(url('/api/storytellers'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'คุณยายมาลี', callName: 'ยาย', creatorName: 'ภูมิ', ...body }),
    }),
  );
  expect(res.status).toBe(201);
  return res.json();
}

const getSession = async (t: string) => (await api.session.GET(new Request(url(`/api/r/${t}`)), params({ token: t }))).json();

async function answer(t: string, questionId: string, fields: Record<string, string | Blob> = { audio: audioBlob(webmClip()) }) {
  return api.answers.POST(
    new Request(url(`/api/r/${t}/answers`), { method: 'POST', body: form({ questionId, ...fields }) }),
    params({ token: t }),
  );
}

const getAudio = (kind: string, id: string, t: string, headers: Record<string, string> = {}) =>
  api.audio.GET(new Request(url(`/api/audio/${kind}/${id}?t=${t}`), { headers }), params({ kind, id }));

describe('POST /api/storytellers', () => {
  it('creates a storyteller and returns three links', async () => {
    const res = await api.storytellers.POST(
      new Request(url('/api/storytellers'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'คุณยายมาลี', callName: 'ยาย' }),
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.links.record).toBe(`https://moradoksiang.kamnuantech.com/r/${body.recordToken}`);
    expect(body.links.book).toBe(`https://moradoksiang.kamnuantech.com/b/${body.bookToken}`);
    expect(body.links.manage).toBe(`https://moradoksiang.kamnuantech.com/m/${body.manageToken}`);
  });

  it('400 without a name', async () => {
    const res = await api.storytellers.POST(
      new Request(url('/api/storytellers'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callName: 'ยาย' }) }),
    );
    expect(res.status).toBe(400);
  });

  it('accepts multipart with a photo and custom questions', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const res = await api.storytellers.POST(
      new Request(url('/api/storytellers'), {
        method: 'POST',
        body: form({
          name: 'คุณตา',
          callName: 'ตา',
          questions: JSON.stringify([{ chapter: 'love', text: 'จีบยาย{เรียก}ยังไง' }]),
          photo: new Blob([new Uint8Array(png)], { type: 'image/png' }),
        }),
      }),
    );
    expect(res.status).toBe(201);
    const t: Tokens = await res.json();
    const session = await getSession(t.recordToken);
    expect(session.questions.map((q: { text: string }) => q.text)[0]).toBe('จีบยายตายังไง');
    expect(session.storyteller.hasPhoto).toBe(true);

    const photo = await api.photo.GET(new Request(url(`/api/photo?t=${t.bookToken}`)));
    expect(photo.status).toBe(200);
    expect(photo.headers.get('content-type')).toBe('image/png');
  });

  it('415 for a non-image photo', async () => {
    const res = await api.storytellers.POST(
      new Request(url('/api/storytellers'), {
        method: 'POST',
        body: form({ name: 'ก', callName: 'ข', photo: new Blob(['<html>'], { type: 'text/html' }) }),
      }),
    );
    expect(res.status).toBe(415);
  });
});

describe('interview API /api/r/[token]', () => {
  it('404 for unknown token', async () => {
    const t = 'x'.repeat(24);
    expect((await api.session.GET(new Request(url(`/api/r/${t}`)), params({ token: t }))).status).toBe(404);
  });

  it('saves an answer, transcodes it, and advances the session', async () => {
    const t = await create();
    const s0 = await getSession(t.recordToken);
    expect(s0.nextIndex).toBe(0);

    const res = await answer(t.recordToken, s0.questions[0].id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.durationMs).toBeGreaterThan(800);

    const s1 = await getSession(t.recordToken);
    expect(s1.nextIndex).toBe(1);
  });

  it('records a skip', async () => {
    const t = await create();
    const s0 = await getSession(t.recordToken);
    expect((await answer(t.recordToken, s0.questions[0].id, { skip: '1' })).status).toBe(200);
    const s1 = await getSession(t.recordToken);
    expect(s1.questions[0].answerStatus).toBe('skipped');
  });

  it('415 for a non-audio upload', async () => {
    const t = await create();
    const s0 = await getSession(t.recordToken);
    const res = await answer(t.recordToken, s0.questions[0].id, { audio: new Blob(['<script>'], { type: 'text/html' }) });
    expect(res.status).toBe(415);
  });

  it('422 when the audio cannot be decoded', async () => {
    const t = await create();
    const s0 = await getSession(t.recordToken);
    const res = await answer(t.recordToken, s0.questions[0].id, { audio: audioBlob(Buffer.from('garbage')) });
    expect(res.status).toBe(422);
  });

  it('404 for a question of another storyteller', async () => {
    const a = await create();
    const b = await create();
    const foreign = (await getSession(b.recordToken)).questions[0].id;
    expect((await answer(a.recordToken, foreign)).status).toBe(404);
  });

  it('400 when neither audio nor skip is sent', async () => {
    const t = await create();
    const s0 = await getSession(t.recordToken);
    expect((await answer(t.recordToken, s0.questions[0].id, {})).status).toBe(400);
  });

  it('complete marks the storyteller completed', async () => {
    const t = await create();
    const res = await api.complete.POST(new Request(url(`/api/r/${t.recordToken}/complete`), { method: 'POST' }), params({ token: t.recordToken }));
    expect(res.status).toBe(200);
    expect((await getSession(t.recordToken)).storyteller.status).toBe('completed');
  });
});

describe('book + audio streaming', () => {
  async function withAnswer() {
    const t = await create();
    const q = (await getSession(t.recordToken)).questions[0];
    await answer(t.recordToken, q.id);
    const book = await (await api.book.GET(new Request(url(`/api/b/${t.bookToken}`)), params({ token: t.bookToken }))).json();
    return { t, book, answerId: book.chapters[0].entries[0].answerId as string };
  }

  it('book lists the answer under its chapter', async () => {
    const { book } = await withAnswer();
    expect(book.storyteller.name).toBe('คุณยายมาลี');
    expect(book.chapters[0].title).toBe('รากเหง้า');
    expect(book.chapters[0].entries[0].questionText).toBe('พ่อกับแม่ของยายเป็นคนแบบไหนครับ');
  });

  it('book 404 with a record token', async () => {
    const { t } = await withAnswer();
    expect((await api.book.GET(new Request(url('/')), params({ token: t.recordToken }))).status).toBe(404);
  });

  it('streams the whole file with Accept-Ranges', async () => {
    const { t, answerId } = await withAnswer();
    const res = await getAudio('answer', answerId, t.bookToken);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mp4');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Number(res.headers.get('content-length'))).toBe(bytes.length);
  });

  it('serves a 206 partial response for Range requests (Safari)', async () => {
    const { t, answerId } = await withAnswer();
    const full = await getAudio('answer', answerId, t.bookToken);
    const size = Number(full.headers.get('content-length'));
    const res = await getAudio('answer', answerId, t.bookToken, { range: 'bytes=0-1' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-1/${size}`);
    expect(new Uint8Array(await res.arrayBuffer())).toHaveLength(2);
  });

  it('416 for an unsatisfiable range', async () => {
    const { t, answerId } = await withAnswer();
    const res = await getAudio('answer', answerId, t.bookToken, { range: 'bytes=99999999-' });
    expect(res.status).toBe(416);
  });

  it('404 for answer audio with the record token, or no token', async () => {
    const { t, answerId } = await withAnswer();
    expect((await getAudio('answer', answerId, t.recordToken)).status).toBe(404);
    expect((await getAudio('answer', answerId, '')).status).toBe(404);
    expect((await getAudio('bogus', answerId, t.bookToken)).status).toBe(404);
  });
});

describe('manage API /api/m/[token]', () => {
  const getManage = async (t: string) => api.manage.GET(new Request(url(`/api/m/${t}`)), params({ token: t }));

  it('returns storyteller, questions (templates) and links', async () => {
    const t = await create();
    const res = await getManage(t.manageToken);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.questions).toHaveLength(11);
    expect(body.questions[0].text).toContain('{เรียก}');
    expect(body.links.record).toContain(t.recordToken);
  });

  it('404 with a book token (book link cannot manage)', async () => {
    const t = await create();
    expect((await getManage(t.bookToken)).status).toBe(404);
  });

  it('PATCH updates names', async () => {
    const t = await create();
    const res = await api.manage.PATCH(
      new Request(url('/'), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callName: 'ย่า' }) }),
      params({ token: t.manageToken }),
    );
    expect(res.status).toBe(200);
    expect((await getSession(t.recordToken)).questions[0].text).toBe('พ่อกับแม่ของย่าเป็นคนแบบไหนครับ');
  });

  it('PUT questions reorders and removes, deleting removed audio files', async () => {
    const t = await create();
    const { questions } = await (await getManage(t.manageToken)).json();
    // record a prompt on q0, then remove q0
    const up = await api.promptAudio.POST(
      new Request(url('/'), { method: 'POST', body: form({ audio: audioBlob(webmClip()) }) }),
      params({ token: t.manageToken, id: questions[0].id }),
    );
    expect(up.status).toBe(200);
    const promptFiles = fs.readdirSync(`${dataDir}/files/prompts`).length;

    const res = await api.manageQuestions.PUT(
      new Request(url('/'), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questions: [questions[2], questions[1]] }),
      }),
      params({ token: t.manageToken }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.questions.map((q: { id: string }) => q.id).slice(0, 2)).toEqual([questions[2].id, questions[1].id]);
    expect(body.questions).toHaveLength(3); // + closing
    expect(fs.readdirSync(`${dataDir}/files/prompts`).length).toBe(promptFiles - 1);
  });

  it('PUT 400 for an invalid body', async () => {
    const t = await create();
    const res = await api.manageQuestions.PUT(
      new Request(url('/'), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ questions: 'x' }) }),
      params({ token: t.manageToken }),
    );
    expect(res.status).toBe(400);
  });

  it('prompt audio upload is streamable with the record token and can be deleted', async () => {
    const t = await create();
    const qid = (await (await getManage(t.manageToken)).json()).questions[0].id;
    await api.promptAudio.POST(
      new Request(url('/'), { method: 'POST', body: form({ audio: audioBlob(webmClip()) }) }),
      params({ token: t.manageToken, id: qid }),
    );
    expect((await getSession(t.recordToken)).questions[0].hasPromptAudio).toBe(true);
    expect((await getAudio('prompt', qid, t.recordToken)).status).toBe(200);

    const del = await api.promptAudio.DELETE(new Request(url('/'), { method: 'DELETE' }), params({ token: t.manageToken, id: qid }));
    expect(del.status).toBe(200);
    expect((await getAudio('prompt', qid, t.recordToken)).status).toBe(404);
  });

  it('prompt upload 404 for a question of another storyteller', async () => {
    const a = await create();
    const b = await create();
    const foreign = (await (await getManage(b.manageToken)).json()).questions[0].id;
    const res = await api.promptAudio.POST(
      new Request(url('/'), { method: 'POST', body: form({ audio: audioBlob(webmClip()) }) }),
      params({ token: a.manageToken, id: foreign }),
    );
    expect(res.status).toBe(404);
  });

  it('DELETE erases the storyteller and its files', async () => {
    const t = await create();
    const q = (await getSession(t.recordToken)).questions[0];
    await answer(t.recordToken, q.id);
    const before = fs.readdirSync(`${dataDir}/files/answers`).length;

    const res = await api.manage.DELETE(new Request(url('/'), { method: 'DELETE' }), params({ token: t.manageToken }));
    expect(res.status).toBe(200);
    expect((await getManage(t.manageToken)).status).toBe(404);
    expect(fs.readdirSync(`${dataDir}/files/answers`).length).toBe(before - 1);
  });
});
