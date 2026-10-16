/** Private storefront mutation boundary. @see supabase/tests/storefront-mutations.sql */
import 'server-only';
import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';
import { authenticateApiKeyPrincipal } from '@/lib/api/middleware';
import { API_SCOPES } from '@/lib/api/scope-constants';
import { requireAdminApi } from '@/lib/auth-server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, createPlatformClient } from '@/lib/supabase/admin';
import { getPublicLicenseTier } from '@/lib/license/public-snapshot';
import { isDemoMode } from '@/lib/demo-guard';
import { checkRateLimit } from '@/lib/rate-limiting';
import { inspectTemplate, resetTemplateField, validateActiveBindings } from '@/lib/storefront-templates/lifecycle-validation';
import { templateRightsForTier, canMutateTemplateConfig } from '@/lib/storefront-templates/rights';
import { readStorefrontConfig, readStorefrontHistory } from '@/lib/storefront-templates/repository';
import { configSchema, revisionSchema, templateIdSchema } from '@/lib/storefront-templates/schemas';
import { validateConfig } from '@/lib/storefront-templates/registry';
import { CONFIG_BYTES, isPlainJson, result } from '@/lib/storefront-templates/json';
import type { NextRequest } from 'next/server';
import type { ValidationResult } from '@/lib/storefront-templates/json';
import type { Json } from '@/types/database';

interface VerifiedTemplatePrincipal { userId: string; method: 'session' | 'api_key'; apiKeyId: string | null }
interface PrincipalContext { actor: VerifiedTemplatePrincipal; scopes: readonly string[] }
const principals = new WeakMap<object, PrincipalContext>();
const actorSchema = z.strictObject({ userId: z.uuid(), method: z.enum(['session', 'api_key']), apiKeyId: z.uuid().nullable() });
export const mutationSchema = z.discriminatedUnion('operation', [
  z.strictObject({ expectedRevision: revisionSchema, operation: z.literal('draft'), config: configSchema }),
  z.strictObject({ expectedRevision: revisionSchema, operation: z.literal('legacy-import'), config: configSchema,
    legacySource: z.strictObject({ sha256: z.string().regex(/^[a-f0-9]{64}$/), byteLength: z.number().int().min(0).max(CONFIG_BYTES) }) }),
  z.strictObject({ expectedRevision: revisionSchema, operation: z.literal('reset'), templateId: templateIdSchema, field: z.string().max(100) }),
  z.strictObject({ expectedRevision: revisionSchema, operation: z.literal('publish') }),
  z.strictObject({ expectedRevision: revisionSchema, operation: z.literal('rollback'), targetRevision: revisionSchema }),
]);
const failureCodes = ['FORBIDDEN', 'CONFLICT', 'INVALID', 'NOT_FOUND', 'UNAVAILABLE', 'LIMIT', 'RATE_LIMITED'] as const;
type FailureCode = typeof failureCodes[number];
export type StorefrontMutationResult = { success: true; revision: number; validation: ValidationResult } | {
  success: false; code: FailureCode; status: number; message: string; validation: ValidationResult | null; currentRevision: number | null;
};
export function templateFailure(code: FailureCode, validation: ValidationResult | null = null, currentRevision: number | null = null): StorefrontMutationResult {
  const status = { FORBIDDEN: 403, CONFLICT: 409, INVALID: 422, NOT_FOUND: 404, UNAVAILABLE: 503, LIMIT: 422, RATE_LIMITED: 429 }[code];
  return { success: false, code, status, message: 'Storefront mutation could not be completed', validation, currentRevision };
}
function issue(actor: VerifiedTemplatePrincipal, scopes: readonly string[]): VerifiedTemplatePrincipal | null {
  if (!actorSchema.safeParse(actor).success) return null;
  const principal = Object.freeze({ ...actor });
  principals.set(principal, { actor: principal, scopes: [...scopes] });
  return principal;
}

export async function verifyTemplateSession(request?: NextRequest): Promise<VerifiedTemplatePrincipal | null> {
  try {
    const { user } = await requireAdminApi(await createClient(), request);
    return issue({ userId: user.id, method: 'session', apiKeyId: null }, []);
  } catch { return null; }
}

export async function verifyTemplateApiKey(request: NextRequest): Promise<VerifiedTemplatePrincipal | null> {
  try {
    const auth = await authenticateApiKeyPrincipal(request);
    if (auth.method !== 'api_key') return null;
    return issue({ userId: auth.admin.userId, method: 'api_key', apiKeyId: auth.apiKey.id }, auth.scopes);
  } catch { return null; }
}

export function getTemplatePrincipal(auth: unknown, scope: string): VerifiedTemplatePrincipal | null {
  const context = auth && typeof auth === 'object' ? principals.get(auth) : undefined;
  return context && (context.actor.method === 'session' || context.scopes.includes(scope)) ? context.actor : null;
}

/** Complete mutation pipeline shared by session and API callers. */
export async function mutateStorefrontConfig(auth: unknown, input: unknown): Promise<StorefrontMutationResult> {
  const context = auth && typeof auth === 'object' ? principals.get(auth) : undefined;
  if (!context) return templateFailure('FORBIDDEN');
  if (!isPlainJson(input)) return templateFailure('INVALID', result([{ code: 'SCHEMA', path: '', message: 'Expected plain JSON data' }]));
  let validation = result();
  if (input && typeof input === 'object' && 'config' in input) {
    validation = validateConfig(input.config);
    if (!validation.valid) return templateFailure(validation.errors.some(error => error.code === 'LIMIT') ? 'LIMIT' : 'INVALID', validation);
  }
  const parsed = mutationSchema.safeParse(input);
  if (!parsed.success) {
    const limit = parsed.error.issues.some(issue => issue.path.includes('expectedRevision') || issue.path.includes('targetRevision'));
    return templateFailure(limit ? 'LIMIT' : 'INVALID', result([{ code: limit ? 'LIMIT' : 'SCHEMA', path: '', message: 'Invalid mutation input', ...(limit ? { limit: Number.MAX_SAFE_INTEGER } : {}) }]));
  }
  const mutation = parsed.data;
  const scope = mutation.operation === 'publish' || mutation.operation === 'rollback' ? API_SCOPES.TEMPLATES_ACTIVATE : API_SCOPES.TEMPLATES_WRITE;
  if (context.actor.method === 'api_key' && !context.scopes.includes(scope)) return templateFailure('FORBIDDEN');
  let config = 'config' in mutation ? mutation.config : null;
  try {
    if (isDemoMode()) return templateFailure('FORBIDDEN');
    if (!(await checkRateLimit('storefront_mutation', 60, 1, context.actor.userId))) return templateFailure('RATE_LIMITED');
    const reader = createPlatformClient();
    const rights = templateRightsForTier(getPublicLicenseTier());
    const snapshot = await readStorefrontConfig(reader);
    if (!snapshot.success) return templateFailure('UNAVAILABLE');
    if (snapshot.data.revision !== mutation.expectedRevision) return templateFailure('CONFLICT', null, snapshot.data.revision);
    if (mutation.operation === 'reset') {
      config = resetTemplateField(snapshot.data.draft ?? snapshot.data.published, mutation.templateId, mutation.field);
      if (!config) return templateFailure('INVALID', result([{ code: 'SCHEMA', path: '/field', message: 'Reset field is not allowed for this selection' }]));
    }
    let candidate = config ?? snapshot.data.draft;
    if (mutation.operation === 'rollback') {
      const history = await readStorefrontHistory(reader, { limit: 1,
        ...(mutation.targetRevision < Number.MAX_SAFE_INTEGER ? { beforeRevision: mutation.targetRevision + 1 } : {}) });
      if (!history.success) return templateFailure('UNAVAILABLE');
      if (history.data[0]?.revision !== mutation.targetRevision) return templateFailure('NOT_FOUND');
      candidate = history.data[0].published;
    }
    if (!candidate) return templateFailure('INVALID', result([{ code: 'SCHEMA', path: '/draft', message: 'Publication requires a stored draft' }]));
    const mode = mutation.operation === 'publish' || mutation.operation === 'rollback' ? 'publish' : 'draft';
    validation = validateConfig(candidate);
    if (!validation.valid) return templateFailure('INVALID', validation);
    if (!canMutateTemplateConfig(rights, candidate, mode)) return templateFailure('FORBIDDEN');
    validation = inspectTemplate(candidate, rights, mode).validation;
    if (mode === 'publish') {
      if (!validation.valid) return templateFailure('INVALID', validation);
      const active = await validateActiveBindings(reader, candidate, validation);
      if (!active) return templateFailure('UNAVAILABLE');
      validation = active;
      if (!validation.valid) return templateFailure('INVALID', validation);
    }
    const client = createAdminClient();
    if (config !== null) {
      const size = await client.rpc('storefront_config_stored_bytes', { config: config as Json });
      if (size.error || !Number.isInteger(size.data) || size.data === null) return templateFailure('UNAVAILABLE');
      if (size.data > CONFIG_BYTES) return templateFailure('LIMIT', result([{ code: 'LIMIT', path: '/config', message: 'Stored config exceeds byte limit', limit: CONFIG_BYTES }]));
    }
    const { data, error } = await client.rpc('mutate_storefront_config', {
      expected_revision: mutation.expectedRevision, operation: mutation.operation,
      validated_config: config as Json, ...(mutation.operation === 'rollback' ? { restored_from: mutation.targetRevision } : {}),
      actor_user_id: context.actor.userId, actor_method: context.actor.method,
      ...(mutation.operation === 'legacy-import' ? { legacy_source: mutation.legacySource } : {}),
      ...(context.actor.apiKeyId !== null ? { actor_api_key_id: context.actor.apiKeyId } : {}),
    });
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) return templateFailure('UNAVAILABLE');
    if (data.success === true && revisionSchema.safeParse(data.revision).success) {
      if (mode === 'publish') {
        try {
          revalidateTag('storefront-config', { expire: 0 });
          revalidateTag('storefront-products', { expire: 0 });
          revalidatePath('/', 'layout');
        } catch { validation.warnings.push({ code: 'COMPATIBILITY', path: '', message: 'Publication committed; cache invalidation requires retry or expiry' }); }
      }
      return { success: true, revision: data.revision as number, validation };
    }
    const code = failureCodes.find(code => code === data.code);
    if (!code) return templateFailure('UNAVAILABLE');
    const current = code === 'CONFLICT' && revisionSchema.safeParse(data.currentRevision).success ? data.currentRevision as number : null;
    return templateFailure(code, code === 'LIMIT' || code === 'INVALID' ? result([{ code: code === 'LIMIT' ? 'LIMIT' : 'SCHEMA', path: data.path === '/config' || data.path === '/expectedRevision' ? data.path : '', message: 'Invalid stored mutation value', ...(code === 'LIMIT' ? { limit: data.limit === Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : CONFIG_BYTES } : {}) }]) : null, current);
  } catch { return templateFailure('UNAVAILABLE'); }
}
