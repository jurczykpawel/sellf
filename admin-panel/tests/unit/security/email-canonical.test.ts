import { describe, it, expect } from 'vitest';
import { canonicalizeEmailForBucket } from '@/lib/security/email-canonical';

describe('canonicalizeEmailForBucket', () => {
  it('trims and lowercases', () => {
    expect(canonicalizeEmailForBucket('  User@Example.COM  ')).toBe('user@example.com');
  });

  it('strips +subaddress for any domain', () => {
    expect(canonicalizeEmailForBucket('alice+promo@example.com')).toBe('alice@example.com');
    expect(canonicalizeEmailForBucket('bob+a+b+c@proton.me')).toBe('bob@proton.me');
  });

  it('folds Gmail dot variants to the same bucket', () => {
    const base = canonicalizeEmailForBucket('user@gmail.com');
    expect(canonicalizeEmailForBucket('u.s.e.r@gmail.com')).toBe(base);
    expect(canonicalizeEmailForBucket('US.ER@gmail.com')).toBe(base);
    expect(canonicalizeEmailForBucket('user+tag@gmail.com')).toBe(base);
  });

  it('folds googlemail.com the same way as gmail.com (different domain key)', () => {
    expect(canonicalizeEmailForBucket('u.s.e.r@googlemail.com')).toBe('user@googlemail.com');
  });

  it('does not strip dots for non-Gmail domains', () => {
    expect(canonicalizeEmailForBucket('u.s.e.r@outlook.com')).toBe('u.s.e.r@outlook.com');
  });

  it('returns the input verbatim when there is no @', () => {
    expect(canonicalizeEmailForBucket('not-an-email')).toBe('not-an-email');
  });
});
