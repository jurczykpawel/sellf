import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { loadAllowedOriginsForProduct } from '@/lib/embed/checkout-embed';
import { validateRedirectAgainstAllowlist } from '@/lib/loginwall/request';
import { verifyGateToken } from '@/lib/loginwall/token';
import { checkRateLimitForIdentifier } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const bodySchema = z.object({ product: z.string().regex(/^[a-z0-9-]{1,96}$/) });

const RATE_LIMIT_ACTION = 'loginwall_verify';
const RATE_LIMIT_MAX = 120;
const RATE_LIMIT_WINDOW_MIN = 1;

function clientIdentifier(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

function bearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}

const BASE_CORS: Record<string, string> = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '600',
  Vary: 'Origin',
};

async function originIfAllowedForProduct(slug: string, origin: string | null): Promise<string | null> {
  if (!origin) return null;
  const supabase = await createClient();
  const result = await supabase.from('products').select('id, slug, seller_id').eq('slug', slug).maybeSingle();
  const product = (result.data ?? null) as { seller_id: string | null } | null;
  if (!product) return null;
  const allowed = await loadAllowedOriginsForProduct(createAdminClient(), product.seller_id);
  return validateRedirectAgainstAllowlist(origin, allowed) ? origin : null;
}

function corsHeaders(reflectedOrigin: string | null): Record<string, string> {
  const headers = { ...BASE_CORS };
  if (reflectedOrigin) headers['Access-Control-Allow-Origin'] = reflectedOrigin;
  return headers;
}

export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin');
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const allowed = await checkRateLimitForIdentifier(
    RATE_LIMIT_ACTION,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MIN,
    clientIdentifier(request),
  );
  if (!allowed) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ access: false }, { status: 200 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ access: false }, { status: 200 });
  }
  const slug = parsed.data.product;

  const reflected = await originIfAllowedForProduct(slug, request.headers.get('origin'));

  const secret = process.env.LOGINWALL_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500, headers: corsHeaders(reflected) });
  }

  const tokenStr = bearer(request);
  const verified = tokenStr ? verifyGateToken(tokenStr, { secret }) : { valid: false as const, reason: 'malformed' as const };
  const access = verified.valid && verified.auth && verified.owned.includes(slug);

  return NextResponse.json({ access }, { status: 200, headers: corsHeaders(reflected) });
}
