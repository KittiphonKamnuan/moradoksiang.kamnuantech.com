import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@/lib/db';
import {
  completeSession,
  createStoryteller,
  deleteStoryteller,
  getBook,
  getByBookToken,
  getByManageToken,
  getByRecordToken,
  getSession,
  listQuestions,
  replaceQuestions,
  resolveAudio,
  saveAnswer,
  setPromptAudio,
  skipAnswer,
} from '@/lib/repo';
import { CLOSING_TEXT } from '@/lib/questions';

let db: Db;
beforeEach(() => {
  db = createDb(':memory:');
});

const make = (extra: Partial<Parameters<typeof createStoryteller>[1]> = {}) =>
  createStoryteller(db, { name: 'คุณยายมาลี', callName: 'ยาย', creatorName: 'ภูมิ', ...extra });

describe('createStoryteller', () => {
  it('returns three distinct capability tokens', () => {
    const s = make();
    expect(new Set([s.manageToken, s.recordToken, s.bookToken]).size).toBe(3);
    expect(s.manageToken.length).toBeGreaterThanOrEqual(22);
  });

  it('starts as draft with the default 10 + closing questions', () => {
    const s = make();
    expect(getByManageToken(db, s.manageToken)?.status).toBe('draft');
    const qs = listQuestions(db, s.id);
    expect(qs).toHaveLength(11);
    expect(qs.at(-1)?.isClosing).toBe(true);
  });

  it('accepts a custom question list (closing still appended)', () => {
    const s = make({ questions: [{ chapter: 'love', text: 'จีบกันยังไง' }] });
    expect(listQuestions(db, s.id).map((q) => q.text)).toEqual(['จีบกันยังไง', CLOSING_TEXT]);
  });

  it('rejects empty name or call name', () => {
    expect(() => make({ name: '  ' })).toThrow();
    expect(() => make({ callName: '' })).toThrow();
  });

  it('each token only finds its own storyteller', () => {
    const a = make();
    const b = make({ name: 'คุณตาสมชาย', callName: 'ตา' });
    expect(getByRecordToken(db, a.recordToken)?.id).toBe(a.id);
    expect(getByBookToken(db, b.bookToken)?.id).toBe(b.id);
    expect(getByManageToken(db, a.recordToken)).toBeUndefined();
    expect(getByBookToken(db, 'x'.repeat(24))).toBeUndefined();
  });
});

describe('replaceQuestions', () => {
  it('keeps ids (and recorded prompt audio) for questions that remain', () => {
    const s = make();
    const [first, second] = listQuestions(db, s.id);
    setPromptAudio(db, first.id, 'prompts/a.m4a');
    replaceQuestions(db, s.id, [
      { id: second.id, chapter: second.chapter, text: second.text },
      { id: first.id, chapter: first.chapter, text: 'แก้ข้อความ{เรียก}' },
      { chapter: 'past', text: 'ข้อใหม่' },
    ]);
    const qs = listQuestions(db, s.id);
    expect(qs.map((q) => q.text)).toEqual([second.text, 'แก้ข้อความ{เรียก}', 'ข้อใหม่', CLOSING_TEXT]);
    expect(qs[1].id).toBe(first.id);
    expect(qs[1].promptAudio).toBe('prompts/a.m4a');
  });

  it('returns audio paths of removed questions so files can be deleted', () => {
    const s = make();
    const [first] = listQuestions(db, s.id);
    setPromptAudio(db, first.id, 'prompts/a.m4a');
    saveAnswer(db, { storytellerId: s.id, questionId: first.id, audioPath: 'answers/a.m4a', mime: 'audio/mp4', durationMs: 1000 });
    const removed = replaceQuestions(db, s.id, [{ chapter: 'roots', text: 'อื่น' }]);
    expect(removed.sort()).toEqual(['answers/a.m4a', 'prompts/a.m4a']);
  });

  it('ignores ids that belong to another storyteller', () => {
    const a = make();
    const b = make();
    const foreign = listQuestions(db, b.id)[0];
    replaceQuestions(db, a.id, [{ id: foreign.id, chapter: 'roots', text: 'ขโมย' }]);
    expect(listQuestions(db, b.id)[0].text).toBe(foreign.text);
    expect(listQuestions(db, a.id)[0].id).not.toBe(foreign.id);
  });
});

describe('interview session', () => {
  it('starts at question 0 with nothing answered', () => {
    const s = make();
    const session = getSession(db, s.recordToken)!;
    expect(session.nextIndex).toBe(0);
    expect(session.done).toBe(false);
    expect(session.questions).toHaveLength(11);
  });

  it('renders {เรียก} in the session questions', () => {
    const s = make();
    expect(getSession(db, s.recordToken)!.questions[0].text).toBe('พ่อกับแม่ของยายเป็นคนแบบไหนครับ');
  });

  it('resumes from the first unanswered question (answers and skips both count)', () => {
    const s = make();
    const qs = listQuestions(db, s.id);
    saveAnswer(db, { storytellerId: s.id, questionId: qs[0].id, audioPath: 'a0', mime: 'audio/mp4', durationMs: 1 });
    skipAnswer(db, s.id, qs[1].id);
    const session = getSession(db, s.recordToken)!;
    expect(session.nextIndex).toBe(2);
    expect(session.questions[0].answerStatus).toBe('saved');
    expect(session.questions[1].answerStatus).toBe('skipped');
    expect(session.questions[2].answerStatus).toBeNull();
  });

  it('first answer moves status draft -> recording', () => {
    const s = make();
    const q = listQuestions(db, s.id)[0];
    saveAnswer(db, { storytellerId: s.id, questionId: q.id, audioPath: 'a', mime: 'audio/mp4', durationMs: 1 });
    expect(getByManageToken(db, s.manageToken)?.status).toBe('recording');
  });

  it('re-recording replaces the answer and returns the old file path', () => {
    const s = make();
    const q = listQuestions(db, s.id)[0];
    saveAnswer(db, { storytellerId: s.id, questionId: q.id, audioPath: 'old', mime: 'audio/mp4', durationMs: 1 });
    const res = saveAnswer(db, { storytellerId: s.id, questionId: q.id, audioPath: 'new', mime: 'audio/mp4', durationMs: 2 });
    expect(res.previousAudioPath).toBe('old');
    const book = getBook(db, s.bookToken)!;
    expect(book.chapters.flatMap((c) => c.entries)).toHaveLength(1);
    expect(book.chapters[0].entries[0].durationMs).toBe(2);
  });

  it('refuses an answer for a question of another storyteller', () => {
    const a = make();
    const b = make();
    const foreign = listQuestions(db, b.id)[0];
    expect(() =>
      saveAnswer(db, { storytellerId: a.id, questionId: foreign.id, audioPath: 'x', mime: 'audio/mp4', durationMs: 1 }),
    ).toThrow();
  });

  it('is done when every question has an answer or skip', () => {
    const s = make({ questions: [{ chapter: 'roots', text: 'ก' }] });
    const [q, closing] = listQuestions(db, s.id);
    saveAnswer(db, { storytellerId: s.id, questionId: q.id, audioPath: 'a', mime: 'audio/mp4', durationMs: 1 });
    skipAnswer(db, s.id, closing.id);
    const session = getSession(db, s.recordToken)!;
    expect(session.done).toBe(true);
    expect(session.nextIndex).toBe(2);
  });

  it('completeSession marks completed', () => {
    const s = make();
    completeSession(db, s.id);
    expect(getByManageToken(db, s.manageToken)?.status).toBe('completed');
  });

  it('returns undefined for an unknown record token', () => {
    expect(getSession(db, 'x'.repeat(24))).toBeUndefined();
  });
});

describe('getBook', () => {
  it('groups saved answers into consecutive chapters in question order, hiding skips', () => {
    const s = make({
      questions: [
        { chapter: 'roots', text: 'ก{เรียก}' },
        { chapter: 'roots', text: 'ข' },
        { chapter: 'love', text: 'ค' },
        { chapter: 'roots', text: 'ง' },
      ],
    });
    const qs = listQuestions(db, s.id);
    for (const i of [0, 2, 3]) {
      saveAnswer(db, { storytellerId: s.id, questionId: qs[i].id, audioPath: `a${i}`, mime: 'audio/mp4', durationMs: 1000 + i });
    }
    skipAnswer(db, s.id, qs[1].id);

    const book = getBook(db, s.bookToken)!;
    expect(book.storyteller.name).toBe('คุณยายมาลี');
    expect(book.chapters.map((c) => [c.chapter, c.title, c.entries.map((e) => e.questionText)])).toEqual([
      ['roots', 'รากเหง้า', ['กยาย']],
      ['love', 'ความรัก', ['ค']],
      ['roots', 'รากเหง้า', ['ง']],
    ]);
    expect(book.totalDurationMs).toBe(1000 + 1002 + 1003);
  });

  it('exposes answer ids and transcripts, never file paths', () => {
    const s = make();
    const q = listQuestions(db, s.id)[0];
    saveAnswer(db, { storytellerId: s.id, questionId: q.id, audioPath: 'secret/path.m4a', mime: 'audio/mp4', durationMs: 1 });
    const entry = getBook(db, s.bookToken)!.chapters[0].entries[0];
    expect(entry.answerId).toBeTruthy();
    expect(entry.transcript).toBeNull();
    expect(JSON.stringify(entry)).not.toContain('secret/path');
  });
});

describe('resolveAudio (authorisation for streaming)', () => {
  function setup() {
    const s = make();
    const q = listQuestions(db, s.id)[0];
    setPromptAudio(db, q.id, 'prompts/q.m4a');
    const { answerId } = saveAnswer(db, { storytellerId: s.id, questionId: q.id, audioPath: 'answers/a.m4a', mime: 'audio/mp4', durationMs: 1 });
    return { s, q, answerId };
  }

  it('answer audio is readable with the book or manage token', () => {
    const { s, answerId } = setup();
    expect(resolveAudio(db, 'answer', answerId, s.bookToken)).toBe('answers/a.m4a');
    expect(resolveAudio(db, 'answer', answerId, s.manageToken)).toBe('answers/a.m4a');
  });

  it('answer audio is NOT readable with the record token or another family token', () => {
    const { s, answerId } = setup();
    const other = make();
    expect(resolveAudio(db, 'answer', answerId, s.recordToken)).toBeNull();
    expect(resolveAudio(db, 'answer', answerId, other.bookToken)).toBeNull();
  });

  it('prompt audio is readable with record, book or manage token', () => {
    const { s, q } = setup();
    for (const t of [s.recordToken, s.bookToken, s.manageToken]) {
      expect(resolveAudio(db, 'prompt', q.id, t)).toBe('prompts/q.m4a');
    }
  });

  it('returns null for missing audio', () => {
    const { s } = setup();
    const q2 = listQuestions(db, s.id)[1];
    expect(resolveAudio(db, 'prompt', q2.id, s.manageToken)).toBeNull();
    expect(resolveAudio(db, 'answer', 'nope', s.manageToken)).toBeNull();
  });
});

describe('deleteStoryteller (PDPA right to erasure)', () => {
  it('removes everything and returns all file paths to delete', () => {
    const s = make({ photoPath: 'photos/p.jpg' });
    const q = listQuestions(db, s.id)[0];
    setPromptAudio(db, q.id, 'prompts/q.m4a');
    saveAnswer(db, { storytellerId: s.id, questionId: q.id, audioPath: 'answers/a.m4a', mime: 'audio/mp4', durationMs: 1 });

    const files = deleteStoryteller(db, s.id);
    expect(files.sort()).toEqual(['answers/a.m4a', 'photos/p.jpg', 'prompts/q.m4a']);
    expect(getByManageToken(db, s.manageToken)).toBeUndefined();
    expect(listQuestions(db, s.id)).toEqual([]);
  });
});
