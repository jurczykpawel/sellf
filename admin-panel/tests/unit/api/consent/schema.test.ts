import { describe, it, expect } from 'vitest';
import { parseConsentBody } from '@/app/api/consent/schema';

describe('parseConsentBody', () => {
  it('rejects when anonymous_id is a number', () => {
    const res = parseConsentBody({ anonymous_id: 123 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/anonymous_id/i);
  });

  it('rejects anonymous_id with traversal chars', () => {
    const res = parseConsentBody({ anonymous_id: '../etc/passwd' });
    expect(res.ok).toBe(false);
  });

  it('rejects anonymous_id longer than 200 chars', () => {
    const res = parseConsentBody({ anonymous_id: 'a'.repeat(201) });
    expect(res.ok).toBe(false);
  });

  it('accepts valid alphanumeric anonymous_id', () => {
    const res = parseConsentBody({ anonymous_id: 'anon_abc-123' });
    expect(res.ok).toBe(true);
  });

  it('rejects oversized consents payload', () => {
    const big = Object.fromEntries(
      Array.from({ length: 600 }, (_, i) => [`k${i}`, 'x'.repeat(20)]),
    );
    const res = parseConsentBody({ consents: big });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/consents/i);
  });

  it('rejects consent_version longer than 50 chars', () => {
    const res = parseConsentBody({ consent_version: 'v'.repeat(51) });
    expect(res.ok).toBe(false);
  });

  it('accepts empty body (all fields optional)', () => {
    const res = parseConsentBody({});
    expect(res.ok).toBe(true);
  });

  it('returns parsed data with normalised typing', () => {
    const res = parseConsentBody({
      anonymous_id: 'anon',
      consents: { necessary: true },
      consent_version: '2.0',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.anonymous_id).toBe('anon');
      expect(res.data.consents).toEqual({ necessary: true });
      expect(res.data.consent_version).toBe('2.0');
    }
  });
});
