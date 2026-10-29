import { nanoid } from 'nanoid';

/** capability-link token: 24 url-safe chars ≈ 143 bits of entropy */
export const newToken = () => nanoid(24);
export const newId = () => nanoid(16);

export function isValidToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{22,64}$/.test(value);
}
