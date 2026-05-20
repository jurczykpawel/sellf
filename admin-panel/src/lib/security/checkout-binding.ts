import { createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN_NAMESPACE = 'v1';

export interface CheckoutBindingPayload {
  stripeObjectId: string;
  userId: string | null;
  productId: string;
}

function getSecret(): Buffer {
  const raw = process.env.CHECKOUT_BINDING_SECRET;
  if (!raw) {
    throw new Error('CHECKOUT_BINDING_SECRET env var is not set');
  }
  return Buffer.from(raw, 'utf8');
}

function canonicalise(payload: CheckoutBindingPayload): string {
  const user = payload.userId ?? '';
  return `${TOKEN_NAMESPACE}|${payload.stripeObjectId}|${user}|${payload.productId}`;
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(token: string): Buffer | null {
  if (!token || /[^A-Za-z0-9_-]/.test(token)) return null;
  const padded = token + '='.repeat((4 - (token.length % 4)) % 4);
  const std = padded.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Buffer.from(std, 'base64');
  } catch {
    return null;
  }
}

export function signCheckoutBinding(payload: CheckoutBindingPayload): string {
  const mac = createHmac('sha256', getSecret()).update(canonicalise(payload)).digest();
  return base64UrlEncode(mac);
}

export function verifyCheckoutBinding(
  token: string | null | undefined,
  payload: CheckoutBindingPayload,
): boolean {
  if (!token) return false;
  const candidate = base64UrlDecode(token);
  if (!candidate) return false;
  let expected: Buffer;
  try {
    expected = createHmac('sha256', getSecret()).update(canonicalise(payload)).digest();
  } catch {
    return false;
  }
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}
