import type { ChapterId } from './questions';

/**
 * The spoken "story" around the questions, so the interview feels like a conversation
 * instead of a questionnaire. Lines are fixed text keyed by name — the TTS route only ever
 * speaks these, never arbitrary input. The narrator speaks *on behalf of* the grandchild,
 * never pretending to be them (their real voice is the recorded intro / prompts).
 */

export const ACK_COUNT = 4;

const CHAPTER_KEYS = ['roots', 'past', 'love', 'family', 'life', 'someday', 'closing'] as const;

export type LineKey =
  | 'intro'
  | 'welcome-back'
  | 'outro'
  | 'ack-skip'
  | `ack-${0 | 1 | 2 | 3}`
  | `chapter-${ChapterId}`;

export interface LineContext {
  name: string;
  callName: string;
  creatorName: string | null;
}

type Line = (c: { call: string; kid: string; name: string }) => string;

const LINES: Record<LineKey, Line> = {
  intro: ({ call, kid }) =>
    `สวัสดีครับ${call} ${kid}อยากฟังเรื่องชีวิตของ${call}มากเลยครับ เลยฝากคำถามไว้ให้ถามทีละเรื่อง ` +
    `${call}เล่าได้ตามสบายเลยนะครับ ไม่มีถูกไม่มีผิด นึกอะไรออกก็เล่าได้หมด จะยาวแค่ไหนก็ได้ ` +
    `เล่าจบแล้วแตะปุ่ม เล่าจบแล้ว ได้เลยครับ ถ้าข้อไหนไม่อยากเล่าก็ข้ามได้นะครับ`,
  'welcome-back': ({ call, kid }) =>
    `ยินดีที่ได้คุยกันอีกครั้งนะครับ${call} คราวก่อน${call}เล่าไว้หลายเรื่องแล้ว ${kid}ฟังแล้วชอบมากครับ วันนี้มาเล่าต่อกันนะครับ`,
  outro: ({ call, kid }) =>
    `ขอบคุณ${call}มากนะครับที่เล่าให้ฟัง ${kid}จะได้ฟังเรื่องของ${call}ไปอีกนานแสนนาน และจะเล่าต่อให้ลูกหลานฟังด้วยครับ`,
  'ack-skip': () => `ไม่เป็นไรครับ ไปเรื่องต่อไปกันนะครับ`,
  'ack-0': () => `ขอบคุณที่เล่าให้ฟังนะครับ`,
  'ack-1': ({ kid }) => `${kid}จะเก็บเรื่องนี้ไว้อย่างดีเลยครับ`,
  'ack-2': ({ call }) => `ขอบคุณครับ${call}`,
  'ack-3': () => `ฟังแล้วเห็นภาพเลยครับ`,
  'chapter-roots': ({ call }) => `เริ่มกันที่เรื่องรากเหง้าก่อนนะครับ เรื่องบ้านและครอบครัวที่${call}โตมา`,
  'chapter-past': ({ call }) => `ทีนี้ลองย้อนกลับไปวันวานกันนะครับ สมัยที่${call}ยังเด็ก`,
  'chapter-love': ({ kid }) => `ต่อไปเป็นเรื่องความรักครับ เรื่องนี้${kid}อยากรู้มานานแล้ว`,
  'chapter-family': ({ call }) => `มาถึงเรื่องครอบครัวกันนะครับ ตอนที่${call}มีลูกมีหลาน`,
  'chapter-life': ({ call }) => `ทีนี้อยากฟังเรื่องชีวิตและการงานของ${call}บ้างครับ`,
  'chapter-someday': ({ kid }) => `ช่วงสุดท้ายแล้วนะครับ เป็นเรื่องที่${kid}อยากเก็บไว้ฟังตอนโตขึ้น ถ้าสักวันหนึ่ง…`,
  'chapter-closing': () => `ก่อนจากกัน มีอีกคำถามเดียวครับ`,
};

export const isLineKey = (k: string): k is LineKey => Object.prototype.hasOwnProperty.call(LINES, k);
export const allLineKeys = () => Object.keys(LINES) as LineKey[];

export function lineText(key: LineKey, ctx: LineContext): string | null {
  const line = isLineKey(key) ? LINES[key] : undefined;
  if (!line) return null;
  return line({ call: ctx.callName.trim(), kid: ctx.creatorName?.trim() || 'หลาน', name: ctx.name });
}

export interface LeadInInput {
  questions: { chapter: ChapterId }[];
  index: number;
  /** first question asked since the storyteller pressed start */
  firstAsk: boolean;
  resumed: boolean;
  /** "ถามอีกที" — repeat only the question */
  repeat: boolean;
  lastOutcome: 'answered' | 'skipped' | null;
}

/** What to say before asking questions[index]. */
export function leadInFor(i: LeadInInput): LineKey[] {
  if (i.repeat) return [];
  const chapter = i.questions[i.index]?.chapter;
  const chapterLine = chapter && CHAPTER_KEYS.includes(chapter) ? (`chapter-${chapter}` as LineKey) : null;
  if (i.firstAsk) return [i.resumed ? 'welcome-back' : 'intro', ...(chapterLine ? [chapterLine] : [])];

  const ack: LineKey = i.lastOutcome === 'skipped' ? 'ack-skip' : (`ack-${i.index % ACK_COUNT}` as LineKey);
  const newChapter = chapter !== i.questions[i.index - 1]?.chapter;
  return newChapter && chapterLine ? [ack, chapterLine] : [ack];
}
