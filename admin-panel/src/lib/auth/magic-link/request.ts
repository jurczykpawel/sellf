import 'server-only';

import { validateEmailAction } from '@/lib/actions/validate-email';
import { verifyCaptchaToken } from '@/lib/captcha/verify';
import { getSellfBaseUrl } from '@/lib/embed/checkout-embed';
import {
  buildFreeProductMagicLinkRedirect,
  buildLoginMagicLinkRedirect,
  buildPostCheckoutMagicLinkRedirect,
} from '@/lib/auth/magic-link-redirect';
import { checkRateLimit, checkRateLimitForIdentifier } from '@/lib/rate-limiting';
import { queuePendingFreeGrant } from '@/lib/services/pending-free-grants';

import { deliverMagicLink } from './deliver';
import type { MagicLinkFlow, MagicLinkResult } from './types';

export interface MagicLinkRequestInput {
  email: string;
  captchaToken: string | null | undefined;
  flow: MagicLinkFlow;
  productSlug?: string;
  couponCode?: string;
  successUrl?: string;
}

export interface SendTrustedMagicLinkInput {
  email: string;
  redirectTo: string;
  data?: Record<string, string>;
}

/**
 * Delivers a magic link for a caller that has already proven trust through
 * another mechanism (a completed Stripe payment, an already-passed captcha
 * check upstream). Still per-email rate limited — a URL carrying a trusted
 * flag can be reloaded any number of times, and this is the only thing
 * standing between that and inbox flooding.
 */
export async function sendTrustedMagicLink(input: SendTrustedMagicLinkInput): Promise<MagicLinkResult> {
  const normalizedEmail = input.email.trim().toLowerCase();

  const emailAllowed = await checkRateLimitForIdentifier(
    'magic_link_email',
    5,
    1440,
    `email:${normalizedEmail}`,
  );
  if (!emailAllowed) return { ok: false, code: 'rate_limited' };

  return deliverMagicLink({
    email: normalizedEmail,
    redirectTo: input.redirectTo,
    shouldCreateUser: true,
    data: input.data,
  });
}

export async function requestMagicLink(input: MagicLinkRequestInput): Promise<MagicLinkResult> {
  const ipAllowed = await checkRateLimit('magic_link_ip', 5, 15);
  if (!ipAllowed) return { ok: false, code: 'rate_limited' };

  const captchaResult = await verifyCaptchaToken(input.captchaToken);
  if (!captchaResult.success) return { ok: false, code: 'captcha_failed' };

  const emailValidation = await validateEmailAction(input.email);
  if (!emailValidation.isValid) return { ok: false, code: 'invalid_email' };

  const origin = getSellfBaseUrl();

  if (input.flow === 'login') {
    return sendTrustedMagicLink({
      email: input.email,
      redirectTo: buildLoginMagicLinkRedirect(origin),
    });
  }

  if (!input.productSlug) return { ok: false, code: 'invalid_request' };

  if (input.flow === 'free_product') {
    const result = await sendTrustedMagicLink({
      email: input.email,
      redirectTo: buildFreeProductMagicLinkRedirect({
        origin,
        productSlug: input.productSlug,
        couponCode: input.couponCode,
        successUrl: input.successUrl,
      }),
      data: { product_slug: input.productSlug },
    });
    // Remember the request on the account so any later sign-in grants it,
    // not only a click on this particular link.
    if (result.ok) await queuePendingFreeGrant(input.email.trim().toLowerCase(), input.productSlug);
    return result;
  }

  // flow === 'post_checkout'
  return sendTrustedMagicLink({
    email: input.email,
    redirectTo: buildPostCheckoutMagicLinkRedirect({
      origin,
      productSlug: input.productSlug,
      sessionId: undefined,
      paymentIntentId: undefined,
    }),
  });
}
