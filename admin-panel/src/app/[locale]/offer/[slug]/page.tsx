/** Opt-in product sales page; checkout and buyer access remain core-owned. */
import { notFound } from 'next/navigation';
import { getShopConfig } from '@/lib/actions/shop-config';
import { loadPublicOffer, offerMetadata } from '@/lib/storefront-templates/offer-public';
import { getProductJsonLd, isIndexableProduct } from '@/lib/seo/products';
import SmartLandingClient from '@/components/storefront/SmartLandingClient';
import PublicThemeShell from '@/components/storefront/PublicThemeShell';
import StorefrontComposition from '@/components/storefront/StorefrontComposition';
import type { Metadata } from 'next';

interface PageProps { params: Promise<{ locale: 'en' | 'pl'; slug: string }> }
export const dynamic = 'force-dynamic';
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const result = await loadPublicOffer(locale, slug);
  return result ? offerMetadata(result.product, locale) : { robots: { index: false, follow: false } };
}
export default async function OfferPage({ params }: PageProps) {
  const { locale, slug } = await params;
  const result = await loadPublicOffer(locale, slug);
  if (!result) notFound();
  const shop = await getShopConfig();
  return <SmartLandingClient hasProducts shopConfig={shop}><PublicThemeShell tokens={result.theme.tokens} mode={shop?.checkout_theme}>
    {isIndexableProduct(result.product) && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: getProductJsonLd(result.product, locale, 'offer') }} />}
    <StorefrontComposition model={result.model} shopName={shop?.shop_name || 'Sellf'} renderKey={JSON.stringify(result.model)} />
  </PublicThemeShell></SmartLandingClient>;
}
