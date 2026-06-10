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
      // Empty string (no order id) collapses to null so the delivery key stays
      // null. Derived from the SAME helper as the {{order_id}} placeholder so the
      // two can never drift.
      const orderId = deriveOrderId(data) || null;

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
      // Include customization columns so the test request is sent AS CONFIGURED
      // (same headers/fields/selection the real trigger() path applies), instead
      // of a plain envelope that omits the endpoint's Authorization header etc.
      .select('id, url, secret, custom_headers_encrypted, custom_payload_fields, payload_field_selection')
      .eq('id', endpointId)
      .single();
    if (error || !endpoint) throw new Error('Endpoint not found');

    const mockData = WEBHOOK_MOCK_PAYLOADS[eventType] || WEBHOOK_MOCK_PAYLOADS['test.event'];
    const timestamp = new Date().toISOString();
    const envelope: EnvelopePayload = {
      event: eventType,
      timestamp,
      data: mockData,
    };

    // When the endpoint carries any customization, build the body the SAME way
    // trigger() does (field selection + {{placeholder}} extra fields). Otherwise
    // keep the plain mock envelope. The customized body is also what we persist
    // in recordFirstAttempt so the test log reflects exactly what was sent.
    const isCustomized =
      endpoint.custom_headers_encrypted != null ||
      endpoint.custom_payload_fields != null ||
      endpoint.payload_field_selection != null;
    const body: unknown = isCustomized
      ? buildEndpointBody(
          { event: eventType, timestamp, data: (mockData ?? {}) as Record<string, unknown> },
          endpoint,
          buildPlaceholderContext(mockData),
        )
      : envelope;

    const result = await WebhookDispatcher.dispatch(endpoint, eventType, body, { attemptCount: 1 });
    const queue = new SupabaseWebhookQueue(supabase);
    await queue.recordFirstAttempt({
      endpointId,
      eventType,
      payload: body,
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
      .select('id, url, secret, custom_headers_encrypted')
      .eq('id', log.endpoint_id)
      .single();
    if (endpointError || !endpoint) throw new Error('Endpoint not found');

    const result = await WebhookDispatcher.dispatch(
      // Include custom_headers_encrypted so manual retries re-apply the endpoint's
      // configured headers (same defect as the cron retry path).
      { id: endpoint.id, url: endpoint.url, secret: endpoint.secret, custom_headers_encrypted: endpoint.custom_headers_encrypted },
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

/**
 * Build the {{placeholder}} substitution context for an outbound webhook body
 * from the REAL nested `purchase.completed` payload (`PurchaseWebhookData` —
 * see src/lib/services/webhook-payload.ts). Reads `customer`/`product`/`order`
 * and the resolved `customFields` (DisplayCustomField), NOT flat top-level keys.
 * Exported for unit testing.
 */
export function buildPlaceholderContext(data: unknown): Record<string, string> {
  const d = (data ?? {}) as Record<string, any>;
  const customer = (d.customer ?? {}) as Record<string, any>;
  const product = (d.product ?? {}) as Record<string, any>;
  const order = (d.order ?? {}) as Record<string, any>;
  const amount = order.amount;
  const flat: Record<string, string> = {
    email: str(customer.email),
    first_name: str(customer.firstName),
    last_name: str(customer.lastName),
    amount: str(amount),                                   // raw minor units (cents)
    amount_major: amount != null ? (Number(amount) / 100).toFixed(2) : '', // convenience
    currency: str(order.currency),
    product_name: str(product.name),
    product_slug: str(product.slug),
    order_id: deriveOrderId(d),
  };
  const customFields = Array.isArray(d.customFields) ? d.customFields : [];
  for (const f of customFields) {
    // DisplayCustomField carries the machine key as `id` (label is the display
    // text). Fall back through key/name/id so older/other shapes still resolve;
    // use the machine key, not the display label.
    const key = f?.key ?? f?.name ?? f?.id;
    if (key != null && key !== '') flat[`custom_${String(key)}`] = str(f?.value);
  }
  return flat;
}

/**
 * Single source of truth for an event's order id, used both for the {{order_id}}
 * placeholder and the queue delivery key. Returns '' when the (nested) payload
 * has no order id. Exported for unit testing.
 */
export function deriveOrderId(data: unknown): string {
  const order = ((data ?? {}) as Record<string, any>).order ?? {};
  return str(order.paymentIntentId ?? order.sessionId);
}

function str(v: unknown): string { return v == null ? '' : String(v); }
