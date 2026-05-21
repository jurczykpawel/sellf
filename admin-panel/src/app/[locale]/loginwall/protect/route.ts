import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { isAllowedEmbedOrigin, loadAllowedOriginsForProduct } from '@/lib/embed/checkout-embed';
import { signLoginwallToken } from '@/lib/loginwall/token';
import { storeLoginwallNonce } from '@/lib/loginwall/store';
import { isInternalHostname } from '@/lib/security/internal-hostname';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const querySchema = z.object({
  id: z.string().uuid(),
  redirect: z.string().min(1).max(2048),
});

function parseCustomerRedirect(raw: string): URL | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (isInternalHostname(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function siteOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

function appendTokenToFragment(target: URL, token: string): string {
  const existing = target.hash.replace(/^#/, '');
  const tokenParam = `_sf_token=${token}`;
  target.hash = existing ? `${existing}&${tokenParam}` : tokenParam;
  return target.toString();
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const parsed = querySchema.safeParse({
    id: request.nextUrl.searchParams.get('id'),
    redirect: request.nextUrl.searchParams.get('redirect'),
  });
  if (!parsed.success) {
    return jsonError('Bad request', 400);
  }

  const redirectTarget = parseCustomerRedirect(parsed.data.redirect);
  if (!redirectTarget) {
    return jsonError('Invalid redirect', 400);
  }

  const origin = siteOrigin();
  if (!origin) {
    return jsonError('Server misconfigured', 500);
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    const loginUrl = new URL('/login', origin);
    const returnPath = `/loginwall/protect?id=${parsed.data.id}&redirect=${encodeURIComponent(redirectTarget.toString())}`;
    loginUrl.searchParams.set('redirect_to', returnPath);
    return NextResponse.redirect(loginUrl, 307);
  }

  const productResult = await supabase
    .from('products')
    .select('id, slug, is_active, seller_id')
    .eq('id', parsed.data.id)
    .maybeSingle();
  const product = (productResult.data ?? null) as
    | { id: string; slug: string; is_active: boolean; seller_id: string | null }
    | null;
  if (!product) {
    return jsonError('Not found', 404);
  }

  const allowedOrigins = await loadAllowedOriginsForProduct(createAdminClient(), product.seller_id);
  if (!isAllowedEmbedOrigin(redirectTarget.origin, allowedOrigins)) {
    return jsonError('Invalid redirect', 400);
  }

  const accessResult = await supabase
    .from('user_product_access')
    .select('access_expires_at')
    .eq('user_id', user.id)
    .eq('product_id', product.id)
    .maybeSingle();
  const access = (accessResult.data ?? null) as { access_expires_at: string | null } | null;
  const hasActiveAccess =
    !!access && (!access.access_expires_at || new Date(access.access_expires_at) > new Date());

  if (!hasActiveAccess) {
    return NextResponse.redirect(new URL(`/p/${product.slug}`, origin), 307);
  }

  const secret = process.env.LOGINWALL_SECRET;
  if (!secret) {
    return jsonError('Server misconfigured', 500);
  }

  const { token, nonceHash, expiresAt } = signLoginwallToken({
    productId: product.id,
    userId: user.id,
    secret,
  });

  await storeLoginwallNonce({
    productId: product.id,
    userId: user.id,
    nonceHash,
    expiresAt,
  });

  return NextResponse.redirect(appendTokenToFragment(new URL(redirectTarget.toString()), token), 307);
}
