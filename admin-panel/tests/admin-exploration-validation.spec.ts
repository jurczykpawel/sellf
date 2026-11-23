import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { tutorialAdmin } from './helpers/tutorials';
import { supabaseAdmin as db, createTestUser, setAuthSession } from './helpers/admin-auth';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

test.setTimeout(90_000);
for (const [locale, messages] of Object.entries({ en, pl })) {
  const prefix = locale === 'pl' ? '/pl' : '';
  test(`${locale} taxonomy errors focus fields and valid edits persist @J99`, async ({ page }) => {
    const admin = await tutorialAdmin(page, 'taxonomy-validation', false);
    try {
      for (const kind of ['categories', 'tags'] as const) {
        const name = `Validation ${randomUUID()}`;
        const { data, error } = await db.from(kind).insert({ name, slug: `valid-${randomUUID()}` }).select().single();
        expect(error).toBeNull();
        try {
          await page.goto(`${prefix}/dashboard/${kind}`);
          await page.getByRole('row').filter({ hasText: name }).getByRole('button').first().click();
          const slug = page.getByLabel(messages.admin[kind].slug, { exact: true });
          await slug.fill('bad slug <script>');
          await page.getByRole('button', { name: messages.common.save, exact: true }).click();
          await expect(slug).toHaveAttribute('aria-invalid', 'true');
          await expect(slug).toBeFocused();
          await expect(page.getByText(messages.common.taxonomyValidation.slug, { exact: true })).toBeVisible();
          expect((await db.from(kind).select('slug').eq('id', data!.id).single()).data?.slug).toBe(data!.slug);
          const fixed = `corrected-${randomUUID()}`;
          await slug.fill(fixed);
          await page.getByRole('button', { name: messages.common.save, exact: true }).click();
          await expect(slug).toHaveCount(0);
          await page.reload();
          await expect(page.getByRole('row').filter({ hasText: name })).toContainText(fixed);
        } finally { await db.from(kind).delete().eq('id', data!.id); }
      }
      for (const report of ['dashboard', 'revenue']) {
        const response = await page.request.get(`/api/v1/analytics/${report}?product_id=not-a-uuid`);
        expect(response.status()).toBe(400);
        expect((await response.json()).error.code).toBe('INVALID_INPUT');
      }
    } finally { await admin.cleanup(); }
  });

  test(`${locale} required tutorial steps keep Next until completion @J212`, async ({ page }) => {
    const admin = await tutorialAdmin(page, 'tutorial-action-label', false);
    const texts = messages.tutorials;
    const tour = page.locator('.driver-popover.sellf-tour');
    const next = tour.locator('.driver-popover-next-btn');
    try {
      await page.goto(`${prefix}/dashboard/products?open=new&tutorial=b2b-checkout-profile`);
      await expect(tour.locator('.driver-popover-title')).toHaveText(texts['b2b-checkout-profile'].steps.intro.title);
      await next.click();
      await expect(next).toHaveText(texts.next);
      await next.click();
      await expect(tour.locator('.driver-popover-description')).toHaveText(texts.mustAct);
      await page.locator('[data-tour="profile-enable"]').getByRole('checkbox').check();
      await expect(tour.locator('.driver-popover-title')).toHaveText(texts['b2b-checkout-profile'].steps.buyer.title);
      for (let index = 0; index < 3; index++) await next.click();
      await expect(next).toHaveText(texts.done);
      await next.click();
      await expect(tour).toHaveCount(0);
    } finally { await admin.cleanup(); }
  });

  test(`${locale} offer refusal opens that product's sales settings @J211`, async ({ page }) => {
    const admin = await tutorialAdmin(page, 'offer-publication-hint', false);
    const { data, error } = await db.from('products').insert({ name: `Private offer ${randomUUID()}`, slug: `private-${randomUUID()}`, price: 49, currency: 'PLN', is_active: true, is_listed: false }).select().single();
    expect(error).toBeNull();
    const productId = data!.id;
    try {
      const draft = await page.request.put(`/api/v1/products/${productId}/offer/draft`, { data: { expectedRevision: 0, config: { format: 1, enabled: true, templateId: 'offer-default', settings: { density: 'comfortable' }, content: {}, tokens: null } } });
      expect(draft.status()).toBe(200);
      await page.goto(`${prefix}/admin/templates/history?product=${productId}`);
      await page.getByRole('button', { name: messages.templatePreview.publishVersion, exact: true }).click();
      await expect(page.getByRole('alert')).toContainText(messages.storefrontEditor.offerUnavailable);
      const link = page.getByRole('link', { name: messages.storefrontEditor.productSalesSettings });
      await link.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.locator('#is_active')).toBeChecked();
      await expect(page.locator('#is_listed')).not.toBeChecked();
      expect((await db.from('product_offer_config').select('published').eq('product_id', productId).single()).data?.published).toBeNull();
    } finally { await db.from('products').delete().eq('id', productId); await admin.cleanup(); }
  });

  test(`${locale} buyer refund request points to purchase status @J56`, async ({ page }) => {
    const user = await createTestUser('refund-notice');
    const { data, error } = await db.from('products').insert({ name: 'Refund notice course', slug: `refund-notice-${randomUUID()}`, price: 49, currency: 'PLN', is_active: true, is_refundable: true, refund_period_days: 14 }).select('id').single();
    expect(error).toBeNull();
    try {
      const inserted = await db.from('payment_transactions').insert({ user_id: user.userId, customer_email: user.email, product_id: data!.id, amount: 4900, currency: 'PLN', status: 'completed', session_id: `cs_notice_${randomUUID().replaceAll('-', '')}` });
      expect(inserted.error).toBeNull();
      await setAuthSession(page, user.email, user.password);
      await page.goto(`${prefix}/my-purchases`);
      await page.getByRole('button', { name: messages.myPurchases.requestRefund, exact: true }).click();
      await expect(page.getByText(messages.myPurchases.refundWarning, { exact: true })).toBeVisible();
    } finally { await db.from('payment_transactions').delete().eq('product_id', data!.id); await db.from('products').delete().eq('id', data!.id); await user.cleanup(); }
  });
}
