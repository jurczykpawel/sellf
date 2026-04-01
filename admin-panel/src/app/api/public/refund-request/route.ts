/**
 * Seller-aware refund request API
 *
 * Accepts refund requests for products from any seller schema.
 * Used by the "My Purchases" page when marketplace is enabled.
 *
 * @see src/app/[locale]/my-purchases/page.tsx
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolvePublicDataClient } from '@/lib/marketplace/seller-client';
import { checkRateLimit } from '@/lib/rate-limiting';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rateLimitOk = await checkRateLimit('refund_request', 5, 60, user.id);
    if (!rateLimitOk) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const { transactionId, sellerSlug, reason } = await request.json();

    if (!transactionId) {
      return NextResponse.json({ error: 'Transaction ID is required' }, { status: 400 });
    }

    // Resolve seller schema
    const { dataClient, seller } = await resolvePublicDataClient(sellerSlug, createAdminClient());
    if (sellerSlug && !seller) {
      return NextResponse.json({ error: 'Seller not found' }, { status: 404 });
    }

    // Verify transaction belongs to authenticated user
    const { data: tx } = await dataClient
      .from('payment_transactions')
      .select('id')
      .eq('id', transactionId)
      .eq('user_id', user.id)
      .single();

    if (!tx) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    // Call create_refund_request RPC on the correct schema
    const { data, error: rpcError } = await dataClient.rpc('create_refund_request', {
      transaction_id_param: transactionId,
      reason_param: reason || null,
    });

    if (rpcError) {
      console.error('[refund-request] RPC error:', rpcError?.message || 'Unknown', rpcError?.code || '');
      return NextResponse.json({ error: 'Failed to submit refund request' }, { status: 500 });
    }

    if (data && !data.success) {
      return NextResponse.json({ error: data.error || 'Refund request failed' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[refund-request] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
