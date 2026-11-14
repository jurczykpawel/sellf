import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { beforeAll, beforeEach, afterAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { useSupabaseBuyerEmails } from '../../helpers/buyer-email-setting';
import { waitForEmail, searchMessages } from '../../helpers/mailpit';
import { generateSellerKeypair, storeSellerKey } from '@/lib/license-keys/keys';
import { issueAccessLicense } from '@/lib/license-keys/access';
import * as licenseMail from '@/lib/license-keys/license-mail';
import { issueLicense } from '@/lib/license-keys/issue';
import { mutateAccess } from '@/lib/services/business-events';
import { parseLicenseClaims } from '@/lib/license-keys/format';
import type { Database } from '@/types/database';

vi.mock('@/lib/license/resolve', () => ({ checkFeature: async () => true }));
useSupabaseBuyerEmails();
const db = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
let seller: string, buyer: string, email: string;
const buyers: string[] = [];
const product = randomUUID();
const actor = () => ({ type: 'user' as const, id: seller });
const issue = (accessId: string) => issueAccessLicense(db, { userId: buyer, productId: product, accessId, actorUserId: seller, source: 'manual', origin: process.env.SITE_URL!, license: { locale: 'pl' } });

beforeAll(async () => {
  const owner = await db.auth.admin.createUser({ email: `access-owner-${randomUUID()}@example.com`, email_confirm: true });
  expect(owner.error).toBeNull(); seller = owner.data.user!.id;
  await storeSellerKey(db, { sellerId: seller, ...generateSellerKeypair(), custody: 'managed' });
  expect((await db.from('products').insert({ id: product, slug: `access-${product}`, name: 'Licencja dostępu', price: 10, currency: 'PLN', seller_id: seller, issue_license_on_purchase: true, license_tier: 'pro', license_duration_days: 30 })).error).toBeNull();
});
// A fresh buyer per test: Supabase Auth sends at most one email per user per minute.
beforeEach(async () => {
  email = `access-buyer-${randomUUID()}@example.com`;
  const customer = await db.auth.admin.createUser({ email, email_confirm: true });
  expect(customer.error).toBeNull(); buyer = customer.data.user!.id;
  buyers.push(buyer);
});
afterAll(async () => {
  await db.from('issued_licenses').delete().eq('product_id', product);
  await db.from('user_product_access').delete().eq('product_id', product);
  await db.from('products').delete().eq('id', product);
  if (seller) { await db.from('seller_license_keys').delete().eq('seller_id', seller); await db.auth.admin.deleteUser(seller); }
  for (const id of buyers) await db.auth.admin.deleteUser(id);
});

describe('licenses bound to access grants', () => {
  it('issues and mails once, then revokes only the grant license and announces it @J20', async () => {
    const purchased = await issueLicense(db, { productId: product, email, userId: buyer, orderId: `purchase_${randomUUID()}` });
    expect(purchased?.id).toBeTruthy();
    const granted = await mutateAccess(db, 'grant', buyer, actor(), { issue_license: true }, undefined, product).single();
    expect(granted.error).toBeNull();
    const id = granted.data!.id;
    const results = await Promise.all([issue(id), issue(id)]);
    expect(results.some(result => result.ok)).toBe(true);
    const retry = await issue(id);
    expect(retry.ok).toBe(true);
    if (!retry.ok) throw Error(retry.error);
    const claims = parseLicenseClaims(retry.license.token);
    expect(claims).toMatchObject({ tier: 'pro', email, order: `access_${id}` });
    expect(claims!.exp! - claims!.iat).toBe(30 * 86400);
    const mail = await waitForEmail(email);
    expect(mail.HTML).toContain(retry.license.token);
    expect((await searchMessages(email)).filter(message => message.Subject.includes('Licencja dostępu'))).toHaveLength(1);
    const linked = await db.from('issued_licenses').select('id,access_grant_id').eq('access_grant_id', id);
    expect(linked.data).toHaveLength(1);
    expect((await mutateAccess(db, 'revoke', buyer, actor(), { revoke_license: true }, id)).error).toBeNull();
    const licenses = await db.from('issued_licenses').select('id,revoked_at').eq('product_id', product);
    expect(licenses.data!.find(row => row.id === purchased!.id)?.revoked_at).toBeNull();
    expect(licenses.data!.find(row => row.id === retry.license.id)?.revoked_at).toBeTruthy();
    const orderHash = createHash('sha256').update(`access_${id}`).digest('hex');
    const crl = await db.rpc('seller_revoked_orders', { seller, hash_prefix: orderHash.slice(0, 4) });
    expect(crl.error).toBeNull();
    expect(crl.data?.map(row => row.order_hash)).toContain(orderHash);
    const events = await db.from('business_events').select('payload').eq('product_id', product).eq('event_type', 'license.revoked');
    expect(events.data).toHaveLength(1);
    expect(JSON.stringify(events.data)).toContain(retry.license.id);
    expect(JSON.stringify(events.data)).not.toContain(retry.license.token);
    const late = await issue(id);
    expect(late.ok).toBe(false);
  });
  it('retains a license on opt-out and creates a new license on a new grant', async () => {
    // Two license mails to one user within a minute exceed Supabase Auth's limit; delivery is covered above.
    const mail = vi.spyOn(licenseMail, 'sendLicenseMail').mockResolvedValue(true);
    onTestFinished(() => mail.mockRestore());
    const first = await mutateAccess(db, 'grant', buyer, actor(), { issue_license: true }, undefined, product).single();
    expect(first.error).toBeNull();
    const firstLicense = await issue(first.data!.id);
    expect(firstLicense.ok).toBe(true);
    expect((await mutateAccess(db, 'revoke', buyer, actor(), { revoke_license: false }, first.data!.id)).error).toBeNull();
    if (!firstLicense.ok) throw Error(firstLicense.error);
    expect((await db.from('issued_licenses').select('revoked_at').eq('id', firstLicense.license.id).single()).data?.revoked_at).toBeNull();
    const second = await mutateAccess(db, 'grant', buyer, actor(), { issue_license: true }, undefined, product).single();
    const secondLicense = await issue(second.data!.id);
    expect(secondLicense.ok).toBe(true);
    if (!secondLicense.ok) throw Error(secondLicense.error);
    expect(secondLicense.license.id).not.toBe(firstLicense.license.id);
    expect((await mutateAccess(db, 'revoke', buyer, actor(), { revoke_license: true }, second.data!.id)).error).toBeNull();
    expect((await db.from('issued_licenses').select('revoked_at').eq('id', firstLicense.license.id).single()).data?.revoked_at).toBeNull();
  });
  it('does not issue a license for a grant with issuance disabled', async () => {
    const granted = await mutateAccess(db, 'grant', buyer, actor(), { issue_license: false }, undefined, product).single();
    expect(granted.error).toBeNull();
    expect((await issue(granted.data!.id)).ok).toBe(false);
    expect((await db.from('issued_licenses').select('id').eq('access_grant_id', granted.data!.id)).data).toEqual([]);
    await mutateAccess(db, 'revoke', buyer, actor(), {}, granted.data!.id);
  });
  it('does not cascade a bundle license to its components', async () => {
    const component = randomUUID();
    try {
      expect((await db.from('products').insert({ id: component, slug: component, name: 'Licensed component', price: 1, currency: 'PLN', issue_license_on_purchase: true, seller_id: seller })).error).toBeNull();
      expect((await db.from('products').update({ is_bundle: true }).eq('id', product)).error).toBeNull();
      expect((await db.from('bundle_items').insert({ bundle_product_id: product, component_product_id: component })).error).toBeNull();
      const grant = await mutateAccess(db, 'grant', buyer, actor(), { issue_license: true }, undefined, product).single();
      expect(grant.error).toBeNull();
      expect((await issue(grant.data!.id)).ok).toBe(true);
      expect((await db.from('issued_licenses').select('id').eq('product_id', component)).data).toEqual([]);
      await mutateAccess(db, 'revoke', buyer, actor(), { revoke_license: true }, grant.data!.id);
    } finally {
      await db.from('bundle_items').delete().eq('bundle_product_id', product);
      await db.from('products').delete().eq('id', component);
    }
  });
  it('keeps grant mutations unavailable to callers without service access', async () => {
    const anon = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
    expect((await mutateAccess(anon, 'grant', buyer, actor(), { issue_license: true }, undefined, product)).error?.code).toBe('42501');
  });

  it('returns a clear mail failure and retries the same saved key', async () => {
    const grant = await mutateAccess(db, 'grant', buyer, actor(), { issue_license: true }, undefined, product).single();
    expect(grant.error).toBeNull();
    const mail = vi.spyOn(licenseMail, 'sendLicenseMail').mockResolvedValueOnce(false);
    try {
      const failed = await issue(grant.data!.id);
      expect(failed).toMatchObject({ ok: false, status: 500 });
      const before = await db.from('issued_licenses').select('id').eq('access_grant_id', grant.data!.id).single();
      expect(before.error).toBeNull();
      const retried = await issue(grant.data!.id);
      expect(retried.ok).toBe(true);
      if (!retried.ok) throw Error(retried.error);
      expect(retried.license.id).toBe(before.data!.id);
      expect((await db.from('issued_licenses').select('id').eq('access_grant_id', grant.data!.id)).data).toHaveLength(1);
    } finally {
      mail.mockRestore();
      await mutateAccess(db, 'revoke', buyer, actor(), { revoke_license: true }, grant.data!.id);
    }
  });

});
