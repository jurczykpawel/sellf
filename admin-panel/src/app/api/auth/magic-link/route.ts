import { NextResponse } from 'next/server';

import { getLoginReturnPath } from '@/lib/auth/magic-link-redirect';
import { requestMagicLink } from '@/lib/auth/magic-link/request';
import { MAGIC_LINK_FLOWS } from '@/lib/auth/magic-link/types';
import type { MagicLinkErrorCode, MagicLinkFlow } from '@/lib/auth/magic-link/types';
import { readJsonBody, ApiPayloadTooLargeError } from '@/lib/api/body-limit';
import { isSafeRedirectUrl } from '@/lib/validations/redirect';

const ALLOWED_KEYS = new Set([
  'redirectTo',
  'email',
  'captchaToken',
  'flow',
  'productSlug',
  'locale',
  'couponCode',
  'successUrl',
  'customFieldValues',
]);

const PRODUCT_SLUG_REGEX = /^[a-zA-Z0-9_-]{1,100}$/;

interface ParsedRequest {
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

function badRequest(): NextResponse {
  return NextResponse.json({ ok: false, code: 'invalid_request' satisfies MagicLinkErrorCode }, { status: 400 });
}

function isFlow(value: unknown): value is MagicLinkFlow {
  return typeof value === 'string' && (MAGIC_LINK_FLOWS as readonly string[]).includes(value);
}

function parseBody(body: unknown): ParsedRequest | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;

  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) return null;
  }

  const { email, captchaToken, flow, productSlug, couponCode, successUrl, redirectTo, locale, customFieldValues } = record;
  if (redirectTo !== undefined && (typeof redirectTo !== 'string' || !getLoginReturnPath(redirectTo))) return null;

  if (typeof email !== 'string' || email.length === 0 || email.length > 254) return null;
  if (captchaToken !== undefined && captchaToken !== null && typeof captchaToken !== 'string') return null;
  if (!isFlow(flow)) return null;
  if (customFieldValues !== undefined && (flow !== 'free_product' || !customFieldValues || typeof customFieldValues !== 'object' || Array.isArray(customFieldValues) || Object.keys(customFieldValues).length > 20 || Object.values(customFieldValues).some(value => typeof value !== 'string' || value.length > 5000))) return null;
  if (locale !== undefined && locale !== 'en' && locale !== 'pl') return null;

  let parsedProductSlug: string | undefined;
  if (productSlug !== undefined) {
    if (typeof productSlug !== 'string' || !PRODUCT_SLUG_REGEX.test(productSlug)) return null;
    parsedProductSlug = productSlug;
  }

  let parsedCouponCode: string | undefined;
  if (couponCode !== undefined) {
    if (typeof couponCode !== 'string' || couponCode.length > 64) return null;
    parsedCouponCode = couponCode;
  }

  let parsedSuccessUrl: string | undefined;
  if (successUrl !== undefined) {
    if (typeof successUrl !== 'string' || successUrl.length > 2048 || !isSafeRedirectUrl(successUrl)) return null;
    parsedSuccessUrl = successUrl;
  }

  return {
    email,
    captchaToken: captchaToken as string | null | undefined,
    flow,
    ...(redirectTo ? { redirectTo: redirectTo as string } : {}),
    productSlug: parsedProductSlug,
    locale,
    couponCode: parsedCouponCode,
    successUrl: parsedSuccessUrl,
    ...(customFieldValues !== undefined ? { customFieldValues: customFieldValues as Record<string, string> } : {}),
  };
}

const STATUS_BY_CODE: Record<MagicLinkErrorCode, number> = {
  demo_mode: 403,
  invalid_request: 400,
  captcha_failed: 400,
  invalid_email: 400,
  rate_limited: 429,
  send_failed: 502,
};

export async function POST(request: Request) {
  const contentType = request.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    return NextResponse.json(
      { error: 'Content-Type must be application/json' },
      { status: 415 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await readJsonBody(request);
  } catch (err) {
    if (err instanceof ApiPayloadTooLargeError) {
      return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
    }
    return badRequest();
  }

  const parsed = parseBody(rawBody);
  if (!parsed) return badRequest();

  const result = await requestMagicLink({
    email: parsed.email,
    captchaToken: parsed.captchaToken,
    flow: parsed.flow,
    ...(parsed.redirectTo ? { redirectTo: parsed.redirectTo } : {}),
    productSlug: parsed.productSlug,
    ...(parsed.locale ? { locale: parsed.locale } : {}),
    couponCode: parsed.couponCode,
    successUrl: parsed.successUrl,
    customFieldValues: parsed.customFieldValues,
  });

  if (result.ok) return NextResponse.json({ ok: true });
  return NextResponse.json(result, { status: STATUS_BY_CODE[result.code] });
}
