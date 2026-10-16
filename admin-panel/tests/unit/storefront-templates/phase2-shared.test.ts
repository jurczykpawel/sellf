/** T2.5 author bounds and public resolver boundaries. @see D-055 */
import { describe, expect, it } from 'vitest';
import { phase2ContentSchema, phase2StorefrontRecipeSchema } from '@/lib/storefront-templates/phase2-contracts';
import { resolveSharedPhase2Section } from '@/lib/storefront-templates/phase2-shared';
import { referenceConfig, phase2Recipes, uuid } from '../../fixtures/storefront-sections/phase2/contracts';
import { referenceProducts, referenceCategories } from '../../fixtures/storefront-sections/phase2/reference';

const config = referenceConfig();
const inputs = { locale: 'en' as const, settings: config.settingsByTemplate['storefront-a'],
  slots: Object.fromEntries(Object.entries(config.content).map(([key, value]) => [key, value.en])),
  productsById: Object.fromEntries(referenceProducts('en').map(value => [value.id, value])),
  categoriesById: Object.fromEntries(referenceCategories('en').map(value => [value.id, value])) };

describe('T2.5 shared variants', () => {
  it('preserves optional localized concept facts and rejects excess/HTML/unknown inputs', () => {
    expect(phase2ContentSchema.parse(config.content)).toEqual(config.content);
    for (const field of ['en', 'pl'] as const) {
      expect(config.content['home.hero'][field].stepDetails).toHaveLength(3);
      expect(config.content['home.hero'][field].staticDemo.title).toBeTruthy();
      expect(config.content['home.search'][field].eyebrow).toBeTruthy();
    }
    for (const patch of [{ mediaCaption: 'x'.repeat(81) }, { stepDetails: Array(7).fill('x') }, { stepDetails: ['x'.repeat(1001)] }, { staticDemo: { title: 'x'.repeat(161), body: '' } }, { staticDemo: { title: 'x', body: 'x'.repeat(1001) } }, { staticDemo: { title: '<script>', body: '' } }, { staticDemo: { title: 'x', body: '', url: 'https://example.test' } }]) {
      expect(phase2ContentSchema.safeParse({ 'home.hero': { sourceLocale: 'en', en: { ...config.content['home.hero'].en, ...patch } } }).success).toBe(false);
    }
    expect(phase2ContentSchema.safeParse({ 'home.search': { sourceLocale: 'en', en: { ...config.content['home.search'].en, eyebrow: 'x'.repeat(81) } } }).success).toBe(false);
  });
  it('accepts exact limits and old author inputs without changing Phase 1', () => {
    const hero = { ...config.content['home.hero'].en, stepDetails: Array(6).fill('x'.repeat(1000)), staticDemo: { title: 'x'.repeat(160), body: 'x'.repeat(1000) } };
    expect(phase2ContentSchema.safeParse({ 'home.hero': { sourceLocale: 'en', en: hero } }).success).toBe(true);
    const { stepDetails, staticDemo, ...oldHero } = hero;
    expect(stepDetails).toHaveLength(6);
    expect(staticDemo.title).toHaveLength(160);
    expect(phase2ContentSchema.safeParse({ 'home.hero': { sourceLocale: 'en', en: oldHero } }).success).toBe(true);
  });
  it('resolves core product and category order without I/O or product binding on closing', () => {
    const recipe = phase2StorefrontRecipeSchema.parse(phase2Recipes.a);
    const hero = resolveSharedPhase2Section(recipe.sections[0], inputs, recipe);
    expect(hero.success && hero.data.props).toMatchObject({ variant: 'offer-focus', product: inputs.productsById[uuid(2)], content: config.content['home.hero'].en });
    const closing = resolveSharedPhase2Section(recipe.sections.at(-1), inputs, recipe);
    expect(closing.success && closing.data.props).toEqual({ variant: 'catalogue-link', target: 'catalogue', content: config.content['home.closing'].en, locale: 'en' });
    const b = phase2StorefrontRecipeSchema.parse(phase2Recipes.b);
    const search = resolveSharedPhase2Section(b.sections[0], inputs, b);
    expect(search.success && search.data.props).toMatchObject({ variant: 'search-hero', categories: referenceCategories('en') });
  });
  it('rejects wrong/missing catalogue targets, foreign categories and forged core actions', () => {
    const recipe = phase2StorefrontRecipeSchema.parse(phase2Recipes.a);
    for (const target of ['missing', 'faq']) expect(resolveSharedPhase2Section({ ...recipe.sections.at(-1), target }, inputs, recipe).success).toBe(false);
    expect(resolveSharedPhase2Section(recipe.sections.at(-1), inputs, { ...recipe, sections: recipe.sections.filter(s => s.type !== 'catalogue/1') }).success).toBe(false);
    const b = phase2StorefrontRecipeSchema.parse(phase2Recipes.b);
    expect(resolveSharedPhase2Section(b.sections[0], { ...inputs, categoriesById: { [uuid(1)]: { ...referenceCategories('en')[0], filterTarget: 'other' } } }, b).success).toBe(false);
    expect(resolveSharedPhase2Section(recipe.sections[0], { ...inputs, productsById: { [uuid(2)]: { ...inputs.productsById[uuid(2)], actions: { details: 'https://evil.test', buy: '/checkout' } } } }, recipe).success).toBe(false);
  });
});
