/** Shared public route entry. @see lib/storefront-templates/public-page.ts */
import { createHash } from 'node:crypto';
import { getShopConfig } from '@/lib/actions/shop-config';
import { loadPublicStorefront } from '@/lib/storefront-templates/public-page';
import { catalogueLabels } from '@/lib/storefront-templates/catalogue-section';
import SmartLandingClient from '@/components/storefront/SmartLandingClient';
import StorefrontComposition from '@/components/storefront/StorefrontComposition';
import type { StorefrontSearchParams } from '@/lib/storefront-templates/public-page';

export default async function PublicStorefrontPage({ locale, searchParams }: { locale: 'en' | 'pl'; searchParams: StorefrontSearchParams }) {
  const [result, shopConfig] = await Promise.all([loadPublicStorefront(locale, searchParams), getShopConfig()]);
  if (!result.success) return <SmartLandingClient hasProducts shopConfig={shopConfig}>
    <div className="max-w-[960px] mx-auto px-6 py-12" role="alert">
      <h1>{shopConfig?.shop_name || 'Sellf'}</h1>
      <p>{catalogueLabels[locale].error}</p><a href="">{catalogueLabels[locale].retry}</a>
    </div>
  </SmartLandingClient>;
  return <SmartLandingClient templateId={result.model.templateId} hasProducts={result.hasProducts} shopConfig={shopConfig}>
    <StorefrontComposition renderKey={createHash('sha256').update(JSON.stringify(result.model)).digest('hex')} model={result.model} shopName={shopConfig?.shop_name || 'Sellf'} />
  </SmartLandingClient>;
}
