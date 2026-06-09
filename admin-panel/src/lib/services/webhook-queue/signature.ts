import crypto from 'crypto';

/**
 * Outbound webhook signing — Stripe/Svix-style, replay-resistant and versioned.
 *
 * The signature covers BOTH the send timestamp and the raw body:
 *
 *   signedPayload = `${t}.${rawBody}`
 *   v1            = HMAC-SHA256(secret, signedPayload)  (lowercase hex)
 *   header        = `t=${t},v1=${v1}`                   (X-Sellf-Signature)
 *
 * Because `t` is inside the MAC, a replayed delivery can't have its timestamp
 * swapped — receivers reject anything outside a tolerance window. The `v1=`
 * prefix lets the algorithm rotate later without breaking receivers.
 */

export const WEBHOOK_SIGNATURE_VERSION = 'v1';

const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

/** Build the `X-Sellf-Signature` header value for a raw body. */
export function signWebhookPayload(
  secret: string,
  rawBody: string,
  signedAtSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const mac = crypto
    .createHmac('sha256', secret)
    .update(`${signedAtSeconds}.${rawBody}`)
    .digest('hex');
  return `t=${signedAtSeconds},${WEBHOOK_SIGNATURE_VERSION}=${mac}`;
}

/** Parse a `t=...,v1=...` header (order-independent; unknown keys ignored). */
export function parseWebhookSignatureHeader(header: string): { t: number | null; v1: string | null } {
  let t: number | null = null;
  let v1: string | null = null;
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 't' && /^\d+$/.test(value)) t = Number(value);
    else if (key === WEBHOOK_SIGNATURE_VERSION) v1 = value;
  }
  return { t, v1 };
}

/**
 * Reference verifier receivers can copy: recompute the MAC over `${t}.${rawBody}`,
 * constant-time compare, and reject signatures whose timestamp is outside the
 * tolerance window (replay protection).
 */
export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string,
  opts: { toleranceSeconds?: number; nowSeconds?: number } = {},
): boolean {
  const { t, v1 } = parseWebhookSignatureHeader(signatureHeader);
  if (t === null || !v1) return false;

  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - t) > tolerance) return false;

  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const providedBuf = Buffer.from(v1, 'hex');
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}
