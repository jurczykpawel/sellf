'use client';

/** Cart entry is recorded once per checkout form. @see lib/tracking/client.ts */
import { useEffect, useRef } from 'react';
import type { GA4EventName, TrackingEventData } from '@/lib/tracking/types';

export function useCartTracking(started: boolean, data: TrackingEventData,
  track: (name: GA4EventName, data: TrackingEventData) => unknown): void {
  const fired = useRef(false);
  useEffect(() => {
    if (!started || fired.current) return;
    fired.current = true;
    track('add_to_cart', data);
  }, [started, data, track]);
}
