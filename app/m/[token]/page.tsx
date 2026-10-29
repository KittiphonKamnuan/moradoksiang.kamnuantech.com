import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { manageView } from '@/lib/manage';
import { qrDataUrl } from '@/lib/qr';
import { getByManageToken } from '@/lib/repo';
import { ManageClient } from './ManageClient';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'จัดการสมุดชีวิต', robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ new?: string }> };

export default async function ManagePage({ params, searchParams }: Props) {
  const { token } = await params;
  if (!getByManageToken(getDb(), token)) notFound();
  const view = manageView(token);
  const qr = { record: await qrDataUrl(view.links.record), book: await qrDataUrl(view.links.book) };
  return <ManageClient initial={view} qr={qr} isNew={(await searchParams).new === '1'} />;
}
