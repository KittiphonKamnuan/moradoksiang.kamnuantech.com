import { describe, expect, it } from 'vitest';
import { isValidToken, newId, newToken } from '@/lib/tokens';

describe('tokens', () => {
  it('newToken is url-safe and at least 22 chars', () => {
    const t = newToken();
    expect(t.length).toBeGreaterThanOrEqual(22);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('newToken is unique across many calls', () => {
    const set = new Set(Array.from({ length: 5000 }, () => newToken()));
    expect(set.size).toBe(5000);
  });

  it('newId is url-safe', () => {
    expect(newId()).toMatch(/^[A-Za-z0-9_-]{12,}$/);
  });

  it('isValidToken rejects short or unsafe input', () => {
    expect(isValidToken(newToken())).toBe(true);
    expect(isValidToken('short')).toBe(false);
    expect(isValidToken('../../etc/passwd-aaaaaaaaaaaaaaa')).toBe(false);
    expect(isValidToken(undefined)).toBe(false);
  });
});
