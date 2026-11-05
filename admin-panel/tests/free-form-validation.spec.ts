import { useSupabaseBuyerEmails } from './helpers/buyer-email-setting-playwright';
useSupabaseBuyerEmails();
/** Free-access form: every invalid answer is explained next to its own field, never as a generic failure. */
import { test, expect } from '@playwright/test';
import { supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import { waitForEmail } from './helpers/mailpit';

const slug = `free-validation-${crypto.randomUUID()}`;
let productId: string;

test.beforeAll(async () => {
  const { data, error } = await supabaseAdmin.from('products').insert({
    name: 'Darmowy start', slug, price: 0, currency: 'PLN', is_active: true,
    custom_checkout_fields: [
      { id: '_sellf_license_domain', type: 'domain', label: 'Domena aplikacji', required: true, max_length: 253 },
      { id: 'contact', type: 'email', label: 'E-mail kontaktowy', required: false, max_length: 60 },
    ],
  }).select('id').single();
  expect(error).toBeNull();
  productId = data!.id;
});
test.afterAll(async () => { await supabaseAdmin.from('products').delete().eq('id', productId); });

test.beforeEach(async ({ page }) => { await acceptAllCookies(page); });

const GENERIC_FAILURE = /Wystąpił nieoczekiwany błąd|unexpected error/i;

test('empty form names every missing answer beside its field @J230', async ({ page }) => {
  await page.goto(`/pl/checkout/${slug}`);
  await page.getByRole('button', { name: 'Wyślij magiczny link' }).click();
  await expect(page.locator('#email-error')).toHaveText('Podaj swój adres e-mail');
  await expect(page.getByLabel(/Domena aplikacji/)).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel(/Domena aplikacji/)).toBeFocused();
  await expect(page.getByText('To pole jest wymagane.')).toBeVisible();
  await expect(page.getByText(GENERIC_FAILURE)).toHaveCount(0);
});

for (const [name, value, message] of [
  ['an invented top-level domain', 'wsparcieirozwoj.orgcasdcvsfdv3r23tgervv', /Wpisz poprawną domenę/],
  ['a path', 'mojafirma.pl/aplikacja', /Wpisz poprawną domenę/],
  ['spaces inside', 'moja firma.pl', /Wpisz poprawną domenę/],
  ['no dot', 'localhost', /Wpisz poprawną domenę/],
] as const) {
  test(`domain with ${name} is explained at the domain field @J230`, async ({ page }) => {
    await page.goto(`/pl/checkout/${slug}`);
    await page.getByLabel(/Adres e-?mail/i).fill(`free-${crypto.randomUUID()}@example.com`);
    await page.getByLabel(/Domena aplikacji/).fill(value);
    await page.getByRole('button', { name: 'Wyślij magiczny link' }).click();
    await expect(page.locator('input[aria-invalid="true"] ~ div p[role="alert"]')).toHaveText(message);
    await expect(page.getByLabel(/Domena aplikacji/)).toBeFocused();
    await expect(page.getByText(GENERIC_FAILURE)).toHaveCount(0);
  });
}

test('malformed buyer and contact e-mails are explained beside their fields @J230', async ({ page }) => {
  await page.goto(`/pl/checkout/${slug}`);
  await page.getByLabel(/Adres e-?mail/i).fill('nie-email');
  await page.getByLabel(/Domena aplikacji/).fill('mojafirma.pl');
  await page.getByLabel(/E-mail kontaktowy/).fill('tez-nie');
  await page.getByRole('button', { name: 'Wyślij magiczny link' }).click();
  await expect(page.locator('#email-error')).toHaveText('Nieprawidłowy adres e-mail');
  await expect(page.getByText(/Wpisz poprawny adres e-mail, np\./)).toBeVisible();
  await expect(page.getByText(GENERIC_FAILURE)).toHaveCount(0);
});

test('the same problems read in English on the English page @J230', async ({ page }) => {
  await page.goto(`/en/checkout/${slug}`);
  await page.getByRole('button', { name: 'Send Magic Link' }).click();
  await expect(page.getByText('This field is required.')).toBeVisible();
  await page.getByLabel(/Email Address/i).fill('buyer@example.com');
  await page.getByLabel(/Domena aplikacji/).fill('example.c0m');
  await page.getByRole('button', { name: 'Send Magic Link' }).click();
  await expect(page.getByText(/Enter a valid domain/)).toBeVisible();
});

test('a valid answer goes through and the first mail names the product @J230 @J233', async ({ page }) => {
  const email = `free-ok-${crypto.randomUUID()}@example.com`;
  await page.goto(`/pl/checkout/${slug}`);
  await page.getByLabel(/Adres e-?mail/i).fill(email);
  await page.getByLabel(/Domena aplikacji/).fill('https://www.MojaFirma.pl/panel');
  await page.getByRole('button', { name: 'Wyślij magiczny link' }).click();
  const mail = await waitForEmail(email);
  expect(mail.Subject).toContain('Darmowy start');
  expect(mail.HTML).toContain('Darmowy start');
  await expect(page.getByText(GENERIC_FAILURE)).toHaveCount(0);
  const user = (await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })).data.users.find(u => u.email === email);
  if (user) await supabaseAdmin.auth.admin.deleteUser(user.id);
});
