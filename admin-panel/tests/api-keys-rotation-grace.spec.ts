/** API key rotation, presentation and immediate retirement through the panel. */
import { randomBytes } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { setAuthSession, createTestAdmin } from './helpers/admin-auth';
import { insertTestApiKey } from './helpers/api-key';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

test('grace-period keys show their deadline and can be revoked immediately @J66', async ({ page, request }) => {
  const owner = await createTestAdmin('rotation-grace');
  const { data: user } = await db.from('admin_users').select('id').eq('user_id',
    (await db.auth.admin.listUsers()).data.users.find(u => u.email === owner.email)!.id).single();
  const secret = `sf_test_${randomBytes(32).toString('hex')}`;
  const { data: key } = await insertTestApiKey(db, secret, {
    admin_user_id: user!.id, name: 'Grace lifecycle key', scopes: ['products:read'],
  });
  const ids = [key.id];
  const products = (token: string) => request.get('/api/v1/products', { headers: { Authorization: `Bearer ${token}` } });
  try {
    await setAuthSession(page, owner.email, owner.password);
    await page.goto('/en/dashboard/api-keys');
    const row = page.getByRole('row').filter({ hasText: 'Grace lifecycle key' }).filter({ hasNotText: '(rotated)' });
    await row.getByTitle('Rotate Key', { exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Rotate Key', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'API Key Created' })).toBeVisible();
    const replacement = await dialog.locator('input[readonly]').inputValue();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    const list = await (await page.request.get('/api/v1/api-keys')).json();
    ids.push(...list.data.filter((k: { id: string }) => k.id !== key.id).map((k: { id: string }) => k.id));
    expect((await products(secret)).status()).toBe(200);
    expect((await products(replacement)).status()).toBe(200);
    await expect(row.getByText(/^Grace period until /)).toBeVisible();
    expect(list.data.find((k: { id: string }) => k.id === key.id)).toMatchObject({ status: 'grace', is_active: false });
    await row.getByTitle('Revoke Key Now', { exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Revoke Key', exact: true }).click();
    await expect(row.getByText('Revoked', { exact: true })).toBeVisible({ timeout: 15000 });
    expect((await products(secret)).status()).toBe(401);
    expect((await products(replacement)).status()).toBe(200);
    expect((await page.request.patch(`/api/v1/api-keys/${key.id}`, { data: { is_active: true } })).status()).toBe(400);
    const { data: audit, error } = await db.from('api_key_audit_log').select('event_type').eq('api_key_id', key.id).eq('event_type', 'revoked');
    expect(error).toBeNull();
    expect(audit).toHaveLength(1);
    const { data: adminAudit, error: adminAuditError } = await db.from('audit_log')
      .select('performed_by').eq('table_name', 'api_keys')
      .contains('new_values', { id: key.id, action: 'revoked' });
    expect(adminAuditError).toBeNull();
    expect(adminAudit).toHaveLength(1);
  } finally {
    await db.from('audit_log').delete().eq('table_name', 'api_keys').in('new_values->>id', ids);
    await db.from('api_key_audit_log').delete().in('api_key_id', ids);
    await db.from('api_keys').delete().eq('admin_user_id', user!.id);
    await owner.cleanup();
  }
});

test('expired grace keys return 401 and remain revocable', async ({ page, request }) => {
  const owner = await createTestAdmin('rotation-expired');
  const { data: users } = await db.auth.admin.listUsers();
  const { data: admin } = await db.from('admin_users').select('id').eq('user_id', users.users.find(u => u.email === owner.email)!.id).single();
  const secret = `sf_test_${randomBytes(32).toString('hex')}`;
  const { data: key } = await insertTestApiKey(db, secret, {
    admin_user_id: admin!.id, name: 'Expired grace key', scopes: ['products:read'], is_active: false,
    rotation_grace_until: '2000-01-01T00:00:00Z',
  });
  try {
    await setAuthSession(page, owner.email, owner.password);
    await page.goto('/en/dashboard/api-keys');
    const row = page.getByRole('row').filter({ hasText: 'Expired grace key' });
    await expect(row.getByText('Expired', { exact: true })).toBeVisible();
    await expect(row.getByTitle('Revoke Key Now', { exact: true })).toBeVisible();
    expect((await request.get('/api/v1/products', { headers: { Authorization: `Bearer ${secret}` } })).status()).toBe(401);
  } finally {
    await db.from('api_keys').delete().eq('id', key.id);
    await owner.cleanup();
  }
});
