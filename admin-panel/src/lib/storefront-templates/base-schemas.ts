/** Strict Phase 1 data shapes. @see priv/rfc/2026-10-03-templates/spec/contracts/ */
import { z } from 'zod';

export const templateIdSchema = z.enum(['default', 'd']);
export const idSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const densitySchema = z.enum(['comfortable', 'compact']);
const text = (max: number) => z.string().max(max).regex(/^(?![\s\S]*<[^>]*>)[\s\S]*$/);
const literals = <T extends number>(values: readonly T[]) => z.union(values.map(value => z.literal(value)));
const unique = <T extends z.ZodType>(schema: T, max: number) => z.array(schema).max(max).refine(items => new Set(items).size === items.length, 'Values must be distinct').meta({ uniqueItems: true });
const colorsSchema = z.strictObject({
  background: z.string().regex(/^#[0-9A-Fa-f]{6}$/), foreground: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/), accentForeground: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  muted: z.string().regex(/^#[0-9A-Fa-f]{6}$/), mutedForeground: z.string().regex(/^#[0-9A-Fa-f]{6}$/), border: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});
const typographySchema = z.strictObject({ font: z.enum(['geist', 'dm-sans']), bodyWeight: literals([400, 500]), headingWeight: literals([500, 600, 700]), baseSizePx: literals([16, 17, 18]), headingLetterSpacingEm: literals([-0.02, -0.01, 0]) });
const shapesSchema = z.strictObject({ radiusSmPx: literals([0, 4, 8]), radiusMdPx: literals([4, 8, 12]), radiusLgPx: literals([8, 12, 16, 24]) });
export const tokensSchema = z.strictObject({ format: z.literal(1), light: colorsSchema, dark: colorsSchema, typography: typographySchema, shapes: shapesSchema });
export const tokenOverridesSchema = z.strictObject({ format: z.literal(1), light: colorsSchema.partial().optional(), dark: colorsSchema.partial().optional(), typography: typographySchema.partial().optional(), shapes: shapesSchema.partial().optional() });

export const heroContentSchema = z.strictObject({ kind: z.literal('hero'), eyebrow: text(80), heading: text(160), body: text(4000), steps: z.array(text(240)).max(6) });
export const headingContentSchema = z.strictObject({ kind: z.literal('heading'), heading: text(160), body: text(4000) });
export const faqContentSchema = z.strictObject({ kind: z.literal('faq'), items: z.array(z.strictObject({ id: idSchema, question: text(240), answer: text(4000) })).max(20).refine(items => new Set(items.map(item => item.id)).size === items.length, 'FAQ IDs must be distinct') });
export const ctaContentSchema = z.strictObject({ kind: z.literal('cta'), heading: text(160), body: text(4000) });
const localized = <T extends z.ZodType>(content: T) => z.union([
  z.strictObject({ sourceLocale: z.literal('en'), en: content, pl: content.optional() }),
  z.strictObject({ sourceLocale: z.literal('pl'), en: content.optional(), pl: content }),
]);
export const contentSchema = z.strictObject({
  'home.hero': localized(heroContentSchema).optional(), 'home.tasks': localized(headingContentSchema).optional(),
  'home.starts': localized(headingContentSchema).optional(), 'home.faq': localized(faqContentSchema).optional(), 'home.closing': localized(ctaContentSchema).optional(),
});
const productRef = z.strictObject({ setting: z.enum(['heroProduct', 'closingProduct']) });
const slotRef = <T extends string>(slots: readonly T[]) => z.strictObject({ slot: z.enum(slots) });
export const sectionSchema = z.discriminatedUnion('type', [
  z.strictObject({ id: idSchema, type: z.literal('hero-product/1'), variant: z.enum(['split-process', 'simple']), product: productRef, content: slotRef(['home.hero']) }),
  z.strictObject({ id: idSchema, type: z.literal('task-nav/1'), categories: z.strictObject({ setting: z.literal('taskCategories') }), content: slotRef(['home.tasks', 'home.starts']), target: idSchema }),
  z.strictObject({ id: idSchema, type: z.literal('product-list/1'), variant: z.enum(['detail-cards', 'compact']), products: z.strictObject({ setting: z.literal('starterProducts') }), content: slotRef(['home.tasks', 'home.starts']) }),
  z.strictObject({ id: idSchema, type: z.literal('catalogue/1'), variant: z.enum(['detail-cards', 'default-groups']), source: z.literal('listed-products'), filters: unique(z.enum(['category', 'price-kind', 'format']), 3), pageSize: literals([9, 12, 24]), density: z.strictObject({ setting: z.literal('density') }) }),
  z.strictObject({ id: idSchema, type: z.literal('faq/1'), content: slotRef(['home.faq']) }),
  z.strictObject({ id: idSchema, type: z.literal('product-cta/1'), product: productRef, content: slotRef(['home.closing']), action: z.enum(['details', 'buy']) }),
]);
export const recipeSchema = z.strictObject({ format: z.literal(1), surface: z.literal('storefront'), shell: z.literal('store/1'), sections: z.array(sectionSchema).min(1).max(32) });
export const settingsSchema = z.strictObject({ heroProduct: z.uuid().optional(), closingProduct: z.uuid().optional(), starterProducts: unique(z.uuid(), 3).optional(), taskCategories: unique(z.uuid(), 12).optional(), density: densitySchema.optional() });
const sectionIds = ['hero', 'tasks', 'start', 'catalogue', 'faq', 'closing'] as const;
const dOverrides = z.strictObject({
  order: unique(z.enum(sectionIds), 6).length(6).optional(), hidden: unique(z.enum(['tasks', 'start', 'faq']), 3).optional(),
  variants: z.strictObject({ hero: z.enum(['split-process', 'simple']).optional(), start: z.enum(['detail-cards', 'compact']).optional(), catalogue: z.enum(['detail-cards', 'default-groups']).optional() }).optional(),
});
const defaultOverrides = z.strictObject({ order: z.tuple([z.literal('catalogue')]).optional(), hidden: z.array(z.never()).max(0).optional(), variants: z.strictObject({ catalogue: z.enum(['detail-cards', 'default-groups']).optional() }).optional() });
export const configSchema = z.strictObject({
  format: z.literal(1), templateId: templateIdSchema,
  settingsByTemplate: z.strictObject({ d: settingsSchema.optional(), default: z.strictObject({}).optional() }),
  overridesByTemplate: z.strictObject({ d: dOverrides.optional(), default: defaultOverrides.optional() }), content: contentSchema, tokens: tokenOverridesSchema.nullable(),
});
const labelSchema = z.strictObject({ en: text(160), pl: text(160) });
export const registryEntrySchema = z.strictObject({
  id: idSchema, label: labelSchema, minSellf: z.string().regex(/^\d{4}\.(?:[1-9]|1[0-2])\.\d+$/),
  entitlement: z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('free') }), z.strictObject({ kind: z.literal('pro') }), z.strictObject({ kind: z.literal('template-key'), templateId: idSchema })]),
  settings: z.array(z.strictObject({ id: z.enum(['heroProduct', 'closingProduct', 'starterProducts', 'taskCategories', 'density']), label: labelSchema, kind: z.enum(['product', 'products', 'categories', 'density']), required: z.boolean(), maxItems: z.number().int().min(1).max(12).optional() })).max(5),
  tokens: tokensSchema.nullable(), defaults: recipeSchema,
});
export type StorefrontConfig = z.infer<typeof configSchema>;
export type TemplateRecipe = z.infer<typeof recipeSchema>;
export type SectionSpec = z.infer<typeof sectionSchema>;
export type TemplateRegistryEntry = z.infer<typeof registryEntrySchema>;
export type PublicThemeTokens = z.infer<typeof tokensSchema>;
export type PublicThemeOverrides = z.infer<typeof tokenOverridesSchema>;
export type TemplateSettings = z.infer<typeof settingsSchema>;
export type SlotContent = z.infer<typeof heroContentSchema> | z.infer<typeof headingContentSchema> | z.infer<typeof faqContentSchema> | z.infer<typeof ctaContentSchema>;
