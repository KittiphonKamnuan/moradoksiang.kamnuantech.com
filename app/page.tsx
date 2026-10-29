import Link from 'next/link';
import { Art } from '@/components/Art';

export const dynamic = 'force-dynamic';

const steps = [
  { title: 'หลานเตรียมคำถาม', body: 'เลือกจากชุดคำถามที่คัดมาแล้ว หรือเขียนเอง แล้วอัดเสียงตัวเองถาม ยายจะได้ยินเสียงหลาน ไม่ใช่เสียงหุ่นยนต์' },
  { title: 'ยายกดปุ่มเดียว แล้วเล่า', body: 'ระบบถามทีละข้อ ยายตอบด้วยเสียง จบข้อแล้วไปข้อต่อไปเอง ไม่ต้องพิมพ์ ไม่ต้องกดอะไรเยอะ' },
  { title: 'ได้สมุดชีวิตไว้ฟังตลอดไป', body: 'ทุกคำตอบเก็บเป็นตอน ๆ แบ่งตามบทชีวิต แชร์ให้ญาติเปิดฟังได้ทั้งบ้าน' },
];

const principles = [
  { k: 'เสียงจริง ไม่ใช่เสียงสังเคราะห์', v: 'ระบบเป็นแค่คนถามและคนจัดเก็บ ไม่แต่งเรื่องแทน สิ่งที่เก็บไว้คือเสียงจริงที่ AI สร้างแทนไม่ได้' },
  { k: 'หลานเป็นคนถาม', v: 'คำถามเป็นเสียงของหลานเอง เสียงสังเคราะห์ใช้เฉพาะตอนที่ยังไม่ได้อัด' },
  { k: 'เสียงอยู่ที่บ้าน', v: 'เซิร์ฟเวอร์ตั้งอยู่ที่บ้าน ไม่ส่งเสียงไปคลาวด์ของใคร การถอดความก็ทำในเครื่อง' },
];

export default function Home() {
  const demo = process.env.DEMO_BOOK_TOKEN;
  return (
    <main>
      <section className="relative isolate overflow-hidden">
        {/* mobile: full-bleed behind the text; desktop: right two-thirds, fading into the paper on the left */}
        <Art src="/art/hero.webp" className="!absolute inset-0 -z-10 lg:left-[30%]" imgClassName="object-[70%_30%] lg:object-[60%_18%]" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-paper/30 via-paper/70 to-paper lg:left-[30%] lg:bg-gradient-to-r lg:from-paper lg:via-paper/50 lg:to-transparent" />
        <div className="absolute inset-x-0 bottom-0 -z-10 hidden h-32 bg-gradient-to-b from-transparent to-paper lg:block" />
        <div className="mx-auto flex min-h-[78dvh] max-w-3xl flex-col items-start justify-end gap-6 px-5 pb-14 pt-24 lg:max-w-6xl lg:justify-center lg:pr-[50%]">
          <p className="flex items-center gap-2 rounded-full bg-paper/90 py-1 pl-1 pr-4 text-base text-ink-soft">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/art/logo-mark.png" alt="" className="h-8 w-8 rounded-full" />
            มรดกเสียง
          </p>
          <h1 className="font-display text-5xl leading-tight sm:text-6xl">เล่าให้หลานฟัง</h1>
          <p className="max-w-xl text-xl">
            ถ้าวันหนึ่งเราอยากได้ยินเสียงยายอีกครั้ง เรามีเสียงยายเก็บไว้กี่นาที?
            <br />
            เก็บเรื่องเล่าชีวิตด้วยเสียงจริงของคุณตาคุณยาย ผ่านการสัมภาษณ์ที่หลานเป็นคนถาม
          </p>
          <div className="flex w-full flex-col gap-3 sm:flex-row">
            <Link
              href="/new"
              className="grid min-h-[64px] place-items-center rounded-2xl bg-amber px-8 font-display text-2xl text-ink shadow-[0_6px_0_var(--color-amber-d)]"
            >
              เริ่มเก็บเรื่องเล่า
            </Link>
            {demo && (
              <Link href={`/b/${demo}`} className="grid min-h-[64px] place-items-center rounded-2xl border-2 border-line bg-white px-8 font-display text-xl">
                ฟังสมุดชีวิตตัวอย่าง
              </Link>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-5 py-14">
        <h2 className="mb-8 font-display text-3xl">ใช้ยังไง</h2>
        <ol className="grid gap-5 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="paper-card p-5">
              <p className="font-display text-4xl text-amber-d">{i + 1}</p>
              <h3 className="mt-2 font-display text-xl">{s.title}</h3>
              <p className="mt-2 text-ink-soft">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="bg-paper-d/60">
        <div className="mx-auto max-w-3xl px-5 py-14">
          <h2 className="mb-6 font-display text-3xl">สิ่งที่เรายึดไว้</h2>
          <dl className="space-y-5">
            {principles.map((p) => (
              <div key={p.k}>
                <dt className="font-display text-xl text-sage-d">{p.k}</dt>
                <dd className="text-ink-soft">{p.v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-8 text-base text-ink-soft">
            งานวิจัยพบว่าการได้ทบทวนและเล่าเรื่องชีวิต (life review) ช่วยเพิ่มคุณภาพชีวิตของผู้สูงอายุ แค่ได้เล่า ยายก็ได้ประโยชน์แล้ว
          </p>
        </div>
      </section>

      <footer className="mx-auto max-w-3xl px-5 py-10 text-base text-ink-soft">มรดกเสียง · YWC21 Web Programming · Re:Humanize the Web</footer>
    </main>
  );
}
