/**
 * Server-side captcha token verification
 *
 * Consolidates Turnstile siteverify and ALTCHA HMAC verification
 * into a single function. Used by waitlist/signup and embed free-access routes.
 *
 * @see types.ts — CaptchaVerifyResult
 * @see config.ts — getCaptchaProvider()
 */

import { createHash } from 'node:crypto';
import { extractParams, verifySolution } from 'altcha-lib/v1';

import type { CaptchaProvider, CaptchaVerifyResult } from './types';
import { getCaptchaProvider } from './config';
import { consumeCaptchaNonce } from './nonce-store';

/**
 * Verify a captcha token server-side.
 *
 * @param token — the token/payload from the client widget
 * @param providerOverride — force a specific provider (useful for tests)
 * @returns CaptchaVerifyResult with success/error
 */
export async function verifyCaptchaToken(
  token: string | null | undefined,
  providerOverride?: CaptchaProvider,
): Promise<CaptchaVerifyResult> {
  const provider = providerOverride ?? getCaptchaProvider();

  // No captcha configured — fail-closed in production to prevent
  // magic-link bombing / signup spam. Dev mode skips for ergonomics.
  if (provider === 'none') {
    if (process.env.NODE_ENV === 'production') {
      console.error('[captcha] No captcha provider configured in production — rejecting request');
      return { success: false, error: 'Security verification unavailable' };
    }
    return { success: true };
  }

  if (!token) {
    return { success: false, error: 'Security verification required' };
  }

  if (provider === 'turnstile') {
    return verifyTurnstileToken(token);
  }

  if (provider === 'altcha') {
    return verifyAltchaPayload(token);
  }

  return { success: false, error: 'Unknown captcha provider' };
}

// ===== TURNSTILE VERIFICATION =====

async function verifyTurnstileToken(token: string): Promise<CaptchaVerifyResult> {
  const secret = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error('[captcha] CLOUDFLARE_TURNSTILE_SECRET_KEY is not set — rejecting request');
    return { success: false, error: 'Service misconfiguration. Please contact support.' };
  }

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(5000),
    });

    const result = await response.json();
    if (!result.success) {
      return { success: false, error: 'Security verification failed' };
    }

    return { success: true };
  } catch (error) {
    console.error('[captcha] Turnstile verification error:', error);
    return { success: false, error: 'Security verification failed' };
  }
}

// ===== ALTCHA VERIFICATION =====

async function verifyAltchaPayload(payload: string): Promise<CaptchaVerifyResult> {
  const hmacKey = process.env.ALTCHA_HMAC_KEY;
  if (!hmacKey) {
    console.error('[captcha] ALTCHA_HMAC_KEY is not set — rejecting request');
    return { success: false, error: 'Service misconfiguration. Please contact support.' };
  }

  try {
    const ok = await verifySolution(payload, hmacKey);
    if (!ok) {
      return { success: false, error: 'Security verification failed' };
    }

    // A solved payload is valid for the whole challenge TTL — without a
    // single-use check the same payload could be replayed any number of
    // times within that window. The signature already uniquely identifies
    // a solved challenge, so hash it into the nonce ledger key.
    let parsed: { signature?: string };
    try {
      parsed = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    } catch {
      return { success: false, error: 'Security verification failed' };
    }
    if (!parsed.signature) {
      return { success: false, error: 'Security verification failed' };
    }

    const params = extractParams(payload);
    const expiresEpoch = params.expires || params.expire;
    const expiresAt = expiresEpoch
      ? new Date(parseInt(expiresEpoch, 10) * 1000)
      : new Date(Date.now() + 30 * 60 * 1000);

    const nonceHash = createHash('sha256').update(parsed.signature).digest('hex');
    const consumed = await consumeCaptchaNonce(nonceHash, expiresAt);
    if (!consumed) {
      return { success: false, error: 'Security verification failed' };
    }

    return { success: true };
  } catch (error) {
    console.error('[captcha] ALTCHA verification error:', error);
    return { success: false, error: 'Security verification failed' };
  }
}
