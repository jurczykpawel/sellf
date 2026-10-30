/** Dashboard chart keeps PLN and zero-decimal JPY in matching display units. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { acceptAllCookies } from './helpers/consent';
import { createTestAdmin, setAuthSession, supabaseAdmin } from './helpers/admin-auth';

test.use({ timezoneId: 'UTC' });

let admin: Awaited<ReturnType<typeof createTestAdmin>>;
const productId = randomUUID();
test.beforeEach(async () => {
  admin = await createTestAdmin('chart-units');
  const { error: productError } = await supabaseAdmin.from('products').insert({
    id: productId, name: 'Chart units', slug: `chart-units-${productId}`, price: 10, currency: 'PLN', is_active: true,
  });
  if (productError) throw productError;
  const { error } = await supabaseAdmin.from('payment_transactions').insert([
    { amount: 330840, currency: 'PLN', created_at: '2026-10-24T12:00:00Z' },
    { amount: 1000, currency: 'JPY', created_at: '2026-10-24T12:00:00Z' },
    { amount: 351160, currency: 'PLN', created_at: '2026-10-25T12:00:00Z' },
  ].map(transaction => ({ ...transaction, product_id: productId, session_id: `cs_test_${randomUUID().replaceAll('-', '')}`,
    customer_email: 'chart@example.com', status: 'completed' })));
  if (error) throw error;
});
test.afterEach(async () => {
  await supabaseAdmin.from('payment_transactions').delete().eq('product_id', productId);
  await supabaseAdmin.from('products').delete().eq('id', productId);
  await admin?.cleanup();
});

for (const locale of ['en', 'pl']) {
  test(`${locale}: grouped 30-day revenue uses major units for PLN and JPY @J102`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-10-26T12:00:00Z'));
    await acceptAllCookies(page);
    await setAuthSession(page, admin.email, admin.password);
    await page.goto(`/${locale}/dashboard?productId=${productId}`);
    await page.getByRole('button', { name: /Convert to [A-Z]{3}|Przelicz na [A-Z]{3}/i }).click();
    await page.getByRole('button', { name: /Grouped by Currency|Pogrupowane według waluty/i }).click();
    await expect(page.getByRole('button', { name: /Grouped by Currency|Pogrupowane według waluty/i }).first()).toBeVisible();
    const responsePromise = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/admin/dashboard' && url.searchParams.get('read') === 'chart' && response.ok();
    });
    await page.getByRole('button', { name: '30d', exact: true }).click();
    const { data } = await (await responsePromise).json();
    const index = data.findIndex((point: { date: string }) => point.date.startsWith('2026-10-24'));
    expect(index).toBeGreaterThanOrEqual(0);
    expect(data[index].amount).toMatchObject({ PLN: 330840, JPY: 1000 });
    const chart = page.locator('.recharts-wrapper').first();
    const ticks = chart.locator('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value');
    await expect(ticks).not.toHaveCount(0);
    // This fixture peaks at 4308.4 (1000 JPY + 3308.4 PLN), never at 331840.
    await expect.poll(async () => {
      const label = (await ticks.last().textContent())!;
      const numeric = Number(label.replace(/[^0-9.,]/g, '').replace(',', '.'));
      return numeric * (/K|tys/.test(label) ? 1000 : 1);
    }).toBeGreaterThanOrEqual(4000);
    const topLabel = (await ticks.last().textContent())!;
    const topValue = Number(topLabel.replace(/[^0-9.,]/g, '').replace(',', '.')) * (/K|tys/.test(topLabel) ? 1000 : 1);
    expect(topValue).toBeLessThan(10000);
    const money = (value: number, currency: string) => new Intl.NumberFormat(locale, {
      style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(value);
    await expect(page.locator('div').filter({ has: page.getByRole('button', { name: '30d', exact: true }) }).filter({ has: chart }).last().getByText(`${money(1000, 'JPY')} + ${money(6820, 'PLN')}`, { exact: true })).toBeVisible();
    await chart.scrollIntoViewIfNeeded();
    await chart.getByRole('application').focus();
    for (let step = 0; step < index; step++) await page.keyboard.press('ArrowRight');
    const tooltip = chart.locator('.recharts-tooltip-wrapper');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(money(3308.4, 'PLN'));
    await expect(tooltip).toContainText(money(1000, 'JPY'));
    await page.screenshot({ path: testInfo.outputPath(`grouped-${locale}.png`), fullPage: true });
  });
}
