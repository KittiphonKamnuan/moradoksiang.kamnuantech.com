import type { Metadata } from 'next';
import { RecordLoader } from './RecordLoader';

export const metadata: Metadata = { title: 'เล่าให้หลานฟัง', robots: { index: false, follow: false } };

/** One static shell for every record link; the server checks the token and sets the title. */
export const dynamicParams = false;
export const generateStaticParams = () => [{ token: '_' }];

export default function RecordPage() {
  return <RecordLoader />;
}
