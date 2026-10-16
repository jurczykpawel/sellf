/** Installed storefront contracts. @see docs/templates/phase2-contracts.md */
import { z } from 'zod';
import * as base from '@/lib/storefront-templates/base-schemas';
import { phase2ContentSchema, phase2SectionSchema, phase2SettingsSchema } from '@/lib/storefront-templates/phase2-contracts';
export * from '@/lib/storefront-templates/base-schemas';

export const templateIdSchema = z.enum(['default', 'd', 'storefront-a']);
export const contentSchema = base.contentSchema.extend(phase2ContentSchema.pick({ 'home.hero': true, 'home.comparison': true, 'home.catalogue': true }).shape);
export const settingsSchema = base.settingsSchema.extend(phase2SettingsSchema.pick({ comparisonProducts: true }).shape);
export const sectionSchema = z.union([...base.sectionSchema.options, phase2SectionSchema.options[6], phase2SectionSchema.options[8], phase2SectionSchema.options[10], phase2SectionSchema.options[12]]);
export const recipeSchema = base.recipeSchema.extend({ sections: z.array(sectionSchema).min(1).max(32) });
export const configSchema = base.configSchema.extend({
  templateId: templateIdSchema, content: contentSchema,
  settingsByTemplate: base.configSchema.shape.settingsByTemplate.extend({ 'storefront-a': phase2SettingsSchema.pick({ heroProduct: true, starterProducts: true, taskCategories: true, density: true, comparisonProducts: true }).optional() }),
  overridesByTemplate: base.configSchema.shape.overridesByTemplate.extend({ 'storefront-a': z.strictObject({}).optional() }),
});
export const registryEntrySchema = base.registryEntrySchema.extend({ defaults: recipeSchema,
  settings: z.array(base.registryEntrySchema.shape.settings.element.extend({ id: z.enum(['heroProduct', 'closingProduct', 'starterProducts', 'taskCategories', 'density', 'comparisonProducts']) })).max(6),
});
export type StorefrontConfig = z.infer<typeof configSchema>;
export type TemplateRecipe = z.infer<typeof recipeSchema>;
export type SectionSpec = z.infer<typeof sectionSchema>;
export type TemplateRegistryEntry = z.infer<typeof registryEntrySchema>;
export type TemplateSettings = z.infer<typeof settingsSchema>;
export type SlotContent = NonNullable<StorefrontConfig['content'][keyof StorefrontConfig['content']]> extends infer Localized
  ? Localized extends { sourceLocale: 'en'; en: infer Value } | { sourceLocale: 'pl'; pl: infer Value } ? Value : never : never;
