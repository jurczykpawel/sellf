import { NextResponse } from 'next/server';

import type { CaptchaProvider } from './types';
import { verifyCaptchaToken } from './verify';

/**
 * Route-level captcha guard. Returns `null` when verification passes, or a
 * 400 NextResponse with the error message otherwise.
 *
 * Routes that need bespoke headers (CORS, embed origins) should call
 * `verifyCaptchaToken` directly. This guard is for the common path where a
 * 400 + JSON body is enough.
 */
export async function requireCaptcha(
  token: string | null | undefined,
  providerOverride?: CaptchaProvider,
): Promise<Response | null> {
  const result = await verifyCaptchaToken(token, providerOverride);
  if (result.success) return null;
  return NextResponse.json(
    { error: result.error ?? 'Security verification failed' },
    { status: 400 },
  );
}
