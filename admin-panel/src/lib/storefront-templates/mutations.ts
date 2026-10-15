/** Private storefront mutation boundary. @see supabase/tests/storefront-mutations.sql */
import 'server-only';
import { z } from 'zod';
import { authenticateApiKeyPrincipal } from '@/lib/api/middleware';
import { API_SCOPES } from '@/lib/api/scope-constants';
import { requireAdminApi } from '@/lib/auth-server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { configSchema, revisionSchema } from '@/lib/storefront-templates/schemas';
import { validateConfig } from '@/lib/storefront-templates/registry';
import { CONFIG_BYTES, isPlainJson, result } from '@/lib/storefront-templates/json';
import type { NextRequest } from 'next/server';
import type { ValidationResult } from '@/lib/storefront-templates/json';
import type { Json } from '@/types/database';

interface VerifiedTemplatePrincipal { userId: string; method: 'session' | 'api_key'; apiKeyId: string | null }
interface PrincipalContext { actor: VerifiedTemplatePrincipal; scopes: readonly string[] }
const principals = new WeakMap<object, PrincipalContext>();
const actorSchema = z.strictObject({ userId: z.uuid(), method: z.enum(['session', 'api_key']), apiKeyId: z.uuid().nullable() });
const mutationSchema = z.discriminatedUnion('operation', [
  z.strictObject({ expectedRevision: revisionSchema, operation: z.enum(['draft', 'reset', 'legacy-import']), config: configSchema }),
  z.strictObject({ expectedRevision: revisionSchema, operation: z.literal('publish') }),
  z.strictObject({ expectedRevision: revisionSchema, operation: z.literal('rollback'), targetRevision: revisionSchema }),
]);
const failureCodes = ['FORBIDDEN', 'CONFLICT', 'INVALID', 'NOT_FOUND', 'UNAVAILABLE', 'LIMIT'] as const;
type FailureCode = typeof failureCodes[number];
export type StorefrontMutationResult = { success: true; revision: number; validation: ValidationResult } | {
  success: false; code: FailureCode; status: number; message: string; validation: ValidationResult | null; currentRevision: number | null;
};
function failure(code: FailureCode, validation: ValidationResult | null = null, currentRevision: number | null = null): StorefrontMutationResult {
  const status = { FORBIDDEN: 403, CONFLICT: 409, INVALID: 422, NOT_FOUND: 404, UNAVAILABLE: 503, LIMIT: 422 }[code];
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

/** Internal primitive; lifecycle callers supply current binding and rights validation before publication. */
export async function mutateStorefrontConfig(auth: unknown, input: unknown): Promise<StorefrontMutationResult> {
  const context = auth && typeof auth === 'object' ? principals.get(auth) : undefined;
  if (!context) return failure('FORBIDDEN');
  if (!isPlainJson(input)) return failure('INVALID', result([{ code: 'SCHEMA', path: '', message: 'Expected plain JSON data' }]));
  let validation = result();
  if (input && typeof input === 'object' && 'config' in input) {
    validation = validateConfig(input.config);
    if (!validation.valid) return failure(validation.errors.some(error => error.code === 'LIMIT') ? 'LIMIT' : 'INVALID', validation);
  }
  const parsed = mutationSchema.safeParse(input);
  if (!parsed.success) {
    const limit = parsed.error.issues.some(issue => issue.path.includes('expectedRevision') || issue.path.includes('targetRevision'));
    return failure(limit ? 'LIMIT' : 'INVALID', result([{ code: limit ? 'LIMIT' : 'SCHEMA', path: '', message: 'Invalid mutation input', ...(limit ? { limit: Number.MAX_SAFE_INTEGER } : {}) }]));
  }
  const mutation = parsed.data;
  const scope = mutation.operation === 'publish' || mutation.operation === 'rollback' ? API_SCOPES.TEMPLATES_ACTIVATE : API_SCOPES.TEMPLATES_WRITE;
  if (context.actor.method === 'api_key' && !context.scopes.includes(scope)) return failure('FORBIDDEN');
  const config = 'config' in mutation ? mutation.config : null;
  try {
    const client = createAdminClient();
    if (config !== null) {
      const size = await client.rpc('storefront_config_stored_bytes', { config: config as Json });
      if (size.error || !Number.isInteger(size.data) || size.data === null) return failure('UNAVAILABLE');
      if (size.data > CONFIG_BYTES) return failure('LIMIT', result([{ code: 'LIMIT', path: '/config', message: 'Stored config exceeds byte limit', limit: CONFIG_BYTES }]));
    }
    const { data, error } = await client.rpc('mutate_storefront_config', {
      expected_revision: mutation.expectedRevision, operation: mutation.operation,
      validated_config: config as Json, ...(mutation.operation === 'rollback' ? { restored_from: mutation.targetRevision } : {}),
      actor_user_id: context.actor.userId, actor_method: context.actor.method,
      ...(context.actor.apiKeyId !== null ? { actor_api_key_id: context.actor.apiKeyId } : {}),
    });
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) return failure('UNAVAILABLE');
    if (data.success === true && revisionSchema.safeParse(data.revision).success) return { success: true, revision: data.revision as number, validation };
    const code = failureCodes.find(code => code === data.code);
    if (!code) return failure('UNAVAILABLE');
    const current = code === 'CONFLICT' && revisionSchema.safeParse(data.currentRevision).success ? data.currentRevision as number : null;
    return failure(code, code === 'LIMIT' || code === 'INVALID' ? result([{ code: code === 'LIMIT' ? 'LIMIT' : 'SCHEMA', path: data.path === '/config' || data.path === '/expectedRevision' ? data.path : '', message: 'Invalid stored mutation value', ...(code === 'LIMIT' ? { limit: data.limit === Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : CONFIG_BYTES } : {}) }]) : null, current);
  } catch { return failure('UNAVAILABLE'); }
}
