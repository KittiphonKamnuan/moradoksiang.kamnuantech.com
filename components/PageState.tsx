import Link from 'next/link';

export function Loading() {
  return <main className="grid min-h-dvh place-items-center text-xl text-ink-soft">กำลังโหลด…</main>;
}

export function NotFoundView() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 px-5 text-center">
      <p className="font-display text-6xl text-amber-d">404</p>
      <h1 className="font-display text-3xl">ไม่พบหน้านี้</h1>
      <p className="text-ink-soft">ลิงก์อาจพิมพ์ไม่ครบ หรือสมุดชีวิตนี้ถูกลบไปแล้ว ลองขอลิงก์ใหม่จากคนที่ส่งมานะครับ</p>
      <Link href="/" className="rounded-xl border-2 border-line bg-white px-5 py-2 font-medium">
        กลับหน้าแรก
      </Link>
    </main>
  );
}

export function ErrorView() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 px-5 text-center">
      <h1 className="font-display text-3xl">โหลดไม่สำเร็จ</h1>
      <p className="text-ink-soft">เน็ตอาจหลุดไปชั่วครู่ ลองโหลดหน้านี้ใหม่อีกครั้งนะครับ</p>
    </main>
  );
}
