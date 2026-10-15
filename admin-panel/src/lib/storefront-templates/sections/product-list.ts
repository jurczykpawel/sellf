/** Starter section registration inputs. @see spec/contracts/section-contract.md */
import { sectionSchema } from '@/lib/storefront-templates/schemas';
import type { PublicProductInfo } from '@/lib/storefront-templates/catalogue';
import type { SectionSpec, SlotContent, TemplateSettings } from '@/lib/storefront-templates/schemas';

export const productListSectionSchema = sectionSchema.options[2];
export type ProductListSpec = Extract<SectionSpec, { type: 'product-list/1' }>;
export interface ProductListProps {
  variant: ProductListSpec['variant']; products: PublicProductInfo[];
  content: Extract<SlotContent, { kind: 'heading' }> | null; locale: 'en' | 'pl';
}
export interface ProductListInputs {
  locale: 'en' | 'pl'; settings: Pick<TemplateSettings, 'starterProducts'>;
  productsById: Record<string, PublicProductInfo>; slots: Record<string, SlotContent>;
}
export function availableStarters(products: PublicProductInfo[]): PublicProductInfo[] {
  const seen = new Set<string>();
  return products.filter(product => {
    if (product.availability !== 'available' || seen.has(product.id)) return false;
    seen.add(product.id);
    return true;
  }).slice(0, 3);
}
export function resolveProductList(spec: ProductListSpec, inputs: ProductListInputs): ProductListProps {
  const slot = inputs.slots[spec.content.slot];
  return { variant: spec.variant, locale: inputs.locale,
    products: availableStarters((inputs.settings.starterProducts ?? []).flatMap(id => inputs.productsById[id] ? [inputs.productsById[id]] : [])),
    content: slot?.kind === 'heading' ? slot : null };
}
export const productListLabels = {
  en: { details: 'View details', more: 'Result and requirements', result: 'Result', tools: 'Tools', requirements: 'Requirements', format: 'Format' },
  pl: { details: 'Zobacz szczegóły', more: 'Rezultat i wymagania', result: 'Rezultat', tools: 'Narzędzia', requirements: 'Wymagania', format: 'Format' },
};
