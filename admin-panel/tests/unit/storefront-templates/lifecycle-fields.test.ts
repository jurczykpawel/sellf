/** Reset and diff field semantics. @see src/lib/storefront-templates/lifecycle-validation.ts */
import { expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, D_CONFIG, D_TOKENS } from '@/lib/storefront-templates/fixtures';
import { templateCapabilities } from '@/lib/storefront-templates/capabilities';
import { diffTemplateConfigs, inspectTemplate, resetTemplateField } from '@/lib/storefront-templates/lifecycle-validation';
import { effectiveLayout } from '@/lib/storefront-templates/layout';
import { STOREFRONT_TEMPLATES, validateConfig } from '@/lib/storefront-templates/registry';
import { templateRightsForTier } from '@/lib/storefront-templates/rights';
vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
it('supports every declared reset path without removing content or inactive settings', () => {
  const config = { ...structuredClone(D_CONFIG), tokens: structuredClone(D_TOKENS) };
  for (const field of templateCapabilities().resetPaths.d) {
    const reset = resetTemplateField(config, 'd', field)!;
    expect(reset, field).not.toBeNull(); expect(validateConfig(reset).valid, field).toBe(true);
    expect(reset.content).toEqual(config.content); expect(reset.settingsByTemplate.default).toEqual(config.settingsByTemplate.default);
    expect(resetTemplateField(reset, 'd', field)).toEqual(reset);
  }
  expect(config).toEqual({ ...D_CONFIG, tokens: D_TOKENS });
});
it('prunes only emptied optional parents and preserves required config maps', () => {
  const config = { ...DEFAULT_CONFIG, overridesByTemplate: { default: { sections: { catalogue: { variant: 'detail-cards' as const } } } } };
  expect(resetTemplateField(config, 'default', 'overrides.sections.catalogue.variant')).toEqual(DEFAULT_CONFIG);
  const density = { ...DEFAULT_CONFIG, settingsByTemplate: { d: { density: 'compact' as const } } };
  expect(resetTemplateField(density, 'd', 'settings.density')).toEqual(DEFAULT_CONFIG);
});
it('reset accent follows a later compatible default with template origin', () => {
  const config = { ...D_CONFIG, tokens: { format: 1 as const, light: { accent: '#075C43' } } };
  const reset = resetTemplateField(config, 'd', 'tokens.light.accent')!;
  const old = STOREFRONT_TEMPLATES.d.tokens.light.accent;
  try {
    STOREFRONT_TEMPLATES.d.tokens.light.accent = '#06513B';
    const rights = templateRightsForTier('pro');
    const leaf = (value: typeof config | typeof reset) => inspectTemplate(value, rights, 'draft').effectiveTokens.find(token => token.path === 'tokens.light.accent');
    expect(leaf(config)).toMatchObject({ value: '#075C43', origin: 'seller' });
    expect(leaf(reset)).toMatchObject({ value: '#06513B', origin: 'template' });
  } finally { STOREFRONT_TEMPLATES.d.tokens.light.accent = old; }
});
it('diffs arrays by index and distinguishes removed values from explicit null', () => {
  const before = structuredClone(D_CONFIG); const after = structuredClone(D_CONFIG);
  after.settingsByTemplate.d!.starterProducts!.pop();
  after.tokens = { format: 1 };
  const changes = diffTemplateConfigs(before, after);
  expect(changes).toContainEqual({ path: '/settingsByTemplate/d/starterProducts/2', kind: 'removed', before: before.settingsByTemplate.d!.starterProducts![2], after: null });
  expect(changes).toContainEqual({ path: '/tokens', kind: 'changed', before: null, after: { format: 1 } });
});

it('warns for missing visible content while keeping partial configurations valid', () => {
  const config = { ...D_CONFIG, content: {} };
  const validation = validateConfig(config);
  expect(validation.valid).toBe(true);
  expect(validation.warnings.filter(issue => issue.code === 'CONTENT_MISSING').map(issue => issue.path).sort()).toEqual([
    '/content/home.closing', '/content/home.faq', '/content/home.hero', '/content/home.starts', '/content/home.tasks',
  ]);
  config.overridesByTemplate = { d: { sections: { tasks: { visibility: 'hidden' }, start: { visibility: 'hidden' }, faq: { visibility: 'hidden' } } } };
  expect(validateConfig(config).warnings.filter(issue => issue.code === 'CONTENT_MISSING')).toHaveLength(2);
  expect(validateConfig(DEFAULT_CONFIG).warnings).toEqual([]);
});
it('warns for blank text and empty FAQ but accepts content in either locale', () => {
  const config = structuredClone(D_CONFIG);
  config.content['home.hero'] = { sourceLocale: 'en', en: { kind: 'hero', eyebrow: ' ', heading: '', body: '', steps: [] } };
  config.content['home.faq'] = { sourceLocale: 'en', en: { kind: 'faq', items: [] } };
  expect(validateConfig(config).warnings.filter(issue => issue.code === 'CONTENT_MISSING').map(issue => issue.path)).toEqual(['/content/home.hero', '/content/home.faq']);
  config.content['home.hero'].pl = { kind: 'hero', eyebrow: '', heading: 'Oferta', body: '', steps: [] };
  expect(validateConfig(config).warnings.filter(issue => issue.code === 'CONTENT_MISSING').map(issue => issue.path)).toEqual(['/content/home.faq']);
});
it('suppresses only absent versus empty default map entries in either diff direction', () => {
  const before = structuredClone(DEFAULT_CONFIG);
  const after = { ...before, settingsByTemplate: { default: {} }, overridesByTemplate: { default: {} } };
  expect(diffTemplateConfigs(before, after)).toEqual([]);
  expect(diffTemplateConfigs(after, before)).toEqual([]);
  expect(after.overridesByTemplate).toEqual({ default: {} });
  const withVariant = { ...after, overridesByTemplate: { default: { sections: { catalogue: { variant: 'detail-cards' as const } } } } };
  expect(diffTemplateConfigs(before, withVariant)).toContainEqual(expect.objectContaining({ path: '/overridesByTemplate/default', kind: 'added' }));
});

it('resets one section intent leaf to its current default, retaining the other leaf and content', () => {
  const config = { ...D_CONFIG, overridesByTemplate: { d: { sections: { start: { visibility: 'hidden' as const, variant: 'compact' as const } } } } };
  const visibility = resetTemplateField(config, 'd', 'overrides.sections.start.visibility')!;
  expect(visibility.overridesByTemplate.d?.sections?.start).toEqual({ variant: 'compact' });
  expect(effectiveLayout(STOREFRONT_TEMPLATES.d, visibility.overridesByTemplate.d).sections.find(section => section.id === 'start')).toMatchObject({ visibility: 'visible', variant: 'compact' });
  const variant = resetTemplateField(config, 'd', 'overrides.sections.start.variant')!;
  expect(variant.overridesByTemplate.d?.sections?.start).toEqual({ visibility: 'hidden' });
  expect(effectiveLayout(STOREFRONT_TEMPLATES.d, variant.overridesByTemplate.d).sections.find(section => section.id === 'start')).toMatchObject({ visibility: 'hidden', variant: 'detail-cards' });
  expect(variant.content).toEqual(D_CONFIG.content);
  expect(resetTemplateField(config, 'd', 'overrides.hidden')).toBeNull();
  expect(resetTemplateField(config, 'd', 'overrides.variants.start')).toBeNull();
});
