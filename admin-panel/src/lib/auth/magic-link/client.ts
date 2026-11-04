import { readBrowserAttribution } from '@/lib/attribution/browser';
import type { MagicLinkErrorCode, MagicLinkFlow, MagicLinkResult } from './types';

export interface MagicLinkClientRequest {
  email: string;
  captchaToken: string | null;
  flow: MagicLinkFlow;
  redirectTo?: string;
  productSlug?: string;
  locale?: string;
  couponCode?: string | null;
  successUrl?: string | null;
  customFieldValues?: Record<string, string>;
}

const KNOWN_ERROR_CODES: readonly MagicLinkErrorCode[] = [
  'demo_mode',
  'invalid_request',
  'captcha_failed',
  'invalid_email',
  'rate_limited',
  'send_failed',
];

function isKnownErrorCode(code: unknown): code is MagicLinkErrorCode {
  return typeof code === 'string' && (KNOWN_ERROR_CODES as readonly string[]).includes(code);
}

function isFieldErrors(value: unknown): value is Record<string, string> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(entry => typeof entry === 'string');
}

export async function sendMagicLinkRequest(req: MagicLinkClientRequest): Promise<MagicLinkResult> {
  const body: Record<string, unknown> = {
    email: req.email,
    captchaToken: req.captchaToken,
    flow: req.flow,
  };
  if (req.locale != null) body.locale = req.locale;
  if (req.redirectTo != null) body.redirectTo = req.redirectTo;
  if (req.productSlug != null) body.productSlug = req.productSlug;
  if (req.couponCode != null) body.couponCode = req.couponCode;
  if (req.successUrl != null) body.successUrl = req.successUrl;
  if (req.customFieldValues !== undefined) body.customFieldValues = req.customFieldValues;
  // Free signup: the purchase source travels with the magic link request (@see lib/attribution).
  if (req.flow === 'free_product') {
    const attribution = readBrowserAttribution();
    if (attribution) body.attribution = attribution;
  }

  try {
    const response = await fetch('/api/auth/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await response.json();

    if (response.ok) return { ok: true };
    if (isKnownErrorCode(json?.code)) {
      const fieldErrors = isFieldErrors(json.fieldErrors) ? json.fieldErrors : undefined;
      return { ok: false, code: json.code, ...(fieldErrors ? { fieldErrors } : {}), ...(json.queued === true ? { queued: true as const } : {}) };
    }
    return { ok: false, code: 'send_failed' };
  } catch {
    return { ok: false, code: 'send_failed' };
  }
}
