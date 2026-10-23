/** Live public event availability. @see lib/events/presentation.ts */
import { NextResponse } from 'next/server';
import { isAllowedEmbedOrigin, loadAllowedOriginsForProduct } from '@/lib/embed/checkout-embed';
import { projectEventSessions } from '@/lib/events/presentation';
import { decideProductAccessOutcome } from '@/lib/payment/product-access-decision';
import { checkRateLimit } from '@/lib/rate-limiting';
import { createAdminClient } from '@/lib/supabase/admin';
import type { NextRequest } from 'next/server';

interface Context { params: Promise<{ slug: string }> }
async function respond(request: NextRequest, context: Context, preflight: boolean): Promise<NextResponse> {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store', Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  try {
    if (!await checkRateLimit('event_availability', 120, 1)) return NextResponse.json({ error: 'Rate limited' }, { status: 429, headers: { ...headers, 'Retry-After': '60' } });
    const { slug } = await context.params;
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(slug)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers });
    const db = createAdminClient();
    const { data: product, error } = await db.from('products').select('id,currency,seller_id,event_mode,is_active,available_from,available_until').eq('slug', slug).maybeSingle();
    if (error) return NextResponse.json({ error: 'Availability unavailable' }, { status: 503, headers });
    if (!product?.event_mode || decideProductAccessOutcome({ user: null, product, userAccess: null, now: new Date() }).kind !== 'redirect-checkout') return NextResponse.json({ error: 'Not found' }, { status: 404, headers });
    const origin = request.headers.get('origin');
    const allowed = await loadAllowedOriginsForProduct(db, product.seller_id);
    if (origin && isAllowedEmbedOrigin(origin, allowed)) headers['Access-Control-Allow-Origin'] = origin;
    if (preflight) return new NextResponse(null, { status: 204, headers });
    const result = await db.rpc('public_event_availability', { p_product_id: product.id });
    if (result.error) return NextResponse.json({ error: 'Availability unavailable' }, { status: 503, headers });
    return NextResponse.json({ productId: product.id, currency: product.currency, sessions: projectEventSessions(result.data) }, { headers });
  } catch {
    return NextResponse.json({ error: 'Availability unavailable' }, { status: 503, headers });
  }
}
export async function GET(request: NextRequest, context: Context): Promise<NextResponse> { return respond(request, context, false); }
export async function OPTIONS(request: NextRequest, context: Context): Promise<NextResponse> { return respond(request, context, true); }
