'use client';

import { useEffect, useState } from 'react';
import { ErrorView, Loading, NotFoundView } from '@/components/PageState';
import { baseUrl, qrDataUrl, tokenFromPath } from '@/lib/client/page';
import type { Book } from '@/lib/types';
import { BookClient } from './BookClient';

type State = { kind: 'loading' } | { kind: 'missing' } | { kind: 'error' } | { kind: 'ready'; book: Book; token: string; link: string; qr: string };

export function BookLoader() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  useEffect(() => {
    (async () => {
      const token = tokenFromPath();
      const res = await fetch(`/api/b/${encodeURIComponent(token)}`, { cache: 'no-store' }).catch(() => null);
      if (res?.status === 404) return setState({ kind: 'missing' });
      if (!res?.ok) return setState({ kind: 'error' });
      const book: Book = await res.json();
      document.title = `สมุดชีวิตของ${book.storyteller.name} · มรดกเสียง`;
      const link = `${baseUrl()}/b/${token}`;
      setState({ kind: 'ready', book, token, link, qr: await qrDataUrl(link) });
    })();
  }, []);
  if (state.kind === 'loading') return <Loading />;
  if (state.kind === 'missing') return <NotFoundView />;
  if (state.kind === 'error') return <ErrorView />;
  return <BookClient book={state.book} token={state.token} link={state.link} qr={state.qr} />;
}
