/**
 * Shared types for the magic-link gateway. Safe for client-component import
 * (no server-only code here).
 */

export const MAGIC_LINK_FLOWS = ['login', 'free_product', 'post_checkout'] as const;
export type MagicLinkFlow = (typeof MAGIC_LINK_FLOWS)[number];

export type MagicLinkErrorCode =
  | 'demo_mode'
  | 'invalid_request'
  | 'captcha_failed'
  | 'invalid_email'
  | 'rate_limited'
  | 'send_failed';

/** `fieldErrors` maps a rejected custom checkout field to its error code (@see lib/validations/custom-checkout-fields.ts). */
/** `queued`: the auth mailer refused a purchase mail and cron will retry it (@see magic-link/retry.ts). */
export type MagicLinkResult = { ok: true; skipped?: true } | { ok: false; code: MagicLinkErrorCode; fieldErrors?: Record<string, string>; queued?: true };
