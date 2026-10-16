/** Reset and diff field semantics. @see src/lib/storefront-templates/lifecycle-validation.ts */
import { expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, D_CONFIG, D_TOKENS } from '@/lib/storefront-templates/fixtures';
import { templateCapabilities } from '@/lib/storefront-templates/capabilities';
import { diffTemplateConfigs, inspectTemplate, resetTemplateField } from '@/lib/storefront-templates/lifecycle-validation';
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
  const config = { ...DEFAULT_CONFIG, overridesByTemplate: { default: { variants: { catalogue: 'detail-cards' as const } } } };
  expect(resetTemplateField(config, 'default', 'overrides.variants.catalogue')).toEqual(DEFAULT_CONFIG);
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
