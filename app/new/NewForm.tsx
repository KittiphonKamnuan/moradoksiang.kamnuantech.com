'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BigButton } from '@/components/BigButton';
import { resizeImage } from '@/lib/client/resizeImage';
import { CHAPTERS, DEFAULT_QUESTION_IDS, QUESTION_BANK, renderQuestion } from '@/lib/questions';

const CALL_NAMES = ['ยาย', 'ตา', 'ย่า', 'ปู่', 'แม่', 'พ่อ'];
const input = 'w-full rounded-xl border-2 border-line bg-white px-4 py-3 text-lg focus:border-amber focus:outline-none';

export function NewForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [callName, setCallName] = useState('ยาย');
  const [creatorName, setCreatorName] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [custom, setCustom] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set(DEFAULT_QUESTION_IDS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const fd = new FormData();
    fd.append('name', name);
    fd.append('callName', callName);
    fd.append('creatorName', creatorName);
    if (photo) fd.append('photo', await resizeImage(photo), 'photo.jpg');
    if (custom) {
      fd.append('questions', JSON.stringify(QUESTION_BANK.filter((q) => picked.has(q.id)).map((q) => ({ chapter: q.chapter, text: q.text }))));
    }
    try {
      const res = await fetch('/api/storytellers', { method: 'POST', body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
      const { manageToken } = await res.json();
      router.push(`/m/${manageToken}?new=1`);
    } catch (err) {
      setError(err instanceof Error && err.message.includes('photo') ? 'ใช้รูปนี้ไม่ได้ ลองเลือกรูปอื่น (JPG, PNG หรือ WEBP)' : 'บันทึกไม่สำเร็จ ลองอีกครั้งนะครับ');
      setBusy(false);
    }
  }

  const preview = renderQuestion('พ่อกับแม่ของ{เรียก}เป็นคนแบบไหนครับ', callName || '…');

  return (
    <form onSubmit={submit} className="mt-8 space-y-8">
      <label className="block space-y-2">
        <span className="font-medium">ชื่อผู้เล่า</span>
        <input className={input} required maxLength={100} placeholder="เช่น คุณยายมาลี" value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <fieldset className="space-y-2">
        <legend className="font-medium">หลาน ๆ เรียกท่านว่าอะไร</legend>
        <div className="flex flex-wrap gap-2">
          {CALL_NAMES.map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => setCallName(c)}
              className={`rounded-full border-2 px-5 py-2 text-lg ${callName === c ? 'border-amber bg-amber/20' : 'border-line bg-white'}`}
            >
              {c}
            </button>
          ))}
        </div>
        <input className={input} required maxLength={30} value={callName} onChange={(e) => setCallName(e.target.value)} aria-label="คำเรียก" />
        <p className="text-base text-ink-soft">ตัวอย่างคำถาม: “{preview}”</p>
      </fieldset>

      <label className="block space-y-2">
        <span className="font-medium">ชื่อของคุณ (คนถาม)</span>
        <input className={input} maxLength={100} placeholder="เช่น ภูมิ" value={creatorName} onChange={(e) => setCreatorName(e.target.value)} />
      </label>

      <label className="block space-y-2">
        <span className="font-medium">รูปผู้เล่า (ไม่ใส่ก็ได้)</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" className="block text-base" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      </label>

      <fieldset className="space-y-3">
        <legend className="font-medium">คำถาม</legend>
        <label className="flex items-start gap-3">
          <input type="radio" className="mt-2 h-5 w-5 accent-amber-d" checked={!custom} onChange={() => setCustom(false)} />
          <span>
            ชุดเริ่มต้น 10 ข้อ <span className="text-ink-soft">— เรียงจากเรื่องเบา ๆ ไปเรื่องลึก มีเพลงกล่อมลูกคั่นกลาง จบด้วยข้อความถึงอนาคต</span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input type="radio" className="mt-2 h-5 w-5 accent-amber-d" checked={custom} onChange={() => setCustom(true)} />
          <span>เลือกเอง</span>
        </label>
        {custom && (
          <div className="paper-card max-h-[28rem] space-y-5 overflow-y-auto p-4">
            {(Object.keys(CHAPTERS) as (keyof typeof CHAPTERS)[])
              .filter((c) => c !== 'closing')
              .map((chapter) => (
                <div key={chapter}>
                  <p className="mb-2 font-display text-lg text-sage-d">{CHAPTERS[chapter].title}</p>
                  {QUESTION_BANK.filter((q) => q.chapter === chapter).map((q) => (
                    <label key={q.id} className="flex items-start gap-3 py-1 text-base">
                      <input type="checkbox" className="mt-1.5 h-5 w-5 accent-amber-d" checked={picked.has(q.id)} onChange={() => toggle(q.id)} />
                      <span>{renderQuestion(q.text, callName || '…')}</span>
                    </label>
                  ))}
                </div>
              ))}
            <p className="text-base text-ink-soft">
              ข้อปิดท้าย “มีเรื่องไหนที่{callName}อยากเล่า แต่หลานยังไม่ได้ถามไหมครับ” จะใส่ให้อัตโนมัติ · เพิ่มคำถามเองและเรียงลำดับได้ในหน้าถัดไป
            </p>
          </div>
        )}
      </fieldset>

      {error && <p className="rounded-xl bg-rose/15 px-4 py-3 text-ink">{error}</p>}
      <BigButton type="submit" disabled={busy || !name.trim() || !callName.trim() || (custom && picked.size === 0)}>
        {busy ? 'กำลังสร้าง…' : 'สร้างสมุดชีวิต'}
      </BigButton>
    </form>
  );
}
