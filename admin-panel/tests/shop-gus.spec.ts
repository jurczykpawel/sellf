/** Shop company lookup in both checkout forms. @see src/hooks/useInvoiceData.ts */
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect } from '@playwright/test';
import { test, startNativeCheckout } from './helpers/checkout-intent';
import { acceptAllCookies } from './helpers/consent';
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const ids: string[] = [];
test.afterAll(async () => { if (ids.length) await db.from('products').delete().in('id', ids); });
for (const mode of ['ordinary', 'profile', 'legacy-profile']) {
  for (const configured of [true, false]) {
    test(`@J510 ${mode} company lookup ${configured ? 'fills company data' : 'allows manual entry without a configured key'}`, async ({ page }) => {
      const profile = mode === 'ordinary' ? null : { v: 1, modules: [{ id: 'buyer', types: ['organization'], ...(mode === 'legacy-profile' ? { gus: false } : {}) }] };
      const { data, error } = await db.from('products').insert({ name: 'Company lookup', slug: `company-${randomUUID()}`, price: 50, currency: 'PLN', is_active: true, vat_rate: 0, checkout_profile: profile }).select('id,slug').single();
      expect(error).toBeNull(); ids.push(data!.id);
      // Use the documented endpoint response without calling the external registry.
      await page.route('**/api/gus/fetch-company-data', async route => {
        expect(route.request().postDataJSON()).toEqual({ nip: '5260250274' });
        await route.fulfill({ status: configured ? 200 : 503, json: configured ? { success: true, data: { nazwa: 'PRZYKŁADOWA SPÓŁKA Z O.O.', ulica: 'ul. Testowa', nrNieruchomosci: '1', nrLokalu: '2', miejscowosc: 'Warszawa', kodPocztowy: '00-001', regon: '123456789', nip: '5260250274' } } : { success: false, code: 'NOT_CONFIGURED' } });
      });
      await acceptAllCookies(page);
      await page.goto(`/pl/checkout/${data!.slug}`);
      if (mode === 'ordinary') {
        await startNativeCheckout(page);
        await page.locator('#checkoutEmail').fill('company@example.com');
      }
      const nip = page.locator(mode === 'ordinary' ? '#nip' : '[id="buyer.nip"]');
      const company = page.locator(mode === 'ordinary' ? '#companyName' : '[id="buyer.company_name"]');
      await expect(nip).toBeEnabled();
      const response = page.waitForResponse('**/api/gus/fetch-company-data');
      await nip.fill('5260250274'); await nip.blur(); await response;
      if (configured) {
        await expect(company).toHaveValue('PRZYKŁADOWA SPÓŁKA Z O.O.');
        await expect(page.locator(mode === 'ordinary' ? '#city' : '[id="buyer.city"]')).toHaveValue('Warszawa');
      } else {
        await expect(company).toHaveValue(''); await company.fill('Ręcznie wpisana firma');
        await expect(company).toHaveValue('Ręcznie wpisana firma');
        await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
      }
      await expect(nip).toHaveValue('5260250274');
    });
  }
}
