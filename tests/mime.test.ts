import { describe, expect, it } from 'vitest';
import { RECORDER_MIME_CANDIDATES, extensionForMime, isAllowedUploadMime, pickRecorderMime } from '@/lib/mime';

describe('pickRecorderMime', () => {
  it('prefers webm/opus (Chrome, Android, Firefox)', () => {
    expect(pickRecorderMime(() => true)).toBe('audio/webm;codecs=opus');
  });

  it('falls back to audio/mp4 on iOS Safari', () => {
    expect(pickRecorderMime((t) => t === 'audio/mp4')).toBe('audio/mp4');
  });

  it('returns empty string when nothing is supported (let browser choose)', () => {
    expect(pickRecorderMime(() => false)).toBe('');
  });

  it('tries candidates in the documented order', () => {
    expect(RECORDER_MIME_CANDIDATES).toEqual(['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']);
  });
});

describe('extensionForMime', () => {
  it.each([
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/mp4', 'mp4'],
    ['audio/x-m4a', 'm4a'],
    ['audio/ogg; codecs=opus', 'ogg'],
    ['audio/mpeg', 'mp3'],
    ['audio/wav', 'wav'],
    ['application/octet-stream', 'bin'],
    ['', 'bin'],
  ])('%s -> %s', (mime, ext) => {
    expect(extensionForMime(mime)).toBe(ext);
  });
});

describe('isAllowedUploadMime', () => {
  it('accepts common recorder outputs, with or without codec params', () => {
    for (const m of ['audio/webm', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg; codecs=opus', 'audio/x-m4a', 'audio/mpeg', 'audio/wav']) {
      expect(isAllowedUploadMime(m)).toBe(true);
    }
  });

  it('rejects non-audio types', () => {
    for (const m of ['video/mp4', 'text/html', 'image/png', '', 'application/octet-stream']) {
      expect(isAllowedUploadMime(m)).toBe(false);
    }
  });
});
