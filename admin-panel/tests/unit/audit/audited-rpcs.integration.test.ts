/**
 * DB TEST: the RPCs that write a change together with its audit entry. A refused entry
 * (performed_by is no auth user → FK violation) leaves the change undone; a valid one commits both;
 * anon and authenticated cannot call them.
 *
 * REQUIRES: the local Supabase stack (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY).
 * @see supabase/migrations/20261111010000_manual_invoice_correction.sql (save_invoicing_config)
 * @see supabase/migrations/20261111110000_access_licenses.sql (mutate_access_audited)
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const db = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '');
const anon = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_ANON_KEY ?? '');
const stamp = Date.now();
const product = crypto.randomUUID();
const missingActor = crypto.randomUUID();
let actor = '';
let buyer = '';

beforeAll(async () => {
  const admin = await db.auth.admin.createUser({ email: `w256d-rpc-admin-${stamp}@example.com`, email_confirm: true });
  const user = await db.auth.admin.createUser({ email: `w256d-rpc-buyer-${stamp}@example.com`, email_confirm: true });
  if (admin.error || user.error) throw admin.error ?? user.error;
  actor = admin.data.user!.id;
  buyer = user.data.user!.id;
  const inserted = await db.from('products').insert({ id: product, name: 'Audited RPC', slug: `audited-rpc-${stamp}`, price: 10, currency: 'PLN', is_active: true });
  if (inserted.error) throw inserted.error;
});

afterAll(async () => {
  await db.from('audit_log').delete().eq('performed_by', actor);
  await db.from('user_product_access').delete().eq('user_id', buyer);
  await db.from('business_events').delete().eq('product_id', product);
  await db.from('products').delete().eq('id', product);
  await db.auth.admin.deleteUser(buyer);
  await db.auth.admin.deleteUser(actor);
});

const audits = async (performedBy: string, table: string) =>
  (await db.from('audit_log').select('operation, user_id, old_values, new_values').eq('performed_by', performedBy).eq('table_name', table).order('performed_at')).data!;

describe('save_invoicing_config', () => {
  it('a refused audit entry saves nothing; a valid one saves the settings and the entry together, keeping the token', async () => {
    const before = (await db.from('invoicing_config').select('*').eq('id', true).single()).data!;
    const settings = { provider: 'none', domain: '', mode: 'manual', exemption: 'zw', template: '{product} w256d-rpc' };
    try {
      const refused = await db.rpc('save_invoicing_config', { p_settings: settings, p_token: null, p_performed_by: missingActor });
      expect(refused.error?.code).toBe('23503');
      expect((await db.from('invoicing_config').select('template').eq('id', true).single()).data!.template).toBe(before.template);
      expect(await audits(missingActor, 'invoicing_config')).toEqual([]);

      const saved = await db.rpc('save_invoicing_config', { p_settings: settings, p_token: null, p_performed_by: actor });
      expect(saved.error).toBeNull();
      const after = (await db.from('invoicing_config').select('*').eq('id', true).single()).data!;
      expect(after).toMatchObject({ ...settings, token: before.token });
      expect(await audits(actor, 'invoicing_config')).toEqual([{ operation: 'UPDATE', user_id: null, old_values: null, new_values: { provider: 'none' } }]);
    } finally {
      const { id: _id, instance_id: _instance, auto_since: _since, ...restore } = before;
      await db.from('invoicing_config').update(restore).eq('id', true);
    }
  });
});

describe('mutate_access_audited', () => {
  const call = (action: 'grant' | 'revoke', performedBy: string, audit: Record<string, unknown>) => db.rpc('mutate_access_audited', {
    p_action: action, p_user_id: buyer, p_product_id: product, p_actor: { type: 'user', id: performedBy }, p_values: {}, p_audit: audit,
  });
  const access = async () => (await db.from('user_product_access').select('id').eq('user_id', buyer).eq('product_id', product)).data!.length;

  it('grant and revoke: a refused entry changes nothing, a valid one commits the change with its entry', async () => {
    expect((await call('grant', missingActor, { action: 'admin_grant_access' })).error?.code).toBe('23503');
    expect(await access()).toBe(0);

    const granted = await call('grant', actor, { product_id: product, action: 'admin_grant_access' });
    expect(granted.error).toBeNull();
    expect(granted.data).toHaveLength(1);
    expect(await access()).toBe(1);

    expect((await call('revoke', missingActor, { action: 'admin_revoke_access' })).error?.code).toBe('23503');
    expect(await access()).toBe(1);

    expect((await call('revoke', actor, { product_id: product, action: 'admin_revoke_access' })).error).toBeNull();
    expect(await access()).toBe(0);
    // Nothing left to remove: no row changed, so no entry claims a removal.
    expect((await call('revoke', actor, { product_id: product, action: 'admin_revoke_access' })).error).toBeNull();

    expect(await audits(missingActor, 'user_product_access')).toEqual([]);
    expect(await audits(actor, 'user_product_access')).toEqual([
      { operation: 'INSERT', user_id: buyer, old_values: null, new_values: { product_id: product, action: 'admin_grant_access' } },
      { operation: 'DELETE', user_id: buyer, old_values: { product_id: product, action: 'admin_revoke_access' }, new_values: null },
    ]);
  });

  it('refuses an API key actor (performed_by must be an auth user)', async () => {
    const result = await db.rpc('mutate_access_audited', { p_action: 'grant', p_user_id: buyer, p_product_id: product, p_actor: { type: 'api_key', id: crypto.randomUUID() }, p_values: {}, p_audit: {} });
    expect(result.error?.code).toBe('22023');
    expect(await access()).toBe(0);
  });
});

describe('access to the audited RPCs', () => {
  it.each([
    ['save_invoicing_config', { p_settings: {}, p_token: null, p_performed_by: crypto.randomUUID() }],
    ['mutate_access_audited', { p_action: 'grant', p_user_id: crypto.randomUUID(), p_actor: { type: 'user', id: crypto.randomUUID() } }],
    ['issue_license_with_audit', { p_license: {}, p_performed_by: crypto.randomUUID() }],
  ] as const)('anon cannot call %s', async (fn, args) => {
    const result = await anon.rpc(fn as never, args as never);
    expect(result.error?.code).toBe('42501');
  });
});
