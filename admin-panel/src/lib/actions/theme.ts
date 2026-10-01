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
import { withAdminClient } from '@/lib/actions/admin-auth';
import { checkFeature } from '@/lib/license/resolve';
import { isDemoMode, DEMO_MODE_ERROR } from '@/lib/demo-guard';
import type { ActionResponse } from '@/lib/actions/admin-auth';
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
  // The active theme is one file shared by every visitor, so demo mode keeps it
  // read-only like every other admin setting; the editor still previews locally.
  if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR, errorCode: 'DEMO_MODE' };

  return withAdminClient(async ({ dataClient }) => {
    const licenseCheck = await checkFeature('theme-customization', { dataClient });
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
  // Read-only in demo mode, as in saveActiveTheme.
  if (isDemoMode()) return { success: false, error: DEMO_MODE_ERROR, errorCode: 'DEMO_MODE' };

  return withAdminClient(async ({ dataClient }) => {
    const licenseCheck = await checkFeature('theme-customization', { dataClient });
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
 * Public server action for license check — requires admin/seller auth.
 * Returns ActionResponse<boolean> with the license validity in `data`.
 *
 * Demo mode is intentionally left unlocked here (read-only: it does not
 * write anything) so a visitor can open the theme editor and see the Pro
 * feature unlocked — actually saving a change is a mutation and is
 * blocked above in saveActiveTheme/removeActiveTheme.
 */
export async function checkThemeLicense(): Promise<ActionResponse<boolean>> {
  if (isDemoMode()) {
    return { success: true, data: true };
  }

  return withAdminClient(async ({ dataClient }) => {
    const valid = await checkFeature('theme-customization', { dataClient });
    return { success: true, data: valid };
  });
}

// ===== EXPORT =====

export async function exportActiveTheme(): Promise<ActionResponse<string>> {
  return withAdminClient(async () => {
    const theme = await getActiveTheme();
    if (!theme) {
      return { success: false, error: 'No active theme to export' };
    }
    return { success: true, data: JSON.stringify(theme, null, 2) };
  });
}
