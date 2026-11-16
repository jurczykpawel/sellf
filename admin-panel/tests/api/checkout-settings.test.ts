/**
 * API v1: shop checkout settings — "collect a different invoice recipient" (W223a, owner 10.11:
 * OFF by default, institutions only). @J622
 */
import { afterAll, describe, expect, it } from 'vitest';
import { get, patch, supabase } from './setup';

interface Settings { invoice_recipient_enabled: boolean }
interface ApiResponse<T> { data?: T; error?: { code: string; message: string } }

async function stored(): Promise<Record<string, unknown>> {
  const { data } = await supabase.from('shop_config').select('custom_settings').maybeSingle();
  return (data?.custom_settings ?? {}) as Record<string, unknown>;
}

describe('GET/PATCH /api/v1/settings/checkout', () => {
  afterAll(async () => { await patch('/api/v1/settings/checkout', { invoice_recipient_enabled: false }); });

  it('reads the setting (off by default) and switches it on and off without touching other settings @J622', async () => {
    const before = await stored();
    const read = await get<ApiResponse<Settings>>('/api/v1/settings/checkout');
    expect(read.status).toBe(200);
    expect(read.data.data).toEqual({ invoice_recipient_enabled: before.invoice_recipient_enabled === true });

    const on = await patch<ApiResponse<Settings>>('/api/v1/settings/checkout', { invoice_recipient_enabled: true });
    expect(on.status).toBe(200);
    expect(on.data.data).toEqual({ invoice_recipient_enabled: true });
    const after = await stored();
    expect(after.invoice_recipient_enabled).toBe(true);
    const { invoice_recipient_enabled: _ignored, ...others } = after;
    const { invoice_recipient_enabled: _ignored2, ...othersBefore } = before;
    expect(others).toEqual(othersBefore);

    const off = await patch<ApiResponse<Settings>>('/api/v1/settings/checkout', { invoice_recipient_enabled: false });
    expect(off.data.data).toEqual({ invoice_recipient_enabled: false });
  });

  it('rejects unknown fields and non-boolean values', async () => {
    expect((await patch('/api/v1/settings/checkout', { invoice_recipient_enabled: 'yes' })).status).toBe(400);
    expect((await patch('/api/v1/settings/checkout', { invoice_recipient_enabled: true, tax_mode: 'local' })).status).toBe(400);
    expect((await patch('/api/v1/settings/checkout', {})).status).toBe(400);
  });
});
