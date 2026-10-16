/** Scoped HTTP adapters for the shared template lifecycle. @see lifecycle.ts */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiAuthError } from '@/lib/api/errors';
import { API_SCOPES } from '@/lib/api/scope-constants';
import { checkRateLimit } from '@/lib/rate-limiting';
import { templateCapabilities } from '@/lib/storefront-templates/capabilities';
import { ENVELOPE_BYTES, parseBoundedJson, result } from '@/lib/storefront-templates/json';
import { storefrontLifecycle } from '@/lib/storefront-templates/lifecycle';
import { getTemplatePrincipal, verifyTemplateApiKey, verifyTemplateSession } from '@/lib/storefront-templates/mutations';
import { preparePreview, PREVIEW_HEADERS, previewSchema } from '@/lib/storefront-templates/preview';
import type { NextRequest } from 'next/server';
import type { PreviewResult } from '@/lib/storefront-templates/preview';
import type { ValidationResult } from '@/lib/storefront-templates/json';

const bodies = {
  draft: z.strictObject({ expectedRevision: z.unknown(), config: z.unknown() }),
  reset: z.strictObject({ expectedRevision: z.unknown(), templateId: z.unknown(), field: z.unknown() }),
  publish: z.strictObject({ expectedRevision: z.unknown() }),
  rollback: z.strictObject({ expectedRevision: z.unknown(), targetRevision: z.unknown() }),
  validate: z.strictObject({ config: z.unknown(), mode: z.unknown() }),
  diff: z.strictObject({ fromRevision: z.unknown(), toRevision: z.unknown() }),
  preview: previewSchema,
};
export interface TemplateHttpPreviewResult extends PreviewResult { previewPath: string }
type Operation = keyof typeof bodies | 'read' | 'capabilities';
const json = (data: unknown, status = 200): NextResponse => NextResponse.json(data, { status, headers: PREVIEW_HEADERS });
function failure(code: string, status: number, validation: ValidationResult | null = null): NextResponse {
  return json({ code, message: 'Template request could not be completed', validation, currentRevision: null }, status);
}

/** Header credentials take precedence over any ambient session. */
export async function templateRequestPrincipal(request: NextRequest) {
  return request.headers.has('authorization') || request.headers.has('x-api-key')
    ? verifyTemplateApiKey(request, true) : verifyTemplateSession(request, true);
}

export async function templateHttp(request: NextRequest, operation: Operation): Promise<NextResponse> {
  try {
    const auth = await templateRequestPrincipal(request);
    if (!auth) return failure('UNAUTHORIZED', 401);
    const scope = operation === 'draft' || operation === 'reset' ? API_SCOPES.TEMPLATES_WRITE
      : operation === 'publish' || operation === 'rollback' ? API_SCOPES.TEMPLATES_ACTIVATE : API_SCOPES.TEMPLATES_READ;
    const actor = getTemplatePrincipal(auth, scope);
    if (!actor) return failure('FORBIDDEN', 403);
    if (!(await checkRateLimit('storefront_http', 120, 1, actor.userId))) return failure('RATE_LIMITED', 429);
    if (operation === 'capabilities') return json(templateCapabilities());
    let input: Record<string, unknown> = {};
    if (operation !== 'read') {
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = []; let length = 0;
      if (reader) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > ENVELOPE_BYTES) {
              await reader.cancel().catch(() => {});
              return failure('LIMIT', 422, result([{ code: 'LIMIT', path: '', message: 'Request exceeds byte limit', limit: ENVELOPE_BYTES }]));
            }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
      }
      const parsed = parseBoundedJson(Buffer.concat(chunks), ENVELOPE_BYTES, true);
      if (!parsed.valid) return failure(parsed.errors.some(e => e.code === 'LIMIT') ? 'LIMIT' : 'INVALID', 422, parsed);
      const strict = bodies[operation].safeParse(parsed.data);
      if (!strict.success) {
        const limit = strict.error.issues.some(issue => issue.path.includes('revision'));
        return failure(limit ? 'LIMIT' : 'INVALID', 422, result([{ code: limit ? 'LIMIT' : 'SCHEMA', path: limit ? '/revision' : '', message: 'Invalid request fields', ...(limit ? { limit: Number.MAX_SAFE_INTEGER } : {}) }]));
      }
      input = strict.data;
    }
    if (operation === 'preview') {
      const issuedAt = Date.now();
      const preview = await preparePreview(auth, input, issuedAt);
      if (!preview.success) {
        const { code, message, validation, currentRevision } = preview;
        return json({ code, message, validation, currentRevision }, preview.status);
      }
      const { revision, locale, fixture, expiresAt, validation, effectiveTokens, unusedSlots } = preview.data;
      const evidence = { revision, locale, fixture, expiresAt, validation, effectiveTokens, unusedSlots };
      const query = new URLSearchParams({ locale: evidence.locale, fixture: evidence.fixture, issuedAt: String(issuedAt) });
      const data: TemplateHttpPreviewResult = { ...evidence, previewPath: `/template-preview/${evidence.revision}?${query}` };
      return json(data);
    }
    const response = await storefrontLifecycle(auth, { ...input, operation });
    if (!response.success) {
      const { code, message, validation, currentRevision } = response;
      return json({ code, message, validation, currentRevision }, response.status);
    }
    if ('data' in response) return json(response.data);
    const { revision, validation } = response;
    return json({ revision, validation });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      const code = error.code === 'INVALID_TOKEN' ? 'UNAUTHORIZED' : error.code;
      return failure(code, { UNAUTHORIZED: 401, FORBIDDEN: 403, RATE_LIMITED: 429 }[code]);
    }
    return failure('UNAVAILABLE', 503);
  }
}
