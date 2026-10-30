import { isAllowedUploadMime } from './mime';
import type { Storyteller } from './repo';

export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'cache-control': 'no-store' } });

export const fail = (status: number, error: string) => json({ error }, status);

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Wrap a handler so thrown HttpErrors become JSON responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, err.message);
      console.error(err);
      return fail(500, 'internal error');
    }
  };
}

export function baseUrl(req?: Request) {
  const env = process.env.NEXT_PUBLIC_BASE_URL;
  if (env) return env.replace(/\/$/, '');
  return req ? new URL(req.url).origin : 'http://localhost:3000';
}

export function linksFor(s: Pick<Storyteller, 'manageToken' | 'recordToken' | 'bookToken'>, req?: Request) {
  const base = baseUrl(req);
  return { manage: `${base}/m/${s.manageToken}`, record: `${base}/r/${s.recordToken}`, book: `${base}/b/${s.bookToken}` };
}

export function clientKey(req: Request) {
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local';
}

export const MAX_AUDIO_BYTES = 30 * 1024 * 1024; // ~15 min of iOS AAC with headroom
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };

export async function readAudioField(fd: FormData, field = 'audio') {
  const file = fd.get(field);
  if (!(file instanceof Blob) || file.size === 0) throw new HttpError(400, 'missing audio');
  const mime = (typeof fd.get('mime') === 'string' && (fd.get('mime') as string)) || file.type;
  if (!isAllowedUploadMime(mime)) throw new HttpError(415, 'unsupported audio type');
  if (file.size > MAX_AUDIO_BYTES) throw new HttpError(413, 'audio too large');
  return { bytes: Buffer.from(await file.arrayBuffer()), mime };
}

export async function readPhotoField(fd: FormData, field = 'photo') {
  const file = fd.get(field);
  if (!(file instanceof Blob) || file.size === 0) return null;
  if (!PHOTO_TYPES[file.type]) throw new HttpError(415, 'unsupported photo type');
  if (file.size > MAX_PHOTO_BYTES) throw new HttpError(413, 'photo too large');
  return { bytes: Buffer.from(await file.arrayBuffer()) };
}

/** Normalise + store an uploaded photo; 422 when the bytes are not a decodable image. */
export async function storePhoto(save: (bytes: Buffer) => Promise<string>, photo: { bytes: Buffer }) {
  try {
    return await save(photo.bytes);
  } catch {
    throw new HttpError(422, 'could not decode photo');
  }
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'invalid json');
  }
}

export async function readForm(req: Request): Promise<FormData> {
  try {
    return await req.formData();
  } catch {
    throw new HttpError(400, 'invalid form data');
  }
}
