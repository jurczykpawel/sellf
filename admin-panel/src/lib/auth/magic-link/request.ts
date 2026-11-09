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
import { createAdminClient } from '@/lib/supabase/admin';
import { prepareFreeGrantRequest } from '@/lib/services/free-grant-context';

import { readBuyerEmailPolicy } from './buyer-email-policy';
import { deliverMagicLink } from './deliver';
import { queueAuthMailRetry } from './retry';
import type { AuthMailRetryKind } from './retry';
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
  customFieldValues?: Record<string, string>;
}

export interface SendTrustedMagicLinkInput {
  transactionalOnly?: boolean;
  freeGrant?: { productSlug: string; locale?: string; couponCode?: string; successUrl?: string; customFieldValues?: Record<string, string> };
  email: string;
  redirectTo: string;
  data?: Record<string, string | Record<string, string>>;
  /** Purchase mails the buyer must get even if the auth mailer refuses now: parked and retried by cron. */
  retry?: AuthMailRetryKind;
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
  if (input.retry === 'post_checkout' && input.data?.purchase_mail_pending === 'true') {
    const pending = await queueAuthMailRetry({ email: input.email.trim().toLowerCase(), redirectTo: input.redirectTo, data: input.data, kind: input.retry, code: 'send_failed' });
    return !pending.ok && pending.queued ? { ok: true } : pending;
  }
  if (input.data?.license_mail_managed === 'true' && await readBuyerEmailPolicy() === true) return { ok: true, skipped: true };
  if (input.transactionalOnly) {
    try {
      const enabled = await readBuyerEmailPolicy();
      if (enabled === null) throw new Error('Buyer email policy unavailable');
      if (!enabled) return { ok: true, skipped: true };
    } catch {
      return input.retry ? queueAuthMailRetry({ email: input.email.trim().toLowerCase(), redirectTo: input.redirectTo,
        data: input.data, kind: input.retry, code: 'send_failed' }) : { ok: false, code: 'send_failed' };
    }
  }
  const normalizedEmail = input.email.trim().toLowerCase();

  const emailAllowed = await checkRateLimitForIdentifier(
    'magic_link_email',
    5,
    1440,
    `email:${normalizedEmail}`,
  );
  if (!emailAllowed) return input.retry
    ? queueAuthMailRetry({ email: normalizedEmail, redirectTo: input.redirectTo, data: input.data, kind: input.retry, code: 'rate_limited' })
    : { ok: false, code: 'rate_limited' };

  let redirectTo = input.redirectTo;
  let data = input.data;
  if (input.freeGrant) {
    const prepared = await prepareFreeGrantRequest(createAdminClient(), normalizedEmail, input.freeGrant.productSlug, input.freeGrant.customFieldValues);
    if (!prepared.ok) return { ok: false, code: prepared.code, ...(prepared.fieldErrors ? { fieldErrors: prepared.fieldErrors } : {}) };
    redirectTo = buildFreeProductMagicLinkRedirect({ origin: getSellfBaseUrl(), ...input.freeGrant, grantRequestId: prepared.requestId });
    data = { ...data, purchase_product: prepared.productName };
  }
  const result = await deliverMagicLink({
    email: normalizedEmail,
    redirectTo,
    shouldCreateUser: true,
    transactionalOnly: input.transactionalOnly,
    data,
  });
  if (result.ok || !input.retry || (result.code !== 'rate_limited' && result.code !== 'send_failed')) return result;
  return queueAuthMailRetry({ email: normalizedEmail, redirectTo, data, kind: input.retry, code: result.code });
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
      data: { locale: input.locale === 'pl' ? 'pl' : 'en' },
    });
  }

  if (!input.productSlug) return { ok: false, code: 'invalid_request' };

  if (input.flow === 'free_product') {
    return sendTrustedMagicLink({
      freeGrant: { productSlug: input.productSlug, locale: input.locale, couponCode: input.couponCode, successUrl: input.successUrl, customFieldValues: input.customFieldValues },
      email: input.email,
      redirectTo: buildFreeProductMagicLinkRedirect({
        origin,
        productSlug: input.productSlug,
        locale: input.locale,
        couponCode: input.couponCode,
        successUrl: input.successUrl,
      }),
      data: { product_slug: input.productSlug, locale: input.locale === 'pl' ? 'pl' : 'en' },
    });

  }

  // flow === 'post_checkout' — the only mail a paying guest gets, so a refusal is retried by cron.
  return sendTrustedMagicLink({
    retry: 'post_checkout',
    data: { ...await eventMailForSlug(input.email, input.productSlug, input.locale), locale: input.locale === 'pl' ? 'pl' : 'en' },
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
