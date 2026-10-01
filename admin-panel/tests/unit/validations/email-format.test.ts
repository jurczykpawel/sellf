import { describe, it, expect } from 'vitest';
import { isValidEmailFormat, MAX_EMAIL_LENGTH } from '@/lib/validations/email-format';

describe('isValidEmailFormat', () => {
  it('accepts a normal email', () => {
    expect(isValidEmailFormat('user@example.com')).toBe(true);
  });

  it('rejects a string without an @', () => {
    expect(isValidEmailFormat('not-an-email')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidEmailFormat('')).toBe(false);
  });

  it(`rejects anything longer than ${MAX_EMAIL_LENGTH} characters before it reaches the regex`, () => {
    const longLocal = 'a'.repeat(MAX_EMAIL_LENGTH);
    expect(isValidEmailFormat(`${longLocal}@example.com`)).toBe(false);
  });

  it('never runs the regex on a pathological many-dot input (stays well under a few ms)', () => {
    // Same shape as the measured slow input, but over the length cap —
    // the point is that it returns immediately, not that it's merely fast.
    const evil = 'a@' + 'a.'.repeat(20000) + ' ';
    const start = performance.now();
    const result = isValidEmailFormat(evil);
    const elapsedMs = performance.now() - start;
    expect(result).toBe(false);
    expect(elapsedMs).toBeLessThan(5);
  });
});
