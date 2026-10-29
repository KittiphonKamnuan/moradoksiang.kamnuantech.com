export interface SilenceConfig {
  minThreshold: number;
  noiseMultiplier: number;
  /** sound must last this long to count as speech */
  speechConfirmMs: number;
  /** silence after speech before asking "เล่าต่อไหมครับ" */
  nudgeAfterSilenceMs: number;
  /** further silence after the nudge before ending the answer */
  endAfterNudgeMs: number;
  /** no speech at all -> replay the question (once) */
  noSpeechRepromptMs: number;
}

export const DEFAULT_SILENCE_CONFIG: SilenceConfig = {
  minThreshold: 0.015,
  noiseMultiplier: 2.5,
  speechConfirmMs: 300,
  nudgeAfterSilenceMs: 6000,
  endAfterNudgeMs: 8000,
  noSpeechRepromptMs: 20000,
};

export type SilenceState = 'waitingForSpeech' | 'speaking' | 'silent' | 'nudged' | 'ended';
export type SilenceEvent = 'speech-start' | 'reprompt' | 'nudge' | 'resume' | 'auto-end';

export function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export function estimateNoiseFloor(rmsSamples: number[]): number {
  if (rmsSamples.length === 0) return 0;
  const sorted = [...rmsSamples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function thresholdFor(noiseFloor: number, config: SilenceConfig = DEFAULT_SILENCE_CONFIG): number {
  return Math.max(noiseFloor * config.noiseMultiplier, config.minThreshold);
}

/** Pure, clock-injected state machine. Feed it an RMS reading every ~100ms. */
export class SilenceDetector {
  readonly config: SilenceConfig;
  readonly threshold: number;
  state: SilenceState = 'waitingForSpeech';
  hasSpoken = false;

  private waitStart: number | null = null;
  private loudSince: number | null = null;
  private silentSince = 0;
  private nudgedAt = 0;
  private reprompted = false;

  constructor(noiseFloor: number, config: Partial<SilenceConfig> = {}) {
    this.config = { ...DEFAULT_SILENCE_CONFIG, ...config };
    this.threshold = thresholdFor(noiseFloor, this.config);
  }

  /** call after replaying the question so the 20s timer starts over */
  restart(now: number) {
    this.waitStart = now;
    this.loudSince = null;
  }

  update(rms: number, now: number): SilenceEvent[] {
    const loud = rms > this.threshold;
    this.waitStart ??= now;
    this.loudSince = loud ? (this.loudSince ?? now) : null;
    const confirmed = this.loudSince !== null && now - this.loudSince >= this.config.speechConfirmMs;

    switch (this.state) {
      case 'waitingForSpeech':
        if (confirmed) {
          this.state = 'speaking';
          this.hasSpoken = true;
          return ['speech-start'];
        }
        if (!this.reprompted && now - this.waitStart >= this.config.noSpeechRepromptMs) {
          this.reprompted = true;
          return ['reprompt'];
        }
        return [];

      case 'speaking':
        if (!loud) {
          this.state = 'silent';
          this.silentSince = now;
        }
        return [];

      case 'silent':
        if (loud) {
          this.state = 'speaking';
          return [];
        }
        if (now - this.silentSince >= this.config.nudgeAfterSilenceMs) {
          this.state = 'nudged';
          this.nudgedAt = now;
          return ['nudge'];
        }
        return [];

      case 'nudged':
        if (confirmed) {
          this.state = 'speaking';
          return ['resume'];
        }
        if (now - this.nudgedAt >= this.config.endAfterNudgeMs) {
          this.state = 'ended';
          return ['auto-end'];
        }
        return [];

      case 'ended':
        return [];
    }
  }
}
