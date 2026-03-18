'use server';

/**
 * Server actions for theme management.
 * Active theme is stored as data/active-theme.json (file-based, no DB).
 * @see lib/themes/index.ts for types and presets
 */

import { promises as fs } from 'fs';
import path from 'path';
import { revalidatePath } from 'next/cache';
import { themeConfigSchema, THEME_PRESETS, getPresetById } from '@/lib/themes';
import { withAdminOrSellerAuth } from '@/lib/actions/admin-auth';
import { validateLicense } from '@/lib/license/verify';
import { hasFeature } from '@/lib/license/features';
import { isDemoMode } from '@/lib/demo-guard';
import type { ActionResponse } from '@/lib/actions/admin-auth';
import type { SellerDataClient } from '@/lib/supabase/admin';
import type { ThemeConfig, ThemePreset } from '@/lib/themes';

const DATA_DIR = path.join(process.cwd(), 'data');
const ACTIVE_THEME_PATH = path.join(DATA_DIR, 'active-theme.json');

// ===== READ =====

export async function getActiveTheme(): Promise<ThemeConfig | null> {
  try {
    const raw = await fs.readFile(ACTIVE_THEME_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const result = themeConfigSchema.safeParse(parsed);
    if (!result.success) {
      console.error('[getActiveTheme] Invalid theme file:', result.error.message);
      return null;
    }
    return result.data;
  } catch {
    // File doesn't exist or is unreadable — no active theme
    return null;
  }
}

// ===== WRITE =====

export async function saveActiveTheme(theme: ThemeConfig): Promise<ActionResponse<void>> {
  return withAdminOrSellerAuth(async ({ dataClient }) => {
    const licenseCheck = await checkThemeLicenseWithClient(dataClient);
    if (!licenseCheck) {
      return { success: false, error: 'Valid Sellf Pro license required to save themes' };
    }

    const result = themeConfigSchema.safeParse(theme);
    if (!result.success) {
      return { success: false, error: `Invalid theme: ${result.error.message}` };
    }

    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(ACTIVE_THEME_PATH, JSON.stringify(result.data, null, 2), 'utf-8');

    revalidatePath('/', 'layout');
    return { success: true };
  });
}

// ===== APPLY PRESET =====

export async function applyPreset(presetId: string): Promise<ActionResponse<void>> {
  const theme = getPresetById(presetId);
  if (!theme) {
    return { success: false, error: `Preset "${presetId}" not found` };
  }
  return saveActiveTheme(theme);
}

// ===== DELETE =====

export async function removeActiveTheme(): Promise<ActionResponse<void>> {
  return withAdminOrSellerAuth(async ({ dataClient }) => {
    const licenseCheck = await checkThemeLicenseWithClient(dataClient);
    if (!licenseCheck) {
      return { success: false, error: 'Valid Sellf Pro license required' };
    }

    try {
      await fs.unlink(ACTIVE_THEME_PATH);
    } catch (error) {
      // ENOENT is OK — file already doesn't exist
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { success: true };
      }
      throw error;
    }

    revalidatePath('/', 'layout');
    return { success: true };
  });
}

// ===== LIST PRESETS =====

export async function getThemePresets(): Promise<ThemePreset[]> {
  return THEME_PRESETS;
}

// ===== LICENSE CHECK =====

/**
 * Internal license check using an already-authenticated data client.
 * Used by saveActiveTheme, removeActiveTheme, etc. inside withAdminOrSellerAuth.
 */
async function checkThemeLicenseWithClient(dataClient: SellerDataClient): Promise<boolean> {
  if (isDemoMode()) return true;

  try {
    const { data } = await dataClient
      .from('integrations_config')
      .select('sellf_license')
      .eq('id', 1)
      .single() as { data: { sellf_license: string | null } | null };

    if (!data?.sellf_license) return false;

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || '';
    const currentDomain = siteUrl ? new URL(siteUrl).hostname : undefined;
    const result = validateLicense(data.sellf_license, currentDomain);

    return result.valid && hasFeature(result.info.tier, 'theme-customization');
  } catch {
    return false;
  }
}

/**
 * Public server action for license check — requires admin/seller auth.
 * Returns ActionResponse<boolean> with the license validity in `data`.
 */
export async function checkThemeLicense(): Promise<ActionResponse<boolean>> {
  return withAdminOrSellerAuth(async ({ dataClient }) => {
    const valid = await checkThemeLicenseWithClient(dataClient);
    return { success: true, data: valid };
  });
}

// ===== EXPORT =====

export async function exportActiveTheme(): Promise<ActionResponse<string>> {
  return withAdminOrSellerAuth(async () => {
    const theme = await getActiveTheme();
    if (!theme) {
      return { success: false, error: 'No active theme to export' };
    }
    return { success: true, data: JSON.stringify(theme, null, 2) };
  });
}
