/**
 * "Collect the invoice recipient" is a shop setting, OFF by default (rarely needed,
 * mostly by public institutions). Stored in shop_config.custom_settings without touching other keys
 * (the database side is covered by invoice-recipient-setting.integration.test.ts).
 * @see src/lib/checkout/invoice-recipient-setting.ts
 */
import { describe, expect, it, vi } from 'vitest';
import { changeInvoiceRecipientEnabled, readInvoiceRecipientEnabled } from '@/lib/checkout/invoice-recipient-setting';
import type { SettingsClient } from '@/lib/checkout/invoice-recipient-setting';

function client(row: { id: string; custom_settings: unknown } | null) {
  const db = { from: vi.fn(() => ({ select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) })), rpc: vi.fn(async () => ({ data: false, error: null })) };
  return { db: db as unknown as SettingsClient, rpc: db.rpc, from: db.from };
}

describe('invoice recipient shop setting @J622', () => {
  it('is off unless explicitly enabled', async () => {
    expect(await readInvoiceRecipientEnabled(client(null).db)).toBe(false);
    expect(await readInvoiceRecipientEnabled(client({ id: '1', custom_settings: {} }).db)).toBe(false);
    expect(await readInvoiceRecipientEnabled(client({ id: '1', custom_settings: { invoice_recipient_enabled: 'true' } }).db)).toBe(false);
    expect(await readInvoiceRecipientEnabled(client({ id: '1', custom_settings: { invoice_recipient_enabled: true } }).db)).toBe(true);
  });

  it('a database error reads as off (the checkout keeps working)', async () => {
    const db = { from: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }) }) } as unknown as SettingsClient;
    expect(await readInvoiceRecipientEnabled(db)).toBe(false);
  });

  it('saving goes through the one atomic database call, never a direct table write', async () => {
    const { db, rpc, from } = client({ id: 'cfg', custom_settings: { default_locale: 'pl' } });
    expect(await changeInvoiceRecipientEnabled(db, true, { performedBy: '00000000-0000-4000-8000-000000000001', details: { auth: 'session' } })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('set_invoice_recipient_enabled', { p_enabled: true, p_performed_by: '00000000-0000-4000-8000-000000000001', p_details: { auth: 'session' } });
    expect(from).not.toHaveBeenCalled();
  });

  it('a refused call is reported as an error (nothing to undo)', async () => {
    const { db, rpc, from } = client(null);
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'insert or update on table "audit_log" violates foreign key constraint' } } as never);
    expect(await changeInvoiceRecipientEnabled(db, false, { performedBy: '00000000-0000-4000-8000-000000000001' })).toEqual({ ok: false, error: expect.stringContaining('audit_log') });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalled();
  });
});
