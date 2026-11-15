/**
 * W223a: "collect the invoice recipient" is a shop setting, OFF by default (owner 10.11: rare,
 * mostly public institutions). Stored in shop_config.custom_settings without touching other keys.
 * @see src/lib/checkout/invoice-recipient-setting.ts
 */
import { describe, expect, it, vi } from 'vitest';
import { readInvoiceRecipientEnabled, saveInvoiceRecipientEnabled } from '@/lib/checkout/invoice-recipient-setting';
import type { SettingsClient } from '@/lib/checkout/invoice-recipient-setting';

function client(row: { id: string; custom_settings: unknown } | null) {
  const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
  const insert = vi.fn(async () => ({ error: null }));
  const db = { from: vi.fn(() => ({ select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }), update, insert })) };
  return { db: db as unknown as SettingsClient, update, insert };
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

  it('saving keeps the other custom settings', async () => {
    const { db, update } = client({ id: 'cfg', custom_settings: { default_locale: 'pl', timezone: 'Europe/Warsaw' } });
    expect(await saveInvoiceRecipientEnabled(db, true)).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ custom_settings: { default_locale: 'pl', timezone: 'Europe/Warsaw', invoice_recipient_enabled: true } }));
  });

  it('saving on a fresh install creates the shop row', async () => {
    const { db, insert } = client(null);
    expect(await saveInvoiceRecipientEnabled(db, false)).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ custom_settings: { invoice_recipient_enabled: false } }));
  });
});
