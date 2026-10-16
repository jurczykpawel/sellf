/** Local template rights, refreshed independently of public requests. @see instrumentation.ts */
import 'server-only';
import { createHash, createPublicKey, createVerify } from 'node:crypto';
import { z } from 'zod';
import { decryptSecret } from '@/lib/services/secret-encryption';
import { createPlatformClient } from '@/lib/supabase/admin';
import { getCanonicalOriginOrNull } from '@/lib/utils/canonical-url';
import { assertSafeOutboundUrl } from '@/lib/security/outbound-url';
import { matchesTemplateLicensePolicy, templateClaims } from '@/lib/storefront-templates/template-license-policy';
import type { TemplateLicenseStatus } from '@/lib/storefront-templates/template-credentials';

const host = z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
const text = z.string().min(1).max(256);
const policySchema = z.strictObject({
  templateId: z.enum(['storefront-a', 'storefront-b', 'storefront-c']), saleProductId: z.uuid(),
  issuerId: text, trustedKeyIds: z.array(text).min(1).max(32), edition: z.literal('standard'),
  productionHost: host, equivalentHosts: z.array(host).max(16),
  keys: z.array(z.strictObject({ kid: text, issuerId: text, pem: z.string().max(8192) })).min(1).max(32),
  revocationUrl: z.url().max(2048).refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  }),
});
interface Entry { status: TemplateLicenseStatus; fingerprint: string; until: number; expiry: number }
interface Snapshot { entries: Map<TemplateLicenseStatus['templateId'], Entry>; pending?: Promise<void>; timer?: ReturnType<typeof setInterval> }
const shared = globalThis as typeof globalThis & { sellfTemplateLicenses?: Snapshot };
const state: Snapshot = shared.sellfTemplateLicenses ??= { entries: new Map() };

export function invalidateTemplateLicense(templateId: TemplateLicenseStatus['templateId']): void { state.entries.delete(templateId); }
export function getTemplateLicenseStatus(templateId: TemplateLicenseStatus['templateId']): TemplateLicenseStatus {
  const entry = state.entries.get(templateId);
  if (!entry) return { templateId, state: 'unknown', verifiedAt: null };
  if (entry.status.state === 'valid') {
    if (Date.now() >= entry.expiry) return { ...entry.status, state: 'expired' };
    if (Date.now() >= entry.until) return { ...entry.status, state: 'unknown' };
  }
  return { ...entry.status };
}
export function getLocalTemplateIds(): string[] {
  return [...state.entries.keys()].filter(id => getTemplateLicenseStatus(id).state === 'valid');
}

async function revoked(url: string, order: string): Promise<boolean> {
  const hash = createHash('sha256').update(order).digest('hex');
  const target = new URL(url); target.searchParams.set('prefix', hash.slice(0, 4));
  await assertSafeOutboundUrl(target.toString());
  const response = await fetch(target, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000) });
  if (!response.ok || !response.body) throw new Error('Unavailable');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 131072) { await reader.cancel(); throw new Error('Unavailable'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = z.strictObject({ order_hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(1800) })
    .parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
  return body.order_hashes.includes(hash);
}

/** Pinned operator configuration is separate from submitted credentials and recipes. */
export function refreshTemplateLicenseSnapshot(): Promise<void> {
  if (state.pending) return state.pending;
  state.pending = (async () => {
    const readAt = Date.now();
    try {
      const policies = z.array(policySchema).max(3).parse(JSON.parse(process.env.SELLF_TEMPLATE_LICENSE_POLICIES ?? '[]'));
      if (new Set(policies.map(p => p.templateId)).size !== policies.length) { state.entries.clear(); return; }
      const origin = getCanonicalOriginOrNull();
      if (!origin) { state.entries.clear(); return; }
      const runtimeHost = new URL(origin).hostname;
      const client = createPlatformClient();
      const { data, error } = await client.from('template_credentials').select('*');
      if (error || !data) return;
      const present = new Set(data.map(row => row.template_id));
      for (const id of state.entries.keys()) if (!present.has(id)) state.entries.delete(id);
      await Promise.all(data.map(async row => {
        const id = policySchema.shape.templateId.parse(row.template_id);
        const fingerprint = createHash('sha256').update(JSON.stringify([row.encrypted_key, row.encryption_iv, row.encryption_tag])).digest('hex');
        if (state.entries.get(id)?.fingerprint !== fingerprint) state.entries.delete(id);
        let status: TemplateLicenseStatus['state'] = row.encrypted_key ? 'unknown' : 'missing';
        let expiry = Infinity;
        try {
          const policy = policies.find(p => p.templateId === id);
          if (row.state === 'revoked') status = 'revoked';
          else if (row.encrypted_key && row.encryption_iv && row.encryption_tag && policy) {
            const token = await decryptSecret({ encrypted_key: row.encrypted_key, encryption_iv: row.encryption_iv, encryption_tag: row.encryption_tag });
            const parts = token.split('.');
            let parsed: ReturnType<typeof templateClaims.safeParse> | null = null;
            try {
              if (parts.length === 2 && /^[A-Za-z0-9_-]+$/.test(parts[0]) && /^[A-Za-z0-9_-]+$/.test(parts[1])) {
                parsed = templateClaims.safeParse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(parts[0], 'base64url'))));
              }
            } catch { /* Invalid credential encoding. */ }
            status = 'invalid';
            if (parsed?.success) {
              const claims = parsed.data;
              const pin = policy.keys.find(k => k.kid === claims.kid && k.issuerId === policy.issuerId && policy.trustedKeyIds.includes(k.kid));
              if (pin) {
                const key = createPublicKey(pin.pem);
                const signed = key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1' &&
                  createVerify('SHA256').update(parts[0]).end().verify(key, Buffer.from(parts[1], 'base64url'));
                expiry = claims.exp == null ? Infinity : claims.exp * 1000;
                if (signed && matchesTemplateLicensePolicy(policy, 'pro', { state: 'verified', issuerId: pin.issuerId, claims: { ...claims, exp: null } }, runtimeHost, Math.floor(readAt / 1000))) {
                  status = readAt >= expiry ? 'expired' : await revoked(policy.revocationUrl, claims.order) ? 'revoked' : 'valid';
                }
              }
            }
          }
        } catch {
          // A failed refresh cannot extend a previous confirmation.
          const previous = state.entries.get(id);
          if (previous?.status.state === 'valid') return;
          status = 'unknown';
        }
        const verifiedAt = status === 'unknown' || status === 'missing' ? null : new Date(readAt).toISOString();
        if (status !== 'missing') {
          const saved = await client.rpc('record_template_credential_status', {
            template_id: id, expected_key: row.encrypted_key!, expected_iv: row.encryption_iv!, expected_tag: row.encryption_tag!,
            verification_state: status, checked_at: verifiedAt ?? new Date(readAt).toISOString(),
          });
          if (saved.error || saved.data !== true) { state.entries.delete(id); return; }
        }
        state.entries.set(id, { status: { templateId: id, state: status, verifiedAt }, fingerprint,
          until: readAt + 60000, expiry });
      }));
    } catch { /* Existing confirmations retain their original absolute deadlines. */ }
  })().finally(() => { state.pending = undefined; });
  return state.pending;
}
export function startTemplateLicenseRefresh(): boolean {
  if (state.timer) return false;
  state.timer = setInterval(() => { void refreshTemplateLicenseSnapshot(); }, 30000);
  state.timer.unref(); void refreshTemplateLicenseSnapshot(); return true;
}
export function stopTemplateLicenseRefresh(): void {
  if (state.timer) clearInterval(state.timer);
  state.timer = undefined; state.entries.clear(); state.pending = undefined;
}
