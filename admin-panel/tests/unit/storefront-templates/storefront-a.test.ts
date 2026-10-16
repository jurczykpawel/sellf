/** Premium A composition acceptance. */
import { describe, expect, it, vi } from 'vitest';
import { A_TOKENS, D_CONFIG } from '@/lib/storefront-templates/fixtures';
import { resolvePresentation, resolveSelection } from '@/lib/storefront-templates/resolver';
import { templateRightsForTier } from '@/lib/storefront-templates/rights';
import { STOREFRONT_TEMPLATES, validateConfig } from '@/lib/storefront-templates/registry';
import { validateThemeContrast } from '@/lib/storefront-templates/public-theme';
import { referenceConfig } from '../../fixtures/storefront-sections/phase2/contracts';
import { referenceProducts, referenceCategories } from '../../fixtures/storefront-sections/phase2/reference';

vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
function aConfig() {
  const reference = referenceConfig();
  return { ...D_CONFIG, templateId: 'storefront-a', settingsByTemplate: { ...D_CONFIG.settingsByTemplate, 'storefront-a': reference.settingsByTemplate['storefront-a'] },
    content: Object.fromEntries(Object.entries(reference.content).filter(([key]) => ['home.hero', 'home.tasks', 'home.comparison', 'home.starts', 'home.faq', 'home.closing'].includes(key))) };
}
describe('premium A', () => {
  it('ships reviewed tokens and seller-neutral recipe data', () => {
    expect(validateThemeContrast(A_TOKENS)).toEqual([]);
    expect(JSON.stringify(STOREFRONT_TEMPLATES['storefront-a'])).not.toMatch(/techskills|Etsy|PostStack|TSA|n8n/i);
  });
  it('requires its own confirmation and a platform tier', () => {
    for (const [tier, keys, selected] of [
      ['free', ['storefront-a'], 'default'], ['pro', [], 'default'], ['pro', ['storefront-b'], 'default'],
      ['pro', ['storefront-a'], 'storefront-a'], ['business', ['storefront-a'], 'storefront-a'],
    ] as const) expect(resolveSelection(aConfig(), templateRightsForTier(tier, keys).availableTemplateIds).templateId).toBe(selected);
  });
  for (const locale of ['en', 'pl'] as const) it(`${locale}: composes the exact ordered map from canonical inputs`, () => {
    const products = referenceProducts(locale).map(p => ({ ...p, image: null })); const categories = referenceCategories(locale);
    const model = resolvePresentation(resolveSelection(aConfig(), ['default', 'storefront-a']), { locale, productsById: Object.fromEntries(products.map(p => [p.id, p])), categoriesById: Object.fromEntries(categories.map(c => [c.id, c])),
      catalogue: { variant: 'compact', groups: { all: { products, nextCursor: null } }, filters: [], pageSize: 24, density: 'comfortable', locale } });
    expect(model.templateId).toBe('storefront-a');
    expect(model.sections.map(s => s.id)).toEqual(['hero', 'tasks', 'comparison', 'start', 'catalogue', 'faq', 'closing']);
    expect(model.sections[0]).toMatchObject({ props: { variant: 'offer-focus', product: products[1] } });
    expect(model.sections[2]).toMatchObject({ props: { variant: 'comparison', products: products.slice(0, 2) } });
    expect(model.sections[4]).toMatchObject({ props: { variant: 'compact' } });
    expect(model.sections[6]).toMatchObject({ props: { variant: 'catalogue-link', target: 'catalogue' } });
  });
  it('retains seller copy and inactive settings across A → D → A', () => {
    const config = aConfig(); const before = JSON.stringify(config);
    expect(validateConfig(config).valid).toBe(true);
    const selected = resolveSelection(config, ['storefront-a']);
    expect(resolveSelection({ ...config, templateId: 'd' }, ['d']).templateId).toBe('d');
    expect(resolveSelection(config, ['storefront-a'])).toEqual(selected);
    expect(JSON.stringify(config)).toBe(before);
  });
});
