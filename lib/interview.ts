import type { ChapterId } from './questions';
import { leadInFor, type LineKey } from './script';

export interface SessionQuestion {
  id: string;
  chapter: ChapterId;
  text: string;
  hasPromptAudio: boolean;
  isClosing: boolean;
  answerStatus: 'saved' | 'skipped' | null;
}

export type InterviewPhase =
  | 'loading'
  | 'welcome' // big "เริ่มคุยกัน" button (user gesture unlocks audio + mic)
  | 'micCheck'
  | 'micDenied'
  | 'asking' // playing the question
  | 'listening' // recording the answer
  | 'finished'
  | 'error';

export interface InterviewState {
  phase: InterviewPhase;
  questions: SessionQuestion[];
  index: number;
  /** bumps on every (re)ask so effects can re-run for the same question */
  askCount: number;
  nudged: boolean;
  resumed: boolean;
  /** story lines to speak before the current question (or the outro when finished) */
  leadIn: LineKey[];
  lastOutcome: 'answered' | 'skipped' | null;
  error?: string;
}

export type InterviewAction =
  | { type: 'LOAD'; questions: SessionQuestion[]; nextIndex: number }
  | { type: 'START' }
  | { type: 'MIC_READY' }
  | { type: 'MIC_DENIED' }
  | { type: 'PROMPT_ENDED' }
  | { type: 'REPEAT' }
  | { type: 'NUDGE' }
  | { type: 'RESUME' }
  | { type: 'FINISH_ANSWER' }
  | { type: 'SKIP' }
  | { type: 'ERROR'; message: string };

export const initialInterview: InterviewState = {
  phase: 'loading',
  questions: [],
  index: 0,
  askCount: 0,
  nudged: false,
  resumed: false,
  leadIn: [],
  lastOutcome: null,
};

function ask(s: InterviewState, index: number, opts: { repeat?: boolean; outcome?: 'answered' | 'skipped' } = {}): InterviewState {
  const lastOutcome = opts.outcome ?? s.lastOutcome;
  if (index >= s.questions.length) return { ...s, index, lastOutcome, phase: 'finished', nudged: false, leadIn: ['outro'] };
  const leadIn = leadInFor({
    questions: s.questions,
    index,
    firstAsk: s.askCount === 0,
    resumed: s.resumed,
    repeat: !!opts.repeat,
    lastOutcome,
  });
  return { ...s, index, lastOutcome, leadIn, phase: 'asking', askCount: s.askCount + 1, nudged: false };
}

export function interviewReducer(s: InterviewState, a: InterviewAction): InterviewState {
  switch (a.type) {
    case 'LOAD':
      return {
        ...initialInterview,
        questions: a.questions,
        index: a.nextIndex,
        resumed: a.nextIndex > 0,
        phase: a.nextIndex >= a.questions.length ? 'finished' : 'welcome',
      };
    case 'START':
      return ['welcome', 'micDenied', 'error'].includes(s.phase) ? { ...s, phase: 'micCheck', error: undefined } : s;
    case 'MIC_READY':
      return s.phase === 'micCheck' ? ask(s, s.index) : s;
    case 'MIC_DENIED':
      return { ...s, phase: 'micDenied' };
    case 'PROMPT_ENDED':
      return s.phase === 'asking' ? { ...s, phase: 'listening', nudged: false } : s;
    case 'REPEAT':
      return s.phase === 'asking' || s.phase === 'listening' ? ask(s, s.index, { repeat: true }) : s;
    case 'NUDGE':
      return s.phase === 'listening' ? { ...s, nudged: true } : s;
    case 'RESUME':
      return { ...s, nudged: false };
    case 'FINISH_ANSWER':
      return s.phase === 'listening' ? ask(s, s.index + 1, { outcome: 'answered' }) : s;
    case 'SKIP':
      return s.phase === 'asking' || s.phase === 'listening' ? ask(s, s.index + 1, { outcome: 'skipped' }) : s;
    case 'ERROR':
      return { ...s, phase: 'error', error: a.message };
  }
}
