/** Shared product purchase view. @see app/[locale]/checkout/[slug]/page.tsx */
import { cache } from 'react';
import { createPublicClient } from '@/lib/supabase/server';
import { getEffectivePaymentMethodOrder } from '@/lib/utils/payment-method-helpers';
import { extractExpressCheckoutConfig } from '@/types/payment-config';
import { getPublicPaymentConfig } from '@/lib/actions/payment-config';
import { checkFeature } from '@/lib/license/resolve';
import { getShopConfig } from '@/lib/actions/shop-config';
import { getTemplate } from '@/lib/checkout-templates/registry';
import { getCheckoutConfig } from '@/lib/stripe/checkout-config';
import { firstRelated } from '@/lib/supabase/relations';
import type { Product } from '@/types';
import type { TaxMode } from '@/lib/actions/shop-config';
import type { BundleComponentSummary } from '@/app/[locale]/checkout/[slug]/components/BundleContentsPreview';

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

export default async function ProductPurchasePage({ product }: { product: Product }) {
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
