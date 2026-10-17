/** Installed storefront contracts. @see docs/templates/phase2-contracts.md */
import { z } from 'zod';
import { SECTION_DESCRIPTORS } from '@/lib/storefront-templates/section-descriptors';
import { overridesSchema } from '@/lib/storefront-templates/base-schemas';
import * as base from '@/lib/storefront-templates/base-schemas';
import { phase2ContentSchema, phase2SectionSchema, phase2SettingsSchema } from '@/lib/storefront-templates/phase2-contracts';
export * from '@/lib/storefront-templates/base-schemas';

export const templateIdSchema = z.enum(['default', 'd', 'storefront-a', 'storefront-b', 'storefront-c']);
export const contentSchema = base.contentSchema.extend(phase2ContentSchema.pick({ 'home.hero': true, 'home.comparison': true, 'home.catalogue': true, 'home.search': true, 'home.featured': true, 'home.starter': true, 'home.author': true, 'home.story': true, 'home.paths': true, 'home.projects': true }).shape);
export const settingsSchema = base.settingsSchema.extend(phase2SettingsSchema.pick({ comparisonProducts: true, featuredProducts: true }).shape);
export const sectionSchema = z.union([...base.sectionSchema.options, phase2SectionSchema.options[6], phase2SectionSchema.options[7], phase2SectionSchema.options[9], phase2SectionSchema.options[11], phase2SectionSchema.options[8], phase2SectionSchema.options[10], phase2SectionSchema.options[12], phase2SectionSchema.options[13], phase2SectionSchema.options[14], phase2SectionSchema.options[15], phase2SectionSchema.options[16]]);
export const recipeSchema = base.recipeSchema.extend({ sections: z.array(sectionSchema).min(1).max(32) });
export const configSchema = base.configSchema.extend({
  templateId: templateIdSchema, content: contentSchema,
  settingsByTemplate: base.configSchema.shape.settingsByTemplate.extend({ 'storefront-c': phase2SettingsSchema.pick({ starterProducts: true, density: true }).optional(), 'storefront-b': phase2SettingsSchema.pick({ closingProduct: true, taskCategories: true, density: true, featuredProducts: true }).optional(), 'storefront-a': phase2SettingsSchema.pick({ heroProduct: true, starterProducts: true, taskCategories: true, density: true, comparisonProducts: true }).optional() }),
  overridesByTemplate: base.configSchema.shape.overridesByTemplate.extend({ 'storefront-c': overridesSchema(SECTION_DESCRIPTORS['storefront-c']).optional(), 'storefront-b': overridesSchema(SECTION_DESCRIPTORS['storefront-b']).optional(), 'storefront-a': overridesSchema(SECTION_DESCRIPTORS['storefront-a']).optional() }),
});
export const registryEntrySchema = base.registryEntrySchema.extend({ defaults: recipeSchema,
  settings: z.array(base.registryEntrySchema.shape.settings.element.extend({ id: z.enum(['heroProduct', 'closingProduct', 'starterProducts', 'taskCategories', 'density', 'comparisonProducts', 'featuredProducts']) })).max(6),
});
export type StorefrontConfig = z.infer<typeof configSchema>;
export type TemplateRecipe = z.infer<typeof recipeSchema>;
export type SectionSpec = z.infer<typeof sectionSchema>;
export type TemplateRegistryEntry = z.infer<typeof registryEntrySchema>;
export type TemplateSettings = z.infer<typeof settingsSchema>;
export type SlotContent = NonNullable<StorefrontConfig['content'][keyof StorefrontConfig['content']]> extends infer Localized
  ? Localized extends { sourceLocale: 'en'; en: infer Value } | { sourceLocale: 'pl'; pl: infer Value } ? Value : never : never;
