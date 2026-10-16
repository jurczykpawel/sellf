/** Synthetic pins only; replace with reviewed sale mappings before any sale.
 * @see spec/contracts/licensing.md — default pending owner Q2
 */
import type { TemplateLicensePolicy } from '@/lib/storefront-templates/template-license-policy';

export const SALE_TERMS_FIXTURE = {
  status: 'default pending owner Q2',
  retainedUse: 'perpetual eligible-version purchase rights',
  premiumSelection: 'Pro required',
  updates: 'separate policy pending owner Q2',
  support: 'separate policy pending owner Q2',
  transfers: 'pending owner Q2; no seat guarantee without ledger',
} as const;

export const PREMIUM_POLICY_FIXTURES: readonly TemplateLicensePolicy[] = [
  ['storefront-a', '00000000-0000-4000-8000-00000000000a'],
  ['storefront-b', '00000000-0000-4000-8000-00000000000b'],
  ['storefront-c', '00000000-0000-4000-8000-00000000000c'],
].map(([templateId, saleProductId]) => ({
  templateId, saleProductId, issuerId: 'sellf-template-fixture-issuer',
  trustedKeyIds: ['template-fixture-key-1'], edition: 'standard',
  productionHost: 'shop.example.test',
  equivalentHosts: ['www.shop.example.test', 'staging.shop.example.test', 'localhost'],
}));
