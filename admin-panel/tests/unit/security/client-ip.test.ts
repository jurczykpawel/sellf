import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractTrustedClientIp, getClientIp } from '@/lib/security/client-ip';

function buildHeaders(entries: Record<string, string>): { get(name: string): string | null } {
  const lower = Object.fromEntries(Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

describe('extractTrustedClientIp', () => {
  const original = process.env.TRUSTED_PROXY;
  beforeEach(() => {
    delete process.env.TRUSTED_PROXY;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.TRUSTED_PROXY;
    else process.env.TRUSTED_PROXY = original;
  });

  it('returns null when TRUSTED_PROXY is not enabled', () => {
    const headers = buildHeaders({ 'x-forwarded-for': '203.0.113.10' });
    expect(extractTrustedClientIp(headers)).toBeNull();
  });

  it('returns null when TRUSTED_PROXY is set to a non-true value', () => {
    process.env.TRUSTED_PROXY = 'false';
    const headers = buildHeaders({ 'x-forwarded-for': '203.0.113.10' });
    expect(extractTrustedClientIp(headers)).toBeNull();
  });

  it('reads the last X-Forwarded-For hop (proxy-appended real IP)', () => {
    process.env.TRUSTED_PROXY = 'true';
    const headers = buildHeaders({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7, 203.0.113.10' });
    expect(extractTrustedClientIp(headers)).toBe('203.0.113.10');
  });

  it('ignores attacker-supplied first hop in X-Forwarded-For', () => {
    process.env.TRUSTED_PROXY = 'true';
    const headers = buildHeaders({ 'x-forwarded-for': 'spoofed-bogus, 203.0.113.10' });
    expect(extractTrustedClientIp(headers)).toBe('203.0.113.10');
  });

  it('returns single XFF entry as-is when only one hop is present', () => {
    process.env.TRUSTED_PROXY = 'true';
    const headers = buildHeaders({ 'x-forwarded-for': '203.0.113.10' });
    expect(extractTrustedClientIp(headers)).toBe('203.0.113.10');
  });

  it('trims whitespace from XFF entries', () => {
    process.env.TRUSTED_PROXY = 'true';
    const headers = buildHeaders({ 'x-forwarded-for': '198.51.100.7 ,   203.0.113.10  ' });
    expect(extractTrustedClientIp(headers)).toBe('203.0.113.10');
  });

  it('skips empty XFF entries from trailing/double commas', () => {
    process.env.TRUSTED_PROXY = 'true';
    const headers = buildHeaders({ 'x-forwarded-for': '203.0.113.10,,, ' });
    expect(extractTrustedClientIp(headers)).toBe('203.0.113.10');
  });

  it('falls back to X-Real-IP when X-Forwarded-For is absent', () => {
    process.env.TRUSTED_PROXY = 'true';
    const headers = buildHeaders({ 'x-real-ip': '203.0.113.99' });
    expect(extractTrustedClientIp(headers)).toBe('203.0.113.99');
  });

  it('returns null when both XFF and X-Real-IP are missing', () => {
    process.env.TRUSTED_PROXY = 'true';
    const headers = buildHeaders({});
    expect(extractTrustedClientIp(headers)).toBeNull();
  });

  it('returns null when XFF is empty string', () => {
    process.env.TRUSTED_PROXY = 'true';
    const headers = buildHeaders({ 'x-forwarded-for': '' });
    expect(extractTrustedClientIp(headers)).toBeNull();
  });
});

describe('getClientIp', () => {
  const original = process.env.TRUSTED_PROXY;
  beforeEach(() => {
    delete process.env.TRUSTED_PROXY;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.TRUSTED_PROXY;
    else process.env.TRUSTED_PROXY = original;
  });

  it("returns 'unknown' when TRUSTED_PROXY is off, regardless of headers", () => {
    const request = new Request('http://localhost/', {
      headers: { 'x-forwarded-for': '203.0.113.10' },
    });
    expect(getClientIp(request)).toBe('unknown');
  });

  it('returns the last-hop IP when TRUSTED_PROXY is on', () => {
    process.env.TRUSTED_PROXY = 'true';
    const request = new Request('http://localhost/', {
      headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.10' },
    });
    expect(getClientIp(request)).toBe('203.0.113.10');
  });

  it("returns 'unknown' when TRUSTED_PROXY is on but no proxy headers exist", () => {
    process.env.TRUSTED_PROXY = 'true';
    const request = new Request('http://localhost/');
    expect(getClientIp(request)).toBe('unknown');
  });
});
