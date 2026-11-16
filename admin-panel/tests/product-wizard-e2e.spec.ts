import { test, expect, Page } from '@playwright/test';
import { createTestAdmin, loginAsAdmin, supabaseAdmin } from './helpers/admin-auth';
import { restoreBaselineTaxMode, setTaxMode } from './helpers/tax-mode';
import { formSectionButton, openFormSection } from './helpers/product-form';
import pl from '../src/messages/pl.json';

/**
 * Product form E2E tests
 *
 * One form for creating AND editing products, split into sections by what the seller sets:
 * Podstawy (type, name, slug, price) / Co dostaje klient (content, bundle, access, license) /
 * Dane w koszyku (checkout profile, extra fields, consent) / Terminy i miejsca (event dates) /
 * Oferta (description, marketing, look, categories, tags) / Sprzedaż i rozliczenia (promotion,
 * availability, visibility, after purchase, refunds, embed, commission).
 *
 * Also tests: edit mode, duplicate mode, exit confirmation.
 */

test.describe.configure({ mode: 'serial' });

let adminEmail: string;
let adminPassword: string;
let adminCleanup: () => Promise<void>;

// Track products created during tests for cleanup
const createdProductSlugs: string[] = [];

test.beforeAll(async () => {
  const admin = await createTestAdmin('wizard-e2e');
  adminEmail = admin.email;
  adminPassword = admin.password;
  adminCleanup = admin.cleanup;
});

test.afterAll(async () => {
  // Cleanup created products
  for (const slug of createdProductSlugs) {
    await supabaseAdmin.from('products').delete().eq('slug', slug);
  }
  await adminCleanup();
});

// shop_config is a GLOBAL singleton. The stripe_tax badge test flips tax_mode='stripe_tax';
// guarantee the baseline is restored after EVERY test in this file (see helpers/tax-mode.ts,
// which also waits out the public shop_config cache) so no later checkout test sees stripe_tax.
test.afterEach(async () => {
  await restoreBaselineTaxMode(supabaseAdmin);
});

async function goToProducts(page: Page) {
  await loginAsAdmin(page, adminEmail, adminPassword);
  await page.goto('/pl/dashboard/products');
  await page.waitForLoadState('domcontentloaded');
}

async function openWizard(page: Page) {
  const addButton = page.locator('button', { hasText: /Dodaj produkt/i });
  await addButton.click();
  // Form opens on the basics section
  await expect(page.getByText('Utwórz nowy produkt')).toBeVisible({ timeout: 5000 });
}

const SECTION_TITLES = pl.admin.products.form.sections;

async function fillDescription(page: Page, value: string) {
  // The description lives in the offer section.
  await openFormSection(page, SECTION_TITLES.offer.title);
  await expect(page.locator('textarea#description')).toBeVisible({ timeout: 5000 });
  await page.fill('textarea#description', value);
}

async function expectSection(page: Page, title: string) {
  await expect(formSectionButton(page, title)).toHaveAttribute('aria-current', 'true');
}

test.describe('Product Creation Wizard', () => {

  test('should open wizard when clicking Add Product', async ({ page }) => {
    await goToProducts(page);
    await openWizard(page);

    // Section list starts on the basics
    await expectSection(page, SECTION_TITLES.basics.title);

    // Product-type radio renders at the top of the basics
    await expect(page.locator('[data-product-type="standard"]')).toBeVisible();
    await expect(page.locator('[data-product-type="tip-jar"]')).toBeVisible();

    // Publish (primary) + Continue Setup buttons should be visible
    await expect(page.getByRole('button', { name: /Publikuj/i })).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: /Dalej/i })).toBeVisible();

    // Cancel button on the first section
    await expect(page.getByRole('button', { name: /Anuluj/i })).toBeVisible();

    // Publish disabled before name + price are filled — buyer-side checklist shows ○
    const publishBtn = page.getByRole('button', { name: /Publikuj/i });
    await expect(publishBtn).toBeDisabled();
  });

  test('should create product from the basics alone (fast path) @J47', async ({ page }) => {
    await goToProducts(page);
    await openWizard(page);

    const uniqueSuffix = Date.now();
    const productName = `Wizard Fast ${uniqueSuffix}`;
    createdProductSlugs.push(`wizard-fast-${uniqueSuffix}`);

    // Fill name + price in the basics
    await page.fill('input#name', productName);
    await page.waitForTimeout(300);
    await page.fill('input#price', '49,99');

    // Publish enabled — description is optional so one click submits immediately
    const publishBtn = page.getByRole('button', { name: /Publikuj/i });
    await expect(publishBtn).toBeEnabled();
    await publishBtn.click();

    // Wait for modal to close
    await expect(page.getByText('Utwórz nowy produkt')).not.toBeVisible({ timeout: 15000 });

    // Product should appear in the list
    await page.waitForTimeout(1000);
    await expect(page.locator('table td').getByText(productName).first()).toBeVisible({ timeout: 10000 });
  });

  test('should move through all sections with Dalej and Wstecz', async ({ page }) => {
    await goToProducts(page);
    await openWizard(page);

    await page.fill('input#name', 'Nav Test Product');
    await page.fill('input#price', '10');

    // Wait for slug auto-generation from name (required by the basics validation)
    await expect(page.locator('input#slug')).not.toHaveValue('', { timeout: 5000 });

    const dialog = page.getByRole('dialog');
    const nextBtn = dialog.getByRole('button', { name: /Dalej/i });
    const order = ['basics', 'delivery', 'cart', 'schedule', 'offer', 'sales'] as const;

    // Basics → next section. "Dalej" stays disabled until the shop config loads, so retry the click.
    await expect(async () => {
      if (await page.locator('input#name').isVisible().catch(() => false)) await nextBtn.click();
      await expect(page.locator('input#name')).not.toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await expectSection(page, SECTION_TITLES.delivery.title);
    await expect(page.getByRole('button', { name: /Wstecz/i })).toBeVisible();

    for (const section of order.slice(2)) {
      await nextBtn.click();
      await expectSection(page, SECTION_TITLES[section].title);
    }

    // No "Dalej" on the last section; Back + Publish stay
    await expect(nextBtn).not.toBeVisible();
    await expect(page.getByRole('button', { name: /Wstecz/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Publikuj/i })).toBeVisible();

    for (const section of [...order].reverse().slice(1)) {
      await page.getByRole('button', { name: /Wstecz/i }).click();
      await expectSection(page, SECTION_TITLES[section].title);
    }

    // Close without creating
    await page.getByRole('button', { name: /Anuluj/i }).click();
    // Exit confirmation should appear (form is dirty)
    await expect(page.getByText(/Odrzucić zmiany/i)).toBeVisible();
    await page.getByRole('button', { name: /Odrzuć/i }).click();
  });

  test('should create product after visiting the offer and sales sections', async ({ page }) => {
    await goToProducts(page);
    await openWizard(page);

    const uniqueSuffix = Date.now();
    const productName = `Wizard Full ${uniqueSuffix}`;
    createdProductSlugs.push(`wizard-full-${uniqueSuffix}`);

    await page.fill('input#name', productName);
    await page.fill('input#price', '99');
    await expect(page.locator('input#slug')).not.toHaveValue('', { timeout: 5000 });

    await fillDescription(page, 'Product created through the offer section');
    await openFormSection(page, SECTION_TITLES.sales.title);
    await page.getByRole('button', { name: /Publikuj/i }).click();

    // Wait for modal to close after creation
    await expect(page.getByText('Utwórz nowy produkt')).not.toBeVisible({ timeout: 15000 });

    // Product should appear in list
    await expect(page.locator('table td').getByText(productName).first()).toBeVisible({ timeout: 10000 });
  });

  test('publish button disabled with no name or price filled', async ({ page }) => {
    await goToProducts(page);
    await openWizard(page);

    // Lead-magnet is the inferred default for an empty form (price=0, no PWYW).
    // For the assertion to be meaningful we move to the paid "standard" type
    // so the checklist demands a price.
    await page.locator('[data-product-type="standard"]').click();

    // Required missing → Publish disabled.
    await expect(page.getByRole('button', { name: /Publikuj/i })).toBeDisabled();
  });

  test('should show exit confirmation when form is dirty', async ({ page }) => {
    await goToProducts(page);
    await openWizard(page);

    // Type something (makes form dirty)
    await page.fill('input#name', 'Dirty form test');

    // Click cancel
    await page.getByRole('button', { name: /Anuluj/i }).click();

    // Exit confirmation should appear
    await expect(page.getByText(/Odrzucić zmiany/i)).toBeVisible();
    await expect(page.getByText(/Masz niezapisane dane produktu/i)).toBeVisible();

    // Click "Keep Editing" — should go back to wizard
    await page.getByRole('button', { name: /Kontynuuj edycję/i }).click();

    // Wizard should still be open with data preserved
    await expect(page.getByText('Utwórz nowy produkt')).toBeVisible();
    const nameValue = await page.inputValue('input#name');
    expect(nameValue).toBe('Dirty form test');
  });

  test('should NOT show exit confirmation when form is clean', async ({ page }) => {
    await goToProducts(page);
    await openWizard(page);

    // Don't fill anything, just close
    const closeBtn = page.locator('button[aria-label="Close modal"], button[aria-label="Zamknij okno"]');
    await closeBtn.click();

    // Should close immediately without confirmation
    await expect(page.getByText('Utwórz nowy produkt')).not.toBeVisible({ timeout: 3000 });
  });

  test('should show VAT fields in the basics in local tax mode', async ({ page }) => {
    // Ensure local tax mode is set
    await restoreBaselineTaxMode(supabaseAdmin);

    await goToProducts(page);
    await openWizard(page);

    // Pick standard (paid) so the price + VAT inputs render
    await page.locator('[data-product-type="standard"]').click();

    // Enter a price > 0 to reveal the VAT checkbox (hidden when price = 0)
    const priceInput = page.locator('input#price');
    await priceInput.fill('10');

    // VAT checkbox should be visible (price_includes_vat)
    const vatCheckbox = page.locator('input#price_includes_vat');
    await expect(vatCheckbox).toBeVisible();

    // VAT rate input should be visible when checkbox is checked (default: checked)
    const vatInput = page.locator('input#vat_rate');
    await expect(vatInput).toBeVisible();

    // Close without saving
    await page.locator('button[aria-label="Close modal"], button[aria-label="Zamknij okno"]').click();
    const exitModal = page.getByText(/Odrzucić zmiany/i);
    if (await exitModal.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByRole('button', { name: /Odrzuć/i }).click();
    }
  });

  test('should show Stripe Tax info badge in stripe_tax mode', async ({ page }) => {
    // Switch to stripe_tax mode
    await setTaxMode(supabaseAdmin, 'stripe_tax');

    await goToProducts(page);
    await openWizard(page);

    // Pick standard so the price block renders (and exposes the tax badge)
    await page.locator('[data-product-type="standard"]').click();

    // Wait for async getShopConfig() call to resolve and update taxMode state
    await page.waitForTimeout(2000);

    // Enter price so the tax info block reveals
    await page.fill('input#price', '10');

    // Should show the "handled by Stripe Tax" info (key: vatStripeTaxInfo) instead of VAT fields.
    await expect(page.getByText(/handled by Stripe Tax|obsługiwany przez Stripe Tax/i)).toBeVisible({ timeout: 10000 });

    // VAT rate input should NOT be visible
    const vatInput = page.locator('input#vat_rate');
    await expect(vatInput).not.toBeVisible();

    // (tax_mode is restored to 'local' by the guaranteed afterEach — no in-body cleanup that
    //  would be skipped if an assertion above throws.)

    // Close without saving
    await page.locator('button[aria-label="Close modal"], button[aria-label="Zamknij okno"]').click();
    const exitModal = page.getByText(/Odrzucić zmiany/i);
    if (await exitModal.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByRole('button', { name: /Odrzuć/i }).click();
    }
  });
});

test.describe('Product type radio', () => {
  test('switching to tip-jar applies PWYW + tip-jar template defaults', async ({ page }) => {
    await goToProducts(page);
    await openWizard(page);

    // Pick tip-jar
    await page.locator('[data-product-type="tip-jar"]').click();

    // The tip-jar branch hides the standalone price input (it's PWYW)
    // and sets allow_custom_price=true under the hood. The form should
    // not require a price for publish to enable — only name.
    await page.fill('input#name', `Tip Jar ${Date.now()}`);
    const publishBtn = page.getByRole('button', { name: /Publikuj/i });
    await expect(publishBtn).toBeEnabled();

    // Close without saving
    await page.locator('button[aria-label="Close modal"], button[aria-label="Zamknij okno"]').click();
    const exitModal = page.getByText(/Odrzucić zmiany/i);
    if (await exitModal.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByRole('button', { name: /Odrzuć/i }).click();
    }
  });

  test('tip-jar exposes PWYW config (min + presets + show toggle)', async ({ page }) => {
    await goToProducts(page);
    await openWizard(page);

    await page.locator('[data-product-type="tip-jar"]').click();

    // PWYW config inputs are visible: min amount, suggested presets (3 inputs),
    // and the "show presets" toggle. The main one-line price input is gone.
    await expect(page.locator('input#custom_price_min')).toBeVisible();
    await expect(page.locator('input#show_price_presets')).toBeVisible();

    // Min defaults to 1 (typical "support from 1 PLN").
    await expect(page.locator('input#custom_price_min')).toHaveValue('1');

    // Three preset inputs render with the default 5 / 10 / 25.
    const presetInputs = page.locator('input[type="number"][step="1"][placeholder="0"]');
    await expect(presetInputs).toHaveCount(3);
    await expect(presetInputs.nth(0)).toHaveValue('5');
    await expect(presetInputs.nth(1)).toHaveValue('10');
    await expect(presetInputs.nth(2)).toHaveValue('25');

    // The standard paid price input is NOT visible in tip-jar mode.
    await expect(page.locator('input#price')).not.toBeVisible();

    // Close
    await page.locator('button[aria-label="Close modal"], button[aria-label="Zamknij okno"]').click();
    const exitModal = page.getByText(/Odrzucić zmiany/i);
    if (await exitModal.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByRole('button', { name: /Odrzuć/i }).click();
    }
  });

  test('tip-jar with just a name allows leaving the basics (no price required)', async ({ page }) => {
    await goToProducts(page);
    await openWizard(page);

    await page.fill('input#name', `Tip Jar Continue ${Date.now()}`);
    await page.locator('[data-product-type="tip-jar"]').click();

    // Click "Dalej" — should advance to the next section, NOT block on missing price.
    await page.getByRole('dialog').getByRole('button', { name: /Dalej/i }).click();
    await expectSection(page, SECTION_TITLES.delivery.title);

    // Close without saving
    await page.locator('button[aria-label="Close modal"], button[aria-label="Zamknij okno"]').click();
    const exitModal = page.getByText(/Odrzucić zmiany/i);
    if (await exitModal.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByRole('button', { name: /Odrzuć/i }).click();
    }
  });

  test('"Dalej" on Standard with missing description advances without a description error', async ({ page }) => {
    await goToProducts(page);
    await openWizard(page);

    // Pick standard, fill name + price, leave description empty.
    await page.locator('[data-product-type="standard"]').click();
    await page.fill('input#name', `Standard No Desc ${Date.now()}`);
    await page.fill('input#price', '49');

    // Click "Dalej" — the basics are valid; the basics validation does not look at the description.
    await page.getByRole('dialog').getByRole('button', { name: /Dalej/i }).click();
    await expectSection(page, SECTION_TITLES.delivery.title);

    // No "description required" red error should be surfaced yet — user hasn't
    // tried to submit. The error only fires on Publikuj.
    const descError = page.getByText(/Opis jest wymagany|Description is required/i);
    await expect(descError).not.toBeVisible({ timeout: 1000 });

    // Close without saving
    await page.locator('button[aria-label="Close modal"], button[aria-label="Zamknij okno"]').click();
    const exitModal = page.getByText(/Odrzucić zmiany/i);
    if (await exitModal.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByRole('button', { name: /Odrzuć/i }).click();
    }
  });

  test('Standard with price=0 cannot publish (free product → lead-magnet)', async ({ page }) => {
    await goToProducts(page);
    await openWizard(page);

    await page.locator('[data-product-type="standard"]').click();
    await page.fill('input#name', `Standard Zero ${Date.now()}`);
    await page.fill('input#price', '0');

    // Publish stays disabled (checklist shows price ○).
    const publishBtn = page.getByRole('button', { name: /Publikuj/i });
    await expect(publishBtn).toBeDisabled();

    // Switching to lead-magnet enables publish (price=0 is intentional there).
    await page.locator('[data-product-type="lead-magnet"]').click();
    // Lead magnet still needs content ("Co dostaje klient"), so publish remains disabled
    // until a content item is added. Just verify standard+0 is gated.
    await expect(publishBtn).toBeDisabled();

    // Close
    await page.locator('button[aria-label="Close modal"], button[aria-label="Zamknij okno"]').click();
    const exitModal = page.getByText(/Odrzucić zmiany/i);
    if (await exitModal.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByRole('button', { name: /Odrzuć/i }).click();
    }
  });
});

test.describe('Money input and publish feedback', () => {
  async function closeWizard(page: Page) {
    await page.locator('button[aria-label="Close modal"], button[aria-label="Zamknij okno"]').click();
    const exitModal = page.getByText(/Odrzucić zmiany/i);
    if (await exitModal.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByRole('button', { name: /Odrzuć/i }).click();
    }
  }

  test('JPY price keeps what was typed and flags a fraction instead of multiplying it', async ({ page }) => {
    await goToProducts(page);
    await openWizard(page);

    await page.locator('[data-product-type="standard"]').click();
    await page.fill('input#name', `JPY Fraction ${Date.now()}`);
    await page.selectOption('select#currency', 'JPY');
    await page.locator('input#price').pressSequentially('1000.5');

    await expect(page.locator('input#price')).toHaveValue('1000.5');
    await expect(page.getByRole('dialog').getByRole('alert').filter({ hasText: /JPY/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Publikuj/i })).toBeDisabled();

    await page.fill('input#price', '1 000');
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Publikuj/i })).toBeEnabled();

    await closeWizard(page);
  });

  test('VAT rate stays editable when the price excludes VAT', async ({ page }) => {
    await goToProducts(page);
    await openWizard(page);

    await page.locator('[data-product-type="standard"]').click();
    await page.fill('input#price', '100');
    await page.locator('#price_includes_vat').uncheck();
    await expect(page.locator('input#vat_rate')).toBeVisible();

    await closeWizard(page);
  });

  test('Publikuj with an invalid content URL jumps to the field and focuses it', async ({ page }) => {
    await goToProducts(page);
    await openWizard(page);

    await page.locator('[data-product-type="lead-magnet"]').click();
    await page.fill('input#name', `Bad Url ${Date.now()}`);
    await fillDescription(page, 'desc');
    await openFormSection(page, SECTION_TITLES.delivery.title);
    await page.getByRole('button', { name: /Dodaj element treści/i }).click();
    const url = page.locator('input#content_url_0');
    await url.fill('https://example.com/not-a-video');
    await openFormSection(page, SECTION_TITLES.basics.title);
    await page.getByRole('button', { name: /Publikuj/i }).click();

    await expectSection(page, SECTION_TITLES.delivery.title);

    await expect(url).toBeFocused();
    await expect(url).toHaveAttribute('aria-invalid', 'true');

    await closeWizard(page);
  });
});

// The wizard seeds taxMode + vat_rate defaults from an async shop-config
// fetch (getMyShopConfig, in useProductForm). Advancing or submitting before
// that fetch settles would act on placeholder values (taxMode='local',
// vat_rate=null) — wrongly blocking a valid product, or (in edit mode, where
// no DB trigger back-fills vat_rate) silently saving vat_rate=null. These
// tests force the race with a delayed server action and assert the wizard
// waits instead of racing ahead.
async function holdShopSettings(page: Page): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/pl/dashboard/products*', async route => {
    if (route.request().method() === 'POST') await gate;
    await route.continue();
  });
  return release;
}

test.describe('Shop config loading race', () => {
  test('"Dalej" stays disabled while shop settings load, then advances once they do', async ({ page }) => {
    await goToProducts(page);

    const releaseSettings = await holdShopSettings(page);
    try {

      await openWizard(page);
      await page.fill('input#name', `Race Continue ${Date.now()}`);
      await page.locator('[data-product-type="tip-jar"]').click();

      const continueBtn = page.getByRole('dialog').getByRole('button', { name: /Dalej/i });
      await expect(continueBtn).toBeDisabled();

      releaseSettings();
      await expect(continueBtn).toBeEnabled({ timeout: 10000 });
      await continueBtn.click();

      // Leaves the basics — it didn't get stuck on a stale-vat_rate basics error.
      await expectSection(page, SECTION_TITLES.delivery.title);

      // Close without saving
      await page.locator('button[aria-label="Close modal"], button[aria-label="Zamknij okno"]').click();
      const exitModal = page.getByText(/Odrzucić zmiany/i);
      if (await exitModal.isVisible({ timeout: 2000 }).catch(() => false)) {
        await page.getByRole('button', { name: /Odrzuć/i }).click();
      }
    } finally { releaseSettings(); }
  });

  test('"Publikuj" stays disabled while shop settings load, then publishes with the shop\'s default VAT rate', async ({ page }) => {
    await goToProducts(page);

    const releaseSettings = await holdShopSettings(page);
    try {

      await openWizard(page);
      const uniqueSuffix = Date.now();
      const productName = `Race Publish ${uniqueSuffix}`;
      const slug = `race-publish-${uniqueSuffix}`;
      createdProductSlugs.push(slug);

      await page.fill('input#name', productName);
      await page.fill('input#price', '49,99');

      const publishBtn = page.getByRole('button', { name: /Publikuj/i });
      await expect(publishBtn).toBeDisabled();

      releaseSettings();
      await expect(publishBtn).toBeEnabled({ timeout: 10000 });
      await publishBtn.click();

      // Closes and creates the product — it didn't submit with vat_rate still null.
      await expect(page.getByText('Utwórz nowy produkt')).not.toBeVisible({ timeout: 10000 });

      const { data } = await supabaseAdmin.from('products').select('vat_rate').eq('slug', slug).single();
      expect(data?.vat_rate).toBe(23); // seeded shop default (tax_rate=0.23) in supabase/seed.sql
    } finally { releaseSettings(); }
  });
});

test.describe('Section layout', () => {
  test('lists the sections by what the seller sets, each saying what it changes for the buyer', async ({ page }) => {
    await goToProducts(page);
    await openWizard(page);

    const nav = page.getByRole('dialog').getByRole('navigation', { name: SECTION_TITLES.nav });
    const order = ['basics', 'delivery', 'cart', 'schedule', 'offer', 'sales'] as const;
    await expect(nav.getByRole('button')).toHaveText(order.map(id => SECTION_TITLES[id].title));

    for (const id of order) {
      await openFormSection(page, SECTION_TITLES[id].title);
      const section = page.locator(`[data-form-section="${id}"]`);
      await expect(section.getByRole('heading', { level: 3 })).toHaveText(SECTION_TITLES[id].title);
      await expect(section.getByText(SECTION_TITLES[id].effect)).toBeVisible();
    }

    // Checkout settings sit in "Dane w koszyku"; the offer "Format" points there.
    await openFormSection(page, SECTION_TITLES.cart.title);
    await expect(page.getByLabel('Własny koszyk dla tego produktu')).toBeVisible();
    await openFormSection(page, SECTION_TITLES.offer.title);
    await expect(page.getByText(pl.admin.products.form.marketing.formatHint)).toBeVisible();

    // Status, visibility and embed are in the sales section without expanding anything.
    await openFormSection(page, SECTION_TITLES.sales.title);
    await expect(page.locator('input#is_active')).toBeVisible();
    await expect(page.getByText(/Pozwól osadzić/i)).toBeVisible();

    // Close
    await page.locator('button[aria-label="Close modal"], button[aria-label="Zamknij okno"]').click();
    const exitModal = page.getByText(/Odrzucić zmiany/i);
    if (await exitModal.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByRole('button', { name: /Odrzuć/i }).click();
    }
  });
});

test.describe('Edit mode uses wizard', () => {

  let editProductId: string;
  const editSlug = `edit-mode-test-${Date.now()}`;

  test.beforeAll(async () => {
    // Create a product to edit
    const { data, error } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Edit Mode Test Product',
        slug: editSlug,
        price: 50,
        currency: 'PLN',
        description: 'Product for edit mode test',
        is_active: true,
        icon: '📦',
        vat_rate: 23,
        price_includes_vat: true,
      })
      .select()
      .single();

    if (error) throw error;
    editProductId = data.id;
    createdProductSlugs.push(editSlug);
  });

  test('should open wizard with pre-filled data when editing a product', async ({ page }) => {
    await goToProducts(page);

    // Edit is a primary action button in each row (pencil icon, title="Edytuj").
    const productRow = page.locator('tr, [data-product-id]').filter({ hasText: 'Edit Mode Test Product' });
    await expect(productRow).toBeVisible({ timeout: 15000 });

    const editButton = productRow.locator('button[title*="Edytuj"], button[title*="Edit"]').first();
    await expect(editButton).toBeVisible({ timeout: 15000 });
    await editButton.click();

    // Should show "Edytuj produkt" in wizard header (edit mode)
    await expect(page.getByText('Edytuj produkt')).toBeVisible({ timeout: 5000 });

    // Same section list in edit mode
    await expectSection(page, SECTION_TITLES.basics.title);

    // "Update product" button stays in edit mode (publishing semantics unchanged)
    await expect(page.getByRole('button', { name: /Aktualizuj produkt/i })).toBeVisible();

    // Form should be pre-filled with existing data
    const nameValue = await page.inputValue('input#name');
    expect(nameValue).toBe('Edit Mode Test Product');

    // Description is in the offer section — verify it's prefilled
    await openFormSection(page, SECTION_TITLES.offer.title);
    const descValue = await page.inputValue('textarea#description');
    expect(descValue).toBe('Product for edit mode test');

    // Close modal
    await page.locator('button[aria-label="Close modal"], button[aria-label="Zamknij okno"]').click();
    const exitModal = page.getByText(/Odrzucić zmiany/i);
    if (await exitModal.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByRole('button', { name: /Odrzuć/i }).click();
    }
  });

  test('should navigate sections in edit mode', async ({ page }) => {
    await goToProducts(page);

    const productRow = page.locator('tr, [data-product-id]').filter({ hasText: 'Edit Mode Test Product' });
    await expect(productRow).toBeVisible({ timeout: 15000 });

    const editButton = productRow.locator('button[title*="Edytuj"], button[title*="Edit"]').first();
    await expect(editButton).toBeVisible({ timeout: 15000 });
    await editButton.click();

    await expect(page.getByText('Edytuj produkt')).toBeVisible({ timeout: 5000 });

    await page.getByRole('dialog').getByRole('button', { name: /Dalej/i }).click();
    await expectSection(page, SECTION_TITLES.delivery.title);

    await page.getByRole('dialog').getByRole('button', { name: /Dalej/i }).click();
    await expectSection(page, SECTION_TITLES.cart.title);

    // "Update product" button should be visible in every section
    await expect(page.getByRole('button', { name: /Aktualizuj produkt/i })).toBeVisible();

    // Go back and close
    await page.getByRole('button', { name: /Wstecz/i }).click();
    await page.getByRole('button', { name: /Wstecz/i }).click();
    await page.locator('button[aria-label="Close modal"], button[aria-label="Zamknij okno"]').click();
    const exitModal = page.getByText(/Odrzucić zmiany/i);
    if (await exitModal.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByRole('button', { name: /Odrzuć/i }).click();
    }
  });
});

test.describe('Duplicate mode uses wizard', () => {

  let sourceProductId: string;
  const sourceSlug = `dup-source-${Date.now()}`;

  test.beforeAll(async () => {
    const { data, error } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Duplicate Source Product',
        slug: sourceSlug,
        price: 75,
        currency: 'PLN',
        description: 'Source product for duplicate test',
        is_active: true,
        icon: '🎯',
        vat_rate: 23,
        price_includes_vat: true,
      })
      .select()
      .single();

    if (error) throw error;
    sourceProductId = data.id;
    createdProductSlugs.push(sourceSlug);
  });

  test('should open wizard with pre-filled data when duplicating', async ({ page }) => {
    await goToProducts(page);

    // Find the product row
    const productRow = page.locator('tr, [data-product-id]').filter({ hasText: 'Duplicate Source Product' });

    // Try to find duplicate button
    const dupButton = productRow.locator('button[title*="Duplikuj"], button[title*="Duplicate"]').first();

    if (await dupButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await dupButton.click();
    } else {
      // Try 3-dot menu
      const menuButton = productRow.locator('button').last();
      await menuButton.click();
      await page.waitForTimeout(300);
      const dupOption = page.locator('button, a, [role="menuitem"]').filter({ hasText: /Duplikuj|Duplicate/i }).first();
      await dupOption.click();
    }

    // Should show wizard (create mode) because duplicate has empty ID
    await expect(page.getByText('Utwórz nowy produkt')).toBeVisible({ timeout: 5000 });

    // Name should be pre-filled with [COPY] prefix
    const nameValue = await page.inputValue('input#name');
    expect(nameValue).toContain('[COPY]');
    expect(nameValue).toContain('Duplicate Source Product');

    // Close wizard
    await page.getByRole('button', { name: /Anuluj/i }).click();
    // Exit confirmation (form is dirty from pre-fill)
    const exitModal = page.getByText(/Odrzucić zmiany/i);
    if (await exitModal.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByRole('button', { name: /Odrzuć/i }).click();
    }
  });
});
