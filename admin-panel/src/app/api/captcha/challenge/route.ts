import { NextResponse } from 'next/server';
import { createChallenge } from 'altcha-lib';

/**
 * ALTCHA challenge generation endpoint
 *
 * Generates an HMAC-signed proof-of-work challenge for the ALTCHA widget.
 * The client brute-forces a number that satisfies the hash, then submits
 * the base64-encoded solution for server-side verification.
 *
 * Security:
 * - No rate limiting needed — challenge generation is cheap and stateless
 * - HMAC signature prevents tampering (server verifies with same key)
 * - maxNumber controls difficulty (higher = slower brute force)
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
