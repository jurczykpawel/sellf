import crypto from 'crypto';
import { fetch as undiciFetch } from 'undici';
import { getSsrfSafeAgent } from '@/lib/security/safe-fetch';
import { validateWebhookUrlAsync } from '@/lib/validations/webhook';
import type { AttemptResult } from './types';

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BODY_CHARS = 5000;

interface EndpointSlice {
  id: string;
  url: string;
  secret: string;
}

interface DispatchOptions {
  attemptCount: number;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
}

export class WebhookDispatcher {
  static async dispatch(
    endpoint: EndpointSlice,
    event: string,
    payload: unknown,
    options: DispatchOptions,
  ): Promise<AttemptResult> {
    const payloadString = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha256', endpoint.secret)
      .update(payloadString)
      .digest('hex');
    const timestamp = extractTimestamp(payload) ?? new Date().toISOString();
    const startTime = Date.now();

    try {
      const guard = await validateWebhookUrlAsync(endpoint.url);
      if (!guard.valid) {
        return {
          ok: false,
          httpStatus: 0,
          responseBody: null,
          errorMessage: `Webhook URL rejected: ${guard.error || 'failed validation'}`,
          durationMs: Date.now() - startTime,
        };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      try {
        // Security: callers can pass extra headers (e.g. X-Sellf-Retry), but the
        // signature/timestamp/event/content-type headers are owned by the
        // dispatcher and must never be overwritten by an extraHeaders entry.
        const headers: Record<string, string> = {
          ...(options.extraHeaders ?? {}),
          'Content-Type': 'application/json',
          'X-Sellf-Event': event,
          'X-Sellf-Signature': signature,
          'X-Sellf-Timestamp': timestamp,
        };
        if (options.attemptCount > 1) {
          headers['X-Sellf-Retry-Attempt'] = String(options.attemptCount);
        }

        const response = await undiciFetch(endpoint.url, {
          method: 'POST',
          headers,
          body: payloadString,
          signal: controller.signal,
          redirect: 'error',
          dispatcher: getSsrfSafeAgent(),
        });

        const text = await response.text();
        const trimmed = text ? text.substring(0, MAX_RESPONSE_BODY_CHARS) : '';

        return {
          ok: response.ok,
          httpStatus: response.status,
          responseBody: trimmed,
          errorMessage: response.ok ? null : `HTTP ${response.status}`,
          durationMs: Date.now() - startTime,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      const error = err as Error;
      if (error.name === 'AbortError') {
        return {
          ok: false,
          httpStatus: 408,
          responseBody: null,
          errorMessage: 'Request timed out (5s)',
          durationMs: Date.now() - startTime,
        };
      }
      return {
        ok: false,
        httpStatus: 0,
        responseBody: null,
        errorMessage: error.message,
        durationMs: Date.now() - startTime,
      };
    }
  }
}

function extractTimestamp(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const ts = (payload as { timestamp?: unknown }).timestamp;
  return typeof ts === 'string' ? ts : null;
}
