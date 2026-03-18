/**
 * Server-side theme + license loader for public page layouts.
 * Loads active theme from file and validates license from DB.
 * @see components/providers/whitelabel-provider.tsx for client injection
 */

import { cache } from 'react';
import { getActiveTheme } from '@/lib/actions/theme';
import { checkFeature } from '@/lib/license/resolve';
import type { ThemeConfig } from '@/lib/themes';

export interface ThemeData {
  theme: ThemeConfig | null;
  licenseValid: boolean;
}

export const loadThemeData = cache(async (): Promise<ThemeData> => {
  try {
    const [theme, licenseValid] = await Promise.all([
      getActiveTheme(),
      checkFeature('theme-customization'),
    ]);

    return { theme, licenseValid };
  } catch (error) {
    console.error('[loadThemeData] Error:', error);
    return { theme: null, licenseValid: false };
  }
});
