import { test, expect, Page } from '@playwright/test';
import { createTestAdmin, loginAsAdmin, supabaseAdmin } from './helpers/admin-auth';

/**
 * Video Options UI Tests
 *
 * Tests the ContentDeliverySection in the product wizard (Step 2):
 * - Adding/removing content items
 * - URL validation with platform detection
 * - Video options panel (autoplay, loop, muted, controls)
 * - Custom player toggle (YouTube-only)
 * - Tooltips on video option checkboxes
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);

let adminEmail: string;
let adminPassword: string;
let adminCleanup: () => Promise<void>;
const createdProductSlugs: string[] = [];

test.beforeAll(async () => {
  const admin = await createTestAdmin('video-opts');
  adminEmail = admin.email;
  adminPassword = admin.password;
  adminCleanup = admin.cleanup;
});

test.afterAll(async () => {
  for (const slug of createdProductSlugs) {
    await supabaseAdmin.from('products').delete().eq('slug', slug);
  }
  await adminCleanup();
});

// ── Helpers ────────────────────────────────────────────────────────────────────

async function goToProducts(page: Page) {
  await loginAsAdmin(page, adminEmail, adminPassword);
  await page.goto('/pl/dashboard/products');
  await page.waitForLoadState('domcontentloaded');
  // Ensure products table is loaded before interacting
  await expect(page.locator('button', { hasText: /Dodaj produkt/i })).toBeVisible({ timeout: 15000 });
}

async function openWizardAndGoToStep2(page: Page, productName: string) {
  // Open wizard — wait for page to be fully interactive first
  const addBtn = page.locator('button', { hasText: /Dodaj produkt/i });
  await expect(addBtn).toBeEnabled({ timeout: 10000 });
  await addBtn.click();
  await expect(page.getByText('Utwórz nowy produkt')).toBeVisible({ timeout: 15000 });

  // Fill step 1 minimum (description moved to step 2)
  const dlg = page.getByRole('dialog');
  await dlg.locator('input#name').fill(productName);
  await dlg.locator('input#price').fill('10');

  // Wait for slug auto-generation from name (required for step 1 validation)
  await expect(dlg.locator('input#slug')).not.toHaveValue('', { timeout: 10000 });

  // Navigate to step 2 and fill description there
  await dlg.getByRole('button', { name: /Dalej/i }).click();
  await dlg.locator('textarea#description').fill('Video options test');

  // Wait for step 2 content delivery section to render
  // If validation failed and step didn't advance, retry the click
  const contentSection = dlg.getByText(/Dostarczanie treści/i);
  try {
    await expect(contentSection).toBeVisible({ timeout: 10000 });
  } catch {
    // Step might not have advanced — retry click
    await dlg.getByRole('button', { name: /Dalej/i }).click();
    await expect(contentSection).toBeVisible({ timeout: 15000 });
  }
}

/** Scope all locators within the wizard dialog */
function dialog(page: Page) {
  return page.getByRole('dialog');
}

/** Get URL input within a content item (scoped to avoid matching other inputs) */
function contentItemUrlInput(page: Page, index = 0) {
  return dialog(page).locator('[data-testid="content-item"]').nth(index).getByPlaceholder('URL');
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test.describe('Video Options UI', () => {

  test('content delivery section is visible on step 2 with default "content" type', async ({ page }) => {
    await goToProducts(page);
    await openWizardAndGoToStep2(page, `VO Default ${Date.now()}`);

    // Content delivery section should be visible
    await expect(dialog(page).getByText(/Dostarczanie treści/i)).toBeVisible({ timeout: 10000 });

    // Default delivery type is "content"
    const deliverySelect = dialog(page).locator('select').filter({ has: page.locator('option', { hasText: /Przekierowanie/i }) });
    await expect(deliverySelect).toHaveValue('content', { timeout: 5000 });

    // "Add content item" button visible
    await expect(dialog(page).getByRole('button', { name: /Dodaj element treści/i })).toBeVisible({ timeout: 5000 });

    // Close wizard
    await page.getByRole('button', { name: /Wstecz/i }).click();
    await page.getByRole('button', { name: /Anuluj/i }).click();
    await page.getByRole('button', { name: /Odrzuć/i }).click();
  });

  test('switching to redirect mode shows URL input', async ({ page }) => {
    await goToProducts(page);
    await openWizardAndGoToStep2(page, `VO Redirect ${Date.now()}`);

    // Switch to redirect — locate select by option text
    const deliverySelect = dialog(page).locator('select').filter({ has: page.locator('option', { hasText: /Przekierowanie/i }) });
    await expect(deliverySelect).toBeVisible({ timeout: 5000 });
    await deliverySelect.selectOption('redirect');
    // Verify selection took effect
    await expect(deliverySelect).toHaveValue('redirect', { timeout: 5000 });

    // Redirect URL field visible (unique placeholder)
    await expect(dialog(page).getByPlaceholder('https://example.com/your-content')).toBeVisible({ timeout: 10000 });

    // Content items and add button should be hidden
    await expect(dialog(page).getByRole('button', { name: /Dodaj element treści/i })).not.toBeVisible({ timeout: 5000 });

    // Close wizard
    await page.getByRole('button', { name: /Wstecz/i }).click();
    await page.getByRole('button', { name: /Anuluj/i }).click();
    await page.getByRole('button', { name: /Odrzuć/i }).click();
  });

  test('add and remove content items', async ({ page }) => {
    await goToProducts(page);
    await openWizardAndGoToStep2(page, `VO Items ${Date.now()}`);

    const addButton = dialog(page).getByRole('button', { name: /Dodaj element treści/i });

    // Add first item
    await addButton.click();
    const items = dialog(page).locator('[data-testid="content-item"]');
    await expect(items).toHaveCount(1);

    // Add second item
    await addButton.click();
    await expect(items).toHaveCount(2);

    // Remove first item
    await items.first().getByRole('button', { name: /Usuń/i }).click();
    await expect(items).toHaveCount(1);

    // Close wizard
    await page.getByRole('button', { name: /Wstecz/i }).click();
    await page.getByRole('button', { name: /Anuluj/i }).click();
    await page.getByRole('button', { name: /Odrzuć/i }).click();
  });

  test('YouTube URL triggers platform detection and Playerstack options', async ({ page }) => {
    await goToProducts(page);
    await openWizardAndGoToStep2(page, `VO YouTube ${Date.now()}`);

    // Add content item
    await dialog(page).getByRole('button', { name: /Dodaj element treści/i }).click();

    // Type YouTube URL and blur to trigger validation
    const urlInput = contentItemUrlInput(page);
    await urlInput.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await urlInput.blur();

    // Wait for validation message with platform
    await expect(dialog(page).getByText(/Wykryto wideo YouTube/i)).toBeVisible({ timeout: 5000 });

    await expect(dialog(page).getByText(/Opcje wideo/i)).toBeVisible();
    await expect(dialog(page).getByText(/Własny odtwarzacz/i)).not.toBeVisible();

    // Close wizard
    await page.getByRole('button', { name: /Wstecz/i }).click();
    await page.getByRole('button', { name: /Anuluj/i }).click();
    await page.getByRole('button', { name: /Odrzuć/i }).click();
  });

  test('video options checkboxes are visible for video_embed items', async ({ page }) => {
    await goToProducts(page);
    await openWizardAndGoToStep2(page, `VO Checkboxes ${Date.now()}`);

    // Add content item and enter YouTube URL
    await dialog(page).getByRole('button', { name: /Dodaj element treści/i }).click();
    const urlInput = contentItemUrlInput(page);
    await urlInput.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await urlInput.blur();
    await expect(dialog(page).getByText(/Wykryto wideo YouTube/i)).toBeVisible({ timeout: 5000 });

    // Video options section header
    await expect(dialog(page).getByText(/Opcje wideo/i)).toBeVisible();

    // All Playerstack option checkboxes should be visible (exact match to avoid platform support text)
    const contentItem = dialog(page).locator('[data-testid="content-item"]').first();
    await expect(contentItem.getByText('Automatyczne odtwarzanie', { exact: true })).toBeVisible();
    await expect(contentItem.getByText('Pętla', { exact: true })).toBeVisible();
    await expect(contentItem.getByText('Wyciszony', { exact: true })).toBeVisible();
    await expect(contentItem.getByText('Kontrolki', { exact: true })).toBeVisible();
    await expect(contentItem.getByText('Wstępne ładowanie', { exact: true })).toHaveCount(0);

    // Controls should be checked by default (config.controls !== false)
    const controlsCheckbox = dialog(page).locator('label').filter({ hasText: 'Kontrolki' }).locator('input[type="checkbox"]');
    await expect(controlsCheckbox).toBeChecked();

    // Autoplay, loop and muted should be unchecked by default
    const autoplayCheckbox = dialog(page).locator('label').filter({ hasText: 'Automatyczne odtwarzanie' }).locator('input[type="checkbox"]');
    const loopCheckbox = dialog(page).locator('label').filter({ hasText: 'Pętla' }).locator('input[type="checkbox"]');
    const mutedCheckbox = dialog(page).locator('label').filter({ hasText: 'Wyciszony' }).locator('input[type="checkbox"]');

    await expect(autoplayCheckbox).not.toBeChecked();
    await expect(loopCheckbox).not.toBeChecked();
    await expect(mutedCheckbox).not.toBeChecked();

    // Close wizard
    await page.getByRole('button', { name: /Wstecz/i }).click();
    await page.getByRole('button', { name: /Anuluj/i }).click();
    await page.getByRole('button', { name: /Odrzuć/i }).click();
  });

  test('toggling video option checkboxes works', async ({ page }) => {
    await goToProducts(page);
    await openWizardAndGoToStep2(page, `VO Toggle ${Date.now()}`);

    // Add content item with YouTube URL
    await dialog(page).getByRole('button', { name: /Dodaj element treści/i }).click();
    const urlInput = contentItemUrlInput(page);
    await urlInput.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await urlInput.blur();
    await expect(dialog(page).getByText(/Wykryto wideo YouTube/i)).toBeVisible({ timeout: 5000 });

    // Check autoplay
    const autoplayCheckbox = dialog(page).locator('label').filter({ hasText: 'Automatyczne odtwarzanie' }).locator('input[type="checkbox"]');
    await autoplayCheckbox.check();
    await expect(autoplayCheckbox).toBeChecked();

    // Check muted
    const mutedCheckbox = dialog(page).locator('label').filter({ hasText: 'Wyciszony' }).locator('input[type="checkbox"]');
    await mutedCheckbox.check();
    await expect(mutedCheckbox).toBeChecked();

    // Uncheck controls
    const controlsCheckbox = dialog(page).locator('label').filter({ hasText: 'Kontrolki' }).locator('input[type="checkbox"]');
    await controlsCheckbox.uncheck();
    await expect(controlsCheckbox).not.toBeChecked();

    // Check loop
    const loopCheckbox = dialog(page).locator('label').filter({ hasText: 'Pętla' }).locator('input[type="checkbox"]');
    await loopCheckbox.check();
    await expect(loopCheckbox).toBeChecked();

    // Close wizard
    await page.getByRole('button', { name: /Wstecz/i }).click();
    await page.getByRole('button', { name: /Anuluj/i }).click();
    await page.getByRole('button', { name: /Odrzuć/i }).click();
  });

  test('Bunny iframe URL is rejected with validation error', async ({ page }) => {
    await goToProducts(page);
    await openWizardAndGoToStep2(page, `VO BunnyIframe ${Date.now()}`);

    await dialog(page).getByRole('button', { name: /Dodaj element treści/i }).click();
    const urlInput = contentItemUrlInput(page);
    await urlInput.fill('https://iframe.mediadelivery.net/embed/123456/a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    await urlInput.blur();

    await expect(urlInput).toHaveClass(/border-red/, { timeout: 5000 });
    await expect(dialog(page).getByText(/Iframe Bunny nie jest obsługiwany/i)).toBeVisible({ timeout: 5000 });

    // Close wizard
    await page.getByRole('button', { name: /Wstecz/i }).click();
    await page.getByRole('button', { name: /Anuluj/i }).click();
    await page.getByRole('button', { name: /Odrzuć/i }).click();
  });

  test('Playerstack options appear for Vimeo', async ({ page }) => {
    await goToProducts(page);
    await openWizardAndGoToStep2(page, `VO Vimeo ${Date.now()}`);

    // Add content item with Vimeo URL
    await dialog(page).getByRole('button', { name: /Dodaj element treści/i }).click();
    const urlInput = contentItemUrlInput(page);
    await urlInput.fill('https://vimeo.com/148751763');
    await urlInput.blur();
    await expect(dialog(page).getByText(/Wykryto wideo Vimeo/i)).toBeVisible({ timeout: 5000 });

    // Video options section should be visible
    await expect(dialog(page).getByText(/Opcje wideo/i)).toBeVisible();

    await expect(dialog(page).getByText(/Własny odtwarzacz/i)).not.toBeVisible();

    const contentItem = dialog(page).locator('[data-testid="content-item"]').first();
    await expect(contentItem.getByText('Automatyczne odtwarzanie', { exact: true })).toBeVisible();
    await expect(contentItem.getByText('Kontrolki', { exact: true })).toBeVisible();

    // Close wizard
    await page.getByRole('button', { name: /Wstecz/i }).click();
    await page.getByRole('button', { name: /Anuluj/i }).click();
    await page.getByRole('button', { name: /Odrzuć/i }).click();
  });

  test('tooltips appear on hover over video option labels', async ({ page }) => {
    await goToProducts(page);
    await openWizardAndGoToStep2(page, `VO Tooltips ${Date.now()}`);

    // Add content item with YouTube URL
    await dialog(page).getByRole('button', { name: /Dodaj element treści/i }).click();
    const urlInput = contentItemUrlInput(page);
    await urlInput.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await urlInput.blur();
    await expect(dialog(page).getByText(/Wykryto wideo YouTube/i)).toBeVisible({ timeout: 5000 });

    // Hover over autoplay label to trigger tooltip
    const autoplayLabel = dialog(page).locator('label').filter({ hasText: 'Automatyczne odtwarzanie' });
    await autoplayLabel.hover();

    // Tooltip text should appear (rendered in a portal, so check page-wide)
    await expect(page.getByText(/Zacznij odtwarzanie automatycznie/i)).toBeVisible({ timeout: 3000 });

    // Move away to dismiss tooltip
    await dialog(page).getByText(/Opcje wideo/i).hover();
    await expect(page.getByText(/Zacznij odtwarzanie automatycznie/i)).not.toBeVisible({ timeout: 3000 });

    // Hover over controls label
    const controlsLabel = dialog(page).locator('label').filter({ hasText: 'Kontrolki' });
    await controlsLabel.hover();
    await expect(page.getByText(/Pokaż kontrolki Playerstack/i)).toBeVisible({ timeout: 3000 });

    // Close wizard
    await page.getByRole('button', { name: /Wstecz/i }).click();
    await page.getByRole('button', { name: /Anuluj/i }).click();
    await page.getByRole('button', { name: /Odrzuć/i }).click();
  });

  test('platform support info text shows for YouTube', async ({ page }) => {
    await goToProducts(page);
    await openWizardAndGoToStep2(page, `VO PlatInfo ${Date.now()}`);

    // Add YouTube video
    await dialog(page).getByRole('button', { name: /Dodaj element treści/i }).click();
    const urlInput = contentItemUrlInput(page);
    await urlInput.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await urlInput.blur();
    await expect(dialog(page).getByText(/Wykryto wideo YouTube/i)).toBeVisible({ timeout: 5000 });

    // Platform support text should mention YouTube
    await expect(dialog(page).getByText(/YouTube obsługuje/i)).toBeVisible();

    // Close wizard
    await page.getByRole('button', { name: /Wstecz/i }).click();
    await page.getByRole('button', { name: /Anuluj/i }).click();
    await page.getByRole('button', { name: /Odrzuć/i }).click();
  });

  test('invalid URL shows error validation message', async ({ page }) => {
    await goToProducts(page);
    await openWizardAndGoToStep2(page, `VO Invalid ${Date.now()}`);

    // Add content item with invalid URL
    await dialog(page).getByRole('button', { name: /Dodaj element treści/i }).click();
    const urlInput = contentItemUrlInput(page);
    await urlInput.fill('https://not-a-video-platform.com/something');
    await urlInput.blur();

    // Should show error (red border or error message)
    // Wait for validation to apply the red border class
    await expect(urlInput).toHaveClass(/border-red/, { timeout: 5000 });

    // Close wizard
    await page.getByRole('button', { name: /Wstecz/i }).click();
    await page.getByRole('button', { name: /Anuluj/i }).click();
    await page.getByRole('button', { name: /Odrzuć/i }).click();
  });

  test('download_link type hides video options panel', async ({ page }) => {
    await goToProducts(page);
    await openWizardAndGoToStep2(page, `VO Download ${Date.now()}`);

    // Add content item
    await dialog(page).getByRole('button', { name: /Dodaj element treści/i }).click();

    // Change type to download_link
    const typeSelect = dialog(page).locator('[data-testid="content-item"]').first().locator('select');
    await typeSelect.selectOption('download_link');

    // Video options section should NOT be visible
    await expect(dialog(page).getByText(/Opcje wideo/i)).not.toBeVisible();

    await expect(dialog(page).getByText(/Własny odtwarzacz/i)).not.toBeVisible();

    // Close wizard
    await page.getByRole('button', { name: /Wstecz/i }).click();
    await page.getByRole('button', { name: /Anuluj/i }).click();
    await page.getByRole('button', { name: /Odrzuć/i }).click();
  });

  test('video options persist when creating product through all steps', async ({ page }) => {
    await goToProducts(page);
    const uniqueSuffix = Date.now();
    const productName = `VO Persist ${uniqueSuffix}`;
    createdProductSlugs.push(`vo-persist-${uniqueSuffix}`);

    await openWizardAndGoToStep2(page, productName);

    // Add YouTube video and configure options
    await dialog(page).getByRole('button', { name: /Dodaj element treści/i }).click();

    // Set title
    const titleInput = dialog(page).locator('[data-testid="content-item"]').first().locator('input[type="text"]').first();
    await titleInput.fill('Test Video');

    // Set URL
    const urlInput = contentItemUrlInput(page);
    await urlInput.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await urlInput.blur();
    await expect(dialog(page).getByText(/Wykryto wideo YouTube/i)).toBeVisible({ timeout: 5000 });

    // Enable autoplay and muted
    const autoplayCheckbox = dialog(page).locator('label').filter({ hasText: 'Automatyczne odtwarzanie' }).locator('input[type="checkbox"]');
    await autoplayCheckbox.check();
    const mutedCheckbox = dialog(page).locator('label').filter({ hasText: 'Wyciszony' }).locator('input[type="checkbox"]');
    await mutedCheckbox.check();

    // Go to step 3
    await page.getByRole('dialog').getByRole('button', { name: /Dalej/i }).click();
    await expect(page.getByRole('button', { name: /Sprzedaż i ustawienia|Sales & Settings/i })).toBeVisible();

    // Go back to step 2 — options should persist
    await page.getByRole('button', { name: /Wstecz/i }).click();
    await expect(page.getByRole('button', { name: /Treść i szczegóły|Content & Details/i })).toBeVisible();

    // Verify options persisted
    const autoplayAfter = dialog(page).locator('label').filter({ hasText: 'Automatyczne odtwarzanie' }).locator('input[type="checkbox"]');
    await expect(autoplayAfter).toBeChecked();
    const mutedAfter = dialog(page).locator('label').filter({ hasText: 'Wyciszony' }).locator('input[type="checkbox"]');
    await expect(mutedAfter).toBeChecked();
    const controlsAfter = dialog(page).locator('label').filter({ hasText: 'Kontrolki' }).locator('input[type="checkbox"]');
    await expect(controlsAfter).toBeChecked();

    // Publish from step 2 (Publish button always visible)
    await page.getByRole('button', { name: /Publikuj/i }).click();
    await expect(page.getByText('Utwórz nowy produkt')).not.toBeVisible({ timeout: 15000 });

    // Product should appear in list
    await expect(page.locator('table td').getByText(productName).first()).toBeVisible({ timeout: 10000 });
  });
});
