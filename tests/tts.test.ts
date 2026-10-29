import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from '@/lib/storage';
import { createTts, googleSynthesizer, prepareTtsText, ttsCachePath } from '@/lib/tts';

let tmp: string;
let mp3: Buffer;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'moradok-tts-'));
  const file = path.join(tmp, 'voice.mp3');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=1', '-c:a', 'libmp3lame', file]);
  mp3 = fs.readFileSync(file);
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('prepareTtsText', () => {
  it('drops emoji and squeezes whitespace', () => {
    expect(prepareTtsText('เพลงที่ยายเคยร้อง  ร้องให้หลานฟังหน่อยได้ไหม 🎵')).toBe('เพลงที่ยายเคยร้อง ร้องให้หลานฟังหน่อยได้ไหม');
  });
});

describe('ttsCachePath', () => {
  const v = { voice: 'th-TH-Neural2-C', rate: 0.9 };
  it('is deterministic per text + voice settings', () => {
    expect(ttsCachePath('สวัสดี', v)).toBe(ttsCachePath('สวัสดี', v));
    expect(ttsCachePath('สวัสดี', v)).toMatch(/^tts\/[a-f0-9]{32}\.m4a$/);
  });
  it('changes when the text, voice or rate changes', () => {
    const base = ttsCachePath('สวัสดี', v);
    expect(ttsCachePath('สวัสดีครับ', v)).not.toBe(base);
    expect(ttsCachePath('สวัสดี', { ...v, voice: 'th-TH-Standard-A' })).not.toBe(base);
    expect(ttsCachePath('สวัสดี', { ...v, rate: 1 })).not.toBe(base);
  });
  it('ignores emoji differences (same spoken text)', () => {
    expect(ttsCachePath('ร้องเพลง 🎵', v)).toBe(ttsCachePath('ร้องเพลง', v));
  });
});

describe('createTts', () => {
  const opts = { voice: 'th-TH-Neural2-C', rate: 0.9 };

  it('synthesizes once, stores an m4a and serves later calls from cache', async () => {
    const storage = createStorage(path.join(tmp, 'd1'));
    const synthesize = vi.fn(async () => mp3);
    const tts = createTts({ storage, synthesize, ...opts });
    const p1 = await tts.getOrCreate('สวัสดียาย');
    const p2 = await tts.getOrCreate('สวัสดียาย');
    expect(p1).toBe(ttsCachePath('สวัสดียาย', opts));
    expect(p2).toBe(p1);
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(synthesize).toHaveBeenCalledWith('สวัสดียาย');
    expect(fs.existsSync(storage.absolutePath(p1!))).toBe(true);
  });

  it('dedupes concurrent requests for the same text', async () => {
    const storage = createStorage(path.join(tmp, 'd2'));
    const synthesize = vi.fn(async () => mp3);
    const tts = createTts({ storage, synthesize, ...opts });
    await Promise.all([tts.getOrCreate('ก'), tts.getOrCreate('ก'), tts.getOrCreate('ก')]);
    expect(synthesize).toHaveBeenCalledTimes(1);
  });

  it('returns null (caller falls back to browser voice) when synthesis fails, and retries next time', async () => {
    const storage = createStorage(path.join(tmp, 'd3'));
    const synthesize = vi.fn().mockRejectedValueOnce(new Error('quota')).mockResolvedValue(mp3);
    const tts = createTts({ storage, synthesize, ...opts });
    expect(await tts.getOrCreate('ข')).toBeNull();
    expect(await tts.getOrCreate('ข')).not.toBeNull();
  });

  it('returns null for empty text without calling the provider', async () => {
    const synthesize = vi.fn(async () => mp3);
    const tts = createTts({ storage: createStorage(path.join(tmp, 'd4')), synthesize, ...opts });
    expect(await tts.getOrCreate(' 🎵 ')).toBeNull();
    expect(synthesize).not.toHaveBeenCalled();
  });
});

describe('googleSynthesizer', () => {
  it('calls Cloud TTS with a Thai voice and decodes the MP3', async () => {
    const fetchMock = vi.fn(async () => Response.json({ audioContent: mp3.toString('base64') }));
    const synth = googleSynthesizer({ apiKey: 'KEY', voice: 'th-TH-Neural2-C', rate: 0.9, fetch: fetchMock });
    const out = await synth('สวัสดี');
    expect(out.equals(mp3)).toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://texttospeech.googleapis.com/v1/text:synthesize');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('KEY');
    const body = JSON.parse(init.body as string);
    expect(body.input).toEqual({ text: 'สวัสดี' });
    expect(body.voice).toEqual({ languageCode: 'th-TH', name: 'th-TH-Neural2-C' });
    expect(body.audioConfig).toMatchObject({ audioEncoding: 'MP3', speakingRate: 0.9 });
  });

  it('throws with the API message on error', async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: { message: 'API key not valid' } }, { status: 400 }));
    const synth = googleSynthesizer({ apiKey: 'bad', voice: 'v', rate: 1, fetch: fetchMock });
    await expect(synth('ก')).rejects.toThrow('API key not valid');
  });
});
