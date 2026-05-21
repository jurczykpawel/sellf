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
