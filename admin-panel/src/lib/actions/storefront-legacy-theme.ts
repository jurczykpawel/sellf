'use server';

/** One-time file-theme import into the current draft. @see storefront-templates/lifecycle.ts */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { API_SCOPES } from '@/lib/api/scope-constants';
import { isDemoMode } from '@/lib/demo-guard';
import { createPlatformClient } from '@/lib/supabase/admin';
import { storefrontLifecycle } from '@/lib/storefront-templates/lifecycle';
import { convertLegacyTheme } from '@/lib/storefront-templates/legacy-theme';
import { getTemplatePrincipal, verifyTemplateSession } from '@/lib/storefront-templates/mutations';
import { CONFIG_BYTES } from '@/lib/storefront-templates/json';
import { revisionSchema } from '@/lib/storefront-templates/schemas';

interface LegacyImportResult { success: boolean; code?: string; unsupported?: string[] }
export async function importLegacyStorefrontTheme(expectedRevision: number): Promise<LegacyImportResult> {
  const auth = await verifyTemplateSession();
  if (!getTemplatePrincipal(auth, API_SCOPES.TEMPLATES_WRITE) || isDemoMode()) return { success: false, code: 'FORBIDDEN' };
  if (!revisionSchema.safeParse(expectedRevision).success) return { success: false, code: 'INVALID' };
  try {
    const client = createPlatformClient();
    const imported = await client.from('storefront_config_history').select('revision').eq('operation', 'legacy-import').gt('revision', 0).limit(1);
    if (imported.error) return { success: false, code: 'UNAVAILABLE' };
    if (imported.data?.length) return { success: false, code: 'ALREADY_IMPORTED' };
    const read = await storefrontLifecycle(auth, { operation: 'read' });
    if (!read.success || !('data' in read) || !('revision' in read.data)) return { success: false, code: 'UNAVAILABLE' };
    if (read.data.revision !== expectedRevision) return { success: false, code: 'CONFLICT' };
    const source = path.join(process.cwd(), 'data', 'active-theme.json');
    const metadata = await stat(source);
    if (!metadata.isFile() || metadata.size > CONFIG_BYTES) return { success: false, code: 'INVALID' };
    const originalBytes = await readFile(source);
    if (originalBytes.byteLength > CONFIG_BYTES) return { success: false, code: 'INVALID' };
    const original = new TextDecoder('utf-8', { fatal: true }).decode(originalBytes);
    const legacySource = { sha256: createHash('sha256').update(originalBytes).digest('hex'), byteLength: originalBytes.byteLength };
    const converted = convertLegacyTheme(JSON.parse(original));
    if (!converted.tokens) return { success: false, code: 'INVALID' };
    const current = read.data.draft ?? read.data.published;
    const tokens = { ...converted.tokens, ...current.tokens, format: 1 as const };
    for (const group of ['light', 'dark', 'typography', 'shapes'] as const) {
      if (converted.tokens[group] || current.tokens?.[group]) Object.assign(tokens, { [group]: { ...converted.tokens[group], ...current.tokens?.[group] } });
    }
    const saved = await storefrontLifecycle(auth, { operation: 'legacy-import', expectedRevision, config: { ...current, tokens }, legacySource });
    return saved.success ? { success: true, unsupported: converted.unsupported } : { success: false, code: saved.code };
  } catch { return { success: false, code: 'UNAVAILABLE' }; }
}
