import { createAdminClient } from '@/lib/supabase/admin';
import { WEBHOOK_MOCK_PAYLOADS } from '@/lib/webhooks/mock-payloads';
import crypto from 'crypto';

interface WebhookPayload {
  event: string;
  timestamp: string;
  data: any;
}

// Supabase clients with different schema types can't be unified via generics.
// This alias accepts any schema-scoped client (seller_main, seller_X, etc.)
// Supabase clients with different schema types can't be unified via generics.
// This alias accepts any schema-scoped client (seller_main, seller_X, etc.)
type SupabaseClientLike = any;

export class WebhookService {
  /**
   * Triggers webhooks for a specific event to all subscribers.
   * @param event - event type (e.g. 'purchase.completed')
   * @param data - event payload data
   * @param client - optional schema-scoped Supabase client (defaults to seller_main)
   */
  static async trigger(event: string, data: any, client?: SupabaseClientLike) {
    const supabase = client || createAdminClient();

    try {
      const { data: endpoints, error } = await supabase
        .from('webhook_endpoints')
        .select('id, url, secret')
        .eq('is_active', true)
        .contains('events', [event]);

      if (error) {
        console.error('Failed to fetch webhook endpoints:', error);
        return;
      }

      if (!endpoints || endpoints.length === 0) {
        return;
      }

      const timestamp = new Date().toISOString();
      const payload: WebhookPayload = { event, timestamp, data };

      // Execute in parallel
      const promises = endpoints.map((endpoint: { id: string; url: string; secret: string }) =>
        this.dispatchWebhook(endpoint, event, payload, {}, supabase)
      );

      await Promise.allSettled(promises);

    } catch (err) {
      console.error('Error in WebhookService.trigger:', err);
    }
  }

  /**
   * Sends a test event to a specific endpoint
   * @param client - optional schema-scoped Supabase client (defaults to seller_main)
   */
  static async testEndpoint(endpointId: string, eventType: string = 'test.event', client?: SupabaseClientLike) {
    const supabase = client || createAdminClient();

    const { data: endpoint, error } = await supabase
      .from('webhook_endpoints')
      .select('*')
      .eq('id', endpointId)
      .single();

    if (error || !endpoint) {
      throw new Error('Endpoint not found');
    }

    const mockData = WEBHOOK_MOCK_PAYLOADS[eventType] || WEBHOOK_MOCK_PAYLOADS['test.event'];
    const timestamp = new Date().toISOString();
    const payload: WebhookPayload = {
      event: eventType,
      timestamp,
      data: mockData,
    };

    return this.dispatchWebhook(endpoint, eventType, payload, {}, supabase);
  }

  /**
   * Retries a specific webhook log entry.
   * Marks the old log as 'retried' if the retry request is dispatched successfully.
   * @param client - optional schema-scoped Supabase client (defaults to seller_main)
   */
  static async retry(logId: string, client?: SupabaseClientLike) {
    const supabase = client || createAdminClient();

    const { data: log, error: logError } = await supabase
      .from('webhook_logs')
      .select('payload, endpoint_id, event_type')
      .eq('id', logId)
      .single();

    if (logError || !log) {
      throw new Error('Log entry not found');
    }

    if (!log.endpoint_id) {
      throw new Error('Endpoint ID is missing in log entry');
    }

    const { data: endpoint, error: endpointError } = await supabase
      .from('webhook_endpoints')
      .select('id, url, secret')
      .eq('id', log.endpoint_id)
      .single();

    if (endpointError || !endpoint) {
      throw new Error('Endpoint not found');
    }

    const options = { headers: { 'X-Sellf-Retry': 'true' } };
    const result = await this.dispatchWebhook(endpoint, log.event_type, log.payload, options, supabase);

    // If dispatch executed (even if it failed HTTP-wise, we logged a new attempt),
    // mark the OLD log as retried to clean up the queue.
    if (result.success || result.status > 0) {
      await supabase
        .from('webhook_logs')
        .update({ status: 'retried' })
        .eq('id', logId);
    }

    return result;
  }

  /**
   * Core dispatch logic (DRY)
   * Handles signing, sending, and logging.
   */
  private static async dispatchWebhook(
    endpoint: { id: string; url: string; secret: string },
    event: string,
    payload: any,
    extraOptions: { headers?: Record<string, string> } = {},
    client?: SupabaseClientLike
  ) {
    const supabase = client || createAdminClient();
    const payloadString = JSON.stringify(payload);
    const signature = this.signPayload(payloadString, endpoint.secret);
    const timestamp = payload.timestamp || new Date().toISOString();

    let responseStatus = 0;
    let responseBody = '';
    let errorMessage = null;
    let status = 'failed';
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sellf-Event': event,
          'X-Sellf-Signature': signature,
          'X-Sellf-Timestamp': timestamp,
          ...extraOptions.headers
        },
        body: payloadString,
        signal: controller.signal,
        redirect: 'error',  // SECURITY: block redirect-based SSRF
      });

      clearTimeout(timeoutId);

      responseStatus = response.status;
      responseBody = await response.text();

      if (response.ok) {
        status = 'success';
      } else {
        status = 'failed';
        errorMessage = `HTTP ${response.status}`;
      }

    } catch (err: any) {
      status = 'failed';
      if (err.name === 'AbortError') {
        errorMessage = 'Request timed out (5s)';
        responseStatus = 408;
      } else {
        errorMessage = err.message;
        responseStatus = 0; // Network error
      }
    } finally {
      const duration = Date.now() - startTime;

      // Log result
      await supabase.from('webhook_logs').insert({
        endpoint_id: endpoint.id,
        event_type: event,
        payload: payload,
        status: status,
        http_status: responseStatus,
        response_body: responseBody ? responseBody.substring(0, 5000) : null,
        error_message: errorMessage,
        duration_ms: duration,
      });
    }

    return { success: status === 'success', status: responseStatus, error: errorMessage };
  }

  private static signPayload(payload: string, secret: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  }
}
