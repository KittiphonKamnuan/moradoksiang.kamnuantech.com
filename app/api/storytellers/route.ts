import { getDb } from '@/lib/db';
import { HttpError, clientKey, handle, json, linksFor, readForm, readJson, readPhotoField, storePhoto } from '@/lib/http';
import type { QuestionInput } from '@/lib/questions';
import { createRateLimiter } from '@/lib/ratelimit';
import { createStoryteller } from '@/lib/repo';
import { storage } from '@/lib/storage';

export const runtime = 'nodejs';

const limiter = createRateLimiter({ limit: 100, windowMs: 60 * 60 * 1000 });

interface Body {
  name?: string;
  callName?: string;
  creatorName?: string;
  questions?: QuestionInput[];
}

function parseQuestions(raw: unknown): QuestionInput[] | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(value)) throw new HttpError(400, 'questions must be an array');
  return value.filter((q) => q && typeof q.text === 'string');
}

export const POST = handle(async (req: Request) => {
  if (!limiter.check(clientKey(req))) throw new HttpError(429, 'too many requests');

  let body: Body;
  let photo: Awaited<ReturnType<typeof readPhotoField>> = null;
  if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
    const fd = await readForm(req);
    photo = await readPhotoField(fd);
    body = {
      name: fd.get('name')?.toString(),
      callName: fd.get('callName')?.toString(),
      creatorName: fd.get('creatorName')?.toString(),
      questions: fd.get('questions')?.toString() as never,
    };
  } else {
    body = await readJson<Body>(req);
  }

  if (!body.name?.trim() || !body.callName?.trim()) throw new HttpError(400, 'name and callName are required');
  let questions: QuestionInput[] | undefined;
  try {
    questions = parseQuestions(body.questions);
  } catch (err) {
    throw err instanceof HttpError ? err : new HttpError(400, 'invalid questions');
  }

  const photoPath = photo ? await storePhoto((b) => storage.saveImage(b, 'photos'), photo) : null;
  const s = createStoryteller(getDb(), {
    name: body.name.slice(0, 100),
    callName: body.callName.slice(0, 30),
    creatorName: body.creatorName?.slice(0, 100),
    photoPath,
    questions,
  });
  return json({ manageToken: s.manageToken, recordToken: s.recordToken, bookToken: s.bookToken, links: linksFor(s, req) }, 201);
});
