/** Shared data-only composition resolution. @see spec/contracts/section-contract.md */
import { effectiveLayout } from '@/lib/storefront-templates/layout';
import { APP_VERSION, isNewerVersion } from '@/lib/version';
import { registryEntrySchema } from '@/lib/storefront-templates/schemas';
import { CORE_SETTINGS, STOREFRONT_TEMPLATES, validateConfig, validateRecipe } from '@/lib/storefront-templates/registry';
import { resolveSharedPhase2Section } from '@/lib/storefront-templates/phase2-shared';
import { heroProductDefinition } from '@/lib/storefront-templates/hero-product';
import { resolveProductList } from '@/lib/storefront-templates/sections/product-list';
import { resolveTaskNav } from '@/lib/storefront-templates/task-nav';
import { resolveFaq, resolveProductCta } from '@/lib/storefront-templates/faq-closing';
import { resolveCatalogue } from '@/lib/storefront-templates/catalogue-section';
import type { OfferFocusProps, CatalogueLinkProps, SearchHeroProps } from '@/lib/storefront-templates/phase2-contracts';
import type { HeroProductProps } from '@/lib/storefront-templates/hero-product';
import type { ExtendedProductListProps } from '@/lib/storefront-templates/sections/product-list';
import type { TaskNavProps } from '@/lib/storefront-templates/task-nav-public';
import type { FaqProps, ProductCtaProps } from '@/lib/storefront-templates/faq-closing';
import type { CatalogueProps } from '@/lib/storefront-templates/catalogue-section';
import type { PublicCategoryInfo, PublicProductInfo } from '@/lib/storefront-templates/catalogue';
import type { SlotContent, StorefrontConfig, TemplateRecipe, TemplateSettings } from '@/lib/storefront-templates/schemas';

export type ResolvedSection =
  | { id: string; type: 'hero-product/1'; props: HeroProductProps | OfferFocusProps }
  | { id: string; type: 'task-nav/1'; props: TaskNavProps | SearchHeroProps }
  | { id: string; type: 'product-list/1'; props: ExtendedProductListProps }
  | { id: string; type: 'catalogue/1'; props: CatalogueProps }
  | { id: string; type: 'faq/1'; props: FaqProps }
  | { id: string; type: 'product-cta/1'; props: ProductCtaProps | CatalogueLinkProps };
export interface PresentationModel<TemplateId extends string = StorefrontConfig['templateId']> {
  locale: 'en' | 'pl'; templateId: TemplateId; sections: ResolvedSection[];
  catalogue: Pick<CatalogueProps, 'groups'>;
}
export interface PublicInputs {
  locale: 'en' | 'pl'; productsById: Record<string, PublicProductInfo>;
  categoriesById: Record<string, PublicCategoryInfo>; catalogue: CatalogueProps;
}
export interface StorefrontSelection {
  templateId: StorefrontConfig['templateId']; recipe: TemplateRecipe; settings: TemplateSettings;
  content: StorefrontConfig['content']; diagnostic: 'INVALID' | 'UNSUPPORTED' | 'DENIED' | null;
}

/** Available IDs come from the core rights resolver; a missing grant selects free defaults. */
export function resolveSelection(input: unknown, availableTemplateIds: readonly string[] = ['default']): StorefrontSelection {
  const fallback = (diagnostic: StorefrontSelection['diagnostic']): StorefrontSelection => ({
    templateId: 'default', recipe: structuredClone(STOREFRONT_TEMPLATES.default.defaults), settings: {}, content: {}, diagnostic,
  });
  if (!validateConfig(input).valid) return fallback('INVALID');
  const config = input as StorefrontConfig;
  const entry = STOREFRONT_TEMPLATES[config.templateId];
  if (!entry || !registryEntrySchema.safeParse(entry).success || isNewerVersion(APP_VERSION, entry.minSellf) || !validateRecipe(entry.defaults).valid) return fallback('UNSUPPORTED');
  if (entry.entitlement.kind !== 'free' && !availableTemplateIds.includes(entry.id)) return fallback('DENIED');
  const layout = effectiveLayout(entry, config.overridesByTemplate[config.templateId]);
  const recipe = layout.recipe;
  if (!layout.valid || !validateRecipe(recipe).valid) return fallback('UNSUPPORTED');
  return { templateId: config.templateId, recipe, settings: { ...config.settingsByTemplate[config.templateId], density: config.settingsByTemplate[config.templateId]?.density ?? CORE_SETTINGS.density.default }, content: config.content, diagnostic: null };
}

/** Canonical and future experimental callers share current public commercial inputs. */
export function resolvePresentation(selection: StorefrontSelection, publicInputs: PublicInputs): PresentationModel {
  const slots: Record<string, SlotContent> = {};
  for (const [id, slot] of Object.entries(selection.content)) if (slot) slots[id] = slot[publicInputs.locale] ?? slot[slot.sourceLocale]!;
  const inputs = { ...publicInputs, settings: selection.settings, slots };
  const sections: ResolvedSection[] = [];
  for (const spec of selection.recipe.sections) {
    if ('variant' in spec && (spec.variant === 'offer-focus' || spec.variant === 'catalogue-link' || spec.variant === 'search-hero')) {
      const resolved = resolveSharedPhase2Section(spec, inputs, selection.recipe);
      if (resolved.success) sections.push(resolved.data);
      continue;
    }
    switch (spec.type) {
      case 'hero-product/1': sections.push({ id: spec.id, type: spec.type, props: heroProductDefinition.resolve(spec, inputs) }); break;
      case 'product-list/1': sections.push({ id: spec.id, type: spec.type, props: resolveProductList(spec, inputs) }); break;
      case 'catalogue/1': sections.push({ id: spec.id, type: spec.type, props: resolveCatalogue(spec, inputs) }); break;
      case 'task-nav/1': {
        const resolved = resolveTaskNav(spec, inputs, selection.recipe);
        if (resolved.success) sections.push({ id: spec.id, type: spec.type, props: resolved.data });
        break;
      }
      case 'faq/1': {
        const resolved = resolveFaq(spec, inputs);
        if (resolved.success) sections.push({ id: spec.id, type: spec.type, props: resolved.data });
        break;
      }
      case 'product-cta/1': {
        if ('variant' in spec) break;
        const resolved = resolveProductCta(spec, inputs);
        if (resolved.success) sections.push({ id: spec.id, type: spec.type, props: resolved.data });
        break;
      }
    }
  }
  return { locale: publicInputs.locale, templateId: selection.templateId, sections, catalogue: { groups: publicInputs.catalogue.groups } };
}
