import { describe, expect, it } from 'vitest';
import { DEFAULT_SILENCE_CONFIG, SilenceDetector, computeRms, estimateNoiseFloor, thresholdFor } from '@/lib/silence';

const LOUD = 0.2;
const QUIET = 0.001;

/** feed the detector a constant rms every 100ms from `from` to `to` (exclusive) and collect events */
function feed(d: SilenceDetector, rms: number, from: number, to: number) {
  const events: { t: number; e: string }[] = [];
  for (let t = from; t < to; t += 100) for (const e of d.update(rms, t)) events.push({ t, e });
  return events;
}

describe('computeRms', () => {
  it('is 0 for silence', () => {
    expect(computeRms(new Float32Array(2048))).toBe(0);
  });

  it('is the amplitude for a constant signal', () => {
    expect(computeRms(new Float32Array(16).fill(0.5))).toBeCloseTo(0.5);
  });

  it('is amp/sqrt(2) for a sine wave', () => {
    const buf = new Float32Array(4800);
    for (let i = 0; i < buf.length; i++) buf[i] = 0.4 * Math.sin((2 * Math.PI * 440 * i) / 48000);
    expect(computeRms(buf)).toBeCloseTo(0.4 / Math.SQRT2, 2);
  });
});

describe('estimateNoiseFloor / thresholdFor', () => {
  it('uses the median so a single cough does not skew calibration', () => {
    expect(estimateNoiseFloor([0.01, 0.01, 0.9, 0.01, 0.02])).toBe(0.01);
  });

  it('returns 0 for no samples', () => {
    expect(estimateNoiseFloor([])).toBe(0);
  });

  it('threshold = max(noise * 2.5, 0.015)', () => {
    expect(thresholdFor(0)).toBe(0.015);
    expect(thresholdFor(0.02)).toBeCloseTo(0.05);
  });
});

describe('SilenceDetector', () => {
  it('uses the documented defaults', () => {
    expect(DEFAULT_SILENCE_CONFIG).toMatchObject({
      speechConfirmMs: 300,
      nudgeAfterSilenceMs: 6000,
      endAfterNudgeMs: 8000,
      noSpeechRepromptMs: 20000,
    });
  });

  it('starts waiting for speech', () => {
    expect(new SilenceDetector(0).state).toBe('waitingForSpeech');
  });

  it('ignores a short blip under 300ms', () => {
    const d = new SilenceDetector(0);
    expect(feed(d, LOUD, 0, 200)).toEqual([]);
    expect(d.state).toBe('waitingForSpeech');
  });

  it('emits speech-start after 300ms of sound', () => {
    const d = new SilenceDetector(0);
    const ev = feed(d, LOUD, 0, 500);
    expect(ev).toEqual([{ t: 300, e: 'speech-start' }]);
    expect(d.state).toBe('speaking');
    expect(d.hasSpoken).toBe(true);
  });

  it('reprompts once after 20s with no speech, never twice', () => {
    const d = new SilenceDetector(0);
    const ev = feed(d, QUIET, 0, 60000);
    expect(ev).toEqual([{ t: 20000, e: 'reprompt' }]);
  });

  it('restart() resets the waiting timer (after replaying the question)', () => {
    const d = new SilenceDetector(0);
    feed(d, QUIET, 0, 20100);
    d.restart(20100);
    const ev = feed(d, LOUD, 20100, 20600);
    expect(ev.map((x) => x.e)).toEqual(['speech-start']);
  });

  it('nudges after 6s of silence following speech, then auto-ends 8s later', () => {
    const d = new SilenceDetector(0);
    feed(d, LOUD, 0, 1000);
    const ev = feed(d, QUIET, 1000, 30000);
    // silence starts at 1000 -> nudge at 7000 -> auto-end at 15000
    expect(ev).toEqual([
      { t: 7000, e: 'nudge' },
      { t: 15000, e: 'auto-end' },
    ]);
    expect(d.state).toBe('ended');
  });

  it('a pause shorter than 6s does not nudge', () => {
    const d = new SilenceDetector(0);
    feed(d, LOUD, 0, 1000);
    const ev = [...feed(d, QUIET, 1000, 6000), ...feed(d, LOUD, 6000, 7000), ...feed(d, QUIET, 7000, 12000)];
    expect(ev).toEqual([]);
    expect(d.state).toBe('silent');
  });

  it('speaking again after a nudge resumes and cancels auto-end', () => {
    const d = new SilenceDetector(0);
    feed(d, LOUD, 0, 1000);
    feed(d, QUIET, 1000, 8000); // nudged at 7000
    expect(d.state).toBe('nudged');
    const ev = feed(d, LOUD, 8000, 9000);
    expect(ev).toEqual([{ t: 8300, e: 'resume' }]);
    expect(feed(d, QUIET, 9000, 14000)).toEqual([]);
  });

  it('emits nothing after ended', () => {
    const d = new SilenceDetector(0);
    feed(d, LOUD, 0, 1000);
    feed(d, QUIET, 1000, 16000);
    expect(feed(d, LOUD, 16000, 20000)).toEqual([]);
  });

  it('respects calibrated noise floor (noisy room)', () => {
    const d = new SilenceDetector(0.04); // threshold 0.1
    expect(feed(d, 0.08, 0, 1000)).toEqual([]);
    expect(feed(d, 0.15, 1000, 1500).map((x) => x.e)).toEqual(['speech-start']);
  });

  it('accepts custom timings', () => {
    const d = new SilenceDetector(0, { nudgeAfterSilenceMs: 1000, endAfterNudgeMs: 1000 });
    feed(d, LOUD, 0, 500);
    expect(feed(d, QUIET, 500, 5000).map((x) => x.e)).toEqual(['nudge', 'auto-end']);
  });
});
