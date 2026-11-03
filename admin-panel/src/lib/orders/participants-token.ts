/** Signed buyer link to add participants after payment. @see ./transfer-token.ts */
import { createHmac, timingSafeEqual } from 'node:crypto';
const LIFETIME = 180 * 86400;
function signature(id: string, expires: number, secret: string): string {
  return createHmac('sha256', secret).update(`participants:v1:${id}:${expires}`).digest('base64url');
}
export function signParticipantsToken(id: string, now = Math.floor(Date.now() / 1000)): string {
  const secret = process.env.CHECKOUT_BINDING_SECRET;
  if (!secret) throw new Error('Checkout binding secret required');
  const expires = now + LIFETIME;
  return `${expires}.${signature(id, expires, secret)}`;
}
export function verifyParticipantsToken(token: string | undefined, id: string, now = Math.floor(Date.now() / 1000)): boolean {
  const secret = process.env.CHECKOUT_BINDING_SECRET;
  if (!secret || typeof token !== 'string' || !/^\d{1,12}\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const [expiry, mac] = token.split('.'), expires = Number(expiry);
  if (!Number.isSafeInteger(expires) || expires <= now || expires > now + LIFETIME) return false;
  try { return timingSafeEqual(Buffer.from(mac), Buffer.from(signature(id, expires, secret))); } catch { return false; }
}
export function buildParticipantsLink(id: string, locale: string, baseUrl: string, now = Math.floor(Date.now() / 1000)): { url: string; expiresAt: string } {
  return { url: `${baseUrl}/${locale === 'pl' ? 'pl' : 'en'}/order/${id}/participants?token=${signParticipantsToken(id, now)}`, expiresAt: new Date((now + LIFETIME) * 1000).toISOString() };
}
