import { createAdminClient } from '@/lib/supabase/admin';
import { WEBHOOK_MOCK_PAYLOADS } from '@/lib/webhooks/mock-payloads';
import { SupabaseWebhookQueue } from '@/lib/services/webhook-queue/supabase-queue';
import { WebhookDispatcher } from '@/lib/services/webhook-queue/dispatcher';
import { DEFAULT_MAX_ATTEMPTS } from '@/lib/services/webhook-queue/retry-policy';
import { fetchEligibleEndpoints } from '@/lib/webhooks/endpoint-selection';
import { buildEndpointBody } from '@/lib/webhooks/payload-customization';
import { checkFeature } from '@/lib/license/resolve';

interface EnvelopePayload {
  event: string;
  timestamp: string;
  data: unknown;
}

// Supabase clients with different schema types can't be unified via generics.
// This alias accepts any schema-scoped client (public, seller_X, etc.).
type SupabaseClientLike = any;

export class WebhookService {
  /**
   * Trigger webhooks for an event to every active matching endpoint.
   * Optimistic-dispatch + queue model: first attempt result is persisted
   * through the queue. Failures land in pending_retry and the worker
   * picks them up with exponential backoff.
   */
  static async trigger(
    event: string,
    data: unknown,
    client?: SupabaseClientLike,
    productIds?: string | string[],
  ): Promise<void> {
    const supabase = client || createAdminClient();
    const queue = new SupabaseWebhookQueue(supabase);

    try {
      const endpoints = await fetchEligibleEndpoints(supabase, event, productIds);
      if (endpoints.length === 0) return;

      const timestamp = new Date().toISOString();
      const envelope: EnvelopePayload = { event, timestamp, data };

      const isCustomized = (e: typeof endpoints[number]) =>
        e.custom_headers_encrypted != null || e.custom_payload_fields != null || e.payload_field_selection != null;

      const anyCustomized = endpoints.some(isCustomized);
      const licenseOk = anyCustomized
        ? await checkFeature('webhook-payload-customization', { dataClient: supabase })
        : true;

      const ctx: Record<string, string> = buildPlaceholderContext(data);
      const orderId = (data as any)?.payment_intent_id ?? (data as any)?.order_id ?? (data as any)?.session_id ?? null;

      await Promise.allSettled(
        endpoints.map(async (endpoint) => {
          if (isCustomized(endpoint) && !licenseOk) {
            console.warn(`[webhook] skipping customized endpoint ${endpoint.id}: license inactive`);
            return;
          }
          const body = isCustomized(endpoint)
            ? buildEndpointBody(
                { event: envelope.event, timestamp: envelope.timestamp, data: (data ?? {}) as Record<string, unknown> },
                endpoint,
                ctx,
              )
            : envelope;
          const result = await WebhookDispatcher.dispatch(endpoint, event, body, { attemptCount: 1 });
          try {
            await queue.recordFirstAttempt({
              endpointId: endpoint.id,
              eventType: event,
              payload: body,
              result,
              maxAttempts: DEFAULT_MAX_ATTEMPTS,
              deliveryKey: orderId ? `${endpoint.id}:${event}:${orderId}` : null,
            });
          } catch (recordErr) {
            console.error('[WebhookService.trigger] Failed to record attempt:', recordErr);
          }
        }),
      );
    } catch (err) {
      console.error('[WebhookService.trigger] Unexpected error:', err);
    }
  }

  /** Send a test event to a specific endpoint (one-shot, no retry semantics). */
  static async testEndpoint(endpointId: string, eventType: string = 'test.event', client?: SupabaseClientLike) {
    const supabase = client || createAdminClient();

    const { data: endpoint, error } = await supabase
      .from('webhook_endpoints')
      .select('id, url, secret')
      .eq('id', endpointId)
      .single();
    if (error || !endpoint) throw new Error('Endpoint not found');

    const mockData = WEBHOOK_MOCK_PAYLOADS[eventType] || WEBHOOK_MOCK_PAYLOADS['test.event'];
    const envelope: EnvelopePayload = {
      event: eventType,
      timestamp: new Date().toISOString(),
      data: mockData,
    };

    const result = await WebhookDispatcher.dispatch(endpoint, eventType, envelope, { attemptCount: 1 });
    const queue = new SupabaseWebhookQueue(supabase);
    await queue.recordFirstAttempt({
      endpointId,
      eventType,
      payload: envelope,
      result,
      maxAttempts: 1,
    });
    return { success: result.ok, status: result.httpStatus, error: result.errorMessage };
  }

  /**
   * Legacy retry path for status='failed' rows (creates a NEW log entry
   * and marks the old log 'retried'). Backward-compatible with the
   * existing /api/v1/webhooks/logs/[id]/retry endpoint. New rows produced
   * by trigger() land in 'pending_retry' instead and are handled by the
   * worker; the admin /replay endpoint operates on those via the queue.
   */
  static async retry(logId: string, client?: SupabaseClientLike) {
    const supabase = client || createAdminClient();

    const { data: log, error: logError } = await supabase
      .from('webhook_logs')
      .select('payload, endpoint_id, event_type')
      .eq('id', logId)
      .single();
    if (logError || !log) throw new Error('Log entry not found');
    if (!log.endpoint_id) throw new Error('Endpoint ID is missing in log entry');

    const { data: endpoint, error: endpointError } = await supabase
      .from('webhook_endpoints')
      .select('id, url, secret')
      .eq('id', log.endpoint_id)
      .single();
    if (endpointError || !endpoint) throw new Error('Endpoint not found');

    const result = await WebhookDispatcher.dispatch(
      endpoint,
      log.event_type,
      log.payload,
      { attemptCount: 1, extraHeaders: { 'X-Sellf-Retry': 'true' } },
    );

    const queue = new SupabaseWebhookQueue(supabase);
    await queue.recordFirstAttempt({
      endpointId: endpoint.id,
      eventType: log.event_type,
      payload: log.payload,
      result,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
    });

    if (result.ok || result.httpStatus > 0) {
      await supabase.from('webhook_logs').update({ status: 'retried' }).eq('id', logId);
    }

    return { success: result.ok, status: result.httpStatus, error: result.errorMessage };
  }
}

function buildPlaceholderContext(data: unknown): Record<string, string> {
  const d = (data ?? {}) as Record<string, any>;
  const product = (d.product ?? {}) as Record<string, any>;
  const flat: Record<string, string> = {
    email: str(d.customer_email ?? d.email),
    amount: str(d.amount_display ?? d.amount),
    amount_minor: str(d.amount),
    currency: str(d.currency),
    product_name: str(product.name ?? d.product_name),
    product_slug: str(product.slug ?? d.product_slug),
    order_id: str(d.payment_intent_id ?? d.order_id ?? d.session_id),
    invoice_url: str(d.invoice_url),
  };
  const custom = (d.custom_field_values ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(custom)) flat[`custom_${k}`] = str(v);
  return flat;
}
function str(v: unknown): string { return v == null ? '' : String(v); }
