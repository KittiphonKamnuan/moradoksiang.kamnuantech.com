import { describe, expect, it } from 'vitest';
import { initialInterview, interviewReducer, type InterviewState, type SessionQuestion } from '@/lib/interview';

const qs = (n: number): SessionQuestion[] =>
  Array.from({ length: n }, (_, i) => ({ id: `q${i}`, chapter: 'roots', text: `ข้อ ${i}`, hasPromptAudio: false, isClosing: i === n - 1, answerStatus: null }));

const run = (state: InterviewState, ...actions: Parameters<typeof interviewReducer>[1][]) => actions.reduce(interviewReducer, state);

const loaded = (n = 3, nextIndex = 0) => interviewReducer(initialInterview, { type: 'LOAD', questions: qs(n), nextIndex });

describe('interviewReducer', () => {
  it('starts loading', () => {
    expect(initialInterview.phase).toBe('loading');
  });

  it('LOAD -> welcome at the first unanswered question', () => {
    const s = loaded(3, 1);
    expect(s.phase).toBe('welcome');
    expect(s.index).toBe(1);
    expect(s.resumed).toBe(true);
  });

  it('LOAD when everything is answered -> finished', () => {
    expect(loaded(3, 3).phase).toBe('finished');
  });

  it('START -> micCheck, MIC_READY -> asking the current question', () => {
    const s = run(loaded(), { type: 'START' }, { type: 'MIC_READY' });
    expect(s.phase).toBe('asking');
    expect(s.askCount).toBe(1);
  });

  it('MIC_DENIED -> micDenied, and START again retries', () => {
    const s = run(loaded(), { type: 'START' }, { type: 'MIC_DENIED' });
    expect(s.phase).toBe('micDenied');
    expect(run(s, { type: 'START' }).phase).toBe('micCheck');
  });

  it('PROMPT_ENDED -> listening', () => {
    const s = run(loaded(), { type: 'START' }, { type: 'MIC_READY' }, { type: 'PROMPT_ENDED' });
    expect(s.phase).toBe('listening');
    expect(s.nudged).toBe(false);
  });

  it('FINISH_ANSWER moves to the next question and asks it', () => {
    const s = run(loaded(), { type: 'START' }, { type: 'MIC_READY' }, { type: 'PROMPT_ENDED' }, { type: 'FINISH_ANSWER' });
    expect(s.index).toBe(1);
    expect(s.phase).toBe('asking');
    expect(s.askCount).toBe(2);
  });

  it('FINISH_ANSWER is ignored unless listening (no double-advance from a late auto-end)', () => {
    const s = run(loaded(), { type: 'START' }, { type: 'MIC_READY' });
    expect(run(s, { type: 'FINISH_ANSWER' })).toBe(s);
  });

  it('after the last question -> finished', () => {
    const s = run(
      loaded(1),
      { type: 'START' },
      { type: 'MIC_READY' },
      { type: 'PROMPT_ENDED' },
      { type: 'FINISH_ANSWER' },
    );
    expect(s.phase).toBe('finished');
  });

  it('SKIP works while asking or listening', () => {
    const asking = run(loaded(), { type: 'START' }, { type: 'MIC_READY' });
    expect(run(asking, { type: 'SKIP' }).index).toBe(1);
    const listening = run(asking, { type: 'PROMPT_ENDED' });
    expect(run(listening, { type: 'SKIP' }).index).toBe(1);
  });

  it('REPEAT re-asks the same question', () => {
    const s = run(loaded(), { type: 'START' }, { type: 'MIC_READY' }, { type: 'PROMPT_ENDED' }, { type: 'REPEAT' });
    expect(s.phase).toBe('asking');
    expect(s.index).toBe(0);
    expect(s.askCount).toBe(2);
  });

  it('NUDGE / RESUME toggle the gentle "เล่าต่อไหม" hint', () => {
    const listening = run(loaded(), { type: 'START' }, { type: 'MIC_READY' }, { type: 'PROMPT_ENDED' });
    const nudged = run(listening, { type: 'NUDGE' });
    expect(nudged.nudged).toBe(true);
    expect(run(nudged, { type: 'RESUME' }).nudged).toBe(false);
  });

  it('a new question clears the nudge', () => {
    const s = run(loaded(), { type: 'START' }, { type: 'MIC_READY' }, { type: 'PROMPT_ENDED' }, { type: 'NUDGE' }, { type: 'FINISH_ANSWER' });
    expect(s.nudged).toBe(false);
  });

  it('ERROR shows an error phase; START from it re-checks the mic', () => {
    const s = run(loaded(), { type: 'ERROR', message: 'x' });
    expect(s.phase).toBe('error');
    expect(run(s, { type: 'START' }).phase).toBe('micCheck');
  });
});

describe('interview lead-in (story between questions)', () => {
  const chapters = (cs: string[]): SessionQuestion[] =>
    cs.map((chapter, i) => ({ id: `q${i}`, chapter: chapter as never, text: `ข้อ ${i}`, hasPromptAudio: false, isClosing: false, answerStatus: null }));
  const start = (cs: string[], nextIndex = 0) =>
    run(interviewReducer(initialInterview, { type: 'LOAD', questions: chapters(cs), nextIndex }), { type: 'START' }, { type: 'MIC_READY' });

  it('first ask carries the intro', () => {
    expect(start(['roots', 'love']).leadIn).toEqual(['intro', 'chapter-roots']);
  });

  it('resumed session carries welcome-back', () => {
    expect(start(['roots', 'love'], 1).leadIn[0]).toBe('welcome-back');
  });

  it('after an answer into a new chapter: thanks + chapter opener', () => {
    const s = run(start(['roots', 'love']), { type: 'PROMPT_ENDED' }, { type: 'FINISH_ANSWER' });
    expect(s.leadIn[1]).toBe('chapter-love');
    expect(s.leadIn[0]).toMatch(/^ack-/);
  });

  it('after a skip: ack-skip', () => {
    const s = run(start(['roots', 'roots']), { type: 'SKIP' });
    expect(s.leadIn).toEqual(['ack-skip']);
  });

  it('REPEAT clears the lead-in', () => {
    const s = run(start(['roots']), { type: 'PROMPT_ENDED' }, { type: 'REPEAT' });
    expect(s.leadIn).toEqual([]);
  });

  it('finishing the last question queues the outro', () => {
    const s = run(start(['roots']), { type: 'PROMPT_ENDED' }, { type: 'FINISH_ANSWER' });
    expect(s.phase).toBe('finished');
    expect(s.leadIn).toEqual(['outro']);
  });
});

describe('15-minute answer limit', () => {
  const listening = () =>
    run(interviewReducer(initialInterview, { type: 'LOAD', questions: qs(3), nextIndex: 0 }), { type: 'START' }, { type: 'MIC_READY' }, { type: 'PROMPT_ENDED' });

  it('NEAR_LIMIT shows the gentle "almost time" hint while listening', () => {
    expect(listening().nearLimit).toBe(false);
    expect(run(listening(), { type: 'NEAR_LIMIT' }).nearLimit).toBe(true);
  });

  it('is ignored outside listening', () => {
    const asking = run(listening(), { type: 'REPEAT' });
    expect(run(asking, { type: 'NEAR_LIMIT' }).nearLimit).toBe(false);
  });

  it('the next question clears it', () => {
    expect(run(listening(), { type: 'NEAR_LIMIT' }, { type: 'FINISH_ANSWER' }).nearLimit).toBe(false);
  });
});
