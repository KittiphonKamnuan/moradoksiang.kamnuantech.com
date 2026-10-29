import { describe, expect, it } from 'vitest';
import { ACK_COUNT, allLineKeys, isLineKey, leadInFor, lineText, type LeadInInput } from '@/lib/script';

const ctx = { name: 'คุณยายมาลี', callName: 'ยาย', creatorName: 'ภูมิ' };
const qs = (chapters: string[]) => chapters.map((chapter) => ({ chapter })) as LeadInInput['questions'];

describe('lineText', () => {
  it('intro speaks on behalf of the grandchild, never as them', () => {
    const t = lineText('intro', ctx)!;
    expect(t).toContain('ยาย');
    expect(t).toContain('ภูมิ');
    expect(t).toContain('ไม่มีถูกไม่มีผิด');
    expect(t).not.toMatch(/ภูมิเอง/);
  });

  it('falls back to "หลาน" when the creator name is empty', () => {
    expect(lineText('intro', { ...ctx, creatorName: null })).toContain('หลาน');
  });

  it('has a line for every chapter and never leaves the placeholder', () => {
    for (const k of ['chapter-roots', 'chapter-past', 'chapter-love', 'chapter-family', 'chapter-life', 'chapter-someday', 'chapter-closing'] as const) {
      const t = lineText(k, ctx)!;
      expect(t.length).toBeGreaterThan(5);
      expect(t).not.toContain('{');
    }
  });

  it('has welcome-back, outro, skip and rotating thank-you lines', () => {
    expect(lineText('welcome-back', ctx)).toContain('ต่อ');
    expect(lineText('outro', ctx)).toContain('ขอบคุณ');
    expect(lineText('ack-skip', ctx)).toContain('ไม่เป็นไร');
    for (let i = 0; i < ACK_COUNT; i++) expect(lineText(`ack-${i}` as never, ctx)).toBeTruthy();
  });

  it('returns null for unknown keys (route answers 404 — no arbitrary text to the TTS API)', () => {
    expect(lineText('nope' as never, ctx)).toBeNull();
    expect(isLineKey('intro')).toBe(true);
    expect(isLineKey('ack-99')).toBe(false);
    expect(isLineKey('../x')).toBe(false);
  });

  it('allLineKeys covers every key isLineKey accepts', () => {
    for (const k of allLineKeys()) expect(isLineKey(k)).toBe(true);
  });
});

describe('leadInFor', () => {
  const base: LeadInInput = { questions: qs(['roots', 'roots', 'love', 'closing']), index: 0, firstAsk: true, resumed: false, repeat: false, lastOutcome: null };

  it('first question of a new interview: intro, then the chapter opener', () => {
    expect(leadInFor(base)).toEqual(['intro', 'chapter-roots']);
  });

  it('resuming: welcome-back instead of intro', () => {
    expect(leadInFor({ ...base, index: 2, resumed: true })).toEqual(['welcome-back', 'chapter-love']);
  });

  it('same chapter: just a thank-you', () => {
    const out = leadInFor({ ...base, index: 1, firstAsk: false, lastOutcome: 'answered' });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^ack-\d$/);
  });

  it('new chapter: thank-you, then the chapter opener', () => {
    const out = leadInFor({ ...base, index: 2, firstAsk: false, lastOutcome: 'answered' });
    expect(out[0]).toMatch(/^ack-\d$/);
    expect(out[1]).toBe('chapter-love');
  });

  it('after a skip: gentle "ไม่เป็นไร" instead of thanks', () => {
    expect(leadInFor({ ...base, index: 1, firstAsk: false, lastOutcome: 'skipped' })).toEqual(['ack-skip']);
  });

  it('closing question gets its own opener', () => {
    expect(leadInFor({ ...base, index: 3, firstAsk: false, lastOutcome: 'answered' })[1]).toBe('chapter-closing');
  });

  it('"ถามอีกที" repeats only the question', () => {
    expect(leadInFor({ ...base, repeat: true })).toEqual([]);
  });

  it('thank-you lines rotate', () => {
    const many = qs(Array(6).fill('life'));
    const acks = [1, 2, 3, 4].map((index) => leadInFor({ ...base, questions: many, index, firstAsk: false, lastOutcome: 'answered' })[0]);
    expect(new Set(acks).size).toBeGreaterThan(1);
  });
});
