import { and, asc, eq, inArray, or } from 'drizzle-orm';
import type { Db } from './db';
import { answers, questions, storytellers } from './schema';
import {
  CHAPTERS,
  buildDefaultQuestionList,
  normalizeQuestionList,
  renderQuestion,
  type ChapterId,
  type QuestionInput,
} from './questions';
import { newId, newToken } from './tokens';

export type Storyteller = typeof storytellers.$inferSelect;
export type Question = typeof questions.$inferSelect;

export interface CreateStorytellerInput {
  name: string;
  callName: string;
  creatorName?: string | null;
  photoPath?: string | null;
  questions?: QuestionInput[];
}

export function createStoryteller(db: Db, input: CreateStorytellerInput) {
  const name = input.name.trim();
  const callName = input.callName.trim();
  if (!name || !callName) throw new Error('name and callName are required');

  const now = Date.now();
  const row = {
    id: newId(),
    name,
    callName,
    creatorName: input.creatorName?.trim() || null,
    photoPath: input.photoPath ?? null,
    manageToken: newToken(),
    recordToken: newToken(),
    bookToken: newToken(),
    status: 'draft' as const,
    createdAt: now,
    updatedAt: now,
  };
  const list = input.questions ? normalizeQuestionList(input.questions) : buildDefaultQuestionList();

  db.transaction((tx) => {
    tx.insert(storytellers).values(row).run();
    tx.insert(questions)
      .values(list.map((q) => ({ id: newId(), storytellerId: row.id, position: q.position, chapter: q.chapter, text: q.text, isClosing: q.isClosing })))
      .run();
  });
  return row;
}

export const getByManageToken = (db: Db, token: string) =>
  db.select().from(storytellers).where(eq(storytellers.manageToken, token)).get();
export const getByRecordToken = (db: Db, token: string) =>
  db.select().from(storytellers).where(eq(storytellers.recordToken, token)).get();
export const getByBookToken = (db: Db, token: string) =>
  db.select().from(storytellers).where(eq(storytellers.bookToken, token)).get();

export function updateStoryteller(
  db: Db,
  id: string,
  patch: Partial<Pick<Storyteller, 'name' | 'callName' | 'creatorName' | 'photoPath'>>,
) {
  db.update(storytellers).set({ ...patch, updatedAt: Date.now() }).where(eq(storytellers.id, id)).run();
}

export const listQuestions = (db: Db, storytellerId: string) =>
  db.select().from(questions).where(eq(questions.storytellerId, storytellerId)).orderBy(asc(questions.position)).all();

/** Replace the question list. Returns file paths (prompts + answers) of removed questions. */
export function replaceQuestions(db: Db, storytellerId: string, input: QuestionInput[]): string[] {
  const existing = listQuestions(db, storytellerId);
  const ownIds = new Set(existing.map((q) => q.id));
  const list = normalizeQuestionList(input.map((q) => ({ ...q, id: q.id && ownIds.has(q.id) ? q.id : undefined })));
  const keep = new Set(list.map((q) => q.id).filter(Boolean));
  const removedIds = existing.filter((q) => !keep.has(q.id)).map((q) => q.id);

  const removedFiles: string[] = existing.filter((q) => !keep.has(q.id) && q.promptAudio).map((q) => q.promptAudio!);
  if (removedIds.length) {
    for (const a of db.select({ p: answers.audioPath }).from(answers).where(inArray(answers.questionId, removedIds)).all()) {
      if (a.p) removedFiles.push(a.p);
    }
  }

  db.transaction((tx) => {
    if (removedIds.length) tx.delete(questions).where(inArray(questions.id, removedIds)).run();
    for (const q of list) {
      if (q.id) {
        tx.update(questions)
          .set({ position: q.position, chapter: q.chapter, text: q.text, isClosing: q.isClosing })
          .where(eq(questions.id, q.id))
          .run();
      } else {
        tx.insert(questions)
          .values({ id: newId(), storytellerId, position: q.position, chapter: q.chapter, text: q.text, isClosing: q.isClosing })
          .run();
      }
    }
  });
  return removedFiles;
}

/** Returns the previous prompt path (to delete) */
export function setPromptAudio(db: Db, questionId: string, audioPath: string | null): string | null {
  const prev = db.select({ p: questions.promptAudio }).from(questions).where(eq(questions.id, questionId)).get();
  db.update(questions).set({ promptAudio: audioPath }).where(eq(questions.id, questionId)).run();
  return prev?.p ?? null;
}

export const getQuestion = (db: Db, storytellerId: string, questionId: string) =>
  db
    .select()
    .from(questions)
    .where(and(eq(questions.id, questionId), eq(questions.storytellerId, storytellerId)))
    .get();

function upsertAnswer(
  db: Db,
  storytellerId: string,
  questionId: string,
  values: Pick<typeof answers.$inferInsert, 'audioPath' | 'mime' | 'durationMs' | 'status' | 'transcriptStatus'>,
) {
  if (!getQuestion(db, storytellerId, questionId)) throw new Error('question does not belong to storyteller');
  const prev = db.select().from(answers).where(eq(answers.questionId, questionId)).get();
  const id = newId();
  db.transaction((tx) => {
    tx.delete(answers).where(eq(answers.questionId, questionId)).run();
    tx.insert(answers)
      .values({ id, questionId, storytellerId, createdAt: Date.now(), transcript: null, title: null, ...values })
      .run();
    tx.update(storytellers)
      .set({ status: 'recording', updatedAt: Date.now() })
      .where(and(eq(storytellers.id, storytellerId), eq(storytellers.status, 'draft')))
      .run();
  });
  return { answerId: id, previousAudioPath: prev?.audioPath ?? null };
}

export interface SaveAnswerInput {
  storytellerId: string;
  questionId: string;
  audioPath: string;
  mime: string;
  durationMs: number | null;
  transcriptStatus?: 'pending' | 'disabled';
}

export function saveAnswer(db: Db, a: SaveAnswerInput) {
  return upsertAnswer(db, a.storytellerId, a.questionId, {
    audioPath: a.audioPath,
    mime: a.mime,
    durationMs: a.durationMs,
    status: 'saved',
    transcriptStatus: a.transcriptStatus ?? 'pending',
  });
}

export function skipAnswer(db: Db, storytellerId: string, questionId: string) {
  return upsertAnswer(db, storytellerId, questionId, {
    audioPath: null,
    mime: null,
    durationMs: null,
    status: 'skipped',
    transcriptStatus: 'disabled',
  });
}

export function completeSession(db: Db, storytellerId: string) {
  db.update(storytellers).set({ status: 'completed', updatedAt: Date.now() }).where(eq(storytellers.id, storytellerId)).run();
}

export function getSession(db: Db, recordToken: string) {
  const s = getByRecordToken(db, recordToken);
  if (!s) return undefined;
  const rows = db
    .select({ q: questions, status: answers.status })
    .from(questions)
    .leftJoin(answers, eq(answers.questionId, questions.id))
    .where(eq(questions.storytellerId, s.id))
    .orderBy(asc(questions.position))
    .all();

  const list = rows.map(({ q, status }) => ({
    id: q.id,
    chapter: q.chapter,
    text: renderQuestion(q.text, s.callName),
    hasPromptAudio: !!q.promptAudio,
    isClosing: q.isClosing,
    answerStatus: status ?? null,
  }));
  const firstOpen = list.findIndex((q) => q.answerStatus === null);
  const nextIndex = firstOpen === -1 ? list.length : firstOpen;
  return {
    storyteller: { id: s.id, name: s.name, callName: s.callName, creatorName: s.creatorName, hasPhoto: !!s.photoPath, status: s.status },
    questions: list,
    nextIndex,
    done: nextIndex >= list.length,
  };
}

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

export function getBook(db: Db, bookToken: string) {
  const s = getByBookToken(db, bookToken);
  if (!s) return undefined;
  const rows = db
    .select({ q: questions, a: answers })
    .from(questions)
    .innerJoin(answers, eq(answers.questionId, questions.id))
    .where(and(eq(questions.storytellerId, s.id), eq(answers.status, 'saved')))
    .orderBy(asc(questions.position))
    .all();

  const chapters: { chapter: ChapterId; title: string; entries: BookEntry[] }[] = [];
  let total = 0;
  for (const { q, a } of rows) {
    let last = chapters.at(-1);
    if (!last || last.chapter !== q.chapter) {
      last = { chapter: q.chapter, title: CHAPTERS[q.chapter]?.title ?? q.chapter, entries: [] };
      chapters.push(last);
    }
    total += a.durationMs ?? 0;
    last.entries.push({
      answerId: a.id,
      questionId: q.id,
      questionText: renderQuestion(q.text, s.callName),
      hasPromptAudio: !!q.promptAudio,
      durationMs: a.durationMs,
      transcript: a.transcript,
      transcriptStatus: a.transcriptStatus,
      title: a.title,
    });
  }
  return {
    storyteller: { id: s.id, name: s.name, callName: s.callName, creatorName: s.creatorName, hasPhoto: !!s.photoPath, status: s.status },
    chapters,
    totalDurationMs: total,
  };
}

/** Which tokens may stream which audio: answers -> book/manage; prompts -> record/book/manage. */
export function resolveAudio(db: Db, kind: 'answer' | 'prompt', id: string, token: string): string | null {
  if (kind === 'answer') {
    const row = db
      .select({ p: answers.audioPath })
      .from(answers)
      .innerJoin(storytellers, eq(storytellers.id, answers.storytellerId))
      .where(and(eq(answers.id, id), or(eq(storytellers.bookToken, token), eq(storytellers.manageToken, token))))
      .get();
    return row?.p ?? null;
  }
  const row = db
    .select({ p: questions.promptAudio })
    .from(questions)
    .innerJoin(storytellers, eq(storytellers.id, questions.storytellerId))
    .where(
      and(
        eq(questions.id, id),
        or(eq(storytellers.bookToken, token), eq(storytellers.manageToken, token), eq(storytellers.recordToken, token)),
      ),
    )
    .get();
  return row?.p ?? null;
}

/** Same rule for the cover photo. */
export function resolvePhoto(db: Db, token: string): string | null {
  const row = db
    .select({ p: storytellers.photoPath })
    .from(storytellers)
    .where(or(eq(storytellers.bookToken, token), eq(storytellers.manageToken, token), eq(storytellers.recordToken, token)))
    .get();
  return row?.p ?? null;
}

/** Deletes the storyteller (cascade). Returns every file path that must be removed from disk. */
export function deleteStoryteller(db: Db, id: string): string[] {
  const s = db.select().from(storytellers).where(eq(storytellers.id, id)).get();
  if (!s) return [];
  const files: string[] = [];
  if (s.photoPath) files.push(s.photoPath);
  for (const q of listQuestions(db, id)) if (q.promptAudio) files.push(q.promptAudio);
  for (const a of db.select({ p: answers.audioPath }).from(answers).where(eq(answers.storytellerId, id)).all()) {
    if (a.p) files.push(a.p);
  }
  db.delete(storytellers).where(eq(storytellers.id, id)).run();
  return files;
}
