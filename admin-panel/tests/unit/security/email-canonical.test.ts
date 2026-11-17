import { describe, it, expect } from 'vitest';
import { canonicalizeEmailForBucket } from '@/lib/security/email-canonical';

describe('canonicalizeEmailForBucket', () => {
  it('trims and lowercases', () => {
    expect(canonicalizeEmailForBucket('  User@Example.COM  ')).toBe('user@example.com');
  });

  it('keeps the full local part for a domain without known alias rules', () => {
    expect(canonicalizeEmailForBucket('sales+uk@custom.example')).toBe('sales+uk@custom.example');
    expect(canonicalizeEmailForBucket('sales+uk@custom.example')).not.toBe(canonicalizeEmailForBucket('sales+pl@custom.example'));
    expect(canonicalizeEmailForBucket('alice+promo@example.com')).toBe('alice+promo@example.com');
    expect(canonicalizeEmailForBucket('u.s.e.r@example.com')).toBe('u.s.e.r@example.com');
  });

  it('folds Gmail dot and +tag variants to the same bucket', () => {
    const base = canonicalizeEmailForBucket('user@gmail.com');
    expect(base).toBe('user@gmail.com');
    expect(canonicalizeEmailForBucket('u.s.e.r@gmail.com')).toBe(base);
    expect(canonicalizeEmailForBucket('US.ER@gmail.com')).toBe(base);
    expect(canonicalizeEmailForBucket('user+tag@gmail.com')).toBe(base);
  });

  it('folds googlemail.com the same way as gmail.com (different domain key)', () => {
    expect(canonicalizeEmailForBucket('u.s.e.r+x@googlemail.com')).toBe('user@googlemail.com');
  });

  it.each([
    ['bob+news@outlook.com', 'bob@outlook.com'],
    ['bob+news@hotmail.com', 'bob@hotmail.com'],
    ['bob+a+b@proton.me', 'bob@proton.me'],
    ['bob+news@protonmail.com', 'bob@protonmail.com'],
    ['bob+news@fastmail.com', 'bob@fastmail.com'],
  ])('drops the +tag for %s, whose provider delivers +tag addresses to one inbox', (email, bucket) => {
    expect(canonicalizeEmailForBucket(email)).toBe(bucket);
  });

  it('keeps dots for providers other than Gmail', () => {
    expect(canonicalizeEmailForBucket('u.s.e.r@outlook.com')).toBe('u.s.e.r@outlook.com');
  });

  it('returns the input verbatim when there is no @', () => {
    expect(canonicalizeEmailForBucket('not-an-email')).toBe('not-an-email');
  });
});
