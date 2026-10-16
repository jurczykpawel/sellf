/** Template and appearance rights. @see src/lib/storefront-templates/rights.ts */
import { expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, D_CONFIG } from '@/lib/storefront-templates/fixtures';
import { templateRightsForTier, canMutateTemplateConfig } from '@/lib/storefront-templates/rights';
import { STOREFRONT_TEMPLATES } from '@/lib/storefront-templates/registry';
import type { TemplateRegistryEntry } from '@/lib/storefront-templates/schemas';
import { resolveSelection } from '@/lib/storefront-templates/resolver';
vi.mock('@/components/storefront/sections/HeroProduct.module.css', () => ({ default: {} }));
it.each(['free', 'registered', 'pro', 'business'] as const)('resolves %s independently of retained selection', tier => {
  const rights = templateRightsForTier(tier); const paid = tier === 'pro' || tier === 'business';
  expect(rights.canSwitch).toBe(paid); expect(rights.canCustomizeTokens).toBe(paid);
  expect(rights.availableTemplateIds).toEqual(paid ? ['default', 'd'] : ['default']);
  expect(resolveSelection(D_CONFIG, rights.availableTemplateIds).templateId).toBe(paid ? 'd' : 'default');
  expect(resolveSelection(DEFAULT_CONFIG, rights.availableTemplateIds).templateId).toBe('default');
});
it('keeps selection, token editing and watermark rights independent', () => {
  const rights = { ...templateRightsForTier('pro'), canCustomizeTokens: false };
  expect(canMutateTemplateConfig(rights, D_CONFIG, 'publish')).toBe(true);
  const custom = { ...D_CONFIG, tokens: { format: 1 as const, typography: { font: 'dm-sans' as const } } };
  expect(canMutateTemplateConfig(rights, custom, 'publish')).toBe(false);
  expect(canMutateTemplateConfig({ ...rights, canSwitch: false, availableTemplateIds: ['default'] }, custom, 'publish')).toBe(false);
  expect(rights).not.toHaveProperty('watermark');
});
it('allows free content changes and retained settings but requires rights for layout or token changes', () => {
  const rights = templateRightsForTier('free'); const original = { ...D_CONFIG, templateId: 'default' as const };
  const edited = { ...original, content: { ...DEFAULT_CONFIG.content } };
  expect(canMutateTemplateConfig(rights, edited, 'publish')).toBe(true);
  expect(canMutateTemplateConfig(rights, { ...edited, overridesByTemplate: { default: { sections: { catalogue: { variant: 'detail-cards' } } } } }, 'publish')).toBe(false);
  expect(canMutateTemplateConfig(rights, { ...edited, tokens: { format: 1, typography: { font: 'dm-sans' } } }, 'publish')).toBe(false);
  expect(canMutateTemplateConfig(rights, D_CONFIG, 'publish')).toBe(false);
  expect(canMutateTemplateConfig(templateRightsForTier('pro'), D_CONFIG, 'publish')).toBe(true);
});

it('permits free draft authoring without granting activation', () => {
  const rights = templateRightsForTier('free');
  expect(canMutateTemplateConfig(rights, D_CONFIG, 'draft')).toBe(true);
  expect(canMutateTemplateConfig(rights, D_CONFIG, 'publish')).toBe(false);
});

it('requires both current platform rights and the matching locally confirmed template key', () => {
  const registry = STOREFRONT_TEMPLATES as Record<string, TemplateRegistryEntry>;
  const original = registry['storefront-a'];
  registry['storefront-a'] = { ...registry.d, id: 'storefront-a', entitlement: { kind: 'template-key', templateId: 'storefront-a' } };
  try {
    for (const tier of ['pro', 'business'] as const) {
      expect(templateRightsForTier(tier, ['storefront-a']).availableTemplateIds).toContain('storefront-a');
      expect(templateRightsForTier(tier, ['storefront-b']).availableTemplateIds).not.toContain('storefront-a');
      expect(templateRightsForTier(tier).availableTemplateIds).not.toContain('storefront-a');
    }
    for (const tier of ['free', 'registered'] as const) expect(templateRightsForTier(tier, ['storefront-a']).availableTemplateIds).toEqual(['default']);
  } finally { registry['storefront-a'] = original; }
});
