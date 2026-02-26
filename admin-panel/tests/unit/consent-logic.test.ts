/**
 * Unit tests for consent logic in FB CAPI tracking
 *
 * The canSendWithoutConsent function lives in the route handler
 * (src/app/api/tracking/fb-capi/route.ts) and cannot be imported directly.
 * Instead of maintaining a shadow copy, we verify the route source contains
 * the expected consent logic patterns.
 *
 * @see /src/app/api/tracking/fb-capi/route.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Route source for verification (read once)
// ---------------------------------------------------------------------------

const fbCapiRoutePath = resolve(
  __dirname,
  '../../src/app/api/tracking/fb-capi/route.ts'
);
const fbCapiRouteSource = readFileSync(fbCapiRoutePath, 'utf-8');

// ---------------------------------------------------------------------------
// Source verification tests — ensure production code has correct patterns
// ---------------------------------------------------------------------------

describe('FB CAPI Route - Consent Logic Source Verification', () => {
  describe('CONSENT_EXEMPT_EVENTS constant', () => {
    it('should define CONSENT_EXEMPT_EVENTS with only Purchase and Lead', () => {
      expect(fbCapiRouteSource).toMatch(
        /const CONSENT_EXEMPT_EVENTS\s*=\s*\['Purchase',\s*'Lead'\]/
      );
    });

    it('should not include browsing events in CONSENT_EXEMPT_EVENTS', () => {
      // Verify the exempt list does not contain non-conversion events
      const match = fbCapiRouteSource.match(
        /const CONSENT_EXEMPT_EVENTS\s*=\s*\[([^\]]+)\]/
      );
      expect(match).not.toBeNull();
      const events = match![1];
      expect(events).not.toContain('ViewContent');
      expect(events).not.toContain('InitiateCheckout');
      expect(events).not.toContain('AddPaymentInfo');
      expect(events).not.toContain('PageView');
    });
  });

  describe('canSendWithoutConsent function', () => {
    it('should be defined in the route source', () => {
      expect(fbCapiRouteSource).toContain('function canSendWithoutConsent(');
    });

    it('should accept eventName, hasConsent, and sendConversionsWithoutConsent parameters', () => {
      expect(fbCapiRouteSource).toMatch(
        /function canSendWithoutConsent\(\s*eventName:\s*string,\s*hasConsent:\s*boolean,\s*sendConversionsWithoutConsent:\s*boolean\s*\):\s*boolean/
      );
    });

    it('should return true early when user has consent', () => {
      expect(fbCapiRouteSource).toMatch(/if\s*\(hasConsent\)\s*return true/);
    });

    it('should block all events when sendConversionsWithoutConsent is disabled', () => {
      expect(fbCapiRouteSource).toMatch(
        /if\s*\(!sendConversionsWithoutConsent\)\s*return false/
      );
    });

    it('should check event against CONSENT_EXEMPT_EVENTS for consent-less sending', () => {
      expect(fbCapiRouteSource).toMatch(
        /return\s+CONSENT_EXEMPT_EVENTS\.includes\(eventName\)/
      );
    });
  });

  describe('canSendWithoutConsent usage in request handler', () => {
    it('should call canSendWithoutConsent with sanitized eventName in the POST handler', () => {
      expect(fbCapiRouteSource).toMatch(
        /canSendWithoutConsent\(\s*eventName/
      );
    });

    it('should pass hasConsent and sendConversionsWithoutConsent arguments', () => {
      expect(fbCapiRouteSource).toMatch(
        /canSendWithoutConsent\([^)]*hasConsent[^)]*sendConversionsWithoutConsent/
      );
    });
  });
});

describe('FB CAPI Route - Consent Decision Logic Order', () => {
  it('should check consent before checking sendConversionsWithoutConsent', () => {
    // The consent check (hasConsent → true) must come before the setting check
    const consentCheckIndex = fbCapiRouteSource.indexOf('if (hasConsent) return true');
    const settingCheckIndex = fbCapiRouteSource.indexOf('if (!sendConversionsWithoutConsent) return false');

    expect(consentCheckIndex).toBeGreaterThan(-1);
    expect(settingCheckIndex).toBeGreaterThan(-1);
    expect(consentCheckIndex).toBeLessThan(settingCheckIndex);
  });

  it('should check event exemption last (after consent and setting checks)', () => {
    const settingCheckIndex = fbCapiRouteSource.indexOf('if (!sendConversionsWithoutConsent) return false');
    const exemptionCheckIndex = fbCapiRouteSource.indexOf('CONSENT_EXEMPT_EVENTS.includes(eventName)');

    expect(settingCheckIndex).toBeGreaterThan(-1);
    expect(exemptionCheckIndex).toBeGreaterThan(-1);
    expect(settingCheckIndex).toBeLessThan(exemptionCheckIndex);
  });
});

describe('FB CAPI Route - GDPR Compliance Annotations', () => {
  it('should reference GDPR Art. 6(1)(f) for legitimate interest basis', () => {
    expect(fbCapiRouteSource).toContain('GDPR Art. 6(1)(f)');
  });

  it('should document that only conversion events are exempt', () => {
    expect(fbCapiRouteSource).toMatch(/[Oo]nly conversion events/);
  });
});
