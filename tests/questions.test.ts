import { describe, expect, it } from 'vitest';
import {
  CHAPTERS,
  CLOSING_TEXT,
  DEFAULT_QUESTION_IDS,
  QUESTION_BANK,
  buildDefaultQuestionList,
  normalizeQuestionList,
  renderQuestion,
} from '@/lib/questions';

describe('question bank', () => {
  it('has 26 questions with unique ids 1..26', () => {
    expect(QUESTION_BANK).toHaveLength(26);
    expect(QUESTION_BANK.map((q) => q.id)).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
  });

  it('every question belongs to a known non-closing chapter', () => {
    for (const q of QUESTION_BANK) {
      expect(Object.keys(CHAPTERS)).toContain(q.chapter);
      expect(q.chapter).not.toBe('closing');
    }
  });

  it('has Thai chapter titles', () => {
    expect(CHAPTERS.roots.title).toBe('รากเหง้า');
    expect(CHAPTERS.someday.title).toBe('ถ้าสักวันหนึ่ง…');
    expect(CHAPTERS.closing.title).toBe('เรื่องที่อยากเล่าเอง');
  });

  it('default set is the 10 questions from the plan', () => {
    expect(DEFAULT_QUESTION_IDS).toEqual([1, 5, 9, 12, 14, 16, 17, 20, 25, 26]);
  });
});

describe('renderQuestion', () => {
  it('replaces every {เรียก} with the call name', () => {
    expect(renderQuestion('{เรียก}อยากให้ทุกคนจดจำ{เรียก}แบบไหน', 'ยาย')).toBe(
      'ยายอยากให้ทุกคนจดจำยายแบบไหน',
    );
  });

  it('leaves text without placeholder untouched', () => {
    expect(renderQuestion('วันแต่งงานเป็นยังไงบ้าง', 'ตา')).toBe('วันแต่งงานเป็นยังไงบ้าง');
  });

  it('trims the call name', () => {
    expect(renderQuestion('สวัสดี{เรียก}', '  ย่า ')).toBe('สวัสดีย่า');
  });
});

describe('buildDefaultQuestionList', () => {
  const list = buildDefaultQuestionList();

  it('returns the 10 default questions plus closing (11 items)', () => {
    expect(list).toHaveLength(11);
  });

  it('keeps the template placeholder (rendering happens at display time)', () => {
    expect(list[0].text).toBe('พ่อกับแม่ของ{เรียก}เป็นคนแบบไหนครับ');
  });

  it('ends with the closing question', () => {
    const last = list[list.length - 1];
    expect(last.isClosing).toBe(true);
    expect(last.chapter).toBe('closing');
    expect(last.text).toBe(CLOSING_TEXT);
  });

  it('has sequential positions from 0', () => {
    expect(list.map((q) => q.position)).toEqual(Array.from({ length: 11 }, (_, i) => i));
  });
});

describe('normalizeQuestionList', () => {
  it('appends the closing question when missing', () => {
    const out = normalizeQuestionList([{ chapter: 'roots', text: 'ก' }]);
    expect(out).toHaveLength(2);
    expect(out[1].isClosing).toBe(true);
  });

  it('moves closing to the end and keeps only one', () => {
    const out = normalizeQuestionList([
      { chapter: 'closing', text: CLOSING_TEXT, isClosing: true },
      { chapter: 'roots', text: 'ก' },
      { chapter: 'closing', text: CLOSING_TEXT, isClosing: true },
      { chapter: 'past', text: 'ข' },
    ]);
    expect(out.map((q) => q.text)).toEqual(['ก', 'ข', CLOSING_TEXT]);
    expect(out.filter((q) => q.isClosing)).toHaveLength(1);
  });

  it('reindexes positions and drops blank questions', () => {
    const out = normalizeQuestionList([
      { chapter: 'roots', text: '  ' },
      { chapter: 'roots', text: ' ก ' },
    ]);
    expect(out.map((q) => [q.position, q.text])).toEqual([
      [0, 'ก'],
      [1, CLOSING_TEXT],
    ]);
  });

  it('preserves an id when given (so edits keep recorded audio)', () => {
    const out = normalizeQuestionList([{ id: 'abc', chapter: 'roots', text: 'ก' }]);
    expect(out[0].id).toBe('abc');
  });

  it('falls back to "life" for an unknown chapter', () => {
    const out = normalizeQuestionList([{ chapter: 'nope' as never, text: 'ก' }]);
    expect(out[0].chapter).toBe('life');
  });
});

import { formatDuration, formatMinutesThai } from '@/lib/format';

describe('format', () => {
  it('formatDuration', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_400)).toBe('1:05');
    expect(formatDuration(null)).toBe('0:00');
  });
  it('formatMinutesThai', () => {
    expect(formatMinutesThai(20_000)).toBe('ไม่ถึง 1 นาที');
    expect(formatMinutesThai(12 * 60_000)).toBe('12 นาที');
    expect(formatMinutesThai(75 * 60_000)).toBe('1 ชั่วโมง 15 นาที');
  });
});
