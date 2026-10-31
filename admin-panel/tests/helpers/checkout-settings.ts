/** Explicit shop policy setup for checkout contracts on a disposable database. */
import { expect } from '@playwright/test';
import { setAuthSession, supabaseAdmin } from './admin-auth';
import { acceptAllCookies } from './consent';
import { openSettingsTab, PAYMENTS_TAB } from './settings-tabs';
import type { Browser, Page } from '@playwright/test';
interface AdminLogin { email: string; password: string }
export async function readCheckoutTerms(): Promise<boolean | null> {
  const result = await supabaseAdmin.from('shop_config').select('checkout_collect_terms').single();
  expect(result.error).toBeNull();
  return result.data!.checkout_collect_terms;
}
export async function setCheckoutTerms(page: Page, admin: AdminLogin, enabled: boolean): Promise<void> {
  await acceptAllCookies(page);
  await setAuthSession(page, admin.email, admin.password);
  const toggle = page.getByRole('switch', { name: 'Terms of Service Consent', exact: true });
  await openSettingsTab(page, PAYMENTS_TAB, toggle, '/en/dashboard/settings');
  if ((await toggle.getAttribute('aria-checked')) === String(enabled)) {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', String(!enabled));
    await expect.poll(readCheckoutTerms).toBe(!enabled);
  }
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(enabled));
  await expect.poll(readCheckoutTerms).toBe(enabled);
  await page.context().clearCookies({ name: /^sb-/ });
}
export async function restoreCheckoutTerms(browser: Browser, admin: AdminLogin, saved: boolean | null): Promise<void> {
  const page = await browser.newPage();
  try {
    await setCheckoutTerms(page, admin, saved ?? process.env.STRIPE_COLLECT_TERMS_OF_SERVICE === 'true');
    if (saved === null) expect((await supabaseAdmin.from('shop_config').update({ checkout_collect_terms: null }).not('id', 'is', null)).error).toBeNull();
  } finally { await page.close(); }
}
