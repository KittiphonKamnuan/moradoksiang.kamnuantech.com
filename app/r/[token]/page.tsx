import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { getByRecordToken } from '@/lib/repo';
import { InterviewClient } from './InterviewClient';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const s = getByRecordToken(getDb(), (await params).token);
  return { title: s ? `เล่าให้${s.creatorName ?? 'หลาน'}ฟัง` : 'ไม่พบลิงก์', robots: { index: false, follow: false } };
}

export default async function RecordPage({ params }: Props) {
  const { token } = await params;
  if (!getByRecordToken(getDb(), token)) notFound();
  return <InterviewClient token={token} />;
}
