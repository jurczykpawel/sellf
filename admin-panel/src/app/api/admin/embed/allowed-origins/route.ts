import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdminApiWithRequest } from '@/lib/auth-server';
import { loadAllowedOriginsForProduct } from '@/lib/embed/checkout-embed';
import { createAdminClient } from '@/lib/supabase/admin';

const querySchema = z.object({ productId: z.string().uuid() });

export async function GET(request: NextRequest) {
  try {
    await requireAdminApiWithRequest(request);

    const parsed = querySchema.safeParse({
      productId: request.nextUrl.searchParams.get('productId'),
    });
    if (!parsed.success) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const { data: product } = await adminClient
      .from('products')
      .select('seller_id')
      .eq('id', parsed.data.productId)
      .maybeSingle();
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const origins = await loadAllowedOriginsForProduct(
      adminClient,
      (product as { seller_id: string | null }).seller_id,
    );
    if (request.nextUrl.searchParams.get('usage') === '1') {
      const { data: lastUsage, error } = await adminClient.from('embed_checkout_log').select('origin,created_at')
        .eq('product_id', parsed.data.productId).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) return NextResponse.json({ error: 'Embed usage unavailable' }, { status: 500 });
      return NextResponse.json({ origins, lastUsage }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({ origins });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('[allowed-origins] error:', error);
    return NextResponse.json({ error: 'Failed to load allowed origins' }, { status: 500 });
  }
}
