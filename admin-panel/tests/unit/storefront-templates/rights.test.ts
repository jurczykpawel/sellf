/** Template and appearance rights. @see src/lib/storefront-templates/rights.ts */
import { expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, D_CONFIG } from '@/lib/storefront-templates/fixtures';
import { templateRightsForTier, canMutateTemplateConfig } from '@/lib/storefront-templates/rights';
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
  expect(canMutateTemplateConfig(rights, D_CONFIG, DEFAULT_CONFIG)).toBe(true);
  const custom = { ...D_CONFIG, tokens: { format: 1 as const, typography: { font: 'dm-sans' as const } } };
  expect(canMutateTemplateConfig(rights, custom, D_CONFIG)).toBe(false);
  expect(canMutateTemplateConfig({ ...rights, canSwitch: false, availableTemplateIds: ['default'] }, custom, D_CONFIG)).toBe(false);
  expect(rights).not.toHaveProperty('watermark');
});
it('allows free content changes and retained settings but requires rights for layout or token changes', () => {
  const rights = templateRightsForTier('free'); const original = { ...D_CONFIG, templateId: 'default' as const };
  const edited = { ...original, content: { ...DEFAULT_CONFIG.content } };
  expect(canMutateTemplateConfig(rights, edited, original)).toBe(true);
  expect(canMutateTemplateConfig(rights, { ...edited, overridesByTemplate: { default: { variants: { catalogue: 'detail-cards' } } } }, original)).toBe(false);
  expect(canMutateTemplateConfig(rights, { ...edited, tokens: { format: 1 } }, original)).toBe(false);
  expect(canMutateTemplateConfig(rights, D_CONFIG, original)).toBe(false);
  expect(canMutateTemplateConfig(templateRightsForTier('pro'), D_CONFIG, original)).toBe(true);
});
