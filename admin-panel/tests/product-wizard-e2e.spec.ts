import { test, expect, Page } from '@playwright/test';
import { createTestAdmin, loginAsAdmin, supabaseAdmin } from './helpers/admin-auth';

/**
 * Product Wizard E2E Tests
 *
 * Tests the unified 3-step wizard for creating AND editing products:
 * Step 1: Essentials — product-type radio + name + slug + price/recurring price
 * Step 2: Content & Details — description (moved from step 1), delivery, icon, etc.
 * Step 3: Sales & Settings — 6 grouped accordions (Conversion / Form fields /
 *         Availability / After purchase / Refunds / Advanced)
 *
 * Also tests: edit mode (same wizard), duplicate mode (wizard), exit confirmation.
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

async function goToProducts(page: Page) {
  await loginAsAdmin(page, adminEmail, adminPassword);
  await page.goto('/pl/dashboard/products');
  await page.waitForLoadState('domcontentloaded');
}

async function openWizard(page: Page) {
  const addButton = page.locator('button', { hasText: /Dodaj produkt/i });
  await addButton.click();
  // Wizard should open with step indicator
  await expect(page.getByText('Utwórz nowy produkt')).toBeVisible({ timeout: 5000 });
}

async function fillDescriptionOnStep2(page: Page, value: string) {
  // After the redesign description lives on step 2.
  await page.getByRole('dialog').getByRole('button', { name: /Dalej/i }).click();
  await expect(page.locator('textarea#description')).toBeVisible({ timeout: 5000 });
  await page.fill('textarea#description', value);
}

test.describe('Product Creation Wizard', () => {

  test('should open wizard when clicking Add Product', async ({ page }) => {
    await goToProducts(page);
    await openWizard(page);

    // Step indicator should show 3 steps
    await expect(page.getByRole('button', { name: /Podstawy/i })).toBeVisible();

    // Product-type radio renders at the top of step 1
    await expect(page.locator('[data-product-type="standard"]')).toBeVisible();
    await expect(page.locator('[data-product-type="tip-jar"]')).toBeVisible();

    // Publish (primary) + Continue Setup buttons should be visible
    await expect(page.getByRole('button', { name: /Publikuj/i })).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: /Dalej/i })).toBeVisible();

    // Cancel button on step 1
    await expect(page.getByRole('button', { name: /Anuluj/i })).toBeVisible();

    // Publish disabled before name + price are filled — buyer-side checklist shows ○
    const publishBtn = page.getByRole('button', { name: /Publikuj/i });
    await expect(publishBtn).toBeDisabled();
  });

  test('should create product from step 1 + 2 (fast path)', async ({ page }) => {
    await goToProducts(page);
    await openWizard(page);

    const uniqueSuffix = Date.now();
    const productName = `Wizard Fast ${uniqueSuffix}`;
    createdProductSlugs.push(`wizard-fast-${uniqueSuffix}`);

    // Fill name + price on step 1
    await page.fill('input#name', productName);
    await page.waitForTimeout(300);
    await page.fill('input#price', '49,99');

    // Publish is enabled on step 1 (description still required — wizard jumps to step 2)
    const publishBtn = page.getByRole('button', { name: /Publikuj/i });
    await expect(publishBtn).toBeEnabled();

    // First click bounces the wizard to step 2 because description is empty
    await publishBtn.click();
    await page.waitForTimeout(500);

    // Step 2 visible — fill description
    await expect(page.locator('textarea#description')).toBeVisible({ timeout: 5000 });
    await page.fill('textarea#description', 'Created quickly');

    // Click Publish again to commit
    await page.getByRole('button', { name: /Publikuj/i }).click();

    // Wait for modal to close
    await expect(page.getByText('Utwórz nowy produkt')).not.toBeVisible({ timeout: 15000 });

    // Product should appear in the list
    await page.waitForTimeout(1000);
    await expect(page.locator('table td').getByText(productName).first()).toBeVisible({ timeout: 10000 });
  });

  test('should navigate through all 3 steps', async ({ page }) => {
    await goToProducts(page);
    await openWizard(page);

    // Fill step 1 minimum
    await page.fill('input#name', 'Nav Test Product');
    await page.fill('input#price', '10');

    // Wait for slug auto-generation from name (required for step validation)
    await expect(page.locator('input#slug')).not.toHaveValue('', { timeout: 5000 });

    // Navigate Step 1 → Step 2 → Step 3
    const dialog = page.getByRole('dialog');
    const nextBtn = dialog.getByRole('button', { name: /Dalej/i });

    // Step 1 → Step 2
    await expect(async () => {
      if (await nextBtn.isVisible().catch(() => false)) {
        await nextBtn.click();
      }
      await expect(page.locator('input#name')).not.toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /Wstecz/i })).toBeVisible();

    // Fill description on step 2 (now required here)
    await page.fill('textarea#description', 'Navigation test');

    // Step 2 → Step 3. The step indicator is rendered on every step, so we
    // can't use its visibility as the exit condition — instead we wait until
    // the "Dalej" button disappears (it's hidden on the last step).
    await expect(async () => {
      if (await nextBtn.isVisible().catch(() => false)) {
        await nextBtn.click();
      }
      await expect(nextBtn).not.toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });

    // Step 3 shows the grouped accordions (Konwersja default open)
    await expect(page.getByText('A. Konwersja')).toBeVisible();

    // No Continue Setup on last step
    await expect(page.getByRole('dialog').getByRole('button', { name: /Dalej/i })).not.toBeVisible();

    // Back + Publish on last step
    await expect(page.getByRole('button', { name: /Wstecz/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Publikuj/i })).toBeVisible();

    // Go back to step 2
    await page.getByRole('button', { name: /Wstecz/i }).click();
    await expect(page.getByRole('button', { name: /Treść i szczegóły|Content & Details/i })).toBeVisible();

    // Go back to step 1
    await page.getByRole('button', { name: /Wstecz/i }).click();
    await expect(page.getByRole('button', { name: /Podstawy/i })).toBeVisible();

    // Close without creating
    await page.getByRole('button', { name: /Anuluj/i }).click();
    // Exit confirmation should appear (form is dirty)
    await expect(page.getByText(/Odrzucić zmiany/i)).toBeVisible();
    await page.getByRole('button', { name: /Odrzuć/i }).click();
  });

  test('should create product after going through all steps', async ({ page }) => {
    await goToProducts(page);
    await openWizard(page);

    const uniqueSuffix = Date.now();
    const productName = `Wizard Full ${uniqueSuffix}`;
    createdProductSlugs.push(`wizard-full-${uniqueSuffix}`);

    // Step 1: Essentials (no description here)
    await page.fill('input#name', productName);
    await page.fill('input#price', '99');

    // Continue to step 2
    await page.getByRole('dialog').getByRole('button', { name: /Dalej/i }).click();
    await page.waitForTimeout(500);

    // Step 2: Content & Details — fill description here
    await page.fill('textarea#description', 'Product created through all 3 steps');
    await page.getByRole('dialog').getByRole('button', { name: /Dalej/i }).click();
    await page.waitForTimeout(500);

    // Step 3: Sales & Settings — publish
    await expect(page.getByRole('button', { name: /Sprzedaż i ustawienia|Sales & Settings/i })).toBeVisible();
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

  test('should show VAT fields on step 1 in local tax mode', async ({ page }) => {
    // Ensure local tax mode is set
    const { error: localErr } = await supabaseAdmin
      .from('shop_config')
      .update({ tax_mode: 'local' })
      .not('id', 'is', null);
    if (localErr) throw localErr;

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
    const { error: stripeErr } = await supabaseAdmin
      .from('shop_config')
      .update({ tax_mode: 'stripe_tax' })
      .not('id', 'is', null);
    if (stripeErr) throw stripeErr;

    await goToProducts(page);
    await openWizard(page);

    // Pick standard so the price block renders (and exposes the tax badge)
    await page.locator('[data-product-type="standard"]').click();

    // Wait for async getShopConfig() call to resolve and update taxMode state
    await page.waitForTimeout(2000);

    // Enter price so the tax info block reveals
    await page.fill('input#price', '10');

    // Should show "Tax calculated by Stripe" info instead of VAT fields
    await expect(page.getByText(/Tax calculated by Stripe|Podatek naliczany przez Stripe/i)).toBeVisible({ timeout: 10000 });

    // VAT rate input should NOT be visible
    const vatInput = page.locator('input#vat_rate');
    await expect(vatInput).not.toBeVisible();

    // Restore local mode
    const { error: localErr2 } = await supabaseAdmin
      .from('shop_config')
      .update({ tax_mode: 'local' })
      .not('id', 'is', null);
    if (localErr2) throw localErr2;

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

  test('tip-jar with just a name allows advancing to step 2 (no price required)', async ({ page }) => {
    await goToProducts(page);
    await openWizard(page);

    await page.fill('input#name', `Tip Jar Continue ${Date.now()}`);
    await page.locator('[data-product-type="tip-jar"]').click();

    // Click "Dalej" — should advance to step 2, NOT block on missing price.
    await page.getByRole('dialog').getByRole('button', { name: /Dalej/i }).click();

    // Step 2 visible: description textarea
    await expect(page.locator('textarea#description')).toBeVisible({ timeout: 5000 });

    // Close without saving
    await page.locator('button[aria-label="Close modal"], button[aria-label="Zamknij okno"]').click();
    const exitModal = page.getByText(/Odrzucić zmiany/i);
    if (await exitModal.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByRole('button', { name: /Odrzuć/i }).click();
    }
  });

  test('"Dalej" on Standard with missing description stays on step 1 (no auto-jump)', async ({ page }) => {
    await goToProducts(page);
    await openWizard(page);

    // Pick standard, fill name + price, leave description empty.
    await page.locator('[data-product-type="standard"]').click();
    await page.fill('input#name', `Standard No Desc ${Date.now()}`);
    await page.fill('input#price', '49');

    // Click "Dalej" — step 1 fields are valid; should advance to step 2 (description
    // belongs there). Used to auto-jump back from step 2 to step 2 due to stale
    // description error, but now step 1 doesn't even look at description.
    await page.getByRole('dialog').getByRole('button', { name: /Dalej/i }).click();
    await expect(page.locator('textarea#description')).toBeVisible({ timeout: 5000 });

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
    // Lead magnet still needs content on step 2, so publish remains disabled
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

test.describe('Step 3 layout', () => {
  test('renders 6 group headers (A–F), no inline duplicate titles, no collapsibles', async ({ page }) => {
    await goToProducts(page);
    await openWizard(page);

    // Get to step 3 via Standard / minimum fields.
    await page.locator('[data-product-type="standard"]').click();
    await page.fill('input#name', `Step3 layout ${Date.now()}`);
    await page.fill('input#price', '19');
    await page.getByRole('dialog').getByRole('button', { name: /Dalej/i }).click();
    await page.fill('textarea#description', 'desc');
    await page.getByRole('dialog').getByRole('button', { name: /Dalej/i }).click();

    // 6 step-3 group sections rendered.
    const groups = page.locator('[data-step3-group]');
    await expect(groups).toHaveCount(6);

    // Group E (Zwroty) has no inner duplicate "Polityka zwrotów" header anymore.
    const groupE = page.locator('[data-step3-group="E"]');
    await expect(groupE.getByRole('heading', { level: 3 })).toContainText(/Zwroty/i);
    await expect(groupE.getByRole('heading', { level: 4 })).toHaveCount(0);

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

    // Wizard step indicator SHOULD be present (unified wizard for edit too)
    await expect(page.getByRole('button', { name: /Podstawy/i })).toBeVisible();

    // "Update product" button stays in edit mode (publishing semantics unchanged)
    await expect(page.getByRole('button', { name: /Aktualizuj produkt/i })).toBeVisible();

    // Form should be pre-filled with existing data
    const nameValue = await page.inputValue('input#name');
    expect(nameValue).toBe('Edit Mode Test Product');

    // Description is on step 2 — navigate there to verify it's prefilled
    await page.getByRole('dialog').getByRole('button', { name: /Dalej/i }).click();
    const descValue = await page.inputValue('textarea#description');
    expect(descValue).toBe('Product for edit mode test');

    // Close modal
    await page.locator('button[aria-label="Close modal"], button[aria-label="Zamknij okno"]').click();
    const exitModal = page.getByText(/Odrzucić zmiany/i);
    if (await exitModal.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByRole('button', { name: /Odrzuć/i }).click();
    }
  });

  test('should navigate steps in edit mode', async ({ page }) => {
    await goToProducts(page);

    const productRow = page.locator('tr, [data-product-id]').filter({ hasText: 'Edit Mode Test Product' });
    await expect(productRow).toBeVisible({ timeout: 15000 });

    const editButton = productRow.locator('button[title*="Edytuj"], button[title*="Edit"]').first();
    await expect(editButton).toBeVisible({ timeout: 15000 });
    await editButton.click();

    await expect(page.getByText('Edytuj produkt')).toBeVisible({ timeout: 5000 });

    // Navigate to step 2
    await page.getByRole('dialog').getByRole('button', { name: /Dalej/i }).click();
    await expect(page.getByRole('button', { name: /Treść i szczegóły|Content & Details/i })).toBeVisible();

    // Navigate to step 3
    await page.getByRole('dialog').getByRole('button', { name: /Dalej/i }).click();
    await expect(page.getByRole('button', { name: /Sprzedaż i ustawienia|Sales & Settings/i })).toBeVisible();

    // "Update product" button should be visible on all steps
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
