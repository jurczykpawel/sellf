/** Persisted notice reservation and explicit recovery. @see lib/orders/transfer-mail.ts */
import { createClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
const send = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/magic-link/request', () => ({ sendTrustedMagicLink: send }));
import { sendOrderNotice } from '@/lib/orders/transfer-mail';

it('holds unknown delivery across concurrent jobs until an administrator retries it', async () => {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const id = crypto.randomUUID(), product = crypto.randomUUID();
  const saved = async () => {
    const result = await db.from('payment_transactions').select('transfer_mail_sent_at,transfer_mail_delivery_unknown').eq('id', id).single();
    expect(result.error).toBeNull(); return result.data!;
  };
  try {
    expect((await db.from('products').insert({ id: product, slug: product, name: 'Mail recovery', price: 10, currency: 'PLN' })).error).toBeNull();
    expect((await db.from('payment_transactions').insert({ id, product_id: product, customer_email: `${id}@example.com`, amount: 1000, currency: 'PLN', payment_provider: 'bank_transfer', pricing_snapshot_version: 1, status: 'awaiting_payment', metadata: { locale: 'en' } })).error).toBeNull();
    send.mockImplementation(async () => { expect((await saved()).transfer_mail_delivery_unknown).toBe(true); return { ok: false, deliveryUnknown: true }; });
    await Promise.all(Array.from({ length: 8 }, () => sendOrderNotice(db, id, 'placed')));
    expect(send).toHaveBeenCalledTimes(1);
    expect((await saved()).transfer_mail_delivery_unknown).toBe(true);
    expect(await sendOrderNotice(db, id, 'placed')).toEqual({ sent: false, outcome: 'skipped' });
    expect(await sendOrderNotice(db, id, 'placed', true)).toEqual({ sent: false, outcome: 'skipped' });
    expect(send).toHaveBeenCalledTimes(1);
    expect((await db.from('payment_transactions').update({ transfer_mail_sent_at: new Date(Date.now() - 600000).toISOString() }).eq('id', id)).error).toBeNull();
    send.mockResolvedValue({ ok: true });
    const results = await Promise.all(Array.from({ length: 8 }, () => sendOrderNotice(db, id, 'placed', true)));
    expect(results.filter(r => r.sent)).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect((await saved()).transfer_mail_delivery_unknown).toBe(false);
    expect((await db.from('payment_transactions').update({ reminder_mail_delivery_unknown: true, reminder_mail_sent_at: new Date(Date.now() - 600000).toISOString() }).eq('id', id)).error).toBeNull();
    expect((await db.from('payment_transactions').update({ status: 'completed' }).eq('id', id)).error).toBeNull();
    const current = await db.from('payment_transactions').select('reminder_mail_delivery_unknown').eq('id', id).single();
    expect(current.error).toBeNull();
    expect(current.data?.reminder_mail_delivery_unknown).toBe(false);
    expect(await sendOrderNotice(db, id, 'reminder', true)).toEqual({ sent: false, outcome: 'skipped' });
    expect(send).toHaveBeenCalledTimes(2);
  } finally {
    await db.from('payment_transactions').delete().eq('id', id);
    await db.from('products').delete().eq('id', product);
  }
});

afterEach(() => send.mockReset());
it.each(['sent', 'skipped', 'refused', 'unknown', 'error'] as const)('persists and reports a retry with %s delivery', async outcome => {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const id = crypto.randomUUID(), product = crypto.randomUUID();
  const before = new Date(Date.now() - 600000).toISOString();
  try {
    expect((await db.from('products').insert({ id: product, slug: product, name: 'Retry result', price: 10, currency: 'PLN' })).error).toBeNull();
    expect((await db.from('payment_transactions').insert({ id, product_id: product, customer_email: `${id}@example.com`, amount: 1000, currency: 'PLN', payment_provider: 'bank_transfer', pricing_snapshot_version: 1, status: 'awaiting_payment', transfer_mail_delivery_unknown: true, transfer_mail_sent_at: before })).error).toBeNull();
    if (outcome === 'error') send.mockRejectedValue(new Error('Unavailable'));
    else send.mockResolvedValue({ ok: outcome === 'sent' || outcome === 'skipped', skipped: outcome === 'skipped', deliveryUnknown: outcome === 'unknown' });
    expect(await sendOrderNotice(db, id, 'placed', true)).toEqual({ sent: outcome === 'sent', outcome });
    expect(send).toHaveBeenCalledTimes(1);
    const current = await db.from('payment_transactions').select('transfer_mail_sent_at,transfer_mail_delivery_unknown').eq('id', id).single();
    expect(current.error).toBeNull();
    expect(current.data?.transfer_mail_delivery_unknown).toBe(outcome === 'unknown' || outcome === 'error');
    if (outcome === 'refused') expect(current.data?.transfer_mail_sent_at).toBeNull();
    else expect(Date.parse(current.data!.transfer_mail_sent_at!)).toBeGreaterThan(Date.parse(before));
  } finally {
    await db.from('payment_transactions').delete().eq('id', id);
    await db.from('products').delete().eq('id', product);
  }
});
