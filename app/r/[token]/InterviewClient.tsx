'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Art } from '@/components/Art';
import { BigButton } from '@/components/BigButton';
import { VoiceOrb } from '@/components/VoiceOrb';
import { AudioEngine, keepScreenOn } from '@/lib/client/audioEngine';
import { createIdbStore } from '@/lib/client/idbStore';
import { INTERVIEW_CONFIG } from '@/lib/config';
import { initialInterview, interviewReducer, type SessionQuestion } from '@/lib/interview';
import { extensionForMime } from '@/lib/mime';
import { CHAPTERS, type ChapterId } from '@/lib/questions';
import { lineText, type LineKey } from '@/lib/script';
import { SilenceDetector, estimateNoiseFloor } from '@/lib/silence';
import { classifyStatus, createUploadQueue, type UploadItem, type UploadQueue } from '@/lib/uploadQueue';

interface StorytellerInfo {
  id: string;
  hasIntroAudio: boolean;
  name: string;
  callName: string;
  creatorName: string | null;
  hasPhoto: boolean;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const localId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

async function sendItem(item: UploadItem) {
  const fd = new FormData();
  fd.append('questionId', item.questionId);
  if (item.skip || !item.blob) {
    fd.append('skip', '1');
  } else {
    fd.append('mime', item.mime ?? item.blob.type);
    fd.append('audio', item.blob, `answer.${extensionForMime(item.mime ?? item.blob.type)}`);
  }
  const res = await fetch(`/api/r/${item.recordToken}/answers`, { method: 'POST', body: fd });
  return classifyStatus(res.status);
}

export function InterviewClient({ token }: { token: string }) {
  const [state, dispatch] = useReducer(interviewReducer, initialInterview);
  const [info, setInfo] = useState<StorytellerInfo | null>(null);
  const [level, setLevel] = useState(0);
  const [pending, setPending] = useState(0);
  const [micOpen, setMicOpen] = useState(false);
  const [heard, setHeard] = useState(false);
  const [completed, setCompleted] = useState(false);
  /** the story line currently being spoken (shown instead of the question) */
  const [caption, setCaption] = useState<{ key: LineKey; text: string } | null>(null);

  const engineRef = useRef<AudioEngine | null>(null);
  const queueRef = useRef<UploadQueue | null>(null);
  const noiseRef = useRef(0);
  const repromptedRef = useRef(new Set<string>());
  const finishingRef = useRef(false);
  const startedRef = useRef(false);
  const releaseWakeRef = useRef<() => void>(() => {});
  const stateRef = useRef(state);
  stateRef.current = state;

  const question: SessionQuestion | undefined = state.questions[state.index];
  const call = info?.callName ?? '';
  const creator = info?.creatorName || 'หลาน';

  // ---- load session + resume any uploads left in IndexedDB ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/r/${token}`, { cache: 'no-store' });
      if (!res.ok) return dispatch({ type: 'ERROR', message: 'ไม่พบลิงก์นี้' });
      const data = await res.json();
      const store = await createIdbStore(token);
      const queuedIds = new Set((await store.all()).map((i) => i.questionId));
      const questions: SessionQuestion[] = data.questions.map((q: SessionQuestion) =>
        !q.answerStatus && queuedIds.has(q.id) ? { ...q, answerStatus: 'saved' } : q,
      );
      if (cancelled) return;
      const queue = createUploadQueue({ store, send: sendItem });
      queue.subscribe(setPending);
      queueRef.current = queue;
      setPending(await queue.pending());
      void queue.flush();
      setInfo(data.storyteller);
      const next = questions.findIndex((q) => !q.answerStatus);
      dispatch({ type: 'LOAD', questions, nextIndex: next === -1 ? questions.length : next });
    })().catch(() => dispatch({ type: 'ERROR', message: 'เชื่อมต่อไม่ได้ ลองใหม่อีกครั้งนะครับ' }));

    const onOnline = () => void queueRef.current?.flush();
    window.addEventListener('online', onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
      queueRef.current?.stop();
      engineRef.current?.close();
      releaseWakeRef.current();
    };
  }, [token]);

  // warn before closing while answers are still uploading
  useEffect(() => {
    if (!pending) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [pending]);

  // ---- the one tap that unlocks audio + mic ----
  const start = async () => {
    const engine = (engineRef.current ??= new AudioEngine());
    engine.unlock();
    dispatch({ type: 'START' });
    setHeard(false);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('unsupported');
      await engine.openMic();
    } catch {
      dispatch({ type: 'MIC_DENIED' });
      return;
    }
    startedRef.current = true;
    setMicOpen(true);
    releaseWakeRef.current = await keepScreenOn();
  };

  // ---- mic check: calibrate background noise, show the orb reacting ----
  useEffect(() => {
    if (state.phase !== 'micCheck' || !micOpen) return;
    const engine = engineRef.current!;
    const samples: number[] = [];
    const det = new SilenceDetector(0, { noSpeechRepromptMs: Infinity });
    let advance: ReturnType<typeof setTimeout> | undefined;
    const timer = setInterval(() => {
      const rms = engine.rms();
      if (samples.length < 15) samples.push(rms); // first ~1.5s, usually before anyone speaks
      setLevel(Math.min(1, rms / 0.08));
      if (det.update(rms, Date.now()).includes('speech-start')) {
        setHeard(true);
        advance = setTimeout(() => {
          noiseRef.current = estimateNoiseFloor(samples);
          dispatch({ type: 'MIC_READY' });
        }, INTERVIEW_CONFIG.micCheckSuccessMs);
      }
    }, 100);
    return () => {
      clearInterval(timer);
      clearTimeout(advance);
      noiseRef.current = estimateNoiseFloor(samples);
      setLevel(0);
    };
  }, [state.phase, micOpen]);

  // ---- ask: play the grandchild's recorded question, or Thai TTS ----
  useEffect(() => {
    if (state.phase !== 'asking' || !question) return;
    const engine = engineRef.current!;
    let cancelled = false;
    engine.cancelRecording();
    (async () => {
      await wait(INTERVIEW_CONFIG.pauseBeforeQuestionMs);
      for (const key of state.leadIn) {
        if (cancelled || !info) return;
        await speakLine(engine, key, info);
        await wait(INTERVIEW_CONFIG.pauseBetweenLinesMs);
      }
      if (cancelled) return;
      setCaption(null);
      if (question.hasPromptAudio) await engine.playUrl(`/api/audio/prompt/${question.id}?t=${token}`);
      else await engine.say(`/api/tts/${question.id}?t=${token}`, question.text);
      if (cancelled) return;
      await engine.ding();
      if (!cancelled) dispatch({ type: 'PROMPT_ENDED' });
    })();
    return () => {
      cancelled = true;
      engine.stopPlayback();
      setCaption(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.askCount]);

  /** grandchild's recorded intro if there is one, else the natural TTS voice, else the browser voice */
  async function speakLine(engine: AudioEngine, key: LineKey, who: StorytellerInfo) {
    const text = lineText(key, who) ?? '';
    setCaption({ key, text });
    if (key === 'intro' && who.hasIntroAudio && (await engine.playUrl(`/api/audio/intro/${who.id}?t=${token}`))) return;
    await engine.say(`/api/tts/line/${key}?t=${token}`, text);
  }

  const enqueue = useCallback(
    async (item: Omit<UploadItem, 'id' | 'recordToken' | 'createdAt'>) => {
      const queue = queueRef.current!;
      await queue.enqueue({ ...item, id: localId(), recordToken: token, createdAt: Date.now() });
      void queue.flush();
    },
    [token],
  );

  const finishAnswer = useCallback(async () => {
    const s = stateRef.current;
    if (finishingRef.current || s.phase !== 'listening') return;
    finishingRef.current = true;
    const q = s.questions[s.index];
    const blob = await engineRef.current!.stopRecording();
    if (blob && blob.size > 0) await enqueue({ questionId: q.id, blob, mime: blob.type });
    else await enqueue({ questionId: q.id, skip: true });
    dispatch({ type: 'FINISH_ANSWER' });
  }, [enqueue]);

  const skip = async () => {
    const s = stateRef.current;
    if (s.phase !== 'asking' && s.phase !== 'listening') return;
    finishingRef.current = true;
    engineRef.current?.cancelRecording();
    engineRef.current?.stopPlayback();
    await enqueue({ questionId: s.questions[s.index].id, skip: true });
    dispatch({ type: 'SKIP' });
  };

  const repeat = () => {
    engineRef.current?.cancelRecording();
    dispatch({ type: 'REPEAT' });
  };

  // ---- listen: record + silence detection ----
  useEffect(() => {
    if (state.phase !== 'listening' || !question) return;
    const engine = engineRef.current!;
    finishingRef.current = false;
    engine.startRecording();
    const det = new SilenceDetector(noiseRef.current, {
      ...INTERVIEW_CONFIG.silence,
      ...(repromptedRef.current.has(question.id) ? { noSpeechRepromptMs: Infinity } : {}),
    });
    const startedAt = Date.now();
    let warned = false;
    const timer = setInterval(() => {
      const rms = engine.rms();
      setLevel(Math.min(1, rms / (det.threshold * 4)));
      for (const e of det.update(rms, Date.now())) {
        if (e === 'reprompt') {
          repromptedRef.current.add(question.id);
          repeat();
        } else if (e === 'nudge') {
          dispatch({ type: 'NUDGE' });
          void engine.ding(0.05, 660);
        } else if (e === 'resume') {
          dispatch({ type: 'RESUME' });
        } else if (e === 'auto-end') {
          void finishAnswer();
        }
      }
      const elapsed = Date.now() - startedAt;
      if (!warned && elapsed > INTERVIEW_CONFIG.maxAnswerMs - INTERVIEW_CONFIG.nearLimitBeforeMs) {
        warned = true;
        dispatch({ type: 'NEAR_LIMIT' });
        void engine.ding(0.05, 520);
      }
      if (elapsed > INTERVIEW_CONFIG.maxAnswerMs) void finishAnswer();
    }, 100);
    return () => {
      clearInterval(timer);
      setLevel(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.askCount]);

  // ---- finished: release the mic, then mark complete once everything is uploaded ----
  useEffect(() => {
    if (state.phase !== 'finished' || !startedRef.current) return;
    const engine = engineRef.current;
    if (!engine) return;
    engineRef.current = null;
    engine.cancelRecording();
    void (async () => {
      if (info && state.leadIn.includes('outro')) {
        await wait(INTERVIEW_CONFIG.pauseBeforeQuestionMs);
        await speakLine(engine, 'outro', info);
        setCaption(null);
      }
      engine.close();
      releaseWakeRef.current();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  useEffect(() => {
    if (state.phase !== 'finished' || !startedRef.current) return;
    if (pending === 0 && !completed) {
      setCompleted(true);
      void fetch(`/api/r/${token}/complete`, { method: 'POST' });
    }
  }, [state.phase, pending, completed, token]);

  const captionChapter = caption?.key.startsWith('chapter-') ? (caption.key.slice('chapter-'.length) as ChapterId) : null;
  const inLeadIn = state.phase === 'asking' && !!caption;

  return (
    <main className="relative flex min-h-dvh flex-col">
      <Art src="/art/record-bg.webp" className="!fixed inset-0 -z-10 opacity-30" />
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-5 pb-8 pt-6 text-[22px]">
        {state.phase === 'loading' && <p className="m-auto text-ink-soft">กำลังเตรียม…</p>}

        {state.phase === 'welcome' && info && (
          <section className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
            {info.hasPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/photo?t=${token}`} alt="" className="h-44 w-44 rounded-full border-4 border-white object-cover shadow-lg" />
            ) : (
              <div className="grid bg-paper h-44 w-44 place-items-center rounded-full border-4 border-white shadow-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/art/logo-mark.png" alt="" className="w-3/5" />
            </div>
            )}
            <div className="space-y-3">
              <h1 className="font-display text-[34px] leading-tight">สวัสดีครับ{info.name}</h1>
              <p className="text-[24px]">
                {creator}อยากฟังเรื่องของ{call}ครับ
              </p>
              {state.resumed && <p className="text-ink-soft">มาเล่าต่อจากคราวก่อนกันนะครับ</p>}
            </div>
            <BigButton onClick={start} className="max-w-sm text-[28px]">
              เริ่มคุยกัน
            </BigButton>
            <p className="text-base text-ink-soft">ระบบจะถามทีละข้อ {call}ตอบด้วยเสียงได้เลย ไม่ต้องพิมพ์</p>
          </section>
        )}

        {state.phase === 'micCheck' && (
          <section className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
            <VoiceOrb level={level} active={micOpen} />
            {!micOpen ? (
              <p>ถ้าเครื่องถาม ให้แตะ “อนุญาต” นะครับ</p>
            ) : heard ? (
              <p className="font-display text-[30px]">ได้ยินเสียงแล้วครับ 😊</p>
            ) : (
              <p className="font-display text-[30px]">ลองพูดว่า “สวัสดี” หน่อยครับ</p>
            )}
            {micOpen && !heard && (
              <BigButton variant="secondary" className="max-w-sm" onClick={() => dispatch({ type: 'MIC_READY' })}>
                เริ่มเลย
              </BigButton>
            )}
          </section>
        )}

        {state.phase === 'micDenied' && (
          <section className="flex flex-1 flex-col justify-center gap-6">
            <h1 className="font-display text-[30px]">ยังได้ยินเสียง{call}ไม่ได้ครับ</h1>
            <p>เครื่องยังไม่อนุญาตให้เก็บเสียง ลองให้ลูกหลานช่วยตั้งค่าแบบนี้นะครับ</p>
            <div className="paper-card space-y-4 p-5 text-lg">
              <div>
                <p className="font-bold">iPhone / iPad (Safari)</p>
                <p>แตะปุ่ม “aA” ข้างช่องที่อยู่เว็บ → การตั้งค่าเว็บไซต์ → ไมโครโฟน → อนุญาต</p>
              </div>
              <div>
                <p className="font-bold">Android (Chrome)</p>
                <p>แตะรูปแม่กุญแจข้างช่องที่อยู่เว็บ → สิทธิ์ → ไมโครโฟน → อนุญาต</p>
              </div>
              <p className="text-ink-soft">ถ้าเปิดจากแอป LINE ให้กด “เปิดในเบราว์เซอร์” ก่อนนะครับ</p>
            </div>
            <BigButton onClick={start}>ลองอีกครั้ง</BigButton>
          </section>
        )}

        {(state.phase === 'asking' || state.phase === 'listening') && question && (
          <section className="flex flex-1 flex-col gap-6">
            <header className="flex items-center justify-between text-base text-ink-soft">
              <span>{CHAPTERS[question.chapter]?.title}</span>
              <span>
                ข้อ {state.index + 1} จาก {state.questions.length}
              </span>
            </header>
            {inLeadIn ? (
              <div className="space-y-4" aria-live="polite">
                {captionChapter && <Art src={CHAPTERS[captionChapter]?.art ?? ''} className="aspect-[16/9] w-full rounded-3xl" />}
                <p className="font-display text-[28px] leading-snug text-ink-soft sm:text-[32px]">{caption!.text}</p>
              </div>
            ) : (
              <h1 className="font-display text-[34px] leading-snug sm:text-[40px]">{question.text}</h1>
            )}
            <div className={`flex flex-1 flex-col items-center justify-center gap-4 ${inLeadIn ? 'hidden' : ''}`}>
              <VoiceOrb level={level} active={state.phase === 'listening'} />
              <p className="min-h-[2.5em] text-center" aria-live="polite">
                {state.phase === 'asking'
                  ? question.hasPromptAudio
                    ? `ฟัง${creator}ถามนะครับ…`
                    : 'ฟังคำถามนะครับ…'
                  : state.nearLimit
                    ? 'อีกสักครู่จะเก็บเรื่องนี้ไว้ก่อนนะครับ ถ้ายังเล่าไม่จบ เล่าต่อในข้อถัดไปได้เลย'
                    : state.nudged
                      ? `เล่าต่อไหมครับ ถ้าจบแล้วแตะปุ่ม “เล่าจบแล้ว” ได้เลย`
                      : 'กำลังฟังอยู่นะครับ…'}
              </p>
            </div>
            {inLeadIn ? (
              <div className="mt-auto text-center">
                <button type="button" onClick={repeat} className="px-4 py-3 text-lg text-ink-soft underline underline-offset-4">
                  ข้ามไปที่คำถามเลย
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <BigButton onClick={() => void finishAnswer()} disabled={state.phase !== 'listening'}>
                  เล่าจบแล้ว
                </BigButton>
                <div className="grid grid-cols-2 gap-3">
                  <BigButton variant="secondary" className="text-xl" onClick={repeat}>
                    ถามอีกที
                  </BigButton>
                  <BigButton variant="secondary" className="text-xl" onClick={() => void skip()}>
                    ข้ามข้อนี้
                  </BigButton>
                </div>
              </div>
            )}
          </section>
        )}

        {state.phase === 'finished' && (
          <section className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
            <Art src="/art/thanks.webp" className="aspect-square w-64 rounded-[2rem] shadow-lg" />
            <h1 className="font-display text-[34px]">ขอบคุณที่เล่าให้ฟังนะครับ</h1>
            {caption?.key === 'outro' && <p className="text-xl text-ink-soft">{caption.text}</p>}
            <p className="text-[24px]">
              {creator}จะได้ฟังเรื่องของ{call}แล้วครับ
            </p>
            <p className="text-lg text-ink-soft" aria-live="polite">
              {pending > 0 ? 'กำลังเก็บเสียงให้นะครับ… อย่าเพิ่งปิดหน้านี้' : 'เก็บเรื่องเล่าไว้เรียบร้อยแล้ว ✓'}
            </p>
          </section>
        )}

        {state.phase === 'error' && (
          <section className="flex flex-1 flex-col justify-center gap-6 text-center">
            <h1 className="font-display text-[30px]">{state.error ?? 'มีบางอย่างผิดพลาด'}</h1>
            <BigButton onClick={() => window.location.reload()}>ลองใหม่</BigButton>
          </section>
        )}

        {pending > 0 && state.phase !== 'finished' && (
          <p className="mt-4 text-center text-base text-ink-soft" aria-live="polite">
            กำลังเก็บเสียงให้นะครับ…
          </p>
        )}
      </div>
    </main>
  );
}
