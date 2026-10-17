/** Premium C installed contract acceptance. */
import { describe, expect, it } from 'vitest';
import { phase2ConfigSchema } from '@/lib/storefront-templates/phase2-contracts';
import { configSchema, registryEntrySchema } from '@/lib/storefront-templates/schemas';
import { STOREFRONT_TEMPLATES, normalizeConfigOrders, validateConfig, validateRecipe } from '@/lib/storefront-templates/registry';
import { templateCapabilities } from '@/lib/storefront-templates/capabilities';
import { validateThemeContrast } from '@/lib/storefront-templates/public-theme';
import { phase2Recipes, referenceConfig } from '../../fixtures/storefront-sections/phase2/contracts';

describe('premium C installed contract', () => {
  it('ships the exact frozen eight-block composition and approved neutral tokens', () => {
    const entry = STOREFRONT_TEMPLATES['storefront-c'];
    expect(entry).toBeDefined();
    expect(entry.defaults).toEqual({ ...phase2Recipes.c, sections: phase2Recipes.c.sections.map(section => section.id === 'catalogue' ? { ...section, pageSize: 24, content: { slot: 'home.catalogue' } } : section) });
    expect(registryEntrySchema.safeParse(entry).success).toBe(true);
    expect(validateThemeContrast(entry.tokens!)).toEqual([]);
    expect(JSON.stringify(entry)).not.toMatch(/techskills|Etsy|PostStack|TSA|n8n/i);
    expect(entry.entitlement).toEqual({ kind: 'template-key', templateId: 'storefront-c' });
  });
  it('advertises C slots, descriptor resets and its installed identity offline', () => {
    const capabilities = templateCapabilities();
    expect(capabilities.phase2.installedTemplateIds).toContain('storefront-c');
    expect(capabilities.slots).toMatchObject({ 'home.author': 'author', 'home.story': 'biography', 'home.paths': 'paths', 'home.projects': 'projects' });
    expect(capabilities.resetPaths['storefront-c']).toContain('overrides.sections.story.visibility');
    expect(capabilities.resetPaths['storefront-c']).not.toContain('overrides.sections.paths.visibility');
  });
  it('validates author destinations and a single page heading owner', () => {
    const recipe = STOREFRONT_TEMPLATES['storefront-c'].defaults;
    for (const type of ['product-paths/1', 'catalogue/1']) expect(validateRecipe({ ...recipe, sections: recipe.sections.filter(section => section.type !== type) }).valid).toBe(false);
    expect(validateRecipe({ ...recipe, sections: [...recipe.sections, { ...recipe.sections[0], id: 'other-hero' }] }).valid).toBe(false);
  });
  it('accepts the frozen biography, projects, paths and localized inactive slots across all selections', () => {
    const config = { ...referenceConfig(), templateId: 'storefront-c' };
    const before = JSON.stringify(config);
    for (const templateId of ['storefront-c', 'storefront-a', 'storefront-b', 'd', 'storefront-c']) {
      expect(validateConfig({ ...config, templateId }).valid).toBe(true);
      expect(configSchema.parse({ ...config, templateId }).content).toEqual(config.content);
    }
    expect(JSON.stringify(config)).toBe(before);
  });
  it('treats path product UUID casing as the same identity in both locales', () => {
    const original = { ...referenceConfig(), templateId: 'storefront-c' };
    const productId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
    for (const locale of ['en', 'pl'] as const) {
      const localized = original.content['home.paths'];
      const item = localized[locale].items[0];
      const config = { ...original, content: { ...original.content, 'home.paths': { ...localized, [locale]: { ...localized[locale], items: [{ ...item, id: 'first', productId }, { ...item, id: 'second', productId: productId.toUpperCase() }] } } } };
      expect(configSchema.safeParse(config).success).toBe(false);
      expect(phase2ConfigSchema.safeParse(config).success).toBe(false);
    }
    const one = { ...original, content: { ...original.content, 'home.paths': { sourceLocale: 'en', en: { ...original.content['home.paths'].en, items: [{ ...original.content['home.paths'].en.items[0], productId: productId.toUpperCase() }] } } } };
    expect(configSchema.safeParse(one).success).toBe(true);
  });
  it('normalizes inactive C intent and rejects unavailable visibility and variants', () => {
    const config = configSchema.parse({ ...referenceConfig(), templateId: 'storefront-c', overridesByTemplate: { 'storefront-c': { order: ['hero'], sections: { story: { visibility: 'hidden' }, start: { variant: 'compact' } } } } });
    expect(normalizeConfigOrders(config).overridesByTemplate['storefront-c']?.order).toEqual(['hero', 'story', 'paths', 'projects', 'start', 'catalogue', 'faq', 'closing']);
    for (const sections of [{ paths: { visibility: 'hidden' } }, { hero: { variant: 'simple' } }, { story: { variant: 'compact' } }]) {
      expect(configSchema.safeParse({ ...config, overridesByTemplate: { 'storefront-c': { sections } } }).success).toBe(false);
    }
  });
});
