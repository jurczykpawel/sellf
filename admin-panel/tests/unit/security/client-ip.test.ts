import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getClientIp } from '@/lib/security/client-ip';

function withHeaders(headers: Record<string, string>): Request {
  return { headers: new Headers(headers) } as Request;
}

describe('getClientIp', () => {
  const original = process.env.TRUSTED_PROXY;

  beforeEach(() => {
    delete process.env.TRUSTED_PROXY;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.TRUSTED_PROXY;
    else process.env.TRUSTED_PROXY = original;
  });

  it('returns "unknown" when TRUSTED_PROXY is not set', () => {
    expect(getClientIp(withHeaders({ 'x-forwarded-for': '1.2.3.4' }))).toBe('unknown');
  });

  it('returns "unknown" when TRUSTED_PROXY is anything other than "true"', () => {
    process.env.TRUSTED_PROXY = 'false';
    expect(getClientIp(withHeaders({ 'x-forwarded-for': '1.2.3.4' }))).toBe('unknown');
  });

  it('returns the first value from x-forwarded-for when TRUSTED_PROXY=true', () => {
    process.env.TRUSTED_PROXY = 'true';
    expect(getClientIp(withHeaders({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent and TRUSTED_PROXY=true', () => {
    process.env.TRUSTED_PROXY = 'true';
    expect(getClientIp(withHeaders({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
  });

  it('returns "unknown" when no headers carry an IP', () => {
    process.env.TRUSTED_PROXY = 'true';
    expect(getClientIp(withHeaders({}))).toBe('unknown');
  });
});
