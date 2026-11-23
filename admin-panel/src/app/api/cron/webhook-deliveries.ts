import { createAdminClient } from '@/lib/supabase/admin';
import { storeBuyerPayload } from '@/lib/webhooks/buyer-payload-storage';
import { getWebhookQueue } from '@/lib/services/webhook-queue';
import { WebhookDispatcher } from '@/lib/services/webhook-queue/dispatcher';
import { computeNextRetry, hasMoreAttempts } from '@/lib/services/webhook-queue/retry-policy';

const WEBHOOK_RETRY_BATCH = 50;

export async function handleWebhookDeliveriesRetry(): Promise<{ processed: number; errors: number }> {
  const adminClient = createAdminClient();
  const queue = getWebhookQueue();

  const due = await queue.pickDue(WEBHOOK_RETRY_BATCH);
  if (due.length === 0) {
    return { processed: 0, errors: 0 };
  }

  let processed = 0;
  let errors = 0;

  await Promise.allSettled(
    due.map(async (delivery) => {
      try {
        const { data: endpoint, error } = await adminClient
          .from('webhook_endpoints')
          .select('id, url, secret, is_active, custom_headers_encrypted')
          .eq('id', delivery.endpointId)
          .single();

        if (error || !endpoint || !endpoint.is_active) {
          await queue.markPermanentlyFailed(delivery.id, {
            ok: false,
            httpStatus: 0,
            responseBody: null,
            errorMessage: 'Endpoint missing or inactive',
            durationMs: 0,
          });
          errors++;
          return;
        }

        const payload = { ...((delivery.payload ?? {}) as Record<string, unknown>), id: delivery.id };
        const { error: payloadError } = await adminClient.from('webhook_logs').update({ payload: await storeBuyerPayload(delivery.eventType, payload) }).eq('id', delivery.id);
        if (payloadError) throw new Error('Delivery payload unavailable');
        const nextAttempt = delivery.attemptCount + 1;
        const result = await WebhookDispatcher.dispatch(
          // Preserve endpoint-specific headers on retries.
          { id: endpoint.id, url: endpoint.url, secret: endpoint.secret, custom_headers_encrypted: endpoint.custom_headers_encrypted },
          delivery.eventType,
          payload,
          { attemptCount: nextAttempt, deliveryId: delivery.id, client: adminClient },
        );

        if (result.ok) {
          await queue.markDelivered(delivery.id, result);
        } else if (!hasMoreAttempts(nextAttempt, delivery.maxAttempts)) {
          await queue.markPermanentlyFailed(delivery.id, result);
        } else {
          await queue.markFailed(delivery.id, result, computeNextRetry(nextAttempt));
        }
        processed++;
      } catch (err) {
        console.error('[cron/webhook-deliveries-retry] processing error', delivery.id, err);
        errors++;
      }
    }),
  );

  return { processed, errors };
}
