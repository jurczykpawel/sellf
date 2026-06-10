import { fetch as undiciFetch } from 'undici';
import { getSsrfSafeAgent } from '@/lib/security/safe-fetch';
import { validateWebhookUrlAsync } from '@/lib/validations/webhook';
import { decryptHeaderMap } from '@/lib/webhooks/custom-headers';
import { signWebhookPayload } from './signature';
import type { AttemptResult } from './types';

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BODY_CHARS = 5000;

interface EndpointSlice {
  id: string;
  url: string;
  secret: string;
  custom_headers_encrypted?: string | null;
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
    // Replay-resistant, versioned signature (t is inside the MAC). See signature.ts.
    const signature = signWebhookPayload(endpoint.secret, payloadString);
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
        // Per-endpoint custom headers are stored encrypted; decrypt them here so
        // they apply on every attempt (first send AND retries). A decryption
        // failure must not silently drop the configured headers, so we abort the
        // attempt (the surrounding `finally` still clears the timeout).
        let customHeaders: Record<string, string> = {};
        if (endpoint.custom_headers_encrypted) {
          try {
            customHeaders = await decryptHeaderMap(endpoint.custom_headers_encrypted);
          } catch {
            return {
              ok: false,
              httpStatus: 0,
              responseBody: null,
              errorMessage: 'Custom header decryption failed',
              durationMs: Date.now() - startTime,
            };
          }
        }

        // Security: custom headers and caller-supplied extra headers (e.g.
        // X-Sellf-Retry) are spread first, but the signature/event/content-type
        // headers are owned by the dispatcher and must never be overwritten.
        const headers: Record<string, string> = {
          ...customHeaders,
          ...(options.extraHeaders ?? {}),
          'Content-Type': 'application/json',
          'X-Sellf-Event': event,
          'X-Sellf-Signature': signature,
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
