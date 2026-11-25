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

const minutes = (n: number) => n * 60000;

it.each([
  { buyer: 'guest', code: 'send_failed' },
  { buyer: 'signed-in buyer', code: 'address_rate_limited' },
] as const)('backs off refused payment confirmations for a $buyer and hands them to the administrator after 30 attempts', async ({ buyer, code }) => {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const id = crypto.randomUUID(), product = crypto.randomUUID(), email = `${id}@example.com`;
  let userId: string | undefined;
  const saved = async () => {
    const result = await db.from('payment_transactions')
      .select('transfer_paid_mail_sent_at,transfer_paid_mail_delivery_unknown,transfer_paid_mail_retry_at,transfer_paid_mail_attempts').eq('id', id).single();
    expect(result.error).toBeNull(); return result.data!;
  };
  const clock = vi.spyOn(Date, 'now');
  try {
    if (buyer === 'signed-in buyer') {
      const created = await db.auth.admin.createUser({ email, email_confirm: true });
      expect(created.error).toBeNull(); userId = created.data.user!.id;
    }
    expect((await db.from('products').insert({ id: product, slug: product, name: 'Paid backoff', price: 10, currency: 'PLN' })).error).toBeNull();
    expect((await db.from('payment_transactions').insert({ id, product_id: product, customer_email: email, user_id: userId ?? null, amount: 1000, currency: 'PLN',
      payment_provider: 'bank_transfer', pricing_snapshot_version: 1, status: 'completed', metadata: { locale: 'en' } })).error).toBeNull();
    send.mockResolvedValue({ ok: false, code });
    let now = Date.parse('2026-11-25T10:00:00Z');
    for (let attempt = 1; attempt < 30; attempt++) {
      clock.mockReturnValue(now);
      expect(await sendOrderNotice(db, id, 'paid')).toEqual({ sent: false, outcome: 'refused' });
      const delay = minutes(Math.min(2 ** attempt, 60));
      expect(await saved()).toEqual({ transfer_paid_mail_sent_at: null, transfer_paid_mail_delivery_unknown: false,
        transfer_paid_mail_retry_at: expect.any(String), transfer_paid_mail_attempts: attempt });
      expect(Date.parse((await saved()).transfer_paid_mail_retry_at!)).toBe(now + delay);
      clock.mockReturnValue(now + delay - 1000);
      expect(await sendOrderNotice(db, id, 'paid')).toEqual({ sent: false, outcome: 'skipped' });
      expect(send).toHaveBeenCalledTimes(attempt);
      now += delay;
    }
    expect(send.mock.calls.every(([input]) => input.paidTransferAccess === (buyer === 'guest' ? true : undefined))).toBe(true);
    clock.mockReturnValue(now);
    expect(await sendOrderNotice(db, id, 'paid')).toEqual({ sent: false, outcome: 'refused' });
    const handedOver = await saved();
    expect(handedOver).toMatchObject({ transfer_paid_mail_delivery_unknown: true, transfer_paid_mail_retry_at: null, transfer_paid_mail_attempts: 30 });
    expect(handedOver.transfer_paid_mail_sent_at).not.toBeNull();
    clock.mockReturnValue(now + minutes(120));
    expect(await sendOrderNotice(db, id, 'paid')).toEqual({ sent: false, outcome: 'skipped' });
    expect(send).toHaveBeenCalledTimes(30);
    clock.mockReturnValue(now + minutes(121));
    expect(await sendOrderNotice(db, id, 'paid', true)).toEqual({ sent: false, outcome: 'refused' });
    expect(send).toHaveBeenCalledTimes(31);
    expect(await saved()).toMatchObject({ transfer_paid_mail_delivery_unknown: true, transfer_paid_mail_retry_at: null, transfer_paid_mail_attempts: 31 });
  } finally {
    clock.mockRestore();
    await db.from('payment_transactions').delete().eq('id', id);
    await db.from('products').delete().eq('id', product);
    if (userId) await db.auth.admin.deleteUser(userId);
  }
});

it('resets the payment confirmation attempts after delivery and when the order leaves completed', async () => {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const id = crypto.randomUUID(), product = crypto.randomUUID();
  const saved = async () => {
    const result = await db.from('payment_transactions').select('transfer_paid_mail_retry_at,transfer_paid_mail_attempts').eq('id', id).single();
    expect(result.error).toBeNull(); return result.data!;
  };
  try {
    expect((await db.from('products').insert({ id: product, slug: product, name: 'Paid reset', price: 10, currency: 'PLN' })).error).toBeNull();
    expect((await db.from('payment_transactions').insert({ id, product_id: product, customer_email: `${id}@example.com`, amount: 1000, currency: 'PLN',
      payment_provider: 'bank_transfer', pricing_snapshot_version: 1, status: 'completed', metadata: { locale: 'en' },
      transfer_paid_mail_attempts: 7, transfer_paid_mail_retry_at: new Date(Date.now() - 1000).toISOString() })).error).toBeNull();
    send.mockResolvedValue({ ok: true });
    expect(await sendOrderNotice(db, id, 'paid')).toEqual({ sent: true, outcome: 'sent' });
    expect(await saved()).toEqual({ transfer_paid_mail_retry_at: null, transfer_paid_mail_attempts: 0 });
    expect((await db.from('payment_transactions').update({ transfer_paid_mail_attempts: 4, transfer_paid_mail_retry_at: new Date(Date.now() + 60000).toISOString() }).eq('id', id)).error).toBeNull();
    expect((await db.from('payment_transactions').update({ status: 'refunded' }).eq('id', id)).error).toBeNull();
    expect(await saved()).toEqual({ transfer_paid_mail_retry_at: null, transfer_paid_mail_attempts: 0 });
  } finally {
    await db.from('payment_transactions').delete().eq('id', id);
    await db.from('products').delete().eq('id', product);
  }
});
