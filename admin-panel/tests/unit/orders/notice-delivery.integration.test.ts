/** Persisted notice reservation and explicit recovery. @see lib/orders/transfer-mail.ts */
import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
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
    await sendOrderNotice(db, id, 'placed'); await sendOrderNotice(db, id, 'placed', true);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await db.from('payment_transactions').update({ transfer_mail_sent_at: new Date(Date.now() - 600000).toISOString() }).eq('id', id)).error).toBeNull();
    send.mockResolvedValue({ ok: true });
    await Promise.all(Array.from({ length: 8 }, () => sendOrderNotice(db, id, 'placed', true)));
    expect(send).toHaveBeenCalledTimes(2);
    expect((await saved()).transfer_mail_delivery_unknown).toBe(false);
  } finally {
    await db.from('payment_transactions').delete().eq('id', id);
    await db.from('products').delete().eq('id', product);
  }
});
