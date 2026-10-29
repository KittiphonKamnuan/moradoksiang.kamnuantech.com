'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { BigButton } from '@/components/BigButton';
import { CopyButton } from '@/components/CopyButton';
import { PromptRecorder } from '@/components/PromptRecorder';
import type { ManageView } from '@/lib/manage';
import { CHAPTERS, QUESTION_BANK, renderQuestion, type ChapterId } from '@/lib/questions';
import { lineText } from '@/lib/script';

type Draft = { key: string; id?: string; chapter: ChapterId; text: string; isClosing: boolean; hasPromptAudio: boolean };

const toDrafts = (qs: ManageView['questions']): Draft[] => qs.map((q) => ({ ...q, key: q.id }));
const input = 'w-full rounded-xl border-2 border-line bg-white px-3 py-2 text-lg focus:border-amber focus:outline-none';
const statusText = { draft: 'ยังไม่เริ่มเล่า', recording: 'กำลังเล่า', completed: 'เล่าจบแล้ว' } as const;

export function ManageClient({ initial, qr, isNew }: { initial: ManageView; qr: { record: string; book: string }; isNew: boolean }) {
  const router = useRouter();
  const token = initial.tokens.manage;
  const [info, setInfo] = useState(initial.storyteller);
  const [infoDirty, setInfoDirty] = useState(false);
  const [saved, setSaved] = useState<Draft[]>(() => toDrafts(initial.questions));
  const [drafts, setDrafts] = useState<Draft[]>(saved);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [showBank, setShowBank] = useState(false);

  const dirty = useMemo(() => JSON.stringify(drafts.map(({ hasPromptAudio, ...d }) => d)) !== JSON.stringify(saved.map(({ hasPromptAudio, ...d }) => d)), [drafts, saved]);
  const body = drafts.filter((d) => !d.isClosing);
  const closing = drafts.find((d) => d.isClosing);
  const call = info.callName || '…';

  const update = (key: string, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const move = (key: string, dir: -1 | 1) =>
    setDrafts((ds) => {
      const list = ds.filter((d) => !d.isClosing);
      const i = list.findIndex((d) => d.key === key);
      const j = i + dir;
      if (j < 0 || j >= list.length) return ds;
      [list[i], list[j]] = [list[j], list[i]];
      return [...list, ...ds.filter((d) => d.isClosing)];
    });
  const remove = (key: string) => setDrafts((ds) => ds.filter((d) => d.key !== key));
  const add = (chapter: ChapterId, text: string) =>
    setDrafts((ds) => [...ds.filter((d) => !d.isClosing), { key: `new-${Date.now()}-${Math.random()}`, chapter, text, isClosing: false, hasPromptAudio: false }, ...ds.filter((d) => d.isClosing)]);

  async function saveQuestions() {
    setBusy(true);
    const res = await fetch(`/api/m/${token}/questions`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questions: drafts.map(({ id, chapter, text, isClosing }) => ({ id, chapter, text, isClosing })) }),
    });
    setBusy(false);
    if (!res.ok) return setMsg('บันทึกไม่สำเร็จ');
    const view: ManageView = await res.json();
    const next = toDrafts(view.questions);
    setSaved(next);
    setDrafts(next);
    setMsg('บันทึกคำถามแล้ว ✓');
    setTimeout(() => setMsg(''), 2000);
  }

  async function saveInfo() {
    const res = await fetch(`/api/m/${token}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: info.name, callName: info.callName, creatorName: info.creatorName ?? '' }),
    });
    if (res.ok) setInfoDirty(false);
  }

  async function deleteAll() {
    if (!window.confirm(`ลบสมุดชีวิตของ${info.name} รวมเสียงทั้งหมด? ลบแล้วกู้คืนไม่ได้`)) return;
    const res = await fetch(`/api/m/${token}`, { method: 'DELETE' });
    if (res.ok) router.replace('/');
  }

  const setPromptFlag = (key: string, has: boolean) => {
    update(key, { hasPromptAudio: has });
    setSaved((ss) => ss.map((s) => (s.key === key ? { ...s, hasPromptAudio: has } : s)));
  };

  return (
    <main className="mx-auto max-w-3xl space-y-10 px-5 py-10">
      <header className="space-y-2">
        <p className="text-base text-ink-soft">
          หน้าจัดการ · สถานะ: {statusText[info.status]}
        </p>
        <h1 className="font-display text-4xl">สมุดชีวิตของ{info.name}</h1>
        {isNew && (
          <p className="rounded-xl bg-sage/20 px-4 py-3">
            สร้างเรียบร้อย! <b>เก็บลิงก์หน้านี้ไว้</b> (บุ๊กมาร์กหรือส่งให้ตัวเองในไลน์) — ไม่มีรหัสผ่าน ใครมีลิงก์นี้ก็แก้ไขได้
          </p>
        )}
      </header>

      <section className="grid gap-5 sm:grid-cols-2">
        <div className="paper-card space-y-3 p-5">
          <h2 className="font-display text-2xl">ลิงก์ให้{call}</h2>
          <p className="text-base text-ink-soft">เปิดบนมือถือ{call} แล้วกด “เริ่มคุยกัน” ครั้งเดียว</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr.record} alt="QR ลิงก์ให้ผู้เล่า" className="mx-auto w-48 rounded-lg" />
          <div className="flex flex-wrap gap-2">
            <CopyButton text={initial.links.record} />
            <Link href={`/r/${initial.tokens.record}`} className="rounded-xl border-2 border-line bg-white px-4 py-2 text-base font-medium" target="_blank">
              เปิดดู
            </Link>
          </div>
        </div>
        <div className="paper-card space-y-3 p-5">
          <h2 className="font-display text-2xl">สมุดชีวิต</h2>
          <p className="text-base text-ink-soft">ฟังอย่างเดียว แชร์ให้ญาติได้</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr.book} alt="QR ลิงก์สมุดชีวิต" className="mx-auto w-48 rounded-lg" />
          <div className="flex flex-wrap gap-2">
            <CopyButton text={initial.links.book} />
            <Link href={`/b/${initial.tokens.book}`} className="rounded-xl border-2 border-line bg-white px-4 py-2 text-base font-medium" target="_blank">
              เปิดดู
            </Link>
          </div>
        </div>
      </section>

      <section className="paper-card space-y-4 p-5">
        <h2 className="font-display text-2xl">ข้อมูลผู้เล่า</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1">
            <span className="text-base">ชื่อ</span>
            <input className={input} value={info.name} onChange={(e) => (setInfo({ ...info, name: e.target.value }), setInfoDirty(true))} />
          </label>
          <label className="space-y-1">
            <span className="text-base">คำเรียก</span>
            <input className={input} value={info.callName} onChange={(e) => (setInfo({ ...info, callName: e.target.value }), setInfoDirty(true))} />
          </label>
          <label className="space-y-1">
            <span className="text-base">ชื่อคนถาม</span>
            <input className={input} value={info.creatorName ?? ''} onChange={(e) => (setInfo({ ...info, creatorName: e.target.value }), setInfoDirty(true))} />
          </label>
        </div>
        {infoDirty && (
          <button type="button" onClick={saveInfo} className="rounded-xl bg-amber px-5 py-2 font-medium text-ink">
            บันทึกข้อมูล
          </button>
        )}
      </section>

      <section className="paper-card space-y-3 p-5">
        <h2 className="font-display text-2xl">ข้อความเปิดจาก{info.creatorName || 'หลาน'}</h2>
        <p className="text-base text-ink-soft">
          พอ{call}กด “เริ่มคุยกัน” จะได้ยินข้อความนี้ก่อนคำถามแรก อัดเสียงตัวเองทักทาย{call}ได้เลย เช่น “สวัสดีครับ{call} {info.creatorName || 'หลาน'}เองนะ
          วันนี้อยากฟังเรื่องของ{call}…” ถ้าไม่อัด ระบบจะอ่านบทเปิดนี้ให้แทน:
        </p>
        <blockquote className="border-l-4 border-line pl-4 text-base">{lineText('intro', { name: info.name, callName: call, creatorName: info.creatorName })}</blockquote>
        <PromptRecorder
          uploadUrl={`/api/m/${token}/intro`}
          audioUrl={`/api/audio/intro/${initial.storytellerId}?t=${token}`}
          hasAudio={info.hasIntroAudio}
          onChange={(h) => setInfo((i) => ({ ...i, hasIntroAudio: h }))}
          label="อัดข้อความเปิด"
        />
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl">คำถาม ({drafts.length} ข้อ)</h2>
            <p className="text-base text-ink-soft">
              ใช้ <code className="rounded bg-paper-d px-1">{'{เรียก}'}</code> แทนคำเรียก · อัดเสียงตัวเองถามได้ทีละข้อ
            </p>
          </div>
        </div>

        <ol className="space-y-3">
          {body.map((d, i) => (
            <li key={d.key} className="paper-card space-y-3 p-4">
              <div className="flex items-center justify-between gap-2 text-base text-ink-soft">
                <span>
                  ข้อ {i + 1} ·{' '}
                  <select value={d.chapter} onChange={(e) => update(d.key, { chapter: e.target.value as ChapterId })} className="rounded border border-line bg-white px-1">
                    {(Object.keys(CHAPTERS) as ChapterId[])
                      .filter((c) => c !== 'closing')
                      .map((c) => (
                        <option key={c} value={c}>
                          {CHAPTERS[c].title}
                        </option>
                      ))}
                  </select>
                </span>
                <span className="flex gap-1">
                  <button type="button" aria-label="เลื่อนขึ้น" onClick={() => move(d.key, -1)} disabled={i === 0} className="h-10 w-10 rounded-lg border border-line bg-white disabled:opacity-30">
                    ↑
                  </button>
                  <button type="button" aria-label="เลื่อนลง" onClick={() => move(d.key, 1)} disabled={i === body.length - 1} className="h-10 w-10 rounded-lg border border-line bg-white disabled:opacity-30">
                    ↓
                  </button>
                  <button type="button" aria-label="ลบคำถาม" onClick={() => remove(d.key)} className="h-10 w-10 rounded-lg border border-line bg-white">
                    ✕
                  </button>
                </span>
              </div>
              <textarea className={input} rows={2} value={d.text} maxLength={300} onChange={(e) => update(d.key, { text: e.target.value })} />
              {d.text.includes('{เรียก}') && <p className="text-base text-ink-soft">“{renderQuestion(d.text, call)}”</p>}
              {d.id && !dirty ? (
                <PromptRecorder
                  uploadUrl={`/api/m/${token}/questions/${d.id}/audio`}
                  audioUrl={`/api/audio/prompt/${d.id}?t=${token}`}
                  hasAudio={d.hasPromptAudio}
                  onChange={(h) => setPromptFlag(d.key, h)}
                />
              ) : (
                <p className="text-base text-ink-soft">บันทึกคำถามก่อน แล้วจึงอัดเสียงถามได้</p>
              )}
            </li>
          ))}
          {closing && (
            <li className="paper-card space-y-3 border-dashed p-4">
              <p className="text-base text-ink-soft">ข้อปิดท้าย (ถามเสมอ)</p>
              <textarea className={input} rows={2} value={closing.text} maxLength={300} onChange={(e) => update(closing.key, { text: e.target.value })} />
              {closing.id && !dirty && (
                <PromptRecorder
                  uploadUrl={`/api/m/${token}/questions/${closing.id}/audio`}
                  audioUrl={`/api/audio/prompt/${closing.id}?t=${token}`}
                  hasAudio={closing.hasPromptAudio}
                  onChange={(h) => setPromptFlag(closing.key, h)}
                />
              )}
            </li>
          )}
        </ol>

        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => add('life', '')} className="rounded-xl border-2 border-line bg-white px-4 py-2 font-medium">
            + เขียนคำถามเอง
          </button>
          <button type="button" onClick={() => setShowBank((v) => !v)} className="rounded-xl border-2 border-line bg-white px-4 py-2 font-medium">
            {showBank ? 'ปิดคลังคำถาม' : '+ เลือกจากคลังคำถาม'}
          </button>
        </div>

        {showBank && (
          <div className="paper-card max-h-96 space-y-4 overflow-y-auto p-4">
            {(Object.keys(CHAPTERS) as ChapterId[])
              .filter((c) => c !== 'closing')
              .map((c) => (
                <div key={c}>
                  <p className="font-display text-lg text-sage-d">{CHAPTERS[c].title}</p>
                  {QUESTION_BANK.filter((q) => q.chapter === c).map((q) => {
                    const used = drafts.some((d) => d.text === q.text);
                    return (
                      <button
                        type="button"
                        key={q.id}
                        disabled={used}
                        onClick={() => add(q.chapter, q.text)}
                        className="block w-full rounded-lg px-2 py-1.5 text-left text-base hover:bg-paper-d disabled:opacity-40"
                      >
                        {used ? '✓ ' : '+ '}
                        {renderQuestion(q.text, call)}
                      </button>
                    );
                  })}
                </div>
              ))}
          </div>
        )}

        <div className="sticky bottom-3 z-10">
          {(dirty || msg) && (
            <BigButton onClick={saveQuestions} disabled={busy || !dirty}>
              {msg || (busy ? 'กำลังบันทึก…' : 'บันทึกคำถาม')}
            </BigButton>
          )}
        </div>
      </section>

      <section className="space-y-3 border-t border-line pt-8">
        <h2 className="font-display text-xl">ลบข้อมูล</h2>
        <p className="text-base text-ink-soft">ลบผู้เล่า คำถาม และไฟล์เสียงทั้งหมดออกจากเซิร์ฟเวอร์ถาวร</p>
        <button type="button" onClick={deleteAll} className="rounded-xl border-2 border-rose px-4 py-2 font-medium text-ink">
          ลบข้อมูลทั้งหมด
        </button>
      </section>
    </main>
  );
}
