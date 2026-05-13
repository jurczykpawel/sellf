import { describe, expect, it, vi } from 'vitest';
import { scheduleSubscriptionCancelAfterFullRefund } from '@/lib/services/subscription-refund-cancel';

function mockSupabase(row: unknown, error: unknown = null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: row, error })),
        })),
      })),
    })),
  };
}

function mockStripe() {
  return {
    subscriptions: {
      update: vi.fn(async () => ({ id: 'sub_123' })),
    },
  };
}

describe('scheduleSubscriptionCancelAfterFullRefund', () => {
  it('does nothing for one-time transactions', async () => {
    const supabase = mockSupabase(null);
    const stripe = mockStripe();

    const result = await scheduleSubscriptionCancelAfterFullRefund({
      supabase: supabase as never,
      stripe: stripe as never,
      transaction: { id: 'tx_1', subscription_id: null },
    });

    expect(result).toEqual({ ok: true, canceled: false, reason: 'not_subscription_payment' });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('schedules Stripe cancellation at period end for subscription transactions', async () => {
    const supabase = mockSupabase({
      stripe_subscription_id: 'sub_123',
      cancel_at_period_end: false,
    });
    const stripe = mockStripe();

    const result = await scheduleSubscriptionCancelAfterFullRefund({
      supabase: supabase as never,
      stripe: stripe as never,
      transaction: { id: 'tx_1', subscription_id: 'sub_row_1' },
    });

    expect(result).toEqual({ ok: true, canceled: true, stripeSubscriptionId: 'sub_123' });
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_123', {
      cancel_at_period_end: true,
    });
  });

  it('does not call Stripe when cancellation is already scheduled', async () => {
    const supabase = mockSupabase({
      stripe_subscription_id: 'sub_123',
      cancel_at_period_end: true,
    });
    const stripe = mockStripe();

    const result = await scheduleSubscriptionCancelAfterFullRefund({
      supabase: supabase as never,
      stripe: stripe as never,
      transaction: { id: 'tx_1', subscription_id: 'sub_row_1' },
    });

    expect(result).toEqual({ ok: true, canceled: false, reason: 'already_scheduled' });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('does not call Stripe when the subscription row is missing a Stripe subscription id', async () => {
    const supabase = mockSupabase(null);
    const stripe = mockStripe();

    const result = await scheduleSubscriptionCancelAfterFullRefund({
      supabase: supabase as never,
      stripe: stripe as never,
      transaction: { id: 'tx_1', subscription_id: 'sub_row_1' },
    });

    expect(result).toEqual({ ok: true, canceled: false, reason: 'missing_subscription_row' });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('returns a failure when loading the subscription row fails', async () => {
    const supabase = mockSupabase(null, { message: 'database unavailable' });
    const stripe = mockStripe();

    const result = await scheduleSubscriptionCancelAfterFullRefund({
      supabase: supabase as never,
      stripe: stripe as never,
      transaction: { id: 'tx_1', subscription_id: 'sub_row_1' },
    });

    expect(result).toEqual({
      ok: false,
      reason: 'Failed to load subscription row: database unavailable',
    });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('returns a failure when Stripe cannot schedule cancellation', async () => {
    const supabase = mockSupabase({
      stripe_subscription_id: 'sub_123',
      cancel_at_period_end: false,
    });
    const stripe = mockStripe();
    stripe.subscriptions.update.mockRejectedValueOnce(new Error('Stripe API unavailable'));

    const result = await scheduleSubscriptionCancelAfterFullRefund({
      supabase: supabase as never,
      stripe: stripe as never,
      transaction: { id: 'tx_1', subscription_id: 'sub_row_1' },
    });

    expect(result).toEqual({
      ok: false,
      reason: 'Failed to schedule subscription cancellation: Stripe API unavailable',
    });
  });
});
