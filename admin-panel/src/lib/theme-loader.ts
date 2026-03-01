/**
 * Server-side theme + license loader for public page layouts.
 * Loads active theme from file and validates license from DB.
 * @see components/providers/whitelabel-provider.tsx for client injection
 */

import { cache } from 'react';
import { getActiveTheme } from '@/lib/actions/theme';
import { validateLicense } from '@/lib/license/verify';
import { createPublicClient } from '@/lib/supabase/server';
import type { ThemeConfig } from '@/lib/themes';

export interface ThemeData {
  theme: ThemeConfig | null;
  licenseValid: boolean;
}

export const loadThemeData = cache(async (): Promise<ThemeData> => {
  try {
    const [theme, licenseValid] = await Promise.all([
      getActiveTheme(),
      checkLicenseValidity(),
    ]);

    return { theme, licenseValid };
  } catch (error) {
    console.error('[loadThemeData] Error:', error);
    return { theme: null, licenseValid: false };
  }
});

async function checkLicenseValidity(): Promise<boolean> {
  // In demo mode, unlock PRO features (theme application) for visitors
  if (process.env.DEMO_MODE === 'true') return true;

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
