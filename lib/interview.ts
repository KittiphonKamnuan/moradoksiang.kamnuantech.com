import type { ChapterId } from './questions';

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
};

const ask = (s: InterviewState, index: number): InterviewState =>
  index >= s.questions.length
    ? { ...s, index, phase: 'finished', nudged: false }
    : { ...s, index, phase: 'asking', askCount: s.askCount + 1, nudged: false };

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
      return s.phase === 'asking' || s.phase === 'listening' ? ask(s, s.index) : s;
    case 'NUDGE':
      return s.phase === 'listening' ? { ...s, nudged: true } : s;
    case 'RESUME':
      return { ...s, nudged: false };
    case 'FINISH_ANSWER':
      return s.phase === 'listening' ? ask(s, s.index + 1) : s;
    case 'SKIP':
      return s.phase === 'asking' || s.phase === 'listening' ? ask(s, s.index + 1) : s;
    case 'ERROR':
      return { ...s, phase: 'error', error: a.message };
  }
}
