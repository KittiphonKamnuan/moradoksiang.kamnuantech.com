import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';

/** Normalise any recorder output to mono AAC in .m4a — plays everywhere including Safari. */
export async function transcodeToM4a(input: string, output: string): Promise<void> {
  await run(FFMPEG, [
    '-v', 'error', '-y',
    '-i', input,
    '-vn', '-ac', '1', '-ar', '44100',
    '-c:a', 'aac', '-b:a', '64k',
    '-movflags', '+faststart',
    output,
  ]);
}

export async function probeDurationMs(file: string): Promise<number | null> {
  try {
    const { stdout } = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    const seconds = parseFloat(stdout.trim());
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
  } catch {
    return null;
  }
}
