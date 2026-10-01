import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';
import { setAuthSession } from './helpers/admin-auth';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('Currency Conversion Feature', () => {
  // Enforce single worker INSIDE describe block
  test.describe.configure({ mode: 'serial' });

  let adminEmail: string;
  let adminUserId: string;
  const adminPassword = 'password123';
  let productId: string;

  const loginAsAdmin = async (page: Page) => {
    await acceptAllCookies(page);

    await page.addInitScript(() => {
      const addStyle = () => {
        if (document.head) {
          const style = document.createElement('style');
          style.innerHTML = '#cc-main { display: none !important; }';
          document.head.appendChild(style);
        } else {
          setTimeout(addStyle, 10);
        }
      };
      addStyle();
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await setAuthSession(page, adminEmail, adminPassword);

    await page.waitForTimeout(1000);
  };

  test.beforeAll(async () => {
    // Ensure ECB (free, no key needed) is the currency provider for tests
    // Use update (not upsert) to preserve other fields like sellf_license
    await supabaseAdmin.from('integrations_config').update({
      currency_api_provider: 'ecb',
      currency_api_enabled: true,
      currency_api_key_encrypted: null,
      currency_api_key_iv: null,
      currency_api_key_tag: null,
    }).eq('id', 1);

    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `test-currency-${Date.now()}-${randomStr}@example.com`;

    // Create admin user
    const { data: { user }, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });
    if (createError) throw createError;
    adminUserId = user!.id;

    await supabaseAdmin
      .from('admin_users')
      .insert({ user_id: user!.id });

    // Create a test product
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Currency Test Product',
        slug: `currency-test-${Date.now()}`,
        price: 5000,
        currency: 'USD',
        description: 'Test product for currency conversion',
        is_active: true
      })
      .select()
      .single();

    if (productError) throw productError;
    productId = product.id;

    // Create test transactions in multiple currencies
    const transactions = [
      { amount: 9900, currency: 'USD', email: 'usd-test@example.com' },
      { amount: 8500, currency: 'EUR', email: 'eur-test@example.com' },
      { amount: 7500, currency: 'GBP', email: 'gbp-test@example.com' },
      { amount: 39900, currency: 'PLN', email: 'pln-test@example.com' },
    ];

    for (const tx of transactions) {
      await supabaseAdmin.from('payment_transactions').insert({
        session_id: `cs_test_currency_${Date.now()}_${Math.random()}`,
        product_id: productId,
        customer_email: tx.email,
        amount: tx.amount,
        currency: tx.currency,
        status: 'completed'
      });
    }

    // Wait for transactions to be indexed
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  test.afterAll(async () => {
    if (productId) {
      await supabaseAdmin.from('payment_transactions').delete().eq('product_id', productId);
      await supabaseAdmin.from('products').delete().eq('id', productId);
    }
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
  });

  test('should show currency selector with multiple currencies', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    // Wait for component to load currencies
    await page.waitForTimeout(3000);

    // Debug: check what buttons are on the page
    const allButtons = await page.locator('button').allTextContents();
    console.log('All buttons on page:', allButtons);

    // Currency selector should be visible
    const currencySelector = page.locator('button', { hasText: /Grouped|Convert/i }).first();
    await expect(currencySelector).toBeVisible({ timeout: 10000 });
  });

  test('currency info tooltip shows on focus, hides on Escape (keyboard access)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // Trigger must be a real, focusable button with an accessible name — not a
    // bare hover-only span/svg.
    const infoTrigger = page.getByRole('button', { name: /Exchange rates are used|Kursy wymiany walut/i });
    await expect(infoTrigger).toBeVisible({ timeout: 10000 });

    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeHidden();

    await infoTrigger.focus();
    await expect(tooltip).toBeVisible({ timeout: 2000 });

    await page.keyboard.press('Escape');
    await expect(tooltip).toBeHidden();
  });

  test('currency info tooltip toggles on tap on touch devices', async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true });
    const page = await context.newPage();
    try {
      await loginAsAdmin(page);
      await page.goto('/dashboard');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      const infoTrigger = page.getByRole('button', { name: /Exchange rates are used|Kursy wymiany walut/i });
      await expect(infoTrigger).toBeVisible({ timeout: 10000 });
      const tooltip = page.getByRole('tooltip');
      await expect(tooltip).toBeHidden();

      // Touch: tap toggles the tooltip open (there is no hover on touch devices).
      await infoTrigger.tap();
      await expect(tooltip).toBeVisible({ timeout: 2000 });

      // Tap outside closes it.
      await page.locator('body').tap({ position: { x: 5, y: 5 } });
      await expect(tooltip).toBeHidden();
    } finally {
      await context.close();
    }
  });

  test('currency selector supports rapid consecutive selections without the dropdown getting stuck closed', async ({ page }) => {
    // Regression guard: `handleSelect` used to await two sequential preference
    // saves (view mode, then currency) before closing the dropdown. Because the
    // toggle button flips `isOpen` based on its current value
    // (`onClick={() => setIsOpen(!isOpen)}`), reopening the selector while the
    // previous selection's save was still in flight (dropdown still logically
    // "open") flipped it straight back to closed instead of opening a fresh
    // menu — the dropdown then looked stuck: further clicks on an option landed
    // on nothing. The button itself never leaves the DOM in this scenario (the
    // dashboard's `revalidatePath('/dashboard')` does not remount it — verified
    // separately below), so the option-not-found symptom is the real signal.
    await loginAsAdmin(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    const currencyButton = page.locator('button', { hasText: /Grouped|Convert/i }).first();
    await expect(currencyButton).toBeVisible({ timeout: 10000 });
    const buttonHandle = await currencyButton.elementHandle();
    if (!buttonHandle) throw new Error('Could not get element handle for currency selector button');

    // A MutationObserver catches a detachment event itself instead of polling at
    // a fixed interval, which could straddle a remount that happens between checks.
    await page.evaluate((el) => {
      (window as unknown as { __sellfDetachedAt: number | null }).__sellfDetachedAt = null;
      const observer = new MutationObserver(() => {
        const w = window as unknown as { __sellfDetachedAt: number | null };
        if (w.__sellfDetachedAt === null && !(el as HTMLElement).isConnected) {
          w.__sellfDetachedAt = performance.now();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }, buttonHandle);

    // Select three currencies back-to-back, reopening the dropdown immediately
    // after each selection — without waiting for that selection's save to land.
    for (const code of ['USD', 'EUR', 'PLN']) {
      await currencyButton.click();
      const option = page.locator('button', { hasText: code }).first();
      await expect(option, `dropdown should reopen with a fresh menu offering ${code}`).toBeVisible({ timeout: 5000 });
      await option.click();
    }

    await expect(currencyButton).toContainText('PLN', { timeout: 5000 });

    const detachedAt = await page.evaluate(
      () => (window as unknown as { __sellfDetachedAt: number | null }).__sellfDetachedAt
    );
    expect(detachedAt, 'currency selector button node was detached from the DOM (unmount/remount) during rapid preference changes').toBeNull();
  });

  test('should display grouped currencies by default (multi-currency dashboard)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    const selector = page.locator('button', { hasText: /Grouped|Pogrupowane|Convert|Przelicz/i }).first();
    await expect(selector).toBeVisible({ timeout: 10000 });

    // Revenue card shows multi-currency breakdown with "+" separator
    const revenueCard = page.getByTestId('stat-card-total-revenue');
    await expect(revenueCard).toBeVisible();

    const revenueValue = revenueCard.locator('p').nth(1);
    const revenueText = await revenueValue.textContent();

    // Grouped mode: at least one currency symbol or code
    expect(revenueText).toMatch(/[€$£zł¥]|[A-Z]{3}/);
  });

  test('should switch to converted mode and show single currency', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    // Open currency selector
    const currencyButton = page.locator('button', { hasText: /Grouped|Convert/i }).first();
    await currencyButton.click();

    // Wait for dropdown to appear
    await page.waitForTimeout(300);

    // Select "Convert to USD"
    const usdOption = page.locator('button', { hasText: 'USD' }).first();
    await usdOption.click();

    // Verify button now shows "Convert to USD"
    await expect(page.locator('button', { hasText: /Convert to USD/i }).first()).toBeVisible({ timeout: 5000 });

    // Check revenue card now shows only USD. Conversion is an async round trip
    // (fetch exchange rates, then convert), so wait on the real condition
    // instead of a fixed sleep — a slow-but-successful rate fetch (e.g. a cold
    // provider cache) must not be mistaken for a stuck conversion.
    const revenueCard = page.getByTestId('stat-card-total-revenue');
    const revenueValue = revenueCard.locator('p').nth(1);

    // Should NOT contain + sign (single currency)
    await expect(revenueValue).not.toContainText('+', { timeout: 15_000 });
    // Should contain $ symbol
    await expect(revenueValue).toContainText('$');
  });

  test('should convert to EUR and show euro symbol', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    // Open currency selector
    const currencyButton = page.locator('button', { hasText: /Grouped|Convert/i }).first();
    await currencyButton.click();

    await page.waitForTimeout(300);

    // Select EUR
    const eurOption = page.locator('button', { hasText: 'EUR' }).filter({ has: page.locator('span', { hasText: '€' }) }).first();
    await eurOption.click();

    // Verify converted
    await expect(page.locator('button', { hasText: /Convert to EUR/i }).first()).toBeVisible({ timeout: 5000 });

    // Conversion is an async round trip (fetch exchange rates, then convert), so
    // wait on the real condition instead of a fixed sleep — same pattern as
    // "should switch to converted mode and show single currency" above. A fixed
    // 1s sleep here was pre-existing flakiness unrelated to the selector fix
    // below: on a loaded test run the rate fetch can outlast 1s and this would
    // read the card mid-conversion (still showing the grouped multi-currency total).
    const revenueCard = page.getByTestId('stat-card-total-revenue');
    const revenueValue = revenueCard.locator('p').nth(1);

    await expect(revenueValue).not.toContainText('+', { timeout: 15_000 });
    await expect(revenueValue).toContainText('€');
  });

  test('should persist currency preference across page reloads', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    // Set to EUR
    const currencyButton = page.locator('button', { hasText: /Grouped|Convert/i }).first();
    await currencyButton.click();
    await page.waitForTimeout(300);

    const eurOption = page.locator('button', { hasText: 'EUR' }).filter({ has: page.locator('span', { hasText: '€' }) }).first();
    await eurOption.click();

    // The preference is saved by two sequential server actions (view mode, then
    // currency) after an optimistic UI update. A reload right after the click can
    // cancel those in-flight requests before they reach the server — especially on
    // a cold dev-server compile — so wait on the real condition (the row the server
    // actually wrote) instead of racing a reload against them.
    await expect(async () => {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(adminUserId);
      if (error) throw error;
      expect(data.user?.user_metadata?.preferences?.displayCurrency).toBe('EUR');
      expect(data.user?.user_metadata?.preferences?.currencyViewMode).toBe('converted');
    }).toPass({ timeout: 10_000 });

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('button', { hasText: /Convert to EUR/i }).first()).toBeVisible({ timeout: 5000 });

    // Revenue should still show €
    const revenueCard = page.getByTestId('stat-card-total-revenue');
    const revenueValue = revenueCard.locator('p').nth(1);
    const revenueText = await revenueValue.textContent();
    expect(revenueText).toContain('€');
  });

  test('should switch back to grouped mode', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    const currencyButton = page.locator('button', { hasText: /Grouped|Convert/i }).first();
    await expect(currencyButton).toBeVisible({ timeout: 30000 });

    const buttonText = await currencyButton.textContent() || '';
    const isAlreadyGrouped = /Grouped/i.test(buttonText);

    if (isAlreadyGrouped) {
      // Already in grouped mode — switch to converted first, then back
      await currencyButton.click();
      // Pick any available currency option (not "Grouped")
      const anyConvertOption = page.locator('button').filter({ hasNotText: /Grouped|Pogrupowane|Convert/i }).filter({ hasText: /\b(USD|EUR|PLN|GBP|CHF|CZK|SEK|NOK|DKK|HUF|RON|BGN|HRK|JPY|CAD|AUD)\b/ }).first();
      await expect(anyConvertOption).toBeVisible({ timeout: 5000 });
      await anyConvertOption.click();
      // Wait for converted mode to take effect
      await expect(page.locator('button', { hasText: /Convert to/i }).first()).toBeVisible({ timeout: 10000 });
    } else {
      // Already in converted mode — just need to verify we can switch to grouped
    }

    // Now switch to grouped mode
    const convertButton = page.locator('button', { hasText: /Convert to/i }).first();
    await expect(convertButton).toBeVisible({ timeout: 10000 });

    const groupedOption = page.locator('button', { hasText: /Grouped by Currency|Pogrupowane według Waluty/i }).first();
    await expect(async () => {
      await convertButton.click();
      await expect(groupedOption).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15000 });

    await groupedOption.click();

    // Wait for grouped mode to take effect
    await expect(page.locator('button', { hasText: /Grouped by Currency|Pogrupowane według Waluty/i }).first()).toBeVisible({ timeout: 10000 });

    // Revenue should show multiple currencies (+ sign between them)
    const revenueCard = page.getByTestId('stat-card-total-revenue');
    const revenueValue = revenueCard.locator('p').nth(1);
    await expect(revenueValue).toContainText('+', { timeout: 5000 });
  });

  test('should convert chart data to selected currency', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    // Set to EUR
    const currencyButton = page.locator('button', { hasText: /Grouped|Convert/i }).first();
    await currencyButton.click();
    await page.waitForTimeout(300);

    const eurOption = page.locator('button', { hasText: 'EUR' }).filter({ has: page.locator('span', { hasText: '€' }) }).first();
    await eurOption.click();
    await page.waitForTimeout(2000); // Wait for conversion

    // Chart should exist
    const chart = page.locator('.recharts-responsive-container').first();
    await expect(chart).toBeVisible({ timeout: 10000 });

    // Find the chart's total revenue display specifically (not the stat card)
    // The chart component has "Revenue Trend" h2 followed by a large revenue value p (sibling)
    const revenueHeading = page.locator('h2', { hasText: /Revenue Trend|Trend przychod/i }).first();
    await expect(revenueHeading).toBeVisible({ timeout: 10000 });
    // Navigate to parent div of h2, then find the p sibling (revenue value)
    const totalRevenueDisplay = revenueHeading.locator('..').locator('p').first();
    const totalText = await totalRevenueDisplay.textContent();

    // Should show EUR and NOT contain + (which would indicate multiple currencies joined together)
    expect(totalText).toContain('€');
    expect(totalText).not.toContain('+');
  });

  test('should show correct converted values in stats overview', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    // Ensure we start in grouped mode (previous test may have left it in converted)
    const currencyBtn = page.locator('button', { hasText: /Grouped|Convert/i }).first();
    await expect(currencyBtn).toBeVisible({ timeout: 30000 });
    const btnText = await currencyBtn.textContent() || '';
    if (/Convert/i.test(btnText)) {
      // Currently in converted mode — switch to grouped first (retry as defensive
      // timing padding; not required by a known bug since the selector's dropdown
      // now closes synchronously on selection — see CurrencySelector.handleSelect).
      const groupedOpt = page.locator('button', { hasText: /Grouped by Currency|Pogrupowane/i }).first();
      await expect(async () => {
        await currencyBtn.click();
        await expect(groupedOpt).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 15000 });
      await groupedOpt.click();
      await expect(page.locator('button', { hasText: /Grouped/i }).first()).toBeVisible({ timeout: 10000 });
    }

    // Get initial grouped total (should contain +)
    const revenueCard = page.getByTestId('stat-card-total-revenue');
    const initialValue = await revenueCard.locator('p').nth(1).textContent();
    console.log('Grouped revenue:', initialValue);

    // Convert to a currency — retry the whole open+read+select sequence as defensive
    // timing padding. (Earlier investigation attributed a flaky version of this to
    // the dashboard's `revalidatePath('/dashboard')` remounting the selector on a
    // preference-save refetch; that was checked directly — see the DOM-detachment
    // assertion in "currency selector supports rapid consecutive selections..." above
    // — and disproved: the button node is never detached. The real bug was
    // CurrencySelector's dropdown toggle racing its own pending save and has been
    // fixed at the source, but the retry wrapper is kept here as cheap insurance
    // against ordinary CI timing variance.)
    const currencyButton = page.locator('button', { hasText: /Grouped|Convert/i }).first();
    const currencyOption = page.locator('button').filter({ hasNotText: /Grouped|Pogrupowane|Convert/i }).filter({ hasText: /\b(USD|EUR|PLN|GBP|CHF|CZK|SEK|NOK|DKK|HUF|RON|BGN|HRK|JPY|CAD|AUD)\b/ }).first();
    let rawText = '';
    await expect(async () => {
      await currencyButton.click();
      await expect(currencyOption).toBeVisible({ timeout: 1000 });
      rawText = await currencyOption.textContent() || '';
      await currencyOption.click();
    }).toPass({ timeout: 15000 });
    // Extract 3-letter currency code (e.g. "$ USD" → "USD")
    const selectedCurrency = rawText.match(/[A-Z]{3}/)?.[0] || rawText.trim();

    // Wait for conversion to take effect — value must change from grouped
    await expect(async () => {
      const currentValue = await revenueCard.locator('p').nth(1).textContent();
      expect(currentValue).not.toBe(initialValue);
    }).toPass({ timeout: 15000 });

    // Get converted value
    const convertedValue = await revenueCard.locator('p').nth(1).textContent();
    console.log(`Converted to ${selectedCurrency}:`, convertedValue);

    // Converted value should show a single currency (no + sign between multiple currencies)
    expect(convertedValue).not.toContain('+');
  });

  test('should handle revenue goal in converted currency', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    // Find Revenue Goal section
    const revenueGoalSection = page.locator('div', { hasText: /Revenue Goal|Cel przychodu/i }).first();

    // Check if revenue goal is visible (it may not be if not set)
    const isVisible = await revenueGoalSection.isVisible().catch(() => false);

    if (isVisible) {
      // Convert to PLN
      const currencyButton = page.locator('button', { hasText: /Grouped|Convert/i }).first();
      await currencyButton.click();
      await page.waitForTimeout(300);

      const plnOption = page.locator('button', { hasText: 'PLN' }).filter({ has: page.locator('span', { hasText: 'zł' }) }).first();
      await plnOption.click();
      await page.waitForTimeout(2000);

      // Revenue goal should update (hard to verify exact value, but we can check it exists)
      await expect(revenueGoalSection).toBeVisible();
    } else {
      // Revenue goal section is not configured; verify dashboard still renders correctly
      await expect(page.getByTestId('stat-card-total-revenue')).toBeVisible();
    }
  });

  test('should handle conversion errors gracefully', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    // Try to convert to a currency
    const currencyButton = page.locator('button', { hasText: /Grouped|Convert/i }).first();
    await currencyButton.click();
    await page.waitForTimeout(300);

    const eurOption = page.locator('button', { hasText: 'EUR' }).filter({ has: page.locator('span', { hasText: '€' }) }).first();
    await eurOption.click();

    // Even if conversion fails, page should not crash
    await page.waitForTimeout(2000);

    // Dashboard should still be visible and functional
    await expect(page.getByTestId('stat-card-total-revenue')).toBeVisible();
    await expect(page.getByTestId('stat-card-today-orders')).toBeVisible();
  });
});
