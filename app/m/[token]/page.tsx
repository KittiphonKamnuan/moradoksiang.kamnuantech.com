import type { Metadata } from 'next';
import { ManageLoader } from './ManageLoader';

export const metadata: Metadata = { title: 'จัดการสมุดชีวิต', robots: { index: false, follow: false } };

/** One static shell for every manage link; the server checks the token (server/src/pages.rs). */
export const dynamicParams = false;
export const generateStaticParams = () => [{ token: '_' }];

export default function ManagePage() {
  return <ManageLoader />;
}
