import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { checkRateLimit } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';

const querySchema = z.object({
  seller: z.string().uuid(),
  // k-anonymity range query: the caller sends a hex PREFIX of SHA-256(order) and gets back
  // only the revoked hashes in that bucket — never the whole list. 2–16 hex chars balances
  // bucket size against how much of its hash the caller reveals. Required: there is no
  // full-dump mode, so the revocation count can't be scraped in one request.
  prefix: z.string().regex(/^[a-f0-9]{2,16}$/),
});

interface RevokedRow {
  order_hash: string;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;

/**
 * License revocation list (CRL). Licensed products verify offline, so this is how a
 * refunded/abused token is turned off: the consumer computes SHA-256 of its `order` claim,
 * queries this endpoint with a prefix of that hash, and refuses the token if the full hash
 * is in the returned bucket. Seller-scoped, public, cached — mirrors JWKS.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const parsed = querySchema.safeParse({
    seller: request.nextUrl.searchParams.get('seller'),
    prefix: request.nextUrl.searchParams.get('prefix'),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const allowed = await checkRateLimit('licenses_revoked', 60, 1);
  if (!allowed) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429 });
  }

  // Revoked order hashes in the prefix bucket only — read via a SECURITY DEFINER RPC so the
  // token/email columns of issued_licenses are never reachable from this public endpoint.
  const { data, error } = await createAdminClient().rpc('seller_revoked_orders', {
    seller: parsed.data.seller,
    hash_prefix: parsed.data.prefix,
  });
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
