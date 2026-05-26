import { describe, it, expect } from 'vitest';
import {
  readMarketingConsentFromCookieValue,
  resolveTrackingDecision,
  type ConversionTrackingMode,
  type TrackingDecision,
} from '@/lib/tracking/consent-mode';
import { isValidFbEventName, type FBEventName } from '@/lib/tracking/types';

const CONVERSION_EVENTS: FBEventName[] = ['Purchase', 'Lead'];
const BROWSING_EVENTS: FBEventName[] = ['ViewContent', 'InitiateCheckout', 'AddPaymentInfo'];

function decide(
  mode: ConversionTrackingMode,
  hasConsent: boolean,
  eventName: FBEventName
): TrackingDecision {
  return resolveTrackingDecision({ mode, hasConsent, eventName });
}

describe('resolveTrackingDecision', () => {
  describe('when user has consent', () => {
    it.each([...CONVERSION_EVENTS, ...BROWSING_EVENTS])(
      'sends %s fully regardless of mode (strict)',
      (eventName) => {
        expect(decide('strict', true, eventName)).toEqual({ action: 'send_full' });
      }
    );

    it.each([...CONVERSION_EVENTS, ...BROWSING_EVENTS])(
      'sends %s fully regardless of mode (limited)',
      (eventName) => {
        expect(decide('limited', true, eventName)).toEqual({ action: 'send_full' });
      }
    );

    it.each([...CONVERSION_EVENTS, ...BROWSING_EVENTS])(
      'sends %s fully regardless of mode (permissive)',
      (eventName) => {
        expect(decide('permissive', true, eventName)).toEqual({ action: 'send_full' });
      }
    );
  });

  describe('strict mode without consent', () => {
    it.each(CONVERSION_EVENTS)(
      'skips %s — strict means even conversions need consent',
      (eventName) => {
        expect(decide('strict', false, eventName)).toEqual({
          action: 'skip',
          reason: 'no_consent_strict_mode',
        });
      }
    );

    it.each(BROWSING_EVENTS)(
      'skips %s — browsing requires consent in every mode',
      (eventName) => {
        expect(decide('strict', false, eventName)).toEqual({
          action: 'skip',
          reason: 'browsing_event_requires_consent',
        });
      }
    );
  });

  describe('limited mode without consent', () => {
    it.each(CONVERSION_EVENTS)(
      'sends %s in LDU (Limited Data Use) — defensible legitimate interest',
      (eventName) => {
        expect(decide('limited', false, eventName)).toEqual({ action: 'send_ldu' });
      }
    );

    it.each(BROWSING_EVENTS)('skips %s — browsing not covered by LI', (eventName) => {
      expect(decide('limited', false, eventName)).toEqual({
        action: 'skip',
        reason: 'browsing_event_requires_consent',
      });
    });
  });

  describe('permissive mode without consent', () => {
    it.each(CONVERSION_EVENTS)(
      'sends %s with full payload (LI claim, no LDU restriction)',
      (eventName) => {
        expect(decide('permissive', false, eventName)).toEqual({ action: 'send_full' });
      }
    );

    it.each(BROWSING_EVENTS)('skips %s — browsing never sent without consent', (eventName) => {
      expect(decide('permissive', false, eventName)).toEqual({
        action: 'skip',
        reason: 'browsing_event_requires_consent',
      });
    });
  });

  describe('unknown/invalid mode', () => {
    it('treats unknown mode as strict (fail-closed)', () => {
      // Cast forces the runtime path; production callers come from typed DB schema.
      const result = decide('unknown' as ConversionTrackingMode, false, 'Purchase');
      expect(result).toEqual({ action: 'skip', reason: 'no_consent_strict_mode' });
    });
  });
});

describe('readMarketingConsentFromCookieValue', () => {
  it('returns null when cookie value is missing', () => {
    expect(readMarketingConsentFromCookieValue(undefined)).toBeNull();
    expect(readMarketingConsentFromCookieValue('')).toBeNull();
  });

  it('returns null when cookie is not parseable JSON', () => {
    expect(readMarketingConsentFromCookieValue('not-json')).toBeNull();
    expect(readMarketingConsentFromCookieValue('{broken')).toBeNull();
  });

  it('returns null when JSON is parseable but missing services shape', () => {
    expect(readMarketingConsentFromCookieValue('{}')).toBeNull();
    expect(readMarketingConsentFromCookieValue(JSON.stringify({ services: null }))).toBeNull();
  });

  it('returns true when marketing services include pixel', () => {
    const cookie = JSON.stringify({
      services: { marketing: ['pixel'], analytics: ['gtm'] },
    });
    expect(readMarketingConsentFromCookieValue(cookie)).toBe(true);
  });

  it('returns false when marketing services exist but pixel is not accepted', () => {
    const cookie = JSON.stringify({ services: { marketing: [] } });
    expect(readMarketingConsentFromCookieValue(cookie)).toBe(false);
  });

  it('returns false when services object exists but has no marketing key', () => {
    const cookie = JSON.stringify({ services: { analytics: ['gtm'] } });
    expect(readMarketingConsentFromCookieValue(cookie)).toBe(false);
  });

  it('decodes URL-encoded cookie values (as Next reads them raw)', () => {
    // cookieconsent v3 may URL-encode the JSON before storing
    const cookie = encodeURIComponent(JSON.stringify({ services: { marketing: ['pixel'] } }));
    expect(readMarketingConsentFromCookieValue(cookie)).toBe(true);
  });
});

describe('isValidFbEventName', () => {
  it.each(['ViewContent', 'InitiateCheckout', 'AddPaymentInfo', 'Purchase', 'Lead'])(
    'accepts canonical event name %s',
    (name) => {
      expect(isValidFbEventName(name)).toBe(true);
    }
  );

  it.each(['FakePurchase', 'purchase', 'PURCHASE', 'pageview', '', 'Purchase ', ' Lead'])(
    'rejects non-canonical input %s',
    (name) => {
      expect(isValidFbEventName(name)).toBe(false);
    }
  );

  it.each([null, undefined, 42, {}, [], true])('rejects non-string input %s', (input) => {
    expect(isValidFbEventName(input)).toBe(false);
  });
});
