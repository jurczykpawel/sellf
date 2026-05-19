import { NextResponse } from 'next/server';
import { createChallenge } from 'altcha-lib/v1';
import { checkRateLimit } from '@/lib/rate-limiting';

/**
 * ALTCHA challenge generation endpoint.
 *
 * Generates an HMAC-signed proof-of-work challenge for the ALTCHA widget.
 *
 * @see /src/lib/captcha/verify.ts — server-side verification
 */
export async function GET() {
  const hmacKey = process.env.ALTCHA_HMAC_KEY;

  if (!hmacKey) {
    return NextResponse.json(
      { error: 'ALTCHA is not configured' },
      { status: 500 },
    );
  }

  const rateLimitOk = await checkRateLimit('captcha_challenge', 60, 1);
  if (!rateLimitOk) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  try {
    const challenge = await createChallenge({
      hmacKey,
      maxNumber: 100_000,
    });

    return NextResponse.json(challenge, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('[captcha/challenge] Failed to create ALTCHA challenge:', error);
    return NextResponse.json(
      { error: 'Failed to generate challenge' },
      { status: 500 },
    );
  }
}
