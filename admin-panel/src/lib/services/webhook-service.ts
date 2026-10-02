import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { WEBHOOK_MOCK_PAYLOADS } from '@/lib/webhooks/mock-payloads';
import { SupabaseWebhookQueue } from '@/lib/services/webhook-queue/supabase-queue';
import { WebhookDispatcher } from '@/lib/services/webhook-queue/dispatcher';
import { computeNextRetry } from '@/lib/services/webhook-queue/retry-policy';
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
   * Every delivery is persisted before dispatch. Failed or interrupted attempts
   * remain available to the worker with the same delivery id.
   */
  static async trigger(
    event: string,
    data: unknown,
    client?: SupabaseClientLike,
    productIds?: string | string[],
  ): Promise<void> {
    const supabase = client || createAdminClient();
    const queue = new SupabaseWebhookQueue(supabase);

    const endpoints = await fetchEligibleEndpoints(supabase, event, productIds);
    const timestamp = new Date().toISOString();
    const envelope: EnvelopePayload = { event, timestamp, data };
    const isCustomized = (e: typeof endpoints[number]) =>
      e.custom_headers_encrypted != null || e.custom_payload_fields != null || e.payload_field_selection != null;
    const licenseOk = endpoints.some(isCustomized)
      ? await checkFeature('webhook-payload-customization', { dataClient: supabase }) : true;
    const ctx = buildPlaceholderContext(data);
    const orderId = deriveOrderId(data) || null;
    // Persist every eligible endpoint before any HTTP request begins.
    const deliveries = [];
    for (const endpoint of endpoints) {
      if (isCustomized(endpoint) && !licenseOk) continue;
      const id = randomUUID();
      const body = {
        ...(isCustomized(endpoint)
          ? buildEndpointBody({ event, timestamp, data: (data ?? {}) as Record<string, unknown> }, endpoint, ctx)
          : envelope),
        id,
      };
      const delivery = await queue.enqueue({
        endpointId: endpoint.id, eventType: event, payload: body, deliveryId: id,
        deliveryKey: orderId ? `${endpoint.id}:${event}:${orderId}` : null,
      });
      if (delivery) deliveries.push({ endpoint, delivery });
    }
    await Promise.all(deliveries.map(async ({ endpoint, delivery }) => {
      const result = await WebhookDispatcher.dispatch(endpoint, event, delivery.payload, {
        attemptCount: 1, deliveryId: delivery.id,
      });
      if (result.ok) await queue.markDelivered(delivery.id, result);
      else await queue.markFailed(delivery.id, result, computeNextRetry(1));
    }));
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

    const id = randomUUID();
    const payload = { ...(body as Record<string, unknown>), id };
    const queue = new SupabaseWebhookQueue(supabase);
    const delivery = await queue.enqueue({ endpointId, eventType, payload, deliveryId: id, deliveryKey: null, maxAttempts: 1 });
    if (!delivery) throw new Error('Test delivery unavailable');
    const result = await WebhookDispatcher.dispatch(endpoint, eventType, payload, { attemptCount: 1, deliveryId: id });
    if (result.ok) await queue.markDelivered(id, result);
    else await queue.markPermanentlyFailed(id, result);
    return { success: result.ok, status: result.httpStatus, error: result.errorMessage };
  }

  /**
   * Manual retry for legacy failed rows. Retains the same delivery id and
   * updates the existing queue row.
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

    const payload = { ...(log.payload ?? {}), id: logId };
    const { error: prepareError } = await supabase.from('webhook_logs')
      .update({ payload, status: 'pending_retry', next_retry_at: 'now' })
      .eq('id', logId).eq('status', 'failed');
    if (prepareError) throw new Error('Could not prepare delivery');
    const { data: claims, error: claimError } = await supabase.rpc('claim_webhook_delivery', { p_id: logId });
    if (claimError) throw new Error('Could not claim delivery');
    const claim = claims?.[0];
    if (!claim) return { success: false, status: 0, error: 'Delivery is already handled' };
    const result = await WebhookDispatcher.dispatch(endpoint, log.event_type, payload, {
      attemptCount: claim.attempt_count + 1, deliveryId: logId,
    });
    const queue = new SupabaseWebhookQueue(supabase);
    if (result.ok) await queue.markDelivered(logId, result);
    else await queue.markFailed(logId, result, computeNextRetry(claim.attempt_count + 1));
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
  return str(order.paymentIntentId ?? order.sessionId ?? order.invoiceId ?? ((data ?? {}) as Record<string, any>).invoice?.stripeInvoiceId);
}

function str(v: unknown): string { return v == null ? '' : String(v); }
