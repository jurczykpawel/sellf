/** Independent storefront permissions. @see spec/contracts/licensing.md */
import { hasFeature } from '@/lib/license/features';
import { STOREFRONT_TEMPLATES } from '@/lib/storefront-templates/registry';
import type { LicenseTier } from '@/lib/license/features';
import type { StorefrontConfig } from '@/lib/storefront-templates/schemas';

export interface TemplateRights {
  canSwitch: boolean; canCustomizeTokens: boolean; availableTemplateIds: string[];
}
export function templateRightsForTier(tier: LicenseTier): TemplateRights {
  const canSwitch = hasFeature(tier, 'page-templates');
  return { canSwitch, canCustomizeTokens: hasFeature(tier, 'theme-customization'), availableTemplateIds:
    Object.values(STOREFRONT_TEMPLATES).filter(entry => entry.entitlement.kind === 'free' || entry.entitlement.kind === 'pro' && canSwitch).map(entry => entry.id) };
}
/** Draft authoring is independent of activation rights. */
export function canMutateTemplateConfig(rights: TemplateRights, next: StorefrontConfig, mode: 'draft' | 'publish'): boolean {
  if (mode === 'draft') return true;
  if (!rights.availableTemplateIds.includes(next.templateId)) return false;
  const activeOverrides = next.overridesByTemplate[next.templateId];
  if (!rights.canSwitch && activeOverrides && Object.values(activeOverrides).some(value => Object.keys(value).length > 0)) return false;
  return rights.canCustomizeTokens || !next.tokens || Object.entries(next.tokens).every(([key, value]) => key === 'format' || Object.keys(value).length === 0);
}
