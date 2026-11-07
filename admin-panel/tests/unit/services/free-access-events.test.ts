/** Shared free-access event keeps the existing license delivery contract. */
import { beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const mocks = vi.hoisted(() => ({ issueLicense: vi.fn(), trigger: vi.fn(), licenseMail: vi.fn() }));
vi.mock('@/lib/license-keys/license-mail', () => ({ sendLicenseMail: mocks.licenseMail }));
vi.mock('@/lib/license-keys/issue', () => ({ issueLicense: mocks.issueLicense }));
vi.mock('@/lib/services/webhook-service', () => ({ WebhookService: { trigger: mocks.trigger } }));
vi.mock('@/lib/utils/canonical-url', () => ({ getCanonicalOriginOrNull: () => 'https://shop.example.com' }));
import { emitFreeAccessLead } from '@/lib/services/free-access-events';
const product = { id: 'product-free', name: 'Free guide', slug: 'free-guide', price: 0, currency: 'PLN', icon: null };
const user = { id: 'buyer', email: 'buyer@example.com' };
const access = { access_granted_at: '2036-01-01T00:00:00Z', access_expires_at: '2036-01-04T00:00:00Z' };
function client(details: typeof product | null = product): SupabaseClient {
  const chain = (data: unknown) => { const query = { select: () => query, eq: () => query, single: async () => ({ data, error: null }) }; return query; };
  return { auth: { admin: { getUserById: async () => ({ data: { user: { user_metadata: {} } } }) } }, from: (table: string) => table === 'shop_config' ? { select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) } : chain(table === 'products' ? details : access) } as unknown as SupabaseClient;
}
beforeEach(() => { vi.clearAllMocks(); mocks.issueLicense.mockResolvedValue(null); mocks.trigger.mockResolvedValue(undefined); });
it('uses a stable free purchase key and includes the issued license and public verification URL', async () => {
  mocks.issueLicense.mockResolvedValue({ token: 'test-license', kid: 'key-1', sellerId: 'seller-1' });
  const db = client();
  const customFieldValues = { _sellf_license_domain: 'client.example' };
  await emitFreeAccessLead(db, { product, user, customFieldValues });
  expect(mocks.licenseMail).toHaveBeenCalledWith(db, { userId: user.id, email: user.email, productSlug: product.slug, productName: product.name, token: 'test-license', locale: 'en' });
  expect(mocks.issueLicense).toHaveBeenCalledWith(db, { productId: product.id, userId: user.id, email: user.email, orderId: `free_${user.id}_${product.id}`, customFieldValues, locale: 'en' });
  expect(mocks.trigger).toHaveBeenCalledWith('lead.captured', { customer: { email: user.email, userId: user.id, locale: 'en' }, product, customFieldValues, accessGrantedAt: access.access_granted_at, accessExpiresAt: access.access_expires_at, license: { token: 'test-license', kid: 'key-1', jwksUrl: 'https://shop.example.com/api/licenses/jwks?seller=seller-1' } }, db, product.id, `free_${user.id}_${product.id}`);
});
it.each(['disabled', 'failed'])('still sends the lead when licensing is %s', async result => {
  if (result === 'failed') mocks.issueLicense.mockRejectedValue(new Error('test signing failure'));
  await emitFreeAccessLead(client(), { product, user });
  expect(mocks.trigger).toHaveBeenCalledTimes(1);
  expect(mocks.trigger.mock.calls[0][1]).not.toHaveProperty('license');
  expect(mocks.licenseMail).not.toHaveBeenCalled();
});
it('does not send a partial product when the product read failed', async () => {
  await emitFreeAccessLead(client(null), { product, user });
  expect(mocks.trigger).not.toHaveBeenCalled();
});
it('keeps a delivery failure from undoing granted access', async () => {
  mocks.trigger.mockRejectedValue(new Error('test delivery failure'));
  await expect(emitFreeAccessLead(client(), { product, user })).resolves.toBe(false);
});
it.each(['pl', 'en'] as const)('uses explicit checkout locale %s for the lead and license mail', async locale => {
  mocks.issueLicense.mockResolvedValue({ token: 'test-license', kid: 'key-1', sellerId: 'seller-1' });
  await emitFreeAccessLead(client(), { product, user, locale });
  expect(mocks.trigger.mock.calls[0][1].customer.locale).toBe(locale);
  expect(mocks.licenseMail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ locale }));
});
it('reports an unavailable delivery so confirmation can be retried', async () => {
  mocks.trigger.mockRejectedValue(new Error('test queue failure'));
  expect(await emitFreeAccessLead(client(), { product, user, locale: 'pl' })).toBe(false);
});
it('can rebuild a confirmed lead without mailing the same license again', async () => {
  mocks.issueLicense.mockResolvedValue({ token: 'test-license', kid: 'key-1', sellerId: 'seller-1' });
  await emitFreeAccessLead(client(), { product, user, locale: 'pl' }, { data: { leadId: 'lead-1' }, sendMail: false });
  expect(mocks.licenseMail).not.toHaveBeenCalled();
  expect(mocks.trigger).toHaveBeenCalledWith('lead.captured', expect.objectContaining({ leadId: 'lead-1', license: expect.any(Object) }), expect.anything(), product.id, 'lead:lead-1');
});
it('uses the default language when the account language is temporarily unavailable', async () => {
  const db = client();
  vi.spyOn(db.auth.admin, 'getUserById').mockRejectedValue(new Error('test account unavailable'));
  expect(await emitFreeAccessLead(db, { product, user })).toBe(true);
  expect(mocks.trigger.mock.calls[0][1].customer.locale).toBe('en');
});
