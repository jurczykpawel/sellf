/** Hero section definition over batched public inputs. @see spec/contracts/section-contract.md */
import HeroProduct from '@/components/storefront/sections/HeroProduct';
import { heroContentSchema, sectionSchema } from '@/lib/storefront-templates/schemas';
import type { z } from 'zod';
import type { PublicProductInfo } from '@/lib/storefront-templates/catalogue';
import type { SlotContent, TemplateSettings } from '@/lib/storefront-templates/schemas';

export type HeroContent = z.infer<typeof heroContentSchema>;
export type HeroProductSpec = z.infer<typeof heroProductSectionSchema>;
export interface HeroProductProps {
  variant: 'split-process' | 'simple'; product: PublicProductInfo | null;
  content: HeroContent | null; locale: 'en' | 'pl';
}
export interface HeroProductInputs {
  locale: 'en' | 'pl'; settings: TemplateSettings;
  productsById: Record<string, PublicProductInfo>; slots: Record<string, SlotContent>;
}

export const heroProductSectionSchema = sectionSchema.options[0];

export function resolveHeroProduct(spec: HeroProductSpec, inputs: HeroProductInputs): HeroProductProps {
  const id = inputs.settings[spec.product.setting];
  const content = heroContentSchema.safeParse(inputs.slots[spec.content.slot]);
  return { variant: spec.variant, locale: inputs.locale, product: id ? inputs.productsById[id] ?? null : null,
    content: content.success ? content.data : null };
}

export const heroProductDefinition = {
  type: 'hero-product/1', schema: heroProductSectionSchema, resolve: resolveHeroProduct, Component: HeroProduct,
  fixtureIds: ['paid', 'free', 'subscription', 'pwyw', 'empty', 'unavailable', 'missing-media', 'long'],
} as const;
