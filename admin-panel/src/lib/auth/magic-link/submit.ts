import { sendMagicLinkRequest } from './client';
import type { MagicLinkErrorCode, MagicLinkFlow } from './types';

/**
 * Minimal captcha-state contract this module needs — satisfied by both
 * `useCaptcha()` and the payment-status page's `useTurnstile()`.
 */
export interface MagicLinkSubmitCaptcha {
  token: string | null;
  reset: () => void;
}

export interface SubmitMagicLinkInput {
  email: string;
  captcha: MagicLinkSubmitCaptcha;
  flow: MagicLinkFlow;
  productSlug?: string;
  couponCode?: string | null;
  successUrl?: string | null;
}

export type MagicLinkSubmitResult =
  | { ok: true }
  | { ok: false; reason: 'captcha_missing' | MagicLinkErrorCode };

/**
 * Shared client-side submit step for the four magic-link forms: checks the
 * captcha token is present, calls the server gateway, and resets the captcha
 * on any failure (its token was consumed by the failed attempt). Email
 * validation is not duplicated here — the server gateway validates it.
 */
export async function submitMagicLink(input: SubmitMagicLinkInput): Promise<MagicLinkSubmitResult> {
  if (!input.captcha.token) {
    return { ok: false, reason: 'captcha_missing' };
  }

  const result = await sendMagicLinkRequest({
    email: input.email,
    captchaToken: input.captcha.token,
    flow: input.flow,
    productSlug: input.productSlug,
    couponCode: input.couponCode,
    successUrl: input.successUrl,
  });

  if (!result.ok) {
    input.captcha.reset();
    return { ok: false, reason: result.code };
  }

  return { ok: true };
}
