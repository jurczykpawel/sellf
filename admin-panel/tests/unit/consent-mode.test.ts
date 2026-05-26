import { describe, it, expect } from 'vitest';
import {
  resolveTrackingDecision,
  type ConversionTrackingMode,
  type TrackingDecision,
} from '@/lib/tracking/consent-mode';
import type { FBEventName } from '@/lib/tracking/types';

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
