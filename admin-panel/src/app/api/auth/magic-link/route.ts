import { NextResponse } from 'next/server';

import { requestMagicLink } from '@/lib/auth/magic-link/request';
import { MAGIC_LINK_FLOWS } from '@/lib/auth/magic-link/types';
import type { MagicLinkErrorCode, MagicLinkFlow } from '@/lib/auth/magic-link/types';
import { getClientIp } from '@/lib/security/client-ip';

const ALLOWED_KEYS = new Set([
  'email',
  'captchaToken',
  'flow',
  'productSlug',
  'couponCode',
  'successUrl',
]);

const PRODUCT_SLUG_REGEX = /^[a-zA-Z0-9_-]{1,100}$/;

interface ParsedRequest {
  email: string;
  captchaToken: string | null | undefined;
  flow: MagicLinkFlow;
  productSlug?: string;
  couponCode?: string;
  successUrl?: string;
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

  const { email, captchaToken, flow, productSlug, couponCode, successUrl } = record;

  if (typeof email !== 'string' || email.length === 0 || email.length > 254) return null;
  if (captchaToken !== undefined && captchaToken !== null && typeof captchaToken !== 'string') return null;
  if (!isFlow(flow)) return null;

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
    if (typeof successUrl !== 'string' || successUrl.length > 2048) return null;
    parsedSuccessUrl = successUrl;
  }

  return {
    email,
    captchaToken: captchaToken as string | null | undefined,
    flow,
    productSlug: parsedProductSlug,
    couponCode: parsedCouponCode,
    successUrl: parsedSuccessUrl,
  };
}

const STATUS_BY_CODE: Record<MagicLinkErrorCode, number> = {
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
    rawBody = await request.json();
  } catch {
    return badRequest();
  }

  const parsed = parseBody(rawBody);
  if (!parsed) return badRequest();

  const result = await requestMagicLink({
    email: parsed.email,
    captchaToken: parsed.captchaToken,
    flow: parsed.flow,
    productSlug: parsed.productSlug,
    couponCode: parsed.couponCode,
    successUrl: parsed.successUrl,
    ip: getClientIp(request),
  });

  if (result.ok) return NextResponse.json({ ok: true });
  return NextResponse.json(result, { status: STATUS_BY_CODE[result.code] });
}
