/** Application correction and approved state. @see components/affiliates/admin/AffiliateAdmin.tsx */
import { execFileSync } from 'node:child_process';
import { getTestDatabaseContainer } from './helpers/database-container';
import { test, expect } from '@playwright/test';
import { createTestUser, setAuthSession, supabaseAdmin } from './helpers/admin-auth';
import { setConsentPreferences } from './helpers/consent';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

for (const locale of ['en', 'pl'] as const) test(`${locale} corrects a taken code and opens the approved partner panel`, async ({ page }) => {
  const t = (locale === 'pl' ? pl : en).affiliates.admin;
  const user = await createTestUser('apply-correction');
  const taken = await supabaseAdmin.from('affiliate_memberships').select('code').limit(1).single();
  expect(taken.error).toBeNull();
  try {
    await setConsentPreferences(page, {});
    await setAuthSession(page, user.email, user.password);
    await page.goto(`/${locale}/affiliates/apply`);
    await page.getByLabel(t.name, { exact: true }).fill('Anna Partner');
    const code = page.getByLabel(t.code, { exact: true });
    await code.fill(taken.data!.code);
    const channel = page.getByLabel(t.channel, { exact: true });
    await channel.fill('x'.repeat(501));
    await expect(channel).toHaveValue('x'.repeat(500));
    await expect(page.getByText('500 / 500', { exact: true })).toBeVisible();
    await page.getByLabel(t.accept, { exact: true }).check();
    const submit = page.getByRole('button', { name: t.apply, exact: true });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByText(t.codeTaken, { exact: true })).toBeVisible();
    await expect(code).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel(t.name, { exact: true })).toHaveValue('Anna Partner');
    await expect(channel).toHaveValue('x'.repeat(500));
    await expect(page.getByLabel(t.accept, { exact: true })).toBeChecked();
    const available = `w40-${user.userId.slice(0, 12)}`;
    await code.fill(available);
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByRole('heading', { name: t.applicationReceived, exact: true })).toBeVisible();
    const saved = await supabaseAdmin.from('affiliate_memberships').select('code,status,channel').eq('user_id', user.userId).single();
    expect(saved.error).toBeNull();
    expect(saved.data).toEqual({ code: available, status: 'pending', channel: 'x'.repeat(500) });
    execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', `user_id=${user.userId}`], { input: "UPDATE public.affiliate_memberships SET status='approved' WHERE user_id=:'user_id'::uuid;", stdio: ['pipe', 'pipe', 'pipe'] });
    await page.reload();
    await expect(page.getByRole('heading', { name: t.alreadyPartner, exact: true })).toBeVisible();
    await expect(page.getByText(t.applicationNext, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: t.partnerPanel, exact: true })).toHaveAttribute('href', `${locale === 'pl' ? '/pl' : ''}/my-affiliate`);
  } finally {
    await user.cleanup();
  }
});
