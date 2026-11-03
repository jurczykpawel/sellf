/**
 * Attribution runtime for scripts Sellf serves to sellers' own pages (embed checkout loader,
 * content gate). Serializes the same collector the React checkout uses, so there is one
 * implementation. Defines in the enclosing scope:
 *   - sellfAttribution(): AttributionPayload | undefined — records the visit and returns the payload;
 *   - sellfDecorateLinks(sellfOrigin) — appends the payload to links leading to the Sellf checkout
 *     on another domain (cross-domain handoff, `sf_a` parameter).
 *
 * Consent on a seller's page: `window.sellfAttributionConsent = 'none' | 'analytics' | 'marketing'`
 * set by the seller's own cookie banner, else Sellf's banner cookie if present, else none
 * (URL-only mode, nothing stored).
 *
 * @see src/lib/attribution/collect.ts
 */

import { ATTRIBUTION_STORAGE_KEY, collectAttribution, decorateCheckoutUrl } from '@/lib/attribution/collect';
import { CONSENT_COOKIE_NAME } from '@/lib/constants';

export function buildAttributionRuntime(): string {
  return `
  var sellfCollect = (${collectAttribution.toString()});
  var sellfDecorate = (${decorateCheckoutUrl.toString()});
  function sellfConsent() {
    var declared = window.sellfAttributionConsent;
    if (declared === 'none' || declared === 'analytics' || declared === 'marketing') return declared;
    try {
      var parts = document.cookie.split(';');
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i].trim();
        if (part.indexOf(${JSON.stringify(`${CONSENT_COOKIE_NAME}=`)}) !== 0) continue;
        var parsed = JSON.parse(decodeURIComponent(part.slice(${CONSENT_COOKIE_NAME.length + 1})));
        var categories = parsed && Array.isArray(parsed.categories) ? parsed.categories : [];
        if (categories.indexOf('marketing') !== -1) return 'marketing';
        if (categories.indexOf('analytics') !== -1) return 'analytics';
      }
    } catch (e) {}
    return 'none';
  }
  function sellfAttribution() {
    try {
      var key = ${JSON.stringify(ATTRIBUTION_STORAGE_KEY)};
      var stored = null;
      try { stored = window.localStorage.getItem(key); } catch (e) {}
      var result = sellfCollect({ href: location.href, referrer: document.referrer, now: Date.now(), consent: sellfConsent(), stored: stored });
      try {
        if (result.store) window.localStorage.setItem(key, result.store);
        else window.localStorage.removeItem(key);
      } catch (e) {}
      return result.payload;
    } catch (e) {
      return undefined;
    }
  }
  function sellfDecorateLinks(origin) {
    var handler = function (event) {
      var node = event.target;
      while (node && node.tagName !== 'A') node = node.parentNode;
      if (!node || !node.href) return;
      try {
        var target = new URL(node.href, location.href);
        if (target.origin !== origin || target.origin === location.origin) return;
        var payload = sellfAttribution();
        if (payload) node.href = sellfDecorate(target.toString(), payload);
      } catch (e) {}
    };
    document.addEventListener('mousedown', handler, true);
    document.addEventListener('keydown', function (event) { if (event.key === 'Enter') handler(event); }, true);
    document.addEventListener('touchstart', handler, { capture: true, passive: true });
  }
`;
}
