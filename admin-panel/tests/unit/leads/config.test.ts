/** @see src/lib/leads/config.ts */
import { describe, expect, it } from 'vitest';
import { consentForLocale, leadBodySchema, validateLeadSettings } from '@/lib/leads/config';
import { getLoginReturnPath } from '@/lib/auth/magic-link-redirect';

const body = { email: ' VIEWER@example.com ', src: 'https://files.example.com/video.mp4', nonce: 'a'.repeat(64), altcha: 'solution' };
describe('lead contract', () => {
  it('normalizes email and accepts optional product and consent', () => {
    expect(leadBodySchema.parse(body).email).toBe('viewer@example.com');
    expect(leadBodySchema.safeParse({ ...body, product: 'guide', marketingConsent: true, consentVersion: '1:pl', consentText: 'Displayed' }).success).toBe(true);
  });
  it.each([{ src: 'http://example.com/video' }, { src: 'javascript:alert(1)' }, { product: 'x'.repeat(101) }, { consentVersion: 'x'.repeat(65) }, { marketingConsent: 'true' }, { consentText: 'x'.repeat(501) }, { email: 'invalid' }])('rejects invalid fields %j', fields => {
    expect(leadBodySchema.safeParse({ ...body, ...fields }).success).toBe(false);
  });
  it('accepts both supported ALTCHA formats', () => {
    expect(leadBodySchema.safeParse({ ...body, altcha: { algorithm: 'SHA-256', challenge: 'abc', salt: 'abc', signature: 'abc', number: 3 } }).success).toBe(true);
  });
  it('uses canonical server text and language-qualified versions', () => {
    expect(consentForLocale({ lead_consent_version: 'v2', lead_consent_text_pl: 'Polska zgoda', lead_consent_text_en: 'English consent', lead_consent_required: true }, 'pl')).toEqual({ required: true, text: 'Polska zgoda', version: 'v2:pl' });
  });
  it('validates product settings on partial updates', () => {
    expect(validateLeadSettings({ lead_consent_required: 'yes' })).toHaveLength(1);
    expect(validateLeadSettings({ lead_consent_text_pl: '' })).toHaveLength(1);
    expect(validateLeadSettings({ lead_consent_version: 'v2' })).toEqual([]);
  });
  it('allows only the canonical lead confirmation destination', () => {
    const path = `/auth/lead?token=${'a'.repeat(64)}`;
    expect(getLoginReturnPath(path)).toBe(path);
    expect(getLoginReturnPath('/auth/lead?token=short')).toBeUndefined();
    expect(getLoginReturnPath(`${path}&product=other`)).toBeUndefined();
  });
});
