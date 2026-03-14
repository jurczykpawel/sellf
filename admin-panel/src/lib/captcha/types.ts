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
