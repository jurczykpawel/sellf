/** Shared public route entry. @see lib/storefront-templates/public-page.ts */
import { createHash } from 'node:crypto';
import { redirect } from 'next/navigation';
import { checkPublicFeature } from '@/lib/license/public-snapshot';
import { getShopConfig } from '@/lib/actions/shop-config';
import { loadPublicStorefront } from '@/lib/storefront-templates/public-page';
import SmartLandingClient from '@/components/storefront/SmartLandingClient';
import StorefrontComposition from '@/components/storefront/StorefrontComposition';
import PublicThemeShell from '@/components/storefront/PublicThemeShell';
import type { StorefrontSearchParams } from '@/lib/storefront-templates/public-page';

export default async function PublicStorefrontPage({ locale, searchParams }: { locale: 'en' | 'pl'; searchParams: StorefrontSearchParams }) {
  const [result, shopConfig] = await Promise.all([loadPublicStorefront(locale, searchParams), getShopConfig()]);
  if (!result.success) redirect(`/api/storefront/unavailable?locale=${locale}`);
  const year = new Date().getFullYear(), showSellfBranding = !checkPublicFeature('watermark-removal');
  return <SmartLandingClient templateId={result.model.templateId} hasProducts={result.hasProducts} shopConfig={shopConfig} year={year} showSellfBranding={showSellfBranding}>
    <PublicThemeShell tokens={result.theme.tokens} mode={shopConfig?.checkout_theme}>
    <StorefrontComposition renderKey={createHash('sha256').update(JSON.stringify(result.model)).digest('hex')} model={result.model} shopName={shopConfig?.shop_name || 'Sellf'} year={year} showSellfBranding={showSellfBranding} />
    </PublicThemeShell>
  </SmartLandingClient>;
}
