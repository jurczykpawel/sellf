/** Private template credential storage. @see supabase/tests/template-credentials.sql */
import 'server-only';
import { z } from 'zod';
import { API_SCOPES } from '@/lib/api/scope-constants';
import { isDemoMode } from '@/lib/demo-guard';
import { checkRateLimit } from '@/lib/rate-limiting';
import { encryptSecret } from '@/lib/services/secret-encryption';
import { getTemplatePrincipal } from '@/lib/storefront-templates/mutations';
import { createPlatformClient } from '@/lib/supabase/admin';

const templateId = z.enum(['storefront-a', 'storefront-b', 'storefront-c']);
const statusSchema = z.object({
  templateId,
  state: z.enum(['valid', 'missing', 'expired', 'revoked', 'invalid', 'unknown']),
  verifiedAt: z.iso.datetime({ offset: true }).nullable(),
});
const inputSchema = z.strictObject({ templateId, token: z.string().min(1).max(16384)
  .refine(value => value.trim().length > 0 && Buffer.byteLength(value, 'utf8') <= 16384) });
export type TemplateLicenseStatus = z.infer<typeof statusSchema>;
type CredentialResult<T> = { success: true; data: T } | {
  success: false; code: 'FORBIDDEN' | 'INVALID' | 'UNAVAILABLE' | 'RATE_LIMITED';
};

/** Saving a credential does not establish activation rights. T2.3 owns verification. */
export async function saveTemplateCredential(auth: unknown, input: unknown): Promise<CredentialResult<TemplateLicenseStatus>> {
  const actor = getTemplatePrincipal(auth, API_SCOPES.TEMPLATES_WRITE);
  if (!actor || isDemoMode()) return { success: false, code: 'FORBIDDEN' };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { success: false, code: 'INVALID' };
  try {
    if (!(await checkRateLimit('template_credential_write', 30, 1, actor.userId))) return { success: false, code: 'RATE_LIMITED' };
    const encrypted = await encryptSecret(parsed.data.token);
    const { data, error } = await createPlatformClient().rpc('save_template_credential', {
      template_id: parsed.data.templateId, encrypted_key: encrypted.encryptedKey,
      encryption_iv: encrypted.iv, encryption_tag: encrypted.tag,
      actor_user_id: actor.userId, actor_method: actor.method, actor_api_key_id: actor.apiKeyId ?? undefined,
    });
    const response = z.object({ success: z.literal(true), status: statusSchema }).safeParse(data);
    if (error || !response.success) {
      const denied = z.object({ success: z.literal(false), code: z.literal('FORBIDDEN') }).safeParse(data);
      return { success: false, code: denied.success ? 'FORBIDDEN' : 'UNAVAILABLE' };
    }
    return { success: true, data: response.data.status };
  } catch { return { success: false, code: 'UNAVAILABLE' }; }
}

/** Status-only service for private adapters; no credential read or decryption. */
export async function readTemplateLicenseStatuses(auth: unknown): Promise<CredentialResult<TemplateLicenseStatus[]>> {
  if (!getTemplatePrincipal(auth, API_SCOPES.TEMPLATES_READ)) return { success: false, code: 'FORBIDDEN' };
  try {
    const { data, error } = await createPlatformClient().from('template_credentials')
      .select('template_id,state,verified_at').order('template_id');
    if (error || !data) return { success: false, code: 'UNAVAILABLE' };
    const parsed = z.array(statusSchema).safeParse(data.map(row => ({ templateId: row.template_id, state: row.state, verifiedAt: row.verified_at })));
    return parsed.success ? { success: true, data: parsed.data } : { success: false, code: 'UNAVAILABLE' };
  } catch { return { success: false, code: 'UNAVAILABLE' }; }
}
