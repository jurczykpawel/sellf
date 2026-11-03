/** The buyer sees whether the license works; a revoked key never looks usable. */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import BuyerLicenseKey from '@/app/[locale]/p/[slug]/components/BuyerLicenseKey';
import { toIssuedLicenseResponse } from '@/lib/license-keys/lookup';
import en from '@/messages/en.json';

const base = { license_key: 'payload.signature', issued_at: '2026-01-01T00:00:00Z', expires_at: null, revoked_at: null, revoked_by_dispute_id: null };
const render = (row: Record<string, unknown>) => {
  const license = toIssuedLicenseResponse(row as never)!;
  return { license, html: renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: 'en', messages: en, timeZone: 'UTC' }, createElement(BuyerLicenseKey, { license }))) };
};

describe('buyer license status', () => {
  it('shows a valid key with copy @J235', () => {
    const { license, html } = render(base);
    expect(license.status).toBe('active');
    expect(html).toContain('payload.signature');
    expect(html).toContain(en.productView.licenseStatusActive);
    expect(html).toContain(en.productView.licenseCopy);
  });
  it('hides a dispute-revoked key and explains why', () => {
    const { license, html } = render({ ...base, revoked_at: '2026-02-01T00:00:00Z', revoked_by_dispute_id: 'dp_1' });
    expect(license).toMatchObject({ status: 'revoked', revokedReason: 'dispute', token: null });
    expect(html).not.toContain('payload.signature');
    expect(html).not.toContain(en.productView.licenseCopy);
    expect(html).toContain(en.productView.licenseStatusRevoked);
    expect(html).toContain(en.productView.licenseRevokedDispute);
  });
  it('marks a revoked key without a dispute as revoked by the seller or refund', () => {
    const { html } = render({ ...base, revoked_at: '2026-02-01T00:00:00Z' });
    expect(html).toContain(en.productView.licenseRevokedOther);
  });
  it('labels an expired key as expired', () => {
    const { license, html } = render({ ...base, expires_at: '2020-01-01T00:00:00Z' });
    expect(license.status).toBe('expired');
    expect(html).toContain(en.productView.licenseStatusExpired);
  });
});
