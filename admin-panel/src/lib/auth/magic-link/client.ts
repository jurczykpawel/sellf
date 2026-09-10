import type { MagicLinkErrorCode, MagicLinkFlow, MagicLinkResult } from './types';

export interface MagicLinkClientRequest {
  email: string;
  captchaToken: string | null;
  flow: MagicLinkFlow;
  productSlug?: string;
  couponCode?: string | null;
  successUrl?: string | null;
}

const KNOWN_ERROR_CODES: readonly MagicLinkErrorCode[] = [
  'invalid_request',
  'captcha_failed',
  'invalid_email',
  'rate_limited',
  'send_failed',
];

function isKnownErrorCode(code: unknown): code is MagicLinkErrorCode {
  return typeof code === 'string' && (KNOWN_ERROR_CODES as readonly string[]).includes(code);
}

export async function sendMagicLinkRequest(req: MagicLinkClientRequest): Promise<MagicLinkResult> {
  const body: Record<string, unknown> = {
    email: req.email,
    captchaToken: req.captchaToken,
    flow: req.flow,
  };
  if (req.productSlug != null) body.productSlug = req.productSlug;
  if (req.couponCode != null) body.couponCode = req.couponCode;
  if (req.successUrl != null) body.successUrl = req.successUrl;

  try {
    const response = await fetch('/api/auth/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await response.json();

    if (response.ok) return { ok: true };
    if (isKnownErrorCode(json?.code)) return { ok: false, code: json.code };
    return { ok: false, code: 'send_failed' };
  } catch {
    return { ok: false, code: 'send_failed' };
  }
}
