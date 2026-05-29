import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { loadAllowedOriginsForProduct } from '@/lib/embed/checkout-embed';
import {
  appendTokenToFragment,
  clientIdentifier,
  parseCustomerRedirect,
  siteOrigin,
  validateRedirectAgainstAllowlist,
} from '@/lib/loginwall/request';
import { signGateToken } from '@/lib/loginwall/token';
import { checkRateLimitForIdentifier } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const RATE_LIMIT_ACTION = 'loginwall_gate';
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MIN = 1;

const slugSchema = z.string().regex(/^[a-z0-9-]{1,96}$/);

const querySchema = z.object({
  products: z
    .string()
    .min(1)
    .transform((raw) => raw.split(','))
    .pipe(z.array(slugSchema).min(1).max(20)),
  redirect: z.string().min(1).max(2048),
});

interface ProductRow {
  id: string;
  slug: string;
  seller_id: string | null;
}

interface AccessRow {
  product_id: string;
  access_expires_at: string | null;
}

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const parsed = querySchema.safeParse({
    products: request.nextUrl.searchParams.get('products'),
    redirect: request.nextUrl.searchParams.get('redirect'),
  });
  if (!parsed.success) {
    return jsonError('Bad request', 400);
  }

  const allowed = await checkRateLimitForIdentifier(
    RATE_LIMIT_ACTION,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MIN,
    clientIdentifier(request),
  );
  if (!allowed) {
    return jsonError('Rate limited', 429);
  }

  const requested = Array.from(new Set(parsed.data.products));

  const redirectTarget = parseCustomerRedirect(parsed.data.redirect);
  if (!redirectTarget) {
    return jsonError('Invalid redirect', 400);
  }

  const origin = siteOrigin();
  if (!origin) {
    return jsonError('Server misconfigured', 500);
  }

  const supabase = await createClient();

  const productsResult = await supabase
    .from('products')
    .select('id, slug, seller_id')
    .in('slug', requested);
  const products = (productsResult.data ?? []) as ProductRow[];

  if (products.length !== requested.length) {
    return jsonError('Unknown product', 400);
  }

  const sellerIds = new Set(products.map((p) => p.seller_id));
  if (sellerIds.size !== 1) {
    return jsonError('Products span multiple sellers', 400);
  }
  const sellerId = products[0].seller_id;

  const allowedOrigins = await loadAllowedOriginsForProduct(createAdminClient(), sellerId);
  if (!validateRedirectAgainstAllowlist(redirectTarget.origin, allowedOrigins)) {
    return jsonError('Invalid redirect', 400);
  }

  const secret = process.env.LOGINWALL_SECRET;
  if (!secret) {
    return jsonError('Server misconfigured', 500);
  }

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  let owned: string[] = [];
  if (user) {
    const productIds = products.map((p) => p.id);
    const accessResult = await supabase
      .from('user_product_access')
      .select('product_id, access_expires_at')
      .eq('user_id', user.id)
      .in('product_id', productIds);
    const access = (accessResult.data ?? []) as AccessRow[];
    const now = Date.now();
    const ownedIds = new Set(
      access
        .filter((a) => !a.access_expires_at || new Date(a.access_expires_at).getTime() > now)
        .map((a) => a.product_id),
    );
    owned = products.filter((p) => ownedIds.has(p.id)).map((p) => p.slug);
  }

  const { token } = signGateToken({
    userId: user?.id ?? '',
    authenticated: !!user,
    requested,
    owned,
    secret,
  });

  return NextResponse.redirect(appendTokenToFragment(new URL(redirectTarget.toString()), token), 307);
}
