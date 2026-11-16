/**
 * DB TEST (W256d): a process killed (SIGKILL) at the change leaves no audit entry claiming a change
 * that did not happen. W256cr killed saveInvoiceSettings after its audit insert and before the
 * settings update: settings unchanged, 1 × UPDATE in audit_log — "audit first, take it back on error"
 * cannot take anything back from a dead process. Now the change and its entry are one RPC.
 *
 * Each case spawns sigkill-child.test.ts, which runs the real code against the local database and
 * SIGKILLs itself at the request that makes the change: `before` it is sent and `after` its response.
 * Invariant checked in both: an audit entry exists exactly when the change does.
 *
 * REQUIRES: the local Supabase stack (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).
 * @see src/lib/actions/invoicing.ts
 * @see src/app/api/users/[id]/access/route.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const db = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '');
const root = resolve(__dirname, '../../..');
const dir = mkdtempSync(join(tmpdir(), 'w256d-sigkill-'));

function runChild(kase: 'invoicing' | 'grant' | 'revoke', when: 'before' | 'after', ids: { actor: string; userId?: string; productId?: string }): string {
  const marker = join(dir, `${kase}-${when}`);
  const child = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/unit/audit/sigkill-child.test.ts'], {
    cwd: root, encoding: 'utf8', timeout: 90_000,
    env: { ...process.env, W256D_SIGKILL_CASE: kase, W256D_SIGKILL_WHEN: when, W256D_SIGKILL_MARKER: marker,
      W256D_SIGKILL_ACTOR: ids.actor, W256D_SIGKILL_USER: ids.userId ?? '', W256D_SIGKILL_PRODUCT: ids.productId ?? '' },
  });
  // The child must have died at the change request; otherwise the checks below prove nothing.
  expect(existsSync(marker), `child never reached the change request:\n${child.stdout}\n${child.stderr}`).toBe(true);
  return readFileSync(marker, 'utf8');
}

let actor = '';
let buyer = '';
const product = crypto.randomUUID();
const stamp = Date.now();

beforeAll(async () => {
  const admin = await db.auth.admin.createUser({ email: `w256d-sigkill-admin-${stamp}@example.com`, email_confirm: true });
  const user = await db.auth.admin.createUser({ email: `w256d-sigkill-buyer-${stamp}@example.com`, email_confirm: true });
  if (admin.error || user.error) throw admin.error ?? user.error;
  actor = admin.data.user!.id;
  buyer = user.data.user!.id;
  const inserted = await db.from('products').insert({ id: product, name: 'W256d SIGKILL', slug: `w256d-sigkill-${stamp}`, price: 10, currency: 'PLN', is_active: true });
  if (inserted.error) throw inserted.error;
});

afterAll(async () => {
  await db.from('audit_log').delete().eq('performed_by', actor);
  await db.from('user_product_access').delete().eq('user_id', buyer);
  await db.from('business_events').delete().eq('product_id', product);
  await db.from('products').delete().eq('id', product);
  await db.auth.admin.deleteUser(buyer);
  await db.auth.admin.deleteUser(actor);
  rmSync(dir, { recursive: true, force: true });
});

const auditRows = async (table: string, operation: string) => {
  const rows = await db.from('audit_log').select('id').eq('performed_by', actor).eq('table_name', table).eq('operation', operation);
  expect(rows.error).toBeNull();
  return rows.data!.length;
};

describe('SIGKILL at the change leaves no false audit entry', () => {
  it('invoice settings', { timeout: 180_000 }, async () => {
    const config = await db.from('invoicing_config').select('*').eq('id', true).single();
    expect(config.error).toBeNull();
    try {
      expect(runChild('invoicing', 'before', { actor })).toMatch(/^before (PATCH|POST) /);
      expect((await db.from('invoicing_config').select('template').eq('id', true).single()).data?.template).toBe(config.data!.template);
      expect(await auditRows('invoicing_config', 'UPDATE')).toBe(0);

      expect(runChild('invoicing', 'after', { actor })).toMatch(/^after 20\d /);
      expect((await db.from('invoicing_config').select('template').eq('id', true).single()).data?.template).toBe('{product} w256d-sigkill');
      expect(await auditRows('invoicing_config', 'UPDATE')).toBe(1);
    } finally {
      const { id: _id, instance_id: _instance, auto_since: _since, ...restore } = config.data!;
      await db.from('invoicing_config').update(restore).eq('id', true);
    }
  });

  it('admin access grant and revoke', { timeout: 300_000 }, async () => {
    const access = async () => (await db.from('user_product_access').select('id').eq('user_id', buyer).eq('product_id', product)).data!.length;

    expect(runChild('grant', 'before', { actor, userId: buyer, productId: product })).toMatch(/^before POST /);
    expect(await access()).toBe(0);
    expect(await auditRows('user_product_access', 'INSERT')).toBe(0);

    expect(runChild('grant', 'after', { actor, userId: buyer, productId: product })).toMatch(/^after 200 POST /);
    expect(await access()).toBe(1);
    expect(await auditRows('user_product_access', 'INSERT')).toBe(1);

    expect(runChild('revoke', 'before', { actor, userId: buyer, productId: product })).toMatch(/^before POST /);
    expect(await access()).toBe(1);
    expect(await auditRows('user_product_access', 'DELETE')).toBe(0);

    expect(runChild('revoke', 'after', { actor, userId: buyer, productId: product })).toMatch(/^after 200 POST /);
    expect(await access()).toBe(0);
    expect(await auditRows('user_product_access', 'DELETE')).toBe(1);
  });
});
