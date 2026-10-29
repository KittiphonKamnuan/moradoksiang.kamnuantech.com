'use client';

import { forwardRef, useEffect, useRef, useState } from 'react';
import { formatDuration } from '@/lib/format';
import type { BookEntry } from '@/lib/repo';

const SPEEDS = [1, 1.25, 0.75];
const PLAY_EVENT = 'moradok:play';

/** One story in the life book. Only one card plays at a time. */
export const AudioCard = forwardRef<HTMLElement, { entry: BookEntry; token: string; highlight?: boolean; query?: string }>(function AudioCard(
  { entry, token, highlight, query },
  ref,
) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState((entry.durationMs ?? 0) / 1000);
  const [speed, setSpeed] = useState(0);

  useEffect(() => {
    const onOther = (e: Event) => {
      if ((e as CustomEvent).detail !== entry.answerId) audioRef.current?.pause();
    };
    window.addEventListener(PLAY_EVENT, onOther);
    return () => window.removeEventListener(PLAY_EVENT, onOther);
  }, [entry.answerId]);

  const toggle = () => {
    const a = audioRef.current!;
    if (a.paused) {
      window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: entry.answerId }));
      void a.play();
    } else a.pause();
  };

  const cycleSpeed = () => {
    const next = (speed + 1) % SPEEDS.length;
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  };

  const showTranscript = entry.transcriptStatus === 'done' && !!entry.transcript;
  const queryHit = !!query && !!entry.transcript?.toLowerCase().includes(query.toLowerCase());

  return (
    <article ref={ref} className={`paper-card space-y-4 p-5 transition ${highlight ? 'ring-4 ring-amber/60' : ''}`}>
      <div>
        {entry.title && <p className="font-display text-lg text-sage-d">{entry.title}</p>}
        <h3 className="font-display text-2xl leading-snug">{entry.questionText}</h3>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'หยุด' : 'เล่น'}
          className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-amber text-ink shadow-[0_4px_0_var(--color-amber-d)]"
        >
          {playing ? (
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" className="ml-1 h-6 w-6" fill="currentColor"><path d="M7 4.5v15l13-7.5z" /></svg>
          )}
        </button>
        <div className="flex-1">
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={time}
            aria-label="เลื่อนตำแหน่ง"
            onChange={(e) => {
              const t = Number(e.target.value);
              if (audioRef.current) audioRef.current.currentTime = t;
              setTime(t);
            }}
            className="w-full accent-amber-d"
          />
          <div className="flex justify-between text-sm text-ink-soft">
            <span>{formatDuration(time * 1000)}</span>
            <span>{formatDuration(duration * 1000)}</span>
          </div>
        </div>
        <button type="button" onClick={cycleSpeed} className="w-14 shrink-0 rounded-lg border border-line bg-white py-1 text-sm" aria-label="ความเร็ว">
          {SPEEDS[speed]}×
        </button>
      </div>

      <audio
        ref={audioRef}
        preload="none"
        src={`/api/audio/answer/${entry.answerId}?t=${token}`}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
      />

      {showTranscript && (
        <details open={queryHit} className="text-base">
          <summary className="cursor-pointer text-ink-soft">คำถอดความ</summary>
          <p className="mt-2 whitespace-pre-line">{entry.transcript}</p>
          <p className="mt-2 text-sm text-ink-soft">ถอดความอัตโนมัติ อาจไม่ตรงทุกคำ — เสียงคือต้นฉบับ</p>
        </details>
      )}
    </article>
  );
});
