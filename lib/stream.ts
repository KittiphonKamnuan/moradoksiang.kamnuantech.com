import fs from 'node:fs';
import { Readable } from 'node:stream';
import { parseRange } from './range';

/** Stream a file honouring HTTP Range (Safari needs 206 responses to play/seek audio). */
export async function streamFile(req: Request, absPath: string, contentType: string): Promise<Response> {
  let size: number;
  try {
    size = (await fs.promises.stat(absPath)).size;
  } catch {
    return new Response('not found', { status: 404 });
  }

  const base = {
    'content-type': contentType,
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=3600',
    'x-robots-tag': 'noindex',
  };
  const range = parseRange(req.headers.get('range'), size);

  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${size}` } });
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const body = Readable.toWeb(fs.createReadStream(absPath, { start, end })) as ReadableStream;
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      ...base,
      'content-length': String(end - start + 1),
      ...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}),
    },
  });
}
