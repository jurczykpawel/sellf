import 'server-only';

import { eventMailForSlug } from '@/lib/events/mail';
import { isDemoMode } from '@/lib/demo-guard';
import { validateEmailAction } from '@/lib/actions/validate-email';
import { verifyCaptchaToken } from '@/lib/captcha/verify';
import { getSellfBaseUrl } from '@/lib/embed/checkout-embed';
import {
  buildFreeProductMagicLinkRedirect,
  buildLoginMagicLinkRedirect,
  buildPostCheckoutMagicLinkRedirect,
  getLoginReturnPath,
} from '@/lib/auth/magic-link-redirect';
import { checkRateLimit, checkRateLimitForIdentifier } from '@/lib/rate-limiting';
import { queuePendingFreeGrant } from '@/lib/services/pending-free-grants';

import { deliverMagicLink } from './deliver';
import type { MagicLinkFlow, MagicLinkResult } from './types';

export interface MagicLinkRequestInput {
  email: string;
  captchaToken: string | null | undefined;
  flow: MagicLinkFlow;
  redirectTo?: string;
  productSlug?: string;
  locale?: string;
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
  if (isDemoMode()) return { ok: false, code: 'demo_mode' };
  // Templates append &token_hash: require our absolute, same-instance callback
  // with a query before asking Supabase to deliver it. The operator must also
  // allow SITE_URL/auth/callback in Supabase Auth's redirect URL configuration.
  try {
    const redirect = new URL(input.redirectTo);
    const returnPaths = redirect.searchParams.getAll('redirect_to');
    if (returnPaths.length > 1 || (returnPaths.length === 1 && !getLoginReturnPath(returnPaths[0]))) {
      return { ok: false, code: 'invalid_request' };
    }
    if (redirect.origin !== getSellfBaseUrl() || redirect.pathname !== '/auth/callback' || !redirect.search) {
      return { ok: false, code: 'invalid_request' };
    }
  } catch {
    return { ok: false, code: 'invalid_request' };
  }
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
  if (isDemoMode()) return { ok: false, code: 'demo_mode' };
  if (input.redirectTo !== undefined && !getLoginReturnPath(input.redirectTo)) return { ok: false, code: 'invalid_request' };
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
      redirectTo: buildLoginMagicLinkRedirect(origin, input.redirectTo),
    });
  }

  if (!input.productSlug) return { ok: false, code: 'invalid_request' };

  if (input.flow === 'free_product') {
    const result = await sendTrustedMagicLink({
      email: input.email,
      redirectTo: buildFreeProductMagicLinkRedirect({
        origin,
        productSlug: input.productSlug,
        locale: input.locale,
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
    data: await eventMailForSlug(input.email, input.productSlug),
    email: input.email,
    redirectTo: buildPostCheckoutMagicLinkRedirect({
      origin,
      productSlug: input.productSlug,
      locale: input.locale,
      sessionId: undefined,
      paymentIntentId: undefined,
    }),
  });
}
