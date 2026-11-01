/** A dispute whose charge the configured Stripe account cannot see is acknowledged; other failures stay retriable. */
import { describe, expect, it, vi } from 'vitest';
import { handleChargeDispute } from '@/app/api/webhooks/stripe/dispute-handlers';
import type Stripe from 'stripe';
import type { createAdminClient } from '@/lib/supabase/admin';

const dispute = { id: 'dp_missing', charge: 'ch_missing', status: 'needs_response' } as Stripe.Dispute;
const db = {} as ReturnType<typeof createAdminClient>;
const stripeRejecting = (error: unknown) => ({ charges: { retrieve: vi.fn().mockRejectedValue(error) } }) as unknown as Stripe;

describe('handleChargeDispute with an unavailable charge', () => {
  it('acknowledges a charge Stripe reports as missing', async () => {
    const error = Object.assign(new Error('No such charge'), { code: 'resource_missing' });
    await expect(handleChargeDispute(dispute, db, stripeRejecting(error), false)).resolves.toEqual({ processed: true, message: 'Dispute charge not found' });
  });
  it('keeps transient Stripe failures retriable', async () => {
    await expect(handleChargeDispute(dispute, db, stripeRejecting(new Error('timeout')), false)).rejects.toThrow('timeout');
  });
});
