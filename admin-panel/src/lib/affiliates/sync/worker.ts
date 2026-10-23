/** Bounded affiliate queue drain. @see supabase/migrations/20261016000000_release_2026_10_6.sql */
import 'server-only';

import { z } from 'zod';
import { versionSchema } from '@/lib/affiliates/model';
import { getStripeServer } from '@/lib/stripe/server';
import { createAdminClient } from '@/lib/supabase/admin';

const claimSchema = z.object({
  payment_id: z.string(), lease_token: z.string(), requested_generation: versionSchema,
});
const factsSchema = z.object({ session_created_at: z.string(), livemode: z.boolean() });

export interface AffiliateDrainResult {
  claimed: number;
  applied: number;
  deferred: number;
  failed: number;
}
type DrainResult = { success: true; data: AffiliateDrainResult }
  | { success: false; error: 'invalid_limit' | 'queue_unavailable' };

/** Internal server job; the caller must authenticate before invoking this drain. */
export async function drainAffiliateWork(limit = 25): Promise<DrainResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return { success: false, error: 'invalid_limit' };
  try {
    const client = createAdminClient();
    const claimed = await client.rpc('affiliate_claim_work', { p_limit: limit })
      .select('payment_id,lease_token,requested_generation::text');
    if (claimed.error || !claimed.data) return { success: false, error: 'queue_unavailable' };
    const claims = z.array(claimSchema).safeParse(claimed.data);
    if (!claims.success) return { success: false, error: 'queue_unavailable' };
    const result: AffiliateDrainResult = { claimed: claims.data.length, applied: 0, deferred: 0, failed: 0 };
    for (const work of claims.data) {
      // PostgREST accepts bigint decimal strings; generated RPC types use number.
      const lease = { p_payment: work.payment_id, p_token: work.lease_token,
        p_generation: work.requested_generation as unknown as number };
      let errorCode = 'sync_failed';
      try {
        const frozen = await client.from('affiliate_commissions').select('session_created_at,livemode')
          .eq('payment_id', work.payment_id).limit(1).maybeSingle();
        if (frozen.error) throw new Error('snapshot_read_failed');
        let facts = frozen.data ? factsSchema.parse(frozen.data) : null;
        if (!facts) {
          const binding = await client.from('coupon_redemptions')
            .select('coupon:coupons!inner(binding:affiliate_coupon_bindings!inner(id))')
            .eq('transaction_id', work.payment_id).limit(1).maybeSingle();
          if (binding.error) throw new Error('binding_read_failed');
          if (!binding.data) {
            const completed = await client.rpc('affiliate_complete_unbound_work', lease);
            if (completed.error || !completed.data) throw new Error('unbound_work_changed');
            result.applied++;
            continue;
          }
        }
        if (!facts) {
          const payment = await client.from('payment_transactions').select('session_id,payment_provider,created_at,livemode')
            .eq('id', work.payment_id).maybeSingle();
          if (payment.error) throw new Error('payment_read_failed');
          if (payment.data?.payment_provider === 'bank_transfer') {
            facts = factsSchema.parse({ session_created_at: payment.data.created_at, livemode: payment.data.livemode });
          } else {
            const id = payment.data?.session_id;
            if (!id || (!id.startsWith('cs_') && !id.startsWith('pi_'))) {
              errorCode = 'session_unresolved';
              throw new Error(errorCode);
            }
            const stripe = await getStripeServer();
            let session;
            if (id.startsWith('cs_')) {
              session = await stripe.checkout.sessions.retrieve(id);
              if (session.id !== id) session = undefined;
            } else {
              const sessions = await stripe.checkout.sessions.list({ payment_intent: id, limit: 2 });
              const owner = sessions.data[0];
              const intent = typeof owner?.payment_intent === 'string' ? owner.payment_intent : owner?.payment_intent?.id;
              if (!sessions.has_more && sessions.data.length === 1 && intent === id) session = owner;
            }
            if (!session || !Number.isSafeInteger(session.created) || session.created <= 0
              || session.created * 1000 > Date.now() || typeof session.livemode !== 'boolean') {
              errorCode = 'session_unresolved';
              throw new Error(errorCode);
            }
            facts = { session_created_at: new Date(session.created * 1000).toISOString(), livemode: session.livemode };
          }
        }
        const applied = await client.rpc('affiliate_apply_sync', {
          ...lease, p_session_created_at: facts.session_created_at, p_livemode: facts.livemode,
        });
        if (applied.error) throw new Error('apply_failed');
        if (applied.data === true) result.applied++;
        else result.deferred++;
      } catch {
        result.failed++;
        try {
          const retried = await client.rpc('affiliate_retry_work', { ...lease, p_error: errorCode });
          if (retried.error) console.error('[drainAffiliateWork] Retry unavailable');
        } catch {
          // An interrupted retry is recovered by the durable lease expiry.
          console.error('[drainAffiliateWork] Retry unavailable');
        }
      }
    }
    return { success: true, data: result };
  } catch {
    return { success: false, error: 'queue_unavailable' };
  }
}
