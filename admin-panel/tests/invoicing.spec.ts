import { test, expect } from '@playwright/test';
import { createTestAdmin, loginAsAdmin, supabaseAdmin } from './helpers/admin-auth';

test('admin configures and checks provider, issues invoice and reads it in order and payment list @J55', async ({ page }) => {
  test.setTimeout(120000);
  const admin = await createTestAdmin('invoicing');
  const transactionId = 'e1000000-0000-4000-8000-000000000010';
  const { data: originalInvoice } = await supabaseAdmin.from('invoices').select('*').eq('transaction_id', transactionId).single();
  const { data: originalConfig } = await supabaseAdmin.from('invoicing_config').select('*').single();
  try {
    await loginAsAdmin(page, admin.email, admin.password);
    await page.goto('/pl/dashboard/settings');
    const settings = page.getByRole('region', { name: 'Faktury', exact: true });
    await expect(settings.getByRole('button', { name: 'Zapisz', exact: true })).toBeEnabled();
    await expect(settings.getByText('Automatyczne wystawianie obejmuje zamówienia złożone od chwili włączenia.')).toBeVisible();
    await settings.getByLabel('Dostawca', { exact: true }).selectOption('fakturownia');
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
  } finally {
    await supabaseAdmin.from('invoices').delete().eq('transaction_id', transactionId);
    if (originalInvoice) await supabaseAdmin.from('invoices').insert(originalInvoice);
    if (originalConfig) await supabaseAdmin.from('invoicing_config').upsert(originalConfig);
    await admin.cleanup();
  }
});
