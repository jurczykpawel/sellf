/**
 * POST /api/subscriptions/[id]/cancel
 *
 * Schedules cancellation at the current period end.
 * The subscription stays active until current_period_end and then transitions
 * via `customer.subscription.deleted` (handled in webhooks/stripe/route.ts).
 *
 * Abuse controls: rate-limited per-user (Stripe mutation), CSRF-guarded via
 * X-Requested-With header (matches the pattern used by other state-changing
 * Sellf endpoints).
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripeServer } from '@/lib/stripe/server';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiting';
import { validateCrossOriginRequest } from '@/lib/cors';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const csrfError = validateCrossOriginRequest(request);
  if (csrfError) return csrfError;

  const { id } = await context.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rateLimitOk = await checkRateLimit(
    RATE_LIMITS.SUBSCRIPTION_MUTATION.actionType,
    RATE_LIMITS.SUBSCRIPTION_MUTATION.maxRequests,
    RATE_LIMITS.SUBSCRIPTION_MUTATION.windowMinutes,
    user.id
  );
  if (!rateLimitOk) {
    return NextResponse.json(
      { error: 'Too many subscription requests. Please try again later.' },
      { status: 429 }
    );
  }

  const { data: subscription, error: dbError } = await supabase
    .from('subscriptions')
    .select('id, user_id, stripe_subscription_id, status, cancel_at_period_end')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (dbError || !subscription) {
    return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
  }
  if (subscription.status === 'canceled') {
    return NextResponse.json({ error: 'Subscription already canceled' }, { status: 400 });
  }
  if (subscription.cancel_at_period_end) {
    return NextResponse.json({ ok: true, message: 'Already scheduled to cancel' });
  }

  try {
    const stripe = await getStripeServer();
    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stripe error';
    console.error('[POST /api/subscriptions/[id]/cancel] Stripe error:', message);
    return NextResponse.json({ error: 'Failed to cancel subscription' }, { status: 500 });
  }

  // Mirror the change in our DB now so the UI sees it on the next fetch.
  // RLS only grants SELECT to authenticated users; UPDATE needs service_role.
  // We already authorized the user above (subscription belongs to user.id).
  // Webhook customer.subscription.updated idempotently re-upserts later.
  const adminSupabase = createAdminClient();
  const { error: updateError } = await adminSupabase
    .from('subscriptions')
    .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);
  if (updateError) {
    console.error('[POST /api/subscriptions/[id]/cancel] DB mirror failed:', updateError.message);
  }

  return NextResponse.json({ ok: true });
}
