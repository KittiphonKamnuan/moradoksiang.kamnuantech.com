import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { probeDurationMs, transcodeToM4a } from '@/lib/audio';
import { createStorage } from '@/lib/storage';

let tmp: string;

/** what Chrome's MediaRecorder produces: opus in webm */
function makeWebm(seconds: number) {
  const file = path.join(tmp, `tone-${seconds}.webm`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-c:a', 'libopus', file]);
  return file;
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'moradok-audio-'));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('audio (ffmpeg)', () => {
  it('transcodes webm/opus to AAC m4a and measures its duration', async () => {
    const out = path.join(tmp, 'out.m4a');
    await transcodeToM4a(makeWebm(2), out);
    const codec = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', out])
      .toString()
      .trim();
    expect(codec).toBe('aac');
    const ms = await probeDurationMs(out);
    expect(ms).toBeGreaterThan(1900);
    expect(ms).toBeLessThan(2200);
  });

  it('rejects garbage input', async () => {
    const bad = path.join(tmp, 'bad.webm');
    fs.writeFileSync(bad, 'not audio');
    await expect(transcodeToM4a(bad, path.join(tmp, 'bad.m4a'))).rejects.toThrow();
  });

  it('probeDurationMs returns null for unreadable files', async () => {
    expect(await probeDurationMs(path.join(tmp, 'missing.m4a'))).toBeNull();
  });
});

describe('storage', () => {
  it('saveAudio stores a normalized m4a under the kind folder and returns a relative path', async () => {
    const storage = createStorage(path.join(tmp, 'data'));
    const res = await storage.saveAudio(fs.readFileSync(makeWebm(1)), 'answers', 'audio/webm;codecs=opus');
    expect(res.path).toMatch(/^answers\/[A-Za-z0-9_-]+\.m4a$/);
    expect(fs.existsSync(storage.absolutePath(res.path))).toBe(true);
    expect(res.durationMs).toBeGreaterThan(900);
    // no temp leftovers
    expect(fs.readdirSync(path.join(tmp, 'data', 'answers')).filter((f) => !f.endsWith('.m4a'))).toEqual([]);
  });

  it('saveAudio cleans up and throws on invalid audio', async () => {
    const storage = createStorage(path.join(tmp, 'data2'));
    await expect(storage.saveAudio(Buffer.from('nope'), 'answers', 'audio/webm')).rejects.toThrow();
    expect(fs.readdirSync(path.join(tmp, 'data2', 'answers'))).toEqual([]);
  });

  it('absolutePath refuses to escape the data dir', () => {
    const storage = createStorage(path.join(tmp, 'data'));
    expect(() => storage.absolutePath('../secret')).toThrow();
    expect(() => storage.absolutePath('/etc/passwd')).toThrow();
  });

  it('removeFiles ignores missing files', async () => {
    const storage = createStorage(path.join(tmp, 'data3'));
    const { path: p } = await storage.saveAudio(fs.readFileSync(makeWebm(1)), 'prompts', 'audio/webm');
    await storage.removeFiles([p, 'prompts/missing.m4a']);
    expect(fs.existsSync(storage.absolutePath(p))).toBe(false);
  });

  it('saveFile stores raw bytes (photos) with the given extension', async () => {
    const storage = createStorage(path.join(tmp, 'data4'));
    const p = await storage.saveFile(Buffer.from([1, 2, 3]), 'photos', 'jpg');
    expect(p).toMatch(/^photos\/[A-Za-z0-9_-]+\.jpg$/);
    expect(fs.readFileSync(storage.absolutePath(p))).toEqual(Buffer.from([1, 2, 3]));
  });
});
