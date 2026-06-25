import { createPublicClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import { cache } from 'react';
import { getEffectivePaymentMethodOrder } from '@/lib/utils/payment-method-helpers';
import { extractExpressCheckoutConfig } from '@/types/payment-config';
import { getPublicPaymentConfig } from '@/lib/actions/payment-config';
import { checkFeature } from '@/lib/license/resolve';
import { getShopConfig } from '@/lib/actions/shop-config';
import type { TaxMode } from '@/lib/actions/shop-config';
import { getTemplate } from '@/lib/checkout-templates/registry';
import { getCheckoutConfig } from '@/lib/stripe/checkout-config';
import { firstRelated } from '@/lib/supabase/relations';
import type { BundleComponentSummary } from './components/BundleContentsPreview';

interface PageProps {
  params: Promise<{ slug: string; locale: string }>;
}

// Enable ISR - cache for 60 seconds
export const revalidate = 60;

// OPTIMIZED: Cached data fetcher - React cache() deduplicates requests in the same render cycle
// This eliminates duplicate queries between generateMetadata() and CheckoutPage()
const getCheckoutProduct = cache(async (slug: string) => {
  const supabase = createPublicClient();
  // Don't filter by is_active - we might show waitlist for inactive products
  const { data: product, error } = await supabase
    .from('products')
    .select('*')
    .eq('slug', slug)
    .single();

  return { product, error };
});

// Fetch a bundle's component products (icon + name + price fields) for the
// public "This bundle includes:" block. Uses the FK-hinted relationship name
// because bundle_items references products twice (bundle + component).
const getBundleComponents = cache(async (bundleProductId: string): Promise<BundleComponentSummary[]> => {
  const supabase = createPublicClient();
  const { data: items, error } = await supabase
    .from('bundle_items')
    .select(
      'display_order, component:products!bundle_items_component_product_id_fkey(id,name,icon,price,sale_price,sale_price_until,sale_quantity_limit,sale_quantity_sold,allow_custom_price,custom_price_min,slug)',
    )
    .eq('bundle_product_id', bundleProductId)
    .order('display_order');

  if (error) {
    console.error('[CheckoutPage] Failed to load bundle components:', error);
    return [];
  }

  // `component` is a to-one relationship; Supabase's generated types infer it as
  // an array, but a single FK match yields one object at runtime. Normalize both.
  return (items ?? [])
    .map((i) => firstRelated<BundleComponentSummary>(i.component))
    .filter((c): c is BundleComponentSummary => c != null);
});

// Generate metadata for the checkout page
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const { product } = await getCheckoutProduct(slug); // DEDUPED

  // Only show 404 if product doesn't exist at all, or is inactive WITHOUT waitlist
  if (!product || (!product.is_active && !product.enable_waitlist)) {
    return {
      title: 'Checkout - Product Not Found',
    };
  }

  return {
    title: `Checkout - ${product.name}`,
    description: `Purchase ${product.name} - ${product.description}`,
    robots: 'noindex, nofollow', // Prevent indexing of checkout pages
  };
}

export default async function CheckoutPage({ params }: PageProps) {
  const { slug } = await params;
  const { product, error } = await getCheckoutProduct(slug); // DEDUPED - same request as generateMetadata()

  if (error || !product) {
    return notFound();
  }

  // Check if product is available for purchase
  const now = new Date();
  const availableFrom = product.available_from ? new Date(product.available_from) : null;
  const availableUntil = product.available_until ? new Date(product.available_until) : null;

  const isTemporallyAvailable =
    (!availableFrom || availableFrom <= now) &&
    (!availableUntil || availableUntil > now);

  const isFullyAvailable = product.is_active && isTemporallyAvailable;

  // If product is unavailable and doesn't have waitlist enabled, show 404
  if (!isFullyAvailable && !product.enable_waitlist) {
    return notFound();
  }

  const paymentConfig = await getPublicPaymentConfig();
  const paymentMethodOrder = paymentConfig?.config_mode === 'custom'
    ? getEffectivePaymentMethodOrder(paymentConfig, product.currency)
    : undefined;
  const expressCheckoutConfig = extractExpressCheckoutConfig(paymentConfig);

  // Check Sellf license validity (controls "Powered by" branding)
  const licenseValid = await checkFeature('watermark-removal');

  // Get tax mode for conditional VAT display
  const shopConfig = await getShopConfig();
  const taxMode: TaxMode = (shopConfig?.tax_mode as TaxMode) || 'local';

  // Resolve ToS consent setting server-side
  const checkoutConfig = await getCheckoutConfig();
  const collectTermsOfService = checkoutConfig.collect_terms_of_service;

  // Resolve bundle components for the "This bundle includes:" block. Empty for
  // non-bundles, so the showcase renders unchanged.
  const bundleComponents = product.is_bundle ? await getBundleComponents(product.id) : [];

  // Dispatch to the registered template (default / tip-jar / future). Unknown
  // slugs fall back to default — verified by tests/unit/checkout-templates/registry.test.ts.
  const template = getTemplate(product.checkout_template);
  const TemplateComponent = template.Component;
  return (
    <TemplateComponent
      product={product}
      paymentMethodOrder={paymentMethodOrder}
      expressCheckoutConfig={expressCheckoutConfig}
      licenseValid={licenseValid}
      taxMode={taxMode}
      collectTermsOfService={collectTermsOfService}
      bundleComponents={bundleComponents}
    />
  );
}
