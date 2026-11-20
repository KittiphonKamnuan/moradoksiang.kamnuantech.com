import type { Metadata } from 'next';
import { BookLoader } from './BookLoader';

export const metadata: Metadata = { title: 'สมุดชีวิต', robots: { index: false, follow: false } };

/** One static shell for every book link; the server checks the token and sets the title. */
export const dynamicParams = false;
export const generateStaticParams = () => [{ token: '_' }];

export default function BookPage() {
  return <BookLoader />;
}
