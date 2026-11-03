/** The license CLI prefers the API (ledger, CRL, events, buyer mail); offline signing uses the same format and warns. */
import { describe, expect, it, vi } from 'vitest';
import { generateSellerKeypair } from '@/lib/license-keys/keys';
import { verifySellfLicense } from '@/lib/license-keys/sdk';
import { parseCliArgs, runIssueLicense } from '../../../scripts/issue-license';

const pair = generateSellerKeypair();

describe('issue-license CLI', () => {
  it('issues through API v1 by default and returns the recorded token', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { id: 'lic', token: 'p.s' } }), { status: 201 }));
    const out = await runIssueLicense(parseCliArgs(['--product-id', '11111111-1111-4111-8111-111111111111', '--email', 'b@example.com', '--domain', 'shop.example.com', '--no-email']),
      { env: { SELLF_URL: 'https://sellf.example', SELLF_API_KEY: 'sf_live_x' }, fetchImpl, warn: vi.fn() });
    expect(out).toBe('p.s');
    expect(fetchImpl).toHaveBeenCalledWith('https://sellf.example/api/v1/licenses', expect.objectContaining({ method: 'POST' }));
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({ productId: '11111111-1111-4111-8111-111111111111', email: 'b@example.com', domain: 'shop.example.com', sendEmail: false });
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('sf_live_x');
  });

  it('reports an API refusal instead of falling back silently', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'License issuance requires a Pro license' } }), { status: 403 }));
    await expect(runIssueLicense(parseCliArgs(['--product-id', '11111111-1111-4111-8111-111111111111', '--email', 'b@example.com']),
      { env: { SELLF_URL: 'https://sellf.example', SELLF_API_KEY: 'k' }, fetchImpl, warn: vi.fn() })).rejects.toThrow('Pro license');
  });

  it('signs offline with the shared format, verifiable against the seller key, and warns', async () => {
    const warn = vi.fn();
    const token = await runIssueLicense(parseCliArgs(['--offline', '--kid', pair.kid, '--product', 'plugin', '--email', 'b@example.com', '--domain', 'Shop.Example.com', '--tier', 'pro', '--days', '30']),
      { env: { SELLF_LICENSE_PRIVATE_KEY: pair.privateKeyPem }, fetchImpl: vi.fn(), warn });
    const checked = verifySellfLicense(token, { keys: [{ kid: pair.kid, alg: 'ES256', pem: pair.publicKeyPem }] });
    expect(checked.valid && checked.claims).toMatchObject({ product: 'plugin', email: 'b@example.com', domain: 'shop.example.com', tier: 'pro' });
    expect(checked.valid && checked.claims.order).toMatch(/^offline_/);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not recorded'));
  });

  it('rejects incomplete input', () => {
    expect(() => parseCliArgs(['--email'])).toThrow();
    expect(() => parseCliArgs(['--offline', '--kid', 'k', '--product', 'p', '--email', 'b@example.com', '--days', '-1'])).toThrow('days');
  });
});
