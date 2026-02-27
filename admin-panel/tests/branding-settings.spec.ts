import { test, expect, Page } from '@playwright/test';
import { acceptAllCookies } from './helpers/consent';
import { createTestAdmin, loginAsAdmin, supabaseAdmin } from './helpers/admin-auth';

/**
 * Theme Editor (BrandingSettings) E2E Tests.
 * Tests the redesigned Theme Editor with preset selector, tabbed editor,
 * import/export, and license-gated save.
 * @see components/settings/BrandingSettings.tsx
 * @see lib/actions/theme.ts
 */

test.describe('Theme Editor (Branding Settings)', () => {
  test.describe.configure({ mode: 'serial' });

  let adminEmail: string;
  let adminPassword: string;
  let cleanup: () => Promise<void>;

  test.beforeAll(async () => {
    const admin = await createTestAdmin('branding');
    adminEmail = admin.email;
    adminPassword = admin.password;
    cleanup = admin.cleanup;
  });

  test.afterAll(async () => {
    await cleanup();
  });

  async function navigateToSettings(page: Page) {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
  }

  test('Theme Editor UI loads with all sections', async ({ page }) => {
    await navigateToSettings(page);

    // Should see "Theme Presets" heading
    const presetsHeading = page.locator('h2', { hasText: /Theme Presets|Gotowe motywy/i });
    await expect(presetsHeading).toBeVisible({ timeout: 10000 });

    // Should see preset cards (at least 5 built-in)
    const presetButtons = page.locator('button').filter({ has: page.locator('p') }).filter({
      hasText: /Midnight Forge|Sunset|Ocean|Forest|Minimal Light/i,
    });
    const presetCount = await presetButtons.count();
    expect(presetCount).toBeGreaterThanOrEqual(5);

    // Should see editor tabs (Colors, Typography, Shapes)
    const colorsTab = page.locator('button', { hasText: /Colors|Kolory/i });
    const typographyTab = page.locator('button', { hasText: /Typography|Typografia/i });
    const shapesTab = page.locator('button', { hasText: /Shapes|Kształty/i });
    await expect(colorsTab).toBeVisible();
    await expect(typographyTab).toBeVisible();
    await expect(shapesTab).toBeVisible();

    // Should see theme name input (EN: "My Custom Theme", PL: "Mój motyw")
    const themeNameInput = page.locator('input[placeholder="My Custom Theme"], input[placeholder="Mój motyw"]');
    await expect(themeNameInput).toBeVisible();

    // Should see Live Preview section
    const previewHeading = page.locator('h3', { hasText: /Live Preview|Podgląd/i });
    await expect(previewHeading).toBeVisible();

    // Should see Import/Export buttons
    const importBtn = page.locator('button', { hasText: /Import/i });
    const exportBtn = page.locator('button', { hasText: /Export|Eksportuj/i });
    await expect(importBtn).toBeVisible();
    await expect(exportBtn).toBeVisible();

    // Should see license warning (no license in test env)
    const licenseWarning = page.locator('text=/License Required|Wymagana licencja/i');
    await expect(licenseWarning).toBeVisible();
  });

  test('Clicking a preset updates theme name and preview colors', async ({ page }) => {
    await navigateToSettings(page);

    // Click "Sunset" preset
    const sunsetPreset = page.locator('button').filter({ hasText: 'Sunset' });
    await sunsetPreset.click();
    await page.waitForTimeout(500);

    // Theme name input should reflect "Sunset"
    const themeNameInput = page.locator('input[placeholder="My Custom Theme"], input[placeholder="Mój motyw"]');
    await expect(themeNameInput).toBeVisible({ timeout: 5000 });
    await expect(themeNameInput).toHaveValue('Sunset', { timeout: 5000 });

    // Accent color input should reflect Sunset's accent (#FF6B35)
    const accentTextInput = page
      .locator('label', { hasText: 'Accent' })
      .first()
      .locator('..')
      .locator('input[type="text"]');
    await expect(accentTextInput).toBeVisible({ timeout: 5000 });
    const accentValue = await accentTextInput.inputValue();
    expect(accentValue).toBe('#FF6B35');

    // Unsaved changes indicator should appear
    const unsaved = page.locator('text=/unsaved|niezapisane/i');
    await expect(unsaved).toBeVisible();
  });

  test('Tab switching shows different editor fields', async ({ page }) => {
    await navigateToSettings(page);

    // Colors tab should show color fields by default
    const accentLabel = page.locator('label', { hasText: 'Accent' }).first();
    await expect(accentLabel).toBeVisible();

    // Switch to Typography tab
    const typographyTab = page.locator('button', { hasText: /Typography|Typografia/i });
    await typographyTab.click();
    await page.waitForTimeout(300);

    // Accent label should be hidden, font family should be visible
    await expect(accentLabel).toBeHidden();
    const fontFamilyLabel = page.locator('label', { hasText: /Font Family|Rodzina czcionek/i });
    await expect(fontFamilyLabel).toBeVisible();

    // Should show heading weight selector
    const headingWeight = page.locator('label', { hasText: /Heading Weight|Grubość nagłówków/i });
    await expect(headingWeight).toBeVisible();

    // Switch to Shapes tab
    const shapesTab = page.locator('button', { hasText: /Shapes|Kształty/i });
    await shapesTab.click();
    await page.waitForTimeout(300);

    // Font family should be hidden, radius should be visible
    await expect(fontFamilyLabel).toBeHidden();
    const radiusLabel = page.locator('label', { hasText: /Small Radius|Mały zaokrąglenie/i });
    await expect(radiusLabel).toBeVisible();
  });

  test('Editing a color field triggers unsaved changes', async ({ page }) => {
    await navigateToSettings(page);

    // Find the Accent text input (text input next to the color picker)
    const accentTextInput = page
      .locator('label', { hasText: 'Accent' })
      .first()
      .locator('..')
      .locator('input[type="text"]');
    await expect(accentTextInput).toBeVisible();

    // Clear and type a new color value
    await accentTextInput.fill('#FF0000');
    await page.waitForTimeout(300);

    // Should show unsaved changes
    const unsaved = page.locator('text=/unsaved|niezapisane/i');
    await expect(unsaved).toBeVisible();

    // The value should be what we typed
    const newValue = await accentTextInput.inputValue();
    expect(newValue).toBe('#FF0000');
  });

  test('Import valid theme JSON updates editor', async ({ page }) => {
    await navigateToSettings(page);

    const testTheme = JSON.stringify({
      name: 'Test Import Theme',
      version: '1.0',
      colors: {
        accent: '#FF0000',
        'accent-hover': '#CC0000',
        'accent-soft': 'rgba(255,0,0,0.08)',
        'bg-deep': '#111111',
        'text-heading': '#FFFFFF',
      },
    });

    // Set up file chooser for import
    const fileInput = page.locator('input[type="file"][accept=".json"]');
    await fileInput.setInputFiles({
      name: 'test-theme.json',
      mimeType: 'application/json',
      buffer: Buffer.from(testTheme),
    });

    await page.waitForTimeout(1000);

    // Theme name should update to imported name
    const themeNameInput = page.locator('input[placeholder="My Custom Theme"], input[placeholder="Mój motyw"]');
    const value = await themeNameInput.inputValue();
    expect(value).toBe('Test Import Theme');

    // Should show success toast
    const toast = page.locator('text=/imported|zaimportowany/i');
    await expect(toast).toBeVisible({ timeout: 5000 });
  });

  test('Import invalid JSON shows error', async ({ page }) => {
    await navigateToSettings(page);

    const invalidJson = 'this is not valid json {{{';

    const fileInput = page.locator('input[type="file"][accept=".json"]');
    await fileInput.setInputFiles({
      name: 'bad-theme.json',
      mimeType: 'application/json',
      buffer: Buffer.from(invalidJson),
    });

    await page.waitForTimeout(1000);

    // Should show error toast
    const toast = page.locator('text=/Invalid|Nieprawidłowy/i');
    await expect(toast).toBeVisible({ timeout: 5000 });
  });

  test('Import valid JSON with wrong schema shows error', async ({ page }) => {
    await navigateToSettings(page);

    // Valid JSON but missing required fields (name, colors.accent, etc.)
    const wrongSchema = JSON.stringify({ foo: 'bar', notATheme: true });

    const fileInput = page.locator('input[type="file"][accept=".json"]');
    await fileInput.setInputFiles({
      name: 'wrong-schema.json',
      mimeType: 'application/json',
      buffer: Buffer.from(wrongSchema),
    });

    await page.waitForTimeout(1000);

    // Should show error toast (same "Invalid" message from Zod validation failure)
    const toast = page.locator('text=/Invalid|Nieprawidłowy/i');
    await expect(toast).toBeVisible({ timeout: 5000 });
  });

  test('Export downloads a valid JSON file', async ({ page }) => {
    await navigateToSettings(page);

    // Select a known preset first so we know expected content
    const sunsetPreset = page.locator('button').filter({ hasText: 'Sunset' });
    await sunsetPreset.click();
    await page.waitForTimeout(500);

    // Set up download listener
    const downloadPromise = page.waitForEvent('download', { timeout: 5000 });

    const exportBtn = page.locator('button', { hasText: /Export|Eksportuj/i });
    await exportBtn.click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.json$/);
    expect(download.suggestedFilename()).toContain('sunset');

    // Read and validate the downloaded content
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const fs = await import('fs');
    const content = fs.readFileSync(filePath!, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.name).toBe('Sunset');
    expect(parsed.colors).toBeDefined();
    expect(parsed.colors.accent).toBe('#FF6B35');
  });

  test('Save button is disabled without license', async ({ page }) => {
    await navigateToSettings(page);

    // Select a preset to create "unsaved changes"
    const sunsetPreset = page.locator('button').filter({ hasText: 'Sunset' });
    await sunsetPreset.click();
    await page.waitForTimeout(500);

    // Save button should be disabled (no license in test env)
    const saveButton = page.locator('button', { hasText: /Save Theme|Zapisz motyw/i });
    await expect(saveButton).toBeDisabled();
  });

  test('Non-admin users cannot access settings', async ({ page }) => {
    // Create regular (non-admin) user
    const regularEmail = `test-regular-${Date.now()}@example.com`;
    const regularPassword = 'password123';
    let regularUserId: string | undefined;

    try {
      const { data: { user: regularUser } } = await supabaseAdmin.auth.admin.createUser({
        email: regularEmail,
        password: regularPassword,
        email_confirm: true,
      });
      regularUserId = regularUser?.id;

      await acceptAllCookies(page);
      await page.goto('/');

      await page.evaluate(async ({ email, password, supabaseUrl, anonKey }) => {
        // @ts-ignore
        const { createBrowserClient } = await import('https://esm.sh/@supabase/ssr@0.5.2');
        const supabase = createBrowserClient(supabaseUrl, anonKey);
        await supabase.auth.signInWithPassword({ email, password });
      }, {
        email: regularEmail,
        password: regularPassword,
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
        anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
      });

      await page.waitForTimeout(1000);
      await page.goto('/dashboard/settings');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Should NOT see theme presets OR should be redirected
      const url = page.url();
      const hasThemeSection = await page.locator('text=/Theme Presets|Gotowe motywy/i').count();
      if (url.includes('/dashboard/settings')) {
        expect(hasThemeSection).toBe(0);
      } else {
        expect(url).not.toContain('/dashboard/settings');
      }
    } finally {
      // Cleanup always runs, even on test failure
      if (regularUserId) {
        await supabaseAdmin.auth.admin.deleteUser(regularUserId);
      }
    }
  });
});
