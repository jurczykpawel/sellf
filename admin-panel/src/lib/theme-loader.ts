/**
 * Server-side theme + license loader for public page layouts.
 * Loads active theme from file and validates license from DB.
 * @see components/providers/whitelabel-provider.tsx for client injection
 */

import { cache } from 'react';
import { getActiveTheme } from '@/lib/actions/theme';
import { checkPublicFeature, getPublicLicenseTier } from '@/lib/license/public-snapshot';
import { getLocalTemplateIds } from '@/lib/storefront-templates/template-license-snapshot';
import { templateRightsForTier } from '@/lib/storefront-templates/rights';
import { createAdminClient } from '@/lib/supabase/admin';
import { readPublishedConfig } from '@/lib/storefront-templates/repository';
import { resolveSelection } from '@/lib/storefront-templates/resolver';
import { STOREFRONT_TEMPLATES } from '@/lib/storefront-templates/registry';
import { resolvePublicTheme } from '@/lib/storefront-templates/public-theme';
import type { ThemeConfig } from '@/lib/themes';
import type { ResolvedPublicTheme } from '@/lib/storefront-templates/public-theme';

export interface ThemeData {
  theme: ThemeConfig | null;
  licenseValid: boolean;
}

export const loadThemeData = cache(async (): Promise<ThemeData> => {
  try {
    const [theme, licenseValid] = await Promise.all([
      getActiveTheme(),
      checkPublicFeature('theme-customization'),
    ]);

    return { theme, licenseValid };
  } catch (error) {
    console.error('[loadThemeData] Error:', error);
    return { theme: null, licenseValid: false };
  }
});

/** Request-local only; protected routes do not load catalogue data or private snapshots. */
export const loadProtectedThemeData = cache(async (): Promise<ResolvedPublicTheme> => {
  try {
    const [published, { licenseValid }] = await Promise.all([readPublishedConfig(createAdminClient()), loadThemeData()]);
    const config = published.success ? published.data : null;
    const selection = resolveSelection(config, templateRightsForTier(getPublicLicenseTier(), getLocalTemplateIds()).availableTemplateIds);
    return resolvePublicTheme(STOREFRONT_TEMPLATES[selection.templateId].tokens, config?.tokens ?? null, licenseValid, 'protected');
  } catch { return resolvePublicTheme(null, null, false, 'protected'); }
});
