/** Private storefront lifecycle for session actions and scoped API adapters. @see mutations.ts */
import 'server-only';
import { z } from 'zod';
import { API_SCOPES } from '@/lib/api/scope-constants';
import { getPublicLicenseTier } from '@/lib/license/public-snapshot';
import { checkRateLimit } from '@/lib/rate-limiting';
import { createPlatformClient } from '@/lib/supabase/admin';
import { isPlainJson, pointer, result } from '@/lib/storefront-templates/json';
import { diffTemplateConfigs, inspectTemplate, validateActiveBindings } from '@/lib/storefront-templates/lifecycle-validation';
import { getTemplatePrincipal, mutateStorefrontConfig, templateFailure } from '@/lib/storefront-templates/mutations';
import { readStorefrontConfig, readStorefrontHistory } from '@/lib/storefront-templates/repository';
import { templateRightsForTier } from '@/lib/storefront-templates/rights';
import { revisionSchema } from '@/lib/storefront-templates/schemas';
import { validateConfig } from '@/lib/storefront-templates/registry';
import type { ValidationResult } from '@/lib/storefront-templates/json';
import type { TemplateChange } from '@/lib/storefront-templates/lifecycle-validation';
import type { StorefrontMutationResult } from '@/lib/storefront-templates/mutations';
import type { StorefrontHistorySnapshot } from '@/lib/storefront-templates/repository';
import type { TemplateRights } from '@/lib/storefront-templates/rights';
import type { StorefrontConfig } from '@/lib/storefront-templates/schemas';
import type { EffectiveToken } from '@/lib/storefront-templates/public-theme';

const readSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('read') }),
  z.strictObject({ operation: z.literal('validate'), config: z.unknown(), mode: z.enum(['draft', 'publish']) }),
  z.strictObject({ operation: z.literal('diff'), fromRevision: revisionSchema, toRevision: revisionSchema }),
  z.strictObject({ operation: z.literal('history'), beforeRevision: revisionSchema.optional(), limit: z.number().int().min(1).max(50).optional() }),
]);
export interface TemplateReadResult {
  revision: number; draft: StorefrontConfig | null; published: StorefrontConfig; effectiveTemplateId: string;
  rights: TemplateRights; validation: ValidationResult; unusedSlots: string[]; effectiveTokens: EffectiveToken[];
}
export interface TemplateDiffResult {
  fromRevision: number; toRevision: number; changes: TemplateChange[]; unusedSlots: string[]; validation: ValidationResult;
}
export type LifecycleResult = StorefrontMutationResult | { success: true; data: TemplateReadResult | TemplateDiffResult | ValidationResult | StorefrontHistorySnapshot[] };

export async function storefrontLifecycle(auth: unknown, input: unknown): Promise<LifecycleResult> {
  const parsed = isPlainJson(input) ? readSchema.safeParse(input) : null;
  if (!parsed?.success) {
    // Mutations perform their own strict parsing and operation-specific scope check.
    if (isPlainJson(input) && input && typeof input === 'object' && 'operation' in input && ['draft', 'reset', 'legacy-import', 'publish', 'rollback'].includes(String(input.operation))) return mutateStorefrontConfig(auth, input);
    if (!getTemplatePrincipal(auth, API_SCOPES.TEMPLATES_READ) && !getTemplatePrincipal(auth, API_SCOPES.TEMPLATES_WRITE) && !getTemplatePrincipal(auth, API_SCOPES.TEMPLATES_ACTIVATE)) return templateFailure('FORBIDDEN');
    const revisionIssue = parsed && !parsed.success ? parsed.error.issues.find(issue => issue.path.some(part => ['fromRevision', 'toRevision', 'beforeRevision'].includes(String(part)))) : undefined;
    return revisionIssue ? templateFailure('LIMIT', result([{ code: 'LIMIT', path: pointer(revisionIssue.path), message: 'Invalid revision', limit: Number.MAX_SAFE_INTEGER }]))
      : templateFailure('INVALID', result([{ code: 'SCHEMA', path: '', message: 'Invalid lifecycle input' }]));
  }
  const actor = getTemplatePrincipal(auth, API_SCOPES.TEMPLATES_READ);
  if (!actor) return templateFailure('FORBIDDEN');
  try {
    if (!(await checkRateLimit('storefront_read', 120, 1, actor.userId))) return templateFailure('RATE_LIMITED');
    const operation = parsed.data;
    const rights = templateRightsForTier(getPublicLicenseTier());
    const client = createPlatformClient();
    if (operation.operation === 'validate') {
      const structural = validateConfig(operation.config);
      if (!structural.valid) return { success: true, data: structural };
      const config = operation.config as StorefrontConfig;
      const inspection = inspectTemplate(config, rights, operation.mode);
      const validation = operation.mode === 'publish' ? await validateActiveBindings(client, config, inspection.validation) : inspection.validation;
      return validation ? { success: true, data: validation } : templateFailure('UNAVAILABLE');
    }
    if (operation.operation === 'history') {
      const history = await readStorefrontHistory(client, { beforeRevision: operation.beforeRevision, limit: operation.limit });
      return history.success ? { success: true, data: history.data } : templateFailure('UNAVAILABLE');
    }
    if (operation.operation === 'read') {
      const snapshot = await readStorefrontConfig(client);
      if (!snapshot.success) return templateFailure('UNAVAILABLE');
      const { revision, draft, published } = snapshot.data;
      return { success: true, data: { revision, draft, published, rights, ...inspectTemplate(draft ?? published, rights, 'draft') } };
    }
    const readRevision = async (revision: number) => {
      const history = await readStorefrontHistory(client, { limit: 1, ...(revision < Number.MAX_SAFE_INTEGER ? { beforeRevision: revision + 1 } : {}) });
      return !history.success ? null : history.data[0]?.revision === revision ? history.data[0] : undefined;
    };
    const from = await readRevision(operation.fromRevision);
    const to = await readRevision(operation.toRevision);
    if (from === null || to === null) return templateFailure('UNAVAILABLE');
    if (!from || !to) return templateFailure('NOT_FOUND');
    const before = from.draft ?? from.published; const after = to.draft ?? to.published;
    const { unusedSlots, validation } = inspectTemplate(after, rights, 'draft');
    return { success: true, data: { fromRevision: from.revision, toRevision: to.revision, changes: diffTemplateConfigs(before, after), unusedSlots, validation } };
  } catch { return templateFailure('UNAVAILABLE'); }
}
