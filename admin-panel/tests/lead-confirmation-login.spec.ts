/**
 * A lead's confirmation link that was already used reopens the login page in the lead's language
 * (REG-2026-11-27-rc5-A B1). The whole chain is real: challenge, submit, the delivered mail, the
 * first click (confirms) and a second click in a fresh browser (the link is spent).
 *
 * @see src/lib/leads/server.ts
 * @see src/app/[locale]/auth/callback/route.ts
 */
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { solveChallenge } from 'altcha-lib/v1';
import { acceptAllCookies } from './helpers/consent';
import { supabaseAdmin } from './helpers/admin-auth';
import { extractMagicLink, waitForEmail } from './helpers/mailpit';

test.describe.configure({ mode: 'serial' });

const productIds: string[] = [];
const emails: string[] = [];

test.afterAll(async () => {
  if (productIds.length) {
    await supabaseAdmin.from('lead_submissions').delete().in('product_id', productIds);
    await supabaseAdmin.from('user_product_access').delete().in('product_id', productIds);
    await supabaseAdmin.from('products').delete().in('id', productIds);
  }
  const { data } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data.users.filter(u => u.email && emails.includes(u.email))) await supabaseAdmin.auth.admin.deleteUser(user.id);
});

const CASES = [
  { locale: 'pl', loginPath: /\/pl\/login\?/, title: 'Link wygasł lub został już użyty', other: 'Link expired or already used' },
  { locale: 'en', loginPath: /localhost:\d+\/login\?/, title: 'Link expired or already used', other: 'Link wygasł lub został już użyty' },
] as const;

for (const { locale, loginPath, title, other } of CASES) {
  test(`a used lead confirmation link opens the ${locale} login page in the lead language`, async ({ page, request, browser, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const id = randomUUID(); productIds.push(id);
    const { error: productError } = await supabaseAdmin.from('products').insert({
      id, slug: `lead-login-${id}`, name: 'Lead login guide', price: 0, currency: 'USD', is_active: true, embed_enabled: true,
    });
    expect(productError).toBeNull();
    const email = `lead-login-${locale}-${randomUUID()}@example.com`; emails.push(email);

    const challengeResponse = await request.get(`/api/leads/challenge?product=${id}`, { headers: { origin } });
    expect(challengeResponse.status()).toBe(200);
    const c = await challengeResponse.json();
    const solved = await solveChallenge(c.altcha.challenge, c.altcha.salt, c.altcha.algorithm, c.altcha.maxnumber).promise;
    const altcha = Buffer.from(JSON.stringify({ ...c.altcha, number: solved!.number })).toString('base64');
    const submit = await request.post(`/api/leads/submit?locale=${locale}`, {
      headers: { origin, 'content-type': 'application/json' },
      data: { product: id, email, src: 'https://files.example.com/video.mp4', nonce: c.nonce, altcha },
    });
    expect(submit.status()).toBe(200);

    const mail = await waitForEmail(email, { timeout: 20_000 });
    const link = extractMagicLink(mail.HTML || mail.Text || '');
    expect(link).toBeTruthy();

    await acceptAllCookies(page);
    await page.goto(link!);
    // next-intl serves English without a prefix (/en/p/… → /p/…).
    await page.waitForURL(new RegExp(`:\\d+${locale === 'pl' ? '/pl' : ''}/p/lead-login-${id}$`));

    const fresh = await browser.newContext({ locale: locale === 'pl' ? 'en-US' : 'pl-PL' });
    try {
      const second = await fresh.newPage();
      await acceptAllCookies(second);
      await second.goto(link!);
      await expect(second).toHaveURL(loginPath);
      expect(new URL(second.url()).searchParams.get('error')).toBe('magic_link_expired');
      await expect(second.getByRole('alert').filter({ hasText: title })).toBeVisible();
      await expect(second.getByText(other)).toHaveCount(0);
    } finally {
      await fresh.close();
    }
  });
}
