import { describe, expect, it } from 'vitest';
import { fitWithin, MAX_PHOTO_PX } from '@/lib/image';

// server-side normalising (jpeg, ≤1024px, metadata stripped) is tested in server/tests/api.rs
describe('fitWithin (client-side resize before upload)', () => {
  it('scales the long side down to the limit, keeping aspect', () => {
    expect(fitWithin(4032, 3024, 1024)).toEqual({ width: 1024, height: 768 });
    expect(fitWithin(3024, 4032, 1024)).toEqual({ width: 768, height: 1024 });
  });
  it('never upscales', () => {
    expect(fitWithin(800, 600, 1024)).toEqual({ width: 800, height: 600 });
  });
  it('default limit is 1024', () => {
    expect(MAX_PHOTO_PX).toBe(1024);
  });
});
