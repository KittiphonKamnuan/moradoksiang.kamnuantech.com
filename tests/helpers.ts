import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'moradok-api-'));
}

const cache = new Map<number, Buffer>();
/** a short opus/webm clip like Chrome's MediaRecorder output */
export function webmClip(seconds = 1): Buffer {
  if (!cache.has(seconds)) {
    const file = path.join(os.tmpdir(), `moradok-clip-${process.pid}-${seconds}.webm`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`, '-c:a', 'libopus', file]);
    cache.set(seconds, fs.readFileSync(file));
    fs.rmSync(file);
  }
  return cache.get(seconds)!;
}

export const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

export function form(fields: Record<string, string | Blob>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

export const audioBlob = (bytes: Buffer, type = 'audio/webm;codecs=opus') => new Blob([new Uint8Array(bytes)], { type });

export const url = (p: string) => `http://localhost:3000${p}`;
