import { createPublicClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import { cache } from 'react';
import ProductPurchaseView from './components/ProductPurchaseView';
import { getEffectivePaymentMethodOrder } from '@/lib/utils/payment-method-helpers';
import { extractExpressCheckoutConfig } from '@/types/payment-config';
import type { PaymentMethodConfig } from '@/types/payment-config';
import { validateLicense, extractDomainFromUrl } from '@/lib/license/verify';
import { getShopConfig } from '@/lib/actions/shop-config';
import type { TaxMode } from '@/lib/actions/shop-config';

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

  // Get payment method configuration using admin client (service_role)
  // RLS on payment_method_config only allows admin SELECT - checkout users need this config too.
  // Also avoids cookies() which would break ISR caching on this page.
  // createAdminClient() is typed with Database which may not include payment_method_config yet
  const adminSupabase: any = createAdminClient();
  const { data: paymentConfig } = await adminSupabase
    .from('payment_method_config')
    .select('*')
    .eq('id', 1)
    .single() as { data: PaymentMethodConfig | null };
  const paymentMethodOrder = paymentConfig
    ? getEffectivePaymentMethodOrder(paymentConfig, product.currency)
    : undefined;
  const expressCheckoutConfig = extractExpressCheckoutConfig(paymentConfig);

  // Check Sellf license validity (controls "Powered by" branding)
  const { data: integrationsConfig } = await adminSupabase
    .from('integrations_config')
    .select('sellf_license')
    .eq('id', 1)
    .single() as { data: { sellf_license: string | null } | null };
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL;
  const currentDomain = siteUrl ? extractDomainFromUrl(siteUrl) : null;
  const licenseResult = validateLicense(integrationsConfig?.sellf_license || '', currentDomain || undefined);
  const licenseValid = licenseResult.valid;

  // Get tax mode for conditional VAT display
  const shopConfig = await getShopConfig();
  const taxMode: TaxMode = (shopConfig?.tax_mode as TaxMode) || 'local';

  // ProductPurchaseView handles showing either checkout form or waitlist form
  return (
    <ProductPurchaseView
      product={product}
      paymentMethodOrder={paymentMethodOrder}
      expressCheckoutConfig={expressCheckoutConfig}
      licenseValid={licenseValid}
      taxMode={taxMode}
    />
  );
}
