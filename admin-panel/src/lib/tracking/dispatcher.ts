/**
 * Central tracking dispatcher.
 *
 * One place where:
 *   1. consent-mode decides what happens with this event
 *   2. configured destinations fan out in parallel
 *   3. every outcome (success, fail, skip) lands in tracking_logs (audit)
 *
 * Callers (Stripe webhook, client proxy) own zero policy. They build a
 * TrackingEvent + read the active config + pass the consent state they know,
 * and the dispatcher does the rest.
 *
 * @see lib/tracking/destinations.ts — TrackingDestination adapters
 * @see lib/tracking/consent-mode.ts — resolveTrackingDecision policy
 */

import { resolveTrackingDecision, type ConversionTrackingMode } from './consent-mode';
import {
  ALL_DESTINATIONS,
  fbCapiDestination,
  gtmSsDestination,
  type DestinationConfig,
  type DestinationResult,
  type TrackingDestination,
  type TrackingEvent,
} from './destinations';
import { logTrackingEvent } from './server';

export interface DispatchContext {
  mode: ConversionTrackingMode;
  hasConsent: boolean;
  /** Where the dispatch was invoked from — used for audit log filtering. */
  source: 'server' | 'client_proxy';
  /** Plaintext email for audit row only. Destinations always receive the hashed form via event.userData. */
  customerEmailForAudit?: string;
}

export interface DispatchResult {
  anySuccess: boolean;
  results: DestinationResult[];
  skipped?: { reason: string };
}

/**
 * For tests/callers that want to inject custom destinations (e.g. add a
 * TikTok adapter without modifying the global list). Production paths use
 * ALL_DESTINATIONS via the default argument.
 */
export interface DispatchDeps {
  destinations?: readonly TrackingDestination[];
}

async function timed(fn: () => Promise<DestinationResult>) {
  const start = Date.now();
  const result = await fn();
  return { result, durationMs: Date.now() - start };
}

function commonAuditFields(event: TrackingEvent, ctx: DispatchContext) {
  return {
    eventName: event.eventName,
    eventId: event.eventId,
    source: ctx.source,
    orderId: event.orderId,
    productId: event.contentIds[0],
    customerEmail: ctx.customerEmailForAudit,
    value: event.value,
    currency: event.currency,
    eventSourceUrl: event.eventSourceUrl,
  };
}

export async function dispatchTrackingEvent(
  event: TrackingEvent,
  config: DestinationConfig,
  ctx: DispatchContext,
  deps: DispatchDeps = {}
): Promise<DispatchResult> {
  const destinations = (deps.destinations ?? ALL_DESTINATIONS).filter((d) => d.isConfigured(config));

  if (destinations.length === 0) {
    await logTrackingEvent({
      ...commonAuditFields(event, ctx),
      status: 'skipped',
      skipReason: 'no_destination_configured',
    });
    return { anySuccess: false, results: [], skipped: { reason: 'no_destination_configured' } };
  }

  const decision = resolveTrackingDecision({
    mode: ctx.mode,
    hasConsent: ctx.hasConsent,
    eventName: event.eventName,
  });

  if (decision.action === 'skip') {
    await logTrackingEvent({
      ...commonAuditFields(event, ctx),
      status: 'skipped',
      skipReason: decision.reason,
    });
    return { anySuccess: false, results: [], skipped: { reason: decision.reason } };
  }

  const sends = destinations.map((dest) => timed(() => dest.send(event, decision, config)));
  const settled = await Promise.all(sends);

  const results: DestinationResult[] = [];
  for (const { result, durationMs } of settled) {
    results.push(result);
    await logTrackingEvent({
      ...commonAuditFields(event, ctx),
      status: result.success ? 'success' : 'failed',
      destination: result.destination,
      httpStatus: result.httpStatus,
      eventsReceived: result.eventsReceived,
      errorMessage: result.error,
      durationMs,
    });
  }

  return { anySuccess: results.some((r) => r.success), results };
}

export { fbCapiDestination, gtmSsDestination };
