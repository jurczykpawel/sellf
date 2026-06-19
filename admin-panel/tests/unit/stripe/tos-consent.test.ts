import { describe, expect, it } from 'vitest';

import { applyTosConsent } from '@/lib/stripe/tos-consent';

const ON = { collect_terms_of_service: true };
const OFF = { collect_terms_of_service: false };

describe('applyTosConsent', () => {
  it('sets consent_collection for Stripe-rendered embed (ui_mode embedded) when ON', () => {
    const cfg: { ui_mode?: string; consent_collection?: unknown } = { ui_mode: 'embedded' };
    applyTosConsent(cfg, ON);
    expect(cfg.consent_collection).toEqual({ terms_of_service: 'required' });
  });

  it('sets consent_collection for Stripe-rendered subscription (ui_mode embedded_page) when ON', () => {
    const cfg: { ui_mode?: string; consent_collection?: unknown } = { ui_mode: 'embedded_page' };
    applyTosConsent(cfg, ON);
    expect(cfg.consent_collection).toEqual({ terms_of_service: 'required' });
  });

  it('does NOT set consent_collection for ui_mode elements (Sellf renders the checkbox) when ON', () => {
    const cfg: { ui_mode?: string; consent_collection?: unknown } = { ui_mode: 'elements' };
    applyTosConsent(cfg, ON);
    expect(cfg.consent_collection).toBeUndefined();
  });

  it('does NOT set consent_collection when the setting is OFF, regardless of ui_mode', () => {
    const embedded: { ui_mode?: string; consent_collection?: unknown } = { ui_mode: 'embedded' };
    applyTosConsent(embedded, OFF);
    expect(embedded.consent_collection).toBeUndefined();
  });
});
