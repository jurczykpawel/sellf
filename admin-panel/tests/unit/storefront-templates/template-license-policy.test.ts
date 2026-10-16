/** Separate-template policy matrix. @see spec/contracts/licensing.md */
import { expect, it } from 'vitest';
import { matchesTemplateLicensePolicy } from '@/lib/storefront-templates/template-license-policy';
import { PREMIUM_POLICY_FIXTURES, SALE_TERMS_FIXTURE } from './fixtures/template-license-policy';

const now = 1_800_000_000;
for (const policy of PREMIUM_POLICY_FIXTURES) {
  const claims = { v: 1, kid: policy.trustedKeyIds[0], product: policy.saleProductId,
    templateId: policy.templateId, edition: 'standard', domain: policy.productionHost,
    email: 'owner@example.test', order: 'synthetic-order', tier: 'standard', iat: now - 100 };
  const evidence = { state: 'verified' as const, issuerId: policy.issuerId, claims };
  const accepts = (overrides = {}, tier: string = 'pro', host = policy.productionHost) =>
    matchesTemplateLicensePolicy(policy, tier, { ...evidence, ...overrides }, host, now);

  it.each(['pro', 'business'])(`${policy.templateId}: accepts %s with its matching key`, tier => {
    expect(accepts({}, tier)).toBe(true);
  });
  it.each(['free', 'registered', 'unknown'])(`${policy.templateId}: rejects key-only %s`, tier => {
    expect(accepts({}, tier)).toBe(false);
  });
  it.each(['missing', 'invalid', 'revoked', 'unknown'])(`${policy.templateId}: rejects %s evidence`, state => {
    expect(accepts({ state })).toBe(false);
  });
  it(`${policy.templateId}: requires pinned issuer and relied-on claims`, () => {
    expect(accepts({ issuerId: 'other-issuer' })).toBe(false);
    for (const patch of [{ kid: 'other-key' }, { product: 'sellf-pro' },
      { templateId: 'd' }, { edition: 'extended' }, { domain: 'other.example.test' },
      { v: 2 }, { iat: now + 1 }, { iat: NaN }, { exp: 'never' }, { exp: now },
      { exp: now - 1 }, { exp: 1.5 }, { email: '' }, { order: '' },
      { kid: undefined }, { domain: undefined }, { supportUntil: now + 100 }]) {
      expect(accepts({ claims: { ...claims, ...patch } })).toBe(false);
    }
    expect(accepts({ claims: null })).toBe(false);
    expect(accepts({ claims: { ...claims, exp: now + 1 } })).toBe(true);
    expect(accepts({ claims: { ...claims, exp: null } })).toBe(true);
  });
  it(`${policy.templateId}: does not share A/B/C purchase rights`, () => {
    for (const other of PREMIUM_POLICY_FIXTURES.filter(p => p !== policy)) {
      expect(accepts({ claims: { ...claims, product: other.saleProductId } })).toBe(false);
      expect(accepts({ claims: { ...claims, templateId: other.templateId } })).toBe(false);
    }
  });
  it(`${policy.templateId}: allows only explicitly listed runtime hosts`, () => {
    for (const host of policy.equivalentHosts) expect(accepts({}, 'pro', host)).toBe(true);
    for (const host of ['unlisted.shop.example.test', 'evilshop.example.test',
      'shop.example.test.other.test', '*.shop.example.test', '127.0.0.1',
      'https://shop.example.test', 'shop.example.test:3000', 'SHOP.EXAMPLE.TEST']) {
      expect(accepts({}, 'pro', host)).toBe(false);
    }
    expect(accepts({ claims: { ...claims, domain: policy.equivalentHosts[0] } })).toBe(false);
    expect(matchesTemplateLicensePolicy({ ...policy, equivalentHosts: [] }, 'pro', evidence,
      policy.equivalentHosts[0], now)).toBe(false);
  });
}
it('keeps the proposed commercial terms separate from credential expiry', () => {
  expect(SALE_TERMS_FIXTURE).toEqual({ status: 'default pending owner Q2',
    retainedUse: 'perpetual eligible-version purchase rights', premiumSelection: 'Pro required',
    updates: 'separate policy pending owner Q2', support: 'separate policy pending owner Q2',
    transfers: 'pending owner Q2; no seat guarantee without ledger' });
});
