import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { checkRateLimit } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';

const querySchema = z.object({ seller: z.string().uuid() });

interface RevokedRow {
  order_id: string;
}

/**
 * License revocation list (CRL). Licensed products verify offline, so this is how a
 * refunded/abused token is turned off: the consumer refuses a token whose `order` claim
 * appears here. Seller-scoped, public, cached — mirrors the JWKS endpoint.
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

  // Revoked order ids only — read via a SECURITY DEFINER RPC so the token/email columns
  // of issued_licenses are never reachable from this public endpoint.
  const { data, error } = await createAdminClient().rpc('seller_revoked_orders', { seller: parsed.data.seller });
  if (error) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
  const orders = ((data ?? []) as RevokedRow[]).map((r) => r.order_id);

  return NextResponse.json(
    { orders },
    { status: 200, headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' } },
  );
}
