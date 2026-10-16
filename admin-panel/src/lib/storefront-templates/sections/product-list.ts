/** Starter section registration inputs. @see spec/contracts/section-contract.md */
import { z } from 'zod';
import { phase2SectionSchema } from '@/lib/storefront-templates/phase2-contracts';
import { sectionSchema } from '@/lib/storefront-templates/schemas';
import type { PublicProductInfo } from '@/lib/storefront-templates/catalogue';
import type { ComparisonProps, Phase2SectionSpec, Phase2Settings, Phase2SlotContent, featuredContentSchema } from '@/lib/storefront-templates/phase2-contracts';
import type { SectionSpec } from '@/lib/storefront-templates/base-schemas';
import type { SlotContent } from '@/lib/storefront-templates/schemas';

export const productListSectionSchema = z.union([sectionSchema.options[2], phase2SectionSchema.options[8], phase2SectionSchema.options[9]]);
export type ProductListSpec = Extract<SectionSpec, { type: 'product-list/1' }>;
export interface ProductListProps {
  variant: ProductListSpec['variant']; products: PublicProductInfo[];
  content: Extract<SlotContent, { kind: 'heading' }> | null; locale: 'en' | 'pl';
}
export type ExtendedProductListSpec = Extract<Phase2SectionSpec, { type: 'product-list/1' }>;
export type ExtendedProductListProps = ProductListProps | ComparisonProps | (Omit<ProductListProps, 'variant' | 'content'> & { variant: 'featured-grid'; content: z.infer<typeof featuredContentSchema> | null });
export interface ProductListInputs {
  locale: 'en' | 'pl'; settings: Pick<Phase2Settings, 'starterProducts' | 'comparisonProducts' | 'featuredProducts'>;
  productsById: Record<string, PublicProductInfo>; slots: Record<string, SlotContent | Phase2SlotContent>;
}
export function availableStarters(products: PublicProductInfo[], limit = 3): PublicProductInfo[] {
  const seen = new Set<string>();
  return products.filter(product => {
    if (product.availability !== 'available' || seen.has(product.id)) return false;
    seen.add(product.id);
    return true;
  }).slice(0, limit);
}
export function resolveProductList(spec: ProductListSpec, inputs: ProductListInputs): ProductListProps;
export function resolveProductList(spec: ExtendedProductListSpec, inputs: ProductListInputs): ExtendedProductListProps;
export function resolveProductList(spec: ExtendedProductListSpec, inputs: ProductListInputs): ExtendedProductListProps {
  const slot = inputs.slots[spec.content.slot];
  const limit = spec.variant === 'comparison' ? 2 : spec.variant === 'featured-grid' ? 6 : 3;
  const products = availableStarters((inputs.settings[spec.products.setting] ?? []).flatMap(id => inputs.productsById[id] ? [inputs.productsById[id]] : []), limit);
  if (spec.variant === 'comparison') return { variant: spec.variant, locale: inputs.locale, products, content: slot?.kind === 'comparison' ? slot : null };
  return { variant: spec.variant, locale: inputs.locale, products, content: slot?.kind === 'heading' ? slot : null };
}
export const productListLabels = {
  en: { details: 'View details', more: 'Result and requirements', result: 'Result', tools: 'Tools', requirements: 'Requirements', format: 'Format' },
  pl: { details: 'Zobacz szczegóły', more: 'Rezultat i wymagania', result: 'Rezultat', tools: 'Narzędzia', requirements: 'Wymagania', format: 'Format' },
};
