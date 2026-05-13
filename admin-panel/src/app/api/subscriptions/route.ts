/**
 * GET /api/subscriptions
 *
 * Returns the current user's subscriptions with the matching product summary.
 * RLS allows authenticated users to read their own rows.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiting';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rateLimitOk = await checkRateLimit(
    RATE_LIMITS.SUBSCRIPTION_READ.actionType,
    RATE_LIMITS.SUBSCRIPTION_READ.maxRequests,
    RATE_LIMITS.SUBSCRIPTION_READ.windowMinutes,
    user.id,
  );
  if (!rateLimitOk) {
    return NextResponse.json(
      { error: 'Too many subscription requests. Please try again later.' },
      { status: 429 },
    );
  }

  const { data: subscriptions, error: subError } = await supabase
    .from('subscriptions')
    .select(
      'id, status, current_period_start, current_period_end, cancel_at_period_end, canceled_at, trial_end, latest_invoice_id, stripe_subscription_id, product_id, created_at'
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (subError) {
    console.error('[GET /api/subscriptions] error:', subError);
    return NextResponse.json({ error: 'Failed to load subscriptions' }, { status: 500 });
  }

  if (!subscriptions || subscriptions.length === 0) {
    return NextResponse.json({ subscriptions: [] });
  }

  const productIds = [...new Set(subscriptions.map((s) => s.product_id))];
  const { data: products } = await supabase
    .from('products')
    .select('id, name, slug, currency, recurring_price, billing_interval, billing_interval_count')
    .in('id', productIds);

  const productMap = new Map((products ?? []).map((p) => [p.id, p]));

  return NextResponse.json({
    subscriptions: subscriptions.map((sub) => ({
      ...sub,
      product: productMap.get(sub.product_id) ?? null,
    })),
  });
}
