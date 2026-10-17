/** Frozen authoring contracts; renderer registration follows in Phase 2 tasks.
 * @see docs/templates/phase2-contracts.md
 */
import { z } from 'zod';
import { configSchema, overridesSchema, contentSchema, ctaContentSchema, densitySchema, faqContentSchema, headingContentSchema, heroContentSchema, idSchema, recipeSchema, sectionSchema, settingsSchema, tokensSchema } from '@/lib/storefront-templates/base-schemas';
import { SECTION_DESCRIPTORS } from '@/lib/storefront-templates/section-descriptors';
import { CONFIG_BYTES, isPlainJson, pointer, result, storedJsonBytes } from '@/lib/storefront-templates/json';
import type { PublicCategoryInfo, PublicProductInfo } from '@/lib/storefront-templates/catalogue';
import type { HeroProductProps } from '@/lib/storefront-templates/hero-product';
import type { CatalogueProps } from '@/lib/storefront-templates/catalogue-section';
import type { PublicInputs, ResolvedSection } from '@/lib/storefront-templates/resolver';
import type { ValidationResult } from '@/lib/storefront-templates/json';

const text = (max: number) => z.string().max(max).regex(/^[^<>]*$/);
const localized = <T extends z.ZodType>(schema: T) => z.union([
  z.strictObject({ sourceLocale: z.literal('en'), en: schema, pl: schema.optional() }),
  z.strictObject({ sourceLocale: z.literal('pl'), pl: schema, en: schema.optional() }),
]);
const distinct = <T extends z.ZodType>(schema: T, max: number, key: (value: z.infer<T>) => unknown = value => value) => z.array(schema).max(max).refine(items => new Set(items.map(key)).size === items.length, 'Items must be distinct');
const slot = <T extends string>(name: T) => z.strictObject({ slot: z.literal(name) });
const base = { id: idSchema };
const products = <T extends string>(setting: T) => z.strictObject({ setting: z.literal(setting) });
export const projectLinkSchema = z.string().max(2048).regex(/^https:\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::443)?(?:\/[a-zA-Z0-9/_-]*)?$/).refine(value => {
  let host: string;
  try { host = new URL(value).hostname; } catch { return false; }
  return !['localhost', 'local', 'internal', 'home', 'lan', 'google.internal'].some(name => host === name || host.endsWith(`.${name}`));
}, 'Expected a public HTTPS project page');
export const listHeadingContentSchema = headingContentSchema.extend({ eyebrow: text(80).optional() });
export const featuredContentSchema = listHeadingContentSchema.extend({ actionLabel: text(80).optional(), detailsLabel: text(120).optional(), detailActionLabel: text(80).optional(), items: distinct(z.strictObject({ productId: z.uuid(), eyebrow: text(80).optional(), descriptor: text(120).optional(), detailHeading: text(160).optional(), detailBody: text(1000).optional(), requirementsLabel: text(240).optional() }), 6, item => item.productId).optional() });
export const comparisonContentSchema = z.strictObject({ kind: z.literal('comparison'), actionLabel: text(80).optional(), eyebrow: text(80).optional(), heading: text(160), body: text(4000), items: distinct(z.strictObject({ productId: z.uuid(), eyebrow: text(80), heading: text(160), body: text(1000), bullets: z.array(text(240)).max(6) }), 2, item => item.productId).length(2) });
export const phase2HeroContentSchema = heroContentSchema.extend({ mediaCaption: text(80).optional(), stepDetails: z.array(text(1000)).max(6).optional(), staticDemo: z.strictObject({ title: text(160), body: text(1000) }).optional() });
export const searchContentSchema = z.strictObject({ kind: z.literal('search'), eyebrow: text(80).optional(), heading: text(160), body: text(4000), items: distinct(z.strictObject({ id: idSchema, categoryId: z.uuid(), description: text(240) }), 12, item => item.categoryId).refine(items => new Set(items.map(item => item.id)).size === items.length, 'Category description IDs must be distinct') });
export const authorContentSchema = z.strictObject({ kind: z.literal('author'), name: text(120), eyebrow: text(80), heading: text(160), intro: text(4000), portraitMediaId: z.uuid().nullable() });
export const biographyContentSchema = z.strictObject({ kind: z.literal('biography'), heading: text(160), paragraphs: z.array(text(2000)).max(6) });
export const pathsContentSchema = z.strictObject({ kind: z.literal('paths'), eyebrow: text(80).optional(), actionLabel: text(80).optional(), heading: text(160), body: text(4000), items: distinct(z.strictObject({ id: idSchema, productId: z.uuid(), situation: text(160), body: text(1000), label: text(80).optional() }), 4, item => item.productId).refine(items => new Set(items.map(item => item.id)).size === items.length, 'Path IDs must be distinct') });
export const projectsContentSchema = z.strictObject({ kind: z.literal('projects'), heading: text(160), items: distinct(z.strictObject({ id: idSchema, name: text(120), body: text(1000), url: projectLinkSchema, mediaId: z.uuid().nullable() }), 3, item => item.id) });
export const phase2ContentSchema = contentSchema.extend({
  'home.hero': localized(phase2HeroContentSchema).optional(),
  'home.comparison': localized(comparisonContentSchema).optional(), 'home.featured': localized(featuredContentSchema).optional(), 'home.catalogue': localized(listHeadingContentSchema).optional(),
  'home.starter': localized(ctaContentSchema).optional(), 'home.search': localized(searchContentSchema).optional(), 'home.author': localized(authorContentSchema).optional(),
  'home.story': localized(biographyContentSchema).optional(), 'home.paths': localized(pathsContentSchema).optional(), 'home.projects': localized(projectsContentSchema).optional(),
  'offer.hero': localized(heroContentSchema).optional(), 'offer.faq': localized(faqContentSchema).optional(), 'offer.closing': localized(ctaContentSchema).optional(),
});
export const phase2SettingsSchema = settingsSchema.extend({ comparisonProducts: distinct(z.uuid(), 2).length(2).optional(), featuredProducts: distinct(z.uuid(), 6).optional() });
const phase2Sections = [
  ...sectionSchema.options,
  z.strictObject({ ...base, type: z.literal('hero-product/1'), variant: z.literal('offer-focus'), product: products('heroProduct'), content: slot('home.hero') }),
  z.strictObject({ ...base, type: z.literal('task-nav/1'), variant: z.literal('search-hero'), categories: products('taskCategories'), content: slot('home.search'), target: idSchema }),
  z.strictObject({ ...base, type: z.literal('product-list/1'), variant: z.literal('comparison'), products: products('comparisonProducts'), content: slot('home.comparison') }),
  z.strictObject({ ...base, type: z.literal('product-list/1'), variant: z.literal('featured-grid'), products: products('featuredProducts'), content: slot('home.featured') }),
  sectionSchema.options[3].extend({ variant: z.literal('compact'), content: slot('home.catalogue').optional() }),
  z.strictObject({ ...base, type: z.literal('product-cta/1'), product: products('closingProduct'), content: slot('home.starter'), action: z.literal('details') }),
  z.strictObject({ ...base, type: z.literal('product-cta/1'), variant: z.literal('catalogue-link'), content: slot('home.closing'), target: idSchema }),
  z.strictObject({ ...base, type: z.literal('author-hero/1'), content: slot('home.author'), pathsTarget: idSchema, catalogueTarget: idSchema }),
  z.strictObject({ ...base, type: z.literal('author-story/1'), content: slot('home.story') }),
  z.strictObject({ ...base, type: z.literal('product-paths/1'), content: slot('home.paths') }),
  z.strictObject({ ...base, type: z.literal('project-showcase/1'), content: slot('home.projects') }),
] as const;
export const phase2SectionSchema = z.union(phase2Sections);
const sectionTargets = (recipe: { sections: z.infer<typeof phase2SectionSchema>[] }, ctx: z.RefinementCtx) => {
  const ids = new Set<string>();
  recipe.sections.forEach((section, index) => {
    if (ids.has(section.id)) ctx.addIssue({ code: 'custom', path: ['sections', index, 'id'], message: 'Section IDs must be distinct' });
    ids.add(section.id);
    const target = (key: 'target' | 'pathsTarget' | 'catalogueTarget', type: string) => {
      if (key in section && !recipe.sections.some(candidate => candidate.id === section[key as keyof typeof section] && candidate.type === type)) ctx.addIssue({ code: 'custom', path: ['sections', index, key], message: `Target must be a visible ${type}` });
    };
    target('target', 'catalogue/1'); target('catalogueTarget', 'catalogue/1'); target('pathsTarget', 'product-paths/1');
  });
  const h1s = recipe.sections.filter(section => section.type === 'hero-product/1' || section.type === 'author-hero/1' || (section.type === 'task-nav/1' && 'variant' in section && section.variant === 'search-hero'));
  if (h1s.length > 1) ctx.addIssue({ code: 'custom', path: ['sections'], message: 'At most one page heading owner' });
};
export const phase2StorefrontRecipeSchema = recipeSchema.extend({ sections: z.array(phase2SectionSchema).min(1).max(32) }).superRefine(sectionTargets);
const routeProduct = z.strictObject({ source: z.literal('route-product') });
const offerHero = z.strictObject({ ...base, type: z.literal('hero-product/1'), variant: z.literal('simple'), product: routeProduct, content: slot('offer.hero') });
const offerFaq = z.strictObject({ ...base, type: z.literal('faq/1'), content: slot('offer.faq') });
const offerClosing = z.strictObject({ ...base, type: z.literal('product-cta/1'), product: routeProduct, content: slot('offer.closing'), action: z.literal('buy') });
export const offerRecipeSchema = z.strictObject({ format: z.literal(1), surface: z.literal('offer'), shell: z.literal('offer/1'), sections: z.union([z.tuple([offerHero, offerClosing]), z.tuple([offerHero, offerFaq, offerClosing])]) }).refine(recipe => new Set(recipe.sections.map(section => section.id)).size === recipe.sections.length, 'Section IDs must be distinct');
export const phase2RecipeSchema = z.union([phase2StorefrontRecipeSchema, offerRecipeSchema]);
export const phase2ConfigSchema = configSchema.extend({
  templateId: z.enum(['default', 'd', 'storefront-a', 'storefront-b', 'storefront-c']),
  settingsByTemplate: configSchema.shape.settingsByTemplate.extend({ 'storefront-a': phase2SettingsSchema.pick({ heroProduct: true, starterProducts: true, taskCategories: true, density: true, comparisonProducts: true }).optional(), 'storefront-b': phase2SettingsSchema.pick({ closingProduct: true, taskCategories: true, density: true, featuredProducts: true }).optional(), 'storefront-c': phase2SettingsSchema.pick({ starterProducts: true, density: true }).optional() }),
  overridesByTemplate: configSchema.shape.overridesByTemplate.extend({
    'storefront-a': overridesSchema(SECTION_DESCRIPTORS['storefront-a']).optional(),
    'storefront-b': overridesSchema(SECTION_DESCRIPTORS['storefront-b']).optional(),
    'storefront-c': overridesSchema(SECTION_DESCRIPTORS['storefront-c']).optional(),
  }),
  content: phase2ContentSchema.omit({ 'offer.hero': true, 'offer.faq': true, 'offer.closing': true }),
});
export const offerConfigSchema = z.strictObject({ format: z.literal(1), enabled: z.boolean(), templateId: z.literal('offer-default'), settings: z.strictObject({ density: densitySchema }), content: phase2ContentSchema.pick({ 'offer.hero': true, 'offer.faq': true, 'offer.closing': true }), tokens: tokensSchema.nullable() });

export function validatePhase2(input: unknown, kind: 'config' | 'recipe' | 'offer-config'): ValidationResult {
  if (!isPlainJson(input)) return result([{ code: 'SCHEMA', path: '', message: 'Expected plain JSON data' }]);
  const parsed = ({ config: phase2ConfigSchema, recipe: phase2RecipeSchema, 'offer-config': offerConfigSchema })[kind].safeParse(input);
  if (!parsed.success) return result(parsed.error.issues.map(issue => ({ code: issue.code === 'too_big' || issue.code === 'too_small' ? 'LIMIT' : 'SCHEMA', path: pointer(issue.path), message: 'Value does not match frozen Phase 2 contract', ...(issue.code === 'too_big' && typeof issue.maximum === 'number' ? { limit: issue.maximum } : {}), ...(issue.code === 'too_small' && typeof issue.minimum === 'number' ? { limit: issue.minimum } : {}) })));
  const size = storedJsonBytes(parsed.data);
  if (size === null || size > CONFIG_BYTES) return result([{ code: 'LIMIT', path: '', message: 'Stored configuration exceeds byte limit', limit: CONFIG_BYTES }]);
  const warnings: ValidationResult['warnings'] = [];
  if (kind === 'offer-config') for (const [id, slot] of Object.entries(offerConfigSchema.parse(parsed.data).content)) {
    if (!slot.en || !slot.pl) warnings.push({ code: 'TRANSLATION_FALLBACK', path: `/content/${id}`, message: 'Missing translation uses source locale' });
  }
  return result([], warnings);
}
export type Phase2SectionSpec = z.infer<typeof phase2SectionSchema>;
export type Phase2SlotContent = z.infer<typeof phase2HeroContentSchema> | z.infer<typeof comparisonContentSchema> | z.infer<typeof searchContentSchema> | z.infer<typeof authorContentSchema> | z.infer<typeof biographyContentSchema> | z.infer<typeof pathsContentSchema> | z.infer<typeof projectsContentSchema>;
export type Phase2Settings = z.infer<typeof phase2SettingsSchema>;
type Phase2Content = z.infer<typeof phase2ContentSchema>;
type LocalizedValue<T> = T extends { sourceLocale: 'en'; en: infer Value } | { sourceLocale: 'pl'; pl: infer Value } ? Value : never;
export interface Phase2PublicInputs extends Omit<PublicInputs, 'catalogue'> {
  catalogue: Omit<CatalogueProps, 'variant'> & { variant: CatalogueProps['variant'] | 'compact' };
  settings: Phase2Settings;
  slots: { [Key in keyof Phase2Content]?: LocalizedValue<NonNullable<Phase2Content[Key]>> };
  mediaById: Record<string, NonNullable<PublicProductInfo['image']>>;
}
export interface OfferFocusProps extends Omit<HeroProductProps, 'variant' | 'content'> { variant: 'offer-focus'; content: z.infer<typeof phase2HeroContentSchema> | null }
export interface ComparisonProps { variant: 'comparison'; content: z.infer<typeof comparisonContentSchema> | null; products: PublicProductInfo[]; locale: 'en' | 'pl' }
export interface SearchHeroProps { variant: 'search-hero'; content: z.infer<typeof searchContentSchema> | null; categories: PublicCategoryInfo[]; target: string; locale: 'en' | 'pl' }
export interface CatalogueLinkProps { variant: 'catalogue-link'; content: z.infer<typeof ctaContentSchema> | null; target: string; locale: 'en' | 'pl' }
export interface AuthorHeroProps { content: z.infer<typeof authorContentSchema> | null; portrait: NonNullable<PublicProductInfo['image']> | null; pathsTarget: string; catalogueTarget: string; locale: 'en' | 'pl' }
export interface AuthorStoryProps { content: z.infer<typeof biographyContentSchema> | null; locale: 'en' | 'pl' }
export interface ProductPathsProps { heading: string; body: string; eyebrow?: string; actionLabel?: string; items: { id: string; situation: string; body: string; label?: string; product: PublicProductInfo }[]; locale: 'en' | 'pl' }
export interface ProjectShowcaseProps { heading: string; items: { id: string; name: string; body: string; url: string; media: NonNullable<PublicProductInfo['image']> | null }[]; locale: 'en' | 'pl' }
export type Phase2ResolvedSection = ResolvedSection
  | { id: string; type: 'hero-product/1'; props: OfferFocusProps }
  | { id: string; type: 'catalogue/1'; props: Omit<CatalogueProps, 'variant'> & { variant: 'compact' } }
  | { id: string; type: 'product-list/1'; props: ComparisonProps | { variant: 'featured-grid'; products: PublicProductInfo[]; content: z.infer<typeof featuredContentSchema> | null; locale: 'en' | 'pl' } }
  | { id: string; type: 'task-nav/1'; props: SearchHeroProps }
  | { id: string; type: 'product-cta/1'; props: CatalogueLinkProps }
  | { id: string; type: 'author-hero/1'; props: AuthorHeroProps }
  | { id: string; type: 'author-story/1'; props: AuthorStoryProps }
  | { id: string; type: 'product-paths/1'; props: ProductPathsProps }
  | { id: string; type: 'project-showcase/1'; props: ProjectShowcaseProps };
