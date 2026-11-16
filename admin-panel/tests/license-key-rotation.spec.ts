/** Seller changes the license signing key in the panel; a license signed before the change still verifies through the JWKS URL. */
import { createPublicKey, randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { createTestAdmin, setAuthSession, supabaseAdmin as db } from './helpers/admin-auth';
import { issueLicense } from '@/lib/license-keys/issue';
import { verifySellfLicense } from '@/lib/license-keys/sdk';

test.describe.configure({ mode: 'serial' });

const product = randomUUID();
const kids: string[] = [];
let cleanup: (() => Promise<void>) | undefined;

/** The value printed under a label of the signing-key card (Key ID, JWKS URL). */
const field = (page: Page, label: string) => page.getByText(label, { exact: true }).locator('xpath=following-sibling::div//code');

async function shownKey(page: Page): Promise<{ kid: string; jwksUrl: string }> {
  await expect(field(page, 'Key ID')).toBeVisible({ timeout: 30000 });
  return { kid: (await field(page, 'Key ID').innerText()).trim(), jwksUrl: (await field(page, 'JWKS URL').innerText()).trim() };
}

test.afterAll(async () => {
  await db.from('issued_licenses').delete().eq('product_id', product);
  await db.from('products').delete().eq('id', product);
  if (kids.length) await db.from('seller_license_keys').delete().in('kid', kids);
  await cleanup?.().catch(() => undefined);
});

test('seller changes the signing key; the old key stays published as retired and earlier licenses verify @J630', async ({ page, request }) => {
  const admin = await createTestAdmin('license-rotation-admin');
  cleanup = admin.cleanup;
  await setAuthSession(page, admin.email, admin.password);
  await page.goto('/en/dashboard/settings?tab=license');

  await expect(page.getByText(/The current key is retired, not cancelled/)).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Generate key' }).click();
  const first = await shownKey(page);
  kids.push(first.kid);
  const seller = new URL(first.jwksUrl).searchParams.get('seller')!;

  expect((await db.from('products').insert({ id: product, slug: `rotation-${product.slice(0, 8)}`, name: 'Rotation E2E', price: 10, currency: 'PLN', seller_id: seller, issue_license_on_purchase: true, license_tier: 'pro' })).error).toBeNull();
  process.env.E2E_MODE = 'true';
  const before = await issueLicense(db, { productId: product, email: 'buyer@example.com', userId: null, orderId: `order_${randomUUID()}` });
  expect(before?.kid).toBe(first.kid);

  await page.getByRole('button', { name: 'Generate key' }).click();
  await expect(field(page, 'Key ID')).not.toHaveText(first.kid, { timeout: 30000 });
  const second = await shownKey(page);
  kids.push(second.kid);

  const res = await request.get(`/api/licenses/jwks?seller=${seller}`);
  expect(res.status()).toBe(200);
  const { keys } = await res.json();
  expect(keys.map((k: { kid: string; status: string }) => [k.kid, k.status])).toEqual([[second.kid, 'active'], [first.kid, 'retired']]);
  expect(verifySellfLicense(before!.token, { keys })).toMatchObject({ valid: true });
  for (const key of keys) {
    expect(key).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' });
    expect(createPublicKey({ key, format: 'jwk' }).export({ type: 'spki', format: 'pem' })).toBe(key.pem);
  }

  await page.getByRole('button', { name: 'How to use' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/purchase\.completed webhook payload in licenses\[\]/)).toBeVisible();
  await expect(dialog.getByText(/Mailstack/)).toBeVisible();
  await expect(dialog.getByText(/keeps publishing it with status "retired"/)).toBeVisible();
  await expect(dialog.getByText(/license\.token|does not email/)).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('license-how-to-use-en.png') });
});

test('Polish panel explains the planned key change @J630', async ({ page }) => {
  const admin = await createTestAdmin('license-rotation-admin-pl');
  try {
    await setAuthSession(page, admin.email, admin.password);
    await page.goto('/pl/dashboard/settings?tab=license');
    await expect(page.getByText(/Obecny klucz zostanie wycofany, nie unieważniony/)).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Jak używać' }).click();
    await expect(page.getByRole('dialog').getByText(/ze statusem "retired"/)).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('license-how-to-use-pl.png') });
  } finally {
    await admin.cleanup();
  }
});
