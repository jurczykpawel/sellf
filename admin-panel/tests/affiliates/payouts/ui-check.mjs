import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: true });
try {
  for (const locale of ['en', 'pl']) for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:55465/?locale=${locale}`);
    await page.getByRole('heading', { name: locale === 'en' ? 'Record a bank transfer' : 'Zapisz przelew bankowy' }).waitFor();
    await page.screenshot({ path: `/tmp/a1-6-${locale}-${width}.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.locator('section').innerText().then(s => /af000000|minor|expected_version/.test(s)), false);
    await page.getByRole('button', { name: 'CSV', exact: true }).click();
    assert.equal(await page.locator('body').getAttribute('data-download'), 'ready');
    await page.getByLabel(locale === 'en' ? 'Bank transfer reference' : 'Referencja przelewu bankowego').fill('BANK-2026-10');
    await page.getByLabel(locale === 'en' ? 'Invoice or approved document number' : 'Numer faktury lub zatwierdzonego dokumentu').fill('FV-10/2026');
    const amount = page.getByLabel(locale === 'en' ? 'Amount actually transferred (PLN)' : 'Rzeczywista kwota przelewu (PLN)');
    await amount.fill('24.601');
    await page.getByLabel(locale === 'en' ? 'This transfer settles the entire reservation' : 'Ten przelew rozlicza całą rezerwację').check();
    await page.getByRole('button', { name: locale === 'en' ? 'Record completed transfer' : 'Zapisz wykonany przelew' }).click();
    await page.getByRole('status').filter({ hasText: locale === 'en' ? 'Enter a valid amount' : 'Wpisz poprawną kwotę' }).waitFor();
    await amount.fill(locale === 'pl' ? '1537,50' : '1537.50');
    await page.getByRole('button', { name: locale === 'en' ? 'Record completed transfer' : 'Zapisz wykonany przelew' }).click();
    await page.getByRole('status').filter({ hasText: locale === 'en' ? 'Saved.' : 'Zapisano.' }).waitFor();
    await page.evaluate(() => document.body.style.zoom = '2');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const picker = page.getByRole('combobox', { name: 'Partner', exact: true });
    await picker.fill('No matching partner');
    await picker.press('ArrowDown'); await picker.press('Enter'); await picker.press('Escape');
    await picker.fill('Anna'); await picker.press('ArrowDown'); await picker.press('Enter');
    assert.equal(await picker.inputValue(), 'Anna Nowak');
    assert.deepEqual(errors, []);
    await page.close();
  }
  const dark = await browser.newPage({ viewport: { width: 320, height: 1000 } });
  await dark.goto('http://127.0.0.1:55465/?locale=pl&dark');
  await dark.getByRole('heading', { name: 'Zapisz przelew bankowy' }).waitFor();
  assert.equal(await dark.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await dark.screenshot({ path: '/tmp/a1-6-pl-320-dark.png', fullPage: true });
  await dark.close();
  console.log('PASS: EN/PL at 1440/390, CSV, amount validation, payment save, overflow and 200% zoom');
} finally { await browser.close(); }
