'use client';

import { useEffect, useState } from 'react';
import { Loading } from '@/components/PageState';
import { tokenFromPath } from '@/lib/client/page';
import { InterviewClient } from './InterviewClient';

/** InterviewClient loads the session itself (and shows its own error state). */
export function RecordLoader() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => setToken(tokenFromPath()), []);
  return token ? <InterviewClient token={token} /> : <Loading />;
}
