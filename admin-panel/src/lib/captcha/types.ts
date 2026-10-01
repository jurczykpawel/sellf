/**
 * Captcha provider abstraction types
 *
 * Supports Turnstile (Cloudflare) and ALTCHA (self-hosted proof-of-work).
 * Provider is selected based on environment variables — see config.ts.
 *
 * @see config.ts — provider detection logic
 * @see verify.ts — server-side token verification
 */

/** Supported captcha providers */
export type CaptchaProvider = 'turnstile' | 'altcha' | 'none';

/** Single source of truth for captcha runtime config shared across server, client, and embed loader. */
export interface CaptchaConfig {
  provider: CaptchaProvider;
  siteKey: string | null;
  scriptUrl: string | null;
  /** Subresource Integrity hash for scriptUrl, when the CDN asset is version-pinned (e.g. ALTCHA). Null when not applicable (e.g. Turnstile, which Cloudflare doesn't publish a stable hash for). */
  scriptIntegrity: string | null;
  widgetTag: string | null;
  challengeUrl: string | null;
}

/** Result of server-side captcha token verification */
export interface CaptchaVerifyResult {
  success: boolean;
  error?: string;
}

/** ALTCHA challenge response sent to the client widget */
export interface AltchaChallenge {
  algorithm: string;
  challenge: string;
  maxnumber: number;
  salt: string;
  signature: string;
}
