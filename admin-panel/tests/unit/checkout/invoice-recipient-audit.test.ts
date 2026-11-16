/**
 * W223b (W223ar #1): every change of the shop setting "collect a different invoice recipient" leaves
 * an audit entry with the admin's user UUID (audit_log.performed_by references auth.users). When the
 * audit entry cannot be written the change is undone and the caller gets an error, so no change
 * happens without a trace — from the panel and from API v1 alike.
 *
 * @see src/lib/checkout/invoice-recipient-setting.ts
 * @see src/app/api/v1/settings/checkout/route.ts
 * @see src/lib/actions/invoice-recipient-config.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const ADMIN_USER_ID = '6f1c1c3e-9b7a-4d55-8a5e-2a8b9c0d1e2f';

const h = vi.hoisted(() => ({
  auditInsert: vi.fn(),
  update: vi.fn(),
  row: { id: 'cfg', custom_settings: { default_locale: 'pl', invoice_recipient_enabled: false } as Record<string, unknown> },
  authenticate: vi.fn(),
}));

function settingsClient() {
  return {
    from: vi.fn((table: string) => table === 'audit_log'
      ? { insert: h.auditInsert }
      : {
        select: () => ({ maybeSingle: async () => ({ data: h.row, error: null }) }),
        update: (values: unknown) => ({ eq: async () => { h.update(values); return { error: null }; } }),
        insert: vi.fn(async () => ({ error: null })),
      }),
  };
}

vi.mock('@/lib/supabase/admin', () => ({ createPlatformClient: () => settingsClient(), createAdminClient: () => settingsClient() }));
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), authenticate: h.authenticate }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/actions/admin-auth', () => ({
  withAdminClient: async (fn: (ctx: unknown) => unknown) => fn({ dataClient: settingsClient(), user: { id: ADMIN_USER_ID, email: 'admin@example.invalid' } }),
}));

import { changeInvoiceRecipientEnabled } from '@/lib/checkout/invoice-recipient-setting';
import { PATCH } from '@/app/api/v1/settings/checkout/route';
import { setInvoiceRecipientSetting } from '@/lib/actions/invoice-recipient-config';
import type { SettingsClient } from '@/lib/checkout/invoice-recipient-setting';

const patch = (body: unknown) => new NextRequest('http://localhost/api/v1/settings/checkout', {
  method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer sf_test' }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  h.row = { id: 'cfg', custom_settings: { default_locale: 'pl', invoice_recipient_enabled: false } };
  h.auditInsert.mockResolvedValue({ error: null });
  h.authenticate.mockResolvedValue({ method: 'api_key', supabase: settingsClient(), admin: { userId: ADMIN_USER_ID, adminId: 'adm-1', email: null }, scopes: ['system:write'] });
});

describe('invoice recipient setting — audited change @J622', () => {
  it('stores the change with an audit entry naming the admin by UUID', async () => {
    const client = settingsClient() as unknown as SettingsClient;
    expect(await changeInvoiceRecipientEnabled(client, true, { auditClient: client, performedBy: ADMIN_USER_ID })).toEqual({ ok: true });
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      table_name: 'shop_config', operation: 'UPDATE', performed_by: ADMIN_USER_ID,
      old_values: { invoice_recipient_enabled: false }, new_values: expect.objectContaining({ invoice_recipient_enabled: true }),
    }));
  });

  it('an audit insert error (returned, not thrown) undoes the change', async () => {
    h.auditInsert.mockResolvedValue({ error: { code: '22P02', message: 'invalid input syntax for type uuid' } });
    const client = settingsClient() as unknown as SettingsClient;
    const result = await changeInvoiceRecipientEnabled(client, true, { auditClient: client, performedBy: ADMIN_USER_ID });
    expect(result.ok).toBe(false);
    expect(h.update).toHaveBeenCalledTimes(2);
    expect(h.update).toHaveBeenLastCalledWith(expect.objectContaining({ custom_settings: { default_locale: 'pl', invoice_recipient_enabled: false } }));
  });

  it('API v1 PATCH: performed_by is the key owner\'s user UUID, never an e-mail', async () => {
    const res = await PATCH(patch({ invoice_recipient_enabled: true }));
    expect(res.status).toBe(200);
    expect(h.auditInsert).toHaveBeenCalledWith(expect.objectContaining({ performed_by: ADMIN_USER_ID, user_id: ADMIN_USER_ID }));
  });

  it('API v1 PATCH: a failed audit entry is an error and the setting stays as it was', async () => {
    h.auditInsert.mockResolvedValue({ error: { code: '22P02', message: 'boom' } });
    const res = await PATCH(patch({ invoice_recipient_enabled: true }));
    expect(res.status).toBe(500);
    expect(h.update).toHaveBeenLastCalledWith(expect.objectContaining({ custom_settings: { default_locale: 'pl', invoice_recipient_enabled: false } }));
  });

  it('panel: a failed audit entry is reported as a failure', async () => {
    h.auditInsert.mockResolvedValue({ error: { code: '42501', message: 'denied' } });
    const result = await setInvoiceRecipientSetting(true);
    expect(result.success).toBe(false);
  });
});
