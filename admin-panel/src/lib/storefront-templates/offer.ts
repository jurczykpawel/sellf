/** Shared opt-in offer defaults. @see phase2-contracts.ts */
import { offerRecipeSchema } from '@/lib/storefront-templates/phase2-contracts';
import { heroProductDefinition } from '@/lib/storefront-templates/hero-product';
import { resolveFaq, resolveProductCta } from '@/lib/storefront-templates/faq-closing';
import type { PublicProductInfo } from '@/lib/storefront-templates/catalogue';
import type { SlotContent } from '@/lib/storefront-templates/schemas';
import type { PresentationModel } from '@/lib/storefront-templates/resolver';
import type { OfferPageConfig } from '@/lib/storefront-templates/offer-repository';
export const DEFAULT_OFFER: OfferPageConfig = { format: 1, enabled: false, templateId: 'offer-default', settings: { density: 'comfortable' }, content: {}, tokens: null };

/** Release-shipped, route-bound recipe; no author-selected product identifiers. */
export const OFFER_RECIPE = offerRecipeSchema.parse({ format: 1, surface: 'offer', shell: 'offer/1', sections: [
  { id: 'hero', type: 'hero-product/1', variant: 'simple', product: { source: 'route-product' }, content: { slot: 'offer.hero' } },
  { id: 'faq', type: 'faq/1', content: { slot: 'offer.faq' } },
  { id: 'closing', type: 'product-cta/1', product: { source: 'route-product' }, content: { slot: 'offer.closing' }, action: 'buy' },
] });

/** Adapt the frozen offer grammar to the existing shared section resolvers. */
export function resolveOffer(config: OfferPageConfig, locale: 'en' | 'pl', productId: string, product: PublicProductInfo | null): PresentationModel<'offer-default'> {
  const localized = <K extends keyof OfferPageConfig['content']>(key: K) => {
    const slot = config.content[key];
    return slot ? slot[locale] ?? slot[slot.sourceLocale] : undefined;
  };
  const slots: Record<string, SlotContent> = {};
  for (const [offer, home] of [['offer.hero', 'home.hero'], ['offer.faq', 'home.faq'], ['offer.closing', 'home.closing']] as const) {
    const value = localized(offer);
    if (value) slots[home] = value;
  }
  const inputs = { locale, settings: { heroProduct: productId, closingProduct: productId },
    productsById: product?.id === productId ? { [productId]: product } : {},
    slots };
  const sections: PresentationModel['sections'] = [];
  for (const spec of OFFER_RECIPE.sections) {
    if (spec.type === 'hero-product/1') sections.push({ id: spec.id, type: spec.type,
      props: { ...heroProductDefinition.resolve({ ...spec, product: { setting: 'heroProduct' }, content: { slot: 'home.hero' } }, inputs), action: 'buy' } });
    if (spec.type === 'faq/1' && config.content['offer.faq']) {
      const resolved = resolveFaq({ ...spec, content: { slot: 'home.faq' } }, inputs);
      if (resolved.success) sections.push({ id: spec.id, type: spec.type, props: resolved.data });
    }
    if (spec.type === 'product-cta/1') {
      const resolved = resolveProductCta({ ...spec, product: { setting: 'closingProduct' }, content: { slot: 'home.closing' } }, inputs);
      if (resolved.success) sections.push({ id: spec.id, type: spec.type, props: resolved.data });
    }
  }
  return { templateId: 'offer-default', locale, sections, catalogue: { groups: {} } };
}
