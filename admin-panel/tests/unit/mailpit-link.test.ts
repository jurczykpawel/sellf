import { describe, expect, it } from 'vitest';
import { extractMagicLink } from '../helpers/mailpit';

describe('delivered magic link extraction', () => {
  it('decodes HTML entities without replacing the app URL', () => {
    const actual = 'https://runtime.example.org/auth/callback?flow=login&token_hash=abc&type=magiclink';
    expect(extractMagicLink(`<a href="${actual.replaceAll('&', '&amp;')}">Log in</a>`)).toBe(actual);
  });
  it('returns a broken Supabase fallback verbatim so the caller detects it', () => {
    const broken = 'http://localhost:3000&token_hash=abc&type=magiclink';
    expect(extractMagicLink(`<a href="${broken}">Log in</a>`)).toBe(broken);
  });
  it('does not invent a callback from a token without a delivered URL', () => {
    expect(extractMagicLink('token_hash=abc')).toBeNull();
  });
});
