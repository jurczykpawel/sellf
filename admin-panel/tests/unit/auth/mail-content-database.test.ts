/** Render actual Supabase auth emails through the local Mailpit stack. */
import { createClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { deliverMagicLink } from '@/lib/auth/magic-link/deliver';
import { waitForEmail } from '../../helpers/mailpit';

it.each(['pl', 'en'])('renders confirmation and magic link purchase details in %s', async locale => {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  for (const confirmed of [false, true]) {
    const email = `mail-${locale}-${confirmed}-${crypto.randomUUID()}@example.com`;
    let id: string | undefined;
    try {
      if (confirmed) {
        const result = await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: { locale: 'pl', purchase_product: 'Previous product' } });
        expect(result.error).toBeNull(); id = result.data.user!.id;
      }
      const data = { locale, event_date: locale === 'pl' ? '10 gru 2026, 18:00 (Europe/Warsaw)' : '10 Dec 2026, 18:00 (Europe/Warsaw)',
        event_online_url: 'https://example.com/online', purchase_product: 'Mail workshop', purchase_amount: '67 PLN',
        transfer_text: locale === 'pl' ? 'Numer konta: PL61109010140000071219812874\nTytuł: Zamówienie 97\nKwota: 67 PLN\nTermin: 10 grudnia 2026' : 'Account number: PL61109010140000071219812874\nReference: Order 97\nAmount: 67 PLN\nDue date: 10 December 2026' };
      const result = await deliverMagicLink({ email, shouldCreateUser: true,
        redirectTo: `${process.env.SITE_URL}/auth/callback?flow=login`, data });
      expect(result).toEqual({ ok: true });
      const mail = await waitForEmail(email);
      expect(mail.Subject).toBe(locale === 'en' ? (confirmed ? 'Your sign-in link' : 'Confirm your email') : (confirmed ? 'Twój link do logowania' : 'Potwierdź swój email'));
      const html = mail.HTML!;
      for (const value of [data.event_date, data.event_online_url, data.purchase_product, data.purchase_amount, locale === 'pl' ? 'Numer konta:' : 'Account number:']) expect(html).toContain(value);
      expect(html).toContain(locale === 'pl' ? 'Dołącz online' : 'Join online');
      expect(html).not.toContain('Previous product');
      expect(html).toContain(confirmed ? 'type=magiclink' : 'type=signup');
      expect(html).not.toContain('{{');
    } finally {
      if (!id) id = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find(user => user.email === email)?.id;
      if (id) await db.auth.admin.deleteUser(id);
    }
  }
});

it('delivers labeled transfer instructions with a Polish due date and purchase amount', async () => {
  const { sendTransferAccessMail } = await import('@/lib/orders/transfer-mail');
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const email = `transfer-mail-${crypto.randomUUID()}@example.com`;
  const { data: product, error } = await db.from('products').insert({ name: 'Transfer workshop', slug: `transfer-${crypto.randomUUID()}`, price: 123, currency: 'PLN' }).select('id').single();
  expect(error).toBeNull();
  const pid = product!.id;
  try {
    const { data: tx, error: txError } = await db.from('payment_transactions').insert({ product_id: pid,
      customer_email: email, amount: 12300, currency: 'PLN', status: 'awaiting_payment', payment_provider: 'bank_transfer', pricing_snapshot_version: 1,
      payment_due_at: '2026-12-10T00:00:00Z', metadata: { access_on_placement: true, locale: 'pl' },
      transfer_details: { holder: 'Workshop Shop', account: 'PL61109010140000071219812874', bank: 'Test bank', title: 'Zamówienie 97' },
    }).select('id').single();
    expect(txError).toBeNull();
    await sendTransferAccessMail(db, tx!.id);
    const mail = await waitForEmail(email);
    for (const text of ['Transfer workshop', 'Numer konta: PL61109010140000071219812874', 'Tytuł: Zamówienie 97', 'Kwota: 123', 'Termin: 10 grudnia 2026']) expect(mail.HTML).toContain(text);
    expect(mail.HTML).not.toContain('2026-12-10');
  } finally {
    const user = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find(u => u.email === email);
    if (user) await db.auth.admin.deleteUser(user.id);
    await db.from('payment_transactions').delete().eq('product_id', pid);
    await db.from('products').delete().eq('id', pid);
  }
});
