'use client';

import { useCallback, useMemo } from 'react';
import {
  trackEvent,
  type GA4EventName,
  type TrackingEventData,
  type TrackingConfigFromDB,
} from '@/lib/tracking';
import { useTrackingConfig } from '@/components/providers/tracking-config-provider';

/**
 * React hook for tracking ecommerce events
 *
 * Uses tracking config from context automatically.
 * Optionally accepts config directly for custom use cases.
 *
 * @param configOverride - Optional config override (uses context by default)
 * @returns Object with track function
 *
 * @example
 * ```tsx
 * // Uses context automatically
 * const { track } = useTracking();
 *
 * // Track a purchase
 * await track('purchase', {
 *   transactionId: 'TXN_123',
 *   value: 99.00,
 *   currency: 'PLN',
 *   items: [{ item_id: 'prod_1', item_name: 'Course', price: 99, quantity: 1 }],
 *   userEmail: 'user@example.com'
 * });
 * ```
 */
export function useTracking(configOverride?: TrackingConfigFromDB | null) {
  const contextConfig = useTrackingConfig();
  const config = configOverride !== undefined ? configOverride : contextConfig;

  // Build tracking config from database config
  const trackingConfig = useMemo(
    () => ({
      gtmEnabled: !!config?.gtm_container_id,
      fbPixelEnabled: !!config?.facebook_pixel_id,
      fbCAPIEnabled: !!config?.fb_capi_enabled,
    }),
    [config?.gtm_container_id, config?.facebook_pixel_id, config?.fb_capi_enabled]
  );

  // Memoized track function
  const track = useCallback(
    async (eventName: GA4EventName, data: TrackingEventData, eventIdOverride?: string): Promise<void> => {
      // Don't track if no tracking is configured
      if (!trackingConfig.gtmEnabled && !trackingConfig.fbPixelEnabled && !trackingConfig.fbCAPIEnabled) {
        return;
      }

      return trackEvent(eventName, data, trackingConfig, eventIdOverride);
    },
    [trackingConfig]
  );

  return { track };
}
