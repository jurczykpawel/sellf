/** Time-limited instructions for one order. @see security/checkout-binding.ts */
import { createHmac, timingSafeEqual } from 'node:crypto';
const LIFETIME = 61 * 86400;
function signature(id: string, expires: number, secret: string): string {
  return createHmac('sha256', secret).update(`transfer:v1:${id}:${expires}`).digest('base64url');
}
export function createTransferTokenSigner(now = Math.floor(Date.now() / 1000)): (id: string) => string {
  const secret = process.env.CHECKOUT_BINDING_SECRET;
  if (!secret) throw new Error('Checkout binding secret required');
  const expires = now + LIFETIME;
  return id => `${expires}.${signature(id, expires, secret)}`;
}
export function signTransferToken(id: string, now = Math.floor(Date.now() / 1000)): string {
  return createTransferTokenSigner(now)(id);
}
export function verifyTransferToken(token: string | undefined, id: string, now = Math.floor(Date.now() / 1000)): boolean {
  if (!process.env.CHECKOUT_BINDING_SECRET) return false;
  if (typeof token !== 'string' || !/^\d{1,12}\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const [expiry, mac] = token.split('.'), expires = Number(expiry);
  if (!Number.isSafeInteger(expires) || expires <= now || expires > now + LIFETIME) return false;
  try { return timingSafeEqual(Buffer.from(mac), Buffer.from(signature(id, expires, process.env.CHECKOUT_BINDING_SECRET || ''))); } catch { return false; }
}
