import fs from 'node:fs/promises';
import path from 'node:path';
import { probeDurationMs, transcodeToM4a } from './audio';
import { DATA_DIR } from './db';
import { extensionForMime } from './mime';
import { newId } from './tokens';

export type AudioKind = 'answers' | 'prompts';

export function createStorage(baseDir: string) {
  const root = path.resolve(baseDir);

  function absolutePath(rel: string): string {
    const abs = path.resolve(root, rel);
    if (path.isAbsolute(rel) || !abs.startsWith(root + path.sep)) throw new Error('path escapes data dir');
    return abs;
  }

  async function saveAudio(bytes: Buffer, kind: AudioKind, mime: string) {
    const dir = path.join(root, kind);
    await fs.mkdir(dir, { recursive: true });
    const id = newId();
    const tmp = path.join(dir, `${id}.upload.${extensionForMime(mime)}`);
    const rel = `${kind}/${id}.m4a`;
    await fs.writeFile(tmp, bytes);
    try {
      await transcodeToM4a(tmp, absolutePath(rel));
    } catch (err) {
      await fs.rm(absolutePath(rel), { force: true });
      throw err;
    } finally {
      await fs.rm(tmp, { force: true });
    }
    return { path: rel, durationMs: await probeDurationMs(absolutePath(rel)) };
  }

  async function saveFile(bytes: Buffer, kind: string, ext: string) {
    await fs.mkdir(path.join(root, kind), { recursive: true });
    const rel = `${kind}/${newId()}.${ext}`;
    await fs.writeFile(absolutePath(rel), bytes);
    return rel;
  }

  async function removeFiles(rels: (string | null | undefined)[]) {
    await Promise.all(rels.filter((r): r is string => !!r).map((r) => fs.rm(absolutePath(r), { force: true })));
  }

  return { root, absolutePath, saveAudio, saveFile, removeFiles };
}

export type Storage = ReturnType<typeof createStorage>;

export const storage = createStorage(path.join(DATA_DIR, 'files'));
