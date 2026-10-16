/** Independent storefront permissions. @see spec/contracts/licensing.md */
import { isDeepStrictEqual } from 'node:util';
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
export function canMutateTemplateConfig(rights: TemplateRights, next: StorefrontConfig, current: StorefrontConfig): boolean {
  if (!rights.availableTemplateIds.includes(next.templateId)) return false;
  if (!rights.canSwitch && (next.templateId !== current.templateId || !isDeepStrictEqual(next.overridesByTemplate, current.overridesByTemplate))) return false;
  return rights.canCustomizeTokens || isDeepStrictEqual(next.tokens, current.tokens);
}
