import { expect, it } from 'vitest';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

it('uses English examples and tax terminology in English checkout', () => {
  expect(en.checkout.fullNamePlaceholder).toBe('John Smith');
  expect(en.checkout.nipLabel).toBe('Tax ID');
});
it('uses consistent Polish license terminology', () => {
  expect(pl.productView.licenseStatusRevoked).toBe('Cofnięta');
  expect([pl.productView.licenseRevokedDispute, pl.productView.licenseRevokedOther,
    pl.admin.webhooks.events_list.license_revoked, pl.admin.webhooks.events_desc.license_revoked,
    pl.admin.apiKeys.scopeDescriptions.licensesWrite].join(' ')).not.toMatch(/odwoł/i);
});
