import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { checkRateLimitForIdentifier } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';

const querySchema = z.object({ seller: z.string().uuid() });

const RATE_LIMIT_ACTION = 'licenses_jwks';
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MIN = 1;

function clientIdentifier(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

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

  const allowed = await checkRateLimitForIdentifier(
    RATE_LIMIT_ACTION,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MIN,
    clientIdentifier(request),
  );
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
