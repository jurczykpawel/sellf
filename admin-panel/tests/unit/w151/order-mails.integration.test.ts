import { useSupabaseBuyerEmails } from '../../helpers/buyer-email-setting';
useSupabaseBuyerEmails();
/**
 * W146 mail findings, rendered by the real local Auth + Mailpit:
 * - transfer / payment-received / cancellation mails carry their own heading and intro, never the
 *   sign-up welcome ("Witaj w Sellf", "Dziękujemy za rejestrację", "Co dalej?");
 * - the transfer deadline in the mail is the one the order page shows (one truth);
 * - a paid order with a license mails the key to the buyer.
 * @see supabase/templates/confirmation.html, supabase/templates/magic-link.html
 */
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { sendOrderNotice, type OrderNotice } from '@/lib/orders/transfer-mail';
import { formatTransferDeadline, transferDeadline } from '@/lib/orders/transfer-format';
import { mailOrderLicenses } from '@/lib/license-keys/license-mail';
import { waitForEmail } from '../../helpers/mailpit';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const SIGNUP = ['Witaj w Sellf', 'Dziękujemy za rejestrację', 'Co dalej?', 'Welcome to Sellf', 'Thank you for signing up', 'What’s next?', 'Otrzymaliśmy prośbę o zalogowanie', 'request to sign in'];
const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

async function withOrder(notice: OrderNotice, locale: 'pl' | 'en', confirmed: boolean, check: (html: string, tx: { release_at: string; payment_due_at: string }) => void) {
  const email = `w151-${notice}-${locale}-${confirmed}-${crypto.randomUUID()}@example.com`;
  const { data: product } = await db.from('products').insert({ name: 'W151 workshop', slug: `w151-${crypto.randomUUID()}`, price: 123, currency: 'PLN' }).select('id').single();
  const pid = product!.id;
  try {
    if (confirmed) expect((await db.auth.admin.createUser({ email, email_confirm: true })).error).toBeNull();
    const row = { product_id: pid, customer_email: email, amount: 12300, currency: 'PLN', payment_provider: 'bank_transfer', pricing_snapshot_version: 1,
      status: notice === 'cancelled' ? 'cancelled' : notice === 'paid' ? 'completed' : 'awaiting_payment', cancel_reason: notice === 'cancelled' ? 'admin' : null,
      payment_due_at: '2026-11-18T10:09:00Z', release_at: notice === 'paid' ? null : '2026-11-06T10:09:00Z', reminder_at: '2026-11-05T10:09:00Z',
      metadata: { access_on_placement: false, locale }, transfer_details: { holder: 'Workshop Shop', account: 'PL61109010140000071219812874', title: 'Zamówienie 99' } };
    const { data: tx, error } = await db.from('payment_transactions').insert(row).select('id,release_at,payment_due_at').single();
    expect(error).toBeNull();
    await sendOrderNotice(db, tx!.id, notice);
    const mail = await waitForEmail(email);
    check(mail.HTML!, tx as { release_at: string; payment_due_at: string });
  } finally {
    const user = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find(u => u.email === email);
    if (user) await db.auth.admin.deleteUser(user.id);
    await db.from('payment_transactions').delete().eq('product_id', pid);
    await db.from('products').delete().eq('id', pid);
  }
}

const HEADINGS: Record<string, Record<'pl' | 'en', string>> = {
  placed: { pl: 'Zamówienie przyjęte, czekamy na przelew', en: 'Order received, awaiting your transfer' },
  reminder: { pl: 'Przypomnienie o płatności', en: 'Payment reminder' },
  cancelled: { pl: 'Zamówienie anulowane', en: 'Order cancelled' },
  paid: { pl: 'Płatność otrzymana', en: 'Payment received' },
};

describe('order mails have their own heading', () => {
  for (const notice of ['placed', 'reminder', 'cancelled', 'paid'] as const) for (const locale of ['pl', 'en'] as const) for (const confirmed of [false, true]) {
    it(`${notice} ${locale} ${confirmed ? 'existing account' : 'new address'} @J231`, async () => {
      await withOrder(notice, locale, confirmed, html => {
        const text = visible(html);
        expect(text).toContain(HEADINGS[notice][locale]);
        for (const phrase of SIGNUP) expect(text, phrase).not.toContain(phrase);
        expect(html).not.toContain('{{');
      });
    });
  }
});

it('shows the same transfer deadline in the mail as on the order page @J231', async () => {
  await withOrder('placed', 'pl', false, (html, tx) => {
    const deadline = transferDeadline(tx);
    expect(deadline).toBe(tx.release_at);
    expect(visible(html)).toContain(`Termin ${formatTransferDeadline(deadline, 'pl')}`);
  });
});

it('mails the license key of a paid order to a guest buyer @J01', async () => {
  const email = `w151-paid-license-${crypto.randomUUID()}@example.com`;
  const { data: product } = await db.from('products').insert({ name: 'W151 licensed', slug: `w151-lic-${crypto.randomUUID()}`, price: 10, currency: 'PLN' }).select('id').single();
  try {
    await mailOrderLicenses(db, { email, userId: null, locale: 'pl', licenses: [{ productId: product!.id, token: 'w151-paid-token.signature' }] });
    const mail = await waitForEmail(email);
    expect(mail.Subject).toBe('Twój klucz licencyjny: W151 licensed');
    expect(mail.HTML).toContain('w151-paid-token.signature');
    const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
    expect(JSON.stringify(users.users.find(u => u.email === email)?.user_metadata ?? {})).not.toContain('w151-paid-token');
  } finally {
    const user = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find(u => u.email === email);
    if (user) await db.auth.admin.deleteUser(user.id);
    await db.from('products').delete().eq('id', product!.id);
  }
});
