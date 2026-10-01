/**
 * Test helper for applying a whitelabel theme preset to the public pages
 * during a single Playwright run, then restoring whatever was active before.
 *
 * The active theme is a single shared file (`data/active-theme.json`, see
 * lib/actions/theme.ts) read fresh on every request by the dev server — the
 * test process and the dev server share the same filesystem (and `cwd`,
 * since both run from admin-panel/), so writing it directly here is enough;
 * no server action / license flow is needed to make the preset render.
 */
import { promises as fs } from 'fs';
import path from 'path';
import type { ThemeConfig } from '@/lib/themes';

const ACTIVE_THEME_PATH = path.join(process.cwd(), 'data', 'active-theme.json');

/** Raw file contents, or null if no active theme is currently set. */
export async function readRawActiveTheme(): Promise<string | null> {
  try {
    return await fs.readFile(ACTIVE_THEME_PATH, 'utf-8');
  } catch {
    return null;
  }
}

export async function writeActiveTheme(theme: ThemeConfig): Promise<void> {
  await fs.mkdir(path.dirname(ACTIVE_THEME_PATH), { recursive: true });
  await fs.writeFile(ACTIVE_THEME_PATH, JSON.stringify(theme, null, 2), 'utf-8');
}

/** Restores the exact raw file contents captured by readRawActiveTheme() earlier. */
export async function restoreRawActiveTheme(raw: string | null): Promise<void> {
  if (raw === null) {
    await fs.rm(ACTIVE_THEME_PATH, { force: true });
  } else {
    await fs.mkdir(path.dirname(ACTIVE_THEME_PATH), { recursive: true });
    await fs.writeFile(ACTIVE_THEME_PATH, raw, 'utf-8');
  }
}
