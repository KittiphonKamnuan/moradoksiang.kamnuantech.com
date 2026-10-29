import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '@/lib/ratelimit';

describe('createRateLimiter', () => {
  it('allows up to the limit within the window, then blocks', () => {
    const rl = createRateLimiter({ limit: 3, windowMs: 1000 });
    expect([0, 1, 2, 3].map((i) => rl.check('k', i))).toEqual([true, true, true, false]);
  });

  it('frees capacity after the window passes', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(rl.check('k', 0)).toBe(true);
    expect(rl.check('k', 500)).toBe(false);
    expect(rl.check('k', 1001)).toBe(true);
  });

  it('tracks keys independently', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(rl.check('a', 0)).toBe(true);
    expect(rl.check('b', 0)).toBe(true);
  });
});
