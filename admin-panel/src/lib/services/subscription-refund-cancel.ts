import type Stripe from 'stripe';

interface CancelInput {
  supabase: unknown;
  stripe: Stripe;
  transaction: {
    id: string;
    subscription_id?: string | null;
  };
}

interface SubscriptionQueryClient {
  from: (table: 'subscriptions') => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<{
          data: { stripe_subscription_id: string | null; cancel_at_period_end: boolean | null } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

type CancelResult =
  | { ok: true; canceled: false; reason: 'not_subscription_payment' | 'missing_subscription_row' | 'already_scheduled' }
  | { ok: true; canceled: true; stripeSubscriptionId: string }
  | { ok: false; reason: string };

export async function scheduleSubscriptionCancelAfterFullRefund({
  supabase,
  stripe,
  transaction,
}: CancelInput): Promise<CancelResult> {
  if (!transaction.subscription_id) {
    return { ok: true, canceled: false, reason: 'not_subscription_payment' };
  }

  const subscriptionClient = supabase as SubscriptionQueryClient;
  const { data: subscription, error } = await subscriptionClient
    .from('subscriptions')
    .select('stripe_subscription_id, cancel_at_period_end')
    .eq('id', transaction.subscription_id)
    .maybeSingle();

  if (error) {
    return { ok: false, reason: `Failed to load subscription row: ${error.message}` };
  }

  if (!subscription?.stripe_subscription_id) {
    return { ok: true, canceled: false, reason: 'missing_subscription_row' };
  }

  if (subscription.cancel_at_period_end) {
    return { ok: true, canceled: false, reason: 'already_scheduled' };
  }

  try {
    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: true,
    });
    return { ok: true, canceled: true, stripeSubscriptionId: subscription.stripe_subscription_id };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Stripe error';
    return { ok: false, reason: `Failed to schedule subscription cancellation: ${message}` };
  }
}
