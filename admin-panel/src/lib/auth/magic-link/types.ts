/**
 * Shared types for the magic-link gateway. Safe for client-component import
 * (no server-only code here).
 */

export const MAGIC_LINK_FLOWS = ['login', 'free_product', 'post_checkout'] as const;
export type MagicLinkFlow = (typeof MAGIC_LINK_FLOWS)[number];

export type MagicLinkErrorCode =
  | 'invalid_request'
  | 'captcha_failed'
  | 'invalid_email'
  | 'rate_limited'
  | 'send_failed';

export type MagicLinkResult = { ok: true } | { ok: false; code: MagicLinkErrorCode };
