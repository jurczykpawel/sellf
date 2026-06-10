import { NextResponse } from 'next/server';
import { createChallenge } from 'altcha-lib/v1';

import {
  buildEmbedCorsHeaders,
  loadAllowedOriginsForProductSlug,
} from '@/lib/embed/checkout-embed';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limiting';

/**
 * ALTCHA challenge generation endpoint.
 *
 * Generates an HMAC-signed proof-of-work challenge for the ALTCHA widget.
 *
 * The widget runs same-origin in the admin panel AND cross-origin inside the
 * embed (it loads on the seller's page). For the cross-origin case the embed
 * appends `?productSlug=…`; we reflect CORS for any origin that product's seller
 * has allowlisted (the same allowlist the embed checkout uses). Without this the
 * browser blocks the widget's challenge fetch and it shows "Verification failed",
 * which also stalls the paid flow (Stripe mounts only after the captcha passes).
 *
 * @see /src/lib/captcha/verify.ts — server-side verification
 * @see /src/app/api/embed/checkout-session/route.ts — same CORS allowlist model
 */

const CHALLENGE_METHODS = 'GET, OPTIONS';

// Embed an expiry in every challenge so a solved proof-of-work cannot be
// replayed indefinitely. ALTCHA round-trips the salt (which carries `expires`)
// and `verifySolution` rejects expired payloads. 30 min comfortably covers
// checkout form-fill while bounding the replay window; within that window the
// per-IP / per-email rate limits on the embed endpoints are the binding control.
const CHALLENGE_TTL_SECONDS = 30 * 60;

async function corsHeadersFor(request: Request): Promise<Record<string, string>> {
  const origin = request.headers.get('origin');
  const productSlug = new URL(request.url).searchParams.get('productSlug');
  if (!origin || !productSlug) return {};

  const allowedOrigins = await loadAllowedOriginsForProductSlug(createAdminClient(), productSlug);
  const headers = buildEmbedCorsHeaders(origin, allowedOrigins, CHALLENGE_METHODS);
  if (!headers['Access-Control-Allow-Origin']) return {};
  // This route sets its own (stronger) Cache-Control; don't let CORS override it.
  delete headers['Cache-Control'];
  return headers;
}

export async function OPTIONS(request: Request) {
  const headers = await corsHeadersFor(request);
  if (!headers['Access-Control-Allow-Origin']) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers });
}

export async function GET(request: Request) {
  const hmacKey = process.env.ALTCHA_HMAC_KEY;

  if (!hmacKey) {
    return NextResponse.json(
      { error: 'ALTCHA is not configured' },
      { status: 500 },
    );
  }

  const cors = await corsHeadersFor(request);

  const rateLimitOk = await checkRateLimit('captcha_challenge', 60, 1);
  if (!rateLimitOk) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': '60', ...cors } },
    );
  }

  try {
    const challenge = await createChallenge({
      hmacKey,
      maxNumber: 100_000,
      expires: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000),
    });

    return NextResponse.json(challenge, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        ...cors,
      },
    });
  } catch (error) {
    console.error('[captcha/challenge] Failed to create ALTCHA challenge:', error);
    return NextResponse.json(
      { error: 'Failed to generate challenge' },
      { status: 500, headers: cors },
    );
  }
}
