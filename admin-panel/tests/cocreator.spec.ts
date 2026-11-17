/** Co-creator share end to end: seller publishes creator terms, assigns a co-creator, the co-creator accepts. @see lib/affiliates/cocreator/service.ts */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createTestAdmin, createTestUser, loginAsAdmin, setAuthSession, supabaseAdmin } from './helpers/admin-auth';
import { setConsentPreferences } from './helpers/consent';
import { openFormSection } from './helpers/product-form';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

for (const locale of ['pl', 'en'] as const) {
  test(`${locale}: seller assigns a co-creator and the co-creator accepts the creator terms @J640 @J642`, async ({ page }) => {
    test.setTimeout(120_000);
    const t = (locale === 'pl' ? pl : en).affiliateCocreator;
    const admin = await createTestAdmin('cocreator-admin');
    const creator = await createTestUser('cocreator');
    const name = `Co-creator ${randomUUID()}`;
    const { data: product, error } = await supabaseAdmin.from('products')
      .insert({ name, description: '', slug: name.toLowerCase().replaceAll(' ', '-'), price: 100, currency: 'PLN', vat_rate: 23, is_active: true })
      .select('id').single();
    if (error || !product) throw error ?? new Error('Product missing');
    try {
      await setConsentPreferences(page, {});
      await loginAsAdmin(page, admin.email, admin.password);

      // 1. Creator terms (separate from the partner terms).
      await page.goto(`/${locale}/dashboard/affiliates`);
      const terms = page.getByTestId('creator-terms');
      await terms.locator('summary').click();
      const version = `e2e-${Date.now()}`;
      await terms.getByLabel(t.termsVersion).fill(version);
      await terms.getByLabel(t.termsEn).fill('E2E creator terms: shares are paid monthly.');
      await terms.getByLabel(t.termsPl).fill('Regulamin twórcy E2E: udziały wypłacamy co miesiąc.');
      await terms.getByRole('button', { name: t.termsSave }).click();
      await expect(terms.getByText(t.termsSaved)).toBeVisible();

      // 2. Co-creator in the product form, section "Sales and settlement".
      await page.goto(`/${locale}/dashboard/products`);
      const row = page.locator('tr, [data-product-id]').filter({ hasText: name });
      await row.locator('button[title*="Edytuj"], button[title*="Edit"]').first().click();
      await openFormSection(page, locale === 'pl' ? 'Sprzedaż i rozliczenia' : 'Sales and settlement');
      const editor = page.getByTestId('cocreator-settings');
      await expect(editor.getByText(t.none)).toBeVisible();
      await editor.getByLabel(t.email).fill(creator.email);
      await editor.getByLabel(t.displayName).fill('E2E Author');
      await editor.getByLabel(t.bps).fill('10');
      await editor.getByRole('button', { name: t.save }).click();
      await expect(editor.getByText(t.saved)).toBeVisible();
      await expect(editor.getByText('E2E Author')).toBeVisible();
      await expect(editor.getByText(t.termsPending)).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`${locale}-product-cocreator.png`), fullPage: true });
      const rule = await supabaseAdmin.from('affiliate_cocreator_rules').select('percentage_bps,member_id').eq('product_id', product.id).single();
      expect(rule.data?.percentage_bps).toBe(1000);

      // 3. The co-creator sees the share and accepts the creator terms.
      await setAuthSession(page, creator.email, creator.password);
      await page.goto(`/${locale}/my-affiliate`);
      const portal = page.getByTestId('creator-portal');
      await expect(portal.getByText(`${name}: 10%`)).toBeVisible();
      const accept = portal.getByTestId('creator-terms-accept');
      await expect(accept.getByText(locale === 'pl' ? 'Regulamin twórcy E2E: udziały wypłacamy co miesiąc.' : 'E2E creator terms: shares are paid monthly.')).toBeVisible();
      await expect(accept.getByRole('button', { name: t.acceptButton })).toBeDisabled();
      await accept.getByLabel(t.acceptLabel).check();
      await accept.getByRole('button', { name: t.acceptButton }).click();
      await expect(portal.getByText(version)).toBeVisible();
      await expect(portal.getByTestId('creator-terms-accept')).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath(`${locale}-portal-accepted.png`), fullPage: true });
      const member = await supabaseAdmin.from('affiliate_memberships').select('is_partner,creator_terms_version').eq('id', rule.data!.member_id!).single();
      expect(member.data).toEqual({ is_partner: false, creator_terms_version: version });
    } finally {
      await creator.cleanup();
      await admin.cleanup();
    }
  });
}
