/** Pure separate-key policy; no storage, signature verification or activation wiring.
 * @see spec/contracts/licensing.md — T2.1; T2.3 supplies verified local evidence.
 */
import { z } from 'zod';
import { hasFeature } from '@/lib/license/features';
import type { LicenseTier } from '@/lib/license/features';

export interface TemplateLicensePolicy {
  readonly templateId: string;
  readonly saleProductId: string;
  readonly issuerId: string;
  readonly trustedKeyIds: readonly string[];
  readonly edition: 'standard';
  readonly productionHost: string;
  readonly equivalentHosts: readonly string[];
}
export interface TemplateCredentialEvidence {
  state: 'verified' | 'missing' | 'invalid' | 'revoked' | 'unknown';
  issuerId: string;
  claims: unknown;
}

const text = z.string().min(1).max(256);
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const templateClaims = z.object({
  v: z.literal(1), kid: text, product: text, email: text, order: text, tier: text,
  iat: timestamp, exp: timestamp.nullable().optional(),
  templateId: text, domain: text, edition: z.literal('standard'),
}).strict();

/** Trusted policy and evidence come from core/operator configuration and local verification,
 * never a request body. Hosts are canonical lowercase bare hosts, preserving www.
 * This predicate alone does not establish signature, revocation freshness or activation rights.
 */
export function matchesTemplateLicensePolicy(
  policy: TemplateLicensePolicy, platformTier: string, evidence: TemplateCredentialEvidence,
  runtimeHost: string, nowSeconds: number,
): boolean {
  if (!['free', 'registered', 'pro', 'business'].includes(platformTier) ||
    !hasFeature(platformTier as LicenseTier, 'page-templates') ||
    evidence.state !== 'verified' || evidence.issuerId !== policy.issuerId ||
    !Number.isSafeInteger(nowSeconds) || nowSeconds < 0) return false;
  const parsed = templateClaims.safeParse(evidence.claims);
  if (!parsed.success) return false;
  const c = parsed.data;
  return c.templateId === policy.templateId && c.product === policy.saleProductId &&
    c.edition === policy.edition && policy.trustedKeyIds.includes(c.kid) &&
    c.domain === policy.productionHost &&
    (runtimeHost === policy.productionHost || policy.equivalentHosts.includes(runtimeHost)) &&
    c.iat <= nowSeconds && (c.exp == null || nowSeconds < c.exp);
}
