/**
 * Server-side captcha token verification
 *
 * Consolidates Turnstile siteverify and ALTCHA HMAC verification
 * into a single function. Used by waitlist/signup and claim-free routes.
 *
 * @see types.ts — CaptchaVerifyResult
 * @see config.ts — getCaptchaProvider()
 */

import { verifySolution } from 'altcha-lib';

import type { CaptchaProvider, CaptchaVerifyResult } from './types';
import { getCaptchaProvider } from './config';

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

  // No captcha configured — skip verification (dev mode)
  if (provider === 'none') {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[captcha] No captcha provider configured in production — requests are unprotected');
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
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
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

    return { success: true };
  } catch (error) {
    console.error('[captcha] ALTCHA verification error:', error);
    return { success: false, error: 'Security verification failed' };
  }
}
