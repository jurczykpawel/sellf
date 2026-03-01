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
import { createPublicClient } from '@/lib/supabase/server';
import { validateLicense } from '@/lib/license/verify';
import { isDemoMode } from '@/lib/demo-guard';
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

export async function saveActiveTheme(theme: ThemeConfig): Promise<{ success: boolean; error?: string }> {
  // Server-side license gate (demo mode bypasses)
  const licensed = await checkThemeLicense();
  if (!licensed) {
    return { success: false, error: 'Valid Sellf Pro license required to save themes' };
  }

  try {
    const result = themeConfigSchema.safeParse(theme);
    if (!result.success) {
      return { success: false, error: `Invalid theme: ${result.error.message}` };
    }

    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(ACTIVE_THEME_PATH, JSON.stringify(result.data, null, 2), 'utf-8');

    revalidatePath('/', 'layout');
    return { success: true };
  } catch (error) {
    console.error('[saveActiveTheme] Error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ===== APPLY PRESET =====

export async function applyPreset(presetId: string): Promise<{ success: boolean; error?: string }> {
  const theme = getPresetById(presetId);
  if (!theme) {
    return { success: false, error: `Preset "${presetId}" not found` };
  }
  return saveActiveTheme(theme);
}

// ===== DELETE =====

export async function removeActiveTheme(): Promise<{ success: boolean; error?: string }> {
  const licensed = await checkThemeLicense();
  if (!licensed) {
    return { success: false, error: 'Valid Sellf Pro license required' };
  }

  try {
    await fs.unlink(ACTIVE_THEME_PATH);
    revalidatePath('/', 'layout');
    return { success: true };
  } catch (error) {
    // ENOENT is OK — file already doesn't exist
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { success: true };
    }
    console.error('[removeActiveTheme] Error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ===== LIST PRESETS =====

export async function getThemePresets(): Promise<ThemePreset[]> {
  return THEME_PRESETS;
}

// ===== LICENSE CHECK =====

export async function checkThemeLicense(): Promise<boolean> {
  // In demo mode, unlock PRO features so visitors can test theme editing
  if (isDemoMode()) return true;

  try {
    const supabase = await createPublicClient();
    const { data } = await supabase
      .from('integrations_config')
      .select('sellf_license')
      .eq('id', 1)
      .single() as { data: { sellf_license: string | null } | null };

    if (!data?.sellf_license) return false;

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || '';
    const currentDomain = siteUrl ? new URL(siteUrl).hostname : undefined;
    const result = validateLicense(data.sellf_license, currentDomain);

    return result.valid;
  } catch {
    return false;
  }
}

// ===== EXPORT =====

export async function exportActiveTheme(): Promise<{ success: boolean; data?: string; error?: string }> {
  try {
    const theme = await getActiveTheme();
    if (!theme) {
      return { success: false, error: 'No active theme to export' };
    }
    return { success: true, data: JSON.stringify(theme, null, 2) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
