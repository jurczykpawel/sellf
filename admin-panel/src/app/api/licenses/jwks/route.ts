import { createPublicKey } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { checkRateLimit } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';

const querySchema = z.object({ seller: z.string().uuid() });

/** `active` signs new licenses; `retired` was replaced by a planned key change and still verifies older licenses. */
type PublicKeyStatus = 'active' | 'retired';

interface PublicKeyRow {
  kid: string;
  public_key: string;
  alg: string;
  status: PublicKeyStatus;
}

/**
 * One published key: a standard EC P-256 JWK (RFC 7517/7518) that JOSE libraries import
 * directly, plus `pem` (the same key as SPKI PEM, used by the Sellf reference verifier)
 * and `status`.
 */
interface PublishedKey {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  kid: string;
  alg: string;
  use: 'sig';
  pem: string;
  status: PublicKeyStatus;
}

function toPublishedKey(row: PublicKeyRow): PublishedKey | null {
  try {
    const jwk = createPublicKey(row.public_key).export({ format: 'jwk' });
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) return null;
    return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, kid: row.kid, alg: row.alg, use: 'sig', pem: row.public_key, status: row.status };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const parsed = querySchema.safeParse({ seller: request.nextUrl.searchParams.get('seller') });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  // Shared application limiter: keys on the trusted-proxy client IP (the
  // proxy-set X-Forwarded-For when TRUSTED_PROXY is enabled) with a UA
  // fingerprint fallback — same path as the other public endpoints.
  const allowed = await checkRateLimit('licenses_jwks', 60, 1);
  if (!allowed) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429 });
  }

  // Public keys only — read via a SECURITY DEFINER RPC so the encrypted private
  // columns are never reachable from this public endpoint. The active key comes
  // first; retired keys follow so licenses signed before a key change still verify.
  const { data, error } = await createAdminClient().rpc('seller_license_public_keys', { seller: parsed.data.seller });
  if (error) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
  const rows = (data ?? []) as PublicKeyRow[];
  const keys: PublishedKey[] = [];
  for (const row of rows) {
    const key = toPublishedKey(row);
    if (key) keys.push(key);
    else console.error('[licenses/jwks] Skipping a stored public key that is not EC P-256:', row.kid);
  }

  return NextResponse.json(
    { keys },
    { status: 200, headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' } },
  );
}
