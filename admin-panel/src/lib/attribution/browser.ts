/**
 * Purchase attribution on Sellf's own checkout pages (browser only).
 *
 * Consent comes from Sellf's cookie banner (vanilla-cookieconsent categories); without it the
 * checkout sends only the URL it was opened with and stores nothing.
 *
 * @see src/lib/attribution/collect.ts
 */

import { ATTRIBUTION_STORAGE_KEY, collectAttribution } from '@/lib/attribution/collect';
import { CONSENT_COOKIE_NAME } from '@/lib/constants';
import type { AttributionConsent, AttributionPayload } from '@/lib/attribution/collect';

export function consentFromCookie(cookieHeader: string): AttributionConsent {
  const entry = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith(`${CONSENT_COOKIE_NAME}=`));
  if (!entry) return 'none';
  try {
    const parsed = JSON.parse(decodeURIComponent(entry.slice(CONSENT_COOKIE_NAME.length + 1))) as { categories?: unknown };
    const categories = Array.isArray(parsed.categories) ? parsed.categories : [];
    if (categories.includes('marketing')) return 'marketing';
    if (categories.includes('analytics')) return 'analytics';
  } catch {
    // Malformed cookie: treat as no consent.
  }
  return 'none';
}

export function readBrowserAttribution(): AttributionPayload | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(ATTRIBUTION_STORAGE_KEY); } catch { stored = null; }
    const result = collectAttribution({
      href: window.location.href,
      referrer: document.referrer,
      now: Date.now(),
      consent: consentFromCookie(document.cookie),
      stored,
    });
    try {
      if (result.store) window.localStorage.setItem(ATTRIBUTION_STORAGE_KEY, result.store);
      else window.localStorage.removeItem(ATTRIBUTION_STORAGE_KEY);
    } catch {
      // Storage blocked (private mode): the payload still carries the current visit.
    }
    return result.payload;
  } catch {
    return undefined;
  }
}
