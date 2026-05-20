import { describe, it, expect } from 'vitest';
import { isAllowedOrigin } from '@/lib/security/origin-match';

describe('isAllowedOrigin', () => {
  const allowed = ['https://example.com', 'https://app.example.com'];

  it('accepts exact origin match', () => {
    expect(isAllowedOrigin('https://example.com', allowed)).toBe(true);
    expect(isAllowedOrigin('https://app.example.com', allowed)).toBe(true);
  });

  it('rejects suffix lookalike origins', () => {
    expect(isAllowedOrigin('https://example.com.evil.com', allowed)).toBe(false);
  });

  it('rejects prefix lookalike origins', () => {
    expect(isAllowedOrigin('https://evil-example.com', allowed)).toBe(false);
  });

  it('rejects HTTP when only HTTPS is allowed', () => {
    expect(isAllowedOrigin('http://example.com', allowed)).toBe(false);
  });

  it('rejects different port even on matching host', () => {
    expect(isAllowedOrigin('https://example.com:8443', allowed)).toBe(false);
  });

  it('returns false on null or empty input', () => {
    expect(isAllowedOrigin(null, allowed)).toBe(false);
    expect(isAllowedOrigin('', allowed)).toBe(false);
    expect(isAllowedOrigin(undefined, allowed)).toBe(false);
  });

  it('returns false on malformed URL', () => {
    expect(isAllowedOrigin('not-a-url', allowed)).toBe(false);
    expect(isAllowedOrigin('javascript:alert(1)', allowed)).toBe(false);
  });

  it('accepts referer URL by comparing its origin', () => {
    expect(isAllowedOrigin('https://example.com/path?q=1', allowed)).toBe(true);
    expect(isAllowedOrigin('https://example.com.evil.com/login', allowed)).toBe(false);
  });

  it('ignores trailing slash on the allowlist entries', () => {
    expect(isAllowedOrigin('https://example.com', ['https://example.com/'])).toBe(true);
  });
});
