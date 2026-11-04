/** Render actual Supabase auth emails through the local Mailpit stack. */
import { createClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { purchaseEventMail } from '@/lib/events/mail';
import { deliverMagicLink } from '@/lib/auth/magic-link/deliver';
import recordedPurchase from '../../fixtures/stripe/initial-subscription-purchase.json';
import { waitForEmail } from '../../helpers/mailpit';

/** Text of every table row as the buyer reads it: cells joined by one space. */
function visibleRows(html: string): string[] {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(row => [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)]
    .map(cell => cell[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ')).filter(Boolean);
}

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
        transfer: { holder: 'Workshop Shop', account: 'PL61 1090 1014 0000 0712 1981 2874', bank: 'Test bank', title: 'Order 97', amount: '67 PLN', due: locale === 'pl' ? '10 grudnia 2026' : '10 December 2026' } };
      const result = await deliverMagicLink({ email, shouldCreateUser: true,
        redirectTo: `${process.env.SITE_URL}/auth/callback?flow=login`, data });
      expect(result).toEqual({ ok: true });
      const mail = await waitForEmail(email);
      expect(mail.Subject).toBe(locale === 'en' ? (confirmed ? 'Your sign-in link: Mail workshop' : 'Confirm your email: Mail workshop') : (confirmed ? 'Twój link do logowania: Mail workshop' : 'Potwierdź swój email: Mail workshop'));
      const html = mail.HTML!;
      for (const value of [data.event_date, data.event_online_url, data.purchase_product, data.purchase_amount]) expect(html).toContain(value);
      expect(visibleRows(html)).toEqual(expect.arrayContaining(locale === 'pl'
        ? ['Odbiorca Workshop Shop', 'Numer konta PL61 1090 1014 0000 0712 1981 2874', 'Bank Test bank', 'Tytuł Order 97', 'Kwota 67 PLN', 'Termin 10 grudnia 2026']
        : ['Recipient Workshop Shop', 'Account number PL61 1090 1014 0000 0712 1981 2874', 'Bank Test bank', 'Reference Order 97', 'Amount 67 PLN', 'Due date 10 December 2026']));
      expect(html).not.toContain('transfer_text');
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

it('delivers labeled transfer instructions with a Polish due date and purchase amount @J231', async () => {
  const { sendOrderNotice } = await import('@/lib/orders/transfer-mail');
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
    await sendOrderNotice(db, tx!.id, 'placed');
    const mail = await waitForEmail(email);
    expect(mail.Subject).toBe('Dane do przelewu za zamówienie');
    expect(mail.HTML).toContain('Transfer workshop');
    const rows = visibleRows(mail.HTML!);
    expect(rows).toEqual(expect.arrayContaining(['Odbiorca Workshop Shop', 'Numer konta PL61 1090 1014 0000 0712 1981 2874', 'Bank Test bank', 'Tytuł Zamówienie 97', 'Termin 10 grudnia 2026 01:00']));
    expect(rows.some(row => /^Kwota 123/.test(row))).toBe(true);
    expect(mail.HTML).not.toContain('PL61109010140000071219812874');
    expect(mail.HTML).not.toContain('2026-12-10');
  } finally {
    const user = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find(u => u.email === email);
    if (user) await db.auth.admin.deleteUser(user.id);
    await db.from('payment_transactions').delete().eq('product_id', pid);
    await db.from('products').delete().eq('id', pid);
  }
});

it.each([['reminder', 'Przypomnienie o płatności', 'zapłać online na stronie zamówienia'], ['cancelled', 'Zamówienie anulowane', 'nie otrzymaliśmy wpłaty w terminie']] as const)(
  'delivers the %s notice with the signed order link to a new address', async (notice, heading, text) => {
  const { sendOrderNotice } = await import('@/lib/orders/transfer-mail');
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const email = `notice-${notice}-${crypto.randomUUID()}@example.com`;
  const { data: product } = await db.from('products').insert({ name: 'Reminder workshop', slug: `notice-${crypto.randomUUID()}`, price: 123, currency: 'PLN' }).select('id').single();
  const pid = product!.id;
  try {
    const { data: tx, error } = await db.from('payment_transactions').insert({ product_id: pid, customer_email: email, amount: 12300, currency: 'PLN',
      status: notice === 'reminder' ? 'awaiting_payment' : 'cancelled', cancel_reason: notice === 'cancelled' ? 'payment_window_expired' : null,
      payment_provider: 'bank_transfer', pricing_snapshot_version: 1, payment_due_at: '2026-12-10T11:00:00Z', release_at: '2026-12-10T11:00:00Z', reminder_at: '2026-12-09T11:00:00Z',
      metadata: { access_on_placement: false, locale: 'pl' }, transfer_details: { holder: 'Workshop Shop', account: 'PL61109010140000071219812874', title: 'Zamówienie 98' },
    }).select('id').single();
    expect(error).toBeNull();
    await sendOrderNotice(db, tx!.id, notice);
    const mail = await waitForEmail(email);
    expect(mail.HTML).toContain(heading); expect(mail.HTML).toContain(text);
    const link = mail.HTML.match(/href="([^"]*\/order\/[^"]*)"/)?.[1]?.replaceAll('&amp;', '&');
    expect(link).toContain(`/pl/order/${tx!.id}/transfer?token=`);
    const { data: saved } = await db.from('payment_transactions').select('reminder_mail_sent_at,cancelled_mail_sent_at').eq('id', tx!.id).single();
    expect(notice === 'reminder' ? saved?.reminder_mail_sent_at : saved?.cancelled_mail_sent_at).toBeTruthy();
  } finally {
    const user = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find(u => u.email === email);
    if (user) await db.auth.admin.deleteUser(user.id);
    await db.from('payment_transactions').delete().eq('product_id', pid);
    await db.from('products').delete().eq('id', pid);
  }
});

it('renders the first purchase email while transaction and guest access arrive after the request', async () => {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const email = `first-purchase-${crypto.randomUUID()}@example.com`;
  const sessionId = `cs_test_${crypto.randomUUID().replaceAll('-', '')}`;
  const product = await db.from('products').insert({ name: 'First purchase workshop', slug: `first-${crypto.randomUUID()}`, price: recordedPurchase.invoice.amount_paid / 100, currency: recordedPurchase.invoice.currency.toUpperCase() }).select('id').single();
  expect(product.error).toBeNull();
  const pid = product.data!.id;
  const dataPromise = purchaseEventMail(email, pid, sessionId, undefined, 'pl');
  const persistence = (async () => {
    await new Promise(resolve => setTimeout(resolve, 200));
    const tx = await db.from('payment_transactions').insert({ product_id: pid, session_id: sessionId, customer_email: email, amount: recordedPurchase.invoice.amount_paid, currency: recordedPurchase.invoice.currency.toUpperCase(), status: 'completed' }).select('id').single();
    expect(tx.error).toBeNull();
    await new Promise(resolve => setTimeout(resolve, 200));
    expect((await db.from('guest_purchases').insert({ product_id: pid, customer_email: email, transaction_id: tx.data!.id, transaction_amount: recordedPurchase.invoice.amount_paid })).error).toBeNull();
  })();
  try {
    const data = await dataPromise;
    expect(await deliverMagicLink({ email, shouldCreateUser: true, redirectTo: `${process.env.SITE_URL}/auth/callback?flow=login`, data: { ...data, locale: 'pl' } })).toEqual({ ok: true });
    const mail = await waitForEmail(email);
    expect(mail.Subject).toBe('Potwierdź swój email: First purchase workshop');
    expect(mail.HTML).toContain('First purchase workshop');
    expect(mail.HTML).toContain('11,00\u00a0zł');
    expect(recordedPurchase.checkout.livemode).toBe(false);
    expect(recordedPurchase.checkout).not.toHaveProperty('payment_intent');
  } finally {
    await persistence;
    const user = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find(u => u.email === email);
    if (user) await db.auth.admin.deleteUser(user.id);
    await db.from('guest_purchases').delete().eq('product_id', pid);
    await db.from('payment_transactions').delete().eq('product_id', pid);
    await db.from('products').delete().eq('id', pid);
  }
});

it('tells the buyer the payment was received once the transfer is booked, exactly once @J232', async () => {
  const { sendOrderNotice } = await import('@/lib/orders/transfer-mail');
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const email = `transfer-paid-${crypto.randomUUID()}@example.com`;
  const { data: product, error } = await db.from('products').insert({ name: 'Paid workshop', slug: `paid-${crypto.randomUUID()}`, price: 123, currency: 'PLN' }).select('id').single();
  expect(error).toBeNull();
  const pid = product!.id;
  try {
    const { data: tx, error: txError } = await db.from('payment_transactions').insert({ product_id: pid, customer_email: email, amount: 12300, currency: 'PLN',
      status: 'completed', payment_provider: 'bank_transfer', pricing_snapshot_version: 1, payment_due_at: '2026-12-10T00:00:00Z', metadata: { locale: 'pl' },
      transfer_details: { holder: 'Workshop Shop', account: 'PL61109010140000071219812874', title: 'Zamówienie 97' } }).select('id').single();
    expect(txError).toBeNull();
    await sendOrderNotice(db, tx!.id, 'paid');
    const mail = await waitForEmail(email);
    expect(mail.Subject).toBe('Płatność otrzymana: Paid workshop');
    expect(mail.HTML).toContain('Płatność otrzymana');
    expect(mail.HTML).toContain('Paid workshop');
    expect(mail.HTML).toMatch(/123,00\s?zł/);
    expect(visibleRows(mail.HTML!).some(row => row.startsWith('Numer konta'))).toBe(false);
    expect((await db.from('payment_transactions').select('transfer_paid_mail_sent_at').eq('id', tx!.id).single()).data?.transfer_paid_mail_sent_at).not.toBeNull();
    const before = (await fetch(`${process.env.MAILPIT_URL}/api/v1/search?query=to:${encodeURIComponent(email)}`).then(r => r.json())).messages.length;
    await sendOrderNotice(db, tx!.id, 'paid');
    const after = (await fetch(`${process.env.MAILPIT_URL}/api/v1/search?query=to:${encodeURIComponent(email)}`).then(r => r.json())).messages.length;
    expect(after).toBe(before);
  } finally {
    const user = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find(u => u.email === email);
    if (user) await db.auth.admin.deleteUser(user.id);
    await db.from('payment_transactions').delete().eq('product_id', pid);
    await db.from('products').delete().eq('id', pid);
  }
});

it('escapes markup stored in transfer details in the real mail (W146 B3)', async () => {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const email = `transfer-xss-${crypto.randomUUID()}@example.com`;
  try {
    const result = await deliverMagicLink({ email, shouldCreateUser: true, redirectTo: `${process.env.SITE_URL}/auth/callback?flow=login`,
      data: { locale: 'pl', mail_kind: 'transfer_placed', purchase_product: 'P', purchase_amount: '1 PLN', transfer: { holder: '<script>x</script>', bank: '<b>B</b>', title: 'T', account: 'PL61 1090', amount: '1 PLN', due: 'd' } } });
    expect(result).toEqual({ ok: true });
    const html = (await waitForEmail(email)).HTML!;
    expect(html).not.toContain('<script>x</script>');
    expect(html).not.toContain('<b>B</b>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
  } finally {
    const user = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find(u => u.email === email);
    if (user) await db.auth.admin.deleteUser(user.id);
  }
});
