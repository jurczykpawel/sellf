import { describe, it, expect } from 'vitest';
import { isValidGUSKeyFormat } from '@/lib/validations/gus-key';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('isValidGUSKeyFormat', () => {
  it('accepts the real 20-char hex GUS key', () => {
    expect(isValidGUSKeyFormat('deadbeef0123456789ab')).toBe(true);
  });

  it('accepts shorter/longer alphanumeric keys within bounds', () => {
    expect(isValidGUSKeyFormat('abcde12345abcde12345')).toBe(true); // GUS test key
    expect(isValidGUSKeyFormat('aaaaaaaaaaaa')).toBe(true); // 12 chars (min)
    expect(isValidGUSKeyFormat('a'.repeat(40))).toBe(true); // 40 chars (max)
  });

  // The hanna incident: an error message got saved as the key.
  it('rejects localized error strings (the "Nie udało się zapisać konfiguracji" regression)', () => {
    expect(isValidGUSKeyFormat('Nie udało się zapisać konfiguracji')).toBe(false);
  });

  it('rejects strings with whitespace', () => {
    expect(isValidGUSKeyFormat('deadbeef cafe01234567')).toBe(false);
    expect(isValidGUSKeyFormat(' deadbeef0123456789ab')).toBe(false);
    expect(isValidGUSKeyFormat('deadbeef0123456789ab ')).toBe(false);
  });

  it('rejects strings with non-ASCII characters', () => {
    expect(isValidGUSKeyFormat('deadbeef76ef438a9e2ć')).toBe(false);
    expect(isValidGUSKeyFormat('błąd')).toBe(false);
  });

  it('rejects punctuation, slashes, dashes, dots', () => {
    expect(isValidGUSKeyFormat('deadbeef-cafe01234567')).toBe(false);
    expect(isValidGUSKeyFormat('deadbeef/cafe01234567')).toBe(false);
    expect(isValidGUSKeyFormat('deadbeef.cafe01234567')).toBe(false);
  });

  it('rejects too-short and too-long inputs', () => {
    expect(isValidGUSKeyFormat('abc')).toBe(false);
    expect(isValidGUSKeyFormat('abcdef12345')).toBe(false); // 11 chars
    expect(isValidGUSKeyFormat('a'.repeat(41))).toBe(false);
  });

  it('rejects empty / whitespace-only inputs', () => {
    expect(isValidGUSKeyFormat('')).toBe(false);
    expect(isValidGUSKeyFormat('   ')).toBe(false);
  });
});

describe('saveGUSAPIKey source guard', () => {
  // Make sure the action keeps calling the format validator BEFORE encryption.
  // If someone deletes the check, encryption would happily encrypt anything
  // (including error strings) — the hanna regression.
  const source = readFileSync(
    resolve(__dirname, '../../src/lib/actions/gus-config.ts'),
    'utf-8',
  );

  it('validates format before encryption', () => {
    const validateIdx = source.indexOf('isValidGUSKeyFormat(trimmedKey)');
    const encryptIdx = source.indexOf('encryptSecret(trimmedKey)');
    expect(validateIdx).toBeGreaterThan(-1);
    expect(encryptIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeLessThan(encryptIdx);
  });
});
