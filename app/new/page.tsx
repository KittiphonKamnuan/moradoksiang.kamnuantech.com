import type { Metadata } from 'next';
import { NewForm } from './NewForm';

export const metadata: Metadata = { title: 'เริ่มเก็บเรื่องเล่า' };

export default function NewPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <h1 className="font-display text-4xl">เริ่มเก็บเรื่องเล่า</h1>
      <p className="mt-2 text-ink-soft">ใช้เวลาไม่ถึงนาที แก้ไขทีหลังได้ทุกอย่าง</p>
      <NewForm />
    </main>
  );
}
