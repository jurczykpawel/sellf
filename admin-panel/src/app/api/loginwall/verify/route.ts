import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { loadAllowedOriginsForProduct } from '@/lib/embed/checkout-embed';
import { rateLimitGuard, validateRedirectAgainstAllowlist } from '@/lib/loginwall/request';
import { verifyGateToken } from '@/lib/loginwall/token';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { readJsonBody, ApiPayloadTooLargeError } from '@/lib/api/body-limit';

const SLUG_RE = /^[a-z0-9-]{1,96}$/;
const bodySchema = z.object({ product: z.string().regex(SLUG_RE).optional() });

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

/**
 * Shared by OPTIONS and POST: resolves the product for a slug and whether
 * the request's Origin is on that product's seller allowlist. A slug is
 * required — without it there is no allowlist to check against, so the
 * origin is never reflected (fail-closed on both the preflight and the
 * actual request).
 */
async function resolveAllowedOrigin(
  slug: string | undefined,
  origin: string | null,
): Promise<{ product: VerifyProduct | null; reflected: string | null }> {
  if (!slug) return { product: null, reflected: null };
  const product = await loadProductBySlug(slug);
  const reflected = (await originAllowedForProduct(product, origin)) ? origin : null;
  return { product, reflected };
}

function queryProductFrom(request: NextRequest): string | undefined {
  const raw = request.nextUrl.searchParams.get('product');
  return raw !== null && SLUG_RE.test(raw) ? raw : undefined;
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
  const limited = await rateLimitGuard('loginwall_verify_preflight', 120, 1);
  if (limited) return limited;

  // The preflight carries no body, so the product slug — and therefore which
  // seller's allowlist applies — comes from the query string the runtime
  // appends to the verify URL. No slug (or an unknown one) means there is
  // nothing to check the origin against, so it is never reflected.
  const slug = queryProductFrom(request);
  const origin = request.headers.get('origin');
  const { reflected } = await resolveAllowedOrigin(slug, origin);
  return new NextResponse(null, { status: 204, headers: corsHeaders(reflected) });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = await rateLimitGuard('loginwall_verify', 120, 1);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (err) {
    if (err instanceof ApiPayloadTooLargeError) {
      return NextResponse.json({ access: false }, { status: 413 });
    }
    return NextResponse.json({ access: false }, { status: 200 });
  }
  const parsed = bodySchema.safeParse(body);
  const bodyProduct = parsed.success ? parsed.data.product : undefined;
  const queryProduct = queryProductFrom(request);

  // Server-to-server callers only ever send the product in the body; the
  // browser runtime sends both (query for the preflight, body for parity
  // with the documented server-to-server contract). If both are present
  // they must agree — a mismatch is treated as a bad request, not "trust
  // whichever one we like".
  if (queryProduct !== undefined && bodyProduct !== undefined && queryProduct !== bodyProduct) {
    return NextResponse.json({ access: false }, { status: 200 });
  }

  const slug = queryProduct ?? bodyProduct;
  if (!slug) {
    return NextResponse.json({ access: false }, { status: 200 });
  }

  const origin = request.headers.get('origin');
  const { product, reflected } = await resolveAllowedOrigin(slug, origin);

  const secret = process.env.LOGINWALL_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500, headers: corsHeaders(reflected) });
  }

  const tokenStr = bearer(request);
  const verified = tokenStr ? verifyGateToken(tokenStr, { secret }) : { valid: false as const, reason: 'malformed' as const };

  // The token authenticates identity (uid) for the products it was issued for;
  // ownership is re-checked live, so a revoked or expired grant is denied
  // immediately, not after the token TTL.
  const access =
    verified.valid &&
    verified.auth &&
    verified.req.includes(slug) &&
    !!product &&
    (await hasLiveAccess(verified.uid, product.id));

  return NextResponse.json({ access }, { status: 200, headers: corsHeaders(reflected) });
}
