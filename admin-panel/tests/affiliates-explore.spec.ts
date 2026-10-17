/** Partner onboarding and seller controls in both locales and viewports. */
import { test, expect } from '@playwright/test';
import { createTestUser, setAuthSession, supabaseAdmin } from './helpers/admin-auth';
import { setConsentPreferences } from './helpers/consent';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

for (const locale of ['en', 'pl'] as const) for (const width of [1440, 390]) {
  test(`${locale} ${width} partner application and coupon assignment`, async ({ page }) => {
    test.setTimeout(120000);
    const copy = locale === 'pl' ? pl : en;
    const t = copy.affiliates.admin;
    const prefix = locale === 'pl' ? '/pl' : '';
    const suffix = `${locale}-${width}`;
    const user = await createTestUser('partner-application');
    const code = `partner-${Date.now()}-${width}`;
    const couponCode = `PARTNER${Date.now()}${width}`;
    const coupon = await supabaseAdmin.from('coupons').insert({ code: couponCode, discount_type: 'percentage', discount_value: 10, is_active: true }).select('id').single();
    expect(coupon.error).toBeNull();
    try {
      const address = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
      await page.setExtraHTTPHeaders({ 'x-forwarded-for': `2001:db8:${address.match(/.{4}/g)!.join(':')}::` });
      await setConsentPreferences(page, {});
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${prefix}/affiliates/apply`);
      await expect(page).toHaveURL(/login\?redirect_to=/);
      expect(new URL(page.url()).searchParams.get('redirect_to')).toBe(`${prefix}/affiliates/apply`);
      await expect(page.getByRole('heading', { name: t.joinTitle })).toBeVisible();
      await page.screenshot({ path: `/tmp/fixaff-login-${suffix}.png`, fullPage: true });
      await page.getByLabel(copy.auth.email, { exact: true }).fill(user.email);
      await page.getByLabel(copy.auth.password, { exact: true }).fill(user.password);
      await page.getByRole('button', { name: copy.auth.signIn, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${prefix}/affiliates/apply$`));
      await page.getByLabel(t.name, { exact: true }).fill('Anna Partner');
      await page.getByLabel(t.code, { exact: true }).fill('Anna Test!');
      await page.getByLabel(t.channel, { exact: true }).fill('Newsletter and tutorials');
      await page.getByLabel(t.accept, { exact: true }).check();
      const submit = page.getByRole('button', { name: t.apply, exact: true });
      await expect(submit).toBeEnabled({ timeout: 20000 });
      await submit.click();
      await expect(page.getByLabel(t.code, { exact: true })).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByLabel(t.name, { exact: true })).toHaveValue('Anna Partner');
      await expect(page.getByLabel(t.channel, { exact: true })).toHaveValue('Newsletter and tutorials');
      await expect(page.getByLabel(t.accept, { exact: true })).toBeChecked();
      await expect(submit).toBeEnabled();
      await submit.hover();
      expect(await submit.evaluate(element => {
        const probe = document.createElement('span'); probe.style.backgroundColor = 'var(--sf-accent-hover)'; element.append(probe);
        const matches = getComputedStyle(element).backgroundColor === getComputedStyle(probe).backgroundColor; probe.remove(); return matches;
      })).toBe(true);
      await page.screenshot({ path: `/tmp/fixaff-validation-${suffix}.png`, fullPage: true });
      await page.getByLabel(t.code, { exact: true }).fill(code);
      await submit.click();
      await expect(page.getByRole('status')).toHaveText(t.pending);
      await page.reload();
      await expect(page.getByRole('heading', { name: t.applicationReceived })).toBeVisible();
      await expect(page.getByRole('status')).toHaveText(t.pending);
      await expect(page.getByRole('button', { name: t.apply, exact: true })).toHaveCount(0);
      await page.screenshot({ path: `/tmp/fixaff-submitted-${suffix}.png`, fullPage: true });
      await setAuthSession(page, 'demo@sellf.app', 'demo123');
      await page.goto(`${prefix}/dashboard/affiliates`);
      await expect(page.getByRole('article', { name: 'Anna Partner' }).getByText(user.email, { exact: true })).toBeVisible();
      await page.screenshot({ path: `/tmp/fixaff-application-card-${suffix}.png`, fullPage: true });
      await page.goto(`${prefix}/dashboard/affiliates/earnings`);
      await expect(page.getByRole('heading', { name: copy.affiliates.earningsTitle })).toBeVisible();
      await expect(page.getByText(copy.affiliates.earningsSelect)).toBeVisible();
      await page.screenshot({ path: `/tmp/fixaff-earnings-${suffix}.png`, fullPage: true });
      await page.getByRole('combobox').fill('Demo');
      await page.getByRole('option', { name: 'Demo Partner', exact: true }).click();
      await expect(page.getByRole('heading', { name: copy.affiliates.portal.selectedPartner })).toBeVisible();
      await page.screenshot({ path: `/tmp/fixaff-selected-earnings-${suffix}.png`, fullPage: true });
      await page.goto(`${prefix}/dashboard/coupons`);
      await page.getByRole('row').filter({ hasText: couponCode }).getByRole('button', { name: copy.admin.coupons.edit, exact: true }).click();
      const owner = page.getByRole('heading', { name: copy.affiliates.products.owner, exact: true });
      await expect(owner).toBeInViewport();
      const picker = page.getByRole('combobox', { name: copy.affiliates.products.partner, exact: true });
      await expect(picker).toBeEnabled();
      await picker.fill('Demo');
      await page.getByRole('option', { name: 'Demo Partner (demo-partner)', exact: true }).click();
      await expect(picker).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByRole('listbox')).toHaveCount(0);
      await page.getByRole('button', { name: copy.affiliates.products.assign, exact: true }).click();
      await expect(page.getByText(copy.affiliates.products.couponAssigned, { exact: true })).toBeVisible();
      await page.screenshot({ path: `/tmp/fixaff-coupon-${suffix}.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await supabaseAdmin.from('coupons').update({ is_active: false }).eq('id', coupon.data!.id);
      await user.cleanup();
    }
  });
}
