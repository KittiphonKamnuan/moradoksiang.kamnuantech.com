import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fitWithin, MAX_PHOTO_PX } from '@/lib/image';
import { createStorage } from '@/lib/storage';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'moradok-img-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

export function makeImage(w: number, h: number, ext = 'png') {
  const file = path.join(tmp, `src-${w}x${h}.${ext}`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=${w}x${h}:duration=1`, '-frames:v', '1', file]);
  return fs.readFileSync(file);
}

const probe = (file: string) =>
  execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name', '-of', 'csv=p=0', file])
    .toString()
    .trim();

describe('fitWithin (client-side resize before upload)', () => {
  it('scales the long side down to the limit, keeping aspect', () => {
    expect(fitWithin(4032, 3024, 1024)).toEqual({ width: 1024, height: 768 });
    expect(fitWithin(3024, 4032, 1024)).toEqual({ width: 768, height: 1024 });
  });
  it('never upscales', () => {
    expect(fitWithin(800, 600, 1024)).toEqual({ width: 800, height: 600 });
  });
  it('default limit is 1024', () => {
    expect(MAX_PHOTO_PX).toBe(1024);
  });
});

describe('storage.saveImage (server-side normalise: jpeg, ≤1024px, metadata stripped)', () => {
  it('re-encodes a large png to a jpeg no wider than 1024', async () => {
    const storage = createStorage(path.join(tmp, 'd1'));
    const rel = await storage.saveImage(makeImage(3000, 2000), 'photos');
    expect(rel).toMatch(/^photos\/[A-Za-z0-9_-]+\.jpg$/);
    expect(probe(storage.absolutePath(rel))).toBe('mjpeg,1024,683');
  });

  it('keeps small images at their size', async () => {
    const storage = createStorage(path.join(tmp, 'd2'));
    const rel = await storage.saveImage(makeImage(400, 300), 'photos');
    expect(probe(storage.absolutePath(rel))).toBe('mjpeg,400,300');
  });

  it('throws on bytes that are not an image, leaving nothing behind', async () => {
    const storage = createStorage(path.join(tmp, 'd3'));
    await expect(storage.saveImage(Buffer.from('<html>'), 'photos')).rejects.toThrow();
    expect(fs.readdirSync(path.join(tmp, 'd3', 'photos'))).toEqual([]);
  });
});
