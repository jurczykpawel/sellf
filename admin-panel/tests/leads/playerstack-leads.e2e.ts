/** Real pinned Sellf adapter and email-gate, local Supabase Mailpit and signed webhook receiver. */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { solveChallenge } from 'altcha-lib/v1';
import { extractMagicLink, waitForEmail } from '../helpers/mailpit';
import { assertLocalLeadsStack, leadsAppUrl, leadsOrigin } from './stack';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const origin = leadsOrigin;
const secret = 'whsec_local_lead_fixture';
const ids: string[] = [];
const testEmails: string[] = [];
let endpointId: string;

test.beforeAll(async () => {
  assertLocalLeadsStack((actual, expected) => expect(actual).toBe(expected));
  await db.from('application_rate_limits').delete().eq('action_type', 'leads_submit');
  const ep = await db.from('webhook_endpoints').insert({ url: 'https://w103-receiver.example/hook', secret, events: ['lead.captured'], is_active: true }).select('id').single();
  expect(ep.error).toBeNull(); endpointId = ep.data!.id;
});
test.afterAll(async () => {
  if (endpointId) { await db.from('webhook_logs').delete().eq('endpoint_id', endpointId); await db.from('webhook_endpoints').delete().eq('id', endpointId); }
  if (ids.length) { await db.from('lead_submissions').delete().in('product_id', ids); await db.from('products').delete().in('id', ids); }
  for (const email of testEmails) {
    await db.from('lead_submissions').delete().eq('email', email);
    const { data } = await db.auth.admin.listUsers(); const user = data.users.find(u => u.email === email);
    if (user) { await db.from('audit_log').delete().eq('user_id', user.id); await db.auth.admin.deleteUser(user.id); }
  }
});
async function product(required = false, price = 0) {
  const id = randomUUID(); ids.push(id);
  const { data, error } = await db.from('products').insert({ id, name: 'Local lead guide', slug: `lead-${id}`, price, currency: 'USD', is_active: true, embed_enabled: true, lead_consent_required: required }).select('*').single();
  expect(error).toBeNull(); return data!;
}
async function challenge(request: APIRequestContext, p?: string) {
  const r = await request.get(`/api/leads/challenge${p ? `?product=${p}` : ''}`, { headers: { origin } });
  expect(r.status()).toBe(200); const c = await r.json();
  const solved = await solveChallenge(c.altcha.challenge, c.altcha.salt, c.altcha.algorithm, c.altcha.maxnumber).promise;
  return { nonce: c.nonce, altcha: { ...c.altcha, number: solved!.number } };
}
for (const required of [false, true]) {
  test(`adapter 8baee66 confirms ${required ? 'required' : 'optional'} consent and free access`, async ({ page, request }) => {
    const p = await product(required); const email = `lead-${randomUUID()}@example.com`; testEmails.push(email);
    await page.goto(`${origin}/?product=${p.slug}`);
    await page.getByRole('textbox', { name: /email/i }).fill(email);
    const adapter = await page.evaluate(() => ({ config: (globalThis as unknown as {adapterConfig: {emailGate: unknown}}).adapterConfig, commit: (globalThis as unknown as {adapterCommit: string}).adapterCommit }));
    expect(adapter.commit).toBe('8baee66c50a95e21aee91fca66a2edc53bc08538');
    expect(adapter.config.emailGate).toMatchObject({ at: 'after', product: p.slug, altchaFormat: 'base64', marketingConsent: { required, version: '1:en' } });
    const checkbox = page.getByRole('checkbox'); expect(await checkbox.isChecked()).toBe(false);
    if (required) {
      await page.getByRole('button', { name: /submit|send|continue/i }).click();
      await expect(checkbox).toHaveAttribute('aria-invalid', 'true');
      await checkbox.check();
    }
    const post = page.waitForResponse(r => r.url().includes('/api/leads/submit') && r.request().method() === 'POST');
    await page.getByRole('button', { name: /submit|send|continue/i }).click();
    expect((await post).status()).toBe(200);
    await expect(page.getByRole('status')).toContainText('Check your email');
    const pending = await db.from('lead_submissions').select('*').eq('email', email).single();
    expect(pending.error).toBeNull(); expect(pending.data!.confirmed_at).toBeNull();
    expect(pending.data!.marketing_consent).toBe(required);
    const beforeAccess = await db.from('user_product_access').select('id').eq('product_id', p.id);
    expect(beforeAccess.data).toEqual([]);
    const before = await db.from('webhook_logs').select('id').eq('endpoint_id', endpointId).contains('payload', { data: { leadId: pending.data!.id } });
    expect(before.data).toEqual([]);
    const mail = await waitForEmail(email, { timeout: 20_000 });
    const link = extractMagicLink(mail.HTML || mail.Text || ''); expect(link).toBeTruthy();
    await page.goto(link!);
    await page.waitForURL(`**/p/${p.slug}`);
    const confirmed = await db.from('lead_submissions').select('*').eq('id', pending.data!.id).single();
    expect(confirmed.data!.confirmed_at).toBeTruthy();
    const users = await db.auth.admin.listUsers(); const user = users.data.users.find(u => u.email === email)!;
    expect(user).toBeTruthy();
    const access = await db.from('user_product_access').select('id').eq('product_id', p.id).eq('user_id', user.id); expect(access.data).toHaveLength(1);
    await expect.poll(async () => {
      const r = await request.get(`${origin}/hooks`); return (await r.json()).filter((h: { body: string }) => JSON.parse(h.body).data.leadId === pending.data!.id).length;
    }).toBe(1);
    const hooks = await (await request.get(`${origin}/hooks`)).json();
    const hook = hooks.find((h: { body: string }) => JSON.parse(h.body).data.leadId === pending.data!.id);
    const data = JSON.parse(hook.body).data; expect(data.marketingConsent).toBe(required);
    expect(data.consentConfirmedAt).toBe(required ? confirmed.data!.confirmed_at : null);
    const signature = hook.headers['x-sellf-signature']; const timestamp = signature.match(/t=(\d+)/)[1];
    expect(signature).toContain(`v1=${createHmac('sha256', secret).update(`${timestamp}.${hook.body}`).digest('hex')}`);
    const leadDestination = new URL(link!).searchParams.get('redirect_to')!;
    await page.goto(`${leadsAppUrl}${leadDestination}`); await page.waitForURL(`**/p/${p.slug}`);
    const deliveries = await db.from('webhook_logs').select('id,status').eq('endpoint_id', endpointId).contains('payload', { data: { leadId: pending.data!.id } });
    expect(deliveries.data).toHaveLength(1); expect(deliveries.data![0].status).toBe('success');
  });
}
test('real API rejects reused, wrong-product and expired nonces and paid products', async ({ request }) => {
  const p = await product(); const p2 = await product(); const paid = await product(false, 10);
  const send = (data: unknown, o = origin) => request.post(`/api/leads/submit?product=${p.slug}`, { headers: { origin: o }, data });
  const c = await challenge(request, p.slug);
  const body = { ...c, product: p2.id, email: 'api@example.com', src: 'https://files.example.com/a.mp4' };
  expect((await send(body)).status()).toBe(400);
  expect((await send({ ...body, product: p.id })).status()).toBe(400);
  const expired = await challenge(request, p.id);
  await db.from('lead_nonces').update({ expires_at: '2000-01-01T00:00:00Z' }).eq('nonce_hash', createHash('sha256').update(expired.nonce).digest('hex'));
  expect((await send({ ...body, ...expired, product: p.id })).status()).toBe(400);
  expect((await request.get(`/api/leads/challenge?product=${paid.id}`, { headers: { origin } })).status()).toBe(404);
  expect((await request.get(`/api/leads/challenge?product=${p.id}`, { headers: { origin: 'https://unlisted.example' } })).status()).toBe(403);
});

test('list-only confirmation uses one nonce winner and emits consent without a product', async ({ page, request }) => {
  const email = `list-${randomUUID()}@example.com`; testEmails.push(email);
  const c = await challenge(request);
  const data = { ...c, email, src: 'https://files.example.com/list.mp4', marketingConsent: true, consentVersion: '1:en' };
  const results = await Promise.all([1, 2].map(() => request.post('/api/leads/submit', { headers: { origin }, data })));
  expect(results.map(r => r.status()).sort()).toEqual([200, 400]);
  const lead = await db.from('lead_submissions').select('*').eq('email', email).single();
  expect(lead.error).toBeNull(); expect(lead.data!.product_id).toBeNull(); expect(lead.data!.confirmed_at).toBeNull();
  const mail = await waitForEmail(email, { timeout: 20_000 });
  await page.goto(extractMagicLink(mail.HTML || mail.Text || '')!);
  await page.waitForURL('**/my-products');
  const hooks = await (await request.get(`${origin}/hooks`)).json();
  const hook = hooks.find((h: { body: string }) => JSON.parse(h.body).data.leadId === lead.data!.id);
  expect(JSON.parse(hook.body).data).toMatchObject({ marketingConsent: true, consentVersion: '1:en', product: null });
});

test('real submit IP limit consumes every nonce before 429', async ({ request }) => {
  await db.from('application_rate_limits').delete().eq('action_type', 'leads_submit');
  const p = await product(); const email = `rate-${randomUUID()}@example.com`;
  for (let i = 0; i < 6; i++) {
    const c = await challenge(request, p.id);
    const r = await request.post('/api/leads/submit', { headers: { origin }, data: { ...c, product: p.id, email, src: 'https://files.example.com/video.mp4', altcha: 'invalid' } });
    expect(r.status()).toBe(i < 5 ? 400 : 429);
    const used = await db.from('lead_nonces').select('nonce_hash').eq('nonce_hash', createHash('sha256').update(c.nonce).digest('hex'));
    expect(used.data).toEqual([]);
  }
});
