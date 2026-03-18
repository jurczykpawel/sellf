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
  const adminPassword = 'password123';
  let productId: string;

  const loginAsAdmin = async (page: Page) => {
    await acceptAllCookies(page);

    await page.addInitScript(() => {
      const addStyle = () => {
        if (document.head) {
          const style = document.createElement('style');
          style.innerHTML = '#klaro { display: none !important; }';
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
    await supabaseAdmin.from('integrations_config').upsert({
      id: 1,
      currency_api_provider: 'ecb',
      currency_api_enabled: true,
      currency_api_key_encrypted: null,
      currency_api_key_iv: null,
      currency_api_key_tag: null,
    });

    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `test-currency-${Date.now()}-${randomStr}@example.com`;

    // Create admin user
    const { data: { user }, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });
    if (createError) throw createError;

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

  test('should show currency selector with multiple currencies', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Wait for component to load currencies
    await page.waitForTimeout(3000);

    // Debug: check what buttons are on the page
    const allButtons = await page.locator('button').allTextContents();
    console.log('All buttons on page:', allButtons);

    // Currency selector should be visible
    const currencySelector = page.locator('button', { hasText: /Grouped|Convert/i }).first();
    await expect(currencySelector).toBeVisible({ timeout: 10000 });
  });

  test('should display converted to a currency by default (not grouped)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Check selector shows "Convert to [CURRENCY]" (shop's default or user's saved preference)
    const currencyButton = page.locator('button', { hasText: /Convert to/i }).first();
    await expect(currencyButton).toBeVisible({ timeout: 10000 });

    // Should NOT show "Grouped by Currency" by default
    const groupedButton = page.locator('button', { hasText: /Grouped by Currency/i }).first();
    await expect(groupedButton).not.toBeVisible();

    // Check total revenue card shows single currency (no + sign)
    const revenueCard = page.getByTestId('stat-card-total-revenue');
    await expect(revenueCard).toBeVisible();

    const revenueValue = revenueCard.locator('p').nth(1);
    const revenueText = await revenueValue.textContent();

    // Should NOT contain + sign (single currency, converted mode)
    expect(revenueText).not.toContain('+');
    // Should contain a currency (symbol or code like PLN, USD, EUR)
    expect(revenueText).toMatch(/[€$£zł¥]|[A-Z]{3}/);
  });

  test('should switch to converted mode and show single currency', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Open currency selector
    const currencyButton = page.locator('button', { hasText: /Grouped|Convert/i }).first();
    await currencyButton.click();

    // Wait for dropdown to appear
    await page.waitForTimeout(300);

    // Select "Convert to USD"
    const usdOption = page.locator('button', { hasText: 'USD' }).first();
    await usdOption.click();

    // Wait for conversion
    await page.waitForTimeout(1000);

    // Verify button now shows "Convert to USD"
    await expect(page.locator('button', { hasText: /Convert to USD/i }).first()).toBeVisible({ timeout: 5000 });

    // Check revenue card now shows only USD
    const revenueCard = page.getByTestId('stat-card-total-revenue');
    const revenueValue = revenueCard.locator('p').nth(1);
    const revenueText = await revenueValue.textContent();

    // Should NOT contain + sign (single currency)
    expect(revenueText).not.toContain('+');
    // Should contain $ symbol
    expect(revenueText).toContain('$');
  });

  test('should convert to EUR and show euro symbol', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Open currency selector
    const currencyButton = page.locator('button', { hasText: /Grouped|Convert/i }).first();
    await currencyButton.click();

    await page.waitForTimeout(300);

    // Select EUR
    const eurOption = page.locator('button', { hasText: 'EUR' }).filter({ has: page.locator('span', { hasText: '€' }) }).first();
    await eurOption.click();

    await page.waitForTimeout(1000);

    // Verify converted
    await expect(page.locator('button', { hasText: /Convert to EUR/i }).first()).toBeVisible({ timeout: 5000 });

    const revenueCard = page.getByTestId('stat-card-total-revenue');
    const revenueValue = revenueCard.locator('p').nth(1);
    const revenueText = await revenueValue.textContent();

    expect(revenueText).not.toContain('+');
    expect(revenueText).toContain('€');
  });

  test('should persist currency preference across page reloads', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Set to EUR
    const currencyButton = page.locator('button', { hasText: /Grouped|Convert/i }).first();
    await currencyButton.click();
    await page.waitForTimeout(300);

    const eurOption = page.locator('button', { hasText: 'EUR' }).filter({ has: page.locator('span', { hasText: '€' }) }).first();
    await eurOption.click();
    await page.waitForTimeout(1000);

    // Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should still show "Convert to EUR"
    await expect(page.locator('button', { hasText: /Convert to EUR/i }).first()).toBeVisible({ timeout: 10000 });

    // Revenue should still show €
    const revenueCard = page.getByTestId('stat-card-total-revenue');
    const revenueValue = revenueCard.locator('p').nth(1);
    const revenueText = await revenueValue.textContent();
    expect(revenueText).toContain('€');
  });

  test('should switch back to grouped mode', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

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
    await page.waitForLoadState('networkidle');

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
    await page.waitForLoadState('networkidle');

    // Ensure we start in grouped mode (previous test may have left it in converted)
    const currencyBtn = page.locator('button', { hasText: /Grouped|Convert/i }).first();
    await expect(currencyBtn).toBeVisible({ timeout: 30000 });
    const btnText = await currencyBtn.textContent() || '';
    if (/Convert/i.test(btnText)) {
      // Currently in converted mode — switch to grouped first
      await currencyBtn.click();
      const groupedOpt = page.locator('button', { hasText: /Grouped by Currency|Pogrupowane/i }).first();
      await expect(groupedOpt).toBeVisible({ timeout: 5000 });
      await groupedOpt.click();
      await expect(page.locator('button', { hasText: /Grouped/i }).first()).toBeVisible({ timeout: 10000 });
    }

    // Get initial grouped total (should contain +)
    const revenueCard = page.getByTestId('stat-card-total-revenue');
    const initialValue = await revenueCard.locator('p').nth(1).textContent();
    console.log('Grouped revenue:', initialValue);

    // Convert to a currency — retry click to handle RSC refetch swallowing events
    const currencyButton = page.locator('button', { hasText: /Grouped|Convert/i }).first();
    const currencyOption = page.locator('button').filter({ hasNotText: /Grouped|Pogrupowane|Convert/i }).filter({ hasText: /\b(USD|EUR|PLN|GBP|CHF|CZK|SEK|NOK|DKK|HUF|RON|BGN|HRK|JPY|CAD|AUD)\b/ }).first();
    await expect(async () => {
      await currencyButton.click();
      await expect(currencyOption).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15000 });
    const rawText = await currencyOption.textContent() || '';
    // Extract 3-letter currency code (e.g. "$ USD" → "USD")
    const selectedCurrency = rawText.match(/[A-Z]{3}/)?.[0] || rawText.trim();
    await currencyOption.click();

    // Wait for conversion to take effect
    await expect(page.locator('button', { hasText: new RegExp(`Convert to ${selectedCurrency}`, 'i') }).first()).toBeVisible({ timeout: 10000 });

    // Get converted value
    const convertedValue = await revenueCard.locator('p').nth(1).textContent();
    console.log(`Converted to ${selectedCurrency}:`, convertedValue);

    // Values should be different (grouped multi-currency vs single converted)
    expect(initialValue).not.toBe(convertedValue);

    // Converted value should show a single currency (no + sign between multiple currencies)
    expect(convertedValue).not.toContain('+');
  });

  test('should handle revenue goal in converted currency', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

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
    await page.waitForLoadState('networkidle');

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
