import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { computeNextRetry, DEFAULT_MAX_ATTEMPTS, hasMoreAttempts } from './retry-policy';
import type {
  AttemptResult,
  DueDelivery,
  FirstAttemptInput,
  IWebhookDeliveryQueue,
  RecordedDelivery,
} from './types';

const MAX_RESPONSE_BODY_CHARS = 5000;

// replay/forceRetryNow/cancel intentionally have no tenant ownership filter:
// Sellf is single-tenant and webhook admin actions go through API key auth
// guarded by webhooks:write scope. If multi-tenant API keys land later, add an
// owner check at the route layer or pass an owner predicate into these methods.

// Supabase clients with different schema types can't be unified via generics.
// This alias accepts any schema-scoped client (public, seller_X, etc.).
type SupabaseClientLike = SupabaseClient<any, any, any>;

interface InitialState {
  status: 'success' | 'pending_retry' | 'permanently_failed';
  nextRetryAt: string | null;
  failedPermanentlyAt: string | null;
}

interface PickDueRow {
  id: string;
  endpoint_id: string;
  event_type: string;
  payload: unknown;
  attempt_count: number;
  max_attempts: number;
}

export class SupabaseWebhookQueue implements IWebhookDeliveryQueue {
  private readonly client: SupabaseClientLike;

  constructor(client?: SupabaseClientLike) {
    this.client = client ?? (createAdminClient() as SupabaseClientLike);
  }

  async recordFirstAttempt(input: FirstAttemptInput): Promise<RecordedDelivery> {
    const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const { status, nextRetryAt, failedPermanentlyAt } = resolveInitialState(input.result, 1, maxAttempts);

    const { data, error } = await this.client
      .from('webhook_logs')
      .insert({
        endpoint_id: input.endpointId,
        event_type: input.eventType,
        payload: input.payload,
        status,
        http_status: input.result.httpStatus,
        response_body: trimBody(input.result.responseBody),
        error_message: input.result.errorMessage,
        duration_ms: input.result.durationMs,
        attempt_count: 1,
        max_attempts: maxAttempts,
        next_retry_at: nextRetryAt,
        failed_permanently_at: failedPermanentlyAt,
      })
      .select('id')
      .single();

    if (error) throw new Error(`recordFirstAttempt failed: ${error.message}`);
    return { deliveryId: data.id, willRetry: status === 'pending_retry' };
  }

  async pickDue(limit: number): Promise<DueDelivery[]> {
    const { data, error } = await this.client.rpc('pick_due_webhook_deliveries', { p_limit: limit });
    if (error) throw new Error(`pickDue failed: ${error.message}`);
    return ((data ?? []) as PickDueRow[]).map((row) => ({
      id: row.id,
      endpointId: row.endpoint_id,
      eventType: row.event_type,
      payload: row.payload,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
    }));
  }

  async markDelivered(deliveryId: string, result: AttemptResult): Promise<void> {
    const { error } = await this.client.rpc('increment_webhook_attempt', {
      p_log_id: deliveryId,
      p_status: 'success',
      p_http_status: result.httpStatus,
      p_response_body: trimBody(result.responseBody),
      p_error_message: result.errorMessage,
      p_duration_ms: result.durationMs,
      p_next_retry_at: null,
      p_failed_permanently_at: null,
    });
    if (error) throw new Error(`markDelivered failed: ${error.message}`);
  }

  async markFailed(deliveryId: string, result: AttemptResult, nextRetryAt: Date): Promise<void> {
    const { error } = await this.client.rpc('increment_webhook_attempt', {
      p_log_id: deliveryId,
      p_status: 'pending_retry',
      p_http_status: result.httpStatus,
      p_response_body: trimBody(result.responseBody),
      p_error_message: result.errorMessage,
      p_duration_ms: result.durationMs,
      p_next_retry_at: nextRetryAt.toISOString(),
      p_failed_permanently_at: null,
    });
    if (error) throw new Error(`markFailed failed: ${error.message}`);
  }

  async markPermanentlyFailed(deliveryId: string, result: AttemptResult): Promise<void> {
    const { error } = await this.client.rpc('increment_webhook_attempt', {
      p_log_id: deliveryId,
      p_status: 'permanently_failed',
      p_http_status: result.httpStatus,
      p_response_body: trimBody(result.responseBody),
      p_error_message: result.errorMessage,
      p_duration_ms: result.durationMs,
      p_next_retry_at: null,
      p_failed_permanently_at: new Date().toISOString(),
    });
    if (error) throw new Error(`markPermanentlyFailed failed: ${error.message}`);
  }

  async replay(deliveryId: string): Promise<void> {
    const { error } = await this.client
      .from('webhook_logs')
      .update({
        status: 'pending_retry',
        attempt_count: 0,
        next_retry_at: new Date().toISOString(),
        failed_permanently_at: null,
      })
      .eq('id', deliveryId)
      .eq('status', 'permanently_failed');
    if (error) throw new Error(`replay failed: ${error.message}`);
  }

  async forceRetryNow(deliveryId: string): Promise<void> {
    const { error } = await this.client
      .from('webhook_logs')
      .update({ next_retry_at: new Date().toISOString() })
      .eq('id', deliveryId)
      .eq('status', 'pending_retry');
    if (error) throw new Error(`forceRetryNow failed: ${error.message}`);
  }

  async cancel(deliveryId: string): Promise<void> {
    const { error } = await this.client
      .from('webhook_logs')
      .update({
        status: 'permanently_failed',
        next_retry_at: null,
        failed_permanently_at: new Date().toISOString(),
      })
      .eq('id', deliveryId)
      .eq('status', 'pending_retry');
    if (error) throw new Error(`cancel failed: ${error.message}`);
  }
}

function resolveInitialState(
  result: AttemptResult,
  attemptCount: number,
  maxAttempts: number,
): InitialState {
  if (result.ok) {
    return { status: 'success', nextRetryAt: null, failedPermanentlyAt: null };
  }
  if (!hasMoreAttempts(attemptCount, maxAttempts)) {
    return {
      status: 'permanently_failed',
      nextRetryAt: null,
      failedPermanentlyAt: new Date().toISOString(),
    };
  }
  return {
    status: 'pending_retry',
    nextRetryAt: computeNextRetry(attemptCount).toISOString(),
    failedPermanentlyAt: null,
  };
}

function trimBody(body: string | null): string | null {
  if (!body) return null;
  return body.length > MAX_RESPONSE_BODY_CHARS ? body.substring(0, MAX_RESPONSE_BODY_CHARS) : body;
}
