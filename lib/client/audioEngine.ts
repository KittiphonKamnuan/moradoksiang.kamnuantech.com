import { pickRecorderMime } from '../mime';
import { computeRms } from '../silence';

/** 0.1s of silence as WAV — played inside the first tap to unlock the <audio> element on iOS. */
function silentWavUrl(): string {
  const sampleRate = 8000;
  const samples = 800;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/** Best Thai voice on this device: prefer natural/online voices (Edge "Premwadee Online", Google ไทย, Apple Kanya) */
function thaiVoice(): SpeechSynthesisVoice | undefined {
  if (typeof speechSynthesis === 'undefined') return undefined;
  const thai = speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().replace('_', '-').startsWith('th'));
  const score = (v: SpeechSynthesisVoice) => (/natural|online|neural|enhanced|premium/i.test(v.name) ? 2 : 0) + (/google/i.test(v.name) ? 1 : 0);
  return thai.sort((a, b) => score(b) - score(a))[0];
}

/** Chrome loads voices asynchronously — getVoices() is empty until "voiceschanged". */
function voicesReady(timeoutMs = 1500): Promise<void> {
  if (typeof speechSynthesis === 'undefined' || speechSynthesis.getVoices().length) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      speechSynthesis.removeEventListener('voiceschanged', done);
      resolve();
    };
    speechSynthesis.addEventListener('voiceschanged', done);
    setTimeout(done, timeoutMs);
  });
}

/**
 * One AudioContext, one <audio> element and one mic stream for the whole session.
 * iOS locks autoplay per element and asks mic permission per getUserMedia call, so we reuse everything.
 */
export class AudioEngine {
  private ctx?: AudioContext;
  private analyser?: AnalyserNode;
  private samples = new Float32Array(2048);
  private stream?: MediaStream;
  private audio?: HTMLAudioElement;
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private stopResolve?: (b: Blob | null) => void;
  mime = '';

  /** Must be called synchronously inside a user gesture (the "เริ่มคุยกัน" tap). */
  unlock() {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx ??= new Ctx();
    void this.ctx.resume();
    this.audio ??= new Audio();
    this.audio.setAttribute('playsinline', '');
    this.audio.src = silentWavUrl();
    void this.audio.play().catch(() => {});
    if (typeof speechSynthesis !== 'undefined') {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  }

  async openMic(): Promise<void> {
    if (this.stream?.active) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const source = this.ctx!.createMediaStreamSource(this.stream);
    this.analyser = this.ctx!.createAnalyser();
    this.analyser.fftSize = 2048;
    source.connect(this.analyser);
    this.mime = typeof MediaRecorder !== 'undefined' ? pickRecorderMime((t) => MediaRecorder.isTypeSupported(t)) : '';
  }

  rms(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.samples);
    return computeRms(this.samples);
  }

  get hasThaiVoice() {
    return !!thaiVoice();
  }

  /** Resolves true when the clip played to the end, false if it could not be loaded/played. */
  playUrl(url: string): Promise<boolean> {
    const audio = this.audio!;
    return new Promise((resolve) => {
      const done = (ok: boolean) => {
        audio.onended = audio.onerror = null;
        resolve(ok);
      };
      audio.onended = () => done(true);
      audio.onerror = () => done(false);
      audio.src = url;
      audio.play().catch(() => done(false));
    });
  }

  /** Natural server voice first (Google TTS, cached on our server), browser voice as fallback. */
  async say(serverUrl: string | null, text: string): Promise<void> {
    if (serverUrl && (await this.playUrl(serverUrl))) return;
    await this.speak(text);
  }

  /** Thai TTS fallback. Resolves when done; if no Thai voice exists, waits a reading-time pause instead. */
  async speak(text: string): Promise<void> {
    await voicesReady();
    const voice = thaiVoice();
    const readingPause = () => new Promise<void>((r) => setTimeout(r, Math.min(2500 + text.length * 60, 8000)));
    if (!voice) return readingPause();
    return new Promise((resolve) => {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/🎵/g, ''));
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = 0.9;
      const safety = setTimeout(resolve, 30000);
      u.onend = u.onerror = () => {
        clearTimeout(safety);
        resolve();
      };
      speechSynthesis.speak(u);
    });
  }

  /** soft "ติ๊ง" — the cue that it's your turn to talk */
  ding(volume = 0.18, freq = 880): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.65);
    return new Promise((r) => setTimeout(r, 650));
  }

  stopPlayback() {
    this.audio?.pause();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }

  startRecording() {
    if (!this.stream) throw new Error('mic not open');
    this.cancelRecording();
    this.chunks = [];
    const rec = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime } : undefined);
    rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    rec.onstop = () => {
      const type = rec.mimeType || this.mime || 'audio/webm';
      const blob = this.chunks.length ? new Blob(this.chunks, { type }) : null;
      this.stopResolve?.(blob);
      this.stopResolve = undefined;
    };
    rec.start(1000); // timeslice: keep chunks flowing in case the page stalls
    this.recorder = rec;
  }

  get isRecording() {
    return this.recorder?.state === 'recording';
  }

  stopRecording(): Promise<Blob | null> {
    const rec = this.recorder;
    this.recorder = undefined;
    if (!rec || rec.state === 'inactive') return Promise.resolve(null);
    return new Promise((resolve) => {
      this.stopResolve = resolve;
      rec.stop();
    });
  }

  cancelRecording() {
    const rec = this.recorder;
    this.recorder = undefined;
    if (rec && rec.state !== 'inactive') {
      rec.onstop = null;
      rec.stop();
    }
  }

  close() {
    this.cancelRecording();
    this.stopPlayback();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    void this.ctx?.close();
    this.ctx = undefined;
  }
}

export async function keepScreenOn(): Promise<() => void> {
  type WakeLockSentinel = { release(): Promise<void> };
  const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinel> } };
  if (!nav.wakeLock) return () => {};
  let lock: WakeLockSentinel | undefined;
  const acquire = async () => {
    try {
      lock = await nav.wakeLock!.request('screen');
    } catch {}
  };
  const onVisible = () => document.visibilityState === 'visible' && acquire();
  await acquire();
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    void lock?.release().catch(() => {});
  };
}
