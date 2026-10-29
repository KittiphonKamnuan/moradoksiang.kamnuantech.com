import { getDb } from './db';
import { HttpError, linksFor } from './http';
import { getByManageToken, listQuestions } from './repo';

export function requireManage(token: string) {
  const s = getByManageToken(getDb(), token);
  if (!s) throw new HttpError(404, 'not found');
  return s;
}

export function manageView(token: string, req?: Request) {
  const s = requireManage(token);
  return {
    storyteller: { name: s.name, callName: s.callName, creatorName: s.creatorName, hasPhoto: !!s.photoPath, status: s.status },
    questions: listQuestions(getDb(), s.id).map((q) => ({
      id: q.id,
      chapter: q.chapter,
      text: q.text,
      isClosing: q.isClosing,
      hasPromptAudio: !!q.promptAudio,
    })),
    links: linksFor(s, req),
    tokens: { manage: s.manageToken, record: s.recordToken, book: s.bookToken },
  };
}

export type ManageView = ReturnType<typeof manageView>;
