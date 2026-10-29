import crypto from 'node:crypto';
import { storage as defaultStorage, type Storage } from './storage';

/**
 * Server-side Thai TTS for questions the grandchild hasn't recorded.
 * Only the question text is sent to Google — the storyteller's voice never leaves the house.
 * Each spoken text is synthesized once and cached as data/files/tts/<hash>.m4a.
 */

export interface VoiceSettings {
  voice: string;
  rate: number;
}

export type Synthesizer = (text: string) => Promise<Buffer>;

export function prepareTtsText(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function ttsCachePath(text: string, v: VoiceSettings): string {
  const hash = crypto.createHash('sha256').update(JSON.stringify([prepareTtsText(text), v.voice, v.rate])).digest('hex');
  return `tts/${hash.slice(0, 32)}.m4a`;
}

export function createTts({ storage, synthesize, ...settings }: VoiceSettings & { storage: Storage; synthesize: Synthesizer }) {
  const inflight = new Map<string, Promise<string | null>>();
  const warming = new Set<Promise<void>>();

  async function create(text: string, rel: string): Promise<string | null> {
    if (await storage.exists(rel)) return rel;
    try {
      const mp3 = await synthesize(text);
      const name = rel.slice('tts/'.length, -'.m4a'.length);
      await storage.saveAudio(mp3, 'tts', 'audio/mpeg', name);
      return rel;
    } catch (err) {
      console.warn('[tts] synthesis failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  function getOrCreate(rawText: string): Promise<string | null> {
    const text = prepareTtsText(rawText);
    if (!text) return Promise.resolve(null);
    const rel = ttsCachePath(text, settings);
    let job = inflight.get(rel);
    if (!job) {
      job = create(text, rel).finally(() => inflight.delete(rel));
      inflight.set(rel, job);
    }
    return job;
  }

  return {
    settings,
    getOrCreate,
    pathFor: (text: string) => ttsCachePath(text, settings),
    /** generate in the background, one at a time (no burst against the API) */
    warm(texts: string[]) {
      let chain = Promise.resolve();
      for (const t of texts) chain = chain.then(() => getOrCreate(t).then(() => undefined));
      warming.add(chain);
      void chain.finally(() => warming.delete(chain));
    },
    async idle() {
      await Promise.all([...warming, ...inflight.values()]);
    },
  };
}

export function googleSynthesizer({
  apiKey,
  voice,
  rate,
  fetch: fetchImpl = fetch,
}: VoiceSettings & { apiKey: string; fetch?: typeof fetch }): Synthesizer {
  return async (text) => {
    const res = await fetchImpl('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: 'th-TH', name: voice },
        audioConfig: { audioEncoding: 'MP3', speakingRate: rate, sampleRateHertz: 24000 },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { audioContent?: string; error?: { message?: string } };
    if (!res.ok || !body.audioContent) throw new Error(body.error?.message ?? `Google TTS ${res.status}`);
    return Buffer.from(body.audioContent, 'base64');
  };
}

export type TtsService = ReturnType<typeof createTts>;

const globalForTts = globalThis as unknown as { __moradokTts?: { key: string; service: TtsService } };

/** Configured from env; null when GOOGLE_TTS_API_KEY is not set (browser voice fallback). */
export function getTtsService(): TtsService | null {
  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) return null;
  const settings = { voice: process.env.GOOGLE_TTS_VOICE || 'th-TH-Neural2-C', rate: Number(process.env.GOOGLE_TTS_RATE || 0.9) };
  const key = JSON.stringify([apiKey, settings]);
  if (globalForTts.__moradokTts?.key !== key) {
    globalForTts.__moradokTts = {
      key,
      service: createTts({ storage: defaultStorage, synthesize: googleSynthesizer({ apiKey, ...settings }), ...settings }),
    };
  }
  return globalForTts.__moradokTts.service;
}
