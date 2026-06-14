import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { checkRateLimit } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';

const querySchema = z.object({ seller: z.string().uuid() });

interface RevokedRow {
  order_hash: string;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;

/**
 * License revocation list (CRL). Licensed products verify offline, so this is how a
 * refunded/abused token is turned off: the consumer hashes its `order` claim and refuses
 * a token whose SHA-256 hash appears here. Seller-scoped, public, cached — mirrors JWKS.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const parsed = querySchema.safeParse({ seller: request.nextUrl.searchParams.get('seller') });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const allowed = await checkRateLimit('licenses_revoked', 60, 1);
  if (!allowed) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429 });
  }

  // Revoked order hashes only — read via a SECURITY DEFINER RPC so the token/email columns
  // of issued_licenses are never reachable from this public endpoint.
  const { data, error } = await createAdminClient().rpc('seller_revoked_orders', { seller: parsed.data.seller });
  if (error) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
  const orderHashes = ((data ?? []) as RevokedRow[]).map((row) => row.order_hash);
  if (!orderHashes.every((hash) => typeof hash === 'string' && SHA256_HEX.test(hash))) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }

  return NextResponse.json(
    { order_hashes: orderHashes },
    { status: 200, headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' } },
  );
}
