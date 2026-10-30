import { getDb } from './db';
import { HttpError, linksFor } from './http';
import { renderQuestion } from './questions';
import { getByManageToken, listQuestions, listQuestionsWithAnswers, type Storyteller } from './repo';
import { allLineKeys, lineText } from './script';
import { getTtsService } from './tts';

export function requireManage(token: string) {
  const s = getByManageToken(getDb(), token);
  if (!s) throw new HttpError(404, 'not found');
  return s;
}

export function manageView(token: string, req?: Request) {
  const s = requireManage(token);
  const questions = listQuestionsWithAnswers(getDb(), s.id).map((q) => ({
    id: q.id,
    chapter: q.chapter,
    text: q.text,
    isClosing: q.isClosing,
    hasPromptAudio: !!q.promptAudio,
    answerStatus: q.answerStatus,
    durationMs: q.durationMs,
  }));
  return {
    storytellerId: s.id,
    storyteller: {
      name: s.name,
      callName: s.callName,
      creatorName: s.creatorName,
      hasPhoto: !!s.photoPath,
      hasIntroAudio: !!s.introAudio,
      status: s.status,
    },
    questions,
    progress: {
      answered: questions.filter((q) => q.answerStatus === 'saved').length,
      skipped: questions.filter((q) => q.answerStatus === 'skipped').length,
      failed: questions.filter((q) => q.answerStatus === 'failed').length,
      total: questions.length,
    },
    links: linksFor(s, req),
    tokens: { manage: s.manageToken, record: s.recordToken, book: s.bookToken },
  };
}

export type ManageView = ReturnType<typeof manageView>;

/**
 * Every cached TTS file that speaks this storyteller's names (questions with {เรียก}, story lines
 * with the grandchild's name). Used to honour "delete everything" and to drop stale voices on rename.
 */
export function cachedVoicesFor(s: Pick<Storyteller, 'id' | 'name' | 'callName' | 'creatorName'>): string[] {
  const tts = getTtsService();
  if (!tts) return [];
  const questions = listQuestions(getDb(), s.id).map((q) => renderQuestion(q.text, s.callName));
  const lines = allLineKeys().map((k) => lineText(k, s)!);
  return [...questions, ...lines].map((t) => tts.pathFor(t));
}
