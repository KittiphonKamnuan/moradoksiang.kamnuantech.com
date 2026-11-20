import type { ChapterId } from './questions';

/** JSON shapes returned by the API server (server/src/db.rs, server/src/routes.rs). */

export type StorytellerStatus = 'draft' | 'recording' | 'completed';
export type AnswerStatus = 'saved' | 'skipped' | 'failed' | null;

export interface BookEntry {
  answerId: string;
  questionId: string;
  questionText: string;
  hasPromptAudio: boolean;
  durationMs: number | null;
  transcript: string | null;
  transcriptStatus: string;
  title: string | null;
}

export interface Book {
  storyteller: { id: string; name: string; callName: string; creatorName: string | null; hasPhoto: boolean; status: StorytellerStatus };
  chapters: { chapter: ChapterId; title: string; entries: BookEntry[] }[];
  totalDurationMs: number;
}

export interface ManageView {
  storytellerId: string;
  storyteller: {
    name: string;
    callName: string;
    creatorName: string | null;
    hasPhoto: boolean;
    hasIntroAudio: boolean;
    status: StorytellerStatus;
  };
  questions: {
    id: string;
    chapter: ChapterId;
    text: string;
    isClosing: boolean;
    hasPromptAudio: boolean;
    answerStatus: AnswerStatus;
    durationMs: number | null;
  }[];
  progress: { answered: number; skipped: number; failed: number; total: number };
  links: { manage: string; record: string; book: string };
  tokens: { manage: string; record: string; book: string };
}
