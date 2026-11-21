import { randomUUID } from 'node:crypto';
import { backfillBuyerDetails } from '@/lib/payment/buyer-details';
import embeddedCompany from './fixtures/stripe/embedded-company-customer.json';
import { test, expect } from '@playwright/test';
import { createTestAdmin, loginAsAdmin, supabaseAdmin } from './helpers/admin-auth';

test('admin configures and checks provider, issues invoice and reads it in order and payment list @J55', async ({ page }) => {
  test.setTimeout(120000);
  const admin = await createTestAdmin('invoicing');
  const transactionId = 'e1000000-0000-4000-8000-000000000010';
  const history = Array.from({ length: 101 }, () => ({
    id: randomUUID(), product_id: 'e1000000-0000-4000-8000-000000000001',
    session_id: `cs_invoice_history_${randomUUID().replaceAll('-', '')}`, customer_email: 'recent-invoice@example.com',
    amount: 100, currency: 'PLN', status: 'completed',
  }));
  const { data: originalInvoice } = await supabaseAdmin.from('invoices').select('*').eq('transaction_id', transactionId).single();
  const { data: originalConfig } = await supabaseAdmin.from('invoicing_config').select('*').single();
  try {
    expect((await supabaseAdmin.from('payment_transactions').insert(history)).error).toBeNull();
    await loginAsAdmin(page, admin.email, admin.password);
    await page.goto('/pl/dashboard/settings');
    const settings = page.getByRole('region', { name: 'Faktury', exact: true });
    await expect(settings.getByRole('button', { name: 'Zapisz', exact: true })).toBeEnabled();
    await settings.getByLabel('Dostawca', { exact: true }).selectOption('fakturownia');
    await expect(settings.getByText('Automatyczne wystawianie obejmuje zamówienia złożone od chwili włączenia.')).toBeVisible();
    await settings.getByLabel('Domena konta Fakturowni').fill('fixture.fakturownia.pl');
    await settings.getByLabel('Token API', { exact: true }).fill('fixture-token');
    await settings.getByLabel('Podstawa zwolnienia z VAT').fill('art. 113 ust. 1 ustawy o VAT');
    await settings.getByRole('button', { name: 'Sprawdź połączenie' }).click();
    await expect(settings.getByRole('status')).toHaveText('Połączenie potwierdzone');
    const { data: config } = await supabaseAdmin.from('invoicing_config').select('*').single();
    expect(JSON.stringify(config)).not.toContain('fixture-token');
    expect(config?.token).toBeTruthy();
    await page.reload();
    await expect(settings.getByRole('button', { name: 'Zapisz', exact: true })).toBeEnabled();
    await expect(settings.getByLabel('Token API', { exact: true })).toHaveValue('');
    await supabaseAdmin.from('invoices').delete().eq('transaction_id', transactionId);
    await page.goto('/pl/dashboard/payments');
    await page.locator('#payment-search-filter').fill('office@example.com');
    const row = page.getByRole('row').filter({ hasText: 'office@example.com' });
    await row.getByRole('button', { name: /szczegóły/i }).click();
    await page.getByRole('button', { name: 'Wystaw fakturę', exact: true }).click();
    await expect(row.getByRole('link', { name: 'FV/TEST/1' })).toHaveAttribute('href', 'https://fixture.fakturownia.pl/invoice/invoice-fixture-token');
    await row.getByRole('button', { name: /szczegóły/i }).click();
    const invoice = page.getByRole('region', { name: 'Faktury', exact: true });
    await expect(invoice.getByText('Wystawiona', { exact: true })).toBeVisible();
    await expect(invoice.getByRole('link', { name: 'FV/TEST/1' })).toBeVisible();
    await expect(invoice.getByRole('button')).toHaveCount(0);
    const { count } = await supabaseAdmin.from('invoices').select('*', { count: 'exact', head: true }).eq('transaction_id', transactionId);
    expect(count).toBe(1);
    await page.screenshot({ path: test.info().outputPath('invoice.png'), fullPage: true });
    await page.close();
  } finally {
    await supabaseAdmin.from('invoices').delete().eq('transaction_id', transactionId);
    if (originalInvoice) await supabaseAdmin.from('invoices').insert(originalInvoice);
    if (originalConfig) await supabaseAdmin.from('invoicing_config').upsert(originalConfig);
    expect((await supabaseAdmin.from('payment_transactions').delete().in('id', history.map(row => row.id))).error).toBeNull();
    await admin.cleanup();
  }
});

for (const locale of ['en', 'pl']) {
  test(`invoice validation names and focuses the invalid field in ${locale} @J55`, async ({ page }) => {
    const admin = await createTestAdmin('invoice-validation');
    const original = await supabaseAdmin.from('invoicing_config').select('*').single();
    expect(original.error).toBeNull();
    try {
      expect((await supabaseAdmin.from('invoicing_config').update({ provider: 'none', domain: '', token: null }).eq('id', true)).error).toBeNull();
      await loginAsAdmin(page, admin.email, admin.password);
      await page.goto(locale === 'pl' ? '/pl/dashboard/settings' : '/en/dashboard/settings');
      const settings = page.getByRole('region', { name: locale === 'pl' ? 'Faktury' : 'Invoicing', exact: true });
      const save = settings.getByRole('button', { name: locale === 'pl' ? 'Zapisz' : 'Save', exact: true });
      await expect(save).toBeEnabled();
      await settings.getByRole('combobox', { name: locale === 'pl' ? 'Dostawca' : 'Provider', exact: true }).selectOption('fakturownia');
      const domain = settings.locator('[name=domain]'), token = settings.locator('[name=token]'), template = settings.locator('[name=template]');
      await save.click();
      await expect(domain).toBeFocused();
      await expect(domain).toHaveAttribute('aria-invalid', 'true');
      await expect(settings.getByRole('alert')).toContainText(locale === 'pl' ? 'Podaj domenę' : 'Enter your Fakturownia');
      await domain.fill('example.fakturownia.pl');
      await save.click();
      await expect(token).toBeFocused();
      await expect(settings.getByRole('alert')).toContainText(locale === 'pl' ? 'Podaj token API' : 'Enter an API token');
      await template.fill('Invalid template');
      await save.click();
      await expect(template).toBeFocused();
      await expect(settings.getByRole('alert')).toContainText(locale === 'pl' ? 'znacznik produktu' : 'product placeholder');
      const unchanged = await supabaseAdmin.from('invoicing_config').select('provider,domain,token').single();
      expect(unchanged.data).toEqual({ provider: 'none', domain: '', token: null });
      await page.close();
    } finally {
      if (original.data) expect((await supabaseAdmin.from('invoicing_config').upsert(original.data)).error).toBeNull();
      await admin.cleanup();
    }
  });
}

test('shows company data backfilled from embedded Stripe Checkout in payment details @J55', async ({ page }) => {
  const admin = await createTestAdmin('embed-company');
  const sessionId = `cs_company_${randomUUID().replaceAll('-', '')}`;
  const email = `company-${randomUUID()}@example.com`;
  const product = await supabaseAdmin.from('products').insert({ name: 'Embedded company order', slug: `company-${randomUUID()}`, price: 50, currency: 'PLN' }).select('id').single();
  expect(product.error).toBeNull();
  try {
    const tx = await supabaseAdmin.from('payment_transactions').insert({ product_id: product.data!.id, session_id: sessionId, customer_email: email, amount: 5000, currency: 'PLN', status: 'completed', payment_provider: 'stripe' }).select('id').single();
    expect(tx.error).toBeNull();
    await backfillBuyerDetails(supabaseAdmin, { sessionId, metadata: {}, customerDetails: { ...embeddedCompany, email } as never });
    const saved = await supabaseAdmin.from('payment_transactions').select('order_details').eq('id', tx.data!.id).single();
    expect(saved.data?.order_details).toMatchObject({ buyer: { company_name: 'Embedded Company', nip: '5260250274', needs_invoice: true } });
    await loginAsAdmin(page, admin.email, admin.password);
    await page.goto('/pl/dashboard/payments');
    const row = page.getByRole('row').filter({ hasText: email });
    await row.getByRole('button', { name: /szczegóły/i }).click();
    const details = page.getByRole('region', { name: 'Dane z koszyka' });
    for (const value of ['Embedded Company', '5260250274', 'Krótka 2', 'Kraków']) await expect(details).toContainText(value);
    // Previously stored embed data has the same fields but no type.
    const buyer = (saved.data!.order_details as { buyer: Record<string, unknown> }).buyer;
    delete buyer.type;
    buyer.needs_invoice = false;
    expect((await supabaseAdmin.from('payment_transactions').update({ order_details: { buyer } }).eq('id', tx.data!.id)).error).toBeNull();
    await page.reload();
    await expect(details).toBeVisible();
    for (const value of ['Embedded Company', '5260250274', 'Krótka 2']) await expect(details).toContainText(value);
    await page.close();
  } finally {
    await supabaseAdmin.from('payment_transactions').delete().eq('session_id', sessionId);
    await supabaseAdmin.from('products').delete().eq('id', product.data!.id);
    await admin.cleanup();
  }
});
