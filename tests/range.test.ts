import { describe, expect, it } from 'vitest';
import { parseRange } from '@/lib/range';

describe('parseRange', () => {
  const size = 1000;

  it('returns null when there is no Range header (send whole file)', () => {
    expect(parseRange(null, size)).toBeNull();
  });

  it('handles bytes=0- (Safari probe)', () => {
    expect(parseRange('bytes=0-', size)).toEqual({ start: 0, end: 999 });
  });

  it('handles bytes=0-1 (Safari first request)', () => {
    expect(parseRange('bytes=0-1', size)).toEqual({ start: 0, end: 1 });
  });

  it('clamps end beyond file size', () => {
    expect(parseRange('bytes=900-5000', size)).toEqual({ start: 900, end: 999 });
  });

  it('handles suffix ranges', () => {
    expect(parseRange('bytes=-100', size)).toEqual({ start: 900, end: 999 });
  });

  it('uses only the first of multiple ranges', () => {
    expect(parseRange('bytes=0-9, 20-29', size)).toEqual({ start: 0, end: 9 });
  });

  it('reports unsatisfiable ranges', () => {
    expect(parseRange('bytes=1000-', size)).toBe('unsatisfiable');
    expect(parseRange('bytes=50-10', size)).toBe('unsatisfiable');
  });

  it('ignores malformed headers', () => {
    expect(parseRange('items=0-1', size)).toBeNull();
    expect(parseRange('bytes=abc', size)).toBeNull();
  });
});
