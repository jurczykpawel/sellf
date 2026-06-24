import { describe, it, expect } from 'vitest';
import { redactEmail } from '@/lib/logger';

/**
 * redactEmail keeps the first local-part char + the domain and masks the rest, so payment-failure
 * logs no longer leak the full buyer email (OWASP A09). Correlation still works via the session /
 * payment-intent id logged alongside.
 */
describe('redactEmail', () => {
  it('keeps first char + domain, masks the local part', () => {
    expect(redactEmail('john.doe@example.com')).toBe('j***@example.com');
    expect(redactEmail('a@b.com')).toBe('a***@b.com');
  });

  it('does not leak the full local part', () => {
    const r = redactEmail('sensitive.buyer@gmail.com');
    expect(r).not.toContain('sensitive');
    expect(r).not.toContain('buyer');
    expect(r.endsWith('@gmail.com')).toBe(true);
  });

  it('returns *** for empty / null / undefined / non-email', () => {
    expect(redactEmail('')).toBe('***');
    expect(redactEmail(null)).toBe('***');
    expect(redactEmail(undefined)).toBe('***');
    expect(redactEmail('not-an-email')).toBe('***');
    expect(redactEmail('@nolocal.com')).toBe('***'); // '@' at index 0 → no local part
  });

  it('strips control characters (log-injection safe)', () => {
    expect(redactEmail('a@evil\n.com')).toBe('a***@evil.com');
    expect(redactEmail('a@x\r\ny.com')).not.toMatch(/[\r\n]/);
  });
});
