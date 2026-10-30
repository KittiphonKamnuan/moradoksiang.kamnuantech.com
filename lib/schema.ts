import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { ChapterId } from './questions';

export const storytellers = sqliteTable('storytellers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  callName: text('call_name').notNull(),
  creatorName: text('creator_name'),
  photoPath: text('photo_path'),
  /** grandchild's own recorded opening message */
  introAudio: text('intro_audio'),
  manageToken: text('manage_token').notNull().unique(),
  recordToken: text('record_token').notNull().unique(),
  bookToken: text('book_token').notNull().unique(),
  status: text('status').$type<'draft' | 'recording' | 'completed'>().notNull().default('draft'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const questions = sqliteTable('questions', {
  id: text('id').primaryKey(),
  storytellerId: text('storyteller_id')
    .notNull()
    .references(() => storytellers.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  chapter: text('chapter').$type<ChapterId>().notNull(),
  text: text('text').notNull(),
  promptAudio: text('prompt_audio'),
  isClosing: integer('is_closing', { mode: 'boolean' }).notNull().default(false),
});

export const answers = sqliteTable('answers', {
  id: text('id').primaryKey(),
  questionId: text('question_id')
    .notNull()
    .unique()
    .references(() => questions.id, { onDelete: 'cascade' }),
  storytellerId: text('storyteller_id')
    .notNull()
    .references(() => storytellers.id, { onDelete: 'cascade' }),
  audioPath: text('audio_path'),
  mime: text('mime'),
  durationMs: integer('duration_ms'),
  status: text('status').$type<'saved' | 'skipped' | 'failed'>().notNull().default('saved'),
  transcript: text('transcript'),
  transcriptStatus: text('transcript_status')
    .$type<'pending' | 'processing' | 'done' | 'failed' | 'disabled'>()
    .notNull()
    .default('pending'),
  title: text('title'),
  createdAt: integer('created_at').notNull(),
});

/** Bootstrap DDL kept next to the Drizzle schema; also read by worker/transcribe.py's DB. */
export const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS storytellers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  call_name TEXT NOT NULL,
  creator_name TEXT,
  photo_path TEXT,
  intro_audio TEXT,
  manage_token TEXT UNIQUE NOT NULL,
  record_token TEXT UNIQUE NOT NULL,
  book_token TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  storyteller_id TEXT NOT NULL REFERENCES storytellers(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  chapter TEXT NOT NULL,
  text TEXT NOT NULL,
  prompt_audio TEXT,
  is_closing INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS questions_storyteller ON questions(storyteller_id, position);
CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL UNIQUE REFERENCES questions(id) ON DELETE CASCADE,
  storyteller_id TEXT NOT NULL REFERENCES storytellers(id) ON DELETE CASCADE,
  audio_path TEXT,
  mime TEXT,
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'saved',
  transcript TEXT,
  transcript_status TEXT NOT NULL DEFAULT 'pending',
  title TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS answers_transcript ON answers(transcript_status);
`;

/** Columns added after the first release: [table, column, DDL] — applied if missing. */
export const MIGRATIONS: [string, string, string][] = [['storytellers', 'intro_audio', 'ALTER TABLE storytellers ADD COLUMN intro_audio TEXT']];
