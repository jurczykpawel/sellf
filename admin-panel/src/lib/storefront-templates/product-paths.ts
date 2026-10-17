/** Starting paths over caller-resolved bounded public bindings.
 * @see docs/templates/phase2-contracts.md
 */
import ProductPaths from '@/components/storefront/sections/ProductPaths';
import { pathsContentSchema, phase2SectionSchema } from '@/lib/storefront-templates/phase2-contracts';
import type { PublicProductInfo } from '@/lib/storefront-templates/catalogue';
import type { ProductPathsProps } from '@/lib/storefront-templates/phase2-contracts';

interface ProductPathsInputs {
  locale: 'en' | 'pl'; slots: Record<string, unknown>;
  productsById: Record<string, PublicProductInfo | null>;
}
export function resolveProductPaths(spec: unknown, inputs: ProductPathsInputs):
  { success: true; data: ProductPathsProps } | { success: false; error: 'INVALID' } {
  const invalid = { success: false, error: 'INVALID' } as const;
  const parsed = phase2SectionSchema.safeParse(spec);
  if (!parsed.success || parsed.data.type !== 'product-paths/1') return invalid;
  const slot = inputs.slots[parsed.data.content.slot];
  if (slot === undefined) return { success: true, data: { heading: '', body: '', items: [], locale: inputs.locale } };
  const content = pathsContentSchema.safeParse(slot);
  if (!content.success) return invalid;
  const items: ProductPathsProps['items'] = [];
  for (const item of content.data.items) {
    if (!Object.hasOwn(inputs.productsById, item.productId)) return invalid;
    const product = inputs.productsById[item.productId];
    if (product && product.id !== item.productId) return invalid;
    if (product?.availability === 'available') items.push({ id: item.id, situation: item.situation, body: item.body, ...(item.label !== undefined ? { label: item.label } : {}), product });
  }
  return { success: true, data: { heading: content.data.heading, body: content.data.body, ...(content.data.eyebrow !== undefined ? { eyebrow: content.data.eyebrow } : {}), ...(content.data.actionLabel !== undefined ? { actionLabel: content.data.actionLabel } : {}), items, locale: inputs.locale } };
}
export const productPathsDefinition = {
  type: 'product-paths/1', schema: phase2SectionSchema.options.find(schema => schema.shape.type.value === 'product-paths/1')!,
  resolve: resolveProductPaths, Component: ProductPaths,
  fixtureIds: ['paths', 'empty', 'long', 'unavailable', 'no-media', 'prices'],
} as const;
