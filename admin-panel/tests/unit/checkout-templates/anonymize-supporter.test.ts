import { describe, it, expect } from 'vitest';
import { anonymizeSupporterName } from '@/lib/checkout-templates/anonymize-supporter';

// Recent supporters lista pokazuje "kto" wsparł i kwotę. PII (email, full
// name, nazwisko) NIE może wyciec z API. Anonymizer bierze cokolwiek z
// customer_name na payment_transactions i zwraca albo pierwsze słowo (jeśli
// wygląda jak imię), albo losowy fallback z fixed listy.
//
// Deterministyczność: dla tych samych inputów + ziarna wynik się nie zmienia
// (cache 5-minutowy musi pokazywać te same nicki anonimowym donatorom).

describe('anonymizeSupporterName', () => {
  it('returns only the first word from a multi-word name', () => {
    expect(anonymizeSupporterName('Jan Kowalski', 'seed-1')).toBe('Jan');
  });

  it('handles names with extra whitespace', () => {
    expect(anonymizeSupporterName('   Pawel   Jurczyk  ', 'seed-2')).toBe('Pawel');
  });

  it('returns the single word verbatim when only one is given', () => {
    expect(anonymizeSupporterName('Mat', 'seed-3')).toBe('Mat');
  });

  it('falls back to a stable nick when the name is null/empty/whitespace', () => {
    const a = anonymizeSupporterName(null, 'seed-4');
    const b = anonymizeSupporterName('', 'seed-4');
    const c = anonymizeSupporterName('   ', 'seed-4');
    expect(a).toBeTruthy();
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(a).toMatch(/Tajemniczy|fan|dobroczyńca/i);
  });

  it('falls back to a stable nick when the name looks like an email', () => {
    expect(anonymizeSupporterName('user@example.com', 'seed-5')).toMatch(/Tajemniczy/i);
  });

  it('falls back when the name is just digits / symbols', () => {
    expect(anonymizeSupporterName('1234567890', 'seed-6')).toMatch(/Tajemniczy/i);
    expect(anonymizeSupporterName('!!!', 'seed-7')).toMatch(/Tajemniczy/i);
  });

  it('returns the SAME fallback for the same seed (deterministic for caching)', () => {
    const first = anonymizeSupporterName(null, 'cache-key-A');
    const second = anonymizeSupporterName(null, 'cache-key-A');
    expect(first).toBe(second);
  });

  it('returns different fallbacks across different seeds (some variety)', () => {
    const seeds = Array.from({ length: 20 }, (_, i) => `seed-variety-${i}`);
    const fallbacks = new Set(seeds.map((s) => anonymizeSupporterName(null, s)));
    expect(fallbacks.size).toBeGreaterThan(1);
  });

  it('never leaks anything resembling an email or long token', () => {
    const r = anonymizeSupporterName('foo.bar@example.org', 'seed-8');
    expect(r).not.toContain('@');
    expect(r).not.toContain('.org');
    expect(r.length).toBeLessThanOrEqual(30);
  });
});
