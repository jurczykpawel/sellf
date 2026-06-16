/**
 * Subscription-side gate for paid webhook events.
 *
 * Some events (see EVENT_FEATURE_REQUIREMENTS) may only be subscribed to with an
 * active paid feature. This rejects subscribing to such an event without it; the
 * dispatcher (WebhookService / the event's emit site) independently re-checks the
 * feature, so a downgrade never silently keeps delivering a gated event.
 */

import { checkFeature } from '@/lib/license/resolve';
import { EVENT_FEATURE_REQUIREMENTS, type Feature } from '@/lib/license/features';

type DataClient = { from: (table: string) => unknown };

export interface EventFeatureDenial {
  event: string;
  feature: Feature;
}

/**
 * Returns the first event whose required feature is inactive, or null when every
 * subscribed event is allowed. Each distinct required feature is checked once.
 */
export async function findDeniedEventFeature(
  events: readonly string[],
  dataClient?: DataClient,
): Promise<EventFeatureDenial | null> {
  // feature -> first event that needs it (so the error names a concrete event)
  const required = new Map<Feature, string>();
  for (const event of events) {
    const feature = (EVENT_FEATURE_REQUIREMENTS as Record<string, Feature>)[event];
    if (feature && !required.has(feature)) required.set(feature, event);
  }

  for (const [feature, event] of required) {
    const ok = await checkFeature(feature, dataClient ? { dataClient } : undefined);
    if (!ok) return { event, feature };
  }
  return null;
}
