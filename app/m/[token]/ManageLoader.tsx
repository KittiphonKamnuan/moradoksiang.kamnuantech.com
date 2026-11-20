'use client';

import { useEffect, useState } from 'react';
import { ErrorView, Loading, NotFoundView } from '@/components/PageState';
import { qrDataUrl, tokenFromPath } from '@/lib/client/page';
import type { ManageView } from '@/lib/types';
import { ManageClient } from './ManageClient';

type State = { kind: 'loading' } | { kind: 'missing' } | { kind: 'error' } | { kind: 'ready'; view: ManageView; qr: { record: string; book: string }; isNew: boolean };

export function ManageLoader() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/m/${encodeURIComponent(tokenFromPath())}`, { cache: 'no-store' }).catch(() => null);
      if (res?.status === 404) return setState({ kind: 'missing' });
      if (!res?.ok) return setState({ kind: 'error' });
      const view: ManageView = await res.json();
      const qr = { record: await qrDataUrl(view.links.record), book: await qrDataUrl(view.links.book) };
      setState({ kind: 'ready', view, qr, isNew: new URLSearchParams(window.location.search).get('new') === '1' });
    })();
  }, []);
  if (state.kind === 'loading') return <Loading />;
  if (state.kind === 'missing') return <NotFoundView />;
  if (state.kind === 'error') return <ErrorView />;
  return <ManageClient initial={state.view} qr={state.qr} isNew={state.isNew} />;
}
