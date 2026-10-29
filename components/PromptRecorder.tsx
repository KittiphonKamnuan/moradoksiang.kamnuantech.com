'use client';

import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '@/lib/format';
import { extensionForMime, pickRecorderMime } from '@/lib/mime';

let sharedStream: MediaStream | null = null;
async function getStream() {
  if (sharedStream?.active) return sharedStream;
  sharedStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  return sharedStream;
}

/** Grandchild records their own voice asking one question. */
export function PromptRecorder({
  manageToken,
  questionId,
  hasAudio,
  onChange,
}: {
  manageToken: string;
  questionId: string;
  hasAudio: boolean;
  onChange: (hasAudio: boolean) => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'recording' | 'saving'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState('');
  const recRef = useRef<MediaRecorder | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => () => clearInterval(tickRef.current), []);

  async function start() {
    setError('');
    try {
      const stream = await getStream();
      const mime = pickRecorderMime((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => void upload(new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' }));
      rec.start(500);
      recRef.current = rec;
      const t0 = Date.now();
      setElapsed(0);
      tickRef.current = setInterval(() => setElapsed(Date.now() - t0), 250);
      setPhase('recording');
    } catch {
      setError('เปิดไมค์ไม่ได้ — กดอนุญาตไมโครโฟนในเบราว์เซอร์ก่อนนะครับ');
    }
  }

  function stop() {
    clearInterval(tickRef.current);
    setPhase('saving');
    recRef.current?.stop();
  }

  async function upload(blob: Blob) {
    const fd = new FormData();
    fd.append('mime', blob.type);
    fd.append('audio', blob, `prompt.${extensionForMime(blob.type)}`);
    const res = await fetch(`/api/m/${manageToken}/questions/${questionId}/audio`, { method: 'POST', body: fd });
    setPhase('idle');
    if (!res.ok) return setError('บันทึกเสียงไม่สำเร็จ ลองอัดใหม่นะครับ');
    setVersion((v) => v + 1);
    onChange(true);
  }

  async function remove() {
    await fetch(`/api/m/${manageToken}/questions/${questionId}/audio`, { method: 'DELETE' });
    onChange(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-base">
      {phase === 'recording' ? (
        <button type="button" onClick={stop} className="rounded-full bg-amber px-4 py-2 font-medium text-ink">
          ■ หยุด ({formatDuration(elapsed)})
        </button>
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={phase === 'saving'}
          className="rounded-full border-2 border-amber px-4 py-2 font-medium disabled:opacity-50"
        >
          {phase === 'saving' ? 'กำลังบันทึก…' : hasAudio ? '🎙 อัดใหม่' : '🎙 อัดเสียงถาม'}
        </button>
      )}
      {hasAudio && phase === 'idle' && (
        <>
          <audio controls preload="none" className="h-10 max-w-[14rem]" src={`/api/audio/prompt/${questionId}?t=${manageToken}&v=${version}`} />
          <button type="button" onClick={remove} className="text-ink-soft underline underline-offset-4">
            ลบเสียง
          </button>
        </>
      )}
      {!hasAudio && phase === 'idle' && <span className="text-ink-soft">(ยังไม่อัด จะใช้เสียงอ่านอัตโนมัติ)</span>}
      {error && <span className="w-full text-rose">{error}</span>}
    </div>
  );
}
