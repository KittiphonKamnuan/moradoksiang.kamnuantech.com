import { DEFAULT_SILENCE_CONFIG, type SilenceConfig } from './silence';

/** Interview tuning — adjust here after testing with real storytellers. */
export const INTERVIEW_CONFIG = {
  silence: DEFAULT_SILENCE_CONFIG satisfies SilenceConfig,
  /** hard cap per answer */
  maxAnswerMs: 15 * 60 * 1000,
  /** gently say time is nearly up this long before the cap */
  nearLimitBeforeMs: 60 * 1000,
  /** short breath before each question is played */
  pauseBeforeQuestionMs: 700,
  /** breath between story lines (intro -> chapter opener -> question) */
  pauseBetweenLinesMs: 350,
  /** how long the mic check shows "ได้ยินแล้ว" before moving on */
  micCheckSuccessMs: 1300,
};
