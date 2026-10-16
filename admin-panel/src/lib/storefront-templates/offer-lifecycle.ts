/** Product-scoped offer operations using the shared template authorization boundary. @see lifecycle.ts */
import 'server-only';
import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';
import { API_SCOPES } from '@/lib/api/scope-constants';
import { isDemoMode } from '@/lib/demo-guard';
import { getPublicLicenseTier } from '@/lib/license/public-snapshot';
import { checkRateLimit } from '@/lib/rate-limiting';
import { createAdminClient, createPlatformClient } from '@/lib/supabase/admin';
import { CONFIG_BYTES, isPlainJson, result } from '@/lib/storefront-templates/json';
import { diffTemplateConfigs } from '@/lib/storefront-templates/lifecycle-validation';
import { getTemplatePrincipal, templateFailure } from '@/lib/storefront-templates/mutations';
import { readOfferConfig, readOfferHistory } from '@/lib/storefront-templates/offer-repository';
import { DEFAULT_OFFER } from '@/lib/storefront-templates/offer';
import { offerConfigSchema, validatePhase2 } from '@/lib/storefront-templates/phase2-contracts';
import { CORE_TOKENS, validateThemeContrast } from '@/lib/storefront-templates/public-theme';
import { templateRightsForTier } from '@/lib/storefront-templates/rights';
import { revisionSchema } from '@/lib/storefront-templates/schemas';
import type { ValidationResult } from '@/lib/storefront-templates/json';
import type { TemplateChange } from '@/lib/storefront-templates/lifecycle-validation';
import type { StorefrontMutationResult } from '@/lib/storefront-templates/mutations';
import type { OfferPageConfig, OfferHistorySnapshot } from '@/lib/storefront-templates/offer-repository';
import type { Json } from '@/types/database';

const base = { productId: z.uuid() };
const expectedRevision = revisionSchema;
const schema = z.discriminatedUnion('operation', [
  z.strictObject({ ...base, operation: z.literal('read') }),
  z.strictObject({ ...base, operation: z.literal('history'), beforeRevision: revisionSchema.optional(), limit: z.number().int().min(1).max(50).optional() }),
  z.strictObject({ ...base, operation: z.literal('diff'), fromRevision: revisionSchema, toRevision: revisionSchema }),
  z.strictObject({ ...base, operation: z.literal('validate'), config: z.unknown(), mode: z.enum(['draft', 'publish']) }),
  z.strictObject({ ...base, operation: z.literal('draft'), expectedRevision, config: offerConfigSchema }),
  z.strictObject({ ...base, operation: z.literal('reset'), expectedRevision, field: z.enum(['appearance', 'density']) }),
  z.strictObject({ ...base, operation: z.literal('publish'), expectedRevision }),
  z.strictObject({ ...base, operation: z.literal('rollback'), expectedRevision, targetRevision: revisionSchema }),
]);
export interface OfferReadResult {
  productId: string; productName: string; revision: number; draft: OfferPageConfig | null; published: OfferPageConfig | null;
  validation: ValidationResult;
}
export interface OfferDiffResult { fromRevision: number; toRevision: number; changes: TemplateChange[]; validation: ValidationResult; unusedSlots: string[] }
export type OfferLifecycleResult = StorefrontMutationResult | { success: true; data: OfferReadResult | OfferDiffResult | ValidationResult | OfferHistorySnapshot[] };

export function inspectOffer(config: OfferPageConfig, mode: 'draft' | 'publish'): ValidationResult {
  const validation = validatePhase2(config, 'offer-config');
  const issues = mode === 'publish' ? validation.errors : validation.warnings;
  if (config.tokens && !templateRightsForTier(getPublicLicenseTier()).canCustomizeTokens) issues.push({ code: 'ENTITLEMENT', path: '/tokens', message: 'Current rights do not permit custom appearance publication' });
  for (const path of validateThemeContrast(config.tokens ?? CORE_TOKENS)) issues.push({ code: 'CONTRAST', path: `/${path.replaceAll('.', '/')}`, message: 'Appearance needs more contrast' });
  validation.valid = validation.errors.length === 0;
  return validation;
}

export async function offerLifecycle(auth: unknown, input: unknown): Promise<OfferLifecycleResult> {
  const operation = isPlainJson(input) && input && typeof input === 'object' && 'operation' in input ? String(input.operation) : '';
  const mode = ['publish', 'rollback'].includes(operation) ? 'publish' : 'draft';
  const mutation = ['draft', 'reset', 'publish', 'rollback'].includes(operation);
  const actor = getTemplatePrincipal(auth, mutation ? mode === 'publish' ? API_SCOPES.TEMPLATES_ACTIVATE : API_SCOPES.TEMPLATES_WRITE : API_SCOPES.TEMPLATES_READ);
  if (!actor) return templateFailure('FORBIDDEN');
  if (operation === 'draft' && isPlainJson(input) && input && typeof input === 'object' && 'config' in input) {
    const validation = validatePhase2(input.config, 'offer-config');
    if (!validation.valid) return templateFailure(validation.errors.some(issue => issue.code === 'LIMIT') ? 'LIMIT' : 'INVALID', validation);
  }
  const parsed = isPlainJson(input) ? schema.safeParse(input) : null;
  if (!parsed?.success) {
    const limit = parsed && parsed.error.issues.some(issue => issue.path.some(part => String(part).includes('Revision')));
    return templateFailure(limit ? 'LIMIT' : 'INVALID');
  }
  const request = parsed.data;
  const productId = request.productId.toLowerCase();
  try {
    if (mutation && isDemoMode()) return templateFailure('FORBIDDEN');
    if (!(await checkRateLimit(mutation ? 'offer_mutation' : 'offer_read', mutation ? 60 : 120, 1, actor.userId))) return templateFailure('RATE_LIMITED');
    const reader = createPlatformClient();
    const product = await reader.from('products').select('id,name,slug,is_active,is_listed').eq('id', productId).maybeSingle();
    if (product.error) return templateFailure('UNAVAILABLE');
    if (!product.data) return templateFailure('NOT_FOUND');
    const historyAt = async (revision: number) => {
      const page = await readOfferHistory(reader, productId, { limit: 1, ...(revision < Number.MAX_SAFE_INTEGER ? { beforeRevision: revision + 1 } : {}) });
      return !page.success ? null : page.data[0]?.revision === revision ? page.data[0] : undefined;
    };
    if (request.operation === 'history') {
      const history = await readOfferHistory(reader, productId, { limit: request.limit, beforeRevision: request.beforeRevision });
      return history.success ? history : templateFailure('UNAVAILABLE');
    }
    if (request.operation === 'diff') {
      const from = await historyAt(request.fromRevision); const to = await historyAt(request.toRevision);
      if (from === null || to === null) return templateFailure('UNAVAILABLE');
      if (!from || !to) return templateFailure('NOT_FOUND');
      return { success: true, data: { fromRevision: from.revision, toRevision: to.revision,
        changes: diffTemplateConfigs(from.draft ?? from.published, to.draft ?? to.published), unusedSlots: [], validation: result() } };
    }
    if (request.operation === 'validate') {
      const structural = validatePhase2(request.config, 'offer-config');
      return { success: true, data: structural.valid ? inspectOffer(request.config as OfferPageConfig, request.mode) : structural };
    }
    const snapshot = await readOfferConfig(reader, productId);
    if (!snapshot.success) return templateFailure('UNAVAILABLE');
    const current = snapshot.data ?? { revision: 0, draft: null, published: null };
    if (request.operation === 'read') return { success: true, data: { productId, productName: product.data.name, ...current, validation: inspectOffer(current.draft ?? current.published ?? DEFAULT_OFFER, 'draft') } };
    if (request.expectedRevision !== current.revision) return templateFailure('CONFLICT', null, current.revision);
    let candidate: OfferPageConfig | null = current.draft;
    if (request.operation === 'draft') candidate = request.config;
    if (request.operation === 'reset') {
      candidate = structuredClone(current.draft ?? current.published ?? DEFAULT_OFFER);
      if (request.field === 'appearance') candidate.tokens = null;
      else candidate.settings.density = 'comfortable';
    }
    if (request.operation === 'rollback') {
      const target = await historyAt(request.targetRevision);
      if (target === null) return templateFailure('UNAVAILABLE');
      if (!target) return templateFailure('NOT_FOUND');
      candidate = target.published;
    }
    if (!candidate && request.operation !== 'rollback') return templateFailure('INVALID');
    const validation = candidate ? inspectOffer(candidate, mode) : result();
    if (validation.errors.some(issue => issue.code === 'ENTITLEMENT')) return templateFailure('FORBIDDEN', validation);
    if (!validation.valid) return templateFailure(validation.errors.some(issue => issue.code === 'LIMIT') ? 'LIMIT' : 'INVALID', validation);
    if (mode === 'publish' && candidate?.enabled && (!product.data.is_active || !product.data.is_listed)) return templateFailure('INVALID', result([{ code: 'BINDING', path: '/productId', message: 'Make the product active and listed before publishing its offer' }]));
    const client = createAdminClient();
    const config = request.operation === 'draft' || request.operation === 'reset' ? candidate : null;
    if (config) {
      const size = await client.rpc('storefront_config_stored_bytes', { config: config as Json });
      if (size.error || !Number.isInteger(size.data)) return templateFailure('UNAVAILABLE');
      if (size.data! > CONFIG_BYTES) return templateFailure('LIMIT');
    }
    if (candidate && mode === 'publish' && inspectOffer(candidate, mode).errors.some(issue => issue.code === 'ENTITLEMENT')) return templateFailure('FORBIDDEN');
    const response = await client.rpc('mutate_product_offer', {
      offer_product_id: productId, expected_revision: request.expectedRevision, operation: request.operation,
      validated_config: config as Json, actor_user_id: actor.userId, actor_method: actor.method,
      ...(actor.apiKeyId ? { actor_api_key_id: actor.apiKeyId } : {}),
      ...(request.operation === 'rollback' ? { restored_from: request.targetRevision } : {}),
    });
    const data = response.data;
    if (response.error || !data || typeof data !== 'object' || Array.isArray(data)) return templateFailure('UNAVAILABLE');
    if (data.success === true && revisionSchema.safeParse(data.revision).success) {
      if (mode === 'publish') try {
        for (const tag of ['storefront-products', 'product-by-slug', `product:${productId}`, `product:${product.data.slug}`]) revalidateTag(tag, { expire: 0 });
        revalidatePath('/', 'layout');
      } catch { validation.warnings.push({ code: 'COMPATIBILITY', path: '', message: 'Publication saved; public caches will refresh on expiry' }); }
      return { success: true, revision: data.revision as number, validation };
    }
    const codes = ['FORBIDDEN', 'CONFLICT', 'INVALID', 'NOT_FOUND', 'UNAVAILABLE', 'LIMIT'] as const;
    const code = codes.find(code => code === data.code) ?? 'UNAVAILABLE';
    return templateFailure(code, null, code === 'CONFLICT' && revisionSchema.safeParse(data.currentRevision).success ? data.currentRevision as number : null);
  } catch { return templateFailure('UNAVAILABLE'); }
}
