import 'server-only';

import { validateEmailAction } from '@/lib/actions/validate-email';
import { verifyCaptchaToken } from '@/lib/captcha/verify';
import { getSellfBaseUrl } from '@/lib/embed/checkout-embed';
import {
  buildFreeProductMagicLinkRedirect,
  buildLoginMagicLinkRedirect,
  buildPostCheckoutMagicLinkRedirect,
} from '@/lib/auth/magic-link-redirect';
import { checkRateLimitForIdentifier } from '@/lib/rate-limiting';

import { deliverMagicLink } from './deliver';
import type { MagicLinkFlow, MagicLinkResult } from './types';

export interface MagicLinkRequestInput {
  email: string;
  captchaToken: string | null | undefined;
  flow: MagicLinkFlow;
  productSlug?: string;
  couponCode?: string;
  successUrl?: string;
  ip: string;
}

export async function requestMagicLink(input: MagicLinkRequestInput): Promise<MagicLinkResult> {
  const ipAllowed = await checkRateLimitForIdentifier(
    'magic_link_ip',
    5,
    15,
    `ip:${input.ip}`,
  );
  if (!ipAllowed) return { ok: false, code: 'rate_limited' };

  const captchaResult = await verifyCaptchaToken(input.captchaToken);
  if (!captchaResult.success) return { ok: false, code: 'captcha_failed' };

  const emailValidation = await validateEmailAction(input.email);
  if (!emailValidation.isValid) return { ok: false, code: 'invalid_email' };

  const normalizedEmail = input.email.trim().toLowerCase();
  const emailAllowed = await checkRateLimitForIdentifier(
    'magic_link_email',
    5,
    1440,
    `email:${normalizedEmail}`,
  );
  if (!emailAllowed) return { ok: false, code: 'rate_limited' };

  const origin = getSellfBaseUrl();

  if (input.flow === 'login') {
    return deliverMagicLink({
      email: input.email,
      redirectTo: buildLoginMagicLinkRedirect(origin),
      shouldCreateUser: true,
    });
  }

  if (!input.productSlug) return { ok: false, code: 'invalid_request' };

  if (input.flow === 'free_product') {
    return deliverMagicLink({
      email: input.email,
      redirectTo: buildFreeProductMagicLinkRedirect({
        origin,
        productSlug: input.productSlug,
        couponCode: input.couponCode,
        successUrl: input.successUrl,
      }),
      shouldCreateUser: true,
      data: { product_slug: input.productSlug },
    });
  }

  // flow === 'post_checkout'
  return deliverMagicLink({
    email: input.email,
    redirectTo: buildPostCheckoutMagicLinkRedirect({
      origin,
      productSlug: input.productSlug,
      sessionId: undefined,
      paymentIntentId: undefined,
    }),
    shouldCreateUser: true,
  });
}
