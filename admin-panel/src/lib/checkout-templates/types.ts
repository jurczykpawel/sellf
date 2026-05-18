import type { ComponentType } from 'react';
import type { Product } from '@/types';
import type { ExpressCheckoutConfig } from '@/types/payment-config';
import type { TaxMode } from '@/lib/actions/shop-config';

// Canonical list of checkout templates. Mirrored in:
//   - supabase/migrations/<ts>_add_checkout_template_to_products.sql (CHECK)
//   - the zod schema validating product PATCH/POST payloads
// Adding a template = update all three sites in one commit.
export const CHECKOUT_TEMPLATE_SLUGS = ['default', 'tip-jar', 'oto'] as const;
export type CheckoutTemplateSlug = typeof CHECKOUT_TEMPLATE_SLUGS[number];

// Server-resolved props every template receives. Templates that need more
// data fetch it themselves inside their Component (RSC patterns are fine —
// each template file can be an async server component or split into
// 'use client' children as needed).
export interface CheckoutTemplateProps {
  product: Product;
  paymentMethodOrder?: string[];
  expressCheckoutConfig: ExpressCheckoutConfig;
  licenseValid: boolean;
  taxMode: TaxMode;
}

export interface CheckoutTemplate {
  slug: CheckoutTemplateSlug;
  // English label for the admin dropdown — i18n happens in the consumer via
  // `descriptionKey`. Keeping `displayName` non-translated keeps the registry
  // a pure data structure, free of next-intl wiring.
  displayName: string;
  // i18n key path (e.g. 'productForm.checkoutTemplate.options.tipJar') used
  // by the admin UI for the localized label + help tooltip.
  descriptionKey: string;
  Component: ComponentType<CheckoutTemplateProps>;
}
