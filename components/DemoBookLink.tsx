'use client';

import { useEffect, useState } from 'react';

/** The demo book token is runtime config (DEMO_BOOK_TOKEN), served by /api/config. */
export function DemoBookLink() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => setToken(c?.demoBookToken ?? null))
      .catch(() => {});
  }, []);
  if (!token) return null;
  return (
    <a href={`/b/${token}`} className="grid min-h-[64px] place-items-center rounded-2xl border-2 border-line bg-white px-8 font-display text-xl">
      ฟังสมุดชีวิตตัวอย่าง
    </a>
  );
}
