/**
 * Stripe Search Query Language treats `\`, `(`, `)`, `:`, and `"` as
 * metacharacters. The customer-search call in src/lib/stripe/customer.ts
 * builds a `email:"..."` query, so any of those characters slipping in
 * through a quirky email yields a malformed query (Stripe 400) and
 * silently breaks the customer lookup.
 *
 * Two complementary defenses:
 *   - EMAIL_REGEX rejects emails that contain Stripe metachars.
 *   - escapeStripeSearchValue handles the residual `\` and `"` so a value
 *     that did slip through (or any other future caller) is encoded
 *     correctly.
 */
import { describe, it, expect } from 'vitest';
import { escapeStripeSearchValue, EMAIL_REGEX } from '@/lib/stripe/customer';

describe('escapeStripeSearchValue', () => {
  it('escapes backslash before double-quote (order matters for compose)', () => {
    expect(escapeStripeSearchValue('a\\b')).toBe('a\\\\b');
  });

  it('escapes double-quote', () => {
    expect(escapeStripeSearchValue('a"b')).toBe('a\\"b');
  });

  it('escapes both backslash and double-quote together', () => {
    // Input literally has one backslash + one double-quote.
    expect(escapeStripeSearchValue('a\\"b')).toBe('a\\\\\\"b');
  });

  it('passes through normal characters untouched', () => {
    expect(escapeStripeSearchValue('jane.doe+sub@example.com')).toBe(
      'jane.doe+sub@example.com',
    );
  });
});

describe('EMAIL_REGEX', () => {
  it('accepts well-formed emails', () => {
    for (const ok of ['a@b.co', 'jane.doe@example.com', 'user+tag@sub.example.org']) {
      expect(EMAIL_REGEX.test(ok), ok).toBe(true);
    }
  });

  it('rejects emails containing Stripe Search metachars', () => {
    for (const bad of [
      'a\\b@c.d',     // backslash
      'a(b@c.d',      // open paren
      'a)b@c.d',      // close paren
      'a:b@c.d',      // colon
      'a"b@c.d',      // quote
    ]) {
      expect(EMAIL_REGEX.test(bad), bad).toBe(false);
    }
  });

  it('rejects emails with whitespace or empty segments', () => {
    for (const bad of ['', 'a@b', 'a @b.c', '@b.c', 'a@.c', 'a@b.']) {
      expect(EMAIL_REGEX.test(bad), bad).toBe(false);
    }
  });
});
