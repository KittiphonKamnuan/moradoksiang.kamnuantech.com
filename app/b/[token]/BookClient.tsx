'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Art } from '@/components/Art';
import { AudioCard, PLAY_EVENT, type ExternalPlayback } from '@/components/AudioCard';
import { CopyButton } from '@/components/CopyButton';
import { silentWavUrl } from '@/lib/client/audioEngine';
import { formatMinutesThai } from '@/lib/format';
import { CHAPTERS } from '@/lib/questions';
import type { BookEntry, getBook } from '@/lib/repo';

type Book = NonNullable<ReturnType<typeof getBook>>;

export function BookClient({ book, token, link, qr }: { book: Book; token: string; link: string; qr: string }) {
  const { storyteller, chapters } = book;
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState<number | null>(null);
  const [stage, setStage] = useState<'question' | 'answer'>('question');
  const playerRef = useRef<HTMLAudioElement>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());

  const all: BookEntry[] = useMemo(() => chapters.flatMap((c) => c.entries), [chapters]);
  const count = all.length;
  const hasTranscripts = all.some((e) => e.transcriptStatus === 'done' && e.transcript);

  const q = query.trim().toLowerCase();
  const matches = (e: BookEntry) =>
    !q || e.questionText.toLowerCase().includes(q) || !!e.transcript?.toLowerCase().includes(q) || !!e.title?.toLowerCase().includes(q);

  // ---- "เล่นทั้งเล่ม": one player for the whole book (iOS only lets an element play without a tap once it
  // has been unlocked by one). Question (grandchild's voice / TTS) -> answer -> next. The highlighted card
  // mirrors this player's state, so its time, seek bar and pause button move with it.
  const [ext, setExt] = useState({ time: 0, duration: 0, playing: false });

  useEffect(() => {
    if (current === null) return;
    const entry = all[current];
    const player = playerRef.current!;
    cardRefs.current.get(entry.answerId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: '__book__' }));
    setExt({ time: 0, duration: (entry.durationMs ?? 0) / 1000, playing: false });
    player.src =
      stage === 'answer'
        ? `/api/audio/answer/${entry.answerId}?t=${token}`
        : entry.hasPromptAudio
          ? `/api/audio/prompt/${entry.questionId}?t=${token}`
          : `/api/tts/${entry.questionId}?t=${token}`;
    // a missing clip fires onError -> skip ahead; only stop if the browser blocks playback
    void player.play().catch((e: DOMException) => e?.name === 'NotAllowedError' && setCurrent(null));
  }, [current, stage, all, token]);

  // follow the playhead every frame while the answer plays (Safari fires timeupdate irregularly)
  useEffect(() => {
    if (current === null || stage !== 'answer' || !ext.playing) return;
    let raf = 0;
    const tick = () => {
      const p = playerRef.current;
      if (p) setExt((x) => ({ ...x, time: p.currentTime, duration: Number.isFinite(p.duration) && p.duration > 0 ? p.duration : x.duration }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [current, stage, ext.playing]);

  // playing a card by hand stops "play whole book"
  useEffect(() => {
    const onPlay = (e: Event) => {
      if (current !== null && (e as CustomEvent).detail !== '__book__') {
        playerRef.current?.pause();
        setCurrent(null);
      }
    };
    window.addEventListener(PLAY_EVENT, onPlay);
    return () => window.removeEventListener(PLAY_EVENT, onPlay);
  }, [current]);

  const onEnded = () => {
    if (current === null) return;
    if (stage === 'question') return setStage('answer');
    if (current + 1 < all.length) {
      setStage('question');
      setCurrent(current + 1);
    } else setCurrent(null);
  };

  const playAll = () => {
    const player = playerRef.current!;
    if (current !== null) {
      player.pause();
      setCurrent(null);
      return;
    }
    // unlock the player inside the tap itself; the effect then swaps in the real clips
    player.src = silentWavUrl();
    void player.play().catch(() => {});
    setStage('question');
    setCurrent(0);
  };

  const external = (e: BookEntry): ExternalPlayback | undefined =>
    current !== null && stage === 'answer' && all[current]?.answerId === e.answerId
      ? {
          ...ext,
          toggle: () => {
            const p = playerRef.current!;
            if (p.paused) void p.play();
            else p.pause();
          },
          seek: (t) => {
            playerRef.current!.currentTime = t;
            setExt((x) => ({ ...x, time: t }));
          },
        }
      : undefined;

  return (
    <main className="pb-16">
      <header className="relative isolate overflow-hidden">
        <Art src="/art/book-cover.webp" className="!absolute inset-0 -z-10 opacity-60" imgClassName="object-[70%_50%]" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-paper/20 to-paper" />
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-5 px-5 pb-10 pt-16 text-center">
          {storyteller.hasPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/photo?t=${token}`} alt={storyteller.name} className="h-40 w-40 rounded-full border-4 border-white object-cover shadow-lg" />
          ) : (
            <div className="grid bg-paper h-40 w-40 place-items-center rounded-full border-4 border-white shadow-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/art/logo-mark.png" alt="" className="w-3/5" />
            </div>
          )}
          <p className="text-ink-soft">สมุดชีวิตของ</p>
          <h1 className="font-display text-4xl sm:text-5xl">{storyteller.name}</h1>
          {count > 0 && (
            <p className="text-ink-soft">
              {count} ตอน · ยาวรวม {formatMinutesThai(book.totalDurationMs)}
              {storyteller.creatorName && ` · ถามโดย ${storyteller.creatorName}`}
            </p>
          )}
          {count > 0 && (
            <button
              type="button"
              onClick={playAll}
              className="min-h-[56px] rounded-2xl bg-amber px-8 font-display text-xl text-ink shadow-[0_5px_0_var(--color-amber-d)]"
            >
              {current === null ? '▶ เล่นทั้งเล่ม' : '■ หยุดเล่นทั้งเล่ม'}
            </button>
          )}
        </div>
      </header>

      <audio
        ref={playerRef}
        onEnded={onEnded}
        onError={() => current !== null && onEnded()}
        onPlay={() => setExt((x) => ({ ...x, playing: true }))}
        onPause={() => setExt((x) => ({ ...x, playing: false }))}
        onLoadedMetadata={(e) => {
          const duration = e.currentTarget.duration; // read now: currentTarget is gone by the time the updater runs
          if (Number.isFinite(duration)) setExt((x) => ({ ...x, duration }));
        }}
        preload="none"
        className="hidden"
      />

      <div className="mx-auto max-w-2xl space-y-12 px-5">
        {count === 0 && (
          <p className="paper-card p-6 text-center">
            ยังไม่มีเรื่องเล่า ส่งลิงก์ให้{storyteller.callName}เริ่มเล่าได้เลย แล้วกลับมาฟังที่นี่นะครับ
          </p>
        )}

        {count > 1 && (
          <label className="block">
            <span className="sr-only">ค้นหา</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={hasTranscripts ? 'ค้นหาคำในเรื่องเล่า…' : 'ค้นหาคำถาม…'}
              className="w-full rounded-xl border-2 border-line bg-white px-4 py-3 text-lg focus:border-amber focus:outline-none"
            />
          </label>
        )}

        {chapters.map((c, ci) => {
          const entries = c.entries.filter(matches);
          if (!entries.length) return null;
          return (
            <section key={`${c.chapter}-${ci}`} className="space-y-5">
              <div className="relative overflow-hidden rounded-3xl">
                <Art src={CHAPTERS[c.chapter]?.art ?? ''} className="aspect-[16/7] w-full" />
                <div className="absolute inset-0 bg-gradient-to-t from-ink/60 to-transparent" />
                <h2 className="absolute bottom-4 left-5 font-display text-3xl text-white drop-shadow">{c.title}</h2>
              </div>
              {entries.map((e) => (
                <AudioCard
                  key={e.answerId}
                  entry={e}
                  token={token}
                  query={q}
                  highlight={current !== null && all[current]?.answerId === e.answerId}
                  external={external(e)}
                  ref={(el) => {
                    if (el) cardRefs.current.set(e.answerId, el);
                    else cardRefs.current.delete(e.answerId);
                  }}
                />
              ))}
            </section>
          );
        })}

        {q && !all.some(matches) && <p className="text-center text-ink-soft">ไม่พบ “{query}”</p>}

        <footer className="paper-card flex flex-col items-center gap-3 p-6 text-center">
          <p className="font-display text-xl">ส่งสมุดเล่มนี้ให้คนในครอบครัว</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR สมุดชีวิต" className="w-40 rounded-lg" />
          <CopyButton text={link} />
          <p className="flex items-center gap-2 text-sm text-ink-soft">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/art/logo-mark.png" alt="" className="h-6 w-6" />
            มรดกเสียง — เล่าให้หลานฟัง
          </p>
        </footer>
      </div>
    </main>
  );
}
