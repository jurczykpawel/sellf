import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { loadAllowedOriginsForProduct } from '@/lib/embed/checkout-embed';
import { rateLimitGuard, validateRedirectAgainstAllowlist } from '@/lib/loginwall/request';
import { verifyGateToken } from '@/lib/loginwall/token';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const bodySchema = z.object({ product: z.string().regex(/^[a-z0-9-]{1,96}$/) });

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

interface VerifyProduct {
  id: string;
  seller_id: string | null;
}

async function loadProductBySlug(slug: string): Promise<VerifyProduct | null> {
  const supabase = await createClient();
  const result = await supabase.from('products').select('id, seller_id').eq('slug', slug).maybeSingle();
  return (result.data ?? null) as VerifyProduct | null;
}

async function originAllowedForProduct(product: VerifyProduct | null, origin: string | null): Promise<boolean> {
  if (!origin || !product) return false;
  const allowed = await loadAllowedOriginsForProduct(createAdminClient(), product.seller_id);
  return validateRedirectAgainstAllowlist(origin, allowed);
}

// Authoritative, live ownership check — the token only proves identity; access is re-read here.
async function hasLiveAccess(userId: string, productId: string): Promise<boolean> {
  const admin = createAdminClient();
  const result = await admin
    .from('user_product_access')
    .select('access_expires_at')
    .eq('user_id', userId)
    .eq('product_id', productId)
    .maybeSingle();
  const row = (result.data ?? null) as { access_expires_at: string | null } | null;
  return !!row && (!row.access_expires_at || new Date(row.access_expires_at) > new Date());
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
  const limited = await rateLimitGuard('loginwall_verify', 120, 1);
  if (limited) return limited;

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

  const product = await loadProductBySlug(slug);
  const reflected = (await originAllowedForProduct(product, request.headers.get('origin')))
    ? request.headers.get('origin')
    : null;

  const secret = process.env.LOGINWALL_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500, headers: corsHeaders(reflected) });
  }

  const tokenStr = bearer(request);
  const verified = tokenStr ? verifyGateToken(tokenStr, { secret }) : { valid: false as const, reason: 'malformed' as const };

  // The token authenticates identity (uid) — ownership is re-checked live, so a
  // revoked or expired grant is denied immediately, not after the token TTL.
  const access =
    verified.valid && verified.auth && !!product && (await hasLiveAccess(verified.uid, product.id));

  return NextResponse.json({ access }, { status: 200, headers: corsHeaders(reflected) });
}
