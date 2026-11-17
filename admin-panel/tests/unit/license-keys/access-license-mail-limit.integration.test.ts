/**
 * A second license grant to the same buyer within a minute hits Supabase Auth's per-recipient mail
 * limit. The grant still succeeds (access and license are saved), the response reports the mail as
 * pending, and the retry queue delivers it once the limit allows. Real local Supabase Auth and Mailpit;
 * nothing in the mail path is simulated.
 * @see src/lib/license-keys/request.ts
 * @see src/lib/auth/magic-link/retry.ts
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { useSupabaseBuyerEmails } from '../../helpers/buyer-email-setting';
import { getTestDatabaseContainer } from '../../helpers/database-container';
import { getMessage, searchMessages } from '../../helpers/mailpit';
import { generateSellerKeypair, storeSellerKey } from '@/lib/license-keys/keys';
import { issueAccessLicense } from '@/lib/license-keys/access';
import { licenseMailKey } from '@/lib/license-keys/license-mail';
import { runAuthMailRetries } from '@/lib/auth/magic-link/retry';
import { mutateAccess } from '@/lib/services/business-events';
import type { Database } from '@/types/database';

vi.mock('@/lib/license/resolve', () => ({ checkFeature: async () => true }));
useSupabaseBuyerEmails();
const db = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const products = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const email = `limit-buyer-${randomUUID()}@example.com`;
let seller = '', buyer = '';
let deferredMails: { id: string; next_attempt_at: string }[] = [];

const grantAndIssue = async (productId: string, userId = buyer) => {
  const granted = await mutateAccess(db, 'grant', userId, { type: 'user', id: seller }, { issue_license: true }, undefined, productId).single();
  expect(granted.error).toBeNull();
  const accessId = (granted.data as { id: string }).id;
  return { accessId, issued: await issueAccessLicense(db, { userId, productId, accessId, actorUserId: seller, source: 'manual', origin: process.env.SITE_URL!, license: { locale: 'pl' } }) };
};
const regrant = (productId: string, accessId: string, userId: string) =>
  issueAccessLicense(db, { userId, productId, accessId, actorUserId: seller, source: 'manual', origin: process.env.SITE_URL!, license: { locale: 'pl' } });
const licenseMails = async (to = email) => (await searchMessages(to)).filter(message => message.Subject.startsWith('Twój klucz licencyjny'));
const extraBuyers: { id: string; email: string }[] = [];
async function newBuyer() {
  const address = `resume-buyer-${randomUUID()}@example.com`;
  const created = await db.auth.admin.createUser({ email: address, email_confirm: true });
  expect(created.error).toBeNull();
  extraBuyers.push({ id: created.data.user!.id, email: address });
  return { id: created.data.user!.id, email: address };
}
/** The retry worker's six failed attempts, recorded as it records them. */
const giveUp = (mailKey: string, at = new Date()) => db.from('auth_mail_retries')
  .update({ attempts: 6, given_up_at: at.toISOString(), last_error: 'rate_limited' }).eq('license_mail_key', mailKey);

/** Moves the buyer's last auth mail a few minutes back, as if the per-recipient interval had passed. */
function letAuthMailLimitPass(userId: string) {
  execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], {
    input: `UPDATE auth.users SET recovery_sent_at = recovery_sent_at - interval '5 minutes', confirmation_sent_at = confirmation_sent_at - interval '5 minutes' WHERE id = '${userId}';`, encoding: 'utf8',
  });
}

beforeAll(async () => {
  const pending = await db.from('auth_mail_retries').select('id,next_attempt_at').is('given_up_at', null);
  expect(pending.error).toBeNull();
  deferredMails = pending.data ?? [];
  if (deferredMails.length) {
    expect((await db.from('auth_mail_retries').update({ next_attempt_at: new Date(Date.now() + 86_400_000).toISOString() })
      .in('id', deferredMails.map(row => row.id))).error).toBeNull();
  }
  const owner = await db.auth.admin.createUser({ email: `limit-owner-${randomUUID()}@example.com`, email_confirm: true });
  expect(owner.error).toBeNull(); seller = owner.data.user!.id;
  await storeSellerKey(db, { sellerId: seller, ...generateSellerKeypair(), custody: 'managed' });
  expect((await db.from('products').insert(products.map((id, i) => ({ id, slug: `limit-${id}`, name: `Limit ${i}`, price: 10, currency: 'PLN', seller_id: seller, is_active: true, issue_license_on_purchase: true, license_tier: 'pro' })))).error).toBeNull();
  const customer = await db.auth.admin.createUser({ email, email_confirm: true });
  expect(customer.error).toBeNull(); buyer = customer.data.user!.id;
});
afterAll(async () => {
  await db.from('auth_mail_retries').delete().in('email', [email, ...extraBuyers.map(b => b.email)]);
  for (const extra of extraBuyers) await db.auth.admin.deleteUser(extra.id);
  await db.from('issued_licenses').delete().in('product_id', products);
  await db.from('user_product_access').delete().in('product_id', products);
  await db.from('products').delete().in('id', products);
  if (seller) { await db.from('seller_license_keys').delete().eq('seller_id', seller); await db.auth.admin.deleteUser(seller); }
  if (buyer) await db.auth.admin.deleteUser(buyer);
  for (const row of deferredMails) {
    expect((await db.from('auth_mail_retries').update({ next_attempt_at: row.next_attempt_at }).eq('id', row.id)).error).toBeNull();
  }
});

it('grants the second license within a minute, reports the mail as pending and delivers it from the retry queue @J197', async () => {
  const first = await grantAndIssue(products[0]);
  expect(first.issued).toMatchObject({ ok: true, license: { emailSent: true, emailPending: false } });

  const second = await grantAndIssue(products[1]);
  expect(second.issued).toMatchObject({ ok: true, license: { emailSent: false, emailPending: true } });
  if (!second.issued.ok) throw Error(second.issued.error);
  const token = second.issued.license.token;
  expect((await db.from('issued_licenses').select('id').eq('access_grant_id', second.accessId).single()).data?.id).toBe(second.issued.license.id);
  const queued = await db.from('auth_mail_retries').select('kind,given_up_at,next_attempt_at').eq('license_mail_key', licenseMailKey(email, `access_${second.accessId}`));
  expect(queued.data).toHaveLength(1);
  expect(queued.data![0]).toMatchObject({ kind: 'license', given_up_at: null });
  expect(await licenseMails()).toHaveLength(1);

  // Repeating the grant while the mail waits continues the same license and stays successful.
  const repeated = await issueAccessLicense(db, { userId: buyer, productId: products[1], accessId: second.accessId, actorUserId: seller, source: 'manual', origin: process.env.SITE_URL!, license: { locale: 'pl' } });
  expect(repeated).toMatchObject({ ok: true, license: { id: second.issued.license.id, emailSent: false, emailPending: true } });

  letAuthMailLimitPass(buyer);
  await db.from('auth_mail_retries').update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq('email', email);
  expect(await runAuthMailRetries(db)).toMatchObject({ processed: 1, errors: 0 });
  expect((await db.from('auth_mail_retries').select('id').eq('email', email)).data).toEqual([]);
  await expect.poll(async () => (await licenseMails()).length, { timeout: 10_000 }).toBe(2);
  const mails = await licenseMails();
  expect((await getMessage(mails[0].ID)).HTML).toContain(token);
}, 60_000);

it('a repeated grant puts an abandoned license mail back in the queue and the worker delivers it', async () => {
  const resumed = await newBuyer();
  await grantAndIssue(products[2], resumed.id);
  const second = await grantAndIssue(products[3], resumed.id);
  expect(second.issued).toMatchObject({ ok: true, license: { emailPending: true } });
  const mailKey = licenseMailKey(resumed.email, `access_${second.accessId}`);
  expect((await giveUp(mailKey)).error).toBeNull();

  const repeated = await regrant(products[3], second.accessId, resumed.id);
  expect(repeated).toMatchObject({ ok: true, license: { emailSent: false, emailPending: true } });
  const row = (await db.from('auth_mail_retries').select('attempts,given_up_at,next_attempt_at').eq('license_mail_key', mailKey).single()).data!;
  expect(row).toMatchObject({ attempts: 0, given_up_at: null });
  expect(Date.parse(row.next_attempt_at)).toBeLessThanOrEqual(Date.now() + 1000);

  letAuthMailLimitPass(resumed.id);
  expect(await runAuthMailRetries(db)).toMatchObject({ errors: 0 });
  expect((await db.from('auth_mail_retries').select('id').eq('license_mail_key', mailKey)).data).toEqual([]);
  if (!repeated.ok) throw Error(repeated.error);
  await expect.poll(async () => (await licenseMails(resumed.email)).length, { timeout: 10_000 }).toBe(2);
  expect((await getMessage((await licenseMails(resumed.email))[0].ID)).HTML).toContain(repeated.license.token);
}, 60_000);

it('a repeated grant after the abandoned mail was purged sends the key again instead of reporting it sent', async () => {
  const purged = await newBuyer();
  await grantAndIssue(products[2], purged.id);
  const second = await grantAndIssue(products[3], purged.id);
  expect(second.issued).toMatchObject({ ok: true, license: { emailPending: true } });
  const mailKey = licenseMailKey(purged.email, `access_${second.accessId}`);
  expect((await giveUp(mailKey, new Date(Date.now() - 8 * 86_400_000))).error).toBeNull();
  await runAuthMailRetries(db); // purges given-up rows older than seven days
  expect((await db.from('auth_mail_retries').select('id').eq('license_mail_key', mailKey)).data).toEqual([]);

  letAuthMailLimitPass(purged.id);
  const repeated = await regrant(products[3], second.accessId, purged.id);
  expect(repeated).toMatchObject({ ok: true, license: { emailSent: true, emailPending: false } });
  await expect.poll(async () => (await licenseMails(purged.email)).length, { timeout: 10_000 }).toBe(2);
}, 60_000);
