'use client';

import { useState } from 'react';

export function CopyButton({ text, label = 'คัดลอกลิงก์' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="rounded-xl border-2 border-line bg-white px-4 py-2 text-base font-medium hover:border-amber"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          window.prompt('คัดลอกลิงก์นี้', text);
        }
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
    >
      {done ? 'คัดลอกแล้ว ✓' : label}
    </button>
  );
}
