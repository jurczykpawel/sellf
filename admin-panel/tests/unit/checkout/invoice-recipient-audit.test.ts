/**
 * Every change of the shop setting "collect a different invoice recipient"
 * leaves an audit entry with the admin's user UUID (audit_log.performed_by references auth.users).
 * Setting and entry are saved in one database transaction (set_invoice_recipient_enabled); when the
 * entry is refused nothing is saved and the caller gets an error — from the panel and API v1 alike.
 * The transaction itself is proven against the real database in invoice-recipient-setting.integration.test.ts.
 *
 * @see src/lib/checkout/invoice-recipient-setting.ts
 * @see src/app/api/v1/settings/checkout/route.ts
 * @see src/lib/actions/invoice-recipient-config.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const ADMIN_USER_ID = '6f1c1c3e-9b7a-4d55-8a5e-2a8b9c0d1e2f';

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  authenticate: vi.fn(),
}));

function settingsClient() {
  return { rpc: h.rpc, from: h.from };
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
  h.rpc.mockResolvedValue({ data: false, error: null });
  h.authenticate.mockResolvedValue({ method: 'api_key', supabase: settingsClient(), admin: { userId: ADMIN_USER_ID, adminId: 'adm-1', email: null }, scopes: ['system:write'] });
});

const refused = { data: null, error: { code: '23503', message: 'insert or update on table "audit_log" violates foreign key constraint' } };

describe('invoice recipient setting — audited change @J622', () => {
  it('stores the change and the audit entry naming the admin by UUID in one database call', async () => {
    const client = settingsClient() as unknown as SettingsClient;
    expect(await changeInvoiceRecipientEnabled(client, true, { performedBy: ADMIN_USER_ID })).toEqual({ ok: true });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith('set_invoice_recipient_enabled', { p_enabled: true, p_performed_by: ADMIN_USER_ID, p_details: {} });
    expect(h.from).not.toHaveBeenCalled();
  });

  it('a refused audit entry is an error and nothing is written afterwards (no compensating rollback)', async () => {
    h.rpc.mockResolvedValue(refused);
    const result = await changeInvoiceRecipientEnabled(settingsClient() as unknown as SettingsClient, true, { performedBy: ADMIN_USER_ID });
    expect(result.ok).toBe(false);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.from).not.toHaveBeenCalled();
  });

  it('API v1 PATCH: performed_by is the key owner\'s user UUID, never an e-mail', async () => {
    const res = await PATCH(patch({ invoice_recipient_enabled: true }));
    expect(res.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith('set_invoice_recipient_enabled', { p_enabled: true, p_performed_by: ADMIN_USER_ID, p_details: { auth: 'api_key' } });
  });

  it('API v1 PATCH: a refused audit entry answers 500', async () => {
    h.rpc.mockResolvedValue(refused);
    const res = await PATCH(patch({ invoice_recipient_enabled: true }));
    expect(res.status).toBe(500);
    expect(h.from).not.toHaveBeenCalled();
  });

  it('panel: the change names the signed-in admin; a refused audit entry is reported as a failure', async () => {
    expect((await setInvoiceRecipientSetting(true)).success).toBe(true);
    expect(h.rpc).toHaveBeenCalledWith('set_invoice_recipient_enabled', { p_enabled: true, p_performed_by: ADMIN_USER_ID, p_details: { auth: 'session' } });
    h.rpc.mockResolvedValue(refused);
    expect((await setInvoiceRecipientSetting(true)).success).toBe(false);
  });
});
