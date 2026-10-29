import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { linksFor } from '@/lib/http';
import { qrDataUrl } from '@/lib/qr';
import { getBook, getByBookToken } from '@/lib/repo';
import { BookClient } from './BookClient';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const s = getByBookToken(getDb(), (await params).token);
  return { title: s ? `สมุดชีวิตของ${s.name}` : 'ไม่พบสมุดชีวิต', robots: { index: false, follow: false } };
}

export default async function BookPage({ params }: Props) {
  const { token } = await params;
  const s = getByBookToken(getDb(), token);
  const book = getBook(getDb(), token);
  if (!s || !book) notFound();
  const link = linksFor(s).book;
  return <BookClient book={book} token={token} link={link} qr={await qrDataUrl(link)} />;
}
