/**
 * Seller Checkout Page
 *
 * Checkout for a product from a specific seller's shop.
 * Route: /s/{seller-slug}/checkout/{product-slug}
 *
 * Same logic as /checkout/[slug] but fetches product and config from the seller's schema.
 *
 * @see src/app/[locale]/checkout/[slug]/page.tsx — platform checkout (original)
 * @see src/lib/marketplace/seller-client.ts — seller lookup + schema-scoped clients
 */

import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import { cache } from 'react';
import { checkMarketplaceAccess } from '@/lib/marketplace/feature-flag';
import { getSellerBySlug, createSellerAdminClient } from '@/lib/marketplace/seller-client';
import { validateLicense, extractDomainFromUrl } from '@/lib/license/verify';
import { getEffectivePaymentMethodOrder } from '@/lib/utils/payment-method-helpers';
import { extractExpressCheckoutConfig } from '@/types/payment-config';
import type { PaymentMethodConfig } from '@/types/payment-config';
import type { TaxMode } from '@/lib/actions/shop-config';
import type { Product } from '@/types';
import ProductPurchaseView from '@/app/[locale]/checkout/[slug]/components/ProductPurchaseView';

interface PageProps {
  params: Promise<{ seller: string; slug: string; locale: string }>;
}

// Per-user checkout → force dynamic
export const dynamic = 'force-dynamic';

// ===== DATA FETCHING =====

const getSellerCheckoutData = cache(async (sellerSlug: string, productSlug: string) => {
  const seller = await getSellerBySlug(sellerSlug);
  if (!seller) return null;

  const client = createSellerAdminClient(seller.schema_name);

  // Fetch product, payment config, integrations config, and shop config in parallel
  // License from seller schema (shop license, validated against seller slug)
  const [productResult, paymentConfigResult, integrationsResult, shopConfigResult] = await Promise.all([
    client.from('products').select('*').eq('slug', productSlug).single(),
    client.from('payment_method_config').select('*').eq('id', 1).single(),
    client.from('integrations_config').select('sellf_license').eq('id', 1).single(),
    client.from('shop_config').select('tax_mode').eq('id', 1).single(),
  ]);

  if (productResult.error || !productResult.data) return null;

  return {
    seller,
    product: productResult.data as unknown as Product,
    paymentConfig: paymentConfigResult.data as PaymentMethodConfig | null,
    integrationsConfig: integrationsResult.data as { sellf_license: string | null } | null,
    shopConfig: shopConfigResult.data as { tax_mode: string } | null,
  };
});

// ===== METADATA =====

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { seller: sellerSlug, slug } = await params;
  const data = await getSellerCheckoutData(sellerSlug, slug);

  if (!data || (!data.product.is_active && !data.product.enable_waitlist)) {
    return { title: 'Checkout - Product Not Found' };
  }

  return {
    title: `Checkout - ${data.product.name} — ${data.seller.display_name}`,
    description: `Purchase ${data.product.name} from ${data.seller.display_name}`,
    robots: 'noindex, nofollow',
  };
}

// ===== PAGE =====

export default async function SellerCheckoutPage({ params }: PageProps) {
  const access = await checkMarketplaceAccess();
  if (!access.accessible) return notFound();

  const { seller: sellerSlug, slug } = await params;
  const data = await getSellerCheckoutData(sellerSlug, slug);

  if (!data) return notFound();

  const { product, paymentConfig, integrationsConfig, shopConfig } = data;

  // Check product availability
  const now = new Date();
  const availableFrom = product.available_from ? new Date(product.available_from) : null;
  const availableUntil = product.available_until ? new Date(product.available_until) : null;
  const isTemporallyAvailable =
    (!availableFrom || availableFrom <= now) &&
    (!availableUntil || availableUntil > now);
  const isFullyAvailable = product.is_active && isTemporallyAvailable;

  if (!isFullyAvailable && !product.enable_waitlist) return notFound();

  // Payment config
  const paymentMethodOrder = paymentConfig
    ? getEffectivePaymentMethodOrder(paymentConfig, product.currency)
    : undefined;
  const expressCheckoutConfig = extractExpressCheckoutConfig(paymentConfig);

  // License check — per-seller shop license (validated against seller slug OR domain)
  const siteUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  const currentDomain = siteUrl ? extractDomainFromUrl(siteUrl) : null;
  const licenseKey = integrationsConfig?.sellf_license || '';
  const slugResult = validateLicense(licenseKey, data.seller.slug);
  const domainResult = currentDomain ? validateLicense(licenseKey, currentDomain) : { valid: false };
  const licenseResult = { valid: slugResult.valid || domainResult.valid };

  // Tax mode
  const taxMode: TaxMode = (shopConfig?.tax_mode as TaxMode) || 'local';

  return (
    <ProductPurchaseView
      product={product}
      paymentMethodOrder={paymentMethodOrder}
      expressCheckoutConfig={expressCheckoutConfig}
      licenseValid={licenseResult.valid}
      taxMode={taxMode}
      sellerSlug={data.seller.slug}
    />
  );
}
