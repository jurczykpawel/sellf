/**
 * POST /api/v1/licenses with sendEmail: a second key mail to the same buyer within a minute hits
 * Supabase Auth's per-recipient limit. The license is issued, the response reports the mail as
 * pending, and the retry queue delivers it once the limit allows. Real local Supabase Auth and
 * Mailpit; only API key authentication and the Pro feature check are stubbed.
 * @see src/app/api/v1/licenses/route.ts
 * @see src/lib/license-keys/request.ts
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

const actor = vi.hoisted(() => ({ seller: '' }));
vi.mock('@/lib/license/resolve', () => ({ checkFeature: async () => true }));
vi.mock('@/lib/api', async original => {
  const api = await original<typeof import('@/lib/api')>();
  return { ...api, authenticate: async () => ({ method: 'api_key', apiKey: { id: randomUUID() }, admin: { userId: actor.seller }, scopes: [api.API_SCOPES.LICENSES_WRITE], supabase: createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) }) };
});

import { POST } from '@/app/api/v1/licenses/route';
import { runAuthMailRetries } from '@/lib/auth/magic-link/retry';
import { generateSellerKeypair, storeSellerKey } from '@/lib/license-keys/keys';
import { licenseMailKey } from '@/lib/license-keys/license-mail';
import { useSupabaseBuyerEmails } from '../../helpers/buyer-email-setting';
import { getTestDatabaseContainer } from '../../helpers/database-container';
import { getMessage, searchMessages } from '../../helpers/mailpit';

useSupabaseBuyerEmails();
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const products = [randomUUID(), randomUUID()];
const email = `api-limit-${randomUUID()}@example.com`;

const issue = async (productId: string) => {
  const response = await POST(new NextRequest('http://localhost/api/v1/licenses', { method: 'POST', body: JSON.stringify({ productId, email, locale: 'pl' }) }));
  expect(response.status).toBe(201);
  return (await response.json()).data as { id: string; token: string; order: string; emailSent: boolean; emailPending?: boolean };
};
const licenseMails = async () => (await searchMessages(email)).filter(message => message.Subject.startsWith('Twój klucz licencyjny'));

beforeAll(async () => {
  const owner = await db.auth.admin.createUser({ email: `api-limit-owner-${randomUUID()}@example.com`, email_confirm: true });
  expect(owner.error).toBeNull(); actor.seller = owner.data.user!.id;
  await storeSellerKey(db, { sellerId: actor.seller, ...generateSellerKeypair(), custody: 'managed' });
  expect((await db.from('products').insert(products.map((id, i) => ({ id, slug: `api-limit-${id}`, name: `API limit ${i}`, price: 10, currency: 'PLN', seller_id: actor.seller, is_active: true, issue_license_on_purchase: true, license_tier: 'pro' })))).error).toBeNull();
});
afterAll(async () => {
  await db.from('auth_mail_retries').delete().eq('email', email);
  await db.from('issued_licenses').delete().in('product_id', products);
  await db.from('products').delete().in('id', products);
  await db.from('seller_license_keys').delete().eq('seller_id', actor.seller);
  await db.auth.admin.deleteUser(actor.seller);
  const buyer = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find(user => user.email === email);
  if (buyer) await db.auth.admin.deleteUser(buyer.id);
});

it('issues the second license within a minute, reports its mail as pending and delivers it from the retry queue @J197', async () => {
  expect(await issue(products[0])).toMatchObject({ emailSent: true, emailPending: false });

  const second = await issue(products[1]);
  expect(second).toMatchObject({ emailSent: false, emailPending: true });
  const key = licenseMailKey(email, second.order);
  const queued = await db.from('auth_mail_retries').select('kind,given_up_at').eq('license_mail_key', key);
  expect(queued.data).toEqual([{ kind: 'license', given_up_at: null }]);
  expect(await licenseMails()).toHaveLength(1);

  // As if the per-recipient interval had passed.
  execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], {
    input: `UPDATE auth.users SET recovery_sent_at = recovery_sent_at - interval '5 minutes', confirmation_sent_at = confirmation_sent_at - interval '5 minutes' WHERE email = '${email}';`, encoding: 'utf8',
  });
  await db.from('auth_mail_retries').update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq('license_mail_key', key);
  expect(await runAuthMailRetries(db)).toMatchObject({ errors: 0 });
  expect((await db.from('auth_mail_retries').select('id').eq('license_mail_key', key)).data).toEqual([]);
  await expect.poll(async () => (await licenseMails()).length, { timeout: 10_000 }).toBe(2);
  expect((await getMessage((await licenseMails())[0].ID)).HTML).toContain(second.token);
}, 60_000);
