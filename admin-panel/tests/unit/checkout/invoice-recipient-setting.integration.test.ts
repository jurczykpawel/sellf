/**
 * DB TEST (W223c, W223br P2): the shop setting "collect a different invoice recipient" and its audit
 * entry are saved together. A refused audit entry leaves the setting exactly as it was, and a failing
 * call never undoes a parallel, successful one (the old compensating rollback did). Panel and API v1
 * share this function.
 *
 * REQUIRES: the local Supabase stack (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).
 * @see src/lib/checkout/invoice-recipient-setting.ts
 * @see supabase/migrations/20261116110000_invoice_recipient_setting_atomic.sql
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';

import { changeInvoiceRecipientEnabled, type SettingsClient } from '@/lib/checkout/invoice-recipient-setting';

const admin = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '');
const client = admin as unknown as SettingsClient;
const ROUNDS = 12;

async function customSettings(): Promise<Record<string, unknown>> {
  const { data, error } = await admin.from('shop_config').select('custom_settings').single();
  if (error) throw error;
  return data.custom_settings as Record<string, unknown>;
}

async function setCustomSettings(value: Record<string, unknown>): Promise<void> {
  const { data } = await admin.from('shop_config').select('id').maybeSingle();
  const { error } = data
    ? await admin.from('shop_config').update({ custom_settings: value }).eq('id', data.id)
    : await admin.from('shop_config').insert({ custom_settings: value });
  if (error) throw error;
}

describe('invoice recipient setting + audit entry in one transaction @J622', () => {
  const email = `w223c-setting-${Date.now()}@example.com`;
  let adminUserId = '';
  let original: Record<string, unknown> = {};

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true });
    if (error || !data.user) throw error ?? new Error('user missing');
    adminUserId = data.user.id;
    const { data: row } = await admin.from('shop_config').select('custom_settings').maybeSingle();
    original = (row?.custom_settings ?? {}) as Record<string, unknown>;
  });
  beforeEach(async () => {
    await setCustomSettings({ ...original, w223c_other: 'kept', invoice_recipient_enabled: false });
  });
  afterAll(async () => {
    await setCustomSettings(original);
    await admin.from('audit_log').delete().eq('performed_by', adminUserId);
    await admin.auth.admin.deleteUser(adminUserId);
  });

  it('saves the flag with an audit entry naming the admin and keeps the other custom settings', async () => {
    const saved = await changeInvoiceRecipientEnabled(client, true, { performedBy: adminUserId, details: { auth: 'session' } });
    expect(saved).toEqual({ ok: true });
    expect(await customSettings()).toEqual({ ...original, w223c_other: 'kept', invoice_recipient_enabled: true });
    const { data: entries } = await admin.from('audit_log').select('table_name, operation, user_id, old_values, new_values')
      .eq('performed_by', adminUserId).eq('table_name', 'shop_config');
    expect(entries).toEqual([{
      table_name: 'shop_config', operation: 'UPDATE', user_id: adminUserId,
      old_values: { invoice_recipient_enabled: false }, new_values: { invoice_recipient_enabled: true, auth: 'session' },
    }]);
  });

  it('a refused audit entry (performed_by is not an auth user) leaves the setting unchanged', async () => {
    const ghost = randomUUID();
    const saved = await changeInvoiceRecipientEnabled(client, true, { performedBy: ghost });
    expect(saved.ok).toBe(false);
    expect(await customSettings()).toEqual({ ...original, w223c_other: 'kept', invoice_recipient_enabled: false });
    const { data: entries } = await admin.from('audit_log').select('id').eq('performed_by', ghost);
    expect(entries).toEqual([]);
  });

  it('interleaved calls: a failing audit of one never undoes the other, successful change', async () => {
    const outcomes: Array<{ failed: boolean; succeeded: boolean; stored: unknown }> = [];
    for (let round = 0; round < ROUNDS; round++) {
      await setCustomSettings({ ...original, w223c_other: 'kept', invoice_recipient_enabled: false });
      const [failing, succeeding] = await Promise.all([
        changeInvoiceRecipientEnabled(client, true, { performedBy: randomUUID() }),
        changeInvoiceRecipientEnabled(client, true, { performedBy: adminUserId }),
      ]);
      outcomes.push({ failed: !failing.ok, succeeded: succeeding.ok, stored: (await customSettings()).invoice_recipient_enabled });
    }
    expect(outcomes).toEqual(Array.from({ length: ROUNDS }, () => ({ failed: true, succeeded: true, stored: true })));
    expect((await customSettings()).w223c_other).toBe('kept');
  });
});
