import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { checkRateLimit } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';

const querySchema = z.object({ seller: z.string().uuid() });

interface PublicKeyRow {
  kid: string;
  public_key: string;
  alg: string;
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
  // columns are never reachable from this public endpoint.
  const { data, error } = await createAdminClient().rpc('seller_license_public_keys', { seller: parsed.data.seller });
  if (error) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
  const rows = (data ?? []) as PublicKeyRow[];
  const keys = rows.map((r) => ({ kid: r.kid, alg: r.alg, pem: r.public_key }));

  return NextResponse.json(
    { keys },
    { status: 200, headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' } },
  );
}
