/** T2.5 resolvers over bounded public batches; no registry activation or I/O.
 * @see docs/templates/phase2-contracts.md
 */
import { z } from 'zod';
import { ctaContentSchema, idSchema } from '@/lib/storefront-templates/schemas';
import { phase2HeroContentSchema, phase2SectionSchema, phase2SettingsSchema, phase2StorefrontRecipeSchema, searchContentSchema } from '@/lib/storefront-templates/phase2-contracts';
import { hasCoreProductActions } from '@/lib/storefront-templates/faq-closing';
import type { PublicCategoryInfo, PublicProductInfo } from '@/lib/storefront-templates/catalogue';
import type { CatalogueLinkProps, OfferFocusProps, SearchHeroProps } from '@/lib/storefront-templates/phase2-contracts';

interface Inputs {
  locale: 'en' | 'pl'; settings: unknown; slots: Record<string, unknown>;
  productsById: Record<string, PublicProductInfo>; categoriesById: Record<string, PublicCategoryInfo>;
}
type SharedSection = { id: string; type: 'hero-product/1'; props: OfferFocusProps }
  | { id: string; type: 'task-nav/1'; props: SearchHeroProps }
  | { id: string; type: 'product-cta/1'; props: CatalogueLinkProps };
const categorySchema = z.strictObject({ id: z.uuid(), label: z.string().min(1).max(100), filterTarget: idSchema });

export function resolveSharedPhase2Section(spec: unknown, inputs: Inputs, recipe: unknown):
  { success: true; data: SharedSection } | { success: false; error: 'INVALID' } {
  const invalid = { success: false, error: 'INVALID' } as const;
  const parsed = phase2SectionSchema.safeParse(spec);
  const settings = phase2SettingsSchema.safeParse(inputs.settings);
  const layout = phase2StorefrontRecipeSchema.safeParse(recipe);
  if (!parsed.success || !settings.success || !layout.success) return invalid;
  const section = parsed.data;
  if (!('variant' in section) || !('content' in section)) return invalid;
  const slot = inputs.slots[section.content.slot];
  const common = { locale: inputs.locale };
  if (section.type === 'hero-product/1' && section.variant === 'offer-focus') {
    const content = slot === undefined ? null : phase2HeroContentSchema.safeParse(slot);
    if (content && !content.success) return invalid;
    const id = settings.data.heroProduct;
    const product = id && Object.hasOwn(inputs.productsById, id) ? inputs.productsById[id] : null;
    if (product && (product.id !== id || !hasCoreProductActions(product, inputs.locale))) return invalid;
    return { success: true, data: { id: section.id, type: section.type, props: { ...common, variant: section.variant, product, content: content?.success ? content.data : null } } };
  }
  if (!('target' in section) || !layout.data.sections.some(s => s.type === 'catalogue/1' && s.id === section.target)) return invalid;
  if (section.type === 'product-cta/1' && section.variant === 'catalogue-link') {
    const content = slot === undefined ? null : ctaContentSchema.safeParse(slot);
    if (content && !content.success) return invalid;
    return { success: true, data: { id: section.id, type: section.type, props: { ...common, variant: section.variant, target: section.target, content: content?.success ? content.data : null } } };
  }
  if (section.type === 'task-nav/1' && section.variant === 'search-hero') {
    const content = slot === undefined ? null : searchContentSchema.safeParse(slot);
    if (content && !content.success) return invalid;
    const categories: PublicCategoryInfo[] = [];
    for (const id of settings.data.taskCategories ?? []) {
      if (!Object.hasOwn(inputs.categoriesById, id)) continue;
      const category = categorySchema.safeParse(inputs.categoriesById[id]);
      if (!category.success || category.data.id !== id || category.data.filterTarget !== section.target) return invalid;
      categories.push(category.data);
    }
    return { success: true, data: { id: section.id, type: section.type, props: { ...common, variant: section.variant, target: section.target, categories, content: content?.success ? content.data : null } } };
  }
  return invalid;
}
