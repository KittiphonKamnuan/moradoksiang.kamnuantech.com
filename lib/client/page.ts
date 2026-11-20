'use client';

import QRCode from 'qrcode';

/** Token pages are one prebuilt shell each; the real token is the last path segment. */
export const tokenFromPath = () => decodeURIComponent(window.location.pathname.split('/').filter(Boolean)[1] ?? '');

export const baseUrl = () => (process.env.NEXT_PUBLIC_BASE_URL || window.location.origin).replace(/\/$/, '');

export const qrDataUrl = (text: string) =>
  QRCode.toDataURL(text, { margin: 1, width: 360, color: { dark: '#3b2f25', light: '#fffdf8' } });
