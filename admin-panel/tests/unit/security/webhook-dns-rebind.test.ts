import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const resolve4Mock = vi.fn();
const resolve6Mock = vi.fn();
vi.mock('node:dns/promises', () => ({
  default: {
    resolve4: (...args: unknown[]) => resolve4Mock(...args),
    resolve6: (...args: unknown[]) => resolve6Mock(...args),
  },
  resolve4: (...args: unknown[]) => resolve4Mock(...args),
  resolve6: (...args: unknown[]) => resolve6Mock(...args),
}));

import { validateWebhookUrlAsync, isValidWebhookUrl } from '@/lib/validations/webhook';

describe('validateWebhookUrlAsync — DNS resolution boundary', () => {
  const originalEnv = process.env.ALLOW_HTTP_WEBHOOKS;

  beforeEach(() => {
    process.env.ALLOW_HTTP_WEBHOOKS = 'true';
    resolve4Mock.mockReset();
    resolve6Mock.mockReset();
    // Default: empty AAAA so v4-only mocks work without explicit v6 setup.
    resolve6Mock.mockRejectedValue(new Error('NODATA'));
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.ALLOW_HTTP_WEBHOOKS;
    else process.env.ALLOW_HTTP_WEBHOOKS = originalEnv;
  });

  it('sync layer accepts a hostname URL; DNS layer is the next gate', () => {
    const result = isValidWebhookUrl('https://example-target.com/hook');
    expect(result.valid).toBe(true);
  });

  it('rejects hostname resolving to loopback', async () => {
    resolve4Mock.mockResolvedValueOnce(['127.0.0.1']);
    const result = await validateWebhookUrlAsync('https://example-target.com/hook');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/private|reserved/i);
  });

  it('rejects hostname resolving to link-local (169.254.x)', async () => {
    resolve4Mock.mockResolvedValueOnce(['169.254.169.254']);
    const result = await validateWebhookUrlAsync('https://example-target.com/hook');
    expect(result.valid).toBe(false);
  });

  it('rejects hostname resolving to RFC1918 private', async () => {
    resolve4Mock.mockResolvedValueOnce(['10.0.0.5']);
    const result = await validateWebhookUrlAsync('https://example-target.com/hook');
    expect(result.valid).toBe(false);
  });

  it('rejects when ANY resolved address is private (multi-record DNS)', async () => {
    resolve4Mock.mockResolvedValueOnce(['8.8.8.8', '127.0.0.1']);
    const result = await validateWebhookUrlAsync('https://example-target.com/hook');
    expect(result.valid).toBe(false);
  });

  it('rejects IPv6 resolution to loopback', async () => {
    resolve4Mock.mockRejectedValueOnce(new Error('NODATA'));
    resolve6Mock.mockReset();
    resolve6Mock.mockResolvedValueOnce(['::1']);
    const result = await validateWebhookUrlAsync('https://example-target.com/hook');
    expect(result.valid).toBe(false);
  });

  it('rejects IPv4-mapped IPv6 in hex form', async () => {
    resolve4Mock.mockRejectedValueOnce(new Error('NODATA'));
    resolve6Mock.mockReset();
    resolve6Mock.mockResolvedValueOnce(['::ffff:7f00:1']);
    const result = await validateWebhookUrlAsync('https://example-target.com/hook');
    expect(result.valid).toBe(false);
  });

  it('rejects when DNS resolution returns nothing for both v4 and v6', async () => {
    resolve4Mock.mockRejectedValueOnce(new Error('ENOTFOUND'));
    // resolve6 already rejects by default in beforeEach
    const result = await validateWebhookUrlAsync('https://does-not-exist.invalid/hook');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/resolved|records/i);
  });

  it('passes for a public IPv4 resolution', async () => {
    resolve4Mock.mockResolvedValueOnce(['8.8.8.8']);
    const result = await validateWebhookUrlAsync('https://example.com/hook');
    expect(result.valid).toBe(true);
  });

  it('skips DNS lookup when the URL hostname is a literal IPv4', async () => {
    const result = await validateWebhookUrlAsync('http://127.0.0.1/hook');
    expect(result.valid).toBe(false);
    expect(resolve4Mock).not.toHaveBeenCalled();
    expect(resolve6Mock).not.toHaveBeenCalled();
  });

  it('rejects malformed URLs without DNS lookup', async () => {
    const result = await validateWebhookUrlAsync('not-a-url');
    expect(result.valid).toBe(false);
    expect(resolve4Mock).not.toHaveBeenCalled();
    expect(resolve6Mock).not.toHaveBeenCalled();
  });
});
